/**
 * Turns raw vision output into priceable quote lines plus an uncertainty figure.
 *
 * The model gives two volume signals:
 *   - itemized: Σ catalog volumes (calibrated by us) + "other" items + loose and dense piles
 *   - holistic: its single whole-scene estimate
 *
 * Itemized is more trustworthy for discrete furniture (the volumes are ours, not the
 * model's guesses); holistic catches what itemizing misses. When the holistic figure
 * is LARGER, the difference becomes extra loose volume, weighted by HOLISTIC_WEIGHT,
 * because missed items are the usual failure mode. When it is smaller, we keep the
 * itemized total (the items are individually identified) and only widen the range.
 * Disagreement and low confidence both widen the price range rather than move it.
 */
import { getCatalogItem } from "../catalog";
import { LOOSE_LBS_PER_YD3 } from "../pricing/engine";
import type { QuoteLine } from "../types";
import type { VisionResult } from "./schema";

const HOLISTIC_WEIGHT = 0.5;
/** Fallback density for unknown "other" items, lb per loaded yd³. */
const OTHER_LBS_PER_YD3 = 200;

export interface Reconciled {
  lines: QuoteLine[];
  looseYd3: number;
  looseLbs: number;
  /** Added to the tenant's base photo spread (fraction, e.g. 0.12 = ±12 points). */
  uncertainty: number;
  itemizedYd3: number;
  holisticYd3: number;
  notes: string[];
}

export function reconcileVision(result: VisionResult): Reconciled {
  const lines: QuoteLine[] = [];
  const catalogQty = new Map<string, number>();
  let itemizedYd3 = 0;
  const notes: string[] = [];

  for (const item of result.items) {
    const catalog = item.catalog_id === "other" ? undefined : getCatalogItem(item.catalog_id);
    if (catalog) {
      catalogQty.set(catalog.id, (catalogQty.get(catalog.id) ?? 0) + item.quantity);
      itemizedYd3 += catalog.yd3 * item.quantity;
    } else {
      // Clamp "other" sizes: a single unknown item over 6 yd³ is almost always a
      // misread pile, and it is priced as loose volume instead.
      const each = clamp(item.est_cubic_yards_each, 0.05, 6);
      lines.push({
        kind: "custom",
        label: item.label.slice(0, 80),
        quantity: item.quantity,
        yd3Each: round2(each),
        lbsEach: Math.round(each * OTHER_LBS_PER_YD3),
      });
      itemizedYd3 += each * item.quantity;
    }
  }
  for (const [catalogId, quantity] of catalogQty) lines.unshift({ kind: "catalog", catalogId, quantity });

  // Dense debris maps onto the catalog's per-cubic-yard items (concrete, dirt, …), split
  // evenly across the materials seen, so it carries the right weight and dense flag.
  const denseYd3 = result.dense_debris_cubic_yards;
  if (denseYd3 > 0) {
    const materials = result.dense_materials.length ? [...new Set(result.dense_materials)] : (["concrete"] as const);
    for (const material of materials) {
      lines.push({ kind: "catalog", catalogId: material, quantity: round2(denseYd3 / materials.length) });
    }
  }

  let looseYd3 = result.loose_debris_cubic_yards;
  itemizedYd3 += looseYd3 + denseYd3;

  const holisticYd3 = result.estimated_cubic_yards;
  const gap = holisticYd3 - itemizedYd3;
  if (gap > 0.25) {
    const added = gap * HOLISTIC_WEIGHT;
    looseYd3 += added;
    notes.push(`Added ${added.toFixed(1)} yd³ for items visible in the photos but not itemized.`);
  }

  // Disagreement between the two estimates as a fraction of the larger one.
  const larger = Math.max(itemizedYd3, holisticYd3, 0.01);
  const disagreement = Math.abs(gap) / larger;
  const lowConfidence = 1 - result.overall_confidence;
  const uncertainty = Math.min(0.3, 0.15 * lowConfidence + 0.25 * disagreement + (result.photo_quality_issues.length ? 0.05 : 0));

  return {
    lines,
    looseYd3: round2(looseYd3),
    looseLbs: Math.round(looseYd3 * LOOSE_LBS_PER_YD3),
    uncertainty: round2(uncertainty),
    itemizedYd3: round2(itemizedYd3),
    holisticYd3: round2(holisticYd3),
    notes,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
