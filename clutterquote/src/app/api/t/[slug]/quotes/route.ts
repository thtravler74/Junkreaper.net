import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { dispatchWebhook } from "@/lib/integrations/webhooks";
import { apiError, json, parseBody, tenantOr404 } from "@/lib/http";
import { paymentsLive } from "@/lib/payments/stripe";
import { computeQuote, depositFor } from "@/lib/pricing/engine";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { quoteRequest } from "@/lib/schemas";
import { checkServiceArea, zippopotamGeocoder } from "@/lib/serviceArea";
import { getStore } from "@/lib/store";
import type { QuoteInput, QuoteRecord } from "@/lib/types";

const QUOTE_TTL_MS = 7 * 86_400_000;

/**
 * Issues the authoritative, stored quote that a booking is tied to. The widget
 * shows live prices computed client-side; this recomputes from scratch on the
 * server so a tampered client can't book at a made-up price.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const found = await tenantOr404((await params).slug);
  if ("response" in found) return found.response;
  const { tenant } = found;

  const limit = rateLimit(`quote:${tenant.id}:${clientIp(request)}`, 60, 3_600_000);
  if (!limit.ok) return apiError(429, "rate_limited", "Too many requests.", { "retry-after": String(limit.retryAfterSec) });

  const body = await parseBody(request, quoteRequest);
  if (!body.ok) return body.response;
  const req = body.data;
  const store = getStore();

  const area = await checkServiceArea(req.zip, tenant.serviceArea, zippopotamGeocoder);
  if (area.status === "out_of_area") {
    return apiError(422, "out_of_area", `Sorry, ${req.zip} is outside our service area. Call ${tenant.phone} and we'll see what we can do.`);
  }

  let input: QuoteInput;
  if (req.method === "photos") {
    const analysis = await store.getAnalysis(req.analysisId!);
    if (!analysis || analysis.tenantId !== tenant.id) return apiError(404, "analysis_not_found", "Photo analysis not found.");
    input = {
      method: "photos",
      // The customer may correct what the model saw; otherwise use the detection as-is.
      lines: req.lines.length ? req.lines : analysis.lines,
      looseYd3: analysis.looseYd3,
      looseLbs: analysis.looseLbs,
      photoUncertainty: analysis.uncertainty,
      access: req.access,
      tripFeeCents: area.tripFeeCents,
    };
  } else {
    input = { method: "inventory", lines: req.lines, looseYd3: 0, access: req.access, tripFeeCents: area.tripFeeCents };
  }

  const result = computeQuote(input, tenant.pricing);
  if (result.volumeYd3 <= 0) return apiError(422, "empty_load", "Add at least one item to get a price.");

  const now = new Date();
  const quote: QuoteRecord = {
    id: randomUUID(),
    tenantId: tenant.id,
    zip: req.zip,
    input,
    result,
    analysisId: req.method === "photos" ? req.analysisId : undefined,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
  };
  await store.saveQuote(quote);

  after(() =>
    dispatchWebhook(tenant, "quote.created", {
      quoteId: quote.id,
      zip: quote.zip,
      method: input.method,
      estimateLow: result.lowCents / 100,
      estimateHigh: result.highCents / 100,
      truckLoad: result.truckLabel,
      volumeCubicYards: result.volumeYd3,
    }),
  );

  return json({
    quoteId: quote.id,
    expiresAt: quote.expiresAt,
    result,
    serviceArea: area,
    depositCents: paymentsLive(tenant) ? depositFor(result.highCents, tenant.deposit) : 0,
  });
}
