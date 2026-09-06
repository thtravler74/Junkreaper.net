import type { JSX } from 'react';
export interface ControlBarProps {
  running: boolean;
  busy: boolean;
  canAdvance: boolean;
  headless: boolean;
  onHeadlessChange(next: boolean): void;
  onStart(): void;
  onStop(): void;
  onAdvance(): void;
  onReset(): void;
}

export function ControlBar(props: ControlBarProps): JSX.Element {
  return (
    <div className="controls">
      <button type="button" className="btn btn--primary" onClick={props.onStart} disabled={props.running || props.busy}>
        {props.running ? 'Restoring...' : 'Restore sessions'}
      </button>

      <button type="button" className="btn" onClick={props.onStop} disabled={!props.running || props.busy}>
        Stop
      </button>

      <label className="toggle" title="Show the Chromium windows the background service drives">
        <input
          type="checkbox"
          checked={!props.headless}
          disabled={props.running}
          onChange={(event) => props.onHeadlessChange(!event.target.checked)}
        />
        <span>headful</span>
      </label>

      <span className="controls__spacer" />

      {/* Manual equivalents of the events the background service emits - handy for
          demoing the ride without waiting on a real restore. */}
      <button type="button" className="btn btn--ghost" onClick={props.onAdvance} disabled={!props.canAdvance}>
        Step up
      </button>
      <button type="button" className="btn btn--ghost" onClick={props.onReset}>
        Lobby
      </button>
    </div>
  );
}
