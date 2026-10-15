import { describe, expect, it } from "vitest";
import { visionJsonSchema, visionResultSchema, type VisionResult } from "@/lib/vision/schema";
import { reconcileVision } from "@/lib/vision/reconcile";

const base: VisionResult = {
  items: [],
  detected_items: [],
  loose_debris_cubic_yards: 0,
  dense_debris_cubic_yards: 0,
  dense_materials: [],
  estimated_cubic_yards: 0,
  truck_fraction: "0",
  dense_materials_detected: false,
  special_handling_required: [],
  prohibited_items_suspected: [],
  overall_confidence: 1,
  photo_quality_issues: [],
};

describe("reconcileVision", () => {
  it("merges duplicate catalog detections and keeps catalog volumes", () => {
    const r = reconcileVision({
      ...base,
      items: [
        { catalog_id: "sofa_3_seat", label: "sofa", quantity: 1, est_cubic_yards_each: 9, confidence: 1 },
        { catalog_id: "sofa_3_seat", label: "couch", quantity: 1, est_cubic_yards_each: 9, confidence: 1 },
      ],
      estimated_cubic_yards: 5,
    });
    expect(r.lines).toEqual([{ kind: "catalog", catalogId: "sofa_3_seat", quantity: 2 }]);
    expect(r.itemizedYd3).toBe(5); // the model's 9 yd³ is ignored for catalog items
    expect(r.uncertainty).toBe(0);
  });

  it("adds half of an unexplained holistic surplus as loose volume", () => {
    const r = reconcileVision({ ...base, loose_debris_cubic_yards: 2, estimated_cubic_yards: 6 });
    expect(r.looseYd3).toBe(4); // 2 + (6 − 2) × 0.5
    expect(r.uncertainty).toBeCloseTo(0.17, 2); // 0.25 × 4/6
  });

  it("clamps oversized 'other' items and maps dense debris to catalog materials", () => {
    const r = reconcileVision({
      ...base,
      items: [{ catalog_id: "other", label: "giant thing", quantity: 1, est_cubic_yards_each: 25, confidence: 0.5 }],
      dense_debris_cubic_yards: 2,
      dense_materials: ["concrete", "brick_block"],
      estimated_cubic_yards: 8,
      overall_confidence: 0.6,
      photo_quality_issues: ["blurry"],
    });
    expect(r.lines).toContainEqual({ kind: "custom", label: "giant thing", quantity: 1, yd3Each: 6, lbsEach: 1200 });
    expect(r.lines).toContainEqual({ kind: "catalog", catalogId: "concrete", quantity: 1 });
    expect(r.lines).toContainEqual({ kind: "catalog", catalogId: "brick_block", quantity: 1 });
    expect(r.uncertainty).toBeCloseTo(0.15 * 0.4 + 0.05, 2);
  });
});

describe("vision schemas", () => {
  it("strict JSON schema lists every property as required", () => {
    const schema = visionJsonSchema() as { required: string[]; properties: Record<string, unknown> };
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    expect(Object.keys(visionResultSchema.shape).sort()).toEqual(Object.keys(schema.properties).sort());
  });

  it("rejects unknown catalog ids", () => {
    const bad = { ...base, items: [{ catalog_id: "spaceship", label: "x", quantity: 1, est_cubic_yards_each: 1, confidence: 1 }] };
    expect(visionResultSchema.safeParse(bad).success).toBe(false);
  });
});
