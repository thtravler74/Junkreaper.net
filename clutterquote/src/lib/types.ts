import type { HandlingFlag, SurchargeKey } from "./catalog";

/** All money is integer cents. */
export type Cents = number;

// ─── Tenant configuration ────────────────────────────────────────────────────

export interface PriceTier {
  /** Fraction of a full truck, 0 < fraction ≤ 1. */
  fraction: number;
  priceCents: Cents;
}

export interface PricingConfig {
  currency: "usd";
  /** Loaded capacity of one truck in cubic yards (15 is the common box-truck size). */
  truckCapacityYd3: number;
  /** Price curve for one truck. Piecewise-linear between tiers; must end at fraction 1. */
  tiers: PriceTier[];
  /** Volume is billed rounded UP to this fraction of a truck (1/8 is the industry norm). */
  billingIncrement: number;
  minimumChargeCents: Cents;
  /** Weight allowance for a FULL truck; scales with the billed fraction. */
  includedLbsPerTruck: number;
  /** Charged per ton (2,000 lb) over the allowance — transfer stations bill by weight. */
  overweightCentsPerTon: Cents;
  /** A truck's legal payload. Estimated weight above this needs more than one trip. */
  maxPayloadLbsPerTruck: number;
  itemSurcharges: Partial<Record<SurchargeKey, Cents>>;
  access: {
    stairsPerFlightCents: Cents;
    basementCents: Cents;
    longCarryCents: Cents;
    /** Percent off the volume charge when everything is already at the curb (0–100). */
    curbsideDiscountPct: number;
  };
  /** How far the low/high ends of the range sit from the point estimate. */
  spread: {
    inventory: { lowPct: number; highPct: number };
    /** Base spread for photos; widened by model uncertainty, capped at maxPct. */
    photos: { basePct: number; maxPct: number };
  };
  /** Round displayed prices to this many cents (500 = nearest $5). */
  roundToCents: Cents;
}

export interface ServiceAreaConfig {
  baseZip: string;
  baseLat: number;
  baseLng: number;
  radiusMiles: number;
  /** Beyond radiusMiles but within this many extra miles: serviced, with a trip fee. */
  extendedMiles: number;
  extendedTripFeeCents: Cents;
  /** Always serviced, regardless of distance. */
  includeZips: string[];
  /** Never serviced, regardless of distance. */
  excludeZips: string[];
}

export interface ArrivalWindow {
  /** Local wall-clock "HH:MM". */
  start: string;
  end: string;
}

export interface SchedulingConfig {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  windows: ArrivalWindow[];
  /** Jobs each window can absorb (≈ number of crews). */
  crewsPerWindow: number;
  leadTimeHours: number;
  horizonDays: number;
  /** Local "YYYY-MM-DD" dates with no service. */
  blackoutDates: string[];
}

export interface DepositConfig {
  enabled: boolean;
  mode: "fixed" | "percent";
  fixedCents: Cents;
  /** Percent of the HIGH end of the estimate. */
  percent: number;
  minCents: Cents;
  maxCents: Cents;
  /** Hours before the arrival window inside which the deposit is non-refundable. */
  refundableUntilHours: number;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  /** HMAC-SHA256 secret used to sign deliveries. */
  secret: string;
  events: WebhookEvent[];
  /** Free-form label, e.g. "Zapier → Workiz". */
  label?: string;
}

export type WebhookEvent = "quote.created" | "booking.confirmed" | "booking.cancelled";

/** Credentials and integration state. Never sent to the browser. */
export interface TenantIntegrations {
  stripeAccountId?: string;
  stripeChargesEnabled?: boolean;
  googleCalendar?: { calendarId: string; refreshToken: string; blockOnBusy: boolean };
  /** Secret token for the read-only iCal feed of bookings. */
  icalToken: string;
  webhooks: WebhookEndpoint[];
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  phone: string;
  email: string;
  brandColor: string;
  logoUrl?: string;
  /** Origins allowed to frame the widget (CSP frame-ancestors). Empty = any https origin. */
  allowedOrigins: string[];
  /** Emails of owners who may open the dashboard. */
  ownerEmails: string[];
  pricing: PricingConfig;
  serviceArea: ServiceAreaConfig;
  scheduling: SchedulingConfig;
  deposit: DepositConfig;
  integrations: TenantIntegrations;
  createdAt: string;
}

/** The subset of a tenant the widget is allowed to see. */
export interface PublicTenantConfig {
  slug: string;
  name: string;
  phone: string;
  brandColor: string;
  logoUrl?: string;
  pricing: PricingConfig;
  deposit: Pick<DepositConfig, "enabled" | "mode" | "fixedCents" | "percent" | "minCents" | "maxCents" | "refundableUntilHours">;
  paymentsLive: boolean;
}

// ─── Quoting ─────────────────────────────────────────────────────────────────

export interface CatalogLine {
  kind: "catalog";
  catalogId: string;
  quantity: number;
}

/** An item the vision model saw that isn't in the catalog. */
export interface CustomLine {
  kind: "custom";
  label: string;
  quantity: number;
  yd3Each: number;
  lbsEach: number;
}

export type QuoteLine = CatalogLine | CustomLine;

export interface AccessDetails {
  stairsFlights: number;
  basement: boolean;
  longCarry: boolean;
  curbside: boolean;
}

export type IntakeMethod = "inventory" | "photos";

export interface QuoteInput {
  method: IntakeMethod;
  lines: QuoteLine[];
  /** Loose material not itemized (piles of bags, clutter), in loaded yd³. */
  looseYd3: number;
  /** Loose material weight; defaults to a mixed-household density when omitted. */
  looseLbs?: number;
  access: AccessDetails;
  /** Photo mode only: 0–1 combined uncertainty from the vision reconciliation. */
  photoUncertainty?: number;
  /** Trip fee from the service-area check, if any. */
  tripFeeCents?: Cents;
}

export interface Adjustment {
  code: string;
  label: string;
  /** Signed: surcharges positive, discounts negative. */
  amountCents: Cents;
}

export interface QuoteResult {
  volumeYd3: number;
  volumeLowYd3: number;
  volumeHighYd3: number;
  weightLbs: number;
  /** Point estimate as a fraction of one truck (can exceed 1). */
  truckFraction: number;
  /** Billed fraction after rounding up to the billing increment. */
  billedFraction: number;
  /** e.g. "1/4 truckload", "1 truck + 3/8". */
  truckLabel: string;
  trucksNeeded: number;
  lowCents: Cents;
  highCents: Cents;
  /** Volume-only component, both ends (before fees). */
  volumeLowCents: Cents;
  volumeHighCents: Cents;
  adjustments: Adjustment[];
  handling: HandlingFlag[];
  denseLoad: boolean;
  /** Estimated on-site time for a two-person crew. */
  estimatedMinutes: number;
  warnings: string[];
}

// ─── Persistence records ─────────────────────────────────────────────────────

export interface PhotoAnalysisRecord {
  id: string;
  tenantId: string;
  provider: "openai" | "mock";
  model: string;
  /** Storage keys of the uploaded photos. */
  photoKeys: string[];
  /** Raw (validated) model output, kept for audit and re-pricing. */
  raw: unknown;
  /** The reconciled, priceable form of the detection. */
  lines: QuoteLine[];
  looseYd3: number;
  looseLbs: number;
  uncertainty: number;
  createdAt: string;
}

export interface QuoteRecord {
  id: string;
  tenantId: string;
  zip: string;
  input: QuoteInput;
  result: QuoteResult;
  analysisId?: string;
  createdAt: string;
  expiresAt: string;
}

export type BookingStatus = "pending_payment" | "confirmed" | "cancelled" | "expired";

export interface Customer {
  name: string;
  email: string;
  phone: string;
  address: string;
  notes?: string;
}

export interface BookingRecord {
  id: string;
  tenantId: string;
  quoteId: string;
  status: BookingStatus;
  /** Local "YYYY-MM-DDTHH:MM" of the window start; capacity is counted per slot key. */
  slotKey: string;
  windowStart: string;
  windowEnd: string;
  customer: Customer;
  depositCents: Cents;
  platformFeeCents: Cents;
  checkoutSessionId?: string;
  paymentIntentId?: string;
  /** Pending bookings hold their slot until this instant. */
  holdExpiresAt?: string;
  calendarEventId?: string;
  createdAt: string;
  confirmedAt?: string;
}
