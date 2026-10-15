/**
 * Minimal IANA-timezone helpers on top of Intl, so slot math is correct across
 * DST without a date library. Local dates are "YYYY-MM-DD" strings, local
 * times "HH:MM".
 */

function partsIn(date: Date, timeZone: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (EDT → −4h). */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time. Two passes handle DST: the offset
 * at the naive guess can differ from the offset at the true instant. Times that
 * don't exist (spring-forward gap) resolve to the later offset.
 */
export function zonedToUtc(localDate: string, localTime: string, timeZone: string): Date {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  const [hh, mm] = localTime.split(":").map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = tzOffsetMs(new Date(naive), timeZone);
  const second = tzOffsetMs(new Date(naive - first), timeZone);
  return new Date(naive - second);
}

/** Today's local date in `timeZone`. */
export function localDate(now: Date, timeZone: string): string {
  const p = partsIn(now, timeZone);
  return `${p.year}-${pad(p.month!)}-${pad(p.day!)}`;
}

export function addDays(localDateStr: string, days: number): string {
  const [y, m, d] = localDateStr.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday. */
export function dayOfWeek(localDateStr: string): number {
  const [y, m, d] = localDateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
