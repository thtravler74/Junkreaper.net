import type Stripe from "stripe";
import { confirmPaidBooking, expireBooking } from "@/lib/bookings";
import { apiError, json } from "@/lib/http";
import { getStripe } from "@/lib/payments/stripe";
import { getStore } from "@/lib/store";

/**
 * Stripe events. Checkout events arrive on the platform endpoint
 * (STRIPE_WEBHOOK_SECRET); account.updated for connected accounts arrives on a
 * Connect endpoint (STRIPE_CONNECT_WEBHOOK_SECRET). Both can point here.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) return apiError(503, "stripe_not_configured", "Stripe is not configured.");

  const signature = request.headers.get("stripe-signature");
  if (!signature) return apiError(400, "missing_signature", "Missing Stripe-Signature header.");
  // Signature verification needs the exact raw bytes.
  const raw = await request.text();

  let event: Stripe.Event | undefined;
  for (const secret of [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET]) {
    if (!secret) continue;
    try {
      event = stripe.webhooks.constructEvent(raw, signature, secret);
      break;
    } catch {
      // try the next secret
    }
  }
  if (!event) return apiError(400, "invalid_signature", "Webhook signature verification failed.");

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (session.payment_status !== "paid") break; // async methods settle later
      const bookingId = session.metadata?.bookingId;
      if (bookingId) await confirmPaidBooking(bookingId, paymentIntentId(session), new Date());
      break;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const bookingId = event.data.object.metadata?.bookingId;
      if (bookingId) await expireBooking(bookingId);
      break;
    }
    case "account.updated": {
      const account = event.data.object;
      const store = getStore();
      const tenant = await store.findTenantByStripeAccount(account.id);
      if (tenant && tenant.integrations.stripeChargesEnabled !== account.charges_enabled) {
        await store.updateTenant(tenant.id, {
          integrations: { ...tenant.integrations, stripeChargesEnabled: account.charges_enabled },
        });
      }
      break;
    }
  }
  return json({ received: true });
}

function paymentIntentId(session: Stripe.Checkout.Session): string | undefined {
  const pi = session.payment_intent;
  return typeof pi === "string" ? pi : pi?.id;
}
