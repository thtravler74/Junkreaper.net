import { EventEmitter } from 'node:events';
import type { LogEntry, LogLevel } from '../../shared/types.ts';

const WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  child(scope: string): Logger;
}

/**
 * A tiny level-filtered log bus. Everything the background service says goes
 * through here, which gives the main process one place to mirror activity into the
 * renderer's console panel (`IpcPush.Log`) and one place to silence it in tests.
 */
export class LogBus extends EventEmitter {
  #minLevel: LogLevel;
  #echo: boolean;

  constructor(options: { minLevel?: LogLevel; echo?: boolean } = {}) {
    super();
    this.setMaxListeners(50);
    this.#minLevel = options.minLevel ?? 'info';
    this.#echo = options.echo ?? true;
  }

  setLevel(level: LogLevel): void {
    this.#minLevel = level;
  }

  emitEntry(level: LogLevel, scope: string, message: string): void {
    if (WEIGHT[level] < WEIGHT[this.#minLevel]) return;
    const entry: LogEntry = { at: Date.now(), level, scope, message };
    if (this.#echo) {
      const line = `[${scope}] ${message}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    }
    this.emit('entry', entry);
  }

  onEntry(listener: (entry: LogEntry) => void): () => void {
    this.on('entry', listener);
    return () => {
      this.off('entry', listener);
    };
  }

  logger(scope: string): Logger {
    const bus = this;
    return {
      debug: (message) => bus.emitEntry('debug', scope, message),
      info: (message) => bus.emitEntry('info', scope, message),
      warn: (message) => bus.emitEntry('warn', scope, message),
      error: (message, error) => bus.emitEntry('error', scope, error ? `${message}: ${describeError(error)}` : message),
      child: (sub) => bus.logger(`${scope}:${sub}`),
    };
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Playwright errors are chatty; the first two lines carry the signal.
    return error.message.split('\n').slice(0, 2).join(' ').trim();
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}
