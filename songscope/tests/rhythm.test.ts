import { describe, expect, it } from "vitest";
import { analyze } from "../src/analysis";
import { synthSong } from "../src/demo/synth";

const info = { name: "t.wav", sizeBytes: 0, mimeType: "audio/wav", tags: {}, hasCoverArt: false };

describe("tempo, beats and meter", () => {
  it.each([92, 120, 140])("finds %i BPM within 1.5 BPM and a steady grid", (bpm) => {
    const r = analyze(synthSong({ bpm, bars: 10, seed: bpm }), info);
    expect(Math.abs(r.rhythm.bpm - bpm)).toBeLessThan(1.5);
    expect(r.rhythm.tempoStability).toBeGreaterThan(0.8);
    expect(r.rhythm.beatIntervalCv).toBeLessThan(0.08);
    expect(r.rhythm.meter.label).toBe("4/4");
    expect(r.rhythm.swing.label).toBe("straight");
    // one beat per 60/bpm seconds, allowing for the edges
    expect(Math.abs(r.rhythm.beats.length - (r.durationSec * bpm) / 60)).toBeLessThan(4);
  });
  it("hears a waltz as 3/4", () => {
    const r = analyze(synthSong({ bpm: 126, bars: 14, seed: 9, beatsPerBar: 3 }), info);
    expect(Math.abs(r.rhythm.bpm - 126)).toBeLessThan(2);
    expect(r.rhythm.meter.beatsPerBar).toBe(3);
  });
  it("reports low beat strength and stability for a beatless pad", () => {
    const r = analyze(synthSong({ bpm: 120, bars: 8, seed: 2, drums: false }), info);
    expect(r.rhythm.beatStrength).toBeLessThan(0.6);
    expect(r.descriptors.danceability).toBeLessThan(0.75);
    expect(r.timbre.percussiveShare).toBeLessThan(0.3);
  });
});
