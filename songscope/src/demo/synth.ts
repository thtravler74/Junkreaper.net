/**
 * Deterministic synthetic "songs" with known ground truth, used by the unit tests
 * and the end-to-end run. Everything is additive synthesis + noise bursts, so the
 * tests do not need audio fixtures in the repository.
 */
export interface SynthOptions {
  sampleRate?: number;
  bpm?: number;
  /** Chord roots as MIDI note numbers with quality, cycled per bar. */
  chords?: { root: number; minor: boolean }[];
  bars?: number;
  drums?: boolean;
  stereo?: boolean;
  gainDb?: number;
  seed?: number;
  /** Beats per bar for the drum pattern and chord changes (default 4). */
  beatsPerBar?: number;
  /** Add a simple lead melody with vibrato on top of the chords. */
  melody?: boolean;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

export function synthSong(opts: SynthOptions = {}): { channels: Float32Array[]; sampleRate: number; durationSec: number } {
  const sr = opts.sampleRate ?? 44100;
  const bpm = opts.bpm ?? 120;
  const chords = opts.chords ?? [{ root: 60, minor: false }, { root: 67, minor: false }, { root: 57, minor: true }, { root: 65, minor: false }];
  const bars = opts.bars ?? 16;
  const beat = 60 / bpm;
  const bpb = opts.beatsPerBar ?? 4;
  const barLen = beat * bpb;
  const total = Math.round(bars * barLen * sr);
  const L = new Float32Array(total), R = new Float32Array(total);
  const rand = rng(opts.seed ?? 42);
  const gain = 10 ** ((opts.gainDb ?? -12) / 20);
  for (let bar = 0; bar < bars; bar++) {
    const ch = chords[bar % chords.length]!;
    const notes = [ch.root, ch.root + (ch.minor ? 3 : 4), ch.root + 7, ch.root - 12];
    const s0 = Math.round(bar * barLen * sr), s1 = Math.min(total, Math.round((bar + 1) * barLen * sr));
    for (const n of notes) {
      const f = midiHz(n);
      const pan = ((n * 7) % 5) / 4; // 0..1
      for (let i = s0; i < s1; i++) {
        const t = (i - s0) / sr;
        const env = Math.min(1, t * 20) * Math.exp(-t * 0.6);
        // a few harmonics for a plucked/organ-like tone
        const v = (Math.sin(2 * Math.PI * f * (i / sr)) + 0.5 * Math.sin(2 * Math.PI * 2 * f * (i / sr)) + 0.25 * Math.sin(2 * Math.PI * 3 * f * (i / sr))) * env * 0.12;
        L[i] = L[i]! + v * (1 - pan * 0.5);
        R[i] = R[i]! + v * (0.5 + pan * 0.5);
      }
    }
  }
  if (opts.drums ?? true) {
    const nBeats = Math.floor(bars * bpb);
    for (let b = 0; b < nBeats; b++) {
      const t0 = b * beat;
      const s0 = Math.round(t0 * sr);
      const inBar = b % bpb;
      // kick on 1 (and 3 in 4/4), snare on the other beats, hats on every eighth
      if (inBar === 0 || (bpb === 4 && inBar === 2)) {
        for (let i = 0; i < Math.round(0.12 * sr); i++) {
          const t = i / sr;
          const v = Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-t * 40)) * t) * Math.exp(-t * 25) * (inBar === 0 ? 0.9 : 0.7);
          if (s0 + i < total) { L[s0 + i] = L[s0 + i]! + v; R[s0 + i] = R[s0 + i]! + v; }
        }
      }
      if (inBar !== 0 && !(bpb === 4 && inBar === 2)) {
        for (let i = 0; i < Math.round(0.15 * sr); i++) {
          const t = i / sr;
          const v = (rand() * 2 - 1) * Math.exp(-t * 30) * 0.5 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 40) * 0.3;
          if (s0 + i < total) { L[s0 + i] = L[s0 + i]! + v; R[s0 + i] = R[s0 + i]! + v; }
        }
      }
      for (const off of [0, 0.5]) {
        const h0 = Math.round((t0 + off * beat) * sr);
        for (let i = 0; i < Math.round(0.04 * sr); i++) {
          const t = i / sr;
          const v = (rand() * 2 - 1) * Math.exp(-t * 120) * 0.15;
          if (h0 + i < total) { L[h0 + i] = L[h0 + i]! + v * 0.7; R[h0 + i] = R[h0 + i]! + v * 1.0; }
        }
      }
    }
  }
  if (opts.melody) {
    // one note per beat, stepping through the chord tones an octave up, with 5.5 Hz vibrato
    // a lead that phrases within the bar: two notes per bar (on beats 1 and 3), stepping
    // through chord tones in a vocal register (E4–B5)
    const positions: [number, number][] = bpb === 3 ? [[0, 1.8], [2, 0.9]] : [[0, 1.8], [2, 1.8]];
    let nIdx = 0;
    for (let bar = 0; bar < bars; bar++) for (const [pos, len] of positions) {
      const b = bar * bpb + pos;
      const ch = chords[bar % chords.length]!;
      const tones = [ch.root + 12, ch.root + (ch.minor ? 3 : 4) + 12, ch.root + 7, ch.root + 14];
      const f = midiHz(tones[nIdx++ % tones.length]!);
      const s0 = Math.round(b * beat * sr), s1 = Math.min(total, Math.round((b + len) * beat * sr));
      let phase = 0;
      for (let i = s0; i < s1; i++) {
        const t = (i - s0) / sr;
        const vib = 1 + 0.02 * Math.sin(2 * Math.PI * 5.5 * t); // ±35 cents, a natural singing vibrato
        phase += (2 * Math.PI * f * vib) / sr;
        const env = Math.min(1, t * 40) * Math.exp(-t * 0.8);
        const v = (Math.sin(phase) + 0.4 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase)) * env * 0.26; // a lead mixed ~5 dB above a single pad voice
        L[i] = L[i]! + v; R[i] = R[i]! + v;
      }
    }
  }
  for (let i = 0; i < total; i++) { L[i] = Math.tanh(L[i]! * gain * 4) * 0.9; R[i] = Math.tanh(R[i]! * gain * 4) * 0.9; }
  return { channels: opts.stereo === false ? [L] : [L, R], sampleRate: sr, durationSec: total / sr };
}

/** Concatenate several synth results into one (same sample rate). */
export function concatAudio(parts: { channels: Float32Array[]; sampleRate: number }[]): { channels: Float32Array[]; sampleRate: number; durationSec: number } {
  const sr = parts[0]!.sampleRate;
  const nCh = parts[0]!.channels.length;
  const total = parts.reduce((a, p) => a + p.channels[0]!.length, 0);
  const channels = Array.from({ length: nCh }, () => new Float32Array(total));
  let off = 0;
  for (const p of parts) { for (let c = 0; c < nCh; c++) channels[c]!.set(p.channels[c]!, off); off += p.channels[0]!.length; }
  return { channels, sampleRate: sr, durationSec: total / sr };
}

/** A pop-shaped arrangement: quiet intro, verse, louder chorus, verse, chorus, outro. */
export function synthArrangement(bpm = 120, sr = 44100, melody = false): { channels: Float32Array[]; sampleRate: number; durationSec: number } {
  const verse = [{ root: 60, minor: false }, { root: 67, minor: false }, { root: 57, minor: true }, { root: 65, minor: false }];
  const chorus = [{ root: 65, minor: false }, { root: 67, minor: false }, { root: 60, minor: false }, { root: 57, minor: true }];
  return concatAudio([
    synthSong({ sampleRate: sr, bpm, chords: verse, bars: 4, drums: false, gainDb: -20, seed: 1 }),
    synthSong({ sampleRate: sr, bpm, chords: verse, bars: 8, gainDb: -14, seed: 2, melody }),
    synthSong({ sampleRate: sr, bpm, chords: chorus, bars: 8, gainDb: -8, seed: 3, melody }),
    synthSong({ sampleRate: sr, bpm, chords: verse, bars: 8, gainDb: -14, seed: 4, melody }),
    synthSong({ sampleRate: sr, bpm, chords: chorus, bars: 8, gainDb: -8, seed: 5, melody }),
    synthSong({ sampleRate: sr, bpm, chords: verse, bars: 4, drums: false, gainDb: -20, seed: 6 }),
  ]);
}

/** Pure sine, for loudness calibration tests. */
export function sine(freq: number, seconds: number, amplitude: number, sr = 48000): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

/** Minimal 16-bit PCM WAV encoder. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const nCh = channels.length, n = channels[0]!.length;
  const bytes = 44 + n * nCh * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, bytes - 8, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * nCh * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nCh; c++) { const s = Math.max(-1, Math.min(1, channels[c]![i]!)); v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2; }
  return new Uint8Array(buf);
}
