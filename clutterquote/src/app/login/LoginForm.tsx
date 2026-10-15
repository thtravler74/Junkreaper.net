"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";

export function LoginForm({ url, anonKey, next }: { url: string; anonKey: string; next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createBrowserClient(url, anonKey);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: true },
    });
    setState(error ? "error" : "sent");
  }

  if (state === "sent") return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Check {email} for your sign-in link.</p>;
  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@yourbusiness.com"
        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-500"
      />
      <button disabled={state === "sending"} className="w-full rounded-xl bg-slate-900 py-2.5 font-semibold text-white disabled:opacity-60">
        {state === "sending" ? "Sending…" : "Email me a link"}
      </button>
      {state === "error" && <p className="text-sm text-red-700">Couldn't send the link. Try again.</p>}
    </form>
  );
}
