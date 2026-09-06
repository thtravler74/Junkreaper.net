#!/usr/bin/env node
/**
 * Dev orchestrator. Three moving parts, one process tree, no extra dependencies:
 *
 *   1. Vite dev server for the renderer (HMR, in-process via the JS API).
 *   2. esbuild in watch mode for main/preload/cli.
 *   3. Electron, pointed at the Vite URL through VITE_DEV_SERVER_URL and bounced
 *      automatically whenever the main or preload bundle is rebuilt.
 *
 * Renderer edits hot-reload. Main/preload edits restart Electron. Ctrl+C tears the
 * whole tree down.
 */
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';
import { createWatchContexts, buildOnce, ROOT } from './esbuild.config.mjs';

const MODE = 'development';

let electron = null;
let restarting = false;
let shuttingDown = false;
let restartTimer = null;

function launchArgs() {
  const args = ['.'];
  // Chromium's setuid sandbox refuses to run as uid 0. Containers and CI images
  // routinely run as root, so opt out there (and only there) rather than failing
  // with an opaque FATAL from the Electron bootstrap.
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    console.warn('[dev] running as root — adding --no-sandbox (never do this in a shipped build)');
    args.push('--no-sandbox');
  }
  return args;
}

function startElectron(devServerUrl) {
  electron = spawn(electronPath, launchArgs(), {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: MODE,
      VITE_DEV_SERVER_URL: devServerUrl,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });

  electron.on('exit', (code, signal) => {
    electron = null;
    if (restarting || shuttingDown) return;
    console.log(`[dev] electron exited (${signal ?? code}) — shutting down`);
    void shutdown(code ?? 0);
  });
}

function scheduleRestart(devServerUrl, label) {
  clearTimeout(restartTimer);
  // Debounce: a single save can retrigger several esbuild contexts at once.
  restartTimer = setTimeout(() => {
    console.log(`[dev] ${label} bundle changed — restarting electron`);
    restarting = true;
    if (electron) {
      electron.once('exit', () => {
        restarting = false;
        startElectron(devServerUrl);
      });
      electron.kill();
    } else {
      restarting = false;
      startElectron(devServerUrl);
    }
  }, 120);
}

let cleanup = async () => {};

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  if (electron) electron.kill();
  await cleanup();
  process.exit(code);
}

// --- boot ------------------------------------------------------------------

console.log('[dev] building main/preload/cli…');
await buildOnce(MODE);

const server = await createServer({ mode: MODE, configFile: new URL('../vite.config.ts', import.meta.url).pathname });
await server.listen();

const devServerUrl = server.resolvedUrls?.local?.[0];
if (!devServerUrl) {
  throw new Error('vite did not report a local dev server URL');
}
console.log(`[dev] renderer on ${devServerUrl}`);

const watcher = await createWatchContexts(MODE, (label) => {
  if (label === 'cli') return; // the CLI is not part of the desktop process tree
  scheduleRestart(devServerUrl, label);
});

cleanup = async () => {
  await watcher.dispose();
  await server.close();
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[dev] ${signal} — stopping`);
    void shutdown(0);
  });
}

startElectron(devServerUrl);
