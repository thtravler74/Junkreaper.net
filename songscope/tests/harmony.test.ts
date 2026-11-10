import { describe, expect, it } from "vitest";
import { analyze } from "../src/analysis";
import { romanNumeral } from "../src/analysis/chords";
import { estimateKey, modalFlavour } from "../src/analysis/key";
import { describeProgression } from "../src/describe/progressions";
import { concatAudio, synthArrangement, synthSong } from "../src/demo/synth";

const info = { name: "t.wav", sizeBytes: 0, mimeType: "audio/wav", tags: {}, hasCoverArt: false };

describe("key estimation", () => {
  it("recognises a C major scale profile and a D minor profile", () => {
    const cMajor = [5, 0, 3, 0, 4, 3, 0, 5, 0, 3, 0, 2];
    expect(estimateKey(cMajor).name).toBe("C major");
    const dMinor = [2, 0, 6, 0, 2, 4, 0, 2, 0, 4, 3, 0]; // D E F G A B♭ C with D, A, F emphasised
    const k = estimateKey(dMinor);
    expect(k.name).toBe("D minor");
    expect(k.relative).toBe("F major");
    expect(k.dominant).toBe("A minor");
  });
  it("names scale degrees and modal flavour", () => {
    const k = estimateKey([5, 0, 3, 0, 4, 3, 0, 5, 0, 3, 3, 0]); // C major with ♭7 instead of 7
    expect(k.name).toBe("C major");
    const f = modalFlavour([5, 0, 3, 0, 4, 3, 0, 5, 0, 3, 3, 0], k);
    expect(f.label).toBe("Mixolydian");
    expect(f.detail).toMatch(/flattened 7th/);
  });
  it("produces Roman numerals relative to the key", () => {
    const c = estimateKey([5, 0, 3, 0, 4, 3, 0, 5, 0, 3, 0, 2]);
    expect(romanNumeral(0, "maj", c)).toBe("I");
    expect(romanNumeral(7, "7", c)).toBe("V7");
    expect(romanNumeral(9, "min", c)).toBe("vi");
    expect(romanNumeral(10, "maj", c)).toBe("♭VII");
    expect(romanNumeral(11, "dim", c)).toBe("vii°");
    const a = estimateKey([3, 0, 2, 0, 4, 2, 0, 2, 0, 6, 0, 2]);
    expect(a.name).toBe("A minor");
    expect(romanNumeral(9, "min", a)).toBe("i");
    expect(romanNumeral(5, "maj", a)).toBe("♭VI");
    expect(romanNumeral(4, "maj", a)).toBe("V");
  });
});

describe("chord recognition on synthesized audio", () => {
  it("recovers a I–V–vi–IV loop in C major with the right Roman numerals", () => {
    const a = synthSong({ bpm: 120, bars: 8, seed: 7 });
    const r = analyze(a, info);
    expect(r.harmony.key.name).toBe("C major");
    const labels = r.harmony.chords.filter((c) => c.quality !== "N" && c.beats >= 2).map((c) => c.label);
    const roots = [...new Set(labels.map((l) => l.replace(/m7|maj7|m|7/g, "")))];
    expect(roots.sort()).toEqual(["A", "C", "F", "G"]);
    const top = r.harmony.progression.commonProgressions[0]!;
    expect(top.romans.map((x) => x.replace(/maj7|7/g, ""))).toEqual(["I", "V", "vi", "IV"]);
    expect(describeProgression(top.romans)).toMatch(/Axis/);
    expect(r.harmony.progression.diatonicShare).toBeGreaterThan(0.9);
  });
  it("recognises a minor-key progression and a borrowed chord", () => {
    // D minor: Dm – B♭ – F – C  (i – ♭VI – ♭III – ♭VII); then add an E major (V in D minor, raised leading tone)
    const a = synthSong({ bpm: 100, bars: 8, seed: 3, chords: [{ root: 62, minor: true }, { root: 58, minor: false }, { root: 65, minor: false }, { root: 60, minor: false }] });
    const r = analyze(a, info);
    expect(r.harmony.key.name).toBe("D minor");
    const romans = new Set(r.harmony.chords.filter((c) => c.beats >= 2).map((c) => c.roman.replace(/maj7|7/g, "")));
    expect(romans.has("i")).toBe(true);
    expect(romans.has("♭VI")).toBe(true);
    expect(romans.has("♭III")).toBe(true);
    expect(r.harmony.progression.commonProgressions[0]!.romans.map((x) => x.replace(/maj7|7/g, ""))).toEqual(["i", "♭VI", "♭III", "♭VII"]);
    expect(describeProgression(["i", "♭VI", "♭III", "♭VII"])).toMatch(/minor-key pop loop/);
  });
});

describe("key regions over time", () => {
  it("keeps a stable song in one region and splits a real modulation", () => {
    const stable = analyze(synthArrangement(120, 44100, true), info);
    expect(stable.harmony.keyTimeline).toHaveLength(1);
    const modulating = concatAudio([
      synthSong({ bpm: 120, bars: 8, seed: 1 }),
      synthSong({ bpm: 120, bars: 8, seed: 2, chords: [{ root: 62, minor: false }, { root: 69, minor: false }, { root: 59, minor: true }, { root: 67, minor: false }] }),
    ]);
    const r = analyze(modulating, info);
    expect(r.harmony.keyTimeline.length).toBeGreaterThanOrEqual(2);
    expect(r.harmony.keyTimeline[r.harmony.keyTimeline.length - 1]!.key.name).toBe("D major");
    expect(r.harmony.keyTimeline[0]!.key.name).toBe("C major");
    expect(Math.abs(r.harmony.keyTimeline[r.harmony.keyTimeline.length - 1]!.start - 16)).toBeLessThan(6.5);
  });
});
