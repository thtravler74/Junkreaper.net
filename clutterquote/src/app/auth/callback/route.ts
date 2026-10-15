import { NextResponse } from "next/server";
import { supabaseForRequest } from "@/lib/auth";

/** Magic-link landing: trade the one-time code for a session cookie, then go to `next`. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  // Only same-site relative paths, so this can't be used as an open redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (code) {
    const supabase = await supabaseForRequest();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin), 303);
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin), 303);
}
