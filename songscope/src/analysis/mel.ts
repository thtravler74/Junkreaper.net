import type { Spectrogram } from "./stft";

export const hzToMel = (f: number): number => 2595 * Math.log10(1 + f / 700);
export const melToHz = (m: number): number => 700 * (10 ** (m / 2595) - 1);

export interface Filterbank {
  nBands: number;
  /** For each band: first bin index and the triangular weights. */
  start: Int32Array;
  weights: Float32Array[];
  centerHz: Float32Array;
}

export function melFilterbank(sampleRate: number, fftSize: number, nBands: number, fmin = 20, fmax = sampleRate / 2): Filterbank {
  const bins = fftSize / 2 + 1;
  const mels = new Float64Array(nBands + 2);
  const lo = hzToMel(fmin), hi = hzToMel(fmax);
  for (let i = 0; i < nBands + 2; i++) mels[i] = lo + ((hi - lo) * i) / (nBands + 1);
  const edges = Array.from(mels, melToHz);
  const start = new Int32Array(nBands);
  const weights: Float32Array[] = [];
  const centerHz = new Float32Array(nBands);
  const binHz = sampleRate / fftSize;
  for (let b = 0; b < nBands; b++) {
    const f0 = edges[b]!, f1 = edges[b + 1]!, f2 = edges[b + 2]!;
    centerHz[b] = f1;
    const k0 = Math.max(0, Math.floor(f0 / binHz));
    const k2 = Math.min(bins - 1, Math.ceil(f2 / binHz));
    start[b] = k0;
    const w = new Float32Array(k2 - k0 + 1);
    let sum = 0;
    for (let k = k0; k <= k2; k++) {
      const f = k * binHz;
      let v = 0;
      if (f >= f0 && f <= f1 && f1 > f0) v = (f - f0) / (f1 - f0);
      else if (f > f1 && f <= f2 && f2 > f1) v = (f2 - f) / (f2 - f1);
      w[k - k0] = v;
      sum += v;
    }
    if (sum > 0) for (let i = 0; i < w.length; i++) w[i] = w[i]! / sum; // area normalisation
    weights.push(w);
  }
  return { nBands, start, weights, centerHz };
}

/** Apply a filterbank to a power spectrum row. */
export function applyFilterbank(fb: Filterbank, power: Float32Array, out: Float32Array): void {
  for (let b = 0; b < fb.nBands; b++) {
    const w = fb.weights[b]!, s = fb.start[b]!;
    let acc = 0;
    for (let i = 0; i < w.length; i++) acc += w[i]! * (power[s + i] ?? 0);
    out[b] = acc;
  }
}

/** Mel power spectrogram in dB (flat frames × bands) from a magnitude spectrogram. */
export function melSpectrogramDb(spec: Spectrogram, fb: Filterbank): Float32Array {
  const out = new Float32Array(spec.frames * fb.nBands);
  const power = new Float32Array(spec.bins);
  const band = new Float32Array(fb.nBands);
  for (let f = 0; f < spec.frames; f++) {
    const row = spec.row(f);
    for (let k = 0; k < spec.bins; k++) power[k] = row[k]! * row[k]!;
    applyFilterbank(fb, power, band);
    for (let b = 0; b < fb.nBands; b++) out[f * fb.nBands + b] = 10 * Math.log10(band[b]! + 1e-10);
  }
  return out;
}

/** DCT-II (orthonormal) matrix for MFCC extraction. */
export function dctMatrix(nIn: number, nOut: number): Float32Array {
  const m = new Float32Array(nOut * nIn);
  for (let k = 0; k < nOut; k++) {
    const scale = k === 0 ? Math.sqrt(1 / nIn) : Math.sqrt(2 / nIn);
    for (let n = 0; n < nIn; n++) m[k * nIn + n] = scale * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * nIn));
  }
  return m;
}

/** MFCCs (frames × nCoeffs) from a dB mel spectrogram. */
export function mfcc(melDb: Float32Array, nBands: number, nCoeffs: number): Float32Array {
  const frames = melDb.length / nBands;
  const dct = dctMatrix(nBands, nCoeffs);
  const out = new Float32Array(frames * nCoeffs);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < nCoeffs; k++) {
      let acc = 0;
      for (let n = 0; n < nBands; n++) acc += dct[k * nBands + n]! * melDb[f * nBands + n]!;
      out[f * nCoeffs + k] = acc;
    }
  }
  return out;
}
