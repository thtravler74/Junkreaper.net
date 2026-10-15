"use client";

import { formatUsd } from "@/lib/pricing/engine";
import type { AccessDetails, PublicTenantConfig, QuoteResult } from "@/lib/types";
import { Stepper } from "./Stepper";
import { TruckGauge } from "./TruckGauge";

export function PriceRange({ result, className = "" }: { result: QuoteResult; className?: string }) {
  if (result.highCents <= 0) return <span className={className}>—</span>;
  return (
    <span className={`tabular-nums ${className}`}>
      {result.lowCents === result.highCents ? formatUsd(result.lowCents) : `${formatUsd(result.lowCents)} – ${formatUsd(result.highCents)}`}
    </span>
  );
}

export function EstimateView({ result, access, onAccess, config, depositCents }: {
  result: QuoteResult;
  access: AccessDetails;
  onAccess: (a: AccessDetails) => void;
  config: PublicTenantConfig;
  depositCents: number;
}) {
  const fees = config.pricing.access;
  const set = (patch: Partial<AccessDetails>) => onAccess({ ...access, ...patch });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-brand/10 to-brand/0 p-5 text-center">
        <div className="text-sm font-medium uppercase tracking-wide text-slate-500">Your instant estimate</div>
        <PriceRange result={result} className="mt-1 block text-4xl font-extrabold text-slate-900" />
        <div className="mt-3 flex items-center justify-center gap-3">
          <TruckGauge fraction={result.billedFraction} />
        </div>
        <div className="mt-2 font-semibold text-slate-800">{result.truckLabel}</div>
        <div className="text-xs text-slate-500">
          ~{result.volumeYd3} yd³ of a {config.pricing.truckCapacityYd3} yd³ truck · about {formatMinutes(result.estimatedMinutes)} on site
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Where are the items?</h3>
        <div className="space-y-2">
          <Toggle
            checked={access.curbside}
            onChange={(v) => set({ curbside: v })}
            label="Everything's at the curb or in the driveway"
            hint={fees.curbsideDiscountPct ? `Save ${fees.curbsideDiscountPct}% on volume` : undefined}
          />
          <div className={`space-y-2 ${access.curbside ? "pointer-events-none opacity-40" : ""}`} aria-disabled={access.curbside}>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-slate-800">Flights of stairs</div>
                <div className="text-xs text-slate-500">{formatUsd(fees.stairsPerFlightCents)} per flight</div>
              </div>
              <Stepper label="flights of stairs" value={access.stairsFlights} max={10} onChange={(v) => set({ stairsFlights: v })} />
            </div>
            <Toggle checked={access.basement} onChange={(v) => set({ basement: v })} label="Basement pickup" hint={`+${formatUsd(fees.basementCents)}`} />
            <Toggle checked={access.longCarry} onChange={(v) => set({ longCarry: v })} label="Long carry (more than 50 ft to the truck)" hint={`+${formatUsd(fees.longCarryCents)}`} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Price breakdown</h3>
        <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
          <Row label={`${result.truckLabel} (volume)`}>
            {result.volumeLowCents === result.volumeHighCents
              ? formatUsd(result.volumeLowCents)
              : `${formatUsd(result.volumeLowCents)} – ${formatUsd(result.volumeHighCents)}`}
          </Row>
          {result.adjustments.map((a) => (
            <Row key={a.code} label={a.label} tone={a.amountCents < 0 ? "good" : undefined}>
              {a.amountCents < 0 ? `−${formatUsd(-a.amountCents)}` : `+${formatUsd(a.amountCents)}`}
            </Row>
          ))}
          <Row label="Estimated total" strong>
            <PriceRange result={result} />
          </Row>
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          Includes loading, hauling, disposal and sweep-up. Minimum charge {formatUsd(config.pricing.minimumChargeCents)}. Your crew confirms the final price on site before any work starts. No obligation.
        </p>
      </section>

      {result.warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {result.warnings.map((w) => (
            <li key={w}>⚠️ {w}</li>
          ))}
        </ul>
      )}

      {depositCents > 0 && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          A {formatUsd(depositCents)} deposit holds your arrival window and is credited to your final bill. Fully refundable up to{" "}
          {config.deposit.refundableUntilHours} hours before your appointment.
        </p>
      )}
    </div>
  );
}

function Row({ label, children, strong, tone }: { label: string; children: React.ReactNode; strong?: boolean; tone?: "good" }) {
  return (
    <div className={`flex justify-between gap-4 px-3 py-2 ${strong ? "bg-slate-50 font-semibold text-slate-900" : "text-slate-700"}`}>
      <dt>{label}</dt>
      <dd className={`tabular-nums ${tone === "good" ? "font-medium text-emerald-700" : ""}`}>{children}</dd>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition ${checked ? "border-brand bg-brand/5" : "border-slate-200"}`}>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--brand)]" />
    </label>
  );
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}
