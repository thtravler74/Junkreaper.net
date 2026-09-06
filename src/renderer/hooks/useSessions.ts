import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, SessionsSnapshot, StartOptions } from '../../shared/ipc.ts';
import type { LogEntry } from '../../shared/types.ts';

const EMPTY: SessionsSnapshot = { running: false, summary: null, records: [] };
const LOG_LIMIT = 120;

export interface SessionsController {
  snapshot: SessionsSnapshot;
  appInfo: AppInfo | null;
  logs: LogEntry[];
  /** False if the preload bridge is missing entirely (should not happen in-app). */
  available: boolean;
  busy: boolean;
  start(options?: StartOptions): Promise<void>;
  stop(): Promise<void>;
  openProfileDir(sessionId: string): Promise<void>;
}

/**
 * Mirrors the background service into React state.
 *
 * The main process pushes whole snapshots rather than deltas, so this hook is a
 * dumb `setState` - out-of-order or dropped frames cannot corrupt the list, and a
 * late subscriber is correct as soon as the next push lands.
 */
export function useSessions(): SessionsController {
  const bridge = window.junkreaper;
  const [snapshot, setSnapshot] = useState<SessionsSnapshot>(EMPTY);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    void bridge.sessions.snapshot().then((initial) => {
      if (live) setSnapshot(initial);
    });
    void bridge.getAppInfo().then((info) => {
      if (live) setAppInfo(info);
    });
    const offSessions = bridge.onSessionsChanged(setSnapshot);
    const offLogs = bridge.onLog((entry) => {
      setLogs((previous) => [...previous, entry].slice(-LOG_LIMIT));
    });
    return () => {
      live = false;
      offSessions();
      offLogs();
    };
  }, [bridge]);

  const start = useCallback(
    async (options?: StartOptions) => {
      if (!bridge) return;
      setBusy(true);
      try {
        setSnapshot(await bridge.sessions.start(options));
      } finally {
        setBusy(false);
      }
    },
    [bridge],
  );

  const stop = useCallback(async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      setSnapshot(await bridge.sessions.stop());
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  const openProfileDir = useCallback(
    async (sessionId: string) => {
      await bridge?.sessions.openProfileDir(sessionId);
    },
    [bridge],
  );

  return { snapshot, appInfo, logs, available: Boolean(bridge), busy, start, stop, openProfileDir };
}
