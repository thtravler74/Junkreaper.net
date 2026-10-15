import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { paymentsLive } from "./payments/stripe";
import { getStore } from "./store";
import type { PublicTenantConfig, Tenant } from "./types";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function apiError(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "Request body must be JSON.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    return { ok: false, response: apiError(422, "invalid_request", `${where}${first?.message ?? "invalid input"}`) };
  }
  return { ok: true, data: parsed.data };
}

export async function tenantOr404(slug: string): Promise<{ tenant: Tenant } | { response: NextResponse }> {
  const tenant = await getStore().getTenantBySlug(slug);
  return tenant ? { tenant } : { response: apiError(404, "tenant_not_found", "Unknown business.") };
}

export function publicConfig(tenant: Tenant): PublicTenantConfig {
  const { enabled, mode, fixedCents, percent, minCents, maxCents, refundableUntilHours } = tenant.deposit;
  return {
    slug: tenant.slug,
    name: tenant.name,
    phone: tenant.phone,
    brandColor: tenant.brandColor,
    logoUrl: tenant.logoUrl,
    pricing: tenant.pricing,
    deposit: { enabled, mode, fixedCents, percent, minCents, maxCents, refundableUntilHours },
    paymentsLive: paymentsLive(tenant),
  };
}
