import { timingSafeEqual } from "node:crypto";
import { bookingsToIcs } from "@/lib/integrations/ical";
import { apiError, tenantOr404 } from "@/lib/http";
import { getStore } from "@/lib/store";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const found = await tenantOr404((await params).slug);
  if ("response" in found) return found.response;
  const { tenant } = found;

  const given = Buffer.from(new URL(request.url).searchParams.get("token") ?? "");
  const expected = Buffer.from(tenant.integrations.icalToken);
  if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return apiError(404, "not_found", "Not found.");
  }

  const now = Date.now();
  const bookings = await getStore().listBookings(
    tenant.id,
    new Date(now - 30 * 86_400_000).toISOString(),
    new Date(now + 90 * 86_400_000).toISOString(),
  );
  return new Response(bookingsToIcs(tenant, bookings, process.env.APP_URL ?? ""), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300" },
  });
}
