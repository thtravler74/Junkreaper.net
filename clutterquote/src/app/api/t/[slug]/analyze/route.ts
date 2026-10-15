import { randomUUID } from "node:crypto";
import { apiError, json, parseBody, tenantOr404 } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { MAX_PHOTO_BYTES, analyzeRequest } from "@/lib/schemas";
import { getStore } from "@/lib/store";
import { VisionError, analyzePhotos } from "@/lib/vision/analyze";
import { reconcileVision } from "@/lib/vision/reconcile";

export const maxDuration = 60;

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const found = await tenantOr404((await params).slug);
  if ("response" in found) return found.response;
  const { tenant } = found;

  // Vision calls cost real money: 12 analyses per IP per hour per tenant.
  const limit = rateLimit(`analyze:${tenant.id}:${clientIp(request)}`, 12, 3_600_000);
  if (!limit.ok) {
    return apiError(429, "rate_limited", "Too many photo analyses. Try again later or use the item checklist.", {
      "retry-after": String(limit.retryAfterSec),
    });
  }

  const body = await parseBody(request, analyzeRequest);
  if (!body.ok) return body.response;

  const decoded = body.data.images.map((img) => ({ ...img, bytes: Buffer.from(img.base64, "base64") }));
  for (const [i, img] of decoded.entries()) {
    if (img.bytes.length > MAX_PHOTO_BYTES) return apiError(413, "photo_too_large", `Photo ${i + 1} is too large.`);
    if (!MAGIC[img.mime]!(img.bytes)) return apiError(422, "invalid_photo", `Photo ${i + 1} isn't a valid ${img.mime} image.`);
  }

  let outcome;
  try {
    outcome = await analyzePhotos(body.data.images);
  } catch (err) {
    if (err instanceof VisionError) {
      console.error(`[vision] ${tenant.slug}: ${err.message}`);
      return apiError(
        err.retryable ? 503 : 422,
        "vision_failed",
        err.retryable
          ? "Our photo estimator is busy. Please try again, or use the item checklist."
          : "We couldn't read those photos. Try clearer shots, or use the item checklist.",
      );
    }
    throw err;
  }

  const id = randomUUID();
  const store = getStore();
  const photoKeys = decoded.map((img, i) => `${tenant.id}/${id}/${i}.${EXT[img.mime]}`);
  await Promise.all(decoded.map((img, i) => store.savePhoto(photoKeys[i]!, img.bytes, img.mime)));

  const reconciled = reconcileVision(outcome.result);
  await store.saveAnalysis({
    id,
    tenantId: tenant.id,
    provider: outcome.provider,
    model: outcome.model,
    photoKeys,
    raw: outcome.result,
    lines: reconciled.lines,
    looseYd3: reconciled.looseYd3,
    looseLbs: reconciled.looseLbs,
    uncertainty: reconciled.uncertainty,
    createdAt: new Date().toISOString(),
  });

  const r = outcome.result;
  return json({
    analysisId: id,
    provider: outcome.provider,
    lines: reconciled.lines,
    looseYd3: reconciled.looseYd3,
    looseLbs: reconciled.looseLbs,
    uncertainty: reconciled.uncertainty,
    notes: reconciled.notes,
    // The spec's contract fields, as returned by the model.
    detected_items: r.detected_items,
    estimated_cubic_yards: r.estimated_cubic_yards,
    truck_fraction: r.truck_fraction,
    dense_materials_detected: r.dense_materials_detected,
    special_handling_required: r.special_handling_required,
    prohibited_items_suspected: r.prohibited_items_suspected,
    photo_quality_issues: r.photo_quality_issues,
    overall_confidence: r.overall_confidence,
  });
}
