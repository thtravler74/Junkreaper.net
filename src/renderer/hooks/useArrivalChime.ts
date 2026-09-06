import { useCallback, useEffect, useRef } from 'react';

/**
 * The arrival "ding".
 *
 * Synthesised with the Web Audio API rather than shipped as a file, so the app has
 * exactly one binary asset to think about (the background music, which the user
 * supplies). Two decaying triangle tones a fourth apart is the classic elevator
 * chime; an exponential gain ramp avoids the click a hard stop would produce.
 *
 * An `AudioContext` starts `suspended` until a user gesture, so `resume()` is
 * attempted on every ring and silently ignored if the browser still refuses.
 */
export function useArrivalChime(enabled = true, gain = 0.12): () => void {
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      void contextRef.current?.close().catch(() => {});
      contextRef.current = null;
    };
  }, []);

  return useCallback(() => {
    if (!enabled) return;

    try {
      contextRef.current ??= new AudioContext();
      const context = contextRef.current;
      if (context.state === 'suspended') void context.resume().catch(() => {});

      const now = context.currentTime;
      const master = context.createGain();
      master.gain.value = gain;
      master.connect(context.destination);

      // 880 Hz then 659.25 Hz: A5 falling to E5.
      for (const [index, frequency] of [880, 659.25].entries()) {
        const start = now + index * 0.34;
        const oscillator = context.createOscillator();
        const envelope = context.createGain();

        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(frequency, start);

        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(1, start + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.75);

        oscillator.connect(envelope).connect(master);
        oscillator.start(start);
        oscillator.stop(start + 0.8);
      }
    } catch {
      // No Web Audio (or the context was closed mid-teardown): the chime is
      // decoration, never a reason to break the ride.
    }
  }, [enabled, gain]);
}
