import type { JSX } from 'react';
import type { BackgroundMusic } from '../hooks/useBackgroundMusic.ts';

/**
 * Transport for the background music. The hook owns the `HTMLAudioElement`; this
 * component only reflects it, and explains the two states people actually hit:
 * the browser blocking autoplay, and no music file being present yet.
 */
export function AudioPlayer({ music }: { music: BackgroundMusic }): JSX.Element {
  const hint = music.missing
    ? 'drop an mp3 at assets/audio/elevator-music.mp3'
    : music.blocked
      ? 'click anywhere to start playback'
      : music.playing
        ? 'lobby music playing'
        : 'lobby music paused';

  return (
    <div className="audio" data-missing={music.missing || undefined}>
      <button
        type="button"
        className="audio__toggle"
        onClick={music.toggle}
        disabled={music.missing}
        aria-label={music.playing ? 'Pause background music' : 'Play background music'}
      >
        {music.playing ? String.fromCharCode(0x23f8) : String.fromCharCode(0x25b6)}
      </button>

      <button
        type="button"
        className="audio__mute"
        onClick={() => music.setMuted(!music.muted)}
        disabled={music.missing}
        aria-label={music.muted ? 'Unmute' : 'Mute'}
      >
        {music.muted ? 'muted' : 'sound'}
      </button>

      <input
        className="audio__volume"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={music.volume}
        disabled={music.missing}
        onChange={(event) => music.setVolume(Number(event.target.value))}
        aria-label="Background music volume"
      />

      <span className="audio__hint">{hint}</span>
    </div>
  );
}
