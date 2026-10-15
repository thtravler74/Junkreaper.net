import { randomBytes, randomUUID } from "node:crypto";
import type { DepositConfig, PricingConfig, SchedulingConfig, ServiceAreaConfig, Tenant } from "../types";

/**
 * Sensible starting values for a new hauler. These sit near the middle of the
 * US residential market (a 15 yd³ box truck, a full load around $650) and are
 * meant to be edited per tenant, not relied on as market data.
 */
export const DEFAULT_PRICING: PricingConfig = {
  currency: "usd",
  truckCapacityYd3: 15,
  tiers: [
    { fraction: 1 / 8, priceCents: 149_00 },
    { fraction: 1 / 4, priceCents: 249_00 },
    { fraction: 3 / 8, priceCents: 329_00 },
    { fraction: 1 / 2, priceCents: 399_00 },
    { fraction: 5 / 8, priceCents: 469_00 },
    { fraction: 3 / 4, priceCents: 529_00 },
    { fraction: 7 / 8, priceCents: 589_00 },
    { fraction: 1, priceCents: 649_00 },
  ],
  billingIncrement: 1 / 8,
  minimumChargeCents: 119_00,
  includedLbsPerTruck: 3000,
  overweightCentsPerTon: 120_00,
  maxPayloadLbsPerTruck: 6000,
  itemSurcharges: {
    mattress_recycling: 30_00,
    freon_recovery: 50_00,
    e_waste: 25_00,
    crt_e_waste: 40_00,
    tire: 15_00,
    tire_on_rim: 25_00,
    hot_tub_demo: 150_00,
    piano: 100_00,
    heavy_item: 75_00,
  },
  access: {
    stairsPerFlightCents: 25_00,
    basementCents: 35_00,
    longCarryCents: 30_00,
    curbsideDiscountPct: 15,
  },
  spread: {
    inventory: { lowPct: 5, highPct: 20 },
    photos: { basePct: 15, maxPct: 40 },
  },
  roundToCents: 5_00,
};

export const DEFAULT_SERVICE_AREA: ServiceAreaConfig = {
  baseZip: "43215",
  baseLat: 39.9612,
  baseLng: -82.9988,
  radiusMiles: 30,
  extendedMiles: 15,
  extendedTripFeeCents: 35_00,
  includeZips: [],
  excludeZips: [],
};

export const DEFAULT_SCHEDULING: SchedulingConfig = {
  timezone: "America/New_York",
  workDays: [1, 2, 3, 4, 5, 6],
  windows: [
    { start: "08:00", end: "10:00" },
    { start: "10:00", end: "12:00" },
    { start: "12:00", end: "14:00" },
    { start: "14:00", end: "16:00" },
  ],
  crewsPerWindow: 2,
  leadTimeHours: 12,
  horizonDays: 14,
  blackoutDates: [],
};

export const DEFAULT_DEPOSIT: DepositConfig = {
  enabled: true,
  mode: "fixed",
  fixedCents: 50_00,
  percent: 20,
  minCents: 25_00,
  maxCents: 150_00,
  refundableUntilHours: 24,
};

export function newTenant(fields: Pick<Tenant, "slug" | "name" | "phone" | "email"> & Partial<Tenant>): Tenant {
  return {
    id: randomUUID(),
    brandColor: "#16a34a",
    allowedOrigins: [],
    ownerEmails: [fields.email],
    pricing: structuredClone(DEFAULT_PRICING),
    serviceArea: structuredClone(DEFAULT_SERVICE_AREA),
    scheduling: structuredClone(DEFAULT_SCHEDULING),
    deposit: structuredClone(DEFAULT_DEPOSIT),
    integrations: { icalToken: randomBytes(24).toString("base64url"), webhooks: [] },
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

/** Seeded into the local file store so the widget works out of the box. */
export function demoTenant(): Tenant {
  return newTenant({
    slug: "demo",
    name: "Junk Reaper Hauling",
    phone: "(614) 555-0142",
    email: "owner@junkreaper.example",
    brandColor: "#16a34a",
  });
}
