import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { usingFileStore } from "./store";
import type { Tenant } from "./types";

export function authConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/** Cookie-backed Supabase client for the signed-in owner (anon key + their session). */
export async function supabaseForRequest() {
  const jar = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) jar.set(name, value, options);
        } catch {
          // Server Components can't set cookies; the session is refreshed on the next route handler call.
        }
      },
    },
  });
}

export type OwnerCheck = { ok: true; email: string | null; devBypass: boolean } | { ok: false; reason: "signed_out" | "forbidden" };

/**
 * Owner access to a tenant's dashboard and integrations. With Supabase Auth the
 * signed-in email must be in tenant.ownerEmails. Local development on the file
 * store has no auth: every tenant is open, and the dashboard says so. A production
 * build only opens up with INSECURE_OPEN_DASHBOARD=1 (used by the e2e run).
 */
export async function checkOwner(tenant: Tenant): Promise<OwnerCheck> {
  if (!authConfigured()) {
    const open = process.env.NODE_ENV !== "production" || process.env.INSECURE_OPEN_DASHBOARD === "1";
    if (usingFileStore() && open) return { ok: true, email: null, devBypass: true };
    return { ok: false, reason: "forbidden" };
  }
  const supabase = await supabaseForRequest();
  // getUser() revalidates the JWT with Supabase; getSession() alone would trust the cookie.
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return { ok: false, reason: "signed_out" };
  const allowed = tenant.ownerEmails.some((e) => e.toLowerCase() === email);
  return allowed ? { ok: true, email, devBypass: false } : { ok: false, reason: "forbidden" };
}
