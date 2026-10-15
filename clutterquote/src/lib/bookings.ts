import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { listSlots } from "./availability";
import { busyIntervals, createCalendarEvent } from "./integrations/googleCalendar";
import { dispatchWebhook } from "./integrations/webhooks";
import { HOLD_TTL_MS, createDepositCheckout, getStripe, paymentsLive, platformFeeFor } from "./payments/stripe";
import { depositFor } from "./pricing/engine";
import { getStore } from "./store";
import type { BookingRecord, Customer, QuoteRecord, Tenant } from "./types";

export type CreateBookingResult =
  | { kind: "checkout"; booking: BookingRecord; checkoutUrl: string }
  | { kind: "confirmed"; booking: BookingRecord }
  | { kind: "error"; status: number; code: string; message: string };

/** Offered slots for a tenant right now, merged with Google busy time if linked. */
export async function availableSlots(tenant: Tenant, now: Date) {
  const horizonEnd = new Date(now.getTime() + (tenant.scheduling.horizonDays + 2) * 86_400_000);
  const [bookings, busy] = await Promise.all([
    getStore().listBookings(tenant.id, new Date(now.getTime() - 86_400_000).toISOString(), horizonEnd.toISOString()),
    busyIntervals(tenant, now, horizonEnd).catch((err) => {
      // Calendar trouble must not take booking down; capacity still applies.
      console.warn(`[calendar] freeBusy failed for ${tenant.slug}:`, (err as Error).message);
      return [];
    }),
  ]);
  return listSlots(tenant.scheduling, bookings, now, busy);
}

export async function createBooking(params: {
  tenant: Tenant;
  quote: QuoteRecord;
  slotKey: string;
  customer: Customer;
  now: Date;
}): Promise<CreateBookingResult> {
  const { tenant, quote, slotKey, customer, now } = params;
  const store = getStore();

  if (quote.tenantId !== tenant.id) return { kind: "error", status: 404, code: "quote_not_found", message: "Quote not found." };
  if (new Date(quote.expiresAt) < now) {
    return { kind: "error", status: 410, code: "quote_expired", message: "This estimate has expired. Please get a fresh quote." };
  }

  const slot = (await availableSlots(tenant, now)).find((s) => s.key === slotKey);
  if (!slot) return slotTaken();

  const live = paymentsLive(tenant);
  const depositCents = live ? depositFor(quote.result.highCents, tenant.deposit) : 0;
  const booking: BookingRecord = {
    id: randomUUID(),
    tenantId: tenant.id,
    quoteId: quote.id,
    status: depositCents > 0 ? "pending_payment" : "confirmed",
    slotKey,
    windowStart: slot.startUtc,
    windowEnd: slot.endUtc,
    customer,
    depositCents,
    platformFeeCents: platformFeeFor(depositCents),
    createdAt: now.toISOString(),
  };

  if (depositCents === 0) {
    booking.confirmedAt = now.toISOString();
    if (!(await store.createBookingIfAvailable(booking, tenant.scheduling.crewsPerWindow, now))) return slotTaken();
    scheduleConfirmationSideEffects(tenant, booking, quote);
    return { kind: "confirmed", booking };
  }

  // Create the Checkout Session first so the booking row carries its id from the
  // start; if the slot fills meanwhile, expire the session so it can't be paid.
  const session = await createDepositCheckout(tenant, booking, quote, now);
  booking.checkoutSessionId = session.id;
  booking.holdExpiresAt = new Date(now.getTime() + HOLD_TTL_MS).toISOString();
  if (!(await store.createBookingIfAvailable(booking, tenant.scheduling.crewsPerWindow, now))) {
    await getStripe()?.checkout.sessions.expire(session.id).catch(() => undefined);
    return slotTaken();
  }
  if (!session.url) throw new Error("Stripe returned a session without a URL");
  return { kind: "checkout", booking, checkoutUrl: session.url };
}

function slotTaken(): CreateBookingResult {
  return { kind: "error", status: 409, code: "slot_unavailable", message: "That arrival window was just taken. Please pick another." };
}

/**
 * Move a pending booking to confirmed once its deposit is paid. Safe to call from
 * both the Stripe webhook and the success page: the compare-and-set means exactly
 * one caller wins and runs the side effects.
 */
export async function confirmPaidBooking(bookingId: string, paymentIntentId: string | undefined, now: Date): Promise<BookingRecord | null> {
  const store = getStore();
  const confirmed = await store.transitionBooking(bookingId, "pending_payment", {
    status: "confirmed",
    confirmedAt: now.toISOString(),
    paymentIntentId,
  });
  if (!confirmed) return store.getBooking(bookingId);
  const [tenant, quote] = await Promise.all([store.getTenantById(confirmed.tenantId), store.getQuote(confirmed.quoteId)]);
  if (tenant && quote) scheduleConfirmationSideEffects(tenant, confirmed, quote);
  return confirmed;
}

export async function expireBooking(bookingId: string): Promise<void> {
  await getStore().transitionBooking(bookingId, "pending_payment", { status: "expired" });
}

/**
 * Calendar event + CRM webhooks, run after the response is sent (`after`) so a
 * slow calendar or CRM never holds up the customer or Stripe's webhook delivery.
 * Failures are logged, never surfaced to the customer.
 */
function scheduleConfirmationSideEffects(tenant: Tenant, booking: BookingRecord, quote: QuoteRecord): void {
  after(async () => {
    try {
      const eventId = await createCalendarEvent(tenant, booking, quote);
      if (eventId) await getStore().updateBooking(booking.id, { calendarEventId: eventId });
    } catch (err) {
      console.warn(`[calendar] event insert failed for booking ${booking.id}:`, (err as Error).message);
    }
    await dispatchWebhook(tenant, "booking.confirmed", bookingPayload(booking, quote));
  });
}

/** The shape CRMs receive. Flat and explicit so Zapier field mapping is easy. */
export function bookingPayload(booking: BookingRecord, quote: QuoteRecord) {
  const r = quote.result;
  return {
    bookingId: booking.id,
    status: booking.status,
    windowStart: booking.windowStart,
    windowEnd: booking.windowEnd,
    customerName: booking.customer.name,
    customerEmail: booking.customer.email,
    customerPhone: booking.customer.phone,
    serviceAddress: booking.customer.address,
    zip: quote.zip,
    notes: booking.customer.notes ?? "",
    estimateLow: r.lowCents / 100,
    estimateHigh: r.highCents / 100,
    truckLoad: r.truckLabel,
    volumeCubicYards: r.volumeYd3,
    weightLbs: r.weightLbs,
    estimatedMinutes: r.estimatedMinutes,
    depositPaid: booking.depositCents / 100,
    adjustments: r.adjustments.map((a) => ({ label: a.label, amount: a.amountCents / 100 })),
    handling: r.handling,
    quoteId: quote.id,
  };
}
