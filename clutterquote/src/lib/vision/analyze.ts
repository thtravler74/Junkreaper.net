import "server-only";
import { VISION_SYSTEM_PROMPT, visionJsonSchema, visionResultSchema, type VisionResult } from "./schema";

export interface VisionImage {
  /** "image/jpeg" | "image/png" | "image/webp" */
  mime: string;
  base64: string;
}

export interface VisionOutcome {
  provider: "openai" | "mock";
  model: string;
  result: VisionResult;
}

export class VisionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 60_000;

/**
 * Analyze 1–5 photos in a single request. Sending every photo together (rather
 * than one call per photo) is what lets the model deduplicate an item that shows
 * up in two shots, which is the biggest single source of over-quoting.
 *
 * Without OPENAI_API_KEY, returns a fixed demo detection so the whole funnel can
 * be exercised locally. The UI labels those results as demo output.
 */
export async function analyzePhotos(images: VisionImage[]): Promise<VisionOutcome> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { provider: "mock", model: "mock", result: mockResult(images.length) };

  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o";
  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: VISION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${images.length} photo(s) of one junk removal job follow. Itemize and estimate the whole load.`,
          },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: "high" },
          })),
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "junk_load_estimate", strict: true, schema: visionJsonSchema() },
    },
  };

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new VisionError(`Vision request failed: ${(err as Error).message}`, true);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // 429 and 5xx are worth a retry from the client; 4xx otherwise means our request is wrong.
    throw new VisionError(
      `Vision API returned ${response.status}: ${detail.slice(0, 300)}`,
      response.status === 429 || response.status >= 500,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  };
  const message = payload.choices?.[0]?.message;
  if (message?.refusal) throw new VisionError(`The model declined to analyze these photos: ${message.refusal}`, false);
  if (!message?.content) throw new VisionError("Vision API returned no content", true);

  let parsed: unknown;
  try {
    parsed = JSON.parse(message.content);
  } catch {
    throw new VisionError("Vision API returned malformed JSON", true);
  }
  // Strict mode guarantees shape, not ranges: zod enforces the bounds.
  const validated = visionResultSchema.safeParse(parsed);
  if (!validated.success) throw new VisionError(`Vision output failed validation: ${validated.error.message}`, true);
  return { provider: "openai", model, result: validated.data };
}

function mockResult(photoCount: number): VisionResult {
  return {
    items: [
      { catalog_id: "sofa_3_seat", label: "3-seat sofa", quantity: 1, est_cubic_yards_each: 2.5, confidence: 0.9 },
      { catalog_id: "coffee_table", label: "Wooden coffee table", quantity: 1, est_cubic_yards_each: 0.5, confidence: 0.85 },
      { catalog_id: "box_medium", label: "Cardboard boxes", quantity: 4, est_cubic_yards_each: 0.11, confidence: 0.8 },
      { catalog_id: "mattress_queen_king", label: "Queen mattress", quantity: 1, est_cubic_yards_each: 1, confidence: 0.75 },
    ],
    detected_items: ["3-seat sofa", "wooden coffee table", "4 cardboard boxes", "queen mattress"],
    loose_debris_cubic_yards: 0.5,
    dense_debris_cubic_yards: 0,
    dense_materials: [],
    estimated_cubic_yards: 5,
    truck_fraction: "0.33",
    dense_materials_detected: false,
    special_handling_required: ["heavy_lifting"],
    prohibited_items_suspected: [],
    overall_confidence: photoCount > 1 ? 0.8 : 0.7,
    photo_quality_issues: [],
  };
}
