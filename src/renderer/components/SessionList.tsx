import type { JSX } from 'react';
import type { SessionPhase, SessionRecord } from '../../shared/types.ts';

const PHASE_TEXT: Record<SessionPhase, string> = {
  pending: 'queued',
  launching: 'launching',
  restoring: 'restoring',
  navigating: 'loading',
  verifying: 'verifying',
  ready: 'online',
  failed: 'offline',
  stopped: 'stopped',
};

/** Everything between `pending` and a terminal phase animates its progress bar. */
const IN_FLIGHT: ReadonlySet<SessionPhase> = new Set<SessionPhase>(['launching', 'restoring', 'navigating', 'verifying']);

export interface SessionListProps {
  records: SessionRecord[];
  onOpenProfile(sessionId: string): void;
}

/**
 * One row per account the background service is restoring: its phase, the floor it
 * was awarded when it came online, and - when it fails - the actual reason, which
 * is almost always "this profile needs a fresh sign-in".
 */
export function SessionList({ records, onOpenProfile }: SessionListProps): JSX.Element {
  if (records.length === 0) {
    return (
      <p className="sessions__empty">
        No targets configured. Copy <code>config/sessions.example.json</code> to <code>config/sessions.json</code> and
        add the accounts you want restored.
      </p>
    );
  }

  return (
    <ul className="sessions">
      {records.map((record) => (
        <li key={record.target.id} className="session" data-phase={record.phase}>
          <div className="session__floor">{record.floor ?? '-'}</div>

          <div className="session__body">
            <div className="session__head">
              <span className="session__label">{record.target.label}</span>
              <span className="session__phase">{PHASE_TEXT[record.phase]}</span>
            </div>

            <p className="session__message">{record.error ?? record.message}</p>

            <div className="session__meta">
              <code className="session__url">{record.result?.finalUrl ?? record.target.url}</code>
              {record.result ? (
                <span className="session__timing">
                  {record.result.cookieCount} cookies &middot; {(record.result.durationMs / 1000).toFixed(1)}s
                </span>
              ) : null}
            </div>

            {IN_FLIGHT.has(record.phase) ? <div className="session__progress" /> : null}
          </div>

          <button
            type="button"
            className="session__reveal"
            title="Reveal this account's Chromium profile directory"
            onClick={() => onOpenProfile(record.target.id)}
          >
            profile
          </button>
        </li>
      ))}
    </ul>
  );
}
