import { apiError, json, tenantOr404 } from "@/lib/http";
import { ZIP_PATTERN, checkServiceArea, zippopotamGeocoder } from "@/lib/serviceArea";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const found = await tenantOr404((await params).slug);
  if ("response" in found) return found.response;
  const zip = new URL(request.url).searchParams.get("zip") ?? "";
  if (!ZIP_PATTERN.test(zip)) return apiError(422, "invalid_zip", "Enter a 5-digit ZIP code.");
  return json(await checkServiceArea(zip, found.tenant.serviceArea, zippopotamGeocoder));
}
