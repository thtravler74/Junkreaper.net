import { NextResponse } from "next/server";
import { checkOwner } from "@/lib/auth";
import { apiError, tenantOr404 } from "@/lib/http";
import { connectOnboardingLink } from "@/lib/payments/stripe";
import { getStore } from "@/lib/store";

/** Owner-only: start or resume Stripe Express onboarding, then refresh charges_enabled on return. */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("tenant") ?? "";
  const found = await tenantOr404(slug);
  if ("response" in found) return found.response;
  const { tenant } = found;
  const owner = await checkOwner(tenant);
  if (!owner.ok) return apiError(owner.reason === "signed_out" ? 401 : 403, owner.reason, "Owner access required.");

  try {
    const url = await connectOnboardingLink(tenant, async (accountId) => {
      await getStore().updateTenant(tenant.id, {
        integrations: { ...tenant.integrations, stripeAccountId: accountId, stripeChargesEnabled: false },
      });
    });
    return NextResponse.redirect(url, 303);
  } catch (err) {
    return apiError(503, "stripe_unavailable", (err as Error).message);
  }
}
