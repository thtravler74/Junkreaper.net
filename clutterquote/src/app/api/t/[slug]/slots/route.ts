import { availableSlots } from "@/lib/bookings";
import { json, tenantOr404 } from "@/lib/http";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const found = await tenantOr404((await params).slug);
  if ("response" in found) return found.response;
  const slots = await availableSlots(found.tenant, new Date());
  return json({ timezone: found.tenant.scheduling.timezone, slots }, { headers: { "cache-control": "no-store" } });
}
