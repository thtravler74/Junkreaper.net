import { describe, expect, it } from "vitest";
import { measureLoudness, truePeak } from "../src/analysis/loudness";
import { sine } from "../src/demo/synth";

describe("BS.1770 loudness", () => {
  it("reads −3.01 LUFS for a full-scale 997 Hz sine in one channel (48 kHz and 44.1 kHz)", () => {
    for (const sr of [48000, 44100]) {
      const s = sine(997, 4, 1, sr);
      expect(measureLoudness([s], sr).integratedLufs).toBeCloseTo(-3.01, 0.7);
    }
  });
  it("tracks level linearly and sums two identical channels to +3 dB", () => {
    const s = sine(997, 4, 10 ** (-20 / 20), 48000);
    expect(measureLoudness([s], 48000).integratedLufs).toBeCloseTo(-23.0, 0.7);
    expect(measureLoudness([s, s], 48000).integratedLufs).toBeCloseTo(-20.0, 0.7);
  });
  it("reports 0 dBTP for a full-scale sine and the correct sample peak", () => {
    const s = sine(997, 2, 1, 44100);
    expect(truePeak([s], 44100)).toBeCloseTo(0, 1);
    const r = measureLoudness([s], 44100);
    expect(r.samplePeakDbfs).toBeLessThanOrEqual(0.01);
    expect(r.samplePeakDbfs).toBeGreaterThan(-0.05);
  });
  it("measures loudness range between a quiet and a loud passage", () => {
    const sr = 48000;
    const quiet = sine(500, 12, 10 ** (-30 / 20), sr), loud = sine(500, 12, 10 ** (-10 / 20), sr);
    const x = new Float32Array(quiet.length + loud.length); x.set(quiet); x.set(loud, quiet.length);
    const r = measureLoudness([x], sr);
    expect(r.loudnessRangeLu).toBeGreaterThan(15);
    expect(r.loudnessRangeLu).toBeLessThan(22);
    expect(r.shortTermMaxLufs).toBeGreaterThan(r.shortTermMinLufs + 15);
  });
  it("gates silence out of the integrated measurement", () => {
    const sr = 48000;
    const tone = sine(997, 3, 10 ** (-20 / 20), sr);
    const x = new Float32Array(tone.length * 3); x.set(tone, tone.length); // silence – tone – silence
    expect(Math.abs(measureLoudness([x], sr).integratedLufs + 23)).toBeLessThan(0.6);
  });
  it("counts clipping and DC offset", () => {
    const sr = 44100;
    const x = sine(100, 1, 1.4, sr).map((v) => Math.max(-1, Math.min(1, v + 0.02)));
    const r = measureLoudness([x], sr);
    expect(r.clippedSamples).toBeGreaterThan(1000);
    expect(r.clippedRuns).toBeGreaterThan(50);
    expect(r.dcOffset[0]).toBeGreaterThan(0.01);
  });
});
