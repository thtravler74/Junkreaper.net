import { NOTE_NAMES } from "./chroma";

// Key profiles. Albrecht & Shanahan (2013) performed best in large-scale tests;
// Krumhansl-Kessler (1982) is the classic reference. Both are used and blended.
const AS_MAJOR = [0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.080, 0.008, 0.081];
const AS_MINOR = [0.220, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052];
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export type Mode = "major" | "minor";

export interface KeyEstimate {
  tonic: number; // pitch class 0..11
  mode: Mode;
  name: string; // e.g. "A minor"
  confidence: number; // 0..1 margin-based
  clarity: number; // best correlation value
  scores: { name: string; score: number }[]; // top alternatives
  relative: string;
  parallel: string;
  dominant: string;
  subdominant: string;
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]!; mb += b[i]!; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i]! - ma, y = b[i]! - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function keyName(tonic: number, mode: Mode): string {
  // Prefer the spelling conventional for the key signature.
  const majorSpelling = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const minorSpelling = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];
  return `${(mode === "major" ? majorSpelling : minorSpelling)[tonic]} ${mode}`;
}

/** Build the KeyEstimate for a specific key name using the same scoring, keeping the full ranking. */
export function estimateNamedKey(chroma: ArrayLike<number>, name: string): KeyEstimate | null {
  const all = estimateKey(chroma);
  const target = all.scores.find((s) => s.name === name);
  if (!target) return null;
  const mode: Mode = name.endsWith("minor") ? "minor" : "major";
  const tonic = Array.from({ length: 12 }, (_, t) => t).find((t) => keyName(t, mode) === name);
  if (tonic === undefined) return null;
  const relTonic = mode === "major" ? (tonic + 9) % 12 : (tonic + 3) % 12;
  return {
    ...all,
    tonic, mode, name,
    clarity: target.score,
    confidence: Math.max(0.15, all.confidence * 0.8),
    scores: [target, ...all.scores.filter((s) => s.name !== name)],
    relative: keyName(relTonic, mode === "major" ? "minor" : "major"),
    parallel: keyName(tonic, mode === "major" ? "minor" : "major"),
    dominant: keyName((tonic + 7) % 12, mode),
    subdominant: keyName((tonic + 5) % 12, mode),
  };
}

export function estimateKey(chroma: ArrayLike<number>): KeyEstimate {
  const scores: { tonic: number; mode: Mode; score: number }[] = [];
  for (let t = 0; t < 12; t++) {
    for (const mode of ["major", "minor"] as Mode[]) {
      const as = mode === "major" ? AS_MAJOR : AS_MINOR;
      const kk = mode === "major" ? KK_MAJOR : KK_MINOR;
      const rotAs = new Array<number>(12), rotKk = new Array<number>(12);
      for (let i = 0; i < 12; i++) { rotAs[(i + t) % 12] = as[i]!; rotKk[(i + t) % 12] = kk[i]!; }
      const score = 0.6 * pearson(chroma, rotAs) + 0.4 * pearson(chroma, rotKk);
      scores.push({ tonic: t, mode, score });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]!, second = scores[1]!;
  // Margin over the runner-up (0.1 of correlation is already decisive) scaled by how
  // well the winner fits at all.
  const margin = Math.max(0, Math.min(1, (best.score - second.score) / 0.1));
  const fit = Math.max(0, Math.min(1, (best.score - 0.3) / 0.4));
  const confidence = margin * fit;
  const relTonic = best.mode === "major" ? (best.tonic + 9) % 12 : (best.tonic + 3) % 12;
  return {
    tonic: best.tonic,
    mode: best.mode,
    name: keyName(best.tonic, best.mode),
    confidence,
    clarity: best.score,
    scores: scores.map((s) => ({ name: keyName(s.tonic, s.mode), score: s.score })),
    relative: keyName(relTonic, best.mode === "major" ? "minor" : "major"),
    parallel: keyName(best.tonic, best.mode === "major" ? "minor" : "major"),
    dominant: keyName((best.tonic + 7) % 12, best.mode),
    subdominant: keyName((best.tonic + 5) % 12, best.mode),
  };
}

/** Scale-degree names for display. */
export const DEGREE_NAMES_MAJOR = ["1 (tonic)", "♭2", "2 (supertonic)", "♭3", "3 (mediant)", "4 (subdominant)", "♯4/♭5", "5 (dominant)", "♭6", "6 (submediant)", "♭7", "7 (leading tone)"];
export const DEGREE_NAMES_MINOR = ["1 (tonic)", "♭2", "2 (supertonic)", "3 (mediant)", "♮3", "4 (subdominant)", "♯4/♭5", "5 (dominant)", "6 (submediant)", "♮6", "7 (subtonic)", "♮7 (leading tone)"];

export interface ModalFlavour {
  label: string;
  detail: string;
}

/**
 * Compare the tonic-relative pitch-class distribution against the seven
 * diatonic modes and report the closest one plus characteristic tendencies.
 */
export function modalFlavour(chroma: ArrayLike<number>, key: KeyEstimate): ModalFlavour {
  const rel = new Array<number>(12);
  for (let i = 0; i < 12; i++) rel[i] = chroma[(i + key.tonic) % 12]!;
  const sum = rel.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 12; i++) rel[i] = rel[i]! / sum;
  const modes: Record<string, number[]> = {
    Ionian: [0, 2, 4, 5, 7, 9, 11],
    Dorian: [0, 2, 3, 5, 7, 9, 10],
    Phrygian: [0, 1, 3, 5, 7, 8, 10],
    Lydian: [0, 2, 4, 6, 7, 9, 11],
    Mixolydian: [0, 2, 4, 5, 7, 9, 10],
    Aeolian: [0, 2, 3, 5, 7, 8, 10],
    Locrian: [0, 1, 3, 5, 6, 8, 10],
    "Harmonic minor": [0, 2, 3, 5, 7, 8, 11],
    "Pentatonic major": [0, 2, 4, 7, 9],
    "Pentatonic minor": [0, 3, 5, 7, 10],
    "Blues": [0, 3, 5, 6, 7, 10],
  };
  let best = "Ionian", bestScore = -Infinity;
  const results: [string, number][] = [];
  for (const [name, pcs] of Object.entries(modes)) {
    const inSet = pcs.reduce((a, pc) => a + rel[pc]!, 0);
    const score = inSet / pcs.length - (1 - inSet) / (12 - pcs.length); // mean in-scale mass minus mean out-of-scale mass
    results.push([name, score]);
    if (score > bestScore) { bestScore = score; best = name; }
  }
  const tendencies: string[] = [];
  const degreeNames = key.mode === "major" ? DEGREE_NAMES_MAJOR : DEGREE_NAMES_MINOR;
  if (key.mode === "major") {
    if (rel[10]! > rel[11]! * 1.2) tendencies.push("the flattened 7th outweighs the leading tone (Mixolydian / rock-blues colour)");
    if (rel[6]! > rel[5]! * 1.1) tendencies.push("the raised 4th outweighs the natural 4th (Lydian colour)");
    if (rel[3]! > 0.06) tendencies.push("notable minor-3rd presence over a major tonic (blue notes or mode mixture)");
  } else {
    if (rel[11]! > rel[10]! * 1.2) tendencies.push("a raised leading tone dominates the subtonic (harmonic-minor cadences)");
    if (rel[9]! > rel[8]! * 1.2) tendencies.push("the natural 6th outweighs the flat 6th (Dorian colour)");
    if (rel[1]! > 0.06) tendencies.push("a prominent ♭2 (Phrygian colour)");
  }
  const strongest = rel.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, i]) => degreeNames[i]).join(", ");
  const detail = `Closest scale template: ${best}. Most-weighted scale degrees: ${strongest}.` + (tendencies.length ? ` Tendencies: ${tendencies.join("; ")}.` : "");
  return { label: best, detail };
}

export interface KeySegment { start: number; end: number; key: KeyEstimate }

/** Share of pitch-class energy outside the key's diatonic scale. */
export function outOfScaleMass(chroma: ArrayLike<number>, key: KeyEstimate): number {
  const scale = key.mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  let inMass = 0, total = 0;
  for (let pc = 0; pc < 12; pc++) {
    const v = chroma[pc]!;
    total += v;
    if (scale.includes(((pc - key.tonic) % 12 + 12) % 12)) inMass += v;
  }
  return total > 0 ? 1 - inMass / total : 0;
}

/**
 * Windowed key estimation to find modulations. Each hop gets the key of the
 * window centred on it; a hysteresis margin stops C↔F style flicker, and runs
 * shorter than `minRunSec` are absorbed by their predecessor.
 */
export function keyTimeline(chromaFrames: Float32Array, frames: number, fps: number, globalKey?: KeyEstimate, windowSec = 12, hopSec = 3, minRunSec = 12): KeySegment[] {
  const win = Math.max(1, Math.round(windowSec * fps)), hop = Math.max(1, Math.round(hopSec * fps));
  const acc = new Float64Array(12);
  const perHop: { start: number; end: number; key: KeyEstimate }[] = [];
  // Start from the song's overall key; windows leave it only on clear local evidence.
  let current: KeyEstimate | null = globalKey ?? null;
  for (let c = 0; c < frames; c += hop) {
    const s = Math.max(0, c - (win >> 1)), e = Math.min(frames, c + (win >> 1));
    acc.fill(0);
    for (let f = s; f < e; f++) for (let pc = 0; pc < 12; pc++) acc[pc] = acc[pc]! + chromaFrames[f * 12 + pc]!;
    const k = estimateKey(acc);
    // Stickiness: a window only leaves the song's overall key, or the key it is already
    // in, when the local winner is clearly better. Moves to the relative major/minor
    // (which share every note) need a wider margin still, since they are rarely real
    // modulations.
    const scoreOf = (name: string): number => k.scores.find((x) => x.name === name)?.score ?? -1;
    // Profile correlations alone separate keys poorly (a C-major loop can drift towards F
    // for a few bars), so leaving a key also requires real out-of-scale pitch mass —
    // the C♯ and F♯ that appear when the music actually moves to D.
    const leaves = (from: KeyEstimate): boolean => {
      const gain = k.clarity - scoreOf(from.name);
      if (k.name === from.relative) return gain > 0.22;
      // Neighbouring keys differ by a single accidental, so compare the two keys' out-of-scale
      // masses against each other rather than against a fixed amount.
      return gain > 0.2 || (gain > 0.04 && outOfScaleMass(acc, from) > 2 * outOfScaleMass(acc, k) + 0.02);
    };
    if (current && !leaves(current)) { perHop.push({ start: c / fps, end: Math.min(frames, c + hop) / fps, key: current }); continue; }
    current = k;
    perHop.push({ start: c / fps, end: Math.min(frames, c + hop) / fps, key: k });
  }
  const runs: KeySegment[] = [];
  for (const h of perHop) {
    const last = runs[runs.length - 1];
    if (last && last.key.name === h.key.name) last.end = h.end;
    else runs.push({ ...h });
  }
  // Absorb runs shorter than one window into a neighbour: the previous run, or the
  // next one for a short run at the very start. Runs of exactly one window survive.
  // The final run is cut off by the end of the song, so it only needs half a window.
  const tooShort = (r: KeySegment, last: boolean): boolean => r.end - r.start < (last ? minRunSec / 2 : minRunSec) - 0.5;
  for (let i = 0; i < runs.length && runs.length > 1; ) {
    const r = runs[i]!;
    if (!tooShort(r, i === runs.length - 1)) { i++; continue; }
    if (i > 0) { runs[i - 1]!.end = r.end; runs.splice(i, 1); }
    else { runs[1]!.start = r.start; runs.splice(0, 1); }
  }
  // re-merge equal neighbours created by absorption
  const out: KeySegment[] = [];
  for (const r of runs) { const last = out[out.length - 1]; if (last && last.key.name === r.key.name) last.end = r.end; else out.push(r); }
  return out;
}

export { NOTE_NAMES };
