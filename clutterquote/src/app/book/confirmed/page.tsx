import Link from "next/link";
import { confirmPaidBooking } from "@/lib/bookings";
import { getStripe } from "@/lib/payments/stripe";
import { formatUsd } from "@/lib/pricing/engine";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Stripe's success_url lands here (top-level, outside the iframe). The webhook
 * normally confirms first; if it hasn't arrived yet, retrieve the session and
 * confirm from here. confirmPaidBooking is idempotent, so the race is harmless.
 */
export default async function ConfirmedPage({ searchParams }: { searchParams: Promise<{ booking?: string; session_id?: string }> }) {
  const { booking: bookingId, session_id: sessionId } = await searchParams;
  const store = getStore();
  let booking = bookingId && /^[0-9a-f-]{36}$/.test(bookingId) ? await store.getBooking(bookingId) : null;

  if (booking?.status === "pending_payment" && sessionId && sessionId === booking.checkoutSessionId) {
    const session = await getStripe()?.checkout.sessions.retrieve(sessionId).catch(() => null);
    if (session?.payment_status === "paid") {
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      booking = (await confirmPaidBooking(booking.id, pi, new Date())) ?? booking;
    }
  }

  const tenant = booking ? await store.getTenantById(booking.tenantId) : null;
  if (!booking || !tenant) {
    return <Shell title="Booking not found" body="We couldn't find that booking. If you were charged, contact the business directly." />;
  }

  const when = `${new Date(booking.windowStart).toLocaleString("en-US", {
    timeZone: tenant.scheduling.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} – ${new Date(booking.windowEnd).toLocaleTimeString("en-US", { timeZone: tenant.scheduling.timezone, hour: "numeric", minute: "2-digit" })}`;

  if (booking.status === "confirmed") {
    return (
      <Shell
        icon="✅"
        title="You're booked!"
        body={`${tenant.name} will arrive ${when}.${booking.depositCents ? ` Your ${formatUsd(booking.depositCents)} deposit is credited to your final bill.` : ""} A receipt is on its way to ${booking.customer.email}.`}
        phone={tenant.phone}
      />
    );
  }
  if (booking.status === "pending_payment") {
    return <Shell icon="⏳" title="Finishing up…" body="Your payment is processing. This page will show your confirmation in a moment." refresh phone={tenant.phone} />;
  }
  return <Shell icon="⚠️" title="This booking isn't active" body="The payment window lapsed before checkout completed. No charge was made. Please book again." phone={tenant.phone} />;
}

function Shell({ icon, title, body, phone, refresh }: { icon?: string; title: string; body: string; phone?: string; refresh?: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      {refresh && <meta httpEquiv="refresh" content="3" />}
      <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5">
        {icon && <div className="mb-3 text-5xl">{icon}</div>}
        <h1 className="mb-2 text-2xl font-extrabold">{title}</h1>
        <p className="text-slate-600">{body}</p>
        {phone && (
          <p className="mt-4 text-sm text-slate-500">
            Questions? Call <a className="font-semibold underline" href={`tel:${phone}`}>{phone}</a>
          </p>
        )}
        <Link href="/" className="sr-only">Home</Link>
      </div>
    </main>
  );
}
