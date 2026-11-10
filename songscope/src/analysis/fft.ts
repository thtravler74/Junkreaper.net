/**
 * Iterative radix-2 complex FFT with precomputed twiddles and bit-reversal table.
 * Sizes must be powers of two. Used for the STFT, autocorrelation and the
 * oversampling filter in the true-peak meter.
 */
export class FFT {
  readonly size: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      const a = (-2 * Math.PI * i) / size;
      this.cos[i] = Math.cos(a);
      this.sin[i] = Math.sin(a);
    }
  }

  /** In-place forward transform of (re, im). */
  forward(re: Float64Array | Float32Array, im: Float64Array | Float32Array): void {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
        const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = this.cos[k]!, wi = this.sin[k]!;
          const a = i + j, b = a + half;
          const xr = re[b]!, xi = im[b]!;
          const tr = xr * wr - xi * wi;
          const ti = xr * wi + xi * wr;
          re[b] = re[a]! - tr; im[b] = im[a]! - ti;
          re[a] = re[a]! + tr; im[a] = im[a]! + ti;
        }
      }
    }
  }

  /** Inverse transform (unnormalized output divided by N). */
  inverse(re: Float64Array, im: Float64Array): void {
    for (let i = 0; i < this.size; i++) im[i] = -im[i]!;
    this.forward(re, im);
    const inv = 1 / this.size;
    for (let i = 0; i < this.size; i++) { re[i] = re[i]! * inv; im[i] = -im[i]! * inv; }
  }
}

/** Periodic Hann window (matches the common STFT convention). */
export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Blackman window, used for FIR filter design. */
export function blackman(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / (n - 1);
    w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
  }
  return w;
}

/**
 * Reusable magnitude-spectrum computer: windows a real frame, runs the FFT and
 * writes the N/2+1 magnitudes into `out`. Allocation-free after construction.
 */
export class SpectrumAnalyzer {
  readonly fft: FFT;
  readonly bins: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  readonly window: Float32Array;

  constructor(size: number, window: Float32Array = hann(size)) {
    this.fft = new FFT(size);
    this.bins = size / 2 + 1;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.window = window;
  }

  /** Magnitude spectrum of `signal[offset .. offset+size)`, zero padded past the end. */
  magnitudes(signal: Float32Array, offset: number, out: Float32Array): void {
    const n = this.fft.size, re = this.re, im = this.im, w = this.window;
    for (let i = 0; i < n; i++) {
      const idx = offset + i;
      re[i] = idx >= 0 && idx < signal.length ? signal[idx]! * w[i]! : 0;
      im[i] = 0;
    }
    this.fft.forward(re, im);
    for (let k = 0; k < this.bins; k++) out[k] = Math.hypot(re[k]!, im[k]!);
  }
}

/** Autocorrelation via FFT (biased estimate), returns lags 0..maxLag. */
export function autocorrelate(x: Float32Array | Float64Array, maxLag: number): Float64Array {
  let n = 1;
  while (n < x.length * 2) n <<= 1;
  const fft = new FFT(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i]!;
  fft.forward(re, im);
  for (let i = 0; i < n; i++) { re[i] = re[i]! * re[i]! + im[i]! * im[i]!; im[i] = 0; }
  fft.inverse(re, im);
  const out = new Float64Array(maxLag + 1);
  for (let l = 0; l <= maxLag; l++) out[l] = re[l]!;
  return out;
}
