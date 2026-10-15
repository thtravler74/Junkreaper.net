import { z } from "zod";
import { CATALOG, CATALOG_IDS } from "../catalog";

export const DENSE_MATERIALS = [
  "concrete",
  "dirt_sod",
  "brick_block",
  "rock_gravel",
  "tile",
  "roof_shingles",
] as const;

export const SPECIAL_HANDLING = [
  "heavy_lifting",
  "disassembly",
  "freon",
  "e_waste",
  "two_person",
  "stairs_visible",
  "hazardous_suspected",
] as const;

/**
 * What the model must return. The catalog ids are an enum, so the model is forced to
 * map what it sees onto items we already have calibrated volumes, weights and fees
 * for. Anything it can't map goes in as "other" with its own size estimate.
 *
 * The top-level fields the product spec asks for (detected_items,
 * estimated_cubic_yards, truck_fraction, dense_materials_detected,
 * special_handling_required) are all present. The model's own truck_fraction is
 * kept for audit only; the server recomputes it from reconciled volume.
 */
export const visionResultSchema = z.object({
  items: z.array(
    z.object({
      catalog_id: z.enum([...CATALOG_IDS, "other"]),
      label: z.string(),
      quantity: z.number().int().min(1).max(200),
      /** Only meaningful for "other": loaded yd³ per unit. */
      est_cubic_yards_each: z.number().min(0).max(30),
      confidence: z.number().min(0).max(1),
    }),
  ),
  detected_items: z.array(z.string()),
  loose_debris_cubic_yards: z.number().min(0).max(100),
  dense_debris_cubic_yards: z.number().min(0).max(50),
  dense_materials: z.array(z.enum(DENSE_MATERIALS)),
  estimated_cubic_yards: z.number().min(0).max(200),
  truck_fraction: z.string(),
  dense_materials_detected: z.boolean(),
  special_handling_required: z.array(z.enum(SPECIAL_HANDLING)),
  prohibited_items_suspected: z.array(z.string()),
  overall_confidence: z.number().min(0).max(1),
  photo_quality_issues: z.array(z.string()),
});

export type VisionResult = z.infer<typeof visionResultSchema>;

/**
 * The same shape as a JSON Schema for OpenAI Structured Outputs (strict mode:
 * every property required, no additional properties). Hand-written rather than
 * generated so the wire contract is visible in one place.
 */
export function visionJsonSchema(): Record<string, unknown> {
  const str = { type: "string" };
  const num = { type: "number" };
  const strArray = { type: "array", items: str };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "items",
      "detected_items",
      "loose_debris_cubic_yards",
      "dense_debris_cubic_yards",
      "dense_materials",
      "estimated_cubic_yards",
      "truck_fraction",
      "dense_materials_detected",
      "special_handling_required",
      "prohibited_items_suspected",
      "overall_confidence",
      "photo_quality_issues",
    ],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["catalog_id", "label", "quantity", "est_cubic_yards_each", "confidence"],
          properties: {
            catalog_id: { type: "string", enum: [...CATALOG_IDS, "other"] },
            label: str,
            quantity: { type: "integer" },
            est_cubic_yards_each: num,
            confidence: num,
          },
        },
      },
      detected_items: strArray,
      loose_debris_cubic_yards: num,
      dense_debris_cubic_yards: num,
      dense_materials: { type: "array", items: { type: "string", enum: [...DENSE_MATERIALS] } },
      estimated_cubic_yards: num,
      truck_fraction: str,
      dense_materials_detected: { type: "boolean" },
      special_handling_required: { type: "array", items: { type: "string", enum: [...SPECIAL_HANDLING] } },
      prohibited_items_suspected: strArray,
      overall_confidence: num,
      photo_quality_issues: strArray,
    },
  };
}

const catalogReference = CATALOG.map((item) => `${item.id} | ${item.label} | ${item.yd3} yd³`).join("\n");

export const VISION_SYSTEM_PROMPT = `You are an estimator for a junk removal company. From customer photos you identify every item to be hauled away and estimate its LOADED volume in cubic yards (the space it takes in a box truck, including dead air). 1 cubic yard = 27 cubic feet. A full truck is 15 cubic yards.

Rules:
1. The photos may show the SAME items from different angles. Deduplicate across all photos and count each physical item once.
2. Count only items that are clearly junk to be removed: free-standing furniture, appliances, boxes, bags and debris piles. Ignore walls, built-in cabinets, fixtures, vehicles, people and pets.
3. Map each item to the closest catalog_id below and use that catalog volume. Use "other" only when nothing fits, and then give est_cubic_yards_each yourself. For catalog items, set est_cubic_yards_each to the catalog value.
4. Clutter that can't be itemized (heaps of bags, loose household junk, mixed piles) goes in loose_debris_cubic_yards. Estimate the pile as length × width × height in feet ÷ 27 × 0.7 packing factor. Do NOT also list those things in items.
5. Dense materials (concrete, dirt, brick, rock, tile, shingles) go in dense_debris_cubic_yards and dense_materials, not in items or loose debris.
6. Use known sizes for scale: an interior door is 80 in tall and 36 in wide, ceilings are about 8 ft, a 33-gal trash bag is about 0.16 yd³, a full-size pickup bed holds about 2.5 yd³, a standard parking space is 9 × 18 ft.
7. estimated_cubic_yards is your independent holistic estimate of the whole load. It should roughly agree with the sum of items, loose debris and dense debris; it is a cross-check, so do not force it to match.
8. detected_items is a short human-readable list such as "3-seat sofa", "4 cardboard boxes".
9. truck_fraction is the decimal fraction of a 15 yd³ truck as a string, e.g. "0.33".
10. Flag paint, chemicals, propane tanks, fuel, asbestos-looking materials, batteries or medical waste in prohibited_items_suspected.
11. Report blur, darkness, partial views or no visible junk in photo_quality_issues, and lower overall_confidence to match. When unsure between two sizes, choose the larger: under-quoting is worse for the customer than a range that comes in low on site.

Catalog (catalog_id | item | loaded yd³ per unit):
${catalogReference}`;
