import { describe, expect, it } from "vitest";
import { analyze } from "../src/analysis";
import { buildReport, reportToMarkdown } from "../src/describe";
import { synthArrangement } from "../src/demo/synth";

const info = { name: "arrangement.wav", sizeBytes: 123, mimeType: "audio/wav", container: "WAVE", codec: "PCM", lossless: true, bitsPerSample: 16, tags: { title: "Arrangement", artist: "Tests", bpm: 120 }, hasCoverArt: false };

describe("structure, melody and the written report", () => {
  const audio = synthArrangement(120, 44100, true);
  const result = analyze(audio, info);
  const report = buildReport(result);

  it("segments the arrangement into intro / verse / chorus / outro and finds the chorus loudest", () => {
    const names = result.structure.sections.map((s) => s.name);
    expect(names[0]).toBe("Intro");
    expect(names[names.length - 1]).toBe("Outro");
    expect(names.some((n) => n.startsWith("Chorus"))).toBe(true);
    expect(names.some((n) => n.startsWith("Verse"))).toBe(true);
    const chorus = result.structure.sections.filter((s) => s.name.startsWith("Chorus"));
    const verse = result.structure.sections.filter((s) => s.name.startsWith("Verse"));
    expect(Math.min(...chorus.map((s) => s.levelDb))).toBeGreaterThan(Math.max(...verse.map((s) => s.levelDb)));
    expect(result.structure.repetitionScore).toBeGreaterThan(0.5);
    expect(result.energy.fadeOutSec).toBeGreaterThanOrEqual(0);
  });
  it("tracks the lead melody with vibrato", () => {
    expect(result.melody.voicedShare).toBeGreaterThan(0.3);
    expect(result.melody.vibratoShare).toBeGreaterThan(0.05);
    expect(result.melody.rangeSemitones).toBeGreaterThan(3);
    expect(result.melody.rangeSemitones).toBeLessThan(30);
  });
  it("writes a long, complete description", () => {
    expect(report.sections.map((s) => s.id)).toEqual(["overview", "file", "rhythm", "key", "chords", "structure", "energy", "loudness", "timbre", "stereo", "melody", "character", "method"]);
    expect(report.wordCount).toBeGreaterThan(1200);
    const md = reportToMarkdown(report);
    expect(md).toContain("# Arrangement — Tests");
    expect(md).toContain("C major");
    expect(md).toContain("BPM");
    expect(md).toContain("LUFS");
    expect(md).toContain("Intro");
    expect(md).toMatch(/agrees with the measured tempo/);
    expect(md).toMatch(/Axis/);
  });
  it("is JSON-serialisable without the previews", () => {
    const { previews, ...rest } = result;
    expect(previews?.waveform.columns).toBeGreaterThan(100);
    const json = JSON.stringify(rest);
    expect(JSON.parse(json).rhythm.bpm).toBeCloseTo(result.rhythm.bpm, 5);
  });
});
