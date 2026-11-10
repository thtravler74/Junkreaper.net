import { hzToMidi, midiToName } from "./chroma";
import type { Spectrogram } from "./stft";

export interface MelodyResult {
  voicedShare: number; // fraction of frames with a confident predominant pitch
  medianMidi: number;
  lowMidi: number; // 5th percentile
  highMidi: number; // 95th percentile
  lowNote: string;
  highNote: string;
  medianNote: string;
  rangeSemitones: number;
  vibratoShare: number; // fraction of voiced frames showing 4–8 Hz pitch modulation
  vibratoExtentCents: number;
  pitchContour: { time: number; midi: number }[];
  /** Heuristic 0..1 estimate that a lead vocal is present. */
  vocalLikelihood: number;
  /** Mean rate of pitch change (semitones/second) in voiced regions: melodic activity. */
  pitchActivity: number;
  /** Note changes per second of voiced material. */
  noteRate: number;
  /** Median and 90th-percentile salience (peak-to-mean of the harmonic summation), for diagnostics. */
  salienceP50: number;
  salienceP90: number;
}

/**
 * Predominant-pitch tracking by harmonic summation on the harmonic spectrogram
 * (log-spaced f0 grid, 10-cent resolution, 8 harmonics with decaying weights).
 */
const SALIENCE_THRESHOLD = 1.35;

export function trackMelody(harmonicRows: (f: number) => Float32Array, spec: Spectrogram, frameStep = 2): MelodyResult {
  // A2–C♯6: the register where sung and played leads live; the bass register is excluded
  // because a bass note's harmonic series coincides with everything above it.
  const fmin = 110, fmax = 1100;
  const grid: number[] = [];
  for (let m = hzToMidi(fmin); m <= hzToMidi(fmax); m += 0.1) grid.push(m);
  const freqs = grid.map((m) => 440 * 2 ** ((m - 69) / 12));
  const binHz = spec.sampleRate / spec.fftSize;
  const nH = 8;
  const weights = Array.from({ length: nH }, (_, h) => 0.6 ** h);
  // Leads sit above the bass: weight candidates by pitch height (√(f/220), clipped) so a
  // bass note that merely collects the chord's harmonics does not win by default.
  const heightW = freqs.map((f) => Math.max(0.6, Math.min(1.6, Math.sqrt(f / 220))));
  const contour: { time: number; midi: number; salience: number; energy: number }[] = [];
  for (let f = 0; f < spec.frames; f += frameStep) {
    const row = harmonicRows(f);
    let total = 0; for (let k = 1; k < row.length; k++) total += row[k]!;
    if (total < 1e-5) { contour.push({ time: spec.frameTime(f), midi: NaN, salience: 0, energy: total }); continue; }
    let best = -1, bestS = 0, sum = 0;
    const sal = new Float64Array(freqs.length);
    for (let i = 0; i < freqs.length; i++) {
      let s = 0;
      for (let h = 1; h <= nH; h++) {
        const k = Math.round((freqs[i]! * h) / binHz);
        if (k >= row.length) break;
        // take max of neighbouring bins for robustness
        // square-root compression keeps one loud low note from dominating the summation
        const v = Math.sqrt(Math.max(row[k]!, row[k - 1] ?? 0, row[k + 1] ?? 0));
        s += weights[h - 1]! * v;
      }
      s *= heightW[i]!;
      sal[i] = s; sum += s;
      if (s > bestS) { bestS = s; best = i; }
    }
    // Octave check, applied repeatedly: if the candidate an octave above is nearly as
    // salient, the lower one is probably a sub-harmonic of it.
    for (let guard = 0; best >= 0 && guard < 3; guard++) {
      const up = best + 120; // 12 semitones at 0.1-semitone steps
      if (up < sal.length && sal[up]! > bestS * 0.75) { best = up; bestS = sal[up]!; } else break;
    }
    // Salience: how much the winner dominates the strongest *unrelated* competitor —
    // a candidate that is not within 1.5 semitones, nor an octave/fifth/fourth away
    // (those share harmonics with the winner). Simultaneous chord tones (thirds,
    // sixths) therefore keep the ratio near 1, while a lead note on top pushes it up.
    let competitor = 0;
    if (best >= 0) {
      for (let i = 0; i < sal.length; i++) {
        const d = Math.abs(i - best) / 10; // semitones
        const m = ((d % 12) + 12) % 12;
        if (d < 1.5 || Math.min(m, 12 - m) < 0.5 || Math.abs(m - 7) < 0.5 || Math.abs(m - 5) < 0.5) continue;
        if (sal[i]! > competitor) competitor = sal[i]!;
      }
    }
    void sum;
    const salience = competitor > 0 ? bestS / competitor : bestS > 0 ? 10 : 0;
    contour.push({ time: spec.frameTime(f), midi: best >= 0 ? grid[best]! : NaN, salience, energy: total });
  }
  // Voicing decision: salience above threshold and energy above 5 % of median energy.
  const energies = contour.map((c) => c.energy).filter((e) => e > 0).sort((a, b) => a - b);
  const medE = energies[energies.length >> 1] ?? 0;
  const voiced = contour.filter((c) => !Number.isNaN(c.midi) && c.salience > SALIENCE_THRESHOLD && c.energy > medE * 0.1);
  // Median filter the voiced pitch over 5 points to suppress octave flips.
  const mids = voiced.map((c) => c.midi);
  // 3-point median: removes single-frame octave flips without flattening vibrato.
  const smooth = mids.map((_, i) => { const w = mids.slice(Math.max(0, i - 1), i + 2).sort((a, b) => a - b); return w[w.length >> 1]!; });
  const sorted = [...smooth].sort((a, b) => a - b);
  const pct = (p: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]! : NaN);
  const lowMidi = pct(0.05), highMidi = pct(0.95), medianMidi = pct(0.5);
  // Vibrato: in sliding 0.5 s windows of consecutive voiced frames, look for a 4–8 Hz oscillation of ±20–150 cents.
  const fps = spec.sampleRate / spec.hop / frameStep;
  const win = Math.max(4, Math.round(0.4 * fps));
  let vibFrames = 0, vibExtent = 0, vibCount = 0, activity = 0, actCount = 0;
  for (let i = 0; i + win <= smooth.length; i += win >> 1) {
    const seg = smooth.slice(i, i + win);
    // check contiguity in time
    if (voiced[i + win - 1]!.time - voiced[i]!.time > (win / fps) * 1.5) continue;
    const m = seg.reduce((a, b) => a + b, 0) / seg.length;
    const dev = seg.map((v) => v - m);
    // count zero crossings → frequency estimate
    let zc = 0; for (let j = 1; j < dev.length; j++) if ((dev[j]! >= 0) !== (dev[j - 1]! >= 0)) zc++;
    const freq = zc / 2 / (win / fps);
    const extent = (Math.max(...seg) - Math.min(...seg)) * 100; // cents
    if (freq >= 3.5 && freq <= 9 && extent >= 25 && extent <= 300) { vibFrames += win; vibExtent += extent; vibCount++; }
    for (let j = 1; j < seg.length; j++) { activity += Math.abs(seg[j]! - seg[j - 1]!) * fps; actCount++; }
  }
  // Note rate: changes of more than 0.8 semitone between time-contiguous voiced frames.
  let noteChanges = 0, voicedSeconds = 0;
  for (let i = 1; i < voiced.length; i++) {
    const dt = voiced[i]!.time - voiced[i - 1]!.time;
    if (dt > 0.6) continue; // a real pause: do not count across it
    voicedSeconds += Math.min(dt, 2 / fps);
    if (Math.abs(smooth[i]! - smooth[i - 1]!) > 0.8) noteChanges++;
  }
  // rate per second of the span the lead occupies (voiced time plus short gaps between notes)
  const span = voiced.length ? voiced[voiced.length - 1]!.time - voiced[0]!.time : 0;
  const noteRate = span > 0 ? noteChanges / Math.max(span * (voiced.length / Math.max(1, contour.length)) + voicedSeconds, voicedSeconds) : 0;
  const voicedShare = contour.length ? voiced.length / contour.length : 0;
  const salSorted = contour.map((c) => c.salience).filter((v) => v > 0).sort((a, b) => a - b);
  const salienceP50 = salSorted[Math.floor(salSorted.length * 0.5)] ?? 0, salienceP90 = salSorted[Math.floor(salSorted.length * 0.9)] ?? 0;
  const vibratoShare = voiced.length ? Math.min(1, vibFrames / voiced.length) : 0;
  // Vocal likelihood heuristic: a voiced predominant pitch in the singing range for a
  // good share of the time, moderate pitch activity (not sustained pads, not rapid lead runs),
  // and some vibrato. Clearly labelled as a heuristic in the report.
  const inSingingRange = sorted.length ? sorted.filter((m) => m >= 45 && m <= 84).length / sorted.length : 0; // A2..C6
  const act = actCount ? activity / actCount : 0;
  // A sung or played lead changes note roughly 0.8–6 times a second; sustained chord
  // roots change far less often, rapid instrumental runs far more.
  const noteRateScore = noteRate >= 0.8 && noteRate <= 6 ? 1 : noteRate > 6 ? 0.4 : 0.15;
  const vocalLikelihood = Math.max(0, Math.min(1, 0.15 * Math.min(1, voicedShare / 0.4) + 0.1 * inSingingRange + 0.4 * Math.min(1, vibratoShare / 0.15) + 0.35 * noteRateScore));
  const step = Math.max(1, Math.floor(contour.length / 1200));
  return {
    voicedShare,
    medianMidi,
    lowMidi,
    highMidi,
    lowNote: Number.isNaN(lowMidi) ? "–" : midiToName(lowMidi),
    highNote: Number.isNaN(highMidi) ? "–" : midiToName(highMidi),
    medianNote: Number.isNaN(medianMidi) ? "–" : midiToName(medianMidi),
    rangeSemitones: Number.isNaN(highMidi) ? 0 : highMidi - lowMidi,
    vibratoShare,
    vibratoExtentCents: vibCount ? vibExtent / vibCount : 0,
    pitchContour: contour.filter((_, i) => i % step === 0).map((c) => ({ time: c.time, midi: c.salience > SALIENCE_THRESHOLD && c.energy > medE * 0.1 ? c.midi : NaN })),
    vocalLikelihood,
    pitchActivity: act,
    noteRate,
    salienceP50,
    salienceP90,
  };
}
