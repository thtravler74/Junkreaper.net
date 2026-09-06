/**
 * Domain types shared by every process. This module is intentionally dependency
 * free — it is imported by the Electron main process, by the sandboxed preload
 * bridge, by the React renderer and by the headless CLI.
 */

/** Lifecycle of a single account/session restoration, in the order it progresses. */
export type SessionPhase =
  | 'pending'
  | 'launching'
  | 'restoring'
  | 'navigating'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'stopped';

export const TERMINAL_PHASES: readonly SessionPhase[] = ['ready', 'failed', 'stopped'];

export function isTerminalPhase(phase: SessionPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

/** How a target decides whether the restored profile is actually still logged in. */
export interface SessionProbe {
  /** A selector that only exists once the app considers you authenticated. */
  readySelector?: string;
  /** A selector that proves the opposite (a login form, an "sign in" button). */
  loggedOutSelector?: string;
  /** If the final URL matches any of these, the session is treated as expired. */
  loggedOutUrlPattern?: string[];
}

/** One entry of `config/sessions.json` — a single account to bring back online. */
export interface SessionTarget {
  /** Stable slug. Also the default on-disk profile directory name. */
  id: string;
  /** Human label shown on the elevator's floor plaque. */
  label: string;
  /** Where to navigate once the profile is restored. */
  url: string;
  /** Overrides the profile directory name when several targets share one profile. */
  profile?: string;
  /** Skip this target without deleting it from the config. */
  enabled?: boolean;
  /** Defaults to `domcontentloaded`. */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Per-target navigation/verification budget in ms. */
  timeoutMs?: number;
  /** Optional floor plaque text; falls back to `label`. */
  floorLabel?: string;
  probe?: SessionProbe;
}

/** Live state of one target for the current run. */
export interface SessionRecord {
  target: SessionTarget;
  phase: SessionPhase;
  /** Short human sentence describing what the phase is doing right now. */
  message: string;
  startedAt?: number;
  finishedAt?: number;
  /** Floor this session was awarded when it came online (1-based), if any. */
  floor?: number;
  error?: string;
  /** Diagnostics captured once the page settles. */
  result?: {
    finalUrl: string;
    title: string;
    cookieCount: number;
    restoredCookieCount: number;
    durationMs: number;
  };
}

export interface RunSummary {
  runId: string;
  startedAt: number;
  finishedAt?: number;
  total: number;
  ready: number;
  failed: number;
  stopped: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
}
