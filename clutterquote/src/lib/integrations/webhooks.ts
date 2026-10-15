import { createHmac, timingSafeEqual } from "node:crypto";
import type { Tenant, WebhookEvent } from "../types";

/**
 * Outbound webhooks, signed the way Stripe signs its own:
 *
 *   X-ClutterQuote-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * Receivers verify the HMAC and reject stale timestamps (replay protection). This
 * is the integration point for Workiz, Housecall Pro and Jobber, usually through
 * Zapier or Make, since none of them ingests arbitrary webhooks natively.
 */
export const SIGNATURE_HEADER = "x-clutterquote-signature";

export function signPayload(secret: string, body: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

/** Reference verifier for receivers (also used in tests). */
export function verifySignature(secret: string, body: string, header: string, now: number, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceSec || !parts.v1) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface DeliveryResult {
  endpointId: string;
  ok: boolean;
  status?: number;
  attempts: number;
  error?: string;
}

/**
 * Deliver an event to every endpoint subscribed to it. Retries network errors and
 * 5xx/429 with backoff (0.5s, 2s); 4xx is final. Run it after the response has been
 * sent (next/server `after`) so a slow CRM never blocks a customer.
 */
export async function dispatchWebhook(
  tenant: Tenant,
  event: WebhookEvent,
  data: unknown,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<DeliveryResult[]> {
  const endpoints = tenant.integrations.webhooks.filter((w) => w.events.includes(event));
  const body = JSON.stringify({ event, tenant: tenant.slug, createdAt: new Date().toISOString(), data });

  return Promise.all(
    endpoints.map(async (endpoint): Promise<DeliveryResult> => {
      const delays = [500, 2000];
      let last: DeliveryResult = { endpointId: endpoint.id, ok: false, attempts: 0 };
      for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
        try {
          const response = await fetchImpl(endpoint.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "user-agent": "ClutterQuote-Webhooks/1.0",
              [SIGNATURE_HEADER]: signPayload(endpoint.secret, body, Math.floor(Date.now() / 1000)),
            },
            body,
            signal: AbortSignal.timeout(8000),
          });
          last = { endpointId: endpoint.id, ok: response.ok, status: response.status, attempts: attempt };
          if (response.ok || (response.status < 500 && response.status !== 429)) return last;
        } catch (err) {
          last = { endpointId: endpoint.id, ok: false, attempts: attempt, error: (err as Error).message };
        }
        const delay = delays[attempt - 1];
        if (delay !== undefined) await sleep(delay);
      }
      console.warn(`[webhooks] ${event} → ${endpoint.url} failed after ${last.attempts} attempts`, last);
      return last;
    }),
  );
}
