export interface EnergyProfile {
  /** RMS in dBFS per 0.5 s. */
  curve: { time: number; db: number }[];
  leadingSilenceSec: number;
  trailingSilenceSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  peakTime: number;
  peakDb: number;
  quietestTime: number;
  quietestDb: number;
  medianDb: number;
  /** Mean level of thirds of the song, dB relative to the overall median. */
  arc: { first: number; middle: number; last: number; shape: string };
  breakdowns: { start: number; end: number; depthDb: number }[];
  buildUps: { start: number; end: number; riseDb: number }[];
  dynamicSpreadDb: number; // 95th − 10th percentile of the level curve
}

export function energyProfile(mono: Float32Array, fs: number, step = 0.5): EnergyProfile {
  const len = Math.round(step * fs);
  const curve: { time: number; db: number }[] = [];
  for (let s = 0; s < mono.length; s += len) {
    const e = Math.min(mono.length, s + len);
    let acc = 0; for (let i = s; i < e; i++) acc += mono[i]! * mono[i]!;
    curve.push({ time: (s + (e - s) / 2) / fs, db: 10 * Math.log10(acc / Math.max(1, e - s) + 1e-12) });
  }
  const silence = -60;
  let lead = 0; while (lead < curve.length && curve[lead]!.db < silence) lead++;
  let trail = 0; while (trail < curve.length - lead && curve[curve.length - 1 - trail]!.db < silence) trail++;
  const active = curve.slice(lead, curve.length - trail);
  const levels = active.map((c) => c.db).sort((a, b) => a - b);
  const pct = (p: number): number => (levels.length ? levels[Math.min(levels.length - 1, Math.floor((levels.length - 1) * p))]! : -Infinity);
  const medianDb = pct(0.5);
  // Fade-in: time from first active frame until the level first reaches median − 6 dB, if it rises monotonically-ish.
  let fadeIn = 0;
  for (let i = 0; i < active.length; i++) { if (active[i]!.db >= medianDb - 6) { fadeIn = i * step; break; } }
  if (fadeIn < 1.5) fadeIn = 0; // under 1.5 s is just a normal entry
  let fadeOut = 0;
  for (let i = active.length - 1; i >= 0; i--) { if (active[i]!.db >= medianDb - 6) { fadeOut = (active.length - 1 - i) * step; break; } }
  if (fadeOut < 1.5) fadeOut = 0;
  let peakIdx = 0, quietIdx = 0;
  active.forEach((c, i) => { if (c.db > active[peakIdx]!.db) peakIdx = i; if (c.db < active[quietIdx]!.db && c.db > silence) quietIdx = i; });
  const third = Math.max(1, Math.floor(active.length / 3));
  const avg = (a: { db: number }[]): number => (a.length ? a.reduce((x, y) => x + y.db, 0) / a.length : medianDb);
  const first = avg(active.slice(0, third)) - medianDb, middle = avg(active.slice(third, 2 * third)) - medianDb, last = avg(active.slice(2 * third)) - medianDb;
  let shape = "even throughout";
  if (last - first > 3 && last >= middle - 1) shape = "steadily building";
  else if (first - last > 3) shape = "front-loaded, winding down";
  else if (middle - Math.max(first, last) > 2.5) shape = "arching (peaks in the middle)";
  else if (Math.min(first, last) - middle > 2.5) shape = "dipping (quieter middle)";
  // Breakdowns: runs ≥ 4 s where level < median − 7 dB (after the first 10 % and before the last 10 %).
  const breakdowns: { start: number; end: number; depthDb: number }[] = [];
  const buildUps: { start: number; end: number; riseDb: number }[] = [];
  const lo = Math.floor(active.length * 0.08), hi = Math.ceil(active.length * 0.92);
  let runStart = -1, runMin = 0;
  for (let i = lo; i <= hi; i++) {
    const below = i < hi && active[i]!.db < medianDb - 7;
    if (below) { if (runStart < 0) { runStart = i; runMin = active[i]!.db; } runMin = Math.min(runMin, active[i]!.db); }
    else if (runStart >= 0) { if ((i - runStart) * step >= 4) breakdowns.push({ start: active[runStart]!.time, end: active[i - 1]!.time + step / 2, depthDb: medianDb - runMin }); runStart = -1; }
  }
  // Build-ups: windows where a smoothed level rises ≥ 6 dB over 6–24 s, nearly monotonically.
  const sm = active.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(active.length - 1, i + 2); j++) { s += active[j]!.db; n++; } return s / n; });
  let i = 0;
  while (i < sm.length - 1) {
    let j = i;
    while (j + 1 < sm.length && sm[j + 1]! >= sm[j]! - 0.8) j++;
    const rise = sm[j]! - sm[i]!, dur = (j - i) * step;
    if (rise >= 6 && dur >= 6 && dur <= 24) buildUps.push({ start: active[i]!.time, end: active[j]!.time, riseDb: rise });
    i = j + 1;
  }
  return {
    curve,
    leadingSilenceSec: lead * step,
    trailingSilenceSec: trail * step,
    fadeInSec: fadeIn,
    fadeOutSec: fadeOut,
    peakTime: active[peakIdx]?.time ?? 0,
    peakDb: active[peakIdx]?.db ?? -Infinity,
    quietestTime: active[quietIdx]?.time ?? 0,
    quietestDb: active[quietIdx]?.db ?? -Infinity,
    medianDb,
    arc: { first, middle, last, shape },
    breakdowns: breakdowns.slice(0, 6),
    buildUps: buildUps.slice(0, 6),
    dynamicSpreadDb: pct(0.95) - pct(0.1),
  };
}
