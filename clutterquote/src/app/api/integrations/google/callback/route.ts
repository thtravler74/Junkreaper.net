import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkOwner } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { exchangeCode } from "@/lib/integrations/googleCalendar";
import { NONCE_COOKIE, readState } from "@/lib/oauthState";
import { getStore } from "@/lib/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const slug = readState(url.searchParams.get("state") ?? "", jar.get(NONCE_COOKIE)?.value);
  if (!slug) return apiError(400, "invalid_state", "This link has expired. Start the Google connection again.");

  const store = getStore();
  const tenant = await store.getTenantBySlug(slug);
  if (!tenant) return apiError(404, "tenant_not_found", "Unknown business.");
  const owner = await checkOwner(tenant);
  if (!owner.ok) return apiError(403, owner.reason, "Owner access required.");

  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${process.env.APP_URL}/dashboard/${slug}?google=denied`, 303);

  const refreshToken = await exchangeCode(code);
  await store.updateTenant(tenant.id, {
    integrations: {
      ...tenant.integrations,
      googleCalendar: { calendarId: "primary", refreshToken, blockOnBusy: tenant.integrations.googleCalendar?.blockOnBusy ?? true },
    },
  });
  const response = NextResponse.redirect(`${process.env.APP_URL}/dashboard/${slug}?google=connected`, 303);
  response.cookies.delete({ name: NONCE_COOKIE, path: "/api/integrations/google" });
  return response;
}
