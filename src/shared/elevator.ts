/**
 * The elevator is a pure state machine. Nothing in this module touches React,
 * Electron, the DOM or Playwright — which is exactly why it is the piece under
 * unit test (`tests/elevator.test.ts`) and the piece the background service is
 * allowed to drive remotely.
 *
 * Floor 0 is the lobby. Floor N is awarded to the Nth session that comes online,
 * so `total_floors` is simply "how many accounts are we restoring".
 */

export type ElevatorDirection = 'up' | 'down' | 'idle';
export type DoorState = 'open' | 'closed';

export interface FloorArrival {
  floor: number;
  /** The `SessionTarget.id` that unlocked this floor, when there is one. */
  sessionId?: string;
  label: string;
  detail?: string;
  at: number;
}

export interface ElevatorState {
  current_floor: number;
  total_floors: number;
  status_message: string;
  direction: ElevatorDirection;
  doors: DoorState;
  /** Floors reached during this ride, oldest first. */
  arrivals: FloorArrival[];
  /** True between an `advance`/`goto` and the matching `settle`. */
  moving: boolean;
  /**
   * How long the current hop should take, in ms. Computed by the reducer from the
   * distance travelled, so the CSS transition duration and the settle timer are
   * derived from one source of truth instead of being guessed twice.
   */
  rideMs: number;
  /** Bumped on every accepted action, so effects can key off it cheaply. */
  revision: number;
}

/**
 * The command surface. The renderer dispatches these locally, the main process
 * pushes them over IPC, and in-page background tasks fire them as DOM
 * CustomEvents — one vocabulary, three transports.
 */
export type ElevatorAction =
  /** Start a new ride: sets the height of the building and returns to the lobby. */
  | { type: 'configure'; total_floors: number; status_message?: string }
  /** Ride up exactly one floor. This is what a restored session triggers. */
  | { type: 'advance'; status_message?: string; arrival?: Omit<FloorArrival, 'floor' | 'at'> & { at?: number } }
  /** Jump to an absolute floor (clamped). */
  | { type: 'goto'; floor: number; status_message?: string }
  /** Update the indicator text without moving. */
  | { type: 'status'; status_message: string }
  /** Open/close the doors without moving. */
  | { type: 'doors'; doors: DoorState }
  /** The car finished its travel animation: stop, open up. */
  | { type: 'settle'; status_message?: string }
  /** Return to the lobby and forget the ride. */
  | { type: 'reset'; status_message?: string };

export const LOBBY_LABEL = 'L';

export function createElevatorState(total_floors = 0, status_message = 'Standing by in the lobby'): ElevatorState {
  return {
    current_floor: 0,
    total_floors: Math.max(0, Math.trunc(total_floors)),
    status_message,
    direction: 'idle',
    doors: 'open',
    arrivals: [],
    moving: false,
    rideMs: 0,
    revision: 0,
  };
}

function clampFloor(floor: number, total: number): number {
  if (!Number.isFinite(floor)) return 0;
  return Math.min(Math.max(0, Math.trunc(floor)), total);
}

export function elevatorReducer(state: ElevatorState, action: ElevatorAction): ElevatorState {
  const bump = (next: Partial<ElevatorState>): ElevatorState => ({
    ...state,
    ...next,
    revision: state.revision + 1,
  });

  switch (action.type) {
    case 'configure': {
      const total = Math.max(0, Math.trunc(action.total_floors));
      return bump({
        total_floors: total,
        current_floor: 0,
        direction: 'idle',
        doors: 'closed',
        arrivals: [],
        moving: false,
        rideMs: 0,
        status_message:
          action.status_message ??
          (total === 0 ? 'No sessions configured' : `Doors closing — ${total} ${total === 1 ? 'floor' : 'floors'} to climb`),
      });
    }

    case 'advance': {
      if (state.current_floor >= state.total_floors) {
        // Already at the top: acknowledge the message, refuse the move.
        return action.status_message ? bump({ status_message: action.status_message }) : state;
      }
      const floor = state.current_floor + 1;
      const arrival: FloorArrival = {
        floor,
        at: action.arrival?.at ?? Date.now(),
        label: action.arrival?.label ?? `Floor ${floor}`,
        ...(action.arrival?.sessionId !== undefined ? { sessionId: action.arrival.sessionId } : {}),
        ...(action.arrival?.detail !== undefined ? { detail: action.arrival.detail } : {}),
      };
      return bump({
        current_floor: floor,
        direction: 'up',
        doors: 'closed',
        moving: true,
        rideMs: rideDurationMs(state.current_floor, floor),
        arrivals: [...state.arrivals, arrival],
        status_message: action.status_message ?? `Ascending to ${formatFloor(floor)} — ${arrival.label}`,
      });
    }

    case 'goto': {
      const floor = clampFloor(action.floor, state.total_floors);
      if (floor === state.current_floor) {
        return action.status_message ? bump({ status_message: action.status_message }) : state;
      }
      const direction: ElevatorDirection = floor > state.current_floor ? 'up' : 'down';
      return bump({
        current_floor: floor,
        direction,
        doors: 'closed',
        moving: true,
        rideMs: rideDurationMs(state.current_floor, floor),
        status_message: action.status_message ?? `${direction === 'up' ? 'Ascending' : 'Descending'} to ${formatFloor(floor)}`,
      });
    }

    case 'status':
      return bump({ status_message: action.status_message });

    case 'doors':
      return bump({ doors: action.doors });

    case 'settle': {
      const atTop = state.current_floor > 0 && state.current_floor === state.total_floors;
      return bump({
        direction: 'idle',
        doors: 'open',
        moving: false,
        rideMs: 0,
        status_message:
          action.status_message ??
          (atTop
            ? `Penthouse — all ${state.total_floors} ${state.total_floors === 1 ? 'session' : 'sessions'} online`
            : state.status_message),
      });
    }

    case 'reset':
      return bump({
        current_floor: 0,
        direction: 'idle',
        doors: 'open',
        arrivals: [],
        moving: false,
        rideMs: 0,
        status_message: action.status_message ?? 'Standing by in the lobby',
      });

    default: {
      // Exhaustiveness guard: adding a variant without handling it is a type error.
      const never: never = action;
      void never;
      return state;
    }
  }
}

/** Lobby renders as `L`, everything else as its number. */
export function formatFloor(floor: number): string {
  return floor <= 0 ? LOBBY_LABEL : String(floor);
}

/** `0` at the lobby, `1` at the top — used to drive the shaft transform. */
export function rideProgress(state: ElevatorState): number {
  if (state.total_floors <= 0) return 0;
  return state.current_floor / state.total_floors;
}

/**
 * Travel time for the car, in ms. Longer hops take longer, but sub-linearly, so a
 * 12-floor jump does not stall the UI for a quarter of a minute.
 */
export function rideDurationMs(fromFloor: number, toFloor: number): number {
  const delta = Math.abs(toFloor - fromFloor);
  if (delta === 0) return 0;
  return Math.round(Math.min(2600, 900 + 380 * Math.sqrt(delta)));
}
