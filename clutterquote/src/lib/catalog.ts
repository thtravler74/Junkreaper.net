/**
 * The item catalog: one source of truth for loaded volume, weight and per-item
 * disposal surcharges. It drives the inventory checklist, constrains the vision
 * model's output (catalog ids are an enum in its JSON schema), and prices both.
 *
 * Volumes are LOADED cubic yards: the space an item takes up in a box truck once
 * stacked, including the dead air around awkward shapes. That is larger than the
 * item's geometric volume (a queen mattress is ~0.8 yd³ of foam, but it occupies a
 * full yard standing on edge). 1 yd³ = 27 ft³.
 *
 * Weights are typical pounds; they only matter for dense loads, where a truck runs
 * out of payload (and the transfer station bills by the ton) long before it runs
 * out of space.
 */

export type CategoryId =
  | "furniture"
  | "mattresses"
  | "appliances"
  | "electronics"
  | "outdoor"
  | "heavy_debris"
  | "household";

export interface Category {
  id: CategoryId;
  label: string;
  icon: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: "furniture", label: "Furniture", icon: "🛋️" },
  { id: "mattresses", label: "Mattresses", icon: "🛏️" },
  { id: "appliances", label: "Appliances", icon: "🧊" },
  { id: "electronics", label: "Electronics", icon: "📺" },
  { id: "outdoor", label: "Outdoor & Yard", icon: "🌳" },
  { id: "heavy_debris", label: "Heavy Debris", icon: "🧱" },
  { id: "household", label: "Bags & Boxes", icon: "📦" },
];

/** Surcharge keys a tenant prices in PricingConfig.itemSurcharges. */
export type SurchargeKey =
  | "mattress_recycling"
  | "freon_recovery"
  | "e_waste"
  | "crt_e_waste"
  | "tire"
  | "tire_on_rim"
  | "hot_tub_demo"
  | "piano"
  | "heavy_item";

export type HandlingFlag = "heavy_lifting" | "disassembly" | "freon" | "e_waste" | "two_person";

export interface CatalogItem {
  id: string;
  category: CategoryId;
  label: string;
  /** Loaded cubic yards per unit. */
  yd3: number;
  /** Pounds per unit. */
  lbs: number;
  /** "each" for discrete items, "cubic_yard" for loose material priced by volume. */
  unit: "each" | "cubic_yard";
  surcharge?: SurchargeKey;
  handling?: HandlingFlag[];
  /** Material is dense enough that weight, not space, sets the price. */
  dense?: boolean;
}

export const CATALOG: readonly CatalogItem[] = [
  // Furniture
  { id: "sofa_3_seat", category: "furniture", label: "Sofa (3-seat)", yd3: 2.5, lbs: 150 },
  { id: "loveseat", category: "furniture", label: "Loveseat", yd3: 1.75, lbs: 100 },
  { id: "sectional", category: "furniture", label: "Sectional sofa", yd3: 4.5, lbs: 300, handling: ["two_person"] },
  { id: "sleeper_sofa", category: "furniture", label: "Sleeper sofa", yd3: 2.75, lbs: 250, handling: ["heavy_lifting"] },
  { id: "recliner", category: "furniture", label: "Recliner / armchair", yd3: 1.25, lbs: 80 },
  { id: "coffee_table", category: "furniture", label: "Coffee / end table", yd3: 0.5, lbs: 40 },
  { id: "dining_table", category: "furniture", label: "Dining table", yd3: 1.5, lbs: 120, handling: ["disassembly"] },
  { id: "dining_chair", category: "furniture", label: "Dining chair", yd3: 0.3, lbs: 15 },
  { id: "dresser", category: "furniture", label: "Dresser", yd3: 1.25, lbs: 150 },
  { id: "nightstand", category: "furniture", label: "Nightstand", yd3: 0.33, lbs: 30 },
  { id: "bed_frame", category: "furniture", label: "Bed frame / headboard", yd3: 1.0, lbs: 80, handling: ["disassembly"] },
  { id: "bookshelf", category: "furniture", label: "Bookshelf", yd3: 0.75, lbs: 60 },
  { id: "desk", category: "furniture", label: "Desk", yd3: 1.25, lbs: 120 },
  { id: "office_chair", category: "furniture", label: "Office chair", yd3: 0.4, lbs: 35 },
  { id: "entertainment_center", category: "furniture", label: "Entertainment center", yd3: 2.0, lbs: 200, handling: ["heavy_lifting"] },
  { id: "armoire", category: "furniture", label: "Armoire / wardrobe", yd3: 2.0, lbs: 200, handling: ["heavy_lifting"] },
  { id: "piano_upright", category: "furniture", label: "Upright piano", yd3: 2.0, lbs: 500, surcharge: "piano", handling: ["heavy_lifting", "two_person"] },
  { id: "safe", category: "furniture", label: "Safe (small/medium)", yd3: 0.5, lbs: 300, surcharge: "heavy_item", handling: ["heavy_lifting"] },

  // Mattresses — most states run mattress stewardship programs; recyclers charge per piece.
  { id: "mattress_twin", category: "mattresses", label: "Mattress (twin/full)", yd3: 0.75, lbs: 50, surcharge: "mattress_recycling" },
  { id: "mattress_queen_king", category: "mattresses", label: "Mattress (queen/king)", yd3: 1.0, lbs: 80, surcharge: "mattress_recycling" },
  { id: "box_spring", category: "mattresses", label: "Box spring", yd3: 0.75, lbs: 40, surcharge: "mattress_recycling" },

  // Appliances — refrigerant-bearing units need EPA Section 608 recovery before scrapping.
  { id: "refrigerator", category: "appliances", label: "Refrigerator", yd3: 1.75, lbs: 250, surcharge: "freon_recovery", handling: ["freon", "two_person"] },
  { id: "freezer_chest", category: "appliances", label: "Chest freezer", yd3: 1.25, lbs: 150, surcharge: "freon_recovery", handling: ["freon"] },
  { id: "window_ac", category: "appliances", label: "Window AC / dehumidifier", yd3: 0.33, lbs: 60, surcharge: "freon_recovery", handling: ["freon"] },
  { id: "washer", category: "appliances", label: "Washer", yd3: 0.75, lbs: 170 },
  { id: "dryer", category: "appliances", label: "Dryer", yd3: 0.75, lbs: 120 },
  { id: "stove", category: "appliances", label: "Range / stove", yd3: 0.75, lbs: 150 },
  { id: "dishwasher", category: "appliances", label: "Dishwasher", yd3: 0.5, lbs: 75 },
  { id: "microwave", category: "appliances", label: "Microwave", yd3: 0.15, lbs: 35 },
  { id: "water_heater", category: "appliances", label: "Water heater", yd3: 0.75, lbs: 150, handling: ["heavy_lifting"] },

  // Electronics — e-waste must go to a certified recycler, not the landfill.
  { id: "tv_flat", category: "electronics", label: "Flat-screen TV", yd3: 0.33, lbs: 40, surcharge: "e_waste" },
  { id: "tv_crt", category: "electronics", label: "Tube (CRT) TV", yd3: 0.5, lbs: 120, surcharge: "crt_e_waste", handling: ["heavy_lifting"] },
  { id: "computer", category: "electronics", label: "Computer / monitor", yd3: 0.15, lbs: 25, surcharge: "e_waste" },
  { id: "printer", category: "electronics", label: "Printer / small electronics", yd3: 0.15, lbs: 20, surcharge: "e_waste" },

  // Outdoor & yard
  { id: "grill", category: "outdoor", label: "Grill (propane tank removed)", yd3: 0.75, lbs: 100 },
  { id: "patio_set", category: "outdoor", label: "Patio table + chairs", yd3: 2.0, lbs: 100 },
  { id: "lawn_mower", category: "outdoor", label: "Lawn mower (drained)", yd3: 0.5, lbs: 80 },
  { id: "bicycle", category: "outdoor", label: "Bicycle", yd3: 0.5, lbs: 30 },
  { id: "trampoline", category: "outdoor", label: "Trampoline", yd3: 2.5, lbs: 150, handling: ["disassembly"] },
  { id: "swing_set", category: "outdoor", label: "Swing set / playset", yd3: 3.5, lbs: 300, handling: ["disassembly"] },
  { id: "hot_tub", category: "outdoor", label: "Hot tub", yd3: 8.0, lbs: 800, surcharge: "hot_tub_demo", handling: ["disassembly", "heavy_lifting"] },
  { id: "shed_small", category: "outdoor", label: "Small shed (disassembled)", yd3: 5.0, lbs: 600, handling: ["disassembly"] },
  { id: "yard_waste", category: "outdoor", label: "Branches / yard waste (per cu yd)", yd3: 1.0, lbs: 250, unit: "cubic_yard" },
  { id: "tire", category: "outdoor", label: "Tire", yd3: 0.15, lbs: 25, surcharge: "tire" },
  { id: "tire_rim", category: "outdoor", label: "Tire on rim", yd3: 0.15, lbs: 45, surcharge: "tire_on_rim" },

  // Heavy debris (per loose cubic yard). Densities are for broken, loosely loaded material.
  { id: "concrete", category: "heavy_debris", label: "Concrete / pavers (per cu yd)", yd3: 1.0, lbs: 2400, unit: "cubic_yard", dense: true },
  { id: "dirt_sod", category: "heavy_debris", label: "Dirt / sod (per cu yd)", yd3: 1.0, lbs: 2200, unit: "cubic_yard", dense: true },
  { id: "brick_block", category: "heavy_debris", label: "Brick / block (per cu yd)", yd3: 1.0, lbs: 2000, unit: "cubic_yard", dense: true },
  { id: "rock_gravel", category: "heavy_debris", label: "Rock / gravel (per cu yd)", yd3: 1.0, lbs: 2600, unit: "cubic_yard", dense: true },
  { id: "tile", category: "heavy_debris", label: "Tile / stone (per cu yd)", yd3: 1.0, lbs: 1500, unit: "cubic_yard", dense: true },
  { id: "roof_shingles", category: "heavy_debris", label: "Roofing shingles (per cu yd)", yd3: 1.0, lbs: 600, unit: "cubic_yard", dense: true },
  { id: "drywall_plaster", category: "heavy_debris", label: "Drywall / plaster (per cu yd)", yd3: 1.0, lbs: 500, unit: "cubic_yard" },
  { id: "lumber", category: "heavy_debris", label: "Lumber / construction debris (per cu yd)", yd3: 1.0, lbs: 350, unit: "cubic_yard" },

  // Household
  { id: "trash_bag", category: "household", label: "Trash bag (33 gal)", yd3: 0.16, lbs: 20 },
  { id: "box_medium", category: "household", label: "Moving box (medium)", yd3: 0.11, lbs: 20 },
  { id: "box_large", category: "household", label: "Moving box (large) / tote", yd3: 0.2, lbs: 30 },
  { id: "rug", category: "household", label: "Rug / carpet roll", yd3: 0.5, lbs: 40 },
  { id: "exercise_equipment", category: "household", label: "Treadmill / exercise machine", yd3: 1.5, lbs: 250, handling: ["heavy_lifting", "disassembly"] },
  { id: "misc_small", category: "household", label: "Small misc. item (lamp, toy, decor)", yd3: 0.1, lbs: 10 },
].map((item) => ({ unit: "each", ...item }) as CatalogItem);

const BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

export function getCatalogItem(id: string): CatalogItem | undefined {
  return BY_ID.get(id);
}

export const CATALOG_IDS = CATALOG.map((item) => item.id) as [string, ...string[]];

/** Things no hauler can legally put in a general-load truck. Shown in the widget. */
export const PROHIBITED_MATERIALS = [
  "Paint, solvents & chemicals",
  "Propane tanks & fuel",
  "Asbestos",
  "Medical / biohazard waste",
  "Car batteries & motor oil",
] as const;
