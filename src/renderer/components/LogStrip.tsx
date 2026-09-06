import { useEffect, useRef, type JSX } from 'react';
import type { LogEntry } from '../../shared/types.ts';

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** Tail of the background service's log, pinned to the newest line. */
export function LogStrip({ entries }: { entries: LogEntry[] }): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.length]);

  return (
    <div className="log">
      {entries.length === 0 ? (
        <p className="log__empty">Background service idle.</p>
      ) : (
        entries.map((entry, index) => (
          <p key={`${entry.at}-${index}`} className="log__line" data-level={entry.level}>
            <span className="log__time">{TIME.format(entry.at)}</span>
            <span className="log__scope">{entry.scope}</span>
            <span className="log__message">{entry.message}</span>
          </p>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
