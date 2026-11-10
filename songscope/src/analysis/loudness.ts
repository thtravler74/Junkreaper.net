import { blackman } from "./fft";

/**
 * ITU-R BS.1770-4 / EBU R128 loudness: K-weighting, gated integrated loudness,
 * momentary and short-term loudness, loudness range (EBU Tech 3342), sample
 * peak and 4× oversampled true peak.
 */

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

function highShelf(fs: number): Biquad {
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

function highPass(fs: number): Biquad {
  const f0 = 38.13547087602444, Q = 0.5003270373238773;
  const K = Math.tan((Math.PI * f0) / fs);
  const a0 = 1 + K / Q + K * K;
  return { b0: 1 / a0, b1: -2 / a0, b2: 1 / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
}

function applyBiquad(x: Float32Array, c: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

export function kWeight(x: Float32Array, fs: number): Float32Array {
  return applyBiquad(applyBiquad(x, highShelf(fs)), highPass(fs));
}

export interface LoudnessResult {
  integratedLufs: number;
  momentaryMaxLufs: number;
  shortTermMaxLufs: number;
  shortTermMinLufs: number;
  loudnessRangeLu: number;
  samplePeakDbfs: number;
  truePeakDbtp: number;
  /** Peak-to-loudness ratio: true peak minus integrated loudness. */
  plr: number;
  /** Peak-to-short-term ratio at the loudest short-term window. */
  psr: number;
  /** Momentary loudness curve, 100 ms hop, for display. */
  momentary: { time: number; lufs: number }[];
  shortTerm: { time: number; lufs: number }[];
  gatedBlockShare: number; // fraction of blocks that passed both gates
  dcOffset: number[];
  clippedSamples: number;
  clippedRuns: number;
  rmsDbfs: number;
  crestFactorDb: number;
  noiseFloorDbfs: number;
  /** Approximation of the "DR" dynamic-range meter value. */
  drValue: number;
}

function blockLoudness(ms: number[]): number {
  let sum = 0;
  for (const v of ms) sum += v; // channel weights are 1 for L/R (surround would be 1.41)
  return -0.691 + 10 * Math.log10(sum + 1e-20);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** 4× oversampling polyphase FIR true-peak estimate (dBTP). */
export function truePeak(channels: Float32Array[], fs: number): number {
  const factor = fs >= 96000 ? 1 : fs >= 88200 ? 2 : 4;
  if (factor === 1) {
    let p = 0; for (const ch of channels) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]!));
    return 20 * Math.log10(p + 1e-12);
  }
  const tapsPerPhase = 12;
  const total = tapsPerPhase * factor;
  const win = blackman(total);
  const phases: Float64Array[] = [];
  for (let p = 0; p < factor; p++) {
    const h = new Float64Array(tapsPerPhase);
    let sum = 0;
    for (let t = 0; t < tapsPerPhase; t++) {
      const n = t * factor + p; // index in the prototype filter
      const x = (n - (total - 1) / 2) / factor;
      const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      h[t] = s * win[n]!;
      sum += h[t]!;
    }
    phases.push(h);
    void sum;
  }
  // Normalise prototype gain so a DC input stays at unity across phases.
  let dc = 0; for (const h of phases) for (let t = 0; t < tapsPerPhase; t++) dc += h[t]!;
  const g = factor / dc;
  // Inter-sample peaks can only exceed the sample peak by a modest margin, so the
  // interpolator only needs to run around samples within 6 dB of the sample peak.
  let samplePeak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]!); if (a > samplePeak) samplePeak = a; }
  const gate = samplePeak * 0.5;
  let peak = samplePeak;
  for (const ch of channels) {
    const n = ch.length;
    for (let i = 0; i < n; i++) {
      if (Math.abs(ch[i]!) < gate && Math.abs(ch[i - 1] ?? 0) < gate && Math.abs(ch[i + 1] ?? 0) < gate) continue;
      for (let p = 0; p < factor; p++) {
        const h = phases[p]!;
        let acc = 0;
        for (let t = 0; t < tapsPerPhase; t++) {
          const idx = i - t + (tapsPerPhase >> 1);
          if (idx >= 0 && idx < n) acc += ch[idx]! * h[t]!;
        }
        const v = Math.abs(acc * g);
        if (v > peak) peak = v;
      }
    }
  }
  return 20 * Math.log10(peak + 1e-12);
}

export function measureLoudness(channels: Float32Array[], fs: number, onProgress?: (f: number) => void): LoudnessResult {
  const n = channels[0]!.length;
  const weighted = channels.map((c) => kWeight(c, fs));
  onProgress?.(0.3);
  // 400 ms blocks with 75 % overlap (100 ms hop)
  const blockLen = Math.round(0.4 * fs), hop = Math.round(0.1 * fs);
  const nBlocks = Math.max(0, Math.floor((n - blockLen) / hop) + 1);
  const blockMs: number[][] = [];
  const momentary: { time: number; lufs: number }[] = [];
  // Running sums via prefix sums of squares per channel for speed.
  const prefix = weighted.map((w) => {
    const p = new Float64Array(w.length + 1);
    for (let i = 0; i < w.length; i++) p[i + 1] = p[i]! + w[i]! * w[i]!;
    return p;
  });
  const msAt = (chIdx: number, start: number, len: number): number => {
    const p = prefix[chIdx]!;
    const e = Math.min(n, start + len);
    return (p[e]! - p[start]!) / Math.max(1, e - start);
  };
  for (let b = 0; b < nBlocks; b++) {
    const start = b * hop;
    const ms = channels.map((_, c) => msAt(c, start, blockLen));
    blockMs.push(ms);
    momentary.push({ time: (start + blockLen / 2) / fs, lufs: blockLoudness(ms) });
  }
  onProgress?.(0.6);
  // Gating
  const absGate = -70;
  const above = blockMs.filter((ms) => blockLoudness(ms) > absGate);
  const meanMs = (list: number[][]): number[] => {
    const acc = new Array<number>(channels.length).fill(0);
    for (const ms of list) ms.forEach((v, i) => (acc[i] = acc[i]! + v));
    return acc.map((v) => v / Math.max(1, list.length));
  };
  let integrated = -Infinity, gatedShare = 0;
  if (above.length) {
    const relGate = blockLoudness(meanMs(above)) - 10;
    const gated = above.filter((ms) => blockLoudness(ms) > relGate);
    if (gated.length) { integrated = blockLoudness(meanMs(gated)); gatedShare = gated.length / nBlocks; }
  }
  // Short-term: 3 s windows, 100 ms hop
  const stLen = Math.round(3 * fs);
  const shortTerm: { time: number; lufs: number }[] = [];
  const nSt = Math.max(0, Math.floor((n - stLen) / hop) + 1);
  for (let b = 0; b < nSt; b++) {
    const start = b * hop;
    const ms = channels.map((_, c) => msAt(c, start, stLen));
    shortTerm.push({ time: (start + stLen / 2) / fs, lufs: blockLoudness(ms) });
  }
  if (!shortTerm.length && n > 0) {
    shortTerm.push({ time: n / fs / 2, lufs: blockLoudness(channels.map((_, c) => msAt(c, 0, n))) });
  }
  // LRA (EBU Tech 3342): short-term values, absolute gate -70, relative gate -20 LU, 10th–95th percentile
  const stAbove = shortTerm.map((s) => s.lufs).filter((l) => l > absGate);
  let lra = 0;
  if (stAbove.length) {
    const powerMean = 10 * Math.log10(stAbove.reduce((a, l) => a + 10 ** (l / 10), 0) / stAbove.length);
    const rel = stAbove.filter((l) => l > powerMean - 20).sort((a, b) => a - b);
    if (rel.length >= 2) lra = percentile(rel, 0.95) - percentile(rel, 0.1);
  }
  onProgress?.(0.75);
  // Peaks, DC, clipping, RMS, crest, noise floor
  let samplePeak = 0, sumSq = 0, clipped = 0, clippedRuns = 0;
  const dcOffset: number[] = [];
  for (const ch of channels) {
    let dc = 0, run = 0;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i]!, a = Math.abs(v);
      if (a > samplePeak) samplePeak = a;
      sumSq += v * v;
      dc += v;
      if (a >= 0.999) { clipped++; run++; } else { if (run >= 3) clippedRuns++; run = 0; }
    }
    if (run >= 3) clippedRuns++;
    dcOffset.push(dc / Math.max(1, ch.length));
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n * channels.length));
  const rmsDb = 20 * Math.log10(rms + 1e-12);
  const samplePeakDb = 20 * Math.log10(samplePeak + 1e-12);
  // Noise floor: 5th percentile of 50 ms RMS frames (unweighted, excluding digital silence)
  const nfLen = Math.round(0.05 * fs);
  const frameRms: number[] = [];
  const mono = channels[0]!;
  for (let s = 0; s + nfLen <= n; s += nfLen) {
    let acc = 0;
    for (let i = s; i < s + nfLen; i++) acc += mono[i]! * mono[i]!;
    const r = Math.sqrt(acc / nfLen);
    if (r > 1e-6) frameRms.push(20 * Math.log10(r));
  }
  frameRms.sort((a, b) => a - b);
  const noiseFloor = frameRms.length ? percentile(frameRms, 0.05) : -Infinity;
  // DR approximation: peak (2nd highest 3 s-block peak) minus RMS of the loudest 20 % of 3 s blocks.
  const drBlocks: { rms: number; peak: number }[] = [];
  const drLen = Math.round(3 * fs);
  for (let s = 0; s + drLen <= n; s += drLen) {
    let acc = 0, pk = 0;
    for (const ch of channels) for (let i = s; i < s + drLen; i++) { const v = ch[i]!; acc += v * v; const a = Math.abs(v); if (a > pk) pk = a; }
    drBlocks.push({ rms: Math.sqrt(acc / (drLen * channels.length)), peak: pk });
  }
  let drValue = 0;
  if (drBlocks.length >= 2) {
    const byRms = [...drBlocks].sort((a, b) => b.rms - a.rms);
    const top = byRms.slice(0, Math.max(1, Math.round(byRms.length * 0.2)));
    const topRms = Math.sqrt(top.reduce((a, b) => a + b.rms * b.rms, 0) / top.length);
    const peaks = drBlocks.map((b) => b.peak).sort((a, b) => b - a);
    const pk2 = peaks[1] ?? peaks[0]!;
    drValue = 20 * Math.log10((pk2 + 1e-12) / (topRms + 1e-12)) - 3; // −3 dB: sine RMS convention
  }
  const tp = truePeak(channels, fs);
  onProgress?.(1);
  const stMax = shortTerm.length ? Math.max(...shortTerm.map((s) => s.lufs)) : integrated;
  const stMin = stAbove.length ? Math.min(...stAbove) : integrated;
  return {
    integratedLufs: integrated,
    momentaryMaxLufs: momentary.length ? Math.max(...momentary.map((m) => m.lufs)) : integrated,
    shortTermMaxLufs: stMax,
    shortTermMinLufs: stMin,
    loudnessRangeLu: lra,
    samplePeakDbfs: samplePeakDb,
    truePeakDbtp: tp,
    plr: tp - integrated,
    psr: tp - stMax,
    momentary: momentary.filter((_, i) => i % 2 === 0),
    shortTerm: shortTerm.filter((_, i) => i % 5 === 0),
    gatedBlockShare: gatedShare,
    dcOffset,
    clippedSamples: clipped,
    clippedRuns,
    rmsDbfs: rmsDb,
    crestFactorDb: samplePeakDb - rmsDb,
    noiseFloorDbfs: noiseFloor,
    drValue,
  };
}
