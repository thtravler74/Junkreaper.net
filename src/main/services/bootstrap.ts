import path from 'node:path';
import process from 'node:process';
import { loadSessionsConfig, type SessionsConfig } from '../config/sessionsConfig.ts';
import type { LogLevel } from '../../shared/types.ts';
import { LogBus } from './logger.ts';
import { ProfileStore } from './profileStore.ts';
import { SessionOrchestrator } from './sessionOrchestrator.ts';

export interface BootstrapOptions {
  /** Where profiles, cookie jars and diagnostics live. */
  stateRoot: string;
  /** Project root used to find `config/sessions.json`. */
  cwd?: string;
  explicitConfigPath?: string | undefined;
  /** `process.resourcesPath/config` in a packaged build; absent for the CLI. */
  resourcesDir?: string | undefined;
  logLevel?: LogLevel;
  echoLogs?: boolean;
}

export interface Services {
  store: ProfileStore;
  logBus: LogBus;
  orchestrator: SessionOrchestrator;
  config: SessionsConfig;
  configPath: string;
  isExampleConfig: boolean;
}

/**
 * Builds the whole background-service graph. Deliberately free of Electron imports:
 * the desktop app calls this with `app.getPath('userData')`, and `src/cli/probe.ts`
 * calls it with a plain directory, so both drive byte-identical code.
 */
export async function createServices(options: BootstrapOptions): Promise<Services> {
  const cwd = options.cwd ?? process.cwd();
  const logBus = new LogBus({
    minLevel: options.logLevel ?? (process.env.JUNKREAPER_LOG_LEVEL as LogLevel | undefined) ?? 'info',
    echo: options.echoLogs ?? true,
  });
  const log = logBus.logger('bootstrap');

  const store = new ProfileStore(options.stateRoot);
  await store.ensureDirs();

  const loaded = await loadSessionsConfig({
    stateRoot: options.stateRoot,
    cwd,
    explicitPath: options.explicitConfigPath ?? process.env.JUNKREAPER_SESSIONS,
    resourcesDir: options.resourcesDir,
  });

  log.info(`state root: ${store.root}`);
  log.info(`sessions config: ${loaded.path}${loaded.isExample ? ' (example - copy it to config/sessions.json and edit)' : ''}`);
  log.info(`${loaded.config.targets.filter((t) => t.enabled !== false).length} enabled target(s)`);

  const orchestrator = new SessionOrchestrator({
    store,
    logBus,
    config: loaded.config,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });

  return {
    store,
    logBus,
    orchestrator,
    config: loaded.config,
    configPath: loaded.path,
    isExampleConfig: loaded.isExample,
  };
}

/** Default state root for the CLI, which has no Electron `userData` directory. */
export function cliStateRoot(cwd = process.cwd()): string {
  return process.env.JUNKREAPER_HOME ?? path.join(cwd, '.junkreaper');
}
