import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/store";

/**
 * The embed route is the only page meant to be framed. Each tenant lists the
 * origins allowed to frame its widget. An empty list allows any https origin,
 * which is the easy default for haulers on hosted site builders (Wix, Squarespace,
 * GoDaddy) whose preview domains change.
 */
export async function proxy(request: NextRequest) {
  const slug = request.nextUrl.pathname.split("/")[2] ?? "";
  const tenant = slug ? await getStore().getTenantBySlug(slug).catch(() => null) : null;
  const origins = tenant?.allowedOrigins.filter((o) => /^https?:\/\/[\w.-]+(:\d+)?$/.test(o)) ?? [];
  const ancestors = origins.length ? origins.join(" ") : "https: http://localhost:*";

  const response = NextResponse.next();
  response.headers.set("content-security-policy", `frame-ancestors 'self' ${ancestors}`);
  return response;
}

export const config = { matcher: "/embed/:slug*" };
