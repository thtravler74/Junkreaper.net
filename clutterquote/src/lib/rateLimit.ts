/**
 * Fixed-window in-memory limiter. Good enough to stop a single client from
 * burning vision-API spend on one instance; on serverless, where instances don't
 * share memory, back it with Redis or Upstash for a real global limit.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, retryAfterSec: 0 };
  }
  bucket.count++;
  return bucket.count <= limit ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
