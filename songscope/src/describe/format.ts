export function mmss(sec: number): string {
  if (!Number.isFinite(sec)) return "–";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function mmssFrac(sec: number): string {
  if (!Number.isFinite(sec)) return "–";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
export function dB(v: number, digits = 1, unit = "dB"): string {
  if (!Number.isFinite(v)) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)} ${unit}`.trim();
}
export function num(v: number, digits = 1): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "–";
}
export function pct(v: number, digits = 0): string {
  return Number.isFinite(v) ? `${(v * 100).toFixed(digits)} %` : "–";
}
export function hz(v: number): string {
  if (!Number.isFinite(v)) return "–";
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v.toFixed(0)} Hz`;
}
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}
export function list(items: string[], conj = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conj} ${items[items.length - 1]}`;
}
export function confidenceWord(c: number): string {
  if (c >= 0.75) return "high confidence";
  if (c >= 0.5) return "moderate confidence";
  if (c >= 0.3) return "low confidence";
  return "very low confidence";
}
export function level(v: number, words: [number, string][]): string {
  for (const [t, w] of words) if (v < t) return w;
  return words[words.length - 1]![1];
}
