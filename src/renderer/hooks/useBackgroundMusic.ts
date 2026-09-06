import { useCallback, useEffect, useRef, useState } from 'react';

export interface BackgroundMusic {
  /** The element is playing right now. */
  playing: boolean;
  /** Autoplay was refused; a user gesture is required before it will start. */
  blocked: boolean;
  /** The file could not be loaded - usually "no mp3 dropped into assets/audio yet". */
  missing: boolean;
  ready: boolean;
  volume: number;
  muted: boolean;
  toggle(): void;
  setVolume(next: number): void;
  setMuted(next: boolean): void;
}

const STORAGE_KEY = 'junkreaper.music';
const FADE_MS = 900;

interface Persisted {
  volume: number;
  muted: boolean;
}

function readPersisted(): Persisted {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { volume: 0.35, muted: false };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 0.35,
      muted: parsed.muted === true,
    };
  } catch {
    // Private mode, or storage disabled entirely.
    return { volume: 0.35, muted: false };
  }
}

/**
 * The lobby music.
 *
 * A plain `HTMLAudioElement` created in JS rather than an `<audio>` tag, because it
 * is a singleton that has to survive re-renders, and nothing about it is visual.
 *
 * Two browser realities shape this hook:
 *
 *  - **Autoplay policy.** Chromium refuses `play()` until the origin has a user
 *    gesture or sufficient media-engagement score. The refusal is a rejected
 *    promise, not an exception, and it must not be treated as an error: we surface
 *    it as `blocked` and let the UI offer a play button. A one-shot document-level
 *    gesture listener then retries.
 *  - **A missing file is normal.** Background music is a user-supplied asset that
 *    this repository deliberately does not commit, so a 404 resolves to `missing`
 *    and a helpful hint rather than a console error.
 */
export function useBackgroundMusic(source: string, autoPlay = true): BackgroundMusic {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef = useRef<number | null>(null);
  const persisted = useRef<Persisted>(readPersisted());

  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [missing, setMissing] = useState(false);
  const [ready, setReady] = useState(false);
  const [volume, setVolumeState] = useState(persisted.current.volume);
  const [muted, setMutedState] = useState(persisted.current.muted);

  // --- element lifecycle ----------------------------------------------------
  useEffect(() => {
    const audio = new Audio();
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audio.muted = persisted.current.muted;
    audio.src = source;
    audioRef.current = audio;

    const onCanPlay = (): void => {
      setReady(true);
      setMissing(false);
    };
    const onPlaying = (): void => {
      setPlaying(true);
      setBlocked(false);
    };
    const onPause = (): void => setPlaying(false);
    const onError = (): void => {
      setMissing(true);
      setReady(false);
      setPlaying(false);
    };

    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.load();

    return () => {
      if (fadeRef.current !== null) window.clearInterval(fadeRef.current);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.pause();
      // Releases the network/decoder resources; leaving the src attached keeps a
      // detached element buffering forever in Chromium.
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
    };
  }, [source]);

  // --- volume, with a short fade so the music does not slam in ---------------
  const fadeTo = useCallback((target: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (fadeRef.current !== null) window.clearInterval(fadeRef.current);

    const from = audio.volume;
    const started = performance.now();
    fadeRef.current = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / FADE_MS);
      audio.volume = from + (target - from) * progress;
      if (progress === 1 && fadeRef.current !== null) {
        window.clearInterval(fadeRef.current);
        fadeRef.current = null;
      }
    }, 40);
  }, []);

  const persist = useCallback((next: Persisted) => {
    persisted.current = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not worth surfacing: the session simply will not remember the setting.
    }
  }, []);

  const setVolume = useCallback(
    (next: number) => {
      const clamped = Math.min(1, Math.max(0, next));
      setVolumeState(clamped);
      persist({ volume: clamped, muted: persisted.current.muted });
      const audio = audioRef.current;
      if (!audio) return;
      if (fadeRef.current !== null) {
        window.clearInterval(fadeRef.current);
        fadeRef.current = null;
      }
      audio.volume = clamped;
    },
    [persist],
  );

  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(next);
      persist({ volume: persisted.current.volume, muted: next });
      if (audioRef.current) audioRef.current.muted = next;
    },
    [persist],
  );

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || missing) return;
    try {
      await audio.play();
      setBlocked(false);
      fadeTo(persisted.current.volume);
    } catch (error) {
      // NotAllowedError is the autoplay policy; anything else is a real failure.
      if (error instanceof DOMException && error.name === 'NotAllowedError') setBlocked(true);
      else setMissing(true);
    }
  }, [fadeTo, missing]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void play();
    else audio.pause();
  }, [play]);

  // --- autoplay attempt, then retry behind the first user gesture ------------
  useEffect(() => {
    if (!autoPlay || !ready || missing) return;
    void play();
  }, [autoPlay, ready, missing, play]);

  useEffect(() => {
    if (!blocked) return;
    const retry = (): void => void play();
    const options = { once: true } as const;
    document.addEventListener('pointerdown', retry, options);
    document.addEventListener('keydown', retry, options);
    return () => {
      document.removeEventListener('pointerdown', retry);
      document.removeEventListener('keydown', retry);
    };
  }, [blocked, play]);

  return { playing, blocked, missing, ready, volume, muted, toggle, setVolume, setMuted };
}
