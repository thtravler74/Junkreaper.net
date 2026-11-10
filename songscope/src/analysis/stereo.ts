export interface StereoResult {
  channels: number;
  isDualMono: boolean;
  correlation: number; // mean inter-channel Pearson correlation (−1..1)
  width: number; // side energy / (mid + side) averaged, 0..1
  widthOverTime: { time: number; width: number; correlation: number }[];
  balanceDb: number; // positive = right louder
  negativeCorrelationShare: number; // fraction of blocks with correlation < 0
  lowBandCorrelation: number; // correlation below ~150 Hz
  sideToMidDb: number;
}

function onePoleLowpass(x: Float32Array, fs: number, fc: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * fc) / fs);
  const y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) { s = a * s + (1 - a) * x[i]!; y[i] = s; }
  return y;
}

function corr(a: Float32Array, b: Float32Array, s: number, e: number): number {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const n = e - s;
  for (let i = s; i < e; i++) { const x = a[i]!, y = b[i]!; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; }
  const cov = sab / n - (sa / n) * (sb / n), va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  return va > 1e-14 && vb > 1e-14 ? cov / Math.sqrt(va * vb) : 0;
}

export function analyzeStereo(channels: Float32Array[], fs: number): StereoResult {
  if (channels.length < 2) {
    return { channels: channels.length, isDualMono: false, correlation: 1, width: 0, widthOverTime: [], balanceDb: 0, negativeCorrelationShare: 0, lowBandCorrelation: 1, sideToMidDb: -Infinity };
  }
  const L = channels[0]!, R = channels[1]!;
  const n = Math.min(L.length, R.length);
  let maxDiff = 0, eL = 0, eR = 0, eM = 0, eS = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i]!, r = R[i]!;
    const d = Math.abs(l - r); if (d > maxDiff) maxDiff = d;
    eL += l * l; eR += r * r;
    const m = (l + r) * 0.5, s = (l - r) * 0.5;
    eM += m * m; eS += s * s;
  }
  const block = Math.round(fs * 1);
  const widthOverTime: { time: number; width: number; correlation: number }[] = [];
  let corrSum = 0, neg = 0, count = 0, wSum = 0;
  for (let s = 0; s + block <= n; s += block) {
    let bm = 0, bs = 0, e = 0;
    for (let i = s; i < s + block; i++) { const l = L[i]!, r = R[i]!; const m = (l + r) * 0.5, sd = (l - r) * 0.5; bm += m * m; bs += sd * sd; e += l * l + r * r; }
    if (e / block < 1e-8) continue; // skip silence
    const c = corr(L, R, s, s + block);
    const w = bs / (bm + bs + 1e-12);
    widthOverTime.push({ time: (s + block / 2) / fs, width: w, correlation: c });
    corrSum += c; wSum += w; count++; if (c < 0) neg++;
  }
  const lowL = onePoleLowpass(L, fs, 150), lowR = onePoleLowpass(R, fs, 150);
  const lowCorr = corr(lowL, lowR, 0, n);
  return {
    channels: channels.length,
    isDualMono: maxDiff < 1e-4,
    correlation: count ? corrSum / count : 1,
    width: count ? wSum / count : 0,
    widthOverTime,
    balanceDb: 10 * Math.log10((eR + 1e-12) / (eL + 1e-12)),
    negativeCorrelationShare: count ? neg / count : 0,
    lowBandCorrelation: lowCorr,
    sideToMidDb: 10 * Math.log10((eS + 1e-12) / (eM + 1e-12)),
  };
}
