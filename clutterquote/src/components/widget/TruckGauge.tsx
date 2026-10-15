/**
 * A box truck whose cargo area fills with the billed fraction. Loads beyond one
 * truck show the overflow as a badge. Purely presentational.
 */
export function TruckGauge({ fraction, size = "md" }: { fraction: number; size?: "sm" | "md" }) {
  const full = Math.floor(fraction + 1e-9);
  const rem = fraction - full;
  const fill = fraction <= 0 ? 0 : rem > 1e-9 ? rem : 1;
  const extraTrucks = rem > 1e-9 ? full : Math.max(0, full - 1);
  const cargoWidth = 118;
  const w = size === "sm" ? 84 : 168;

  return (
    <div className="relative inline-block" style={{ width: w }} aria-hidden>
      <svg viewBox="0 0 180 92" width={w} className="block">
        {/* cargo box */}
        <rect x="4" y="6" width="124" height="62" rx="5" className="fill-slate-100 stroke-slate-400" strokeWidth="2.5" />
        <rect
          x="7"
          y="9"
          // Trucks load front to back, so the fill grows along the length at full height.
          width={fill > 0 ? Math.max(3, cargoWidth * fill) : 0}
          height="56"
          rx="3"
          className="fill-brand transition-all duration-500 ease-out"
        />
        {[1, 2, 3].map((i) => (
          <line key={i} x1={4 + 31 * i} y1="8" x2={4 + 31 * i} y2="66" className="stroke-slate-300" strokeDasharray="3 4" strokeWidth="1.5" />
        ))}
        {/* cab */}
        <path d="M132 24h22l20 20v24h-42z" className="fill-slate-200 stroke-slate-400" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M138 30h14l12 13h-26z" className="fill-sky-100 stroke-slate-400" strokeWidth="1.5" />
        {/* chassis + wheels */}
        <rect x="4" y="68" width="170" height="6" rx="2" className="fill-slate-500" />
        {[34, 98, 152].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="78" r="11" className="fill-slate-700" />
            <circle cx={cx} cy="78" r="4.5" className="fill-slate-300" />
          </g>
        ))}
      </svg>
      {extraTrucks > 0 && (
        <span className="absolute -right-2 -top-2 rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">
          +{extraTrucks} truck{extraTrucks > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
