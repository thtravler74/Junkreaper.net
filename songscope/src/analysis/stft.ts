import { SpectrumAnalyzer } from "./fft";

export interface Spectrogram {
  /** Flat row-major magnitudes: frame * bins + bin. */
  data: Float32Array;
  frames: number;
  bins: number;
  fftSize: number;
  hop: number;
  sampleRate: number;
  /** Centre time (seconds) of frame i. */
  frameTime(i: number): number;
  /** Frequency (Hz) of bin k. */
  binFreq(k: number): number;
  row(i: number): Float32Array;
}

export interface StftOptions {
  fftSize: number;
  hop: number;
  sampleRate: number;
  onProgress?: (fraction: number) => void;
}

/** Centre-padded magnitude STFT, Hann window. */
export function stft(signal: Float32Array, opts: StftOptions): Spectrogram {
  const { fftSize, hop, sampleRate } = opts;
  const analyzer = new SpectrumAnalyzer(fftSize);
  const bins = analyzer.bins;
  const frames = Math.max(1, Math.floor(signal.length / hop) + 1);
  const data = new Float32Array(frames * bins);
  const scratch = new Float32Array(bins);
  const scale = 2 / fftSize; // single-sided amplitude normalisation
  for (let f = 0; f < frames; f++) {
    analyzer.magnitudes(signal, f * hop - fftSize / 2, scratch);
    const base = f * bins;
    for (let k = 0; k < bins; k++) data[base + k] = scratch[k]! * scale;
    if (opts.onProgress && (f & 255) === 0) opts.onProgress(f / frames);
  }
  return {
    data, frames, bins, fftSize, hop, sampleRate,
    frameTime: (i) => (i * hop) / sampleRate,
    binFreq: (k) => (k * sampleRate) / fftSize,
    row: (i) => data.subarray(i * bins, (i + 1) * bins),
  };
}
