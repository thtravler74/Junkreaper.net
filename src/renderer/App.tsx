import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { AudioPlayer } from './components/AudioPlayer.tsx';
import { ControlBar } from './components/ControlBar.tsx';
import { ElevatorShaft } from './components/ElevatorShaft.tsx';
import { FloorCounter } from './components/FloorCounter.tsx';
import { LogStrip } from './components/LogStrip.tsx';
import { SessionList } from './components/SessionList.tsx';
import { StatusBanner } from './components/StatusBanner.tsx';
import { useArrivalChime } from './hooks/useArrivalChime.ts';
import { useBackgroundMusic } from './hooks/useBackgroundMusic.ts';
import { useElevator } from './hooks/useElevator.ts';
import { useSessions } from './hooks/useSessions.ts';
import { emitElevator } from './lib/elevatorBus.ts';

/**
 * Served from `assets/` (Vite's `publicDir`), so the same relative URL resolves
 * under the dev server and under the packaged `app://` origin. Override with
 * `VITE_MUSIC_URL` to point at a different track.
 */
const MUSIC_SRC: string = import.meta.env.VITE_MUSIC_URL ?? './audio/elevator-music.mp3';

export function App(): JSX.Element {
  const { state, rideMs } = useElevator();
  const sessions = useSessions();
  const music = useBackgroundMusic(MUSIC_SRC);
  const chime = useArrivalChime(!music.muted);
  const [headless, setHeadless] = useState(true);

  useEffect(() => {
    if (sessions.appInfo) setHeadless(sessions.appInfo.headlessDefault);
  }, [sessions.appInfo]);

  // Ring on arrival - once the car has actually stopped, not when it sets off.
  const lastChimedFloor = useRef(0);
  useEffect(() => {
    if (state.moving || state.current_floor === lastChimedFloor.current) return;
    lastChimedFloor.current = state.current_floor;
    if (state.current_floor > 0) chime();
  }, [state.moving, state.current_floor, chime]);

  const readyCount = useMemo(
    () => sessions.snapshot.records.filter((record) => record.phase === 'ready').length,
    [sessions.snapshot.records],
  );

  const onStart = useCallback(() => void sessions.start({ headless }), [sessions, headless]);
  const onStop = useCallback(() => void sessions.stop(), [sessions]);

  // The manual controls deliberately travel the *public* path - the same DOM event
  // a background task would fire - rather than reaching into the reducer directly.
  const onAdvance = useCallback(
    () => emitElevator({ type: 'advance', arrival: { label: 'Manual override' } }),
    [],
  );
  const onReset = useCallback(() => emitElevator({ type: 'reset' }), []);

  const info = sessions.appInfo;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div className="brand__text">
            <h1>Junkreaper</h1>
            <p>session elevator</p>
          </div>
          {info?.demo ? <span className="brand__badge">demo mode</span> : null}
        </div>

        <StatusBanner state={state} />
        <AudioPlayer music={music} />
      </header>

      <main className="stage">
        <section className="stage__shaft" aria-label="Elevator">
          <ElevatorShaft state={state} rideMs={rideMs} />
        </section>

        <section className="stage__panel">
          <FloorCounter state={state} />

          <ControlBar
            running={sessions.snapshot.running}
            busy={sessions.busy}
            canAdvance={state.current_floor < state.total_floors}
            headless={headless}
            onHeadlessChange={setHeadless}
            onStart={onStart}
            onStop={onStop}
            onAdvance={onAdvance}
            onReset={onReset}
          />

          <div className="panel__section panel__section--sessions">
            <h2>
              Accounts
              <span className="panel__count">
                {readyCount}/{sessions.snapshot.records.length} online
              </span>
            </h2>
            <SessionList records={sessions.snapshot.records} onOpenProfile={sessions.openProfileDir} />
          </div>

          <div className="panel__section panel__section--log">
            <h2>Background service</h2>
            <LogStrip entries={sessions.logs} />
          </div>
        </section>
      </main>

      <footer className="statusbar">
        {info ? (
          <>
            <span title="Sessions config in use">{info.configPath}</span>
            <span title="Chromium profile directory">{info.profileRoot}</span>
            <span>
              v{info.appVersion}
              {info.demo ? '' : ` · electron ${info.versions.electron} · chromium ${info.versions.chrome}`}
            </span>
          </>
        ) : (
          <span>connecting to the background service...</span>
        )}
      </footer>
    </div>
  );
}
