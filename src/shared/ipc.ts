/**
 * The single source of truth for every cross-process channel name and payload.
 * Main, preload and renderer all import from here, so a renamed channel or a
 * changed payload shape is a compile error rather than a silent no-op at runtime.
 */
import type { ElevatorAction } from './elevator.ts';
import type { LogEntry, RunSummary, SessionRecord } from './types.ts';

/** Renderer → main, request/response (`ipcRenderer.invoke` / `ipcMain.handle`). */
export const IpcRequest = {
  AppInfo: 'junkreaper:app/info',
  SessionsSnapshot: 'junkreaper:sessions/snapshot',
  SessionsStart: 'junkreaper:sessions/start',
  SessionsStop: 'junkreaper:sessions/stop',
  OpenProfileDir: 'junkreaper:app/open-profile-dir',
} as const;

/** Main → renderer, fire-and-forget (`webContents.send`). */
export const IpcPush = {
  SessionsChanged: 'junkreaper:sessions/changed',
  ElevatorCommand: 'junkreaper:elevator/command',
  Log: 'junkreaper:log/entry',
} as const;

/**
 * The DOM CustomEvent the renderer listens for. Any background task running inside
 * the window (a demo driver, a devtools one-liner, a future in-page worker) can
 * drive the elevator with:
 *
 *   window.dispatchEvent(new CustomEvent('junkreaper:elevator', { detail: { type: 'advance' } }))
 */
export const ELEVATOR_DOM_EVENT = 'junkreaper:elevator';

export interface AppInfo {
  appVersion: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
    v8: string;
  };
  /** `process.platform` as a plain string: this module also compiles without @types/node. */
  platform: string;
  /** Directory holding the per-account persistent Chromium profiles. */
  profileRoot: string;
  /** Resolved path of the sessions config actually in use. */
  configPath: string;
  targetCount: number;
  headlessDefault: boolean;
  packaged: boolean;
  /** Set by the browser-only mock bridge; never set by the real preload. */
  demo?: boolean;
}

export interface SessionsSnapshot {
  running: boolean;
  summary: RunSummary | null;
  records: SessionRecord[];
}

export interface StartOptions {
  /** Run Chromium headless. Defaults to the orchestrator's configured value. */
  headless?: boolean;
  /** How many contexts to restore at once. 1 keeps the elevator legible. */
  concurrency?: number;
  /** Restrict the run to these target ids. */
  only?: string[];
}

/** Compile-time map of channel → (args, result). Used by the preload bridge. */
export interface IpcRequestContract {
  [IpcRequest.AppInfo]: { args: []; result: AppInfo };
  [IpcRequest.SessionsSnapshot]: { args: []; result: SessionsSnapshot };
  [IpcRequest.SessionsStart]: { args: [StartOptions?]; result: SessionsSnapshot };
  [IpcRequest.SessionsStop]: { args: []; result: SessionsSnapshot };
  [IpcRequest.OpenProfileDir]: { args: [string]; result: boolean };
}

export interface IpcPushContract {
  [IpcPush.SessionsChanged]: SessionsSnapshot;
  [IpcPush.ElevatorCommand]: ElevatorAction;
  [IpcPush.Log]: LogEntry;
}
