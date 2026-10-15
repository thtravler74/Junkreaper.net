"use client";

import { useMemo, useState } from "react";
import { CATALOG, CATEGORIES, type CategoryId } from "@/lib/catalog";
import { Stepper } from "./Stepper";

export function InventoryPicker({ counts, onChange }: {
  counts: Record<string, number>;
  onChange: (id: string, qty: number) => void;
}) {
  const [category, setCategory] = useState<CategoryId | "selected">("furniture");
  const [query, setQuery] = useState("");
  const selectedCount = Object.values(counts).filter((n) => n > 0).length;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return CATALOG.filter((i) => i.label.toLowerCase().includes(q));
    if (category === "selected") return CATALOG.filter((i) => (counts[i.id] ?? 0) > 0);
    return CATALOG.filter((i) => i.category === category);
  }, [category, query, counts]);

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search items (e.g. fridge, mattress)"
        className="mb-3 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {!query && (
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
          {selectedCount > 0 && (
            <Chip active={category === "selected"} onClick={() => setCategory("selected")}>
              ✓ Selected ({selectedCount})
            </Chip>
          )}
          {CATEGORIES.map((c) => (
            <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
              {c.icon} {c.label}
            </Chip>
          ))}
        </div>
      )}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {items.map((item) => {
          const qty = counts[item.id] ?? 0;
          const perYard = item.unit === "cubic_yard";
          return (
            <li key={item.id} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${qty > 0 ? "bg-brand/5" : ""}`}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800">{item.label}</div>
                <div className="text-xs text-slate-500">
                  {perYard ? "per cubic yard (a 3×3×3 ft pile)" : `~${item.yd3} yd³`}
                  {item.surcharge ? " · disposal fee applies" : ""}
                </div>
              </div>
              <Stepper label={item.label} value={qty} onChange={(v) => onChange(item.id, v)} step={perYard ? 0.5 : 1} max={perYard ? 40 : 99} />
            </li>
          );
        })}
        {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No matching items. Try the photo option for anything unusual.</li>}
      </ul>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
      }`}
    >
      {children}
    </button>
  );
}
