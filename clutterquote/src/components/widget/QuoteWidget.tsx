"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getCatalogItem, PROHIBITED_MATERIALS } from "@/lib/catalog";
import { ApiError, api } from "@/lib/client/api";
import { MSG, postToHost, redirectTop } from "@/lib/client/embed";
import { computeQuote, depositFor, formatUsd } from "@/lib/pricing/engine";
import type { ServiceAreaResult } from "@/lib/serviceArea";
import type { AccessDetails, CustomLine, PublicTenantConfig, QuoteInput } from "@/lib/types";
import { BookingForm } from "./BookingForm";
import { EstimateView, PriceRange } from "./EstimateView";
import { InventoryPicker } from "./InventoryPicker";
import { PhotoIntake } from "./PhotoIntake";
import { Stepper } from "./Stepper";
import { TruckGauge } from "./TruckGauge";
import type { AnalyzeResponse, BookingResponse, QuoteResponse } from "./types";

type Step = "zip" | "describe" | "estimate" | "book" | "done";
type Method = "photos" | "items";

const NO_ACCESS: AccessDetails = { stairsFlights: 0, basement: false, longCarry: false, curbside: false };
const STEPS: Step[] = ["zip", "describe", "estimate", "book"];

export function QuoteWidget({ config }: { config: PublicTenantConfig }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>("zip");
  const [zip, setZip] = useState("");
  const [area, setArea] = useState<ServiceAreaResult | null>(null);
  const [method, setMethod] = useState<Method>("photos");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [custom, setCustom] = useState<CustomLine[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [access, setAccess] = useState<AccessDetails>(NO_ACCESS);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [booked, setBooked] = useState<{ booking: BookingResponse; slotLabel: string } | null>(null);
  const [checkoutLink, setCheckoutLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the host iframe sized to the content.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => postToHost({ type: MSG.resize, height: Math.ceil(el.getBoundingClientRect().height) + 2 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    postToHost({ type: MSG.event, name: `step:${step}` });
    rootRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [step]);

  const photoBasis = method === "photos" ? analysis : null;
  const usingPhotos = photoBasis !== null;
  const lines = useMemo(() => {
    const catalog = Object.entries(counts)
      .filter(([, q]) => q > 0)
      .map(([catalogId, quantity]) => ({ kind: "catalog" as const, catalogId, quantity }));
    return usingPhotos ? [...catalog, ...custom.filter((c) => c.quantity > 0)] : catalog;
  }, [counts, custom, usingPhotos]);

  // Live price, computed in the browser with the tenant's own pricing config.
  // The server recomputes from scratch when the quote is issued.
  const input: QuoteInput = photoBasis
    ? {
        method: "photos",
        lines,
        looseYd3: photoBasis.looseYd3,
        looseLbs: photoBasis.looseLbs,
        photoUncertainty: photoBasis.uncertainty,
        access,
        tripFeeCents: area?.tripFeeCents ?? 0,
      }
    : { method: "inventory", lines, looseYd3: 0, access, tripFeeCents: area?.tripFeeCents ?? 0 };
  const live = useMemo(() => computeQuote(input, config.pricing), [JSON.stringify(input), config.pricing]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveDeposit = config.paymentsLive ? depositFor(live.highCents, config.deposit) : 0;

  async function checkZip(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{5}$/.test(zip)) return setError("Enter a 5-digit ZIP code.");
    setBusy(true);
    try {
      const r = await api<ServiceAreaResult>(`/api/t/${config.slug}/service-area?zip=${zip}`);
      setArea(r);
      if (r.status !== "out_of_area") setStep("describe");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't check that ZIP code.");
    } finally {
      setBusy(false);
    }
  }

  function applyAnalysis(r: AnalyzeResponse) {
    setAnalysis(r);
    const next: Record<string, number> = {};
    const nextCustom: CustomLine[] = [];
    for (const line of r.lines) {
      if (line.kind === "catalog") next[line.catalogId] = (next[line.catalogId] ?? 0) + line.quantity;
      else nextCustom.push(line);
    }
    setCounts(next);
    setCustom(nextCustom);
  }

  async function issueQuote() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<QuoteResponse>(`/api/t/${config.slug}/quotes`, {
        body: {
          zip,
          method: photoBasis ? "photos" : "inventory",
          analysisId: photoBasis?.analysisId,
          lines,
          access,
        },
      });
      setQuote(r);
      setStep("book");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your quote.");
    } finally {
      setBusy(false);
    }
  }

  async function onBooked(r: BookingResponse, slotLabel: string) {
    setBooked({ booking: r, slotLabel });
    if (r.checkoutUrl) {
      postToHost({ type: MSG.event, name: "checkout:start" });
      const navigated = await redirectTop(r.checkoutUrl);
      if (!navigated) setCheckoutLink(r.checkoutUrl);
      return;
    }
    postToHost({ type: MSG.event, name: "booking:confirmed" });
    setStep("done");
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-xl" style={{ ["--brand" as string]: config.brandColor }}>
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            {config.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={config.logoUrl} alt="" className="h-9 w-9 rounded-lg object-contain" />
            ) : (
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-lg text-white">🚛</div>
            )}
            <div>
              <div className="font-bold leading-tight text-slate-900">{config.name}</div>
              <div className="text-xs text-slate-500">Instant junk removal quote</div>
            </div>
          </div>
          {step !== "done" && (
            <ol className="flex gap-1.5" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
              {STEPS.map((s, i) => (
                <li key={s} className={`h-1.5 w-6 rounded-full ${i <= stepIndex ? "bg-brand" : "bg-slate-200"}`} />
              ))}
            </ol>
          )}
        </header>

        <div className="p-4 sm:p-5">
          {step === "zip" && (
            <form onSubmit={checkZip} className="space-y-4 py-4 text-center">
              <h2 className="text-2xl font-extrabold text-slate-900">See your price in 60 seconds</h2>
              <p className="text-slate-600">Snap a photo or pick your items. No phone call, no waiting for an estimator.</p>
              <div className="mx-auto flex max-w-sm gap-2">
                <input
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={5}
                  value={zip}
                  onChange={(e) => {
                    setZip(e.target.value.replace(/\D/g, ""));
                    setArea(null);
                  }}
                  placeholder="Pickup ZIP code"
                  aria-label="Pickup ZIP code"
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-lg tracking-widest outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <button disabled={busy} className="rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-60">
                  {busy ? "…" : "Start"}
                </button>
              </div>
              {area?.status === "out_of_area" && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Sorry, {zip} is outside our regular service area. Call <a className="font-semibold underline" href={`tel:${config.phone}`}>{config.phone}</a> and we'll see what we can do.
                </p>
              )}
            </form>
          )}

          {step === "describe" && (
            <div className="space-y-4">
              {area?.status === "extended" && (
                <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  {zip} is at the edge of our area ({area.distanceMiles} mi). A {formatUsd(area.tripFeeCents)} trip fee applies.
                </p>
              )}
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
                {(["photos", "items"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={method === m}
                    onClick={() => setMethod(m)}
                    className={`rounded-lg py-2 text-sm font-semibold transition ${method === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                  >
                    {m === "photos" ? "📷 Upload photos" : "☑️ Pick items"}
                  </button>
                ))}
              </div>

              {method === "photos" && !analysis && (
                <PhotoIntake slug={config.slug} onAnalyzed={applyAnalysis} onFallback={() => setMethod("items")} />
              )}

              {method === "photos" && analysis && (
                <AnalysisReview
                  analysis={analysis}
                  counts={counts}
                  custom={custom}
                  onCount={(id, q) => setCounts((c) => ({ ...c, [id]: q }))}
                  onCustom={(i, q) => setCustom((c) => c.map((x, j) => (j === i ? { ...x, quantity: q } : x)))}
                  onRetake={() => {
                    setAnalysis(null);
                    setCounts({});
                    setCustom([]);
                  }}
                />
              )}

              {method === "items" && (
                <InventoryPicker
                  counts={counts}
                  onChange={(id, q) => {
                    // Switching to a manual list drops the photo baseline (loose-pile volume).
                    if (analysis) setAnalysis(null);
                    setCounts((c) => ({ ...c, [id]: q }));
                  }}
                />
              )}

              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer">Things we can't take</summary>
                <p className="mt-1">{PROHIBITED_MATERIALS.join(" · ")}</p>
              </details>
            </div>
          )}

          {step === "estimate" && (
            <EstimateView result={live} access={access} onAccess={setAccess} config={config} depositCents={liveDeposit} />
          )}

          {step === "book" && quote && !checkoutLink && <BookingForm slug={config.slug} quote={quote} onBooked={onBooked} />}

          {step === "book" && checkoutLink && (
            <div className="space-y-4 py-6 text-center">
              <p className="text-lg font-semibold text-slate-900">Your window is held for 30 minutes</p>
              <a href={checkoutLink} target="_top" className="inline-block rounded-xl bg-brand px-6 py-3 font-semibold text-white">
                Continue to secure payment →
              </a>
            </div>
          )}

          {step === "done" && booked && (
            <div className="space-y-3 py-8 text-center">
              <div className="text-5xl">✅</div>
              <h2 className="text-2xl font-extrabold text-slate-900">You're booked!</h2>
              <p className="text-slate-700">{booked.slotLabel}</p>
              <p className="text-sm text-slate-500">
                We've got your details and will text you when the crew is on the way. Questions? Call{" "}
                <a className="font-semibold text-slate-700 underline" href={`tel:${config.phone}`}>{config.phone}</a>.
              </p>
            </div>
          )}

          {error && step !== "zip" && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {error && step === "zip" && <p className="text-center text-sm text-red-700">{error}</p>}
        </div>

        {(step === "describe" || step === "estimate") && (
          <footer className="sticky bottom-0 flex items-center gap-3 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
            {step === "describe" ? (
              <>
                <TruckGauge fraction={live.billedFraction} size="sm" />
                <div className="min-w-0 flex-1">
                  <PriceRange result={live} className="block text-lg font-extrabold text-slate-900" />
                  <div className="truncate text-xs text-slate-500">{live.volumeYd3 > 0 ? live.truckLabel : "Add items to see your price"}</div>
                </div>
                <button
                  type="button"
                  disabled={live.volumeYd3 <= 0}
                  onClick={() => setStep("estimate")}
                  className="rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-40"
                >
                  Next
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setStep("describe")} className="rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700">
                  Edit items
                </button>
                <button type="button" disabled={busy} onClick={issueQuote} className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-60">
                  {busy ? "Locking in your price…" : "Book a pickup"}
                </button>
              </>
            )}
          </footer>
        )}
      </div>
      <p className="mt-3 text-center text-[11px] text-slate-400">Powered by ClutterQuote</p>
    </div>
  );
}

function AnalysisReview({ analysis, counts, custom, onCount, onCustom, onRetake }: {
  analysis: AnalyzeResponse;
  counts: Record<string, number>;
  custom: CustomLine[];
  onCount: (id: string, qty: number) => void;
  onCustom: (index: number, qty: number) => void;
  onRetake: () => void;
}) {
  const catalogIds = Object.keys(counts);
  return (
    <div className="space-y-3">
      {analysis.provider === "mock" && (
        <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-800">
          Demo mode: no vision API key is configured, so this is sample output rather than an analysis of your photos.
        </p>
      )}
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-slate-900">Here's what we spotted</h3>
        <button type="button" onClick={onRetake} className="text-sm text-slate-500 underline-offset-2 hover:underline">
          Retake photos
        </button>
      </div>
      <p className="text-xs text-slate-500">Fix anything we got wrong. The price updates as you go.</p>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {catalogIds.map((id) => {
          const item = getCatalogItem(id);
          if (!item) return null;
          return (
            <li key={id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-sm font-medium text-slate-800">{item.label}</span>
              <Stepper label={item.label} value={counts[id] ?? 0} onChange={(q) => onCount(id, q)} step={item.unit === "cubic_yard" ? 0.5 : 1} />
            </li>
          );
        })}
        {custom.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-sm font-medium text-slate-800">{c.label}</span>
            <Stepper label={c.label} value={c.quantity} onChange={(q) => onCustom(i, q)} />
          </li>
        ))}
        {analysis.looseYd3 > 0 && (
          <li className="flex items-center justify-between px-3 py-2.5 text-sm">
            <span className="font-medium text-slate-800">Loose junk and small items</span>
            <span className="text-slate-500">~{analysis.looseYd3} yd³</span>
          </li>
        )}
      </ul>
      {analysis.prohibited_items_suspected.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ We may have spotted items we can't haul ({analysis.prohibited_items_suspected.join(", ")}). Please set those aside.
        </p>
      )}
      {analysis.photo_quality_issues.length > 0 && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Photo note: {analysis.photo_quality_issues.join("; ")}. Your price range is a little wider to allow for it.
        </p>
      )}
    </div>
  );
}
