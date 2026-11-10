import type { Spectrogram } from "./stft";

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;
export const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function hzToMidi(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}
export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}
export function midiToName(m: number): string {
  const r = Math.round(m);
  return `${NOTE_NAMES_SHARP[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}

/**
 * Estimate the tuning deviation of the recording in semitone fractions
 * (-0.5 .. 0.5) from the fractional parts of interpolated spectral peaks,
 * weighted by magnitude. 0 means A4 = 440 Hz.
 */
export function estimateTuning(spec: Spectrogram, fmin = 80, fmax = 2500): { deviation: number; a4Hz: number; confidence: number } {
  const bins = 100;
  const hist = new Float64Array(bins);
  const kMin = Math.max(2, Math.floor((fmin * spec.fftSize) / spec.sampleRate));
  const kMax = Math.min(spec.bins - 2, Math.ceil((fmax * spec.fftSize) / spec.sampleRate));
  const step = Math.max(1, Math.floor(spec.frames / 1500));
  for (let f = 0; f < spec.frames; f += step) {
    const row = spec.row(f);
    let max = 0;
    for (let k = kMin; k <= kMax; k++) if (row[k]! > max) max = row[k]!;
    const thr = max * 0.1;
    if (max <= 0) continue;
    for (let k = kMin; k <= kMax; k++) {
      const m = row[k]!;
      if (m < thr || m <= row[k - 1]! || m < row[k + 1]!) continue;
      // Parabolic interpolation of the peak location.
      const a = Math.log(row[k - 1]! + 1e-12), b = Math.log(m + 1e-12), c = Math.log(row[k + 1]! + 1e-12);
      const denom = a - 2 * b + c;
      const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      const freq = ((k + delta) * spec.sampleRate) / spec.fftSize;
      const midi = hzToMidi(freq);
      let frac = midi - Math.round(midi); // -0.5..0.5
      if (frac >= 0.5) frac -= 1;
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((frac + 0.5) * bins)));
      hist[idx] = hist[idx]! + m;
    }
  }
  let best = 0, total = 0;
  // circular smoothing over 3 bins
  const sm = new Float64Array(bins);
  for (let i = 0; i < bins; i++) {
    sm[i] = hist[(i + bins - 1) % bins]! + hist[i]! + hist[(i + 1) % bins]!;
    total += hist[i]!;
    if (sm[i]! > sm[best]!) best = i;
  }
  const deviation = (best + 0.5) / bins - 0.5;
  const confidence = total > 0 ? sm[best]! / (total * 3 / bins) / 10 : 0; // ~1 when peaked, ~0.1 flat
  return { deviation, a4Hz: 440 * 2 ** (deviation / 12), confidence: Math.min(1, confidence) };
}

export interface ChromaMapping {
  pitchClass: Int8Array; // -1 for ignored bins
  weight: Float32Array;
}

/**
 * Bin → pitch-class mapping with a Gaussian penalty for bins far from a semitone
 * centre and a broad log-frequency weighting centred near C4 (as in librosa's
 * `octwidth`). `tuning` shifts the semitone grid.
 */
export function chromaMapping(spec: Spectrogram, tuning = 0, fmin = 55, fmax = 4200): ChromaMapping {
  const pitchClass = new Int8Array(spec.bins).fill(-1);
  const weight = new Float32Array(spec.bins);
  const binSemitones = 12 * Math.log2((spec.sampleRate / spec.fftSize) / 440); // not used directly
  void binSemitones;
  for (let k = 1; k < spec.bins; k++) {
    const f = spec.binFreq(k);
    if (f < fmin || f > fmax) continue;
    const midi = hzToMidi(f) - tuning;
    const nearest = Math.round(midi);
    const dist = midi - nearest;
    // Bin width in semitones grows at low frequencies; widen the Gaussian there.
    const widthSemis = 12 * Math.log2((f + spec.sampleRate / spec.fftSize) / f);
    const sigma = Math.max(0.15, Math.min(0.5, widthSemis * 0.6));
    const g = Math.exp(-0.5 * (dist / sigma) ** 2);
    const oct = Math.log2(f / 261.63); // octaves from C4
    const octW = Math.exp(-0.5 * (oct / 2.0) ** 2);
    pitchClass[k] = ((nearest % 12) + 12) % 12;
    weight[k] = g * octW;
  }
  return { pitchClass, weight };
}

/** Accumulate one magnitude row into a 12-bin chroma vector (energy domain). */
export function chromaOfRow(row: Float32Array, map: ChromaMapping, out: Float32Array): void {
  out.fill(0);
  for (let k = 0; k < row.length; k++) {
    const pc = map.pitchClass[k]!;
    if (pc < 0) continue;
    out[pc] = out[pc]! + row[k]! * row[k]! * map.weight[k]!;
  }
}

export function normalizeL1(v: Float32Array | Float64Array): void {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += Math.abs(v[i]!);
  if (s > 0) for (let i = 0; i < v.length; i++) v[i] = v[i]! / s;
}
