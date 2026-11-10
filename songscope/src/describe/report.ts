import type { AnalysisResult } from "../analysis/types";
import { bytes, confidenceWord, dB, hz, level, list, mmss, num, pct } from "./format";
import { describeProgression } from "./progressions";

export interface Fact { label: string; value: string; note?: string }
export interface Table { columns: string[]; rows: string[][] }
export interface ReportSection { id: string; title: string; paragraphs: string[]; facts?: Fact[]; table?: Table; bullets?: string[] }
export interface Report { title: string; subtitle: string; summary: string[]; sections: ReportSection[]; wordCount: number }

const PLATFORM_TARGETS: { name: string; lufs: number; truePeak: number }[] = [
  { name: "Spotify", lufs: -14, truePeak: -1 },
  { name: "Apple Music", lufs: -16, truePeak: -1 },
  { name: "YouTube", lufs: -14, truePeak: -1 },
  { name: "Amazon Music / Tidal", lufs: -14, truePeak: -1 },
  { name: "EBU R128 broadcast", lufs: -23, truePeak: -1 },
];

export function buildReport(r: AnalysisResult): Report {
  const sections: ReportSection[] = [
    overview(r), fileSection(r), rhythmSection(r), keySection(r), chordSection(r), structureSection(r),
    energySection(r), loudnessSection(r), timbreSection(r), stereoSection(r), melodySection(r), characterSection(r), methodSection(r),
  ];
  const title = r.file.tags.title ? `${r.file.tags.title}${r.file.tags.artist ? ` — ${r.file.tags.artist}` : ""}` : r.file.name;
  const subtitle = `${mmss(r.durationSec)} · ${r.harmony.key.name} · ${num(r.rhythm.bpm, 0)} BPM · ${r.rhythm.meter.label} · ${num(r.loudness.integratedLufs, 1)} LUFS`;
  const summary = sections[0]!.paragraphs;
  const text = sections.flatMap((s) => [...s.paragraphs, ...(s.bullets ?? []), ...(s.facts ?? []).map((f) => `${f.label} ${f.value} ${f.note ?? ""}`)]).join(" ");
  return { title, subtitle, summary, sections, wordCount: text.split(/\s+/).filter(Boolean).length };
}

// ───────────────────────────────────────────────────────────────────────────────

function overview(r: AnalysisResult): ReportSection {
  const k = r.harmony.key, rh = r.rhythm, d = r.descriptors, lo = r.loudness;
  const paras: string[] = [];
  const who = r.file.tags.title ? `“${r.file.tags.title}”${r.file.tags.artist ? ` by ${r.file.tags.artist}` : ""}` : `“${r.file.name}”`;
  const fmt = r.file.codec ? `${r.file.codec}${r.file.lossless === false && r.file.bitrateKbps ? ` at about ${Math.round(r.file.bitrateKbps)} kbps` : ""}` : (r.file.mimeType || "audio");
  paras.push(
    `${who} is a ${mmss(r.durationSec)} ${r.channels === 1 ? "mono" : r.stereo.isDualMono ? "dual-mono (identical channels)" : "stereo"} recording delivered as ${fmt} at ${(r.sampleRate / 1000).toFixed(1)} kHz. ` +
    `It sits in ${k.name} (${confidenceWord(k.confidence)}; the runner-up reading is ${k.scores[1]?.name ?? "–"}) and moves at about ${num(rh.bpm, 1)} BPM, ` +
    `which is ${d.tempoMarking.toLowerCase()} territory — ${d.tempoFeel}. The pulse is best heard in ${rh.meter.label}, ${rh.swing.label === "straight" ? "with straight subdivisions" : `with ${rh.swing.label} subdivisions`}, and the tempo is ${tempoStabilityWord(rh.tempoStability)}.`,
  );
  const form = r.structure.sections.length > 1 ? `The form reads ${r.structure.formString}` : "The piece plays as one continuous section";
  const loud = `${num(lo.integratedLufs, 1)} LUFS integrated with a loudness range of ${num(lo.loudnessRangeLu, 1)} LU and a true peak of ${num(lo.truePeakDbtp, 1)} dBTP`;
  paras.push(
    `${form}, with the loudest passage arriving at ${mmss(r.energy.peakTime)} and the overall energy ${r.energy.arc.shape}. ` +
    `The master measures ${loud}, which is ${loudnessCharacter(lo)}. Harmonically the song leans on ${r.harmony.progression.distinctChords} distinct chord${r.harmony.progression.distinctChords === 1 ? "" : "s"}` +
    `${r.harmony.progression.topChords.length ? `, most of all ${list(r.harmony.progression.topChords.slice(0, 3).map((c) => `${c.label} (${c.roman})`))}` : ""}, changing roughly every ${num(r.harmony.progression.averageBeatsPerChord, 1)} beats.`,
  );
  const vocal = r.melody.vocalLikelihood >= 0.6 ? "a lead voice or sustained melodic line is likely present" : r.melody.vocalLikelihood >= 0.35 ? "a melodic lead may be present intermittently" : "no strong predominant melody was found, so the track is probably instrumental or texture-led";
  const genres = d.genres.slice(0, 2).map((g) => g.name.toLowerCase());
  paras.push(
    `The timbre is ${r.timbre.descriptors.join(", ")}, with a long-term spectral tilt of ${num(r.timbre.tiltDbPerOctave, 1)} dB per octave and a spectral centroid around ${hz(r.timbre.meanCentroidHz)}; ${vocal}. ` +
    `Taken together — energy ${pct(d.energy)}, danceability ${pct(d.danceability)}, valence ${pct(d.valence)}, acousticness ${pct(d.acousticness)} — the character reads as ${list(d.moods.slice(0, 4))}, and the closest stylistic neighbours by these measurements are ${list(genres, "and")} (heuristic estimates, see “Character”).`,
  );
  return { id: "overview", title: "At a glance", paragraphs: paras };
}

function meterAlternatives(m: AnalysisResult["rhythm"]["meter"]): string {
  const others = m.alternatives.filter((a) => a.beatsPerBar !== m.beatsPerBar && a.score >= 0.6).sort((a, b) => b.score - a.score);
  if (!others.length) return "";
  const names: Record<number, string> = { 2: "a duple (2/4) grouping", 3: "a triple (3/4) grouping", 4: "common time (4/4)", 5: "a five-beat grouping", 6: "a compound six-beat (6/8) grouping", 7: "a seven-beat grouping" };
  const same = others.find((a) => a.beatsPerBar * 2 === m.beatsPerBar || a.beatsPerBar === m.beatsPerBar * 2);
  return ` The evidence also supports ${list(others.map((a) => `${names[a.beatsPerBar]} (${pct(a.score)} as strong)`))}${same ? ", so the bar may equally be felt at half or double length — for example 3/4 with two-bar phrases rather than 6/8" : ""}.`;
}

function tempoStabilityWord(s: number): string {
  return level(s, [[0.35, "noticeably fluid, drifting the way a live performance does"], [0.7, "mostly steady with some human give"], [0.9, "steady"], [1.01, "locked to a grid, as a click track or sequencer would be"]]);
}

function loudnessCharacter(lo: AnalysisResult["loudness"]): string {
  const plr = lo.plr;
  if (lo.integratedLufs > -9) return "an extremely loud, heavily limited master";
  if (lo.integratedLufs > -12) return plr < 9 ? "a loud, dense modern master with little headroom" : "a loud master that still keeps some transient punch";
  if (lo.integratedLufs > -16) return plr > 14 ? "a moderate-level master with generous transient headroom" : "a moderately loud master in line with streaming normalisation";
  if (lo.integratedLufs > -20) return "a dynamic, conservatively levelled master";
  if (lo.integratedLufs > -26) return "a quiet master, broadcast-style or deliberately dynamic";
  return "a very quiet recording";
}

// ───────────────────────────────────────────────────────────────────────────────

function fileSection(r: AnalysisResult): ReportSection {
  const f = r.file, t = f.tags;
  const facts: Fact[] = [
    { label: "File name", value: f.name },
    { label: "Size", value: bytes(f.sizeBytes) },
    { label: "Container / codec", value: [f.container, f.codec].filter(Boolean).join(" / ") || f.mimeType || "unknown" },
    { label: "Bit rate", value: f.bitrateKbps ? `${Math.round(f.bitrateKbps)} kbps${f.lossless ? " (lossless)" : ""}` : f.lossless ? "lossless" : "–" },
    { label: "Sample rate", value: `${r.sampleRate} Hz${f.sampleRate && f.sampleRate !== r.sampleRate ? ` (container says ${f.sampleRate} Hz; decoded at ${r.sampleRate})` : ""}` },
    { label: "Bit depth", value: f.bitsPerSample ? `${f.bitsPerSample}-bit` : "n/a (lossy or unknown)" },
    { label: "Channels", value: `${r.channels}${r.stereo.isDualMono ? " (dual mono)" : ""}` },
    { label: "Duration", value: `${mmss(r.durationSec)} (${num(r.durationSec, 2)} s, ${Math.round(r.durationSec * r.sampleRate).toLocaleString()} samples)` },
  ];
  if (f.encoder) facts.push({ label: "Encoder", value: f.encoder });
  const tagFacts: Fact[] = [];
  if (t.title) tagFacts.push({ label: "Title", value: t.title });
  if (t.artist) tagFacts.push({ label: "Artist", value: t.artist });
  if (t.album) tagFacts.push({ label: "Album", value: `${t.album}${t.year ? ` (${t.year})` : ""}` });
  else if (t.year) tagFacts.push({ label: "Year", value: String(t.year) });
  if (t.albumArtist && t.albumArtist !== t.artist) tagFacts.push({ label: "Album artist", value: t.albumArtist });
  if (t.composer) tagFacts.push({ label: "Composer", value: t.composer });
  if (t.genre?.length) tagFacts.push({ label: "Tagged genre", value: t.genre.join(", ") });
  if (t.track) tagFacts.push({ label: "Track", value: t.track });
  if (t.label) tagFacts.push({ label: "Label", value: t.label });
  if (t.isrc) tagFacts.push({ label: "ISRC", value: t.isrc });
  if (t.bpm) tagFacts.push({ label: "Tagged BPM", value: `${t.bpm}`, note: Math.abs(t.bpm - r.rhythm.bpm) < 2 ? "agrees with the measured tempo" : Math.abs(t.bpm - r.rhythm.bpm * 2) < 3 || Math.abs(t.bpm * 2 - r.rhythm.bpm) < 3 ? "an octave (half/double) away from the measured tempo" : `differs from the measured ${num(r.rhythm.bpm, 1)} BPM` });
  if (t.key) tagFacts.push({ label: "Tagged key", value: t.key, note: t.key.toLowerCase().replace(/\s+/g, "").includes(r.harmony.key.name.toLowerCase().replace(/\s+/g, "").slice(0, 3)) ? "consistent with the measured key" : `measured key is ${r.harmony.key.name}` });
  if (t.replayGainTrackDb !== undefined) tagFacts.push({ label: "ReplayGain (track)", value: dB(t.replayGainTrackDb) });
  if (t.comment) tagFacts.push({ label: "Comment", value: t.comment.slice(0, 200) });
  tagFacts.push({ label: "Cover art", value: f.hasCoverArt ? "embedded" : "none embedded" });
  const paras: string[] = [];
  paras.push(
    `The file arrived as ${f.container ? `a ${f.container} container` : `“${f.mimeType || "unknown type"}”`}${f.codec ? ` carrying ${f.codec} audio` : ""}${f.bitrateKbps ? ` at roughly ${Math.round(f.bitrateKbps)} kbps` : ""}. ` +
    (f.lossless === true ? "It is a lossless encoding, so the spectrum and peaks below reflect the production master rather than codec artefacts. " : f.lossless === false ? "It is a lossy encoding; the bandwidth measurements in the timbre section indicate how much of the top end the encoder preserved. " : "") +
    (tagFacts.length > 1 ? `Embedded metadata identifies it as ${t.title ? `“${t.title}”` : "an untitled track"}${t.artist ? ` by ${t.artist}` : ""}${t.album ? ` from the album “${t.album}”` : ""}${t.year ? ` (${t.year})` : ""}.` : "The file carries no descriptive tags, so everything below is measured from the audio itself."),
  );
  return { id: "file", title: "File and format", paragraphs: paras, facts: [...facts, ...tagFacts] };
}

// ───────────────────────────────────────────────────────────────────────────────

function rhythmSection(r: AnalysisResult): ReportSection {
  const rh = r.rhythm;
  const paras: string[] = [];
  const alt = rh.bpmCandidates.filter((c) => Math.abs(c.bpm - rh.bpm) > 2).slice(0, 2);
  const altText = alt.length ? ` The strongest alternative readings are ${list(alt.map((c) => `${num(c.bpm, 1)} BPM (${pct(c.strength)} as strong)`))}; ${alt.some((c) => Math.abs(c.bpm * 2 - rh.bpm) < 3 || Math.abs(c.bpm / 2 - rh.bpm) < 3) ? "a half- or double-time reading is plausible depending on where you feel the pulse" : "these are weaker periodicities in the onset pattern"}.` : "";
  paras.push(
    `The dominant pulse is ${num(rh.bpm, 1)} BPM (${confidenceWord(rh.bpmConfidence)}), a ${r.descriptors.tempoMarking} tempo giving each beat about ${num(60000 / (rh.bpm || 1), 0)} ms and each ${rh.meter.label} bar about ${num((60 / (rh.bpm || 1)) * rh.meter.beatsPerBar, 2)} s.${altText}`,
  );
  const driftText = rh.localTempi.length > 2 ? ` Across the song the local tempo spans ${num(rh.tempoDriftBpm, 1)} BPM between its 5th and 95th percentiles${rh.tempoChanges.length ? `, and there ${rh.tempoChanges.length === 1 ? "is a distinct tempo change" : `are ${rh.tempoChanges.length} distinct tempo changes`}: ${list(rh.tempoChanges.slice(0, 4).map((c) => `${num(c.fromBpm, 0)} → ${num(c.toBpm, 0)} BPM at ${mmss(c.time)}`))}` : ", with no section-level tempo changes"}.` : "";
  paras.push(
    `Tempo stability scores ${pct(rh.tempoStability)}: the beat is ${tempoStabilityWord(rh.tempoStability)}. The beat-to-beat interval varies by ${pct(rh.beatIntervalCv, 1)} (coefficient of variation), ${rh.beatIntervalCv < 0.03 ? "essentially quantised" : rh.beatIntervalCv < 0.08 ? "tight but human" : "loose, suggesting rubato, expressive timing or weak beat evidence"}.${driftText}`,
  );
  const meterText = rh.meter.beatsPerBar === 4 ? "the accent pattern repeats every four beats, with a strong-weak-medium-weak feel" : rh.meter.beatsPerBar === 3 ? "accents recur every three beats, a waltz-like grouping" : rh.meter.beatsPerBar === 6 ? "accents group in sixes, a compound (6/8-style) feel" : rh.meter.beatsPerBar === 2 ? "accents recur every two beats, a march-like grouping" : `accents recur every ${rh.meter.beatsPerBar} beats, an asymmetric grouping`;
  paras.push(
    `Meter is estimated as ${rh.meter.label} (${confidenceWord(rh.meter.confidence)}): ${meterText}. That yields roughly ${rh.barsEstimate} bars over the track${rh.downbeats.length > 1 ? `, with the first downbeat detected at ${mmss(rh.downbeats[0]!)}` : ""}. ` +
    `Subdivisions are ${rh.swing.label} (swing ratio ${num(rh.swing.ratio, 2)}, where 0.50 is perfectly even and 0.67 is a triplet shuffle).` +
    meterAlternatives(rh.meter),
  );
  const density = level(rh.onsetsPerSecond, [[1.5, "sparse"], [3, "moderate"], [5, "busy"], [8, "dense"], [99, "extremely dense"]]);
  paras.push(
    `Rhythmic activity is ${density}: about ${num(rh.onsetsPerSecond, 1)} note or drum onsets per second (${rh.onsets.length} detected in total). ` +
    `Beat strength is ${pct(rh.beatStrength)}, i.e. onsets ${rh.beatStrength > 0.6 ? "line up emphatically with the beat grid" : rh.beatStrength > 0.3 ? "mostly reinforce the beat grid" : "only loosely articulate the beat"}, and ${pct(rh.offbeatShare)} of onset energy lands on off-beat eighths and sixteenths, ${rh.offbeatShare > 0.45 ? "a strongly syncopated feel" : rh.offbeatShare > 0.3 ? "a moderately syncopated feel" : "a largely on-the-beat feel"}.`,
  );
  const facts: Fact[] = [
    { label: "Tempo", value: `${num(rh.bpm, 2)} BPM`, note: confidenceWord(rh.bpmConfidence) },
    { label: "Tempo marking", value: r.descriptors.tempoMarking },
    { label: "Meter", value: rh.meter.label, note: confidenceWord(rh.meter.confidence) },
    { label: "Bars (approx.)", value: String(rh.barsEstimate) },
    { label: "Beats tracked", value: String(rh.beats.length) },
    { label: "Tempo stability", value: pct(rh.tempoStability) },
    { label: "Tempo drift (5–95 %)", value: `${num(rh.tempoDriftBpm, 1)} BPM` },
    { label: "Beat interval CV", value: pct(rh.beatIntervalCv, 1) },
    { label: "Swing ratio", value: `${num(rh.swing.ratio, 3)} (${rh.swing.label})` },
    { label: "Onset density", value: `${num(rh.onsetsPerSecond, 2)} / s` },
    { label: "Off-beat share", value: pct(rh.offbeatShare) },
    { label: "Beat strength", value: pct(rh.beatStrength) },
  ];
  return { id: "rhythm", title: "Tempo, meter and rhythm", paragraphs: paras, facts };
}

// ───────────────────────────────────────────────────────────────────────────────

function keySection(r: AnalysisResult): ReportSection {
  const h = r.harmony, k = h.key;
  const paras: string[] = [];
  paras.push(
    `The pitch content fits ${k.name} best (profile correlation ${num(k.clarity, 2)}, ${confidenceWord(k.confidence)}). The next-best candidates are ${list(k.scores.slice(1, 4).map((s) => `${s.name} (${num(s.score, 2)})`))}. ` +
    `Related keys: the relative ${k.mode === "major" ? "minor" : "major"} is ${k.relative}, the parallel ${k.mode === "major" ? "minor" : "major"} is ${k.parallel}, the dominant is ${k.dominant} and the subdominant is ${k.subdominant}.`,
  );
  paras.push(`${h.modalFlavour.detail} ${k.mode === "major" ? "Major-mode material generally reads as brighter and more resolved;" : "Minor-mode material generally reads as darker or more plaintive;"} the chord analysis below shows how strictly the song stays inside that scale.`);
  const top = h.pitchClassHistogram.slice(0, 5);
  paras.push(
    `Pitch-class weight concentrates on ${list(top.map((p) => `${p.note} (${pct(p.share)})`))}; the three least-used pitch classes are ${list(h.pitchClassHistogram.slice(-3).map((p) => p.note))}. ` +
    `Tuning is centred ${Math.abs(h.tuning.deviationCents) < 3 ? "on" : h.tuning.deviationCents > 0 ? `${num(h.tuning.deviationCents, 0)} cents above` : `${num(-h.tuning.deviationCents, 0)} cents below`} standard pitch, i.e. A4 ≈ ${num(h.tuning.a4Hz, 1)} Hz${Math.abs(h.tuning.deviationCents) > 20 ? " — a noticeable offset that may indicate a detuned instrument, a non-standard reference pitch, or a speed/pitch-shifted transfer" : Math.abs(h.tuning.deviationCents) > 8 ? " — slightly off standard, as is common with sampled or vintage sources" : ""}.`,
  );
  if (h.keyTimeline.length > 1) {
    paras.push(`The key centre is not fixed: windowed estimation finds ${h.keyTimeline.length} key regions — ${list(h.keyTimeline.map((s) => `${s.key.name} from ${mmss(s.start)} to ${mmss(s.end)}`))}. ${h.keyTimeline.some((s) => s.key.tonic === k.tonic && s.key.mode !== k.mode) ? "Some of these are shifts between parallel major and minor on the same tonic (mode mixture) rather than true modulations. " : ""}${h.keyTimeline.some((s) => Math.abs(((s.key.tonic - k.tonic) % 12 + 12) % 12) === 7 || ((s.key.tonic - k.tonic) % 12 + 12) % 12 === 5) ? "Moves to the dominant or subdominant region are the most conventional kind of modulation." : ""}`);
  } else {
    paras.push(`Windowed estimation agrees on ${k.name} for the whole duration, so there are no modulations or large-scale key changes.`);
  }
  const facts: Fact[] = [
    { label: "Key", value: k.name, note: confidenceWord(k.confidence) },
    { label: "Profile correlation", value: num(k.clarity, 3) },
    { label: "Runner-up", value: `${k.scores[1]?.name ?? "–"} (${num(k.scores[1]?.score ?? NaN, 3)})` },
    { label: "Mode", value: k.mode },
    { label: "Closest scale", value: h.modalFlavour.label },
    { label: "Tuning (A4)", value: `${num(h.tuning.a4Hz, 1)} Hz (${dB(h.tuning.deviationCents, 0, "cents")})` },
    { label: "Harmonic energy share", value: pct(h.harmonicShare), note: "energy in sustained/tonal components vs. transients" },
    { label: "Key regions", value: String(h.keyTimeline.length) },
  ];
  return { id: "key", title: "Key, scale and tuning", paragraphs: paras, facts, table: { columns: ["Pitch class", "Share"], rows: h.pitchClassHistogram.map((p) => [p.note, pct(p.share, 1)]) } };
}

// ───────────────────────────────────────────────────────────────────────────────

function chordSection(r: AnalysisResult): ReportSection {
  const p = r.harmony.progression, chords = r.harmony.chords.filter((c) => c.quality !== "N");
  const paras: string[] = [];
  if (!chords.length) {
    return { id: "chords", title: "Chords and harmony", paragraphs: ["No stable chords could be identified; the material is either unpitched, extremely dense, or built on drones and textures rather than triadic harmony."] };
  }
  const vocab = level(p.distinctChords, [[3, "a very small chord vocabulary"], [5, "a compact chord vocabulary"], [8, "a moderate chord vocabulary"], [13, "a rich chord vocabulary"], [99, "an unusually large chord vocabulary"]]);
  const rate = level(p.changesPerMinute, [[8, "very slow"], [16, "slow"], [32, "moderate"], [60, "brisk"], [999, "very fast"]]);
  paras.push(
    `The harmony uses ${vocab} — ${p.distinctChords} distinct chord${p.distinctChords === 1 ? "" : "s"} across ${chords.length} chord events — with a ${rate} harmonic rhythm of about ${num(p.changesPerMinute, 0)} chord changes per minute (one every ${num(p.averageBeatsPerChord, 1)} beats on average). ` +
    `${pct(p.diatonicShare)} of the time is spent on chords whose roots belong to ${r.harmony.key.name}, ${p.diatonicShare > 0.95 ? "so the progression is strictly diatonic" : p.diatonicShare > 0.8 ? "with occasional chromatic or borrowed chords adding colour" : "with substantial chromaticism or mode mixture"}.`,
  );
  paras.push(`The most-used chords are ${list(p.topChords.slice(0, 5).map((c) => `${c.label} as ${c.roman} (${pct(c.share)} of harmonic time)`))}.`);
  if (p.commonProgressions.length) {
    const descs = p.commonProgressions.slice(0, 3).map((cp) => {
      const known = describeProgression(cp.romans);
      return `${cp.labels.join(" → ")} (${cp.romans.join("–")}), heard ${cp.count} times${known ? ` — ${known}` : ""}`;
    });
    paras.push(`Recurring progressions: ${descs.join("; ")}.`);
  }
  if (p.borrowed.length) paras.push(`Chords outside the home key: ${list(p.borrowed)}. ${p.borrowed.some((b) => b.includes("♭VII")) ? "A ♭VII chord in a major key is the Mixolydian/rock colouring; " : ""}${p.borrowed.some((b) => b.includes("♭VI")) ? "a ♭VI suggests mode mixture from the parallel minor; " : ""}${r.harmony.key.mode === "minor" && p.borrowed.some((b) => /\(VII|vii°\)/.test(b)) ? "a raised leading-tone (VII) chord in a minor key points to harmonic-minor cadences; " : ""}${r.harmony.key.mode === "minor" && p.borrowed.some((b) => /\(III\)/.test(b)) ? "a major III suggests the harmonic minor or a Picardy colour; " : ""}these moments are where the harmony steps out of the expected palette.`);
  if (p.cadences.length) paras.push(`Cadential motion: ${list(p.cadences.map((c) => `${c.count} × ${c.type}`))}. ${p.cadences[0]!.type.startsWith("authentic") ? "The prevalence of V → I motion gives the harmony a classical, strongly resolving character." : p.cadences[0]!.type.startsWith("plagal") ? "IV → I motion dominates, lending a gospel/folk-like, softer resolution." : p.cadences[0]!.type.startsWith("deceptive") ? "Frequent V → vi moves keep the harmony circling rather than resolving." : "Movement towards the dominant without immediate resolution keeps tension in the loop."}`);
  const sevenths = chords.filter((c) => c.quality === "7" || c.quality === "min7" || c.quality === "maj7").length;
  const colour: string[] = [];
  if (sevenths / chords.length > 0.3) colour.push("seventh chords are a defining feature (jazz, soul or R&B colour)");
  else if (sevenths > 0) colour.push("seventh chords appear occasionally");
  if (chords.some((c) => c.quality === "dim")) colour.push("diminished chords appear as passing or leading harmonies");
  if (chords.some((c) => c.quality === "aug")) colour.push("augmented chords add moments of instability");
  if (chords.some((c) => c.quality === "sus4")) colour.push("suspended chords soften the major/minor distinction in places");
  const minors = chords.filter((c) => c.quality === "min" || c.quality === "min7").reduce((a, c) => a + c.beats, 0);
  const totalBeats = chords.reduce((a, c) => a + c.beats, 0) || 1;
  colour.push(`${pct(minors / totalBeats)} of harmonic time sits on minor-quality chords`);
  paras.push(`Chord colour: ${list(colour)}.`);
  const rows = compressChords(chords).map((c) => [mmss(c.start), mmss(c.end), c.label, c.roman, String(c.beats)]);
  return { id: "chords", title: "Chords and harmony", paragraphs: paras, table: { columns: ["Start", "End", "Chord", "Roman", "Beats"], rows: rows.slice(0, 120) } };
}

function compressChords(chords: AnalysisResult["harmony"]["chords"]): AnalysisResult["harmony"]["chords"] {
  // Drop one-beat flickers that are sandwiched between the same chord.
  const out: AnalysisResult["harmony"]["chords"] = [];
  for (const c of chords) {
    const last = out[out.length - 1];
    if (last && last.label === c.label) { last.end = c.end; last.beats += c.beats; continue; }
    out.push({ ...c });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────

function structureSection(r: AnalysisResult): ReportSection {
  const st = r.structure, secs = st.sections;
  const paras: string[] = [];
  const durations = secs.map((s) => s.end - s.start);
  const longest = secs[durations.indexOf(Math.max(...durations))]!;
  const chorusCount = secs.filter((s) => s.name.startsWith("Chorus")).length;
  const verseCount = secs.filter((s) => s.name.startsWith("Verse")).length;
  paras.push(
    `Self-similarity analysis divides the track into ${secs.length} section${secs.length === 1 ? "" : "s"}: ${st.formString}. ` +
    `${chorusCount ? `${chorusCount} chorus-like passage${chorusCount > 1 ? "s" : ""} (the loudest repeated material) ` : ""}${verseCount ? `and ${verseCount} verse-like passage${verseCount > 1 ? "s" : ""} ` : ""}${chorusCount || verseCount ? "were identified by repetition and relative level. " : ""}` +
    `The longest section is the ${longest.name} (${mmss(longest.start)}–${mmss(longest.end)}, ${num(longest.end - longest.start, 0)} s), and section lengths average ${num(durations.reduce((a, b) => a + b, 0) / durations.length, 0)} s${r.rhythm.bpm ? `, roughly ${num((durations.reduce((a, b) => a + b, 0) / durations.length) / ((60 / r.rhythm.bpm) * r.rhythm.meter.beatsPerBar), 0)} bars` : ""}.`,
  );
  const rep = level(st.repetitionScore, [[0.2, "very little material repeats — the piece is through-composed or constantly evolving"], [0.45, "some material returns, but much of the song is new as it goes"], [0.7, "a good deal of material recurs, typical of verse–chorus songwriting"], [1.01, "most of the song is built from repeating blocks, typical of loop-based or strongly sectional music"]]);
  paras.push(`Repetition score is ${pct(st.repetitionScore)}: ${rep}.`);
  const climax = secs.find((s) => s.notes.some((n) => n.includes("climax")));
  const quietest = secs.find((s) => s.notes.some((n) => n.includes("quietest")));
  if (climax) paras.push(`The climax is the ${climax.name} (${mmss(climax.start)}–${mmss(climax.end)}), running ${dB(climax.levelDb)} relative to the song's median level${climax.dominantChord ? ` and centred on ${climax.dominantChord}` : ""}${quietest && quietest !== climax ? `; the quietest stretch is the ${quietest.name} at ${dB(quietest.levelDb)}` : ""}. The spread between sections is ${num(Math.max(...secs.map((s) => s.levelDb)) - Math.min(...secs.map((s) => s.levelDb)), 1)} dB, ${Math.max(...secs.map((s) => s.levelDb)) - Math.min(...secs.map((s) => s.levelDb)) > 8 ? "a pronounced quiet-loud architecture" : Math.max(...secs.map((s) => s.levelDb)) - Math.min(...secs.map((s) => s.levelDb)) > 4 ? "a clear but moderate contrast between sections" : "a fairly flat arrangement in level terms"}.`);
  const rows = secs.map((s) => [mmss(s.start), mmss(s.end), `${num(s.end - s.start, 0)} s`, s.name, s.label, dB(s.levelDb), pct(s.percussiveness), hz(s.brightnessHz), s.dominantChord ?? "–", s.notes.join("; ")]);
  return { id: "structure", title: "Structure and arrangement", paragraphs: paras, table: { columns: ["Start", "End", "Length", "Section", "Material", "Level", "Percussive", "Brightness", "Main chord", "Notes"], rows } };
}

// ───────────────────────────────────────────────────────────────────────────────

function energySection(r: AnalysisResult): ReportSection {
  const e = r.energy;
  const paras: string[] = [];
  paras.push(
    `Measured in half-second RMS steps, the energy is ${e.arc.shape}: the first third averages ${dB(e.arc.first)}, the middle ${dB(e.arc.middle)} and the final third ${dB(e.arc.last)} relative to the song's median level of ${num(e.medianDb, 1)} dBFS. ` +
    `The loudest moment lands at ${mmss(e.peakTime)} (${num(e.peakDb, 1)} dBFS RMS) and the quietest non-silent moment at ${mmss(e.quietestTime)} (${num(e.quietestDb, 1)} dBFS), a spread of ${num(e.peakDb - e.quietestDb, 1)} dB; between the 10th and 95th percentiles the level ranges over ${num(e.dynamicSpreadDb, 1)} dB.`,
  );
  const edges: string[] = [];
  if (e.leadingSilenceSec > 0.4) edges.push(`${num(e.leadingSilenceSec, 1)} s of near-silence before the music starts`);
  if (e.trailingSilenceSec > 0.4) edges.push(`${num(e.trailingSilenceSec, 1)} s of silence after it ends`);
  if (e.fadeInSec > 0) edges.push(`a fade-in lasting about ${num(e.fadeInSec, 0)} s`);
  if (e.fadeOutSec > 0) edges.push(`a fade-out lasting about ${num(e.fadeOutSec, 0)} s`);
  paras.push(edges.length ? `At the edges there is ${list(edges)}.` : "The track starts and ends abruptly, with no fades and no leading or trailing silence.");
  if (e.breakdowns.length) paras.push(`Breakdowns — passages at least 4 s long sitting more than 7 dB below the median — occur at ${list(e.breakdowns.map((b) => `${mmss(b.start)}–${mmss(b.end)} (${num(b.depthDb, 0)} dB down)`))}.`);
  if (e.buildUps.length) paras.push(`Build-ups, where the level climbs steadily by 6 dB or more, occur at ${list(e.buildUps.map((b) => `${mmss(b.start)}–${mmss(b.end)} (+${num(b.riseDb, 0)} dB)`))}.`);
  if (!e.breakdowns.length && !e.buildUps.length) paras.push("No extended breakdowns or sustained build-ups were detected; the energy changes section to section rather than through long ramps.");
  return { id: "energy", title: "Energy and dynamics over time", paragraphs: paras };
}

// ───────────────────────────────────────────────────────────────────────────────

function loudnessSection(r: AnalysisResult): ReportSection {
  const lo = r.loudness;
  const paras: string[] = [];
  paras.push(
    `Integrated loudness (ITU-R BS.1770-4, gated) is ${num(lo.integratedLufs, 1)} LUFS. Momentary loudness peaks at ${num(lo.momentaryMaxLufs, 1)} LUFS and short-term loudness ranges from ${num(lo.shortTermMinLufs, 1)} to ${num(lo.shortTermMaxLufs, 1)} LUFS. ` +
    `Loudness range (EBU R128 LRA) is ${num(lo.loudnessRangeLu, 1)} LU — ${level(lo.loudnessRangeLu, [[4, "very compressed, with almost no macro-dynamics"], [7, "tight, typical of loud pop/EDM masters"], [11, "moderate, with audible contrast between sections"], [16, "wide, typical of dynamic rock, jazz or film music"], [99, "very wide, typical of classical or live recordings"]])}.`,
  );
  const tpWarn = lo.truePeakDbtp > -1 ? `The true peak of ${num(lo.truePeakDbtp, 2)} dBTP exceeds the −1 dBTP ceiling most streaming services recommend; lossy transcodes may clip. ` : `The true peak of ${num(lo.truePeakDbtp, 2)} dBTP leaves ${num(-1 - lo.truePeakDbtp, 2)} dB of headroom below the −1 dBTP streaming ceiling. `;
  const plrWord = level(lo.plr, [[8, "very low: the master is heavily limited and transients have been flattened"], [11, "low: a loud, dense master with controlled transients"], [15, "moderate: punchy with reasonable headroom"], [99, "high: an open, dynamic master with intact transients"]]);
  paras.push(
    `${tpWarn}Sample peak is ${num(lo.samplePeakDbfs, 2)} dBFS${lo.truePeakDbtp - lo.samplePeakDbfs > 0.3 ? `, so inter-sample peaks overshoot by ${num(lo.truePeakDbtp - lo.samplePeakDbfs, 2)} dB` : ""}. ` +
    `Peak-to-loudness ratio (PLR) is ${num(lo.plr, 1)} dB — ${plrWord}. The peak-to-short-term ratio at the loudest passage (PSR) is ${num(lo.psr, 1)} dB, and the crest factor is ${num(lo.crestFactorDb, 1)} dB. The DR-meter style value is about DR${Math.round(lo.drValue)}.`,
  );
  const adjustments = PLATFORM_TARGETS.map((p) => `${p.name} (${p.lufs} LUFS): ${dB(p.lufs - lo.integratedLufs, 1)}`);
  paras.push(`Normalisation on playback: a platform that targets a given level will apply roughly these gain changes — ${adjustments.join("; ")}. ${lo.integratedLufs > -14 ? "Because the master is louder than the common −14 LUFS target it will simply be turned down, so the extra loudness buys nothing but lost transient detail." : lo.integratedLufs < -16 ? "Because the master is quieter than the common targets, most services will turn it up (where their policy allows), or play it quieter than neighbouring tracks." : "The master sits close to common streaming targets, so it will play at roughly its mixed level."}`);
  const issues: string[] = [];
  if (lo.clippedSamples > 0) issues.push(`${lo.clippedSamples.toLocaleString()} samples at or above −0.01 dBFS in ${lo.clippedRuns} run${lo.clippedRuns === 1 ? "" : "s"} of three or more consecutive samples — ${lo.clippedRuns > 20 ? "audible hard clipping is likely" : lo.clippedRuns > 0 ? "possible hard clipping or a brick-wall limiter at full scale" : "isolated full-scale samples, probably from a limiter"}`);
  const dcMax = Math.max(...lo.dcOffset.map(Math.abs));
  if (dcMax > 0.002) issues.push(`a DC offset of ${num(dcMax * 100, 2)} % full scale (${num(20 * Math.log10(dcMax), 1)} dBFS), which wastes headroom and can cause clicks at edits`);
  issues.push(`a noise floor around ${num(lo.noiseFloorDbfs, 0)} dBFS (5th-percentile 50 ms RMS) — ${level(lo.noiseFloorDbfs, [[-80, "effectively silent between notes"], [-60, "quiet, consistent with a clean digital production"], [-45, "an audible floor, consistent with analogue sources, room tone or dense sustain"], [0, "a high floor: the material has no quiet moments, or carries significant noise"]])}`);
  paras.push(`Technical observations: ${list(issues)}.`);
  const facts: Fact[] = [
    { label: "Integrated loudness", value: `${num(lo.integratedLufs, 2)} LUFS` },
    { label: "Loudness range (LRA)", value: `${num(lo.loudnessRangeLu, 1)} LU` },
    { label: "Momentary max", value: `${num(lo.momentaryMaxLufs, 1)} LUFS` },
    { label: "Short-term max / min", value: `${num(lo.shortTermMaxLufs, 1)} / ${num(lo.shortTermMinLufs, 1)} LUFS` },
    { label: "True peak", value: `${num(lo.truePeakDbtp, 2)} dBTP` },
    { label: "Sample peak", value: `${num(lo.samplePeakDbfs, 2)} dBFS` },
    { label: "PLR / PSR", value: `${num(lo.plr, 1)} / ${num(lo.psr, 1)} dB` },
    { label: "Crest factor", value: `${num(lo.crestFactorDb, 1)} dB` },
    { label: "RMS level", value: `${num(lo.rmsDbfs, 1)} dBFS` },
    { label: "DR value", value: `DR${Math.round(lo.drValue)}` },
    { label: "Noise floor", value: `${num(lo.noiseFloorDbfs, 1)} dBFS` },
    { label: "Clipped samples", value: lo.clippedSamples.toLocaleString() },
    { label: "DC offset", value: lo.dcOffset.map((d) => `${num(d * 100, 3)} %`).join(" / ") },
    { label: "Gated blocks", value: pct(lo.gatedBlockShare), note: "share of 400 ms blocks counted in the integrated measurement" },
  ];
  return { id: "loudness", title: "Loudness and mastering", paragraphs: paras, facts };
}

// ───────────────────────────────────────────────────────────────────────────────

function timbreSection(r: AnalysisResult): ReportSection {
  const t = r.timbre;
  const paras: string[] = [];
  paras.push(
    `The average spectral centroid sits at ${hz(t.meanCentroidHz)} (varying by ±${hz(t.centroidStdHz)} over time), with 85 % of spectral energy below ${hz(t.meanRolloff85Hz)} and 95 % below ${hz(t.meanRolloff95Hz)}; the spectral spread averages ${hz(t.meanBandwidthHz)}. ` +
    `That makes the overall tone ${t.descriptors[0]}. Spectral flatness averages ${num(t.meanFlatness, 3)} (${t.descriptors[1]}) and normalised spectral entropy ${num(t.meanEntropy, 2)}, while the zero-crossing rate of about ${num(t.meanZcr, 0)} crossings per second corroborates ${t.meanZcr > 3000 ? "a bright, noisy or sibilant texture" : t.meanZcr > 1500 ? "a mid-bright texture" : "a low, smooth texture"}.`,
  );
  const bands = t.bandEnergies;
  const strongest = [...bands].sort((a, b) => b.share - a.share)[0]!;
  const weakest = [...bands].sort((a, b) => a.share - b.share)[0]!;
  paras.push(
    `Tonal balance by band (share of total energy): ${bands.map((b) => `${b.name.toLowerCase()} ${b.lowHz}–${b.highHz >= 1000 ? `${b.highHz / 1000}k` : b.highHz} Hz ${pct(b.share)}`).join(", ")}. ` +
    `The ${strongest.name.toLowerCase()} band dominates and the ${weakest.name.toLowerCase()} band is weakest. The long-term spectrum falls at ${num(t.tiltDbPerOctave, 1)} dB per octave between 100 Hz and 10 kHz — ${level(t.tiltDbPerOctave, [[-9, "a steep roll-off, very bass-heavy or muffled"], [-6, "a dark balance, bass-forward"], [-3.5, "close to the −4.5 dB/octave slope typical of commercial masters"], [-1.5, "a bright, forward balance"], [99, "an unusually bright or thin balance"]])}.`,
  );
  const bw = `Measurable content extends to about ${hz(t.effectiveBandwidthHz)} against a Nyquist limit of ${hz(t.nyquistHz)}.`;
  const cliff = t.bandwidthCliff ? ` A sharp spectral cliff is visible there, the signature of a lossy encoder's low-pass filter${t.effectiveBandwidthHz < 17000 ? " — consistent with a low-bit-rate MP3/AAC source (around 128 kbps or less)" : t.effectiveBandwidthHz < 20000 ? " — consistent with a mid-bit-rate lossy source (around 160–256 kbps)" : ""}, even if the file itself is lossless.` : t.effectiveBandwidthHz < 16000 && t.nyquistHz > 20000 ? " The top end rolls off gently rather than abruptly, which points to the source material or a deliberate low-pass rather than a codec." : "";
  paras.push(bw + cliff);
  if (t.spectralPeaks.length) {
    const hum = t.spectralPeaks.filter((p) => [50, 60, 100, 120, 150, 180].some((h) => Math.abs(p.hz - h) < 2));
    paras.push(`Narrow spectral peaks stand out at ${list(t.spectralPeaks.map((p) => `${hz(p.hz)} (+${num(p.prominenceDb, 0)} dB above its surroundings)`))}.${hum.length ? ` The peak${hum.length > 1 ? "s" : ""} at ${list(hum.map((p) => hz(p.hz)))} ${hum.length > 1 ? "coincide" : "coincides"} with mains hum frequencies or their harmonics.` : " These are most likely sustained bass or tonic notes rather than noise."}`);
  }
  paras.push(`The harmonic/percussive split assigns ${pct(1 - t.percussiveShare)} of energy to sustained tonal components and ${pct(t.percussiveShare)} to transients: ${t.descriptors[2]}.`);
  const facts: Fact[] = [
    { label: "Spectral centroid", value: hz(t.meanCentroidHz), note: `±${hz(t.centroidStdHz)}` },
    { label: "Spectral spread", value: hz(t.meanBandwidthHz) },
    { label: "Roll-off 85 / 95 %", value: `${hz(t.meanRolloff85Hz)} / ${hz(t.meanRolloff95Hz)}` },
    { label: "Spectral flatness", value: num(t.meanFlatness, 4) },
    { label: "Spectral entropy", value: num(t.meanEntropy, 3) },
    { label: "Zero-crossing rate", value: `${num(t.meanZcr, 0)} / s` },
    { label: "Spectral tilt", value: `${num(t.tiltDbPerOctave, 2)} dB/oct` },
    { label: "Effective bandwidth", value: hz(t.effectiveBandwidthHz), note: t.bandwidthCliff ? "sharp cliff (lossy signature)" : "gradual roll-off" },
    { label: "Percussive share", value: pct(t.percussiveShare) },
  ];
  return { id: "timbre", title: "Timbre and spectrum", paragraphs: paras, facts, table: { columns: ["Band", "Range", "Share", "Level"], rows: bands.map((b) => [b.name, `${b.lowHz}–${b.highHz} Hz`, pct(b.share, 1), `${num(b.db - Math.max(...bands.map((x) => x.db)), 1)} dB`]) } };
}

// ───────────────────────────────────────────────────────────────────────────────

function stereoSection(r: AnalysisResult): ReportSection {
  const s = r.stereo;
  if (s.channels < 2) return { id: "stereo", title: "Stereo image", paragraphs: ["The file is single-channel mono, so there is no stereo image to assess."] };
  if (s.isDualMono) return { id: "stereo", title: "Stereo image", paragraphs: ["Although the file has two channels, they are identical (dual mono): there is no stereo information at all. The track will collapse to mono without any change."] };
  const paras: string[] = [];
  const widthWord = level(s.width, [[0.05, "very narrow, close to mono"], [0.12, "fairly narrow and centred"], [0.25, "moderately wide"], [0.4, "wide"], [1.01, "extremely wide, with a lot of out-of-phase or decorrelated content"]]);
  paras.push(
    `The image is ${widthWord}: side energy averages ${pct(s.width)} of the total (side-to-mid ratio ${num(s.sideToMidDb, 1)} dB) and the inter-channel correlation averages ${num(s.correlation, 2)}. ` +
    `${s.correlation > 0.9 ? "Most of the content is shared by both channels, so the mix is centre-heavy." : s.correlation > 0.6 ? "There is a solid centre with clearly placed stereo elements around it." : s.correlation > 0.2 ? "The channels differ substantially — wide reverbs, stereo synths or hard-panned instruments." : "The channels are largely decorrelated, which can sound huge on speakers but risks hollowness in mono."}`,
  );
  paras.push(
    `Left/right balance is ${Math.abs(s.balanceDb) < 0.5 ? "even" : `${num(Math.abs(s.balanceDb), 1)} dB towards the ${s.balanceDb > 0 ? "right" : "left"}`}. ` +
    `Below about 150 Hz the channels correlate at ${num(s.lowBandCorrelation, 2)}, ${s.lowBandCorrelation > 0.9 ? "so the bass is essentially mono — standard mastering practice" : s.lowBandCorrelation > 0.6 ? "so the low end has some stereo spread" : "so the low end is unusually wide, which may translate poorly to clubs or mono systems"}. ` +
    `${s.negativeCorrelationShare > 0.05 ? `${pct(s.negativeCorrelationShare)} of one-second blocks show negative correlation, indicating phase-cancelling content that will partially disappear in mono.` : "No blocks show negative correlation, so the mix is mono-compatible."}`,
  );
  if (s.widthOverTime.length > 4) {
    const widths = s.widthOverTime.map((w) => w.width);
    const mn = Math.min(...widths), mx = Math.max(...widths);
    const widest = s.widthOverTime[widths.indexOf(mx)]!;
    paras.push(`Width varies between ${pct(mn)} and ${pct(mx)} over the track; the widest moment is around ${mmss(widest.time)}${mx - mn > 0.15 ? ", so the arrangement uses stereo width as a dynamic device" : ", a fairly constant image throughout"}.`);
  }
  const facts: Fact[] = [
    { label: "Correlation", value: num(s.correlation, 3) },
    { label: "Width (side share)", value: pct(s.width, 1) },
    { label: "Side / mid", value: `${num(s.sideToMidDb, 1)} dB` },
    { label: "L/R balance", value: dB(s.balanceDb, 2) },
    { label: "Low-band correlation", value: num(s.lowBandCorrelation, 3) },
    { label: "Negative-correlation blocks", value: pct(s.negativeCorrelationShare, 1) },
  ];
  return { id: "stereo", title: "Stereo image", paragraphs: paras, facts };
}

// ───────────────────────────────────────────────────────────────────────────────

function melodySection(r: AnalysisResult): ReportSection {
  const m = r.melody;
  const paras: string[] = [];
  if (m.voicedShare < 0.08 || !Number.isFinite(m.medianMidi)) {
    paras.push(`A predominant melodic line could be identified in only ${pct(m.voicedShare)} of frames, so the material is dominated by chords, textures or percussion rather than a single lead voice or instrument. Vocal likelihood is correspondingly low (${pct(m.vocalLikelihood)}).`);
    return { id: "melody", title: "Melody and voice", paragraphs: paras };
  }
  paras.push(
    `A predominant pitch could be tracked in ${pct(m.voicedShare)} of the track. It centres on ${m.medianNote} and spans ${m.lowNote} to ${m.highNote} (5th–95th percentile), a range of ${num(m.rangeSemitones, 1)} semitones — ${level(m.rangeSemitones, [[7, "under an octave, a narrow, speech-like or chant-like range"], [13, "roughly an octave, typical of a pop vocal or riff-based lead"], [20, "well over an octave, typical of an expressive singer or lead instrument"], [99, "more than two octaves, suggesting an instrumental lead or several alternating lead parts"]])}.`,
  );
  paras.push(
    `Pitch activity averages ${num(m.pitchActivity, 1)} semitones per second, ${level(m.pitchActivity, [[3, "slow and sustained"], [10, "moderate, melodic"], [25, "lively"], [999, "very fast — runs, ornaments or rapid riffing"]])}. ` +
    `${m.vibratoShare > 0.05 ? `Vibrato (4–8 Hz modulation) is present in ${pct(m.vibratoShare)} of voiced frames with an average extent of ±${num(m.vibratoExtentCents / 2, 0)} cents — a hallmark of singing or bowed/blown instruments.` : "Little or no vibrato was detected, which points to keys, plucked strings, synths or a straight vocal delivery."}`,
  );
  paras.push(`Combining these cues, the heuristic likelihood that a lead vocal is present is ${pct(m.vocalLikelihood)} (${m.vocalLikelihood > 0.6 ? "likely vocal" : m.vocalLikelihood > 0.35 ? "uncertain — could be a vocal or a melodic instrument" : "probably instrumental"}). This estimate is based on pitch behaviour alone, not on a trained voice detector, so treat it as a hint.`);
  const facts: Fact[] = [
    { label: "Voiced share", value: pct(m.voicedShare) },
    { label: "Median pitch", value: m.medianNote },
    { label: "Range", value: `${m.lowNote} – ${m.highNote} (${num(m.rangeSemitones, 1)} st)` },
    { label: "Vibrato", value: `${pct(m.vibratoShare)} of voiced frames, ±${num(m.vibratoExtentCents / 2, 0)} cents` },
    { label: "Pitch activity", value: `${num(m.pitchActivity, 1)} st/s` },
    { label: "Vocal likelihood", value: pct(m.vocalLikelihood) },
  ];
  return { id: "melody", title: "Melody and voice", paragraphs: paras, facts };
}

// ───────────────────────────────────────────────────────────────────────────────

function characterSection(r: AnalysisResult): ReportSection {
  const d = r.descriptors;
  const paras: string[] = [];
  const scale = (v: number): string => level(v, [[0.2, "very low"], [0.4, "low"], [0.6, "medium"], [0.8, "high"], [1.01, "very high"]]);
  paras.push(
    `Energy is ${scale(d.energy)} (${pct(d.energy)}), danceability ${scale(d.danceability)} (${pct(d.danceability)}), valence — the sense of musical positivity — ${scale(d.valence)} (${pct(d.valence)}), acousticness ${scale(d.acousticness)} (${pct(d.acousticness)}), aggressiveness ${scale(d.aggressiveness)} (${pct(d.aggressiveness)}), harmonic/rhythmic complexity ${scale(d.complexity)} (${pct(d.complexity)}), brightness ${scale(d.brightness)} (${pct(d.brightness)}) and instrumentalness ${scale(d.instrumentalness)} (${pct(d.instrumentalness)}). ` +
    `These are composites of the measurements above (loudness, onset density, spectral centroid, mode, tempo, chord vocabulary and so on), mapped onto 0–100 % scales.`,
  );
  paras.push(`Mood descriptors that follow from those values: ${list(d.moods)}.`);
  const g = d.genres;
  paras.push(`Style estimate: the measurements most resemble ${g[0]!.name} (${pct(g[0]!.score)} match${g[0]!.reasons.length ? ` — ${list(g[0]!.reasons)}` : ""}), followed by ${list(g.slice(1, 3).map((x) => `${x.name} (${pct(x.score)})`))}. These are rule-based similarity scores on tempo, spectrum, harmony and loudness, not a trained genre classifier; they describe the production style more than the cultural genre.`);
  const bullets = g.map((x) => `${x.name}: ${pct(x.score)}${x.reasons.length ? ` — ${x.reasons.join(", ")}` : ""}`);
  return { id: "character", title: "Character, mood and style", paragraphs: paras, bullets };
}

// ───────────────────────────────────────────────────────────────────────────────

function methodSection(r: AnalysisResult): ReportSection {
  const total = r.timings.reduce((a, t) => a + t.ms, 0);
  const paras = [
    `Everything above was computed from the decoded audio in ${(total / 1000).toFixed(1)} s. Loudness, peaks, stereo and the long-term spectrum were measured at the file's native ${r.sampleRate} Hz; tempo, key, chords, structure and timbre were measured on a ${r.analysisSampleRate} Hz mono downmix using 2048-point short-time Fourier transforms.`,
    "Measured quantities (loudness, peaks, spectrum, stereo correlation, tempo, tuning) are objective and repeatable. Key, chords, meter and structure are model-based estimates: they rely on pitch-class profiles, chord templates and self-similarity, and can be confused by dense arrangements, heavy distortion, non-Western tunings or rubato. Mood, style and vocal likelihood are heuristics and should be read as suggestions.",
  ];
  return { id: "method", title: "Method and confidence", paragraphs: paras, table: { columns: ["Stage", "Time"], rows: r.timings.map((t) => [t.stage, `${t.ms} ms`]) } };
}

// ───────────────────────────────────────────────────────────────────────────────

export function reportToMarkdown(rep: Report): string {
  const out: string[] = [`# ${rep.title}`, "", `_${rep.subtitle}_`, ""];
  for (const s of rep.sections) {
    out.push(`## ${s.title}`, "");
    for (const p of s.paragraphs) out.push(p, "");
    if (s.bullets?.length) { for (const b of s.bullets) out.push(`- ${b}`); out.push(""); }
    if (s.facts?.length) {
      out.push("| | |", "|---|---|");
      for (const f of s.facts) out.push(`| ${f.label} | ${f.value}${f.note ? ` _(${f.note})_` : ""} |`);
      out.push("");
    }
    if (s.table) {
      out.push(`| ${s.table.columns.join(" | ")} |`, `|${s.table.columns.map(() => "---").join("|")}|`);
      for (const row of s.table.rows) out.push(`| ${row.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`);
      out.push("");
    }
  }
  return out.join("\n");
}

export function reportToPlainText(rep: Report): string {
  return reportToMarkdown(rep).replace(/^#+\s*/gm, "").replace(/[_*`]/g, "").replace(/^\|---.*$/gm, "").replace(/\|/g, " ");
}
