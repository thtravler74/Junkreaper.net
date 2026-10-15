import { NextResponse } from "next/server";
import { checkOwner } from "@/lib/auth";
import { apiError, tenantOr404 } from "@/lib/http";
import { googleAuthUrl, googleConfigured } from "@/lib/integrations/googleCalendar";
import { NONCE_COOKIE, makeState } from "@/lib/oauthState";

export async function GET(request: Request) {
  if (!googleConfigured()) return apiError(503, "google_not_configured", "Google Calendar is not configured on this server.");
  const found = await tenantOr404(new URL(request.url).searchParams.get("tenant") ?? "");
  if ("response" in found) return found.response;
  const owner = await checkOwner(found.tenant);
  if (!owner.ok) return apiError(owner.reason === "signed_out" ? 401 : 403, owner.reason, "Owner access required.");

  const { state, nonce } = makeState(found.tenant.slug);
  const response = NextResponse.redirect(googleAuthUrl(state), 303);
  response.cookies.set(NONCE_COOKIE, nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/integrations/google" });
  return response;
}
