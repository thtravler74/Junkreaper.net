import "server-only";
import type { BusyInterval } from "../availability";
import type { BookingRecord, QuoteRecord, Tenant } from "../types";

/**
 * Google Calendar over plain REST: OAuth web-server flow with offline access, so
 * each tenant stores one refresh token. Only the two calls the product needs:
 * freeBusy (to block windows) and events.insert (to drop confirmed jobs on the
 * dispatch calendar).
 */
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"];

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(): string {
  return `${process.env.APP_URL}/api/integrations/google/callback`;
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Forces a refresh token even if the user granted access before.
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = (await response.json()) as { refresh_token?: string; error?: string };
  if (!response.ok || !data.refresh_token) throw new Error(`Google token exchange failed: ${data.error ?? response.status}`);
  return data.refresh_token;
}

async function accessToken(refreshToken: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(5000),
  });
  const data = (await response.json()) as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error(`Google token refresh failed: ${data.error ?? response.status}`);
  return data.access_token;
}

/** Busy blocks on the tenant's calendar; [] when not linked or blockOnBusy is off. */
export async function busyIntervals(tenant: Tenant, from: Date, to: Date): Promise<BusyInterval[]> {
  const gc = tenant.integrations.googleCalendar;
  if (!gc?.blockOnBusy || !googleConfigured()) return [];
  const token = await accessToken(gc.refreshToken);
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: gc.calendarId }] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`freeBusy ${response.status}`);
  const data = (await response.json()) as { calendars: Record<string, { busy: { start: string; end: string }[] }> };
  return (data.calendars[gc.calendarId]?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export async function createCalendarEvent(tenant: Tenant, booking: BookingRecord, quote: QuoteRecord): Promise<string | null> {
  const gc = tenant.integrations.googleCalendar;
  if (!gc || !googleConfigured()) return null;
  const token = await accessToken(gc.refreshToken);
  const r = quote.result;
  const description = [
    `Customer: ${booking.customer.name} · ${booking.customer.phone} · ${booking.customer.email}`,
    `Estimate: $${r.lowCents / 100}–$${r.highCents / 100} (${r.truckLabel}, ~${r.volumeYd3} yd³, ~${r.weightLbs} lb)`,
    `Deposit paid: $${booking.depositCents / 100}`,
    `Estimated on-site time: ${r.estimatedMinutes} min`,
    r.handling.length ? `Handling: ${r.handling.join(", ")}` : "",
    booking.customer.notes ? `Notes: ${booking.customer.notes}` : "",
    `Dashboard: ${process.env.APP_URL}/dashboard/${tenant.slug}#${booking.id}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(gc.calendarId)}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: `Junk pickup – ${booking.customer.name} (${r.truckLabel})`,
      location: booking.customer.address,
      description,
      start: { dateTime: booking.windowStart },
      end: { dateTime: booking.windowEnd },
      // Lets a retried confirmation reuse the same event instead of duplicating it.
      id: `cq${booking.id.replace(/-/g, "")}`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 409) return `cq${booking.id.replace(/-/g, "")}`;
  if (!response.ok) throw new Error(`events.insert ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}
