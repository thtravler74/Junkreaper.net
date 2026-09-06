import type { JSX } from 'react';
import type { ElevatorState } from '../../shared/elevator.ts';

/**
 * The scrolling sign above the doors. `key`ed on the revision so every new message
 * replays the wipe-in animation instead of silently swapping text.
 */
export function StatusBanner({ state }: { state: ElevatorState }): JSX.Element {
  return (
    <div className="banner" role="status" aria-live="polite">
      <span className="banner__dot" data-moving={state.moving || undefined} />
      <span key={state.revision} className="banner__text">
        {state.status_message}
      </span>
    </div>
  );
}
