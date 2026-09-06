import { useMemo, type CSSProperties, type JSX } from 'react';
import { formatFloor, type ElevatorState, type FloorArrival } from '../../shared/elevator.ts';
import { ElevatorCar } from './ElevatorCar.tsx';

export interface ElevatorShaftProps {
  state: ElevatorState;
  rideMs: number;
}

/**
 * The building.
 *
 * The car is fixed in the viewport and the *building* slides: translating the floor
 * stack down by `current_floor * --floor-height` brings the target floor into the
 * car's window, which is both how a real shaft looks from inside and far cheaper to
 * animate than moving the car and scrolling the container.
 *
 * That transform is the only animated property (plus a compositor-friendly blur
 * while travelling), so the whole ride stays on the GPU.
 *
 * Purely decorative: the floor number, the status text and the session list carry
 * all of the same information for assistive technology.
 */
export function ElevatorShaft({ state, rideMs }: ElevatorShaftProps): JSX.Element {
  const floors = useMemo(() => {
    const list: number[] = [];
    for (let floor = state.total_floors; floor >= 0; floor -= 1) list.push(floor);
    return list;
  }, [state.total_floors]);

  const arrivals = useMemo(
    () => new Map(state.arrivals.map((arrival) => [arrival.floor, arrival] as const)),
    [state.arrivals],
  );

  return (
    <div
      className="shaft"
      data-moving={state.moving || undefined}
      aria-hidden="true"
      style={{ '--floor-count': state.total_floors } as CSSProperties}
    >
      <div className="shaft__skyline" />
      <div className="shaft__rail shaft__rail--left" />
      <div className="shaft__rail shaft__rail--right" />

      <div
        className="building"
        style={{ '--current-floor': state.current_floor, '--ride-ms': `${rideMs}ms` } as CSSProperties}
      >
        <div className="building__roof" />
        {floors.map((floor) => (
          <FloorRow
            key={floor}
            floor={floor}
            current={state.current_floor}
            arrival={arrivals.get(floor)}
          />
        ))}
        <div className="building__base" />
      </div>

      <div className="shaft__cable" />
      <ElevatorCar state={state} arrival={arrivals.get(state.current_floor)} />
      <div className="shaft__vignette" />
    </div>
  );
}

interface FloorRowProps {
  floor: number;
  current: number;
  arrival: FloorArrival | undefined;
}

function FloorRow({ floor, current, arrival }: FloorRowProps): JSX.Element {
  const lit = floor <= current;
  const plaque = arrival?.label ?? (floor === 0 ? 'Lobby' : 'Vacant');

  return (
    <div
      className="floor"
      data-lit={lit || undefined}
      data-current={floor === current || undefined}
      data-lobby={floor === 0 || undefined}
    >
      <div className="floor__slab" />
      <div className="floor__body">
        <span className="floor__number">{formatFloor(floor)}</span>
        <div className="floor__windows">
          {Array.from({ length: 7 }, (_, index) => (
            <span key={index} className="floor__window" style={{ '--index': index } as CSSProperties} />
          ))}
        </div>
        <span className="floor__plaque">
          {plaque}
          {arrival?.detail ? <em className="floor__host">{arrival.detail}</em> : null}
        </span>
      </div>
    </div>
  );
}
