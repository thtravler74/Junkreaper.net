import { addDays, dayOfWeek, localDate, zonedToUtc } from "./time";
import type { BookingRecord, SchedulingConfig } from "./types";

export interface Slot {
  /** "YYYY-MM-DDTHH:MM" local; the unit capacity is counted in. */
  key: string;
  date: string;
  start: string;
  end: string;
  startUtc: string;
  endUtc: string;
  remaining: number;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

/** Does this booking currently consume capacity? Expired holds don't. */
export function holdsCapacity(b: Pick<BookingRecord, "status" | "holdExpiresAt">, now: Date): boolean {
  if (b.status === "confirmed") return true;
  if (b.status === "pending_payment") return !b.holdExpiresAt || new Date(b.holdExpiresAt) > now;
  return false;
}

/**
 * Bookable arrival windows over the tenant's horizon.
 *
 * Capacity is per window: crewsPerWindow jobs, minus bookings that hold the
 * slot (confirmed, or awaiting payment with a live hold). When the tenant links
 * a Google Calendar with blockOnBusy, any busy block overlapping a window closes
 * it entirely, which suits small operators who also book by phone.
 */
export function listSlots(
  cfg: SchedulingConfig,
  bookings: Pick<BookingRecord, "slotKey" | "status" | "holdExpiresAt">[],
  now: Date,
  busy: BusyInterval[] = [],
): Slot[] {
  const used = new Map<string, number>();
  for (const b of bookings) if (holdsCapacity(b, now)) used.set(b.slotKey, (used.get(b.slotKey) ?? 0) + 1);

  const earliest = now.getTime() + cfg.leadTimeHours * 3_600_000;
  const today = localDate(now, cfg.timezone);
  const slots: Slot[] = [];

  for (let i = 0; i <= cfg.horizonDays; i++) {
    const date = addDays(today, i);
    if (!cfg.workDays.includes(dayOfWeek(date)) || cfg.blackoutDates.includes(date)) continue;
    for (const w of cfg.windows) {
      const start = zonedToUtc(date, w.start, cfg.timezone);
      const end = zonedToUtc(date, w.end, cfg.timezone);
      if (start.getTime() < earliest) continue;
      if (busy.some((b) => b.start < end && b.end > start)) continue;
      const key = `${date}T${w.start}`;
      const remaining = cfg.crewsPerWindow - (used.get(key) ?? 0);
      if (remaining <= 0) continue;
      slots.push({ key, date, start: w.start, end: w.end, startUtc: start.toISOString(), endUtc: end.toISOString(), remaining });
    }
  }
  return slots;
}
