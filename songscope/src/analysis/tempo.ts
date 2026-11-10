import { autocorrelate } from "./fft";

export interface TempoEstimate {
  bpm: number;
  confidence: number; // 0..1
  candidates: { bpm: number; strength: number }[];
}

/** Log-normal tempo prior centred on `center` BPM with width `sigma` octaves. */
function prior(bpm: number, center = 115, sigma = 0.9): number {
  const x = Math.log2(bpm / center);
  return Math.exp(-0.5 * (x / sigma) ** 2);
}

/** Global tempo from the autocorrelation of the onset envelope (Ellis-style). */
export function estimateTempo(onset: Float32Array, fps: number, minBpm = 40, maxBpm = 220): TempoEstimate {
  const maxLag = Math.min(onset.length - 1, Math.ceil((60 / minBpm) * fps));
  const minLag = Math.max(1, Math.floor((60 / maxBpm) * fps));
  if (maxLag <= minLag + 2) return { bpm: 0, confidence: 0, candidates: [] };
  const ac = autocorrelate(onset, maxLag);
  const norm = ac[0]! || 1;
  const scored = new Float64Array(maxLag + 1);
  for (let l = minLag; l <= maxLag; l++) scored[l] = (ac[l]! / norm) * prior((60 * fps) / l);
  // Collect local maxima
  const cands: { lag: number; strength: number; raw: number }[] = [];
  for (let l = minLag + 1; l < maxLag; l++) {
    if (scored[l]! > scored[l - 1]! && scored[l]! >= scored[l + 1]!) {
      // parabolic refinement
      const a = scored[l - 1]!, b = scored[l]!, c = scored[l + 1]!;
      const d = a - 2 * b + c;
      const delta = d !== 0 ? (0.5 * (a - c)) / d : 0;
      cands.push({ lag: l + delta, strength: b, raw: ac[l]! / norm });
    }
  }
  cands.sort((x, y) => y.strength - x.strength);
  if (!cands.length) return { bpm: 0, confidence: 0, candidates: [] };
  let best = cands[0]!;
  // Octave decision: when the runner-up is a half/double of the winner and nearly as
  // strong, prefer the reading inside the common tactus range (90–160 BPM).
  const inRange = (b: number): boolean => b >= 90 && b <= 160;
  for (const other of cands.slice(1, 4)) {
    if (other.strength < best.strength * 0.88) continue;
    const b1 = (60 * fps) / best.lag, b2 = (60 * fps) / other.lag;
    const ratio = b2 / b1;
    const octave = Math.abs(ratio - 2) < 0.08 || Math.abs(ratio - 0.5) < 0.02;
    if (octave && !inRange(b1) && inRange(b2)) { best = other; break; }
  }
  const bpm = (60 * fps) / best.lag;
  // Confidence: how much the winner stands above the mean of the scored range.
  let mean = 0, n = 0;
  for (let l = minLag; l <= maxLag; l++) { mean += scored[l]!; n++; }
  mean /= n;
  const confidence = Math.max(0, Math.min(1, (best.strength - mean) / (best.strength + 1e-9)));
  return {
    bpm,
    confidence,
    candidates: cands.slice(0, 5).map((c) => ({ bpm: (60 * fps) / c.lag, strength: c.strength / best.strength })),
  };
}

/** Local tempo over sliding windows, octave-folded towards `reference` BPM. */
export function localTempi(onset: Float32Array, fps: number, reference: number, windowSec = 8, hopSec = 2): { time: number; bpm: number; confidence: number; activity: number }[] {
  const win = Math.round(windowSec * fps), hop = Math.round(hopSec * fps);
  const out: { time: number; bpm: number; confidence: number; activity: number }[] = [];
  if (onset.length < win) return out;
  let globalMean = 0; for (let i = 0; i < onset.length; i++) globalMean += onset[i]!; globalMean /= onset.length || 1;
  for (let s = 0; s + win <= onset.length; s += hop) {
    const seg = onset.subarray(s, s + win);
    let m = 0; for (let i = 0; i < seg.length; i++) m += seg[i]!; m /= seg.length;
    const t = estimateTempo(seg, fps, 40, 220);
    if (!t.bpm) continue;
    let b = t.bpm;
    // fold octaves (and triplet ratios) to the nearest simple ratio of the reference
    const ratios = [1, 2, 0.5, 4, 0.25, 3, 1 / 3, 1.5, 2 / 3];
    let best = b, bestErr = Infinity;
    for (const r of ratios) { const cand = b * r; const err = Math.abs(Math.log2(cand / reference)); if (err < bestErr) { bestErr = err; best = cand; } }
    b = best;
    out.push({ time: (s + win / 2) / fps, bpm: b, confidence: t.confidence, activity: globalMean > 0 ? m / globalMean : 0 });
  }
  return out;
}

/**
 * Beat tracking by dynamic programming (Ellis 2007): maximise onset strength at
 * beats while penalising deviations from the target period.
 */
export function trackBeats(onset: Float32Array, fps: number, bpm: number, tightness = 100): number[] {
  if (!bpm || onset.length < 4) return [];
  const period = (60 / bpm) * fps;
  const n = onset.length;
  // normalise envelope
  let mean = 0, sq = 0;
  for (let i = 0; i < n; i++) { mean += onset[i]!; }
  mean /= n;
  for (let i = 0; i < n; i++) { const d = onset[i]! - mean; sq += d * d; }
  const std = Math.sqrt(sq / n) || 1;
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) local[i] = (onset[i]! - mean) / std;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let i = 0; i < n; i++) {
    let best = -Infinity, arg = -1;
    for (let d = lo; d <= hi; d++) {
      const j = i - d;
      if (j < 0) break;
      const pen = -tightness * Math.log(d / period) ** 2;
      const v = score[j]! + pen;
      if (v > best) { best = v; arg = j; }
    }
    score[i] = local[i]! + (arg >= 0 ? best : 0);
    back[i] = arg;
  }
  // start from the best score in the final period
  let end = n - 1, bestV = -Infinity;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i]! > bestV) { bestV = score[i]!; end = i; }
  const beats: number[] = [];
  for (let i = end; i >= 0; i = back[i]!) { beats.push(i / fps); if (back[i]! < 0) break; }
  beats.reverse();
  // trim leading beats on near-silence
  return beats;
}

export interface MeterEstimate {
  beatsPerBar: 3 | 4 | 6 | 2 | 5 | 7;
  label: string;
  confidence: number;
  downbeatOffset: number; // index of the first downbeat in the beat array
  /** Normalised evidence for each candidate grouping, for the report. */
  alternatives: { beatsPerBar: number; score: number }[];
}

/**
 * Estimate meter from beat-synchronous accent and harmonic-change profiles:
 * compare the periodicity of accents at 2, 3, 4, 5, 6 and 7 beats.
 */
export function estimateMeter(beatAccent: Float32Array, beatChromaChange: Float32Array, beatAccentLow?: Float32Array, beatChordChange?: Float32Array): MeterEstimate {
  const n = beatAccent.length;
  if (n < 12) return { beatsPerBar: 4, label: "4/4", confidence: 0.2, downbeatOffset: 0, alternatives: [] };
  const z = (v: Float32Array): Float64Array => {
    let m = 0; for (let i = 0; i < v.length; i++) m += v[i]!; m /= v.length;
    let s = 0; for (let i = 0; i < v.length; i++) s += (v[i]! - m) ** 2; s = Math.sqrt(s / v.length) || 1;
    const out = new Float64Array(v.length); for (let i = 0; i < v.length; i++) out[i] = (v[i]! - m) / s; return out;
  };
  const acc = z(beatAccent), chg = z(beatChromaChange), low = beatAccentLow ? z(beatAccentLow) : null;
  const hasChords = !!beatChordChange && beatChordChange.some((v) => v > 0);
  const chord = hasChords ? z(beatChordChange!) : null;
  const combined = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const harmonic = chord ? chord[i]! * 0.7 + chg[i]! * 0.3 : chg[i]!;
    combined[i] = low ? acc[i]! * 0.3 + low[i]! * 0.3 + harmonic * 0.4 : acc[i]! * 0.6 + harmonic * 0.4;
  }
  // Between-phase variance of the combined accent signal, minus the variance that
  // p phases of pure noise would show (σ²·p/n), plus the autocorrelation at lag p.
  let sigma2 = 0; for (let i = 0; i < n; i++) sigma2 += combined[i]! * combined[i]!; sigma2 /= n;
  const periodScore = (p: number): { score: number; phase: number; ac: number } => {
    const means = new Float64Array(p), counts = new Int32Array(p);
    for (let i = 0; i < n; i++) { means[i % p] = means[i % p]! + combined[i]!; counts[i % p]!++; }
    let grand = 0;
    for (let ph = 0; ph < p; ph++) { means[ph] = means[ph]! / Math.max(1, counts[ph]!); grand += means[ph]!; }
    grand /= p;
    let v = 0, bestPhase = 0;
    for (let ph = 0; ph < p; ph++) { v += (means[ph]! - grand) ** 2; if (means[ph]! > means[bestPhase]!) bestPhase = ph; }
    const between = Math.max(0, v / p - (sigma2 * p) / n);
    let ac = 0;
    for (let i = 0; i + p < n; i++) ac += combined[i]! * combined[i + p]!;
    ac = Math.max(0, ac / Math.max(1, n - p));
    return { score: between, phase: bestPhase, ac };
  };
  const raw = ([2, 3, 4, 5, 6, 7] as const).map((p) => ({ p, ...periodScore(p) }));
  const maxV = Math.max(...raw.map((r) => r.score)) || 1, maxAc = Math.max(...raw.map((r) => r.ac)) || 1;
  const results = raw.map((r) => ({ p: r.p, phase: r.phase, score: r.score / maxV + 0.5 * (r.ac / maxAc) }));
  const byP = new Map(results.map((r) => [r.p, r]));
  const r2 = byP.get(2)!, r3 = byP.get(3)!, r4 = byP.get(4)!, r6 = byP.get(6)!;
  // A p-periodic pattern scores the same at 2p (its phase means simply repeat), so the
  // longer grouping must earn a clear margin; otherwise the simpler meter wins. Between
  // 2 and 4 the tie goes to 4: common time is the overwhelmingly likely reading.
  const sorted = [...results].sort((a, b) => b.score - a.score);
  let choice: (typeof results)[number] = sorted[0]!;
  if (choice.p === 6 && r6.score < r3.score * 1.25) choice = r3;
  if (choice.p === 6 && r6.score < r2.score * 1.25) choice = r2;
  if (choice.p === 2 && r4.score >= r2.score * 0.8) choice = r4;
  if (choice.p === 4 && r2.score > r4.score * 1.25) choice = r2;
  // 5 and 7 need a very clear margin to be accepted; otherwise fall back to 4.
  if ((choice.p === 5 || choice.p === 7) && choice.score < Math.max(r4.score, r3.score) * 1.25) choice = r4.score >= r3.score ? r4 : r3;
  const second = sorted.find((r) => r.p !== choice.p) ?? choice;
  const confidence = Math.max(0.1, Math.min(0.95, 0.4 + (choice.score - second.score) / (Math.abs(choice.score) + Math.abs(second.score) + 1e-9)));
  const labels: Record<number, string> = { 2: "2/4", 3: "3/4", 4: "4/4", 5: "5/4", 6: "6/8", 7: "7/8" };
  const maxScore = Math.max(...results.map((r) => Math.abs(r.score))) || 1;
  return { beatsPerBar: choice.p, label: labels[choice.p]!, confidence, downbeatOffset: choice.phase, alternatives: results.map((r) => ({ beatsPerBar: r.p, score: r.score / maxScore })) };
}

/** Swing ratio: how far the off-beat eighth sits between straight (0.5) and triplet (0.667). */
export function estimateSwing(onset: Float32Array, fps: number, beats: number[]): { ratio: number; label: string } {
  if (beats.length < 8) return { ratio: 0.5, label: "unknown" };
  let wStraight = 0, wSwing = 0, wHard = 0;
  const at = (t: number): number => {
    const i = Math.round(t * fps);
    let m = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(onset.length - 1, i + 1); j++) m = Math.max(m, onset[j]!);
    return m;
  };
  for (let i = 0; i + 1 < beats.length; i++) {
    const a = beats[i]!, b = beats[i + 1]!, d = b - a;
    wStraight += at(a + d * 0.5);
    wSwing += at(a + d * 0.6667);
    wHard += at(a + d * 0.75);
  }
  const total = wStraight + wSwing + wHard + 1e-9;
  const ratio = (0.5 * wStraight + 0.6667 * wSwing + 0.75 * wHard) / total;
  let label = "straight";
  if (ratio > 0.64) label = "hard swing / shuffle";
  else if (ratio > 0.58) label = "swung";
  else if (ratio > 0.54) label = "lightly swung";
  return { ratio, label };
}
