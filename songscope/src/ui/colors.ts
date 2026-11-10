/** Inferno-like colormap sampled at 16 points, interpolated. */
const STOPS: [number, number, number][] = [
  [0, 0, 4], [12, 8, 40], [40, 11, 84], [70, 10, 107], [100, 20, 110], [130, 30, 105], [160, 42, 95], [187, 56, 80],
  [212, 72, 66], [231, 94, 48], [245, 120, 28], [251, 150, 10], [252, 184, 15], [247, 219, 48], [243, 243, 110], [252, 255, 164],
];
export function inferno(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(0.9999, t)) * (STOPS.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = STOPS[i]!, b = STOPS[Math.min(STOPS.length - 1, i + 1)]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export const SECTION_COLORS = ["#4f8cff", "#ff7a59", "#3ddc97", "#f7c948", "#c084fc", "#38bdf8", "#fb7185", "#a3e635", "#f472b6", "#fbbf24"];
export function sectionColor(label: string): string {
  const i = label.charCodeAt(0) - 65;
  return SECTION_COLORS[((i % SECTION_COLORS.length) + SECTION_COLORS.length) % SECTION_COLORS.length]!;
}
