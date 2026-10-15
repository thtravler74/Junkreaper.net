import { expireBooking } from "@/lib/bookings";
import { getStripe } from "@/lib/payments/stripe";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Customer backed out of Checkout: release the slot hold immediately instead of waiting for expiry. */
export default async function CancelledPage({ searchParams }: { searchParams: Promise<{ booking?: string }> }) {
  const { booking: bookingId } = await searchParams;
  const booking = bookingId && /^[0-9a-f-]{36}$/.test(bookingId) ? await getStore().getBooking(bookingId) : null;
  if (booking?.status === "pending_payment" && booking.checkoutSessionId) {
    const expired = await getStripe()?.checkout.sessions.expire(booking.checkoutSessionId).catch(() => null);
    if (expired) await expireBooking(booking.id);
  }
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5">
        <h1 className="mb-2 text-2xl font-extrabold">Payment cancelled</h1>
        <p className="text-slate-600">No charge was made and your arrival window has been released. Go back to the quote form any time to book again.</p>
      </div>
    </main>
  );
}
