/**
 * Onset strength envelope: half-wave-rectified spectral flux on a dB mel
 * spectrogram, detrended by a local mean. Plus a simple adaptive peak picker.
 */
export function onsetStrength(melDb: Float32Array, nBands: number, lag = 1): Float32Array {
  const frames = melDb.length / nBands;
  const env = new Float32Array(frames);
  for (let f = lag; f < frames; f++) {
    let acc = 0;
    for (let b = 0; b < nBands; b++) {
      const d = melDb[f * nBands + b]! - melDb[(f - lag) * nBands + b]!;
      if (d > 0) acc += d;
    }
    env[f] = acc / nBands;
  }
  // Detrend: subtract a running mean over ~1 s (assumes ~43 fps; caller may rescale).
  const win = 43;
  const out = new Float32Array(frames);
  let sum = 0;
  const q: number[] = [];
  for (let f = 0; f < frames; f++) {
    q.push(env[f]!); sum += env[f]!;
    if (q.length > win) sum -= q.shift()!;
    const mean = sum / q.length;
    out[f] = Math.max(0, env[f]! - mean);
  }
  return out;
}

export interface Peak { index: number; value: number }

/** Peaks above (local mean + delta) with a minimum spacing. */
export function pickPeaks(env: Float32Array, opts: { minDistance: number; preMax: number; postMax: number; preAvg: number; postAvg: number; delta: number }): Peak[] {
  const peaks: Peak[] = [];
  let last = -Infinity;
  for (let i = 0; i < env.length; i++) {
    const v = env[i]!;
    if (v <= 0) continue;
    let isMax = true;
    for (let j = Math.max(0, i - opts.preMax); j <= Math.min(env.length - 1, i + opts.postMax); j++) if (env[j]! > v) { isMax = false; break; }
    if (!isMax) continue;
    let s = 0, n = 0;
    for (let j = Math.max(0, i - opts.preAvg); j <= Math.min(env.length - 1, i + opts.postAvg); j++) { s += env[j]!; n++; }
    if (v < s / n + opts.delta) continue;
    if (i - last < opts.minDistance) {
      if (peaks.length && v > peaks[peaks.length - 1]!.value) { peaks[peaks.length - 1] = { index: i, value: v }; last = i; }
      continue;
    }
    peaks.push({ index: i, value: v });
    last = i;
  }
  return peaks;
}
