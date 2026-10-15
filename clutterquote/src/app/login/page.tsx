import { authConfigured } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
        <h1 className="mb-1 text-2xl font-extrabold">Owner sign-in</h1>
        <p className="mb-6 text-sm text-slate-500">We'll email you a one-time sign-in link.</p>
        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">That link expired or was already used. Request a new one.</p>}
        {authConfigured() ? (
          <LoginForm url={process.env.SUPABASE_URL!} anonKey={process.env.SUPABASE_ANON_KEY!} next={next ?? "/"} />
        ) : (
          <p className="text-sm text-slate-600">Sign-in isn't configured on this server (SUPABASE_URL / SUPABASE_ANON_KEY).</p>
        )}
      </div>
    </main>
  );
}
