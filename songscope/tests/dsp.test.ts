import { describe, expect, it } from "vitest";
import { autocorrelate, FFT } from "../src/analysis/fft";
import { resample } from "../src/analysis/resample";
import { sine } from "../src/demo/synth";

describe("FFT", () => {
  it("matches a naive DFT", () => {
    const n = 64;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.9);
    const fft = new FFT(n);
    const r2 = re.slice(), i2 = im.slice();
    fft.forward(r2, i2);
    for (let k = 0; k < n; k++) {
      let sr = 0, si = 0;
      for (let t = 0; t < n; t++) { const a = (-2 * Math.PI * k * t) / n; sr += re[t]! * Math.cos(a); si += re[t]! * Math.sin(a); }
      expect(r2[k]).toBeCloseTo(sr, 8);
      expect(i2[k]).toBeCloseTo(si, 8);
    }
  });
  it("inverse recovers the input", () => {
    const n = 256;
    const re = new Float64Array(n).map((_, i) => Math.sin(i * 0.1)), im = new Float64Array(n);
    const fft = new FFT(n);
    const r = re.slice(), i = im.slice();
    fft.forward(r, i); fft.inverse(r, i);
    for (let k = 0; k < n; k++) expect(r[k]).toBeCloseTo(re[k]!, 9);
  });
  it("autocorrelation peaks at the period", () => {
    const x = new Float32Array(1000);
    for (let i = 0; i < x.length; i += 25) x[i] = 1;
    const ac = autocorrelate(x, 100);
    let best = 1; for (let l = 2; l <= 100; l++) if (ac[l]! > ac[best]!) best = l;
    expect(best).toBe(25);
  });
});

describe("resampler", () => {
  it("preserves a tone's frequency and amplitude", () => {
    const sr = 44100, out = 22050;
    const x = sine(1000, 1, 0.5, sr);
    const y = resample(x, sr, out);
    expect(y.length).toBe(22050);
    // amplitude via RMS, skipping the edges
    let acc = 0, zc = 0;
    for (let i = 500; i < y.length - 500; i++) { acc += y[i]! * y[i]!; if ((y[i]! >= 0) !== (y[i - 1]! >= 0)) zc++; }
    const rms = Math.sqrt(acc / (y.length - 1000));
    expect(rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
    const freq = (zc / 2) / ((y.length - 1000) / out);
    expect(freq).toBeCloseTo(1000, -1);
  });
});
