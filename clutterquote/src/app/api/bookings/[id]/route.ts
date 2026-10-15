import { apiError, json } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Status for the confirmation page. Booking ids are random UUIDs; only non-sensitive fields are returned. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return apiError(404, "not_found", "Booking not found.");
  const booking = await getStore().getBooking(id);
  if (!booking) return apiError(404, "not_found", "Booking not found.");
  return json(
    { status: booking.status, windowStart: booking.windowStart, windowEnd: booking.windowEnd, depositCents: booking.depositCents },
    { headers: { "cache-control": "no-store" } },
  );
}
