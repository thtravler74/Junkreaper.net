import { checkOwner } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getStore } from "@/lib/store";

/** Owner-only access to customer photos. Keys are "<tenantId>/<analysisId>/<n>.<ext>". */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const parts = (await params).key;
  if (parts.length !== 3 || parts.some((p) => !/^[\w.-]+$/.test(p) || p.startsWith("."))) {
    return apiError(404, "not_found", "Not found.");
  }
  const store = getStore();
  const tenant = await store.getTenantById(parts[0]!);
  if (!tenant) return apiError(404, "not_found", "Not found.");
  const owner = await checkOwner(tenant);
  if (!owner.ok) return apiError(404, "not_found", "Not found.");

  const photo = await store.readPhoto(parts.join("/"));
  if (!photo) return apiError(404, "not_found", "Not found.");
  return new Response(new Uint8Array(photo.data), {
    headers: { "content-type": photo.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
  });
}
