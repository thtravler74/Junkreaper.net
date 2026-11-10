import { blackman } from "./fft";

/**
 * Windowed-sinc resampler (band-limited, 32 taps, 128 sub-phases). Quality is
 * ample for feature extraction; it is not meant as a mastering-grade SRC.
 */
export function resample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  const half = 16;
  const phases = 128;
  // Cutoff at the lower Nyquist, expressed in cycles per *input* sample.
  const cutoff = 0.5 * Math.min(1, 1 / ratio) * 0.92;
  const taps = half * 2;
  const win = blackman(taps * phases + 1);
  const table = new Float32Array(phases * taps);
  for (let p = 0; p < phases; p++) {
    const frac = p / phases;
    let sum = 0;
    for (let t = 0; t < taps; t++) {
      const x = t - half + 1 - frac; // distance from the interpolation point
      const s = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      const wIdx = Math.round(((x + half) / (2 * half)) * (win.length - 1));
      const v = s * (win[Math.min(win.length - 1, Math.max(0, wIdx))] ?? 0);
      table[p * taps + t] = v;
      sum += v;
    }
    for (let t = 0; t < taps; t++) table[p * taps + t] = table[p * taps + t]! / sum;
  }
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const base = Math.floor(pos);
    const frac = pos - base;
    const p = Math.min(phases - 1, Math.floor(frac * phases));
    const row = p * taps;
    let acc = 0;
    for (let t = 0; t < taps; t++) {
      const idx = base - half + 1 + t;
      if (idx >= 0 && idx < input.length) acc += input[idx]! * table[row + t]!;
    }
    out[i] = acc;
  }
  return out;
}

export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const n = channels[0]!.length;
  const out = new Float32Array(n);
  const g = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] = out[i]! + ch[i]! * g;
  return out;
}
