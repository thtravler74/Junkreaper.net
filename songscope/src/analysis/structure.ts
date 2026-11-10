/**
 * Structural segmentation: beat-synchronous timbre+harmony features → cosine
 * self-similarity matrix → Foote checkerboard novelty → boundaries → segment
 * clustering → heuristic section names (intro / verse / chorus / bridge / outro).
 */
export interface Section {
  index: number;
  start: number;
  end: number;
  label: string; // "A", "B", ...
  name: string; // "Chorus", ...
  levelDb: number; // mean RMS dB relative to the song median
  percussiveness: number; // 0..1 share of percussive energy
  brightnessHz: number; // mean centroid
  dominantChord?: string;
  notes: string[];
}

export interface StructureResult {
  sections: Section[];
  novelty: { time: number; value: number }[];
  repetitionScore: number; // 0..1 how much of the song repeats earlier material
  formString: string; // e.g. "Intro–A–B–A–B–C–B–Outro"
  /** Downsampled self-similarity matrix for display (size × size, 0..255). */
  ssmPreview: { size: number; data: Uint8Array };
}

export interface SegmentFeatureInput {
  times: number[]; // boundaries of each feature vector (length n+1)
  vectors: Float32Array[]; // per-slice feature vector
  levelDb: Float32Array;
  percussive: Float32Array;
  centroid: Float32Array;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na > 0 && nb > 0 ? d / Math.sqrt(na * nb) : 0;
}

export function segmentStructure(input: SegmentFeatureInput, opts: { minSectionSec?: number; durationSec: number; downbeats?: number[] }): StructureResult {
  const n = input.vectors.length;
  const minSec = opts.minSectionSec ?? 7;
  if (n < 8) {
    const one: Section = { index: 0, start: 0, end: opts.durationSec, label: "A", name: "Whole piece", levelDb: 0, percussiveness: 0, brightnessHz: 0, notes: [] };
    return { sections: [one], novelty: [], repetitionScore: 0, formString: "A", ssmPreview: { size: 1, data: new Uint8Array([255]) } };
  }
  // z-score each dimension
  const dim = input.vectors[0]!.length;
  const mu = new Float64Array(dim), sd = new Float64Array(dim);
  for (const v of input.vectors) for (let i = 0; i < dim; i++) mu[i] = mu[i]! + v[i]!;
  for (let i = 0; i < dim; i++) mu[i] = mu[i]! / n;
  for (const v of input.vectors) for (let i = 0; i < dim; i++) sd[i] = sd[i]! + (v[i]! - mu[i]!) ** 2;
  for (let i = 0; i < dim; i++) sd[i] = Math.sqrt(sd[i]! / n) || 1;
  const Z = input.vectors.map((v) => { const z = new Float32Array(dim); for (let i = 0; i < dim; i++) z[i] = (v[i]! - mu[i]!) / sd[i]!; return z; });
  // SSM
  const S = new Float32Array(n * n);
  for (let i = 0; i < n; i++) { S[i * n + i] = 1; for (let j = i + 1; j < n; j++) { const c = cosine(Z[i]!, Z[j]!); S[i * n + j] = c; S[j * n + i] = c; } }
  // Novelty with a Gaussian-tapered checkerboard kernel sized to ~8 s of slices.
  const sliceSec = (input.times[n]! - input.times[0]!) / n;
  const L = Math.max(4, Math.min(24, Math.round(8 / sliceSec)));
  const novelty = new Float32Array(n);
  for (let i = L; i < n - L; i++) {
    let acc = 0;
    for (let a = -L; a < L; a++) for (let b = -L; b < L; b++) {
      const sign = (a < 0) === (b < 0) ? 1 : -1;
      const g = Math.exp(-0.5 * ((a + 0.5) ** 2 + (b + 0.5) ** 2) / (L * L * 0.5));
      acc += sign * g * S[(i + a) * n + (i + b)]!;
    }
    novelty[i] = Math.max(0, acc);
  }
  let nMax = 0; for (let i = 0; i < n; i++) nMax = Math.max(nMax, novelty[i]!);
  if (nMax > 0) for (let i = 0; i < n; i++) novelty[i] = novelty[i]! / nMax;
  // Level-change novelty: |mean level after − mean level before| over ~4 s windows. Section
  // changes that keep the same chords and instruments (verse → chorus lift) show up here
  // when the self-similarity novelty barely moves.
  const Lw = Math.max(2, Math.min(L, Math.round(4 / sliceSec)));
  const lvNov = new Float32Array(n);
  let lvMax = 0;
  for (let i = Lw; i < n - Lw; i++) {
    let before = 0, after = 0;
    for (let k = 1; k <= Lw; k++) { before += input.levelDb[i - k]!; after += input.levelDb[i + k - 1]!; }
    lvNov[i] = Math.abs(after - before) / Lw;
    lvMax = Math.max(lvMax, lvNov[i]!);
  }
  if (lvMax > 0) {
    for (let i = 0; i < n; i++) novelty[i] = 0.65 * novelty[i]! + 0.35 * Math.min(1, lvNov[i]! / Math.max(6, lvMax));
    nMax = 0; for (let i = 0; i < n; i++) nMax = Math.max(nMax, novelty[i]!);
    if (nMax > 0) for (let i = 0; i < n; i++) novelty[i] = novelty[i]! / nMax;
  }
  // Peak picking with a minimum section length
  const minSlices = Math.max(2, Math.round(minSec / sliceSec));
  const peaks: number[] = [];
  const nMean = Array.from(novelty).reduce((a, b) => a + b, 0) / n;
  for (let i = 1; i < n - 1; i++) {
    if (novelty[i]! > novelty[i - 1]! && novelty[i]! >= novelty[i + 1]! && novelty[i]! > Math.max(0.15, nMean * 1.2)) {
      if (peaks.length && i - peaks[peaks.length - 1]! < minSlices) { if (novelty[i]! > novelty[peaks[peaks.length - 1]!]!) peaks[peaks.length - 1] = i; }
      else peaks.push(i);
    }
  }
  let bounds = [0, ...peaks.filter((p) => p >= minSlices && n - p >= minSlices), n];
  // Snap interior boundaries to the nearest downbeat (sections almost always start on a bar line).
  if (opts.downbeats && opts.downbeats.length > 2) {
    const db = opts.downbeats;
    const snapped = bounds.slice(1, -1).map((bi) => {
      const t = input.times[bi]!;
      let bestT = t, bestD = Infinity;
      for (const d of db) { const dd = Math.abs(d - t); if (dd < bestD) { bestD = dd; bestT = d; } }
      if (bestD > sliceSec * 2.5) return bi;
      // find the slice index whose start time is closest to the downbeat
      let bestI = bi, bestDI = Infinity;
      for (let i = 1; i < n; i++) { const dd = Math.abs(input.times[i]! - bestT); if (dd < bestDI) { bestDI = dd; bestI = i; } }
      return bestI;
    });
    bounds = [0, ...[...new Set(snapped)].sort((a, b) => a - b).filter((b, i, arr) => b > 0 && b < n && (i === 0 || b - arr[i - 1]! >= 2)), n];
  }
  // Segment mean vectors
  const segs = bounds.slice(0, -1).map((s, i) => ({ s, e: bounds[i + 1]! }));
  const segVec = segs.map(({ s, e }) => { const v = new Float32Array(dim); for (let i = s; i < e; i++) for (let d = 0; d < dim; d++) v[d] = v[d]! + Z[i]![d]!; for (let d = 0; d < dim; d++) v[d] = v[d]! / (e - s); return v; });
  // Repetition similarity from the SSM: slide the shorter segment along the longer
  // one and take the best mean diagonal (same material in the same order scores high).
  const blockSim = (a: number, b: number): number => {
    const A = segs[a]!, B = segs[b]!;
    const [sh, lg] = A.e - A.s <= B.e - B.s ? [A, B] : [B, A];
    const lenS = sh.e - sh.s, lenL = lg.e - lg.s;
    let best = -1;
    for (let off = 0; off + lenS <= lenL; off++) {
      let acc = 0;
      for (let i = 0; i < lenS; i++) acc += S[(sh.s + i) * n + (lg.s + off + i)]!;
      best = Math.max(best, acc / lenS);
    }
    return best;
  };
  // Agglomerative clustering with a similarity threshold
  const labels = segs.map((_, i) => i);
  const clusters: number[][] = segs.map((_, i) => [i]);
  const simOf = (ca: number[], cb: number[]): number => { let acc = 0, c = 0; for (const a of ca) for (const b of cb) { acc += 0.5 * cosine(segVec[a]!, segVec[b]!) + 0.5 * blockSim(a, b); c++; } return acc / c; };
  const threshold = 0.45;
  for (;;) {
    let bi = -1, bj = -1, best = threshold;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) { const s = simOf(clusters[i]!, clusters[j]!); if (s > best) { best = s; bi = i; bj = j; } }
    if (bi < 0) break;
    clusters[bi] = [...clusters[bi]!, ...clusters[bj]!];
    clusters.splice(bj, 1);
  }
  // Assign letters in order of first appearance
  const order = clusters.map((c) => Math.min(...c)).map((first, idx) => ({ first, idx })).sort((a, b) => a.first - b.first);
  const letterOf = new Map<number, string>();
  order.forEach(({ idx }, i) => { for (const m of clusters[idx]!) letterOf.set(m, String.fromCharCode(65 + i)); });
  for (let i = 0; i < segs.length; i++) labels[i] = order.findIndex(({ idx }) => clusters[idx]!.includes(i));
  // A boundary inside one continuous block of the same material is a false split: merge it.
  for (let i = 1; i < segs.length; ) {
    if (letterOf.get(i) === letterOf.get(i - 1)) {
      segs[i - 1]!.e = segs[i]!.e;
      segs.splice(i, 1);
      const remap = new Map<number, string>();
      for (const [k, v] of letterOf) remap.set(k > i ? k - 1 : k, v);
      letterOf.clear();
      for (const [k, v] of remap) letterOf.set(k, v);
    } else i++;
  }
  // Per-segment stats
  const med = Array.from(input.levelDb).sort((a, b) => a - b)[Math.floor(n / 2)] ?? 0;
  const sections: Section[] = segs.map(({ s, e }, i) => {
    let lv = 0, pc = 0, ce = 0;
    for (let k = s; k < e; k++) { lv += input.levelDb[k]!; pc += input.percussive[k]!; ce += input.centroid[k]!; }
    const c = e - s;
    return { index: i, start: input.times[s]!, end: input.times[e]!, label: letterOf.get(i)!, name: "", levelDb: lv / c - med, percussiveness: pc / c, brightnessHz: ce / c, notes: [] };
  });
  nameSections(sections, opts.durationSec);
  // Repetition score: share of slices whose best off-diagonal match (≥ L away) is high
  let rep = 0;
  for (let i = 0; i < n; i++) { let best = 0; for (let j = 0; j < n; j++) if (Math.abs(i - j) >= L) best = Math.max(best, S[i * n + j]!); if (best > 0.6) rep++; }
  const size = Math.min(160, n);
  const data = new Uint8Array(size * size);
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) { const a = Math.floor((i * n) / size), b = Math.floor((j * n) / size); data[i * size + j] = Math.round(255 * Math.max(0, S[a * n + b]!)); }
  const step = Math.max(1, Math.floor(n / 600));
  return {
    sections,
    novelty: Array.from(novelty).map((v, i) => ({ time: input.times[i]!, value: v })).filter((_, i) => i % step === 0),
    repetitionScore: rep / n,
    formString: sections.map((s) => s.name).join(" – "),
    ssmPreview: { size, data },
  };
}

function nameSections(sections: Section[], durationSec: number): void {
  const counts = new Map<string, number>();
  for (const s of sections) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
  const byLabel = (l: string): Section[] => sections.filter((s) => s.label === l);
  const meanLevel = (l: string): number => byLabel(l).reduce((a, s) => a + s.levelDb, 0) / byLabel(l).length;
  const n = sections.length;
  const repeated = [...counts.entries()].filter(([, c]) => c >= 2).map(([l]) => l);
  // Only material that appears somewhere in the interior can be a verse or chorus;
  // a label used solely for the first and last sections is intro/outro material.
  const interior = repeated.filter((l) => byLabel(l).some((s) => s.index !== 0 && s.index !== n - 1));
  const totalDur = (l: string): number => byLabel(l).reduce((a, s) => a + (s.end - s.start), 0);
  const chorusLabel = interior.length ? [...interior].sort((a, b) => meanLevel(b) - meanLevel(a))[0]! : null;
  const verseLabel = interior.filter((l) => l !== chorusLabel).sort((a, b) => totalDur(b) - totalDur(a))[0] ?? null;
  let verseNo = 0, chorusNo = 0;
  for (let i = 0; i < n; i++) {
    const s = sections[i]!;
    const first = i === 0, last = i === n - 1;
    const dur = s.end - s.start;
    const unique = (counts.get(s.label) ?? 0) === 1;
    if (first && n > 1 && (unique || s.levelDb < -2) && dur < Math.max(30, durationSec * 0.2)) { s.name = "Intro"; s.notes.push(s.levelDb < -3 ? "quieter, sets up the track" : "opens the track"); continue; }
    if (last && n > 1 && (unique || s.levelDb < -2)) { s.name = "Outro"; continue; }
    if (chorusLabel && s.label === chorusLabel) {
      chorusNo++;
      s.name = s.percussiveness > 0.6 && s.levelDb > 1.5 ? `Chorus / drop ${chorusNo}` : `Chorus ${chorusNo}`;
      continue;
    }
    if (verseLabel && s.label === verseLabel) { verseNo++; s.name = `Verse ${verseNo}`; continue; }
    if (unique && !first && !last) {
      const next = sections[i + 1];
      if (s.levelDb < -4) s.name = "Breakdown";
      else if (next && chorusLabel && next.label === chorusLabel && dur < 20) s.name = "Pre-chorus";
      else if (i > n / 2) s.name = "Bridge";
      else s.name = "Interlude";
      continue;
    }
    // other repeated labels
    const prev = sections[i - 1], next = sections[i + 1];
    if (next && chorusLabel && next.label === chorusLabel && dur < 20) { s.name = "Pre-chorus"; continue; }
    if (prev && chorusLabel && prev.label === chorusLabel && dur < 15) { s.name = "Post-chorus"; continue; }
    s.name = `Section ${s.label}`;
  }
  // Mark the loudest section
  let loudest = 0; sections.forEach((s, i) => { if (s.levelDb > sections[loudest]!.levelDb) loudest = i; });
  sections[loudest]?.notes.push("loudest section (climax)");
  let quietest = 0; sections.forEach((s, i) => { if (s.levelDb < sections[quietest]!.levelDb) quietest = i; });
  if (quietest !== loudest) sections[quietest]?.notes.push("quietest section");
}
