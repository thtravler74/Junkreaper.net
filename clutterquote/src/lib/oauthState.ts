import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * OAuth `state` bound to a tenant and a per-browser nonce cookie, HMAC'd with
 * APP_SECRET. The callback accepts it only from the browser that started the
 * flow, which closes the login-CSRF hole in OAuth redirects.
 */
export const NONCE_COOKIE = "cq_oauth_nonce";

function mac(data: string): string {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not set");
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function makeState(tenantSlug: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  return { state: `${tenantSlug}.${nonce}.${mac(`${tenantSlug}.${nonce}`)}`, nonce };
}

export function readState(state: string, cookieNonce: string | undefined): string | null {
  const [slug, nonce, sig] = state.split(".");
  if (!slug || !nonce || !sig || !cookieNonce || nonce !== cookieNonce) return null;
  const expected = Buffer.from(mac(`${slug}.${nonce}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? slug : null;
}
