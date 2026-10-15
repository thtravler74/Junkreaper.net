import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BookingRecord, BookingStatus, PhotoAnalysisRecord, QuoteRecord, Tenant, TenantIntegrations } from "../types";
import type { Store } from "./types";

const BUCKET = "quote-photos";

type Row = Record<string, unknown>;

/** Postgres-backed store (see supabase/migrations). Uses the service-role key: server only. */
export class SupabaseStore implements Store {
  private readonly db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  // ─── tenants ───────────────────────────────────────────────────────────────

  private async tenantWhere(column: string, value: string): Promise<Tenant | null> {
    const { data, error } = await this.db
      .from("tenants")
      .select("*, tenant_integrations(data, stripe_account_id)")
      .eq(column, value)
      .maybeSingle();
    if (error) throw error;
    return data ? toTenant(data) : null;
  }

  getTenantBySlug(slug: string) {
    return this.tenantWhere("slug", slug);
  }

  getTenantById(id: string) {
    return this.tenantWhere("id", id);
  }

  async findTenantByStripeAccount(accountId: string) {
    const { data, error } = await this.db
      .from("tenant_integrations")
      .select("tenant_id")
      .eq("stripe_account_id", accountId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.getTenantById(data.tenant_id as string) : null;
  }

  async updateTenant(id: string, patch: Partial<Omit<Tenant, "id">>) {
    const { integrations, ...rest } = patch;
    const row = fromTenant(rest);
    if (Object.keys(row).length) {
      const { error } = await this.db.from("tenants").update(row).eq("id", id);
      if (error) throw error;
    }
    if (integrations) {
      const { error } = await this.db.from("tenant_integrations").upsert({
        tenant_id: id,
        stripe_account_id: integrations.stripeAccountId ?? null,
        data: integrations,
      });
      if (error) throw error;
    }
    const updated = await this.getTenantById(id);
    if (!updated) throw new Error(`tenant ${id} not found`);
    return updated;
  }

  // ─── photos ────────────────────────────────────────────────────────────────

  async savePhoto(key: string, data: Buffer, mime: string) {
    const { error } = await this.db.storage.from(BUCKET).upload(key, data, { contentType: mime, upsert: false });
    if (error) throw error;
  }

  async readPhoto(key: string) {
    const { data, error } = await this.db.storage.from(BUCKET).download(key);
    if (error || !data) return null;
    return { data: Buffer.from(await data.arrayBuffer()), mime: data.type || "image/jpeg" };
  }

  // ─── analyses & quotes ─────────────────────────────────────────────────────

  async saveAnalysis(r: PhotoAnalysisRecord) {
    const { error } = await this.db.from("photo_analyses").insert({
      id: r.id,
      tenant_id: r.tenantId,
      provider: r.provider,
      model: r.model,
      photo_keys: r.photoKeys,
      raw: r.raw,
      lines: r.lines,
      loose_yd3: r.looseYd3,
      loose_lbs: r.looseLbs,
      uncertainty: r.uncertainty,
      created_at: r.createdAt,
    });
    if (error) throw error;
  }

  async getAnalysis(id: string) {
    const { data, error } = await this.db.from("photo_analyses").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      tenantId: data.tenant_id,
      provider: data.provider,
      model: data.model,
      photoKeys: data.photo_keys,
      raw: data.raw,
      lines: data.lines,
      looseYd3: Number(data.loose_yd3),
      looseLbs: Number(data.loose_lbs),
      uncertainty: Number(data.uncertainty),
      createdAt: data.created_at,
    } satisfies PhotoAnalysisRecord;
  }

  async saveQuote(r: QuoteRecord) {
    const { error } = await this.db.from("quotes").insert({
      id: r.id,
      tenant_id: r.tenantId,
      analysis_id: r.analysisId ?? null,
      zip: r.zip,
      input: r.input,
      result: r.result,
      created_at: r.createdAt,
      expires_at: r.expiresAt,
    });
    if (error) throw error;
  }

  async getQuote(id: string) {
    const { data, error } = await this.db.from("quotes").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toQuote(data) : null;
  }

  async listQuotes(tenantId: string, limit: number) {
    const { data, error } = await this.db
      .from("quotes")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(toQuote);
  }

  // ─── bookings ──────────────────────────────────────────────────────────────

  async createBookingIfAvailable(b: BookingRecord, capacity: number) {
    // The RPC evaluates hold expiry against the database clock, the single source
    // of truth across serverless instances.
    const { data, error } = await this.db.rpc("create_booking_if_available", {
      p_booking: fromBooking(b),
      p_capacity: capacity,
    });
    if (error) throw error;
    return data === true;
  }

  async getBooking(id: string) {
    const { data, error } = await this.db.from("bookings").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toBooking(data) : null;
  }

  async getBookingByCheckoutSession(sessionId: string) {
    const { data, error } = await this.db.from("bookings").select("*").eq("checkout_session_id", sessionId).maybeSingle();
    if (error) throw error;
    return data ? toBooking(data) : null;
  }

  async updateBooking(id: string, patch: Partial<BookingRecord>) {
    const row = fromBooking(patch);
    delete row.id;
    const { data, error } = await this.db.from("bookings").update(row).eq("id", id).select("*").single();
    if (error) throw error;
    return toBooking(data);
  }

  async transitionBooking(id: string, from: BookingStatus, patch: Partial<BookingRecord>) {
    const row = fromBooking(patch);
    delete row.id;
    const { data, error } = await this.db.from("bookings").update(row).eq("id", id).eq("status", from).select("*");
    if (error) throw error;
    return data?.[0] ? toBooking(data[0]) : null;
  }

  async listBookings(tenantId: string, fromIso: string, toIso: string) {
    const { data, error } = await this.db
      .from("bookings")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("window_start", fromIso)
      .lt("window_start", toIso)
      .order("window_start");
    if (error) throw error;
    return (data ?? []).map(toBooking);
  }
}

// ─── row mapping ─────────────────────────────────────────────────────────────

function toTenant(row: Row): Tenant {
  const joined = row.tenant_integrations as { data: TenantIntegrations } | { data: TenantIntegrations }[] | null;
  const integ = Array.isArray(joined) ? joined[0] : joined;
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    phone: row.phone as string,
    email: row.email as string,
    brandColor: row.brand_color as string,
    logoUrl: (row.logo_url as string | null) ?? undefined,
    allowedOrigins: row.allowed_origins as string[],
    ownerEmails: row.owner_emails as string[],
    pricing: row.pricing as Tenant["pricing"],
    serviceArea: row.service_area as Tenant["serviceArea"],
    scheduling: row.scheduling as Tenant["scheduling"],
    deposit: row.deposit as Tenant["deposit"],
    integrations: integ?.data ?? { icalToken: "", webhooks: [] },
    createdAt: row.created_at as string,
  };
}

function fromTenant(t: Partial<Omit<Tenant, "id" | "integrations">>): Row {
  const map: Record<string, string> = {
    slug: "slug",
    name: "name",
    phone: "phone",
    email: "email",
    brandColor: "brand_color",
    logoUrl: "logo_url",
    allowedOrigins: "allowed_origins",
    ownerEmails: "owner_emails",
    pricing: "pricing",
    serviceArea: "service_area",
    scheduling: "scheduling",
    deposit: "deposit",
  };
  const row: Row = {};
  for (const [key, value] of Object.entries(t)) if (map[key] && value !== undefined) row[map[key]] = value;
  return row;
}

function toQuote(row: Row): QuoteRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    analysisId: (row.analysis_id as string | null) ?? undefined,
    zip: row.zip as string,
    input: row.input as QuoteRecord["input"],
    result: row.result as QuoteRecord["result"],
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
  };
}

const BOOKING_COLUMNS: Record<keyof BookingRecord, string> = {
  id: "id",
  tenantId: "tenant_id",
  quoteId: "quote_id",
  status: "status",
  slotKey: "slot_key",
  windowStart: "window_start",
  windowEnd: "window_end",
  customer: "customer",
  depositCents: "deposit_cents",
  platformFeeCents: "platform_fee_cents",
  checkoutSessionId: "checkout_session_id",
  paymentIntentId: "payment_intent_id",
  holdExpiresAt: "hold_expires_at",
  calendarEventId: "calendar_event_id",
  createdAt: "created_at",
  confirmedAt: "confirmed_at",
};

function fromBooking(b: Partial<BookingRecord>): Row {
  const row: Row = {};
  for (const [key, column] of Object.entries(BOOKING_COLUMNS)) {
    const value = b[key as keyof BookingRecord];
    if (value !== undefined) row[column] = value;
  }
  return row;
}

function toBooking(row: Row): BookingRecord {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(BOOKING_COLUMNS)) {
    const value = row[column];
    if (value !== null && value !== undefined) out[key] = value;
  }
  // Normalize timestamptz output (Postgres returns "+00:00") to ISO "Z" form.
  for (const key of ["windowStart", "windowEnd", "holdExpiresAt", "createdAt", "confirmedAt"]) {
    if (typeof out[key] === "string") out[key] = new Date(out[key] as string).toISOString();
  }
  return out as unknown as BookingRecord;
}
