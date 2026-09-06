import type { JSX } from 'react';
import { formatFloor, type ElevatorState } from '../../shared/elevator.ts';

/**
 * The lobby indicator above the doors: direction arrows, the current floor in a
 * seven-segment-ish readout, and how far there is left to climb.
 *
 * This is the accessible counterpart to the shaft, which is `aria-hidden`. The
 * readout is a polite live region so a screen reader announces each new floor
 * without interrupting whatever it is currently reading.
 */
export function FloorCounter({ state }: { state: ElevatorState }): JSX.Element {
  const atTop = state.total_floors > 0 && state.current_floor === state.total_floors;

  return (
    <div className="counter" data-moving={state.moving || undefined} data-at-top={atTop || undefined}>
      <div className="counter__arrows">
        <span className="counter__arrow" data-active={state.direction === 'up' || undefined}>
          &#9650;
        </span>
        <span className="counter__arrow" data-active={state.direction === 'down' || undefined}>
          &#9660;
        </span>
      </div>

      <div className="counter__readout">
        <span className="counter__digits" role="status" aria-live="polite">
          {formatFloor(state.current_floor)}
        </span>
      </div>

      <div className="counter__meta">
        <span className="counter__of">
          floor {state.current_floor} <span>/</span> {state.total_floors}
        </span>
        <span className="counter__doors">{state.doors === 'open' ? 'doors open' : 'doors closed'}</span>
      </div>
    </div>
  );
}
