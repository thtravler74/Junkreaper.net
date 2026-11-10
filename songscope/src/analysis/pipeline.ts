import { chromaMapping, chromaOfRow, estimateTuning, NOTE_NAMES } from "./chroma";
import { decodeChords, refineKeyWithChords, summarizeProgression } from "./chords";
import { computeDescriptors } from "./descriptors";
import { energyProfile } from "./energy";
import { hpssStream } from "./hpss";
import { estimateKey, estimateNamedKey, keyTimeline, modalFlavour } from "./key";
import { measureLoudness } from "./loudness";
import { melFilterbank, melSpectrogramDb, mfcc } from "./mel";
import { trackMelody } from "./melody";
import { onsetStrength, pickPeaks } from "./onset";
import { resample, toMono } from "./resample";
import { frameFeatures, longTermSpectrum, mean, percentileOf, std } from "./spectral";
import { analyzeStereo } from "./stereo";
import { stft } from "./stft";
import { segmentStructure } from "./structure";
import { estimateMeter, estimateSwing, estimateTempo, localTempi, trackBeats } from "./tempo";
import type { AnalysisResult, FileInfo, Previews, ProgressFn, RhythmResult } from "./types";

export const ANALYSIS_VERSION = "1.0.0";
const ANALYSIS_SR = 22050;

export interface AudioInput {
  channels: Float32Array[];
  sampleRate: number;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function analyze(audio: AudioInput, file: FileInfo, onProgress: ProgressFn = () => {}): AnalysisResult {
  const timings: { stage: string; ms: number }[] = [];
  let t0 = performance.now();
  const lap = (stage: string): void => { const now = performance.now(); timings.push({ stage, ms: Math.round(now - t0) }); t0 = now; };

  const channels = audio.channels.slice(0, 2);
  const fs = audio.sampleRate;
  const mono = toMono(channels);
  const durationSec = mono.length / fs;

  onProgress("Measuring loudness (BS.1770)", 0.02);
  const loudness = measureLoudness(channels, fs, (f) => onProgress("Measuring loudness (BS.1770)", 0.02 + f * 0.1));
  lap("loudness");
  onProgress("Analysing stereo image", 0.13);
  const stereo = analyzeStereo(channels, fs);
  lap("stereo");
  const energy = energyProfile(mono, fs);
  lap("energy");
  onProgress("Long-term spectrum", 0.16);
  const ltas = longTermSpectrum(mono, fs);
  lap("ltas");

  onProgress("Resampling", 0.18);
  const y = resample(mono, fs, ANALYSIS_SR);
  lap("resample");
  // Keep the frame count bounded for very long files.
  let hop = 512;
  while (y.length / hop > 26000) hop *= 2;
  const fftSize = 2048;
  onProgress("Short-time Fourier transform", 0.2);
  const spec = stft(y, { fftSize, hop, sampleRate: ANALYSIS_SR, onProgress: (f) => onProgress("Short-time Fourier transform", 0.2 + f * 0.1) });
  const fps = ANALYSIS_SR / hop;
  lap("stft");

  onProgress("Estimating tuning", 0.3);
  const tuning = estimateTuning(spec);
  const cmap = chromaMapping(spec, tuning.deviation);
  // Bass-register chroma (≈ A1–C4): bass notes follow chord changes but not the melody,
  // which makes this the cleaner harmonic-rhythm cue for meter estimation.
  const cmapBass = chromaMapping(spec, tuning.deviation, 55, 262);
  lap("tuning");

  onProgress("Mel spectrogram & MFCC", 0.32);
  const nMel = 64;
  const fb = melFilterbank(ANALYSIS_SR, fftSize, nMel, 30, 10000);
  const melDb = melSpectrogramDb(spec, fb);
  const nMfcc = 13;
  const mf = mfcc(melDb, nMel, nMfcc);
  lap("mel");

  onProgress("Spectral features", 0.36);
  const feats = frameFeatures(spec, y);
  lap("spectral");

  onProgress("Harmonic / percussive separation", 0.4);
  const F = spec.frames;
  const chromaH = new Float32Array(F * 12);
  const chromaBass = new Float32Array(F * 12);
  const harmE = new Float32Array(F), percE = new Float32Array(F);
  const melodyStep = 2;
  const melodyMaxBin = Math.min(spec.bins, Math.ceil((8200 * fftSize) / ANALYSIS_SR));
  const melodyRows = new Float32Array(Math.ceil(F / melodyStep) * melodyMaxBin);
  const tmp = new Float32Array(12);
  hpssStream(spec, (f, h, p) => {
    chromaOfRow(h, cmap, tmp);
    chromaH.set(tmp, f * 12);
    chromaOfRow(h, cmapBass, tmp);
    chromaBass.set(tmp, f * 12);
    let eh = 0, ep = 0;
    for (let k = 1; k < h.length; k++) { eh += h[k]! * h[k]!; ep += p[k]! * p[k]!; }
    harmE[f] = eh; percE[f] = ep;
    if (f % melodyStep === 0) melodyRows.set(h.subarray(0, melodyMaxBin), (f / melodyStep) * melodyMaxBin);
  }, { maxBin: melodyMaxBin, onProgress: (fr) => onProgress("Harmonic / percussive separation", 0.4 + fr * 0.2) });
  lap("hpss");

  onProgress("Tempo, beats and meter", 0.62);
  const onset = onsetStrength(melDb, nMel);
  // Low-band (≈ 30–200 Hz) onset strength: kicks and bass attacks, which log-compressed
  // full-band flux under-weights relative to broadband snares and hats.
  const lowBands = Math.max(2, fb.centerHz.findIndex((hz) => hz > 200));
  const melLow = new Float32Array(F * lowBands);
  for (let f = 0; f < F; f++) for (let b = 0; b < lowBands; b++) melLow[f * lowBands + b] = melDb[f * nMel + b]!;
  const onsetLow = onsetStrength(melLow, lowBands);
  const tempo = estimateTempo(onset, fps);
  const beats = trackBeats(onset, fps, tempo.bpm);
  const localAll = localTempi(onset, fps, tempo.bpm || 120);
  // Only rhythmically active, confidently estimated windows count towards stability.
  const local = localAll.filter((l) => l.confidence > 0.35 && l.activity > 0.35).map(({ time, bpm }) => ({ time, bpm }));
  const localBpms = local.map((l) => l.bpm);
  const medBpm = localBpms.length ? percentileOf(localBpms, 0.5) : 0;
  const mad = localBpms.length ? percentileOf(localBpms.map((b) => Math.abs(b - medBpm)), 0.5) : 0;
  const tempoStability = tempo.bpm && localBpms.length ? clamp01(1 - (mad / (medBpm || 1)) / 0.03) : 0;
  const ibis = beats.slice(1).map((b, i) => b - beats[i]!);
  const beatIntervalCv = ibis.length > 2 ? std(ibis) / (mean(ibis) || 1) : 1;
  // Beat-synchronous accent and harmonic change
  const beatIdx = beats.map((b) => Math.min(F - 1, Math.round(b * fps)));
  const beatAccent = new Float32Array(Math.max(0, beats.length - 1));
  const beatAccentLow = new Float32Array(Math.max(0, beats.length - 1));
  const beatChroma: Float32Array[] = [], beatBassChroma: Float32Array[] = [];
  for (let i = 0; i + 1 < beats.length; i++) {
    const a = beatIdx[i]!, b = Math.max(a + 1, beatIdx[i + 1]!);
    // Sum over ±2 frames (≈ ±46 ms): an attack that straddles a frame boundary is
    // split between two frames, and a plain max would undercount every other beat
    // whenever the beat period is a half-integer number of frames.
    let m = 0, ml = 0; for (let f = Math.max(0, a - 2); f < Math.min(F, a + 3); f++) { m += onset[f]!; ml += onsetLow[f]!; }
    beatAccent[i] = m; beatAccentLow[i] = ml;
    const c = new Float32Array(12), cb = new Float32Array(12);
    for (let f = a; f < b; f++) for (let pc = 0; pc < 12; pc++) { c[pc] = c[pc]! + chromaH[f * 12 + pc]!; cb[pc] = cb[pc]! + chromaBass[f * 12 + pc]!; }
    beatChroma.push(c);
    beatBassChroma.push(cb);
  }
  const beatChange = new Float32Array(beatChroma.length);
  for (let i = 1; i < beatChroma.length; i++) {
    const a = beatBassChroma[i - 1]!, b = beatBassChroma[i]!;
    let d = 0, na = 0, nb = 0; for (let k = 0; k < 12; k++) { d += a[k]! * b[k]!; na += a[k]! * a[k]!; nb += b[k]! * b[k]!; }
    beatChange[i] = na > 0 && nb > 0 ? 1 - d / Math.sqrt(na * nb) : 0;
  }
  onProgress("Key and chords", 0.66);
  const globalChroma = new Float64Array(12);
  for (let f = 0; f < F; f++) for (let pc = 0; pc < 12; pc++) globalChroma[pc] = globalChroma[pc]! + chromaH[f * 12 + pc]!;
  let key = estimateKey(globalChroma);
  const pcSum = globalChroma.reduce((a, b) => a + b, 0) || 1;
  const pitchClassHistogram = Array.from(globalChroma, (v, i) => ({ note: NOTE_NAMES[i]!, share: v / pcSum })).sort((a, b) => b.share - a.share);
  // Chord grid: beats if available, else 0.5 s slices
  let gridTimes: number[], gridChroma: Float32Array[];
  if (beats.length >= 8) { gridTimes = beats; gridChroma = beatChroma; }
  else {
    gridTimes = []; gridChroma = [];
    const step = Math.round(0.5 * fps);
    for (let f = 0; f < F; f += step) {
      gridTimes.push(f / fps);
      const c = new Float32Array(12);
      for (let g = f; g < Math.min(F, f + step); g++) for (let pc = 0; pc < 12; pc++) c[pc] = c[pc]! + chromaH[g * 12 + pc]!;
      gridChroma.push(c);
    }
    gridTimes.push(durationSec);
  }
  let chords = decodeChords(gridChroma, gridTimes, key);
  const refined = refineKeyWithChords(key, chords, (name) => estimateNamedKey(globalChroma, name));
  if (refined !== key) { key = refined; chords = decodeChords(gridChroma, gridTimes, key); }
  const flavour = modalFlavour(globalChroma, key);
  const kt = keyTimeline(chromaH, F, fps, key);
  const progression = summarizeProgression(chords, durationSec);
  let hSum = 0, pSum = 0; for (let f = 0; f < F; f++) { hSum += harmE[f]!; pSum += percE[f]!; }
  const harmony = { key, modalFlavour: flavour, keyTimeline: kt, pitchClassHistogram, tuning: { deviationCents: tuning.deviation * 100, a4Hz: tuning.a4Hz, confidence: tuning.confidence }, chords, progression, harmonicShare: hSum / (hSum + pSum + 1e-12) };
  lap("harmony");
  // Chord changes per beat: the decoder has already smoothed melodic notes and
  // boundary flicker out, so this is a clean bar-level cue for the meter.
  let beatChordChange: Float32Array | undefined;
  if (gridTimes === beats && beatChroma.length) {
    beatChordChange = new Float32Array(beatChroma.length);
    let bi = 0, prev = "";
    for (const seg of chords) {
      for (let k = 0; k < seg.beats && bi < beatChordChange.length; k++, bi++) beatChordChange[bi] = k === 0 && prev && seg.label !== prev ? 1 : 0;
      prev = seg.label;
    }
  }
  const meter = estimateMeter(beatAccent, beatChange, beatAccentLow, beatChordChange);
  const downbeats = beats.filter((_, i) => (i - meter.downbeatOffset) % meter.beatsPerBar === 0 && i >= meter.downbeatOffset);
  const swing = estimateSwing(onset, fps, beats);
  const peaks = pickPeaks(onset, { minDistance: Math.round(0.05 * fps), preMax: 3, postMax: 3, preAvg: Math.round(0.3 * fps), postAvg: Math.round(0.3 * fps), delta: percentileOf(onset, 0.7) * 0.3 });
  const onsets = peaks.map((p) => p.index / fps);
  // beat strength: share of tracked beats that have a detected onset within ±70 ms
  const meanOnset = (mean(onset) || 1e-6) * 5;
  let supported = 0;
  if (beats.length && onsets.length) {
    let j = 0;
    for (const b of beats) {
      while (j + 1 < onsets.length && onsets[j + 1]! < b) j++;
      const d = Math.min(Math.abs(onsets[j]! - b), Math.abs((onsets[j + 1] ?? Infinity) - b));
      if (d <= 0.07) supported++;
    }
  }
  const beatStrength = beats.length ? supported / beats.length : 0;
  // offbeat share: onset peak energy whose phase inside the beat is near 0.5 (or 0.25/0.75)
  let off = 0, tot = 0;
  if (beats.length > 2) {
    for (const p of peaks) {
      const t = p.index / fps;
      let j = 0; while (j + 1 < beats.length && beats[j + 1]! <= t) j++;
      if (j + 1 >= beats.length) continue;
      const phase = (t - beats[j]!) / (beats[j + 1]! - beats[j]!);
      tot += p.value;
      if (Math.abs(phase - 0.5) < 0.12 || Math.abs(phase - 0.25) < 0.08 || Math.abs(phase - 0.75) < 0.08) off += p.value;
    }
  }
  const tempoChanges: RhythmResult["tempoChanges"] = [];
  for (let i = 1; i + 1 < local.length; i++) {
    const a = local[i - 1]!.bpm, b = local[i]!.bpm;
    if (Math.abs(b - a) / a > 0.05 && Math.abs(local[i + 1]!.bpm - b) / b < 0.03 && (i < 2 || Math.abs(local[i - 2]!.bpm - a) / a < 0.03)) {
      const last = tempoChanges[tempoChanges.length - 1];
      if (!last || local[i]!.time - last.time > 10) tempoChanges.push({ time: local[i]!.time, fromBpm: a, toBpm: b });
    }
  }
  const rhythm: RhythmResult = {
    bpm: tempo.bpm, bpmConfidence: tempo.confidence, bpmCandidates: tempo.candidates, localTempi: local, tempoStability,
    tempoDriftBpm: localBpms.length ? percentileOf(localBpms, 0.95) - percentileOf(localBpms, 0.05) : 0,
    beats, beatAccents: Array.from(beatAccent, (v) => v / meanOnset), beatStrength, beatIntervalCv, meter, barsEstimate: Math.floor(Math.max(0, beats.length - 1) / meter.beatsPerBar), downbeats, swing, onsets,
    onsetsPerSecond: durationSec > 0 ? onsets.length / durationSec : 0, offbeatShare: tot > 0 ? off / tot : 0, tempoChanges,
  };
  lap("rhythm");


  onProgress("Structure", 0.78);
  // Slices: pairs of beats (half-bars) or 1 s windows
  const sliceBounds: number[] = [];
  if (beats.length >= 16) { for (let i = 0; i < beats.length; i += 2) sliceBounds.push(beats[i]!); if (sliceBounds[sliceBounds.length - 1]! < durationSec - 0.5) sliceBounds.push(durationSec); }
  else { for (let t = 0; t < durationSec; t += 1) sliceBounds.push(t); sliceBounds.push(durationSec); }
  const vectors: Float32Array[] = [], sliceLevel: number[] = [], slicePerc: number[] = [], sliceCentroid: number[] = [];
  for (let i = 0; i + 1 < sliceBounds.length; i++) {
    const a = Math.min(F - 1, Math.round(sliceBounds[i]! * fps)), b = Math.max(a + 1, Math.min(F, Math.round(sliceBounds[i + 1]! * fps)));
    const v = new Float32Array(nMfcc - 1 + 12 + 4);
    let lv = 0, pe = 0, he = 0, ce = 0;
    for (let f = a; f < b; f++) {
      for (let k = 1; k < nMfcc; k++) v[k - 1] = v[k - 1]! + mf[f * nMfcc + k]!;
      for (let pc = 0; pc < 12; pc++) v[nMfcc - 1 + pc] = v[nMfcc - 1 + pc]! + chromaH[f * 12 + pc]!;
      lv += feats.rmsDb[f]!; pe += percE[f]!; he += harmE[f]!; ce += feats.centroid[f]!;
    }
    const c = b - a;
    for (let k = 0; k < nMfcc - 1; k++) v[k] = v[k]! / c;
    // chroma: normalise and weight so that harmony counts about as much as timbre
    let cs = 0; for (let pc = 0; pc < 12; pc++) cs += v[nMfcc - 1 + pc]!;
    for (let pc = 0; pc < 12; pc++) v[nMfcc - 1 + pc] = cs > 0 ? (v[nMfcc - 1 + pc]! / cs) * 30 : 0;
    // Level and percussive share as two extra dimensions: section changes almost
    // always coincide with a change in loudness or density.
    // (level is repeated so that, after per-dimension z-scoring, it carries about the weight of the chroma block)
    v[nMfcc - 1 + 12] = lv / c; v[nMfcc - 1 + 13] = lv / c; v[nMfcc - 1 + 14] = lv / c;
    v[nMfcc - 1 + 15] = (pe / (pe + he + 1e-12)) * 40;
    vectors.push(v); sliceLevel.push(lv / c); slicePerc.push(pe / (pe + he + 1e-12)); sliceCentroid.push(ce / c);
  }
  const structure = segmentStructure({ times: sliceBounds, vectors, levelDb: Float32Array.from(sliceLevel), percussive: Float32Array.from(slicePerc), centroid: Float32Array.from(sliceCentroid) }, { durationSec, downbeats });
  for (const s of structure.sections) {
    const inside = new Map<string, number>();
    for (const c of chords) { const ov = Math.min(c.end, s.end) - Math.max(c.start, s.start); if (ov > 0 && c.quality !== "N") inside.set(c.label, (inside.get(c.label) ?? 0) + ov); }
    const top = [...inside.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) s.dominantChord = top[0];
    if (energy.fadeOutSec > 0 && s.end >= durationSec - 0.6 && s === structure.sections[structure.sections.length - 1]) s.notes.push(`fades out over ~${energy.fadeOutSec.toFixed(0)} s`);
    if (energy.fadeInSec > 0 && s.start <= 0.6 && s.index === 0) s.notes.push(`fades in over ~${energy.fadeInSec.toFixed(0)} s`);
  }
  lap("structure");

  onProgress("Melody and voice", 0.86);
  const melody = trackMelody((f) => melodyRows.subarray((f / melodyStep) * melodyMaxBin, (f / melodyStep + 1) * melodyMaxBin), spec, melodyStep);
  lap("melody");

  onProgress("Timbre summary", 0.92);
  const mfccMeans: number[] = [];
  for (let k = 0; k < nMfcc; k++) { let s = 0; for (let f = 0; f < F; f++) s += mf[f * nMfcc + k]!; mfccMeans.push(s / F); }
  // Only frames with signal contribute to timbre averages.
  const active: number[] = []; for (let f = 0; f < F; f++) if (feats.rmsDb[f]! > -60) active.push(f);
  const pick = (arr: Float32Array): number[] => active.map((f) => arr[f]!);
  const centroids = pick(feats.centroid);
  const timbreDescriptors: string[] = [];
  const mc = mean(centroids);
  timbreDescriptors.push(mc < 1000 ? "dark / bass-heavy" : mc < 1800 ? "warm" : mc < 2800 ? "balanced" : mc < 4000 ? "bright" : "very bright / harsh");
  const mflat = mean(pick(feats.flatness));
  timbreDescriptors.push(mflat < 0.03 ? "strongly tonal, clean" : mflat < 0.1 ? "tonal with some noise/texture" : mflat < 0.25 ? "dense, saturated" : "noisy / distorted");
  const pShare = pSum / (hSum + pSum + 1e-12);
  timbreDescriptors.push(pShare < 0.25 ? "sustained, pad-like" : pShare < 0.45 ? "mixed sustained and percussive" : pShare < 0.6 ? "percussive, rhythm-forward" : "very percussive / transient-heavy");
  const ctStep = Math.max(1, Math.floor(F / 600));
  const timbre = {
    meanCentroidHz: mc, centroidStdHz: std(centroids), meanBandwidthHz: mean(pick(feats.bandwidth)), meanRolloff85Hz: mean(pick(feats.rolloff85)), meanRolloff95Hz: mean(pick(feats.rolloff95)),
    meanFlatness: mflat, meanEntropy: mean(pick(feats.entropy)), meanZcr: mean(pick(feats.zcr)), percussiveShare: pShare,
    bandEnergies: ltas.bandEnergies, longTermSpectrum: ltas.bands, tiltDbPerOctave: ltas.tiltDbPerOctave, effectiveBandwidthHz: ltas.effectiveBandwidthHz, bandwidthCliff: ltas.cliffDetected, nyquistHz: ltas.nyquistHz, spectralPeaks: ltas.peaks,
    mfccMeans, centroidOverTime: Array.from({ length: Math.ceil(F / ctStep) }, (_, i) => ({ time: spec.frameTime(i * ctStep), hz: feats.centroid[i * ctStep]! })), descriptors: timbreDescriptors,
  };
  lap("timbre");

  onProgress("Rendering previews", 0.95);
  const previews = buildPreviews(mono, melDb, nMel, F, structure.ssmPreview);
  lap("previews");

  const partial = { version: ANALYSIS_VERSION, analyzedAt: new Date().toISOString(), file, durationSec, sampleRate: fs, channels: channels.length, analysisSampleRate: ANALYSIS_SR, rhythm, harmony, loudness, stereo, energy, timbre, structure, melody, timings };
  const descriptors = computeDescriptors(partial);
  onProgress("Done", 1);
  return { ...partial, descriptors, previews };
}

function buildPreviews(mono: Float32Array, melDb: Float32Array, nMel: number, frames: number, ssm: Previews["ssm"]): Previews {
  const columns = Math.min(1600, mono.length);
  const min = new Float32Array(columns), max = new Float32Array(columns);
  for (let c = 0; c < columns; c++) {
    const a = Math.floor((c * mono.length) / columns), b = Math.max(a + 1, Math.floor(((c + 1) * mono.length) / columns));
    let lo = 1, hi = -1;
    for (let i = a; i < b; i++) { const v = mono[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
    min[c] = lo; max[c] = hi;
  }
  const cols = Math.min(1200, frames);
  const data = new Uint8Array(cols * nMel);
  let dmax = -Infinity; for (let i = 0; i < melDb.length; i++) if (melDb[i]! > dmax) dmax = melDb[i]!;
  for (let c = 0; c < cols; c++) {
    const a = Math.floor((c * frames) / cols), b = Math.max(a + 1, Math.floor(((c + 1) * frames) / cols));
    for (let m = 0; m < nMel; m++) {
      let v = -Infinity; for (let f = a; f < b; f++) v = Math.max(v, melDb[f * nMel + m]!);
      data[c * nMel + m] = Math.round(255 * clamp01((v - (dmax - 80)) / 80));
    }
  }
  return { waveform: { min, max, columns }, melSpectrogram: { data, columns: cols, rows: nMel, maxHz: 10000 }, ssm };
}
