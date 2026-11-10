import { SpectrumAnalyzer } from "./fft";
import type { Spectrogram } from "./stft";

export interface FrameSpectralFeatures {
  centroid: Float32Array; // Hz
  bandwidth: Float32Array; // Hz (spectral spread)
  rolloff85: Float32Array;
  rolloff95: Float32Array;
  flatness: Float32Array; // 0..1
  entropy: Float32Array; // normalised 0..1
  flux: Float32Array;
  rmsDb: Float32Array;
  zcr: Float32Array; // crossings per second
}

export function frameFeatures(spec: Spectrogram, signal: Float32Array): FrameSpectralFeatures {
  const F = spec.frames, B = spec.bins;
  const out: FrameSpectralFeatures = {
    centroid: new Float32Array(F), bandwidth: new Float32Array(F), rolloff85: new Float32Array(F), rolloff95: new Float32Array(F),
    flatness: new Float32Array(F), entropy: new Float32Array(F), flux: new Float32Array(F), rmsDb: new Float32Array(F), zcr: new Float32Array(F),
  };
  const freqs = new Float32Array(B);
  for (let k = 0; k < B; k++) freqs[k] = spec.binFreq(k);
  let prev: Float32Array | null = null;
  const logB = Math.log(B);
  for (let f = 0; f < F; f++) {
    const row = spec.row(f);
    let sumP = 0, sumFP = 0, sumLog = 0, nz = 0;
    for (let k = 1; k < B; k++) { const p = row[k]! * row[k]!; sumP += p; sumFP += freqs[k]! * p; if (p > 1e-20) { sumLog += Math.log(p); nz++; } }
    const centroid = sumP > 0 ? sumFP / sumP : 0;
    out.centroid[f] = centroid;
    let sumVar = 0, ent = 0;
    for (let k = 1; k < B; k++) { const p = row[k]! * row[k]!; const d = freqs[k]! - centroid; sumVar += d * d * p; if (p > 0 && sumP > 0) { const q = p / sumP; ent -= q * Math.log(q); } }
    out.bandwidth[f] = sumP > 0 ? Math.sqrt(sumVar / sumP) : 0;
    out.entropy[f] = ent / logB;
    const geo = nz ? Math.exp(sumLog / nz) : 0;
    const arith = sumP / Math.max(1, B - 1);
    out.flatness[f] = arith > 0 ? Math.min(1, geo / arith) : 0;
    let acc = 0, r85 = 0, r95 = 0;
    for (let k = 1; k < B; k++) { acc += row[k]! * row[k]!; if (!r85 && acc >= 0.85 * sumP) r85 = freqs[k]!; if (!r95 && acc >= 0.95 * sumP) { r95 = freqs[k]!; break; } }
    out.rolloff85[f] = r85; out.rolloff95[f] = r95;
    if (prev) { let fl = 0; for (let k = 1; k < B; k++) { const d = row[k]! - prev[k]!; if (d > 0) fl += d * d; } out.flux[f] = Math.sqrt(fl); }
    prev = row;
    // time-domain RMS and ZCR over the frame span
    const s0 = Math.max(0, f * spec.hop - spec.fftSize / 2), s1 = Math.min(signal.length, s0 + spec.fftSize);
    let e = 0, zc = 0;
    for (let i = s0; i < s1; i++) { const v = signal[i]!; e += v * v; if (i > s0 && (v >= 0) !== (signal[i - 1]! >= 0)) zc++; }
    const len = Math.max(1, s1 - s0);
    out.rmsDb[f] = 10 * Math.log10(e / len + 1e-12);
    out.zcr[f] = (zc / len) * spec.sampleRate;
  }
  return out;
}

export interface BandEnergy { name: string; lowHz: number; highHz: number; db: number; share: number }

export const BANDS: { name: string; lowHz: number; highHz: number }[] = [
  { name: "Sub-bass", lowHz: 20, highHz: 60 },
  { name: "Bass", lowHz: 60, highHz: 250 },
  { name: "Low mids", lowHz: 250, highHz: 500 },
  { name: "Mids", lowHz: 500, highHz: 2000 },
  { name: "Upper mids", lowHz: 2000, highHz: 4000 },
  { name: "Presence", lowHz: 4000, highHz: 6000 },
  { name: "Brilliance", lowHz: 6000, highHz: 20000 },
];

export interface LongTermSpectrum {
  /** Frequency (Hz) and level (dB, relative to the maximum) per 1/6-octave band. */
  bands: { hz: number; db: number }[];
  bandEnergies: BandEnergy[];
  /** Spectral tilt in dB/octave fitted between 100 Hz and 10 kHz. */
  tiltDbPerOctave: number;
  /** Highest frequency with meaningful content; a sharp cliff hints at a lossy source. */
  effectiveBandwidthHz: number;
  cliffDetected: boolean;
  nyquistHz: number;
  /** Prominent narrow peaks (e.g. hum at 50/60 Hz, resonances). */
  peaks: { hz: number; prominenceDb: number }[];
  meanCentroidHz: number;
}

/** Long-term average spectrum at the original sample rate, sampling every Nth frame. */
export function longTermSpectrum(mono: Float32Array, sampleRate: number, fftSize = 8192): LongTermSpectrum {
  const an = new SpectrumAnalyzer(fftSize);
  const bins = an.bins;
  const acc = new Float64Array(bins);
  const row = new Float32Array(bins);
  const hop = fftSize / 2;
  const frames = Math.max(1, Math.floor((mono.length - fftSize) / hop));
  const step = Math.max(1, Math.floor(frames / 600));
  let count = 0;
  for (let f = 0; f < frames; f += step) {
    an.magnitudes(mono, f * hop, row);
    // skip near-silent frames
    let e = 0; for (let k = 1; k < bins; k++) e += row[k]! * row[k]!;
    if (e < 1e-9) continue;
    for (let k = 0; k < bins; k++) acc[k] = acc[k]! + row[k]! * row[k]!;
    count++;
  }
  const binHz = sampleRate / fftSize;
  for (let k = 0; k < bins; k++) acc[k] = acc[k]! / Math.max(1, count);
  // 1/6-octave bands from 20 Hz to Nyquist
  const bands: { hz: number; db: number }[] = [];
  let maxDb = -Infinity;
  for (let f = 20; f < sampleRate / 2; f *= 2 ** (1 / 6)) {
    const k0 = Math.max(1, Math.floor((f / 2 ** (1 / 12)) / binHz)), k1 = Math.min(bins - 1, Math.ceil((f * 2 ** (1 / 12)) / binHz));
    let s = 0, n = 0;
    for (let k = k0; k <= k1; k++) { s += acc[k]!; n++; }
    const db = 10 * Math.log10(s / Math.max(1, n) + 1e-20);
    bands.push({ hz: f, db });
    if (db > maxDb) maxDb = db;
  }
  for (const b of bands) b.db -= maxDb;
  // Band energies
  let total = 0;
  for (let k = 1; k < bins; k++) total += acc[k]!;
  const bandEnergies: BandEnergy[] = BANDS.map((b) => {
    const k0 = Math.max(1, Math.floor(b.lowHz / binHz)), k1 = Math.min(bins - 1, Math.floor(b.highHz / binHz));
    let s = 0; for (let k = k0; k <= k1; k++) s += acc[k]!;
    return { ...b, db: 10 * Math.log10(s + 1e-20), share: total > 0 ? s / total : 0 };
  });
  // Tilt: least-squares fit of dB vs log2(f) over 100 Hz..10 kHz
  const pts = bands.filter((b) => b.hz >= 100 && b.hz <= Math.min(10000, sampleRate / 2 - 500));
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { const x = Math.log2(p.hz); sx += x; sy += p.db; sxx += x * x; sxy += x * p.db; }
  const nP = pts.length;
  const tilt = nP > 1 ? (nP * sxy - sx * sy) / (nP * sxx - sx * sx) : 0;
  // Effective bandwidth: the highest 1/6-octave band within 50 dB of the loudest band, and
  // cliff detection: a drop of > 20 dB between adjacent bands above 10 kHz followed by nothing.
  let effective = bands[bands.length - 1]!.hz;
  for (let i = bands.length - 1; i >= 0; i--) { if (bands[i]!.db > -55) { effective = bands[i]!.hz; break; } }
  let cliff = false;
  for (let i = 1; i < bands.length; i++) {
    const b = bands[i]!, a = bands[i - 1]!;
    if (b.hz > 9000 && a.db - b.db > 18 && a.db > -45) {
      const after = bands.slice(i);
      if (after.every((x) => x.db < a.db - 15)) { cliff = true; effective = a.hz; break; }
    }
  }
  // Narrow peaks: compare each bin to the median of its neighbourhood (±2 % of frequency), below 1 kHz.
  const peaks: { hz: number; prominenceDb: number }[] = [];
  for (let k = Math.ceil(30 / binHz); k < Math.floor(1000 / binHz); k++) {
    const w = Math.max(3, Math.round(k * 0.08));
    const neigh: number[] = [];
    for (let j = Math.max(1, k - w); j <= Math.min(bins - 1, k + w); j++) if (Math.abs(j - k) > 1) neigh.push(acc[j]!);
    neigh.sort((a, b) => a - b);
    const med = neigh[neigh.length >> 1]!;
    const prom = 10 * Math.log10((acc[k]! + 1e-20) / (med + 1e-20));
    if (prom > 15 && acc[k]! > acc[k - 1]! && acc[k]! >= acc[k + 1]!) peaks.push({ hz: k * binHz, prominenceDb: prom });
  }
  peaks.sort((a, b) => b.prominenceDb - a.prominenceDb);
  let cSum = 0, pSum = 0;
  for (let k = 1; k < bins; k++) { cSum += k * binHz * acc[k]!; pSum += acc[k]!; }
  return { bands, bandEnergies, tiltDbPerOctave: tilt, effectiveBandwidthHz: effective, cliffDetected: cliff, nyquistHz: sampleRate / 2, peaks: peaks.slice(0, 4), meanCentroidHz: pSum > 0 ? cSum / pSum : 0 };
}

export function mean(v: ArrayLike<number>): number { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]!; return v.length ? s / v.length : 0; }
export function std(v: ArrayLike<number>): number { const m = mean(v); let s = 0; for (let i = 0; i < v.length; i++) s += (v[i]! - m) ** 2; return v.length ? Math.sqrt(s / v.length) : 0; }
export function median(v: ArrayLike<number>): number { const a = Array.from(v as ArrayLike<number>).sort((x, y) => x - y); return a.length ? a[a.length >> 1]! : 0; }
export function percentileOf(v: ArrayLike<number>, p: number): number { const a = Array.from(v as ArrayLike<number>).sort((x, y) => x - y); if (!a.length) return 0; const i = (a.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return a[lo]! + (a[hi]! - a[lo]!) * (i - lo); }
