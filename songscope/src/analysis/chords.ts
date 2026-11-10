import { NOTE_NAMES } from "./chroma";
import type { KeyEstimate } from "./key";

export type ChordQuality = "maj" | "min" | "dim" | "aug" | "7" | "min7" | "maj7" | "sus4" | "N";

export interface ChordTemplate { root: number; quality: ChordQuality; vec: Float64Array; label: string }

const INTERVALS: Record<Exclude<ChordQuality, "N">, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  "7": [0, 4, 7, 10], min7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7],
};
const SUFFIX: Record<ChordQuality, string> = { maj: "", min: "m", dim: "dim", aug: "aug", "7": "7", min7: "m7", maj7: "maj7", sus4: "sus4", N: "N.C." };

export function chordTemplates(): ChordTemplate[] {
  const out: ChordTemplate[] = [];
  for (let r = 0; r < 12; r++) {
    for (const q of Object.keys(INTERVALS) as Exclude<ChordQuality, "N">[]) {
      const vec = new Float64Array(12);
      const ivs = INTERVALS[q];
      ivs.forEach((iv, i) => { vec[(r + iv) % 12] = i === 0 ? 1.0 : 0.85; });
      // Tiny weight on the fifth's harmonics keeps triads from being overrun by 7ths.
      let norm = 0; for (let i = 0; i < 12; i++) norm += vec[i]! * vec[i]!;
      norm = Math.sqrt(norm);
      for (let i = 0; i < 12; i++) vec[i] = vec[i]! / norm;
      out.push({ root: r, quality: q, vec, label: `${NOTE_NAMES[r]}${SUFFIX[q]}` });
    }
  }
  const flat = new Float64Array(12).fill(1 / Math.sqrt(12));
  out.push({ root: -1, quality: "N", vec: flat, label: "N.C." });
  return out;
}

export interface ChordSegment {
  start: number;
  end: number;
  label: string;
  root: number;
  quality: ChordQuality;
  beats: number;
  roman: string;
  diatonic: boolean;
}

/**
 * Viterbi decoding of chord labels over beat-synchronous chroma. Emission is the
 * cosine similarity with each template; staying on the same chord is cheaper
 * than switching, which removes flicker.
 */
export function decodeChords(beatChroma: Float32Array[], beatTimes: number[], key: KeyEstimate, switchPenalty = 0.35): ChordSegment[] {
  const T = beatChroma.length;
  if (T === 0) return [];
  const templates = chordTemplates();
  const S = templates.length;
  const emis = new Float64Array(T * S);
  for (let t = 0; t < T; t++) {
    const c = beatChroma[t]!;
    let n = 0; for (let i = 0; i < 12; i++) n += c[i]! * c[i]!;
    n = Math.sqrt(n) || 1;
    let total = 0; for (let i = 0; i < 12; i++) total += c[i]!;
    for (let s = 0; s < S; s++) {
      const tpl = templates[s]!;
      let dot = 0;
      for (let i = 0; i < 12; i++) dot += (c[i]! / n) * tpl.vec[i]!;
      // Prefer simpler chords unless the extension is clearly present; "N" only for near-silence/noise.
      let bias = 0;
      if (tpl.quality === "7" || tpl.quality === "min7" || tpl.quality === "maj7") bias = -0.04;
      if (tpl.quality === "dim" || tpl.quality === "aug" || tpl.quality === "sus4") bias = -0.14; // rarer qualities need clearer evidence than plain triads
      if (tpl.quality === "N") bias = total < 1e-6 ? 1 : -0.25;
      // Mild prior for chords whose root is diatonic to the detected key.
      if (tpl.root >= 0 && isDiatonicRoot(tpl.root, key)) bias += 0.02;
      emis[t * S + s] = dot + bias;
    }
  }
  const score = new Float64Array(T * S);
  const back = new Int32Array(T * S);
  for (let s = 0; s < S; s++) score[s] = emis[s]!;
  for (let t = 1; t < T; t++) {
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (score[(t - 1) * S + s]! > score[(t - 1) * S + bestPrev]!) bestPrev = s;
    const bestPrevScore = score[(t - 1) * S + bestPrev]!;
    for (let s = 0; s < S; s++) {
      const stay = score[(t - 1) * S + s]!;
      const sw = bestPrevScore - switchPenalty;
      if (stay >= sw) { score[t * S + s] = stay + emis[t * S + s]!; back[t * S + s] = s; }
      else { score[t * S + s] = sw + emis[t * S + s]!; back[t * S + s] = bestPrev; }
    }
  }
  let s = 0;
  for (let i = 1; i < S; i++) if (score[(T - 1) * S + i]! > score[(T - 1) * S + s]!) s = i;
  const path = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) { path[t] = s; s = back[t * S + s]!; }
  // One-beat flickers at chord boundaries come from beat windows that straddle two
  // chords; absorb them into the preceding chord.
  for (let t = 1; t < T - 1; t++) {
    if (path[t] !== path[t - 1] && path[t] !== path[t + 1]) path[t] = path[t - 1]!;
  }
  const segs: ChordSegment[] = [];
  for (let t = 0; t < T; t++) {
    const tpl = templates[path[t]!]!;
    const start = beatTimes[t]!, end = beatTimes[t + 1] ?? start + (beatTimes[t]! - (beatTimes[t - 1] ?? start - 0.5));
    const last = segs[segs.length - 1];
    if (last && last.label === tpl.label) { last.end = end; last.beats++; continue; }
    segs.push({ start, end, label: tpl.label, root: tpl.root, quality: tpl.quality, beats: 1, roman: romanNumeral(tpl.root, tpl.quality, key), diatonic: tpl.root >= 0 && isDiatonicRoot(tpl.root, key) });
  }
  return segs;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export function isDiatonicRoot(root: number, key: KeyEstimate): boolean {
  const rel = ((root - key.tonic) % 12 + 12) % 12;
  return (key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE).includes(rel);
}

/** Degree labels relative to the major scale of the tonic — the pop/rock convention, used for both modes (so a natural-minor VI is ♭VI). */
const DEGREE_LABELS = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];

export function romanNumeral(root: number, quality: ChordQuality, key: KeyEstimate): string {
  if (root < 0 || quality === "N") return "N.C.";
  const rel = ((root - key.tonic) % 12 + 12) % 12;
  let num = DEGREE_LABELS[rel]!;
  const minorish = quality === "min" || quality === "min7" || quality === "dim";
  if (minorish) num = num.replace(/[IV]+/, (m) => m.toLowerCase());
  let suffix = "";
  if (quality === "dim") suffix = "°";
  else if (quality === "aug") suffix = "+";
  else if (quality === "7") suffix = "7";
  else if (quality === "min7") suffix = "7";
  else if (quality === "maj7") suffix = "maj7";
  else if (quality === "sus4") suffix = "sus4";
  return `${num}${suffix}`;
}

/**
 * Loop-based music is usually heard from the chord the loop starts on. When the
 * profile-based key is nearly tied with its relative major/minor and both the
 * opening chord and the most common loop start on that relative key's tonic
 * triad, prefer the relative key.
 */
export function refineKeyWithChords(key: KeyEstimate, segs: ChordSegment[], reestimate: (name: string) => KeyEstimate | null): KeyEstimate {
  const stable = segs.filter((s) => s.quality !== "N" && s.beats >= 2);
  if (stable.length < 4) return key;
  const runnerUp = key.scores[1];
  if (!runnerUp || runnerUp.name !== key.relative || key.clarity - runnerUp.score > 0.25) return key;
  const rel = reestimate(runnerUp.name);
  if (!rel) return key;
  const isTonicTriad = (c: ChordSegment): boolean => c.root === rel.tonic && ((rel.mode === "major" && (c.quality === "maj" || c.quality === "maj7")) || (rel.mode === "minor" && (c.quality === "min" || c.quality === "min7")));
  const first = stable[0]!;
  // most common 4-chord loop start
  const counts = new Map<string, { count: number; first: ChordSegment }>();
  for (let i = 0; i + 4 <= stable.length; i++) {
    const k = stable.slice(i, i + 4).map((c) => c.label).join("|");
    const e = counts.get(k) ?? { count: 0, first: stable[i]! };
    e.count++; counts.set(k, e);
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  const loopStartsOnRel = top ? isTonicTriad(top.first) : false;
  if (isTonicTriad(first) && loopStartsOnRel) return rel;
  return key;
}

export interface ProgressionSummary {
  distinctChords: number;
  diatonicShare: number;
  averageBeatsPerChord: number;
  changesPerMinute: number;
  topChords: { label: string; roman: string; share: number }[];
  commonProgressions: { romans: string[]; labels: string[]; count: number }[];
  borrowed: string[];
  cadences: { type: string; count: number }[];
}

export function summarizeProgression(segs: ChordSegment[], durationSec: number): ProgressionSummary {
  const real = segs.filter((s) => s.quality !== "N");
  const totalBeats = real.reduce((a, s) => a + s.beats, 0) || 1;
  const byLabel = new Map<string, { roman: string; beats: number }>();
  for (const s of real) {
    const e = byLabel.get(s.label) ?? { roman: s.roman, beats: 0 };
    e.beats += s.beats;
    byLabel.set(s.label, e);
  }
  const topChords = [...byLabel.entries()].map(([label, v]) => ({ label, roman: v.roman, share: v.beats / totalBeats })).sort((a, b) => b.share - a.share).slice(0, 8);
  const diatonicBeats = real.filter((s) => s.diatonic).reduce((a, s) => a + s.beats, 0);
  const ngramCounts = new Map<string, { romans: string[]; labels: string[]; count: number }>();
  const stable = real.filter((s) => s.beats >= 2);
  for (const n of [4, 3, 2]) {
    for (let i = 0; i + n <= stable.length; i++) {
      const slice = stable.slice(i, i + n);
      // skip progressions that are just one chord repeated
      if (new Set(slice.map((s) => s.label)).size < Math.min(2, n)) continue;
      const k = slice.map((s) => s.label).join(" → ");
      const e = ngramCounts.get(k) ?? { romans: slice.map((s) => s.roman), labels: slice.map((s) => s.label), count: 0 };
      e.count++;
      ngramCounts.set(k, e);
    }
  }
  const commonProgressions = [...ngramCounts.values()].filter((p) => p.count >= 2).sort((a, b) => b.count * b.labels.length - a.count * a.labels.length).slice(0, 5);
  const borrowed = [...new Set(real.filter((s) => !s.diatonic).map((s) => `${s.label} (${s.roman})`))].slice(0, 6);
  const cadenceCounts = new Map<string, number>();
  for (let i = 1; i < real.length; i++) {
    const a = real[i - 1]!.roman.replace(/[^IViv]/g, "").toUpperCase(), b = real[i]!.roman.replace(/[^IViv]/g, "").toUpperCase();
    let type: string | null = null;
    if (a === "V" && b === "I") type = "authentic (V → I)";
    else if (a === "IV" && b === "I") type = "plagal (IV → I)";
    else if (a === "V" && b === "VI") type = "deceptive (V → vi)";
    else if (b === "V" && a !== "V") type = "half (→ V)";
    if (type) cadenceCounts.set(type, (cadenceCounts.get(type) ?? 0) + 1);
  }
  return {
    distinctChords: byLabel.size,
    diatonicShare: diatonicBeats / totalBeats,
    averageBeatsPerChord: totalBeats / Math.max(1, real.length),
    changesPerMinute: durationSec > 0 ? (real.length / durationSec) * 60 : 0,
    topChords,
    commonProgressions,
    borrowed,
    cadences: [...cadenceCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  };
}
