import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { type ElevatorAction, formatFloor } from '../../shared/elevator.ts';
import type { SessionsSnapshot, StartOptions } from '../../shared/ipc.ts';
import { isTerminalPhase, type RunSummary, type SessionPhase, type SessionRecord } from '../../shared/types.ts';
import type { SessionsConfig } from '../config/sessionsConfig.ts';
import type { LogBus } from './logger.ts';
import { AbortedError, hostOf, PlaywrightSessionRunner, type RestorePhase } from './playwrightRunner.ts';
import type { ProfileStore } from './profileStore.ts';

export interface OrchestratorOptions {
  store: ProfileStore;
  logBus: LogBus;
  config: SessionsConfig;
  executablePath?: string | undefined;
}

type Unsubscribe = () => void;

/**
 * The seam between "Playwright restored an account" and "the elevator goes up".
 *
 * It owns the run: the record list the UI renders, the concurrency pool, and the
 * translation of restore phases into `ElevatorAction`s. Nothing here imports
 * Electron, which is what lets `src/cli/probe.ts` drive the identical pipeline
 * from a plain Node process.
 *
 * Two event streams come out:
 *   - `snapshot` - the complete `SessionsSnapshot`, pushed on every change. Full
 *     snapshots rather than deltas, so a dropped frame is self-healing.
 *   - `elevator` - `ElevatorAction`s for the UI to reduce. A floor is awarded only
 *     when a session actually comes online; failures hold the car where it is.
 */
export class SessionOrchestrator extends EventEmitter {
  readonly #store: ProfileStore;
  readonly #logBus: LogBus;
  readonly #config: SessionsConfig;
  readonly #executablePath: string | undefined;

  #records: SessionRecord[] = [];
  #summary: RunSummary | null = null;
  #running = false;
  #runner: PlaywrightSessionRunner | null = null;
  #runPromise: Promise<void> | null = null;

  constructor(options: OrchestratorOptions) {
    super();
    this.setMaxListeners(50);
    this.#store = options.store;
    this.#logBus = options.logBus;
    this.#config = options.config;
    this.#executablePath = options.executablePath;
    this.#records = this.#buildRecords();
  }

  get running(): boolean {
    return this.#running;
  }

  snapshot(): SessionsSnapshot {
    return {
      running: this.#running,
      summary: this.#summary,
      // Structured-cloned across IPC, so hand out copies rather than live objects.
      records: this.#records.map((record) => ({ ...record })),
    };
  }

  onSnapshot(listener: (snapshot: SessionsSnapshot) => void): Unsubscribe {
    this.on('snapshot', listener);
    return () => void this.off('snapshot', listener);
  }

  onElevator(listener: (action: ElevatorAction) => void): Unsubscribe {
    this.on('elevator', listener);
    return () => void this.off('elevator', listener);
  }

  /**
   * Kicks off a run and returns immediately with the starting snapshot; progress
   * arrives on the `snapshot` and `elevator` streams. The UI should never block on
   * a full restoration sweep.
   */
  start(options: StartOptions = {}): SessionsSnapshot {
    if (this.#running) return this.snapshot();

    const only = options.only?.length ? new Set(options.only) : null;
    this.#records = this.#buildRecords(only);

    const log = this.#logBus.logger('orchestrator');
    if (this.#records.length === 0) {
      log.warn('nothing to do: no enabled targets matched');
      this.#emitElevator({ type: 'configure', total_floors: 0, status_message: 'No sessions configured' });
      this.#emitSnapshot();
      return this.snapshot();
    }

    const headless = options.headless ?? this.#config.defaults.headless;
    const concurrency = Math.max(1, options.concurrency ?? this.#config.defaults.concurrency);

    this.#running = true;
    this.#summary = {
      runId: randomUUID(),
      startedAt: Date.now(),
      total: this.#records.length,
      ready: 0,
      failed: 0,
      stopped: 0,
    };

    this.#runner = new PlaywrightSessionRunner({
      store: this.#store,
      logger: this.#logBus.logger('playwright'),
      headless,
      timeoutMs: this.#config.defaults.timeoutMs,
      waitUntil: this.#config.defaults.waitUntil,
      keepContextsOpen: this.#config.defaults.keepContextsOpen,
      executablePath: this.#executablePath,
      proxy: this.#config.defaults.proxy,
      captureDiagnostics: true,
    });

    log.info(
      `run ${this.#summary.runId.slice(0, 8)} starting: ${this.#records.length} target(s), ` +
        `headless=${headless}, concurrency=${concurrency}`,
    );

    // The building is exactly as tall as the number of accounts we are restoring.
    this.#emitElevator({
      type: 'configure',
      total_floors: this.#records.length,
      status_message: `Doors closing - restoring ${this.#records.length} ${this.#records.length === 1 ? 'session' : 'sessions'}`,
    });
    this.#emitSnapshot();

    this.#runPromise = this.#run(concurrency).catch((error: unknown) => {
      log.error('run crashed', error);
    });

    return this.snapshot();
  }

  async stop(): Promise<SessionsSnapshot> {
    if (!this.#running) return this.snapshot();
    this.#logBus.logger('orchestrator').warn('stop requested');
    await this.#runner?.stop();
    await this.#runPromise;
    return this.snapshot();
  }

  /** Called on app quit: nothing must outlive the window. */
  async dispose(): Promise<void> {
    await this.#runner?.stop();
    await this.#runPromise?.catch(() => {});
    this.removeAllListeners();
  }

  // --- internals ------------------------------------------------------------

  #buildRecords(only: Set<string> | null = null): SessionRecord[] {
    return this.#config.targets
      .filter((target) => target.enabled !== false)
      .filter((target) => (only ? only.has(target.id) : true))
      .map((target) => ({ target, phase: 'pending' as SessionPhase, message: 'Waiting for the car' }));
  }

  async #run(concurrency: number): Promise<void> {
    const runner = this.#runner;
    const summary = this.#summary;
    if (!runner || !summary) return;
    const log = this.#logBus.logger('orchestrator');

    const queue = this.#records.map((record, index) => ({ record, index }));
    const workerCount = Math.min(concurrency, queue.length);

    const worker = async (): Promise<void> => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        try {
          await this.#restoreOne(runner, next.record, summary);
        } catch (error) {
          if (error instanceof AbortedError) {
            this.#markStopped(summary);
            return;
          }
          throw error;
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: workerCount }, worker));
    } finally {
      summary.finishedAt = Date.now();
      this.#running = false;
      this.#runner = null;

      const seconds = ((summary.finishedAt - summary.startedAt) / 1000).toFixed(1);
      log.info(`run finished in ${seconds}s: ${summary.ready} ready, ${summary.failed} failed, ${summary.stopped} stopped`);

      if (summary.ready < summary.total) {
        const stalled = summary.total - summary.ready;
        this.#emitElevator({
          type: 'status',
          status_message: `Holding at ${formatFloor(summary.ready)} - ${stalled} ${stalled === 1 ? 'session needs' : 'sessions need'} a fresh sign-in`,
        });
      }
      this.#emitSnapshot();
    }
  }

  async #restoreOne(runner: PlaywrightSessionRunner, record: SessionRecord, summary: RunSummary): Promise<void> {
    const { target } = record;
    // The floor this account is queued to unlock, if it comes online.
    const nextFloor = summary.ready + 1;

    this.#update(record, {
      phase: 'launching',
      message: 'Opening the saved profile',
      startedAt: Date.now(),
    });
    this.#emitElevator({
      type: 'status',
      status_message: `Calling floor ${nextFloor} - ${target.label}`,
    });

    const phaseMessages: Record<RestorePhase, SessionPhase> = {
      launching: 'launching',
      restoring: 'restoring',
      navigating: 'navigating',
      verifying: 'verifying',
    };

    const outcome = await runner.restore(target, {
      onPhase: (phase, message) => {
        this.#update(record, { phase: phaseMessages[phase], message });
      },
    });

    if (outcome.ok) {
      summary.ready += 1;
      const floor = summary.ready;
      this.#update(record, {
        phase: 'ready',
        floor,
        finishedAt: Date.now(),
        message: outcome.unverified
          ? `Loaded (no probe configured, sign-in unverified)`
          : `Signed in - ${outcome.cookieCount} cookies live`,
        result: {
          finalUrl: outcome.finalUrl,
          title: outcome.title,
          cookieCount: outcome.cookieCount,
          restoredCookieCount: outcome.restoredCookieCount,
          durationMs: outcome.durationMs,
        },
      });

      // *** Phase 3's payoff: a restored account is a floor. ***
      this.#emitElevator({
        type: 'advance',
        arrival: {
          sessionId: target.id,
          label: target.floorLabel ?? target.label,
          detail: hostOf(outcome.finalUrl),
        },
      });
    } else {
      summary.failed += 1;
      this.#update(record, {
        phase: 'failed',
        finishedAt: Date.now(),
        message: 'Session could not be restored',
        error: outcome.reason,
      });
      this.#emitElevator({
        type: 'status',
        status_message: `${target.label} is offline - holding at ${formatFloor(summary.ready)}`,
      });
    }
  }

  #markStopped(summary: RunSummary): void {
    for (const record of this.#records) {
      if (isTerminalPhase(record.phase)) continue;
      summary.stopped += 1;
      this.#update(record, { phase: 'stopped', message: 'Run stopped', finishedAt: Date.now() });
    }
  }

  #update(record: SessionRecord, patch: Partial<SessionRecord>): void {
    Object.assign(record, patch);
    this.#emitSnapshot();
  }

  #emitSnapshot(): void {
    this.emit('snapshot', this.snapshot());
  }

  #emitElevator(action: ElevatorAction): void {
    this.emit('elevator', action);
  }
}
