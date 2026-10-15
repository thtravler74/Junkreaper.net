import { json, publicConfig, tenantOr404 } from "@/lib/http";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const found = await tenantOr404((await params).slug);
  if ("response" in found) return found.response;
  return json(publicConfig(found.tenant), { headers: { "cache-control": "public, max-age=60" } });
}
