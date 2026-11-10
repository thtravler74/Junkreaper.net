import type { Spectrogram } from "./stft";

/**
 * Median-filtering harmonic/percussive source separation (Fitzgerald 2010),
 * streamed frame by frame so we never materialise the two separated
 * spectrograms. For every frame the callback receives the harmonic and
 * percussive magnitude rows.
 */
export interface HpssOptions {
  timeKernel?: number; // frames (odd)
  freqKernel?: number; // bins (odd)
  power?: number;
  maxBin?: number;
  onProgress?: (fraction: number) => void;
}

function medianOf(buf: Float32Array, n: number): number {
  // insertion sort of a small buffer
  for (let i = 1; i < n; i++) {
    const v = buf[i]!;
    let j = i - 1;
    while (j >= 0 && buf[j]! > v) { buf[j + 1] = buf[j]!; j--; }
    buf[j + 1] = v;
  }
  return buf[n >> 1]!;
}

export function hpssStream(
  spec: Spectrogram,
  onFrame: (frame: number, harmonic: Float32Array, percussive: Float32Array) => void,
  opts: HpssOptions = {},
): void {
  const tk = opts.timeKernel ?? 17, fk = opts.freqKernel ?? 17, p = opts.power ?? 2;
  const bins = Math.min(spec.bins, opts.maxBin ?? spec.bins);
  const th = tk >> 1, fh = fk >> 1;
  const harm = new Float32Array(bins), perc = new Float32Array(bins);
  const buf = new Float32Array(Math.max(tk, fk));
  const hMed = new Float32Array(bins), pMed = new Float32Array(bins);
  for (let f = 0; f < spec.frames; f++) {
    const row = spec.row(f);
    // time median per bin
    const f0 = Math.max(0, f - th), f1 = Math.min(spec.frames - 1, f + th);
    const nT = f1 - f0 + 1;
    for (let k = 0; k < bins; k++) {
      for (let t = f0; t <= f1; t++) buf[t - f0] = spec.data[t * spec.bins + k]!;
      hMed[k] = medianOf(buf, nT);
    }
    // frequency median per bin
    for (let k = 0; k < bins; k++) {
      const k0 = Math.max(0, k - fh), k1 = Math.min(bins - 1, k + fh);
      for (let j = k0; j <= k1; j++) buf[j - k0] = row[j]!;
      pMed[k] = medianOf(buf, k1 - k0 + 1);
    }
    for (let k = 0; k < bins; k++) {
      const h = hMed[k]! ** p, q = pMed[k]! ** p;
      const denom = h + q + 1e-12;
      harm[k] = row[k]! * (h / denom);
      perc[k] = row[k]! * (q / denom);
    }
    onFrame(f, harm, perc);
    if (opts.onProgress && (f & 127) === 0) opts.onProgress(f / spec.frames);
  }
}
