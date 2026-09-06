import { fileURLToPath } from 'node:url';
import process from 'node:process';
import esbuild from 'esbuild';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Everything that runs outside the browser window. All three bundles are emitted as
 * CommonJS on purpose:
 *
 *  - a sandboxed Electron preload script *must* be CommonJS; ESM preloads are only
 *    supported with `sandbox: false`, and we are not giving that up.
 *  - keeping the main process on the same format removes the ESM/CJS interop seam
 *    with `playwright`, which stays external (it ships native helpers and resolves
 *    browser binaries relative to its own package directory, so bundling it breaks).
 */
export const ENTRIES = [
  { label: 'main', in: 'src/main/index.ts', out: 'dist/main/index.cjs' },
  { label: 'preload', in: 'src/preload/index.ts', out: 'dist/preload/index.cjs' },
  { label: 'cli', in: 'src/cli/probe.ts', out: 'dist/cli/probe.cjs' },
];

/** Resolved at runtime by Electron/Node, never inlined into the bundle. */
export const EXTERNALS = ['electron', 'playwright', 'playwright-core'];

export function buildOptions(entry, mode) {
  const dev = mode === 'development';
  return {
    absWorkingDir: ROOT,
    entryPoints: [entry.in],
    outfile: entry.out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: EXTERNALS,
    sourcemap: dev ? 'inline' : true,
    minify: !dev,
    treeShaking: true,
    logLevel: 'warning',
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    banner: {
      js: `/* junkreaper ${entry.label} bundle — built ${new Date().toISOString()} */`,
    },
  };
}

export async function buildOnce(mode = process.env.NODE_ENV ?? 'production') {
  const started = Date.now();
  await Promise.all(ENTRIES.map((entry) => esbuild.build(buildOptions(entry, mode))));
  return Date.now() - started;
}

/**
 * Watch mode for `scripts/dev.mjs`. `onRebuild(label)` fires after each successful
 * rebuild so the dev orchestrator can bounce the Electron process.
 */
export async function createWatchContexts(mode, onRebuild) {
  const notify = {
    name: 'notify-rebuild',
    setup(build) {
      let first = true;
      build.onEnd((result) => {
        const label = build.initialOptions.__label;
        if (result.errors.length > 0) return;
        if (first) {
          first = false;
          return;
        }
        onRebuild(label);
      });
    },
  };

  const contexts = await Promise.all(
    ENTRIES.map(async (entry) => {
      const options = buildOptions(entry, mode);
      options.__label = entry.label;
      options.plugins = [notify];
      const context = await esbuild.context(options);
      await context.watch();
      return context;
    }),
  );

  return {
    dispose: () => Promise.all(contexts.map((c) => c.dispose())),
  };
}
