/**
 * Headless driver for the exact same background service the desktop app runs.
 *
 *   npm run sessions:probe -- --only github,linear --headed
 *
 * It exists for two reasons: you can debug session restoration without launching
 * Electron (no display required, which makes it usable over SSH and in CI), and it
 * proves the architectural claim that the orchestrator is UI-agnostic - it reduces
 * the very same `ElevatorAction` stream the React app does, just into ASCII.
 */
import process from 'node:process';
import {
  createElevatorState,
  elevatorReducer,
  formatFloor,
  type ElevatorAction,
  type ElevatorState,
} from '../shared/elevator.ts';
import type { SessionsSnapshot } from '../shared/ipc.ts';
import type { LogLevel, SessionPhase } from '../shared/types.ts';
import { cliStateRoot, createServices } from '../main/services/bootstrap.ts';

interface Args {
  headed: boolean;
  verbose: boolean;
  help: boolean;
  only: string[];
  concurrency?: number;
  config?: string;
  home?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { headed: false, verbose: false, help: false, only: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--headed':
        args.headed = true;
        break;
      case '--verbose':
      case '-v':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--only':
        args.only = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        i += 1;
        break;
      case '--concurrency':
        args.concurrency = Number.parseInt(value ?? '', 10) || undefined;
        i += 1;
        break;
      case '--config':
        args.config = value;
        i += 1;
        break;
      case '--home':
        args.home = value;
        i += 1;
        break;
      default:
        if (flag?.startsWith('-')) {
          console.error(`unknown flag: ${flag}`);
          process.exit(2);
        }
    }
  }
  return args;
}

const USAGE = `junkreaper sessions probe

  --only <a,b>        restore only these target ids
  --headed            run Chromium with a visible window
  --concurrency <n>   contexts to restore at once (default: config value)
  --config <path>     explicit sessions config file
  --home <dir>        state root for profiles and cookie jars
  -v, --verbose       debug-level logging
  -h, --help          this text
`;

const PHASE_GLYPH: Record<SessionPhase, string> = {
  pending: '.',
  launching: 'o',
  restoring: 'o',
  navigating: 'o',
  verifying: 'o',
  ready: '#',
  failed: 'x',
  stopped: '-',
};

function renderShaft(state: ElevatorState): string {
  if (state.total_floors === 0) return '   (no floors)';
  const lines: string[] = [];
  for (let floor = state.total_floors; floor >= 0; floor -= 1) {
    const here = floor === state.current_floor;
    const arrival = state.arrivals.find((entry) => entry.floor === floor);
    const car = here ? (state.doors === 'open' ? '[| |]' : '[###]') : '     ';
    const plaque = floor === 0 ? 'Lobby' : (arrival?.label ?? '');
    lines.push(`  ${formatFloor(floor).padStart(2)} |${car}| ${plaque}`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const logLevel: LogLevel = args.verbose ? 'debug' : 'info';
  const services = await createServices({
    stateRoot: args.home ?? cliStateRoot(),
    explicitConfigPath: args.config,
    logLevel,
  });

  let elevator = createElevatorState();
  services.orchestrator.onElevator((action: ElevatorAction) => {
    elevator = elevatorReducer(elevator, action);
    // The CLI has no animation to wait for, so it settles the car immediately.
    if (elevator.moving) elevator = elevatorReducer(elevator, { type: 'settle' });
    if (action.type === 'advance') {
      console.log(`\n  ^ floor ${elevator.current_floor}/${elevator.total_floors} - ${action.arrival?.label ?? ''}`);
    }
  });

  const finished = new Promise<SessionsSnapshot>((resolve) => {
    services.orchestrator.onSnapshot((snapshot) => {
      if (!snapshot.running && snapshot.summary?.finishedAt) resolve(snapshot);
    });
  });

  services.orchestrator.start({
    headless: !args.headed,
    ...(args.concurrency !== undefined ? { concurrency: args.concurrency } : {}),
    only: args.only,
  });

  const snapshot = await finished;

  console.log(`\n${renderShaft(elevator)}\n`);
  console.log(`  ${elevator.status_message}\n`);

  for (const record of snapshot.records) {
    const glyph = PHASE_GLYPH[record.phase];
    const floor = record.floor ? ` (floor ${record.floor})` : '';
    const detail = record.error ? ` - ${record.error}` : record.result ? ` - ${record.result.finalUrl}` : '';
    console.log(`  ${glyph} ${record.target.id.padEnd(18)} ${record.phase}${floor}${detail}`);
  }

  await services.orchestrator.dispose();

  const failed = snapshot.summary?.failed ?? 0;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
