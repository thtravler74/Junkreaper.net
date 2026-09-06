import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  createElevatorState,
  elevatorReducer,
  type ElevatorAction,
  type ElevatorState,
} from '../../shared/elevator.ts';
import { installElevatorRemote, onElevatorDomEvent } from '../lib/elevatorBus.ts';
import { usePrefersReducedMotion } from './usePrefersReducedMotion.ts';

export interface ElevatorController {
  state: ElevatorState;
  dispatch: (action: ElevatorAction) => void;
  /** Transition duration to hand the CSS, already adjusted for reduced motion. */
  rideMs: number;
}

/**
 * Owns the elevator state and every way of driving it.
 *
 * Three producers feed one reducer:
 *   1. the React tree itself (buttons in the control bar),
 *   2. in-page background tasks, via `junkreaper:elevator` DOM CustomEvents,
 *   3. the Electron main process, via `IpcPush.ElevatorCommand` - which is how a
 *      restored Playwright context steps the car up a floor.
 *
 * Movement is deliberately two-phase. An `advance` starts the ride and records how
 * long it should take (`state.rideMs`); a `settle` ends it, opens the doors and
 * publishes the arrival message. The settle is fired from a timer rather than a
 * `transitionend` listener, because `transitionend` never fires when the duration
 * is zero (reduced motion) or when the element is off-screen - the car would hang
 * between floors forever.
 */
export function useElevator(): ElevatorController {
  const [state, dispatch] = useReducer(elevatorReducer, undefined, () => createElevatorState());
  const reducedMotion = usePrefersReducedMotion();

  // The remote reads live state through a ref so publishing it does not re-install
  // `window.elevator` on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  const safeDispatch = useCallback((action: ElevatorAction) => dispatch(action), []);

  // Producer 2: in-page background tasks.
  useEffect(() => onElevatorDomEvent(safeDispatch), [safeDispatch]);

  // Producer 3: the main process.
  useEffect(() => window.junkreaper?.onElevatorCommand(safeDispatch), [safeDispatch]);

  // `window.elevator.advance()` for background tasks and the devtools console.
  useEffect(() => installElevatorRemote(() => stateRef.current), []);

  const rideMs = reducedMotion ? 0 : state.rideMs;

  useEffect(() => {
    if (!state.moving) return;
    const timer = window.setTimeout(() => dispatch({ type: 'settle' }), Math.max(120, rideMs));
    return () => window.clearTimeout(timer);
    // `current_floor` is in the deps so a second advance mid-ride extends the trip
    // instead of settling the car early.
  }, [state.moving, state.current_floor, rideMs]);

  return { state, dispatch: safeDispatch, rideMs };
}
