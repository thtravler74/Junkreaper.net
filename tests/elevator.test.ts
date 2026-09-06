import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createElevatorState,
  elevatorReducer,
  formatFloor,
  rideDurationMs,
  rideProgress,
  type ElevatorAction,
  type ElevatorState,
} from '../src/shared/elevator.ts';

/** Applies a script of actions, which is how both the UI and the CLI consume them. */
function run(actions: ElevatorAction[], initial = createElevatorState()): ElevatorState {
  return actions.reduce(elevatorReducer, initial);
}

describe('elevatorReducer', () => {
  it('starts in the lobby with the doors open', () => {
    const state = createElevatorState();
    assert.equal(state.current_floor, 0);
    assert.equal(state.total_floors, 0);
    assert.equal(state.doors, 'open');
    assert.equal(state.moving, false);
  });

  it('configure sets the height of the building and returns to the lobby', () => {
    const state = run([{ type: 'goto', floor: 2 }, { type: 'configure', total_floors: 5 }], createElevatorState(3));
    assert.equal(state.total_floors, 5);
    assert.equal(state.current_floor, 0);
    assert.deepEqual(state.arrivals, []);
    assert.equal(state.doors, 'closed');
  });

  it('advance climbs one floor and records the arrival', () => {
    const state = run([
      { type: 'configure', total_floors: 3 },
      { type: 'advance', arrival: { sessionId: 'crm', label: 'CRM', detail: 'crm.example.com', at: 1000 } },
    ]);

    assert.equal(state.current_floor, 1);
    assert.equal(state.direction, 'up');
    assert.equal(state.moving, true);
    assert.equal(state.doors, 'closed');
    assert.deepEqual(state.arrivals, [
      { floor: 1, at: 1000, label: 'CRM', sessionId: 'crm', detail: 'crm.example.com' },
    ]);
  });

  it('refuses to climb past the top floor', () => {
    const state = run([
      { type: 'configure', total_floors: 2 },
      { type: 'advance' },
      { type: 'settle' },
      { type: 'advance' },
      { type: 'settle' },
      { type: 'advance' },
    ]);

    assert.equal(state.current_floor, 2);
    assert.equal(state.arrivals.length, 2, 'a refused advance must not record an arrival');
  });

  it('a refused advance still carries an explicit status message through', () => {
    const before = run([{ type: 'configure', total_floors: 1 }, { type: 'advance' }, { type: 'settle' }]);
    const after = elevatorReducer(before, { type: 'advance', status_message: 'nothing left to restore' });
    assert.equal(after.status_message, 'nothing left to restore');
    assert.equal(after.current_floor, 1);
  });

  it('settle stops the car, opens the doors and announces the penthouse', () => {
    const state = run([{ type: 'configure', total_floors: 1 }, { type: 'advance' }, { type: 'settle' }]);
    assert.equal(state.moving, false);
    assert.equal(state.direction, 'idle');
    assert.equal(state.doors, 'open');
    assert.equal(state.rideMs, 0);
    assert.match(state.status_message, /Penthouse/);
  });

  it('settle below the top keeps whatever the last status said', () => {
    const state = run([
      { type: 'configure', total_floors: 4 },
      { type: 'advance', status_message: 'Billing online' },
      { type: 'settle' },
    ]);
    assert.equal(state.status_message, 'Billing online');
  });

  it('goto clamps into range and derives the direction', () => {
    const up = run([{ type: 'configure', total_floors: 6 }, { type: 'goto', floor: 99 }]);
    assert.equal(up.current_floor, 6);
    assert.equal(up.direction, 'up');

    const down = elevatorReducer(up, { type: 'goto', floor: -4 });
    assert.equal(down.current_floor, 0);
    assert.equal(down.direction, 'down');
  });

  it('goto to the current floor is a no-op unless it carries a message', () => {
    const base = run([{ type: 'configure', total_floors: 3 }]);
    assert.equal(elevatorReducer(base, { type: 'goto', floor: 0 }), base, 'identical state must be returned by reference');
    assert.equal(elevatorReducer(base, { type: 'goto', floor: 0, status_message: 'held' }).status_message, 'held');
  });

  it('derives the ride duration from the distance travelled', () => {
    const oneFloor = run([{ type: 'configure', total_floors: 9 }, { type: 'advance' }]);
    const sixFloors = run([{ type: 'configure', total_floors: 9 }, { type: 'goto', floor: 6 }]);

    assert.equal(oneFloor.rideMs, rideDurationMs(0, 1));
    assert.ok(sixFloors.rideMs > oneFloor.rideMs, 'a longer hop must take longer');
    assert.ok(sixFloors.rideMs < oneFloor.rideMs * 6, 'but sub-linearly, so tall buildings stay watchable');
  });

  it('reset returns to the lobby without shrinking the building', () => {
    const state = run([
      { type: 'configure', total_floors: 4 },
      { type: 'advance' },
      { type: 'settle' },
      { type: 'reset' },
    ]);
    assert.equal(state.current_floor, 0);
    assert.equal(state.total_floors, 4);
    assert.deepEqual(state.arrivals, []);
  });

  it('bumps the revision on every accepted action', () => {
    const start = createElevatorState();
    const end = run([{ type: 'configure', total_floors: 2 }, { type: 'status', status_message: 'x' }, { type: 'doors', doors: 'closed' }], start);
    assert.equal(end.revision, start.revision + 3);
  });

  it('never mutates the state it was handed', () => {
    const before = run([{ type: 'configure', total_floors: 2 }]);
    const snapshot = structuredClone(before);
    elevatorReducer(before, { type: 'advance', arrival: { label: 'CRM' } });
    assert.deepEqual(before, snapshot);
  });
});

describe('helpers', () => {
  it('formats the lobby as L', () => {
    assert.equal(formatFloor(0), 'L');
    assert.equal(formatFloor(-3), 'L');
    assert.equal(formatFloor(12), '12');
  });

  it('reports ride progress as a 0..1 fraction and survives an empty building', () => {
    assert.equal(rideProgress(createElevatorState(0)), 0);
    assert.equal(rideProgress({ ...createElevatorState(4), current_floor: 1 }), 0.25);
  });

  it('a zero-distance hop takes no time', () => {
    assert.equal(rideDurationMs(3, 3), 0);
  });
});
