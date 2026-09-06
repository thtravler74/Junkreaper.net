import type { JSX } from 'react';
import { formatFloor, type ElevatorState, type FloorArrival } from '../../shared/elevator.ts';

export interface ElevatorCarProps {
  state: ElevatorState;
  arrival: FloorArrival | undefined;
}

/**
 * The car itself: a lit interior behind two doors that slide apart on arrival.
 *
 * `data-doors` drives the door transform from CSS, so opening and closing is a
 * single class-free state change rather than an animation the component has to
 * schedule.
 */
export function ElevatorCar({ state, arrival }: ElevatorCarProps): JSX.Element {
  const label = state.current_floor === 0 ? 'Lobby' : (arrival?.label ?? `Floor ${state.current_floor}`);

  return (
    <div className="car" data-doors={state.doors} data-direction={state.direction}>
      <div className="car__roof" />
      <div className="car__interior">
        <span className="car__indicator">{formatFloor(state.current_floor)}</span>
        <span className="car__label">{label}</span>
      </div>
      <div className="car__door car__door--left" />
      <div className="car__door car__door--right" />
      <div className="car__threshold" />
    </div>
  );
}
