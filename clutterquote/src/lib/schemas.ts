import { z } from "zod";
import { ZIP_PATTERN } from "./serviceArea";

export const MAX_PHOTOS = 5;
/** Decoded bytes per photo. The widget downsizes to ~1600px JPEG, well under this. */
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export const analyzeRequest = z.object({
  images: z
    .array(
      z.object({
        mime: z.enum(PHOTO_MIMES),
        // base64 length ≈ 4/3 × bytes
        base64: z.string().min(100).max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3)),
      }),
    )
    .min(1)
    .max(MAX_PHOTOS),
});

const catalogLine = z.object({
  kind: z.literal("catalog"),
  catalogId: z.string().max(64),
  quantity: z.number().min(0).max(500),
});

const customLine = z.object({
  kind: z.literal("custom"),
  label: z.string().min(1).max(80),
  quantity: z.number().int().min(0).max(200),
  yd3Each: z.number().min(0).max(10),
  lbsEach: z.number().min(0).max(5000),
});

export const accessSchema = z.object({
  stairsFlights: z.number().int().min(0).max(10),
  basement: z.boolean(),
  longCarry: z.boolean(),
  curbside: z.boolean(),
});

export const quoteRequest = z
  .object({
    zip: z.string().regex(ZIP_PATTERN, "Enter a 5-digit ZIP code"),
    method: z.enum(["inventory", "photos"]),
    lines: z.array(z.discriminatedUnion("kind", [catalogLine, customLine])).max(200).default([]),
    /** Photo mode: the analysis the quote is based on. */
    analysisId: z.uuid().optional(),
    access: accessSchema,
  })
  .refine((q) => q.method === "inventory" || q.analysisId, { message: "analysisId is required for photo quotes", path: ["analysisId"] });

export const bookingRequest = z.object({
  quoteId: z.uuid(),
  slotKey: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  customer: z.object({
    name: z.string().trim().min(2).max(100),
    email: z.email().max(200),
    phone: z
      .string()
      .trim()
      .min(7)
      .max(30)
      .regex(/^[\d\s()+.-]+$/, "Enter a valid phone number"),
    address: z.string().trim().min(5).max(200),
    notes: z.string().trim().max(1000).optional(),
  }),
});

export type QuoteRequest = z.infer<typeof quoteRequest>;
export type BookingRequest = z.infer<typeof bookingRequest>;
