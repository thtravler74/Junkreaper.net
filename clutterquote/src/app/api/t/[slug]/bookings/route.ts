import { createBooking } from "@/lib/bookings";
import { apiError, json, parseBody, tenantOr404 } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { bookingRequest } from "@/lib/schemas";
import { getStore } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const found = await tenantOr404((await params).slug);
  if ("response" in found) return found.response;
  const { tenant } = found;

  // Holds tie up real capacity; stop one client from squatting every window.
  const limit = rateLimit(`book:${tenant.id}:${clientIp(request)}`, 8, 3_600_000);
  if (!limit.ok) return apiError(429, "rate_limited", "Too many booking attempts.", { "retry-after": String(limit.retryAfterSec) });

  const body = await parseBody(request, bookingRequest);
  if (!body.ok) return body.response;

  const quote = await getStore().getQuote(body.data.quoteId);
  if (!quote) return apiError(404, "quote_not_found", "Quote not found.");

  const result = await createBooking({ tenant, quote, slotKey: body.data.slotKey, customer: body.data.customer, now: new Date() });
  if (result.kind === "error") return apiError(result.status, result.code, result.message);
  return json({
    bookingId: result.booking.id,
    status: result.booking.status,
    depositCents: result.booking.depositCents,
    checkoutUrl: result.kind === "checkout" ? result.checkoutUrl : null,
  });
}
