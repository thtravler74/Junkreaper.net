import type { ElevatorAction, ElevatorState } from '../../shared/elevator.ts';
import { ELEVATOR_DOM_EVENT } from '../../shared/ipc.ts';

/**
 * The in-page transport for elevator commands.
 *
 * Phase 2 asks for "an event listener that allows background tasks to trigger
 * advancing to the next floor" - this is it. Anything running inside the window
 * can move the car without importing a single React symbol:
 *
 *   window.dispatchEvent(
 *     new CustomEvent('junkreaper:elevator', { detail: { type: 'advance' } })
 *   );
 *
 * or, more conveniently, `window.elevator.advance('Reporting API')`.
 *
 * The Electron main process reaches the same reducer over IPC instead
 * (`IpcPush.ElevatorCommand`), so out-of-process and in-process background tasks
 * speak one identical `ElevatorAction` vocabulary.
 */
export function emitElevator(action: ElevatorAction): void {
  window.dispatchEvent(new CustomEvent<ElevatorAction>(ELEVATOR_DOM_EVENT, { detail: action }));
}

export function onElevatorDomEvent(listener: (action: ElevatorAction) => void): () => void {
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<ElevatorAction>).detail;
    if (detail && typeof detail === 'object' && typeof detail.type === 'string') listener(detail);
  };
  window.addEventListener(ELEVATOR_DOM_EVENT, handler);
  return () => window.removeEventListener(ELEVATOR_DOM_EVENT, handler);
}

export interface ElevatorRemote {
  /** Ride up one floor. Optionally name the floor's plaque. */
  advance(label?: string, detail?: string): void;
  goto(floor: number): void;
  status(message: string): void;
  configure(total_floors: number): void;
  reset(): void;
  dispatch(action: ElevatorAction): void;
  /** Read-only view of the live reducer state, for poking around in devtools. */
  readonly state: ElevatorState;
}

/**
 * Publishes `window.elevator`. Every method funnels through the same DOM event as
 * an external caller would use, so the console and a background task exercise the
 * identical path - there is no privileged back door into the reducer.
 */
export function installElevatorRemote(getState: () => ElevatorState): () => void {
  const remote: ElevatorRemote = {
    advance: (label, detail) =>
      emitElevator({
        type: 'advance',
        ...(label ? { arrival: { label, ...(detail ? { detail } : {}) } } : {}),
      }),
    goto: (floor) => emitElevator({ type: 'goto', floor }),
    status: (status_message) => emitElevator({ type: 'status', status_message }),
    configure: (total_floors) => emitElevator({ type: 'configure', total_floors }),
    reset: () => emitElevator({ type: 'reset' }),
    dispatch: (action) => emitElevator(action),
    get state() {
      return getState();
    },
  };

  window.elevator = remote;
  return () => {
    if (window.elevator === remote) delete window.elevator;
  };
}
