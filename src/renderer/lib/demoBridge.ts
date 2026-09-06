import type { JunkreaperApi } from '../../shared/api.ts';
import { BRIDGE_VERSION } from '../../shared/api.ts';
import type { AppInfo, SessionsSnapshot, StartOptions } from '../../shared/ipc.ts';
import type { LogEntry, RunSummary, SessionPhase, SessionRecord, SessionTarget } from '../../shared/types.ts';
import { emitElevator } from './elevatorBus.ts';

/**
 * A stand-in for the preload bridge, installed only when there isn't one - i.e.
 * when the renderer runs in a plain browser via `npm run dev:web` or
 * `npm run preview`. It implements the same `JunkreaperApi` interface the sandboxed
 * preload publishes, so the React tree has a single code path either way.
 *
 * It is also a working demonstration of the Phase 2 contract: this "background
 * task" never touches React state. It moves the car purely by dispatching
 * `junkreaper:elevator` DOM events, exactly as documented for external callers.
 */

const DEMO_TARGETS: SessionTarget[] = [
  { id: 'admin-console', label: 'Admin Console', url: 'https://admin.example.com/dashboard', floorLabel: 'Admin Console' },
  { id: 'billing', label: 'Billing Portal', url: 'https://billing.example.com/invoices' },
  { id: 'analytics', label: 'Analytics', url: 'https://analytics.example.com/reports' },
  { id: 'support-desk', label: 'Support Desk', url: 'https://desk.example.com/queue' },
  { id: 'warehouse', label: 'Warehouse Ops', url: 'https://ops.example.com/inventory' },
  { id: 'crm', label: 'CRM', url: 'https://crm.example.com/pipeline' },
];

/** The fourth account "fails", so the offline path is visible in demo mode too. */
const DEMO_FAILURE_ID = 'support-desk';

const PHASE_SCRIPT: ReadonlyArray<{ phase: SessionPhase; message: string; delay: number }> = [
  { phase: 'launching', message: 'Opening the saved profile', delay: 620 },
  { phase: 'restoring', message: 'Restoring saved cookies', delay: 520 },
  { phase: 'navigating', message: 'Loading the target application', delay: 900 },
  { phase: 'verifying', message: 'Checking whether the session is still signed in', delay: 640 },
];

export function installDemoBridge(): void {
  if (window.junkreaper) return;
  window.junkreaper = createDemoBridge();
}

function createDemoBridge(): JunkreaperApi {
  const sessionListeners = new Set<(snapshot: SessionsSnapshot) => void>();
  const logListeners = new Set<(entry: LogEntry) => void>();

  let records: SessionRecord[] = fresh();
  let summary: RunSummary | null = null;
  let running = false;
  let generation = 0;

  function fresh(): SessionRecord[] {
    return DEMO_TARGETS.map((target) => ({ target, phase: 'pending', message: 'Waiting for the car' }));
  }

  function snapshot(): SessionsSnapshot {
    return { running, summary, records: records.map((record) => ({ ...record })) };
  }

  function publish(): void {
    const current = snapshot();
    for (const listener of sessionListeners) listener(current);
  }

  function log(level: LogEntry['level'], message: string): void {
    const entry: LogEntry = { at: Date.now(), level, scope: 'demo', message };
    for (const listener of logListeners) listener(entry);
  }

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  async function run(mine: number): Promise<void> {
    for (const record of records) {
      if (mine !== generation) return;

      for (const step of PHASE_SCRIPT) {
        if (mine !== generation) return;
        record.phase = step.phase;
        record.message = step.message;
        record.startedAt ??= Date.now();
        publish();
        await wait(step.delay);
      }
      if (mine !== generation) return;

      if (record.target.id === DEMO_FAILURE_ID) {
        record.phase = 'failed';
        record.message = 'Session could not be restored';
        record.error = 'signed out - the login form is showing, this account needs a fresh sign-in';
        record.finishedAt = Date.now();
        if (summary) summary.failed += 1;
        log('warn', `${record.target.label} needs a fresh sign-in`);
        emitElevator({
          type: 'status',
          status_message: `${record.target.label} is offline - holding position`,
        });
      } else {
        record.phase = 'ready';
        record.finishedAt = Date.now();
        if (summary) summary.ready += 1;
        record.floor = summary?.ready;
        record.message = 'Signed in - 24 cookies live';
        record.result = {
          finalUrl: record.target.url,
          title: record.target.label,
          cookieCount: 24,
          restoredCookieCount: 18,
          durationMs: (record.finishedAt ?? 0) - (record.startedAt ?? 0),
        };
        log('info', `${record.target.label} is online`);
        // The whole point of the demo: a background task advancing the elevator
        // through the public DOM-event contract.
        emitElevator({
          type: 'advance',
          arrival: {
            sessionId: record.target.id,
            label: record.target.floorLabel ?? record.target.label,
            detail: new URL(record.target.url).host,
          },
        });
      }
      publish();
      await wait(900);
    }

    if (mine !== generation) return;
    running = false;
    if (summary) summary.finishedAt = Date.now();
    publish();
  }

  return {
    bridgeVersion: BRIDGE_VERSION,

    getAppInfo: async (): Promise<AppInfo> => ({
      appVersion: '0.1.0-demo',
      versions: { electron: 'n/a (browser)', chrome: navigator.userAgent, node: 'n/a', v8: 'n/a' },
      platform: navigator.platform,
      profileRoot: '(demo - no profiles on disk)',
      configPath: '(demo - config/sessions.example.json)',
      targetCount: DEMO_TARGETS.length,
      headlessDefault: true,
      packaged: false,
      demo: true,
    }),

    sessions: {
      snapshot: async () => snapshot(),
      start: async (_options?: StartOptions) => {
        if (running) return snapshot();
        generation += 1;
        records = fresh();
        running = true;
        summary = { runId: `demo-${generation}`, startedAt: Date.now(), total: records.length, ready: 0, failed: 0, stopped: 0 };
        emitElevator({
          type: 'configure',
          total_floors: records.length,
          status_message: `Doors closing - restoring ${records.length} sessions`,
        });
        publish();
        void run(generation);
        return snapshot();
      },
      stop: async () => {
        generation += 1;
        running = false;
        for (const record of records) {
          if (record.phase === 'ready' || record.phase === 'failed') continue;
          record.phase = 'stopped';
          record.message = 'Run stopped';
        }
        if (summary) summary.finishedAt = Date.now();
        publish();
        return snapshot();
      },
      openProfileDir: async () => false,
    },

    onSessionsChanged: (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },

    // Demo mode drives the car over the DOM event instead, so this channel stays
    // empty on purpose - the subscription still has to exist for the interface.
    onElevatorCommand: () => () => {},

    onLog: (listener) => {
      logListeners.add(listener);
      return () => logListeners.delete(listener);
    },
  };
}
