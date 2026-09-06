import type { JunkreaperApi } from '../shared/api.ts';
import type { ElevatorRemote } from './lib/elevatorBus.ts';

declare global {
  interface Window {
    /** Published by the sandboxed preload. Absent when the UI runs in a plain browser. */
    junkreaper?: JunkreaperApi;
    /** Imperative handle for background tasks and the devtools console. */
    elevator?: ElevatorRemote;
  }
}

export {};
