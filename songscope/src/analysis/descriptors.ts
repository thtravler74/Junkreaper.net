import type { AnalysisResult } from "./types";

export interface Descriptors {
  energy: number;
  danceability: number;
  acousticness: number;
  valence: number;
  aggressiveness: number;
  complexity: number;
  instrumentalness: number;
  brightness: number;
  moods: string[];
  genres: { name: string; score: number; reasons: string[] }[];
  tempoMarking: string;
  tempoFeel: string;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const ramp = (x: number, lo: number, hi: number): number => clamp01((x - lo) / (hi - lo));
/** Triangular membership: 1 at [a,b], fading to 0 at a−w and b+w. */
const within = (x: number, a: number, b: number, w: number): number => (x >= a && x <= b ? 1 : x < a ? clamp01(1 - (a - x) / w) : clamp01(1 - (x - b) / w));

export function tempoMarking(bpm: number): string {
  if (!bpm) return "unknown";
  if (bpm < 40) return "Grave";
  if (bpm < 60) return "Largo";
  if (bpm < 66) return "Larghetto";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 156) return "Allegro";
  if (bpm < 176) return "Vivace";
  if (bpm < 200) return "Presto";
  return "Prestissimo";
}

export function computeDescriptors(r: Omit<AnalysisResult, "descriptors">): Descriptors {
  const bpm = r.rhythm.bpm;
  const loud = r.loudness.integratedLufs;
  const perc = r.timbre.percussiveShare;
  const harm = 1 - perc;
  const centroid = r.timbre.meanCentroidHz;
  const flat = r.timbre.meanFlatness;
  const onsetRate = r.rhythm.onsetsPerSecond;
  const beatStrength = r.rhythm.beatStrength;
  const tempoStab = r.rhythm.tempoStability;
  const isMinor = r.harmony.key.mode === "minor";
  const lra = r.loudness.loudnessRangeLu;
  const bass = r.timbre.bandEnergies.find((b) => b.name === "Bass")?.share ?? 0;
  const sub = r.timbre.bandEnergies.find((b) => b.name === "Sub-bass")?.share ?? 0;
  const high = (r.timbre.bandEnergies.find((b) => b.name === "Brilliance")?.share ?? 0) + (r.timbre.bandEnergies.find((b) => b.name === "Presence")?.share ?? 0);
  const changesPerMin = r.harmony.progression.changesPerMinute;
  const distinct = r.harmony.progression.distinctChords;
  const vocal = r.melody.vocalLikelihood;
  const swing = r.rhythm.swing.ratio;
  const dynSpread = r.energy.dynamicSpreadDb;

  const energy = clamp01(0.35 * ramp(loud, -30, -7) + 0.25 * ramp(onsetRate, 0.5, 6) + 0.2 * ramp(centroid, 800, 3500) + 0.2 * perc);
  const danceability = clamp01(0.35 * beatStrength + 0.25 * tempoStab + 0.2 * within(bpm, 95, 135, 35) + 0.2 * ramp(bass + sub, 0.15, 0.5));
  const acousticness = clamp01(0.4 * harm + 0.25 * (1 - ramp(sub, 0.02, 0.15)) + 0.2 * (1 - ramp(loud, -20, -8)) + 0.15 * ramp(lra, 4, 14));
  const valence = clamp01(0.35 * (isMinor ? 0.3 : 0.75) + 0.25 * within(bpm, 100, 140, 40) + 0.2 * ramp(centroid, 900, 3000) + 0.2 * r.harmony.progression.diatonicShare);
  const aggressiveness = clamp01(0.3 * ramp(loud, -16, -6) + 0.25 * ramp(flat, 0.05, 0.35) + 0.2 * ramp(onsetRate, 2, 8) + 0.25 * ramp(high, 0.08, 0.3));
  const complexity = clamp01(0.3 * ramp(distinct, 3, 12) + 0.25 * ramp(changesPerMin, 10, 60) + 0.2 * ramp(onsetRate, 1, 8) + 0.25 * (1 - tempoStab * 0.5) * ramp(r.rhythm.meter.beatsPerBar === 4 ? 0 : 1, 0, 1) + 0.15 * ramp(r.harmony.progression.borrowed.length, 0, 4));
  const instrumentalness = clamp01(1 - vocal);
  const brightness = ramp(centroid, 600, 4000);

  const moods: string[] = [];
  if (energy > 0.65 && valence > 0.55) moods.push("euphoric", "upbeat");
  if (energy > 0.65 && valence <= 0.55) moods.push(isMinor ? "intense" : "driving", aggressiveness > 0.6 ? "aggressive" : "urgent");
  if (energy <= 0.4 && valence > 0.55) moods.push("relaxed", "warm");
  if (energy <= 0.4 && valence <= 0.55) moods.push(isMinor ? "melancholic" : "wistful", "introspective");
  if (energy > 0.4 && energy <= 0.65) moods.push(valence > 0.5 ? "confident" : "brooding");
  if (isMinor && valence < 0.4) moods.push("dark");
  if (acousticness > 0.65) moods.push("organic");
  if (brightness > 0.7) moods.push("bright");
  else if (brightness < 0.3) moods.push("mellow");
  if (lra > 10) moods.push("dramatic");
  if (danceability > 0.7) moods.push("groovy");

  const g: { name: string; score: number; reasons: string[] }[] = [];
  const add = (name: string, parts: [number, number, string][]): void => {
    const wsum = parts.reduce((a, p) => a + p[1], 0);
    const score = parts.reduce((a, p) => a + p[0] * p[1], 0) / wsum;
    const reasons = parts.filter((p) => p[0] >= 0.6).map((p) => p[2]);
    g.push({ name, score, reasons });
  };
  add("Electronic / dance", [[within(bpm, 118, 135, 15), 2, "tempo in the house/techno range"], [ramp(sub, 0.04, 0.2), 2, "strong sub-bass"], [tempoStab, 2, "machine-steady tempo"], [ramp(perc, 0.35, 0.6), 1, "percussive"], [ramp(loud, -14, -7), 1, "loud master"], [1 - ramp(distinct, 4, 10), 1, "small chord vocabulary"]]);
  add("Hip-hop / trap", [[within(bpm, 65, 100, 12) * 0.7 + within(bpm, 130, 175, 15) * 0.6, 2, "tempo typical of hip-hop (or its double-time feel)"], [ramp(sub, 0.05, 0.2), 2, "heavy sub-bass (808s)"], [ramp(vocal, 0.4, 0.8), 1.5, "prominent voice"], [1 - ramp(changesPerMin, 10, 40), 1.5, "static harmony / loops"], [tempoStab, 1, "steady tempo"]]);
  add("Rock", [[within(bpm, 100, 160, 25), 1.5, "mid-to-fast tempo"], [ramp(flat, 0.04, 0.2), 1.5, "dense, distorted spectrum"], [ramp(high, 0.1, 0.3), 1, "bright, present guitars/cymbals"], [within(distinct, 4, 9, 4), 1, "guitar-sized chord vocabulary"], [ramp(perc, 0.3, 0.55), 1, "drum-driven"], [1 - ramp(sub, 0.02, 0.12), 1, "little sub-bass"]]);
  add("Metal", [[ramp(bpm, 120, 190), 1, "fast tempo"], [ramp(flat, 0.08, 0.3), 2, "wall-of-sound spectrum"], [ramp(aggressiveness, 0.5, 0.9), 2, "aggressive"], [ramp(loud, -12, -6), 1, "very loud master"], [ramp(onsetRate, 4, 9), 1, "dense onsets"], [isMinor ? 1 : 0.3, 1, "minor tonality"]]);
  add("Pop", [[within(bpm, 95, 130, 25), 1.5, "pop tempo"], [ramp(vocal, 0.4, 0.8), 2, "lead vocal"], [ramp(loud, -14, -8), 1, "radio-loud master"], [within(distinct, 3, 6, 3), 1, "four-chord style harmony"], [ramp(r.structure.repetitionScore, 0.3, 0.7), 1.5, "repeating verse/chorus form"], [isMinor ? 0.5 : 1, 1, "major key"]]);
  add("R&B / soul", [[within(bpm, 60, 100, 15), 2, "slow-to-medium groove"], [ramp(vocal, 0.5, 0.9), 2, "expressive lead vocal"], [ramp(distinct, 5, 12), 1.5, "extended chord vocabulary"], [ramp(swing, 0.53, 0.62), 1, "swung sixteenths"], [ramp(bass, 0.15, 0.4), 1, "warm bass"]]);
  add("Jazz", [[ramp(distinct, 7, 16), 2.5, "rich chord vocabulary"], [ramp(changesPerMin, 30, 80), 2, "fast harmonic rhythm"], [ramp(swing, 0.56, 0.66), 2, "swing feel"], [1 - tempoStab, 1, "human tempo fluctuation"], [ramp(acousticness, 0.5, 0.9), 1, "acoustic timbres"], [1 - ramp(loud, -16, -9), 1, "dynamic master"]]);
  add("Classical / orchestral", [[1 - beatStrength, 2, "weak or absent beat"], [ramp(lra, 8, 20), 2, "wide loudness range"], [ramp(acousticness, 0.6, 0.95), 2, "acoustic, harmonic timbre"], [1 - ramp(perc, 0.2, 0.45), 1.5, "little percussion"], [1 - ramp(loud, -24, -12), 1, "quiet master"], [1 - vocal, 0.5, "no lead vocal"]]);
  add("Folk / acoustic", [[ramp(acousticness, 0.55, 0.9), 2.5, "acoustic timbre"], [within(bpm, 70, 125, 25), 1, "relaxed tempo"], [ramp(vocal, 0.4, 0.8), 1.5, "voice-led"], [1 - ramp(sub, 0.01, 0.08), 1, "no sub-bass"], [ramp(r.harmony.progression.diatonicShare, 0.7, 1), 1, "diatonic harmony"], [1 - ramp(loud, -18, -9), 1, "moderate loudness"]]);
  add("Ambient / downtempo", [[1 - beatStrength, 2, "little or no pulse"], [1 - ramp(onsetRate, 0.5, 2.5), 2, "sparse onsets"], [1 - ramp(changesPerMin, 5, 25), 1.5, "slow harmonic motion"], [1 - ramp(loud, -22, -12), 1, "quiet"], [1 - ramp(centroid, 1200, 3000), 1, "soft, dark timbre"]]);
  add("Country", [[within(bpm, 80, 130, 20), 1, "moderate tempo"], [ramp(acousticness, 0.4, 0.8), 1.5, "acoustic instruments"], [ramp(vocal, 0.4, 0.8), 1.5, "lead vocal"], [ramp(r.harmony.progression.diatonicShare, 0.8, 1), 2, "strictly diatonic chords"], [isMinor ? 0.3 : 1, 1, "major key"], [within(distinct, 3, 5, 2), 1, "three-to-four-chord harmony"]]);
  add("Reggae / dub", [[within(bpm, 60, 95, 12), 2, "reggae tempo"], [ramp(bass, 0.2, 0.45), 2, "dominant bass"], [1 - ramp(high, 0.05, 0.2), 1, "rolled-off top end"], [1 - ramp(changesPerMin, 10, 30), 1.5, "two-chord riddims"], [ramp(r.rhythm.offbeatShare, 0.4, 0.7), 1.5, "off-beat emphasis"]]);
  add("Blues", [[within(bpm, 60, 120, 20), 1, "blues tempo"], [ramp(swing, 0.56, 0.68), 2, "shuffle feel"], [r.harmony.modalFlavour.label === "Blues" || r.harmony.modalFlavour.label === "Mixolydian" ? 1 : 0.2, 2, "blues/Mixolydian pitch content"], [ramp(r.harmony.progression.topChords.filter((c) => c.roman.includes("7")).length, 1, 3), 1.5, "dominant-7th harmony"], [within(distinct, 3, 6, 3), 1, "I-IV-V sized vocabulary"]]);
  add("Lo-fi / chillhop", [[within(bpm, 70, 95, 12), 2, "lo-fi tempo"], [ramp(r.timbre.effectiveBandwidthHz < 14000 ? 1 : 0, 0, 1), 1.5, "rolled-off, band-limited top end"], [ramp(r.loudness.noiseFloorDbfs, -70, -45), 1.5, "audible noise floor"], [ramp(distinct, 5, 10), 1, "jazzy chord vocabulary"], [1 - ramp(loud, -18, -10), 1, "gentle loudness"]]);
  add("Punk", [[ramp(bpm, 150, 200), 2, "very fast tempo"], [ramp(flat, 0.05, 0.25), 1.5, "distorted"], [1 - ramp(distinct, 3, 7), 1.5, "three-chord harmony"], [ramp(onsetRate, 4, 9), 1, "relentless onsets"], [within(dynSpread, 0, 6, 4), 1, "flat dynamics"]]);
  add("Drum & bass / breakbeat", [[within(bpm, 160, 180, 10) + within(bpm, 80, 90, 5) * 0.8, 3, "tempo at 170 BPM (or half-time 85)"], [ramp(sub, 0.05, 0.2), 2, "deep sub-bass"], [ramp(onsetRate, 4, 10), 1.5, "fast breakbeats"], [tempoStab, 1, "locked tempo"]]);
  g.sort((a, b) => b.score - a.score);
  const genres = g.slice(0, 4);

  let tempoFeel = "";
  if (bpm) {
    if (bpm < 70) tempoFeel = "a slow, spacious pulse";
    else if (bpm < 90) tempoFeel = "a laid-back, head-nodding groove";
    else if (bpm < 110) tempoFeel = "a relaxed walking pace";
    else if (bpm < 130) tempoFeel = "a steady, danceable drive";
    else if (bpm < 150) tempoFeel = "an energetic, propulsive drive";
    else if (bpm < 175) tempoFeel = "a fast, urgent pulse";
    else tempoFeel = "a very fast pulse that may be felt in half-time";
  }
  return { energy, danceability, acousticness, valence, aggressiveness, complexity, instrumentalness, brightness, moods: [...new Set(moods)].slice(0, 6), genres, tempoMarking: tempoMarking(bpm), tempoFeel };
}
