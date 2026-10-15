import { describe, expect, it } from "vitest";
import { listSlots } from "@/lib/availability";
import { checkServiceArea, haversineMiles } from "@/lib/serviceArea";
import { DEFAULT_SCHEDULING, DEFAULT_SERVICE_AREA } from "@/lib/tenants/defaults";
import { addDays, dayOfWeek, zonedToUtc } from "@/lib/time";

describe("time helpers", () => {
  it("converts New York wall time across DST", () => {
    expect(zonedToUtc("2026-07-01", "08:00", "America/New_York").toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "08:00", "America/New_York").toISOString()).toBe("2026-12-01T13:00:00.000Z");
    // DST ends 2026-11-01 at 02:00; 08:00 that morning is already EST.
    expect(zonedToUtc("2026-11-01", "08:00", "America/New_York").toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });

  it("does calendar arithmetic on local dates", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(dayOfWeek("2026-10-18")).toBe(0);
  });
});

describe("listSlots", () => {
  // Thursday 2026-10-15 06:00 EDT
  const now = new Date("2026-10-15T10:00:00Z");
  const cfg = { ...DEFAULT_SCHEDULING, horizonDays: 3 };

  it("respects lead time, work days and the horizon", () => {
    const slots = listSlots(cfg, [], now);
    // Lead time 12h → earliest 18:00 today, so the first slot is Friday 08:00. Sunday is off.
    expect(slots[0]!.key).toBe("2026-10-16T08:00");
    expect(new Set(slots.map((s) => s.date))).toEqual(new Set(["2026-10-16", "2026-10-17"]));
    expect(slots[0]!.remaining).toBe(2);
  });

  it("counts confirmed bookings and live holds, ignores expired holds", () => {
    const key = "2026-10-16T08:00";
    const later = new Date(now.getTime() + 3_600_000).toISOString();
    const earlier = new Date(now.getTime() - 1).toISOString();
    const slots = listSlots(cfg, [
      { slotKey: key, status: "confirmed" },
      { slotKey: key, status: "pending_payment", holdExpiresAt: earlier },
      { slotKey: "2026-10-16T10:00", status: "confirmed" },
      { slotKey: "2026-10-16T10:00", status: "pending_payment", holdExpiresAt: later },
      { slotKey: "2026-10-16T12:00", status: "cancelled" },
    ], now);
    const byKey = Object.fromEntries(slots.map((s) => [s.key, s.remaining]));
    expect(byKey[key]).toBe(1);
    expect(byKey["2026-10-16T10:00"]).toBeUndefined();
    expect(byKey["2026-10-16T12:00"]).toBe(2);
  });

  it("closes windows overlapping calendar busy blocks", () => {
    const busy = [{ start: new Date("2026-10-16T13:30:00Z"), end: new Date("2026-10-16T14:30:00Z") }];
    const keys = listSlots(cfg, [], now, busy).map((s) => s.key);
    expect(keys).not.toContain("2026-10-16T08:00"); // 12:00–14:00Z
    expect(keys).not.toContain("2026-10-16T10:00"); // 14:00–16:00Z
    expect(keys).toContain("2026-10-16T12:00");
  });
});

describe("checkServiceArea", () => {
  const at = (lat: number, lng: number) => async () => ({ lat, lng });

  it("measures distance from the base", async () => {
    expect(haversineMiles({ lat: 39.9612, lng: -82.9988 }, { lat: 39.1031, lng: -84.512 })).toBeCloseTo(100.1, 1);
    expect((await checkServiceArea("43081", DEFAULT_SERVICE_AREA, at(40.11, -82.93))).status).toBe("in_area");
    const ext = await checkServiceArea("43123", DEFAULT_SERVICE_AREA, at(39.5, -83.3));
    expect(ext).toMatchObject({ status: "extended", tripFeeCents: 35_00 });
    expect((await checkServiceArea("45202", DEFAULT_SERVICE_AREA, at(39.1031, -84.512))).status).toBe("out_of_area");
  });

  it("lets explicit zip lists override distance and degrades when geocoding fails", async () => {
    const cfg = { ...DEFAULT_SERVICE_AREA, includeZips: ["45202"], excludeZips: ["43081"] };
    expect((await checkServiceArea("45202", cfg, at(0, 0))).status).toBe("in_area");
    expect((await checkServiceArea("43081", cfg, at(40.11, -82.93))).status).toBe("out_of_area");
    const failing = async () => { throw new Error("down"); };
    expect((await checkServiceArea("43215", DEFAULT_SERVICE_AREA, failing)).status).toBe("in_area");
    expect((await checkServiceArea("43220", DEFAULT_SERVICE_AREA, failing)).status).toBe("unverified");
  });
});
