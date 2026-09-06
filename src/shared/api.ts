/**
 * The exact surface `preload/index.ts` publishes on `window.junkreaper`.
 *
 * Keeping it in `shared/` means the renderer type-checks against the same
 * declaration the preload implements — the bridge cannot drift from its consumers.
 */
import type { ElevatorAction } from './elevator.ts';
import type { AppInfo, SessionsSnapshot, StartOptions } from './ipc.ts';
import type { LogEntry } from './types.ts';

export type Unsubscribe = () => void;

export interface JunkreaperApi {
  /** Bumped whenever the bridge shape changes; the renderer warns on mismatch. */
  readonly bridgeVersion: number;

  getAppInfo(): Promise<AppInfo>;

  readonly sessions: {
    snapshot(): Promise<SessionsSnapshot>;
    start(options?: StartOptions): Promise<SessionsSnapshot>;
    stop(): Promise<SessionsSnapshot>;
    /** Reveals a target's persistent Chromium profile in the OS file manager. */
    openProfileDir(sessionId: string): Promise<boolean>;
  };

  /** Full snapshot pushes — idempotent, so a dropped frame is self-healing. */
  onSessionsChanged(listener: (snapshot: SessionsSnapshot) => void): Unsubscribe;

  /** The background service stepping the elevator. */
  onElevatorCommand(listener: (action: ElevatorAction) => void): Unsubscribe;

  onLog(listener: (entry: LogEntry) => void): Unsubscribe;
}

export const BRIDGE_VERSION = 1;
