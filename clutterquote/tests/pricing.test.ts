import { describe, expect, it } from "vitest";
import { billedFractionFor, computeQuote, curvePrice, depositFor, truckLabel, volumePrice } from "@/lib/pricing/engine";
import { DEFAULT_DEPOSIT, DEFAULT_PRICING as cfg } from "@/lib/tenants/defaults";
import type { AccessDetails, QuoteInput } from "@/lib/types";

const noAccess: AccessDetails = { stairsFlights: 0, basement: false, longCarry: false, curbside: false };
const inv = (lines: QuoteInput["lines"], extra: Partial<QuoteInput> = {}): QuoteInput => ({
  method: "inventory",
  lines,
  looseYd3: 0,
  access: noAccess,
  ...extra,
});

describe("volume pricing", () => {
  it("rounds volume up to the next eighth of a truck", () => {
    expect(billedFractionFor(0.01, 1 / 8)).toBe(1 / 8);
    expect(billedFractionFor(1 / 8, 1 / 8)).toBe(1 / 8); // exact boundary is not bumped
    expect(billedFractionFor(0.126, 1 / 8)).toBe(2 / 8);
    expect(billedFractionFor(0, 1 / 8)).toBe(0);
  });

  it("interpolates between tiers and clamps below the first", () => {
    expect(curvePrice(1 / 16, cfg.tiers)).toBe(149_00);
    expect(curvePrice(1 / 4, cfg.tiers)).toBe(249_00);
    expect(curvePrice(3 / 16, cfg.tiers)).toBe(199_00);
  });

  it("bills whole trucks at the full price plus the remainder on the curve", () => {
    // 1.25 trucks of a 15 yd³ truck = 18.75 yd³
    expect(volumePrice(18.75, cfg)).toEqual({ cents: 649_00 + 249_00, billedFraction: 1.25 });
  });

  it("labels fractions in eighths", () => {
    expect(truckLabel(1 / 4)).toBe("1/4 truckload");
    expect(truckLabel(3 / 8)).toBe("3/8 truckload");
    expect(truckLabel(1)).toBe("Full truck");
    expect(truckLabel(1.5)).toBe("1 truck + 1/2");
    expect(truckLabel(2)).toBe("2 trucks");
  });
});

describe("computeQuote", () => {
  it("prices a sofa + coffee table + boxes as a quarter load with an asymmetric range", () => {
    // 2.5 + 0.5 + 4×0.11 = 3.44 yd³ → 0.229 truck → billed 1/4
    const q = computeQuote(inv([
      { kind: "catalog", catalogId: "sofa_3_seat", quantity: 1 },
      { kind: "catalog", catalogId: "coffee_table", quantity: 1 },
      { kind: "catalog", catalogId: "box_medium", quantity: 4 },
    ]), cfg);
    expect(q.volumeYd3).toBeCloseTo(3.44);
    expect(q.truckLabel).toBe("1/4 truckload");
    expect(q.lowCents).toBe(245_00); // −5% stays at 1/4 → $249 rounded down to $5
    expect(q.highCents).toBe(330_00); // +20% → 4.13 yd³ → 3/8 → $329 → $330
    expect(q.adjustments).toEqual([]);
  });

  it("applies item surcharges and access fees to both ends", () => {
    const q = computeQuote(inv(
      [
        { kind: "catalog", catalogId: "mattress_queen_king", quantity: 2 },
        { kind: "catalog", catalogId: "refrigerator", quantity: 1 },
      ],
      { access: { stairsFlights: 2, basement: false, longCarry: true, curbside: false } },
    ), cfg);
    const codes = Object.fromEntries(q.adjustments.map((a) => [a.code, a.amountCents]));
    expect(codes).toEqual({
      "item:mattress_recycling": 60_00,
      "item:freon_recovery": 50_00,
      stairs: 50_00,
      long_carry: 30_00,
    });
    expect(q.lowCents).toBeGreaterThanOrEqual(q.volumeLowCents + 190_00 - 5_00);
    expect(q.handling).toContain("freon");
  });

  it("curbside discounts the volume charge and suppresses access fees with a warning", () => {
    const q = computeQuote(inv([{ kind: "catalog", catalogId: "sofa_3_seat", quantity: 2 }], {
      access: { stairsFlights: 3, basement: true, longCarry: false, curbside: true },
    }), cfg);
    expect(q.adjustments.map((a) => a.code)).toEqual(["curbside"]);
    expect(q.adjustments[0]!.amountCents).toBeLessThan(0);
    expect(q.warnings.join(" ")).toMatch(/Curbside/);
  });

  it("enforces the minimum charge for a single small item", () => {
    const q = computeQuote(inv([{ kind: "catalog", catalogId: "microwave", quantity: 1 }]), cfg);
    expect(q.lowCents).toBe(145_00); // 1/8 tier $149 beats the $119 minimum, rounded down
    const cheap = computeQuote(inv([{ kind: "catalog", catalogId: "microwave", quantity: 1 }]), {
      ...cfg,
      tiers: [{ fraction: 1 / 8, priceCents: 50_00 }, { fraction: 1, priceCents: 600_00 }],
    });
    expect(cheap.lowCents).toBe(cfg.minimumChargeCents - 4_00); // $119 rounds down to $115
  });

  it("bills dense debris by weight and flags extra trips", () => {
    // 3 yd³ of concrete = 7,200 lb in 1/4 of the truck's space.
    const q = computeQuote(inv([{ kind: "catalog", catalogId: "concrete", quantity: 3 }]), cfg);
    expect(q.billedFraction).toBe(1 / 4);
    expect(q.denseLoad).toBe(true);
    expect(q.trucksNeeded).toBe(2);
    const over = q.adjustments.find((a) => a.code === "overweight")!;
    // allowance 3000 × 1/4 = 750 lb → 6,450 lb over = 3.225 t × $120
    expect(over.amountCents).toBe(387_00);
    expect(q.warnings.some((w) => w.includes("2 trips"))).toBe(true);
  });

  it("widens photo ranges with model uncertainty, capped at maxPct", () => {
    const lines: QuoteInput["lines"] = [{ kind: "custom", label: "pile", quantity: 1, yd3Each: 6, lbsEach: 900 }];
    const tight = computeQuote({ ...inv(lines), method: "photos", photoUncertainty: 0 }, cfg);
    const loose = computeQuote({ ...inv(lines), method: "photos", photoUncertainty: 0.9 }, cfg);
    expect(tight.volumeHighYd3).toBeCloseTo(6 * 1.15);
    expect(loose.volumeHighYd3).toBeCloseTo(6 * 1.4);
    expect(loose.highCents - loose.lowCents).toBeGreaterThan(tight.highCents - tight.lowCents);
  });

  it("returns zero for an empty load", () => {
    const q = computeQuote(inv([]), cfg);
    expect([q.lowCents, q.highCents, q.trucksNeeded, q.estimatedMinutes]).toEqual([0, 0, 0, 0]);
  });
});

describe("depositFor", () => {
  it("uses the fixed deposit but never more than the job's high end", () => {
    expect(depositFor(300_00, DEFAULT_DEPOSIT)).toBe(50_00);
    expect(depositFor(40_00, DEFAULT_DEPOSIT)).toBe(40_00);
    expect(depositFor(300_00, { ...DEFAULT_DEPOSIT, enabled: false })).toBe(0);
  });

  it("clamps percentage deposits to min/max", () => {
    const pct = { ...DEFAULT_DEPOSIT, mode: "percent" as const, percent: 20 };
    expect(depositFor(100_00, pct)).toBe(25_00);
    expect(depositFor(500_00, pct)).toBe(100_00);
    expect(depositFor(2000_00, pct)).toBe(150_00);
  });
});
