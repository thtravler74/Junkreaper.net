import "server-only";
import Stripe from "stripe";
import type { BookingRecord, QuoteRecord, Tenant } from "../types";

let client: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (client === undefined) client = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  return client;
}

/** Deposits can be taken only when the platform has Stripe and the hauler finished Connect onboarding. */
export function paymentsLive(tenant: Tenant): boolean {
  return Boolean(getStripe() && tenant.integrations.stripeAccountId && tenant.integrations.stripeChargesEnabled);
}

/** Platform's cut of each deposit, in basis points (300 = 3%). */
export function platformFeeFor(depositCents: number): number {
  const bps = Number(process.env.PLATFORM_FEE_BPS ?? 0);
  return Number.isFinite(bps) && bps > 0 ? Math.round((depositCents * bps) / 10_000) : 0;
}

/** Checkout's minimum expiry is 30 minutes; the slot hold outlives it slightly. */
export const CHECKOUT_TTL_MS = 31 * 60_000;
export const HOLD_TTL_MS = 35 * 60_000;

/**
 * Deposit via a Connect destination charge: the customer pays the platform
 * account, funds transfer to the hauler's connected account, and the platform
 * keeps application_fee_amount. on_behalf_of makes the hauler the merchant of
 * record, so their business name shows on the statement and the receipt.
 */
export async function createDepositCheckout(
  tenant: Tenant,
  booking: Pick<BookingRecord, "id" | "depositCents" | "platformFeeCents" | "customer" | "slotKey">,
  quote: QuoteRecord,
  now: Date,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  const destination = tenant.integrations.stripeAccountId;
  if (!stripe || !destination) throw new Error("Stripe is not configured for this tenant");
  const appUrl = process.env.APP_URL!;
  const r = quote.result;

  return stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: booking.customer.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: booking.depositCents,
            product_data: {
              name: `Booking deposit: ${tenant.name}`,
              description: `${r.truckLabel} junk removal, estimate $${r.lowCents / 100}–$${r.highCents / 100}. Credited to your final bill.`,
            },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: booking.platformFeeCents || undefined,
        transfer_data: { destination },
        on_behalf_of: destination,
        metadata: { bookingId: booking.id, tenantId: tenant.id },
      },
      metadata: { bookingId: booking.id, tenantId: tenant.id, quoteId: quote.id },
      client_reference_id: booking.id,
      expires_at: Math.floor((now.getTime() + CHECKOUT_TTL_MS) / 1000),
      success_url: `${appUrl}/book/confirmed?booking=${booking.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/book/cancelled?booking=${booking.id}`,
    },
    // A retried request for the same booking can't create a second session.
    { idempotencyKey: `deposit-${booking.id}` },
  );
}

/** Start or resume Express onboarding for a hauler. Returns the hosted onboarding URL. */
export async function connectOnboardingLink(tenant: Tenant, saveAccountId: (id: string) => Promise<void>): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not set");
  let accountId = tenant.integrations.stripeAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: tenant.email,
      business_profile: { name: tenant.name, mcc: "4214" /* motor freight carriers, trucking */ },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { tenantId: tenant.id },
    });
    accountId = account.id;
    await saveAccountId(accountId);
  }
  const appUrl = process.env.APP_URL!;
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${appUrl}/api/stripe/connect?tenant=${tenant.slug}`,
    return_url: `${appUrl}/dashboard/${tenant.slug}?stripe=return`,
  });
  return link.url;
}
