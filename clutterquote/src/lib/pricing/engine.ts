/**
 * The pricing engine. Pure and deterministic: the widget runs it for live
 * feedback as items are toggled, and the server re-runs it to issue the
 * authoritative quote a booking is tied to. Never trust a client-side price.
 *
 * The model mirrors how haulers actually price:
 *
 *   1. Volume sets the base price. Volume → fraction of a truck → rounded UP to the
 *      billing increment (1/8 truck by default) → looked up on the tenant's
 *      piecewise-linear price curve. Loads over one truck bill whole trucks at the
 *      full-truck price plus the remainder on the curve.
 *   2. Weight only matters past an allowance that scales with the billed fraction.
 *      Dense debris (concrete, dirt, shingles) blows through it fast, and the excess
 *      is billed per ton, the way the transfer station bills the hauler.
 *   3. Fixed adjustments: per-item disposal surcharges (mattresses, Freon, e-waste,
 *      tires), access fees (stairs, basement, long carry), trip fee, and a curbside
 *      discount on the volume component.
 *   4. A range rather than a point. The spread reflects how much the input can be
 *      trusted: a customer's own checklist under-reports (asymmetric, skewed high);
 *      photos are symmetric and widen with the vision model's uncertainty.
 */
import { getCatalogItem, type HandlingFlag, type SurchargeKey } from "../catalog";
import type { Adjustment, Cents, PricingConfig, QuoteInput, QuoteResult } from "../types";

/** Default density for unitemized household clutter, lb per loaded yd³. */
export const LOOSE_LBS_PER_YD3 = 150;

const SURCHARGE_LABELS: Record<SurchargeKey, string> = {
  mattress_recycling: "Mattress recycling",
  freon_recovery: "Freon recovery",
  e_waste: "E-waste recycling",
  crt_e_waste: "CRT TV recycling",
  tire: "Tire disposal",
  tire_on_rim: "Tire disposal (on rim)",
  hot_tub_demo: "Hot tub cut-up",
  piano: "Piano handling",
  heavy_item: "Heavy item handling",
};

const EPS = 1e-9;

export function formatUsd(cents: Cents): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
  });
}

/** Round a truck fraction UP to the billing increment. */
export function billedFractionFor(fraction: number, increment: number): number {
  if (fraction <= EPS) return 0;
  return Math.ceil(fraction / increment - EPS) * increment;
}

/** Price for a fraction of ONE truck (0 < fraction ≤ 1) on the tenant's curve. */
export function curvePrice(fraction: number, tiers: PricingConfig["tiers"]): Cents {
  const sorted = [...tiers].sort((a, b) => a.fraction - b.fraction);
  const first = sorted[0];
  if (!first || fraction <= EPS) return 0;
  if (fraction <= first.fraction + EPS) return first.priceCents;
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1]!;
    const hi = sorted[i]!;
    if (fraction <= hi.fraction + EPS) {
      const t = (fraction - lo.fraction) / (hi.fraction - lo.fraction);
      return Math.round(lo.priceCents + t * (hi.priceCents - lo.priceCents));
    }
  }
  return sorted[sorted.length - 1]!.priceCents;
}

/** Volume-only price for any number of cubic yards (multi-truck aware). */
export function volumePrice(yd3: number, cfg: PricingConfig): { cents: Cents; billedFraction: number } {
  const billed = billedFractionFor(yd3 / cfg.truckCapacityYd3, cfg.billingIncrement);
  const fullTrucks = Math.floor(billed + EPS);
  const remainder = billed - fullTrucks;
  const fullPrice = curvePrice(1, cfg.tiers);
  const cents = fullTrucks * fullPrice + (remainder > EPS ? curvePrice(remainder, cfg.tiers) : 0);
  return { cents, billedFraction: billed };
}

/** "3/8 truckload", "Full truck", "2 trucks + 1/4". Expressed in eighths. */
export function truckLabel(billedFraction: number): string {
  if (billedFraction <= EPS) return "Nothing selected yet";
  const eighths = Math.round(billedFraction * 8);
  const whole = Math.floor(eighths / 8);
  const rem = eighths % 8;
  const g = gcd(rem, 8);
  const remText = rem ? `${rem / g}/${8 / g}` : "";
  if (whole === 0) return `${remText} truckload`;
  const trucks = whole === 1 ? (rem ? "1 truck" : "Full truck") : `${whole} trucks`;
  return rem ? `${trucks} + ${remText}` : trucks;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function roundDown(cents: Cents, to: Cents): Cents {
  return to > 0 ? Math.floor(cents / to) * to : cents;
}

function roundUp(cents: Cents, to: Cents): Cents {
  return to > 0 ? Math.ceil(cents / to) * to : cents;
}

interface Totals {
  volumeYd3: number;
  weightLbs: number;
  denseLbs: number;
  surcharges: Map<SurchargeKey, number>;
  handling: Set<HandlingFlag>;
  unknownIds: string[];
}

function sumLines(input: QuoteInput): Totals {
  const totals: Totals = {
    volumeYd3: 0,
    weightLbs: 0,
    denseLbs: 0,
    surcharges: new Map(),
    handling: new Set(),
    unknownIds: [],
  };
  for (const line of input.lines) {
    const qty = Math.max(0, line.quantity);
    if (qty === 0) continue;
    if (line.kind === "custom") {
      totals.volumeYd3 += qty * line.yd3Each;
      totals.weightLbs += qty * line.lbsEach;
      continue;
    }
    const item = getCatalogItem(line.catalogId);
    if (!item) {
      totals.unknownIds.push(line.catalogId);
      continue;
    }
    totals.volumeYd3 += qty * item.yd3;
    totals.weightLbs += qty * item.lbs;
    if (item.dense) totals.denseLbs += qty * item.lbs;
    if (item.surcharge) totals.surcharges.set(item.surcharge, (totals.surcharges.get(item.surcharge) ?? 0) + qty);
    for (const flag of item.handling ?? []) totals.handling.add(flag);
  }
  const loose = Math.max(0, input.looseYd3);
  totals.volumeYd3 += loose;
  totals.weightLbs += input.looseLbs ?? loose * LOOSE_LBS_PER_YD3;
  return totals;
}

function spreadFor(input: QuoteInput, cfg: PricingConfig): { low: number; high: number } {
  if (input.method === "inventory") {
    return { low: cfg.spread.inventory.lowPct / 100, high: cfg.spread.inventory.highPct / 100 };
  }
  const u = Math.min(cfg.spread.photos.maxPct / 100, cfg.spread.photos.basePct / 100 + (input.photoUncertainty ?? 0));
  return { low: u, high: u };
}

export function computeQuote(input: QuoteInput, cfg: PricingConfig): QuoteResult {
  const totals = sumLines(input);
  const volume = totals.volumeYd3;
  const spread = spreadFor(input, cfg);
  const volumeLow = volume * (1 - spread.low);
  const volumeHigh = volume * (1 + spread.high);

  const point = volumePrice(volume, cfg);
  const low = volumePrice(volumeLow, cfg);
  const high = volumePrice(volumeHigh, cfg);

  const adjustments: Adjustment[] = [];
  const warnings: string[] = [];

  // Weight: allowance scales with the billed space; the excess is billed per ton.
  const allowance = cfg.includedLbsPerTruck * Math.max(point.billedFraction, cfg.billingIncrement);
  const overLbs = Math.max(0, totals.weightLbs - allowance);
  if (overLbs > 0 && cfg.overweightCentsPerTon > 0) {
    const tons = overLbs / 2000;
    adjustments.push({
      code: "overweight",
      label: `Heavy load (~${tons.toFixed(1)} tons over allowance)`,
      amountCents: Math.round(tons * cfg.overweightCentsPerTon),
    });
  }

  for (const [key, qty] of totals.surcharges) {
    const each = cfg.itemSurcharges[key];
    if (!each) continue;
    adjustments.push({
      code: `item:${key}`,
      label: qty > 1 ? `${SURCHARGE_LABELS[key]} ×${qty}` : SURCHARGE_LABELS[key],
      amountCents: each * qty,
    });
  }

  const { access } = input;
  if (access.curbside) {
    if (access.stairsFlights > 0 || access.basement || access.longCarry) {
      warnings.push("Curbside pickup selected, so stairs, basement and long-carry fees were not applied.");
    }
    const discount = Math.round((point.cents * cfg.access.curbsideDiscountPct) / 100);
    if (discount > 0) adjustments.push({ code: "curbside", label: "Curbside discount", amountCents: -discount });
  } else {
    const flights = Math.max(0, Math.floor(access.stairsFlights));
    if (flights > 0 && cfg.access.stairsPerFlightCents > 0) {
      adjustments.push({
        code: "stairs",
        label: flights === 1 ? "Stairs fee (1 flight)" : `Stairs fee (${flights} flights)`,
        amountCents: flights * cfg.access.stairsPerFlightCents,
      });
    }
    if (access.basement && cfg.access.basementCents > 0) {
      adjustments.push({ code: "basement", label: "Basement pickup", amountCents: cfg.access.basementCents });
    }
    if (access.longCarry && cfg.access.longCarryCents > 0) {
      adjustments.push({ code: "long_carry", label: "Long carry (>50 ft)", amountCents: cfg.access.longCarryCents });
    }
  }

  if (input.tripFeeCents && input.tripFeeCents > 0) {
    adjustments.push({ code: "trip", label: "Extended-area trip fee", amountCents: input.tripFeeCents });
  }

  const adjustmentTotal = adjustments.reduce((sum, a) => sum + a.amountCents, 0);
  const hasVolume = volume > EPS;
  let lowCents = hasVolume ? Math.max(cfg.minimumChargeCents, low.cents + adjustmentTotal) : 0;
  let highCents = hasVolume ? Math.max(cfg.minimumChargeCents, high.cents + adjustmentTotal) : 0;
  lowCents = roundDown(lowCents, cfg.roundToCents);
  highCents = Math.max(lowCents, roundUp(highCents, cfg.roundToCents));

  const volumeTrips = Math.max(hasVolume ? 1 : 0, Math.ceil(point.billedFraction - EPS));
  const weightTrips = Math.ceil(totals.weightLbs / cfg.maxPayloadLbsPerTruck - EPS);
  const trucksNeeded = Math.max(volumeTrips, weightTrips);
  if (weightTrips > volumeTrips) {
    warnings.push(
      `At roughly ${Math.round(totals.weightLbs).toLocaleString("en-US")} lb this load is over one truck's payload and may need ${weightTrips} trips.`,
    );
  }
  const denseLoad = totals.denseLbs > 0 && totals.denseLbs >= totals.weightLbs * 0.5;
  if (denseLoad) warnings.push("Heavy materials are priced partly by weight; your crew confirms it on site before starting.");
  if (totals.unknownIds.length) warnings.push(`Ignored unknown items: ${totals.unknownIds.join(", ")}`);

  if (totals.weightLbs > 150 * 6) totals.handling.add("heavy_lifting");

  return {
    volumeYd3: round2(volume),
    volumeLowYd3: round2(volumeLow),
    volumeHighYd3: round2(volumeHigh),
    weightLbs: Math.round(totals.weightLbs),
    truckFraction: round3(volume / cfg.truckCapacityYd3),
    billedFraction: point.billedFraction,
    truckLabel: truckLabel(point.billedFraction),
    trucksNeeded,
    lowCents,
    highCents,
    volumeLowCents: low.cents,
    volumeHighCents: high.cents,
    adjustments,
    handling: [...totals.handling].sort(),
    denseLoad,
    estimatedMinutes: estimateMinutes(point.billedFraction, totals.weightLbs, input),
    warnings,
  };
}

/** Two-person crew on-site time, rounded up to 15 minutes. Used to size calendar events. */
export function estimateMinutes(billedFraction: number, weightLbs: number, input: QuoteInput): number {
  if (billedFraction <= EPS) return 0;
  let minutes = 20 + 140 * billedFraction;
  minutes += (weightLbs / 1000) * 10;
  if (!input.access.curbside) {
    minutes += 10 * input.access.stairsFlights;
    if (input.access.basement) minutes += 15;
    if (input.access.longCarry) minutes += 15;
  }
  return Math.ceil(minutes / 15) * 15;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Deposit for a quote, from the tenant's deposit policy. */
export function depositFor(
  highCents: Cents,
  deposit: { enabled: boolean; mode: "fixed" | "percent"; fixedCents: Cents; percent: number; minCents: Cents; maxCents: Cents },
): Cents {
  if (!deposit.enabled || highCents <= 0) return 0;
  const raw = deposit.mode === "fixed" ? deposit.fixedCents : Math.round((highCents * deposit.percent) / 100);
  const bounded = Math.min(deposit.maxCents, Math.max(deposit.minCents, raw));
  // A deposit can never exceed the most the job could cost.
  return Math.min(bounded, highCents);
}
