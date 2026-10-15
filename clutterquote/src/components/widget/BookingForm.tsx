"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/client/api";
import { formatUsd } from "@/lib/pricing/engine";
import type { Customer } from "@/lib/types";
import type { BookingResponse, QuoteResponse, SlotsResponse } from "./types";

export function BookingForm({ slug, quote, onBooked }: {
  slug: string;
  quote: QuoteResponse;
  onBooked: (r: BookingResponse, slotLabel: string) => Promise<void> | void;
}) {
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slotKey, setSlotKey] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer>({ name: "", email: "", phone: "", address: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSlots() {
    try {
      const s = await api<SlotsResponse>(`/api/t/${slug}/slots`);
      setSlots(s);
      setDate((d) => (d && s.slots.some((x) => x.date === d) ? d : (s.slots[0]?.date ?? null)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load availability.");
    }
  }

  useEffect(() => {
    void loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const dates = useMemo(() => [...new Set(slots?.slots.map((s) => s.date))], [slots]);
  const windows = slots?.slots.filter((s) => s.date === date) ?? [];
  const chosen = slots?.slots.find((s) => s.key === slotKey);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return setError("Pick an arrival window.");
    setSubmitting(true);
    setError(null);
    try {
      const r = await api<BookingResponse>(`/api/t/${slug}/bookings`, {
        body: { quoteId: quote.quoteId, slotKey: chosen.key, customer: { ...customer, notes: customer.notes || undefined } },
      });
      await onBooked(r, `${formatDate(chosen.date)}, ${formatTime(chosen.start)}–${formatTime(chosen.end)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Booking failed. Please try again.");
      if (err instanceof ApiError && err.code === "slot_unavailable") {
        setSlotKey(null);
        void loadSlots();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const field =
    "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <form onSubmit={submit} className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Pick a day</h3>
        {!slots && !error && <div className="h-16 animate-pulse rounded-xl bg-slate-100" />}
        {slots && dates.length === 0 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">We're fully booked for the next two weeks. Give us a call and we'll fit you in.</p>
        )}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {dates.map((d) => {
            const [weekday, rest] = formatDate(d).split(", ");
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDate(d);
                  setSlotKey(null);
                }}
                className={`flex w-16 shrink-0 flex-col items-center rounded-xl border py-2 transition ${
                  d === date ? "border-brand bg-brand text-white" : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                <span className="text-xs uppercase">{weekday}</span>
                <span className="text-sm font-semibold">{rest}</span>
              </button>
            );
          })}
        </div>
      </section>

      {windows.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Arrival window</h3>
          <div className="grid grid-cols-2 gap-2">
            {windows.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setSlotKey(w.key)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                  w.key === slotKey ? "border-brand bg-brand/10 text-slate-900 ring-2 ring-brand/30" : "border-slate-200 text-slate-700"
                }`}
              >
                {formatTime(w.start)} – {formatTime(w.end)}
                {w.remaining === 1 && <span className="block text-xs font-normal text-amber-700">Last spot</span>}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">We'll text when the crew is on the way.</p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Your details</h3>
        <input className={field} required autoComplete="name" placeholder="Full name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={field} required type="tel" autoComplete="tel" placeholder="Mobile phone" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
          <input className={field} required type="email" autoComplete="email" placeholder="Email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
        </div>
        <input className={field} required autoComplete="street-address" placeholder="Pickup address" value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
        <textarea className={field} rows={2} placeholder="Gate code, parking, where the items are (optional)" value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} />
      </section>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button type="submit" disabled={submitting || !chosen} className="w-full rounded-xl bg-brand py-3.5 font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50">
        {submitting ? "Reserving…" : quote.depositCents > 0 ? `Reserve with ${formatUsd(quote.depositCents)} deposit` : "Confirm booking"}
      </button>
      {quote.depositCents > 0 && <p className="text-center text-xs text-slate-500">🔒 Secure payment by Stripe. We hold your window for 30 minutes while you pay.</p>}
    </form>
  );
}

export function formatDate(localDate: string): string {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}
