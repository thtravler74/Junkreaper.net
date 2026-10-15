import type { QuoteLine, QuoteResult } from "@/lib/types";
import type { ServiceAreaResult } from "@/lib/serviceArea";
import type { Slot } from "@/lib/availability";

export interface AnalyzeResponse {
  analysisId: string;
  provider: "openai" | "mock";
  lines: QuoteLine[];
  looseYd3: number;
  looseLbs: number;
  uncertainty: number;
  notes: string[];
  detected_items: string[];
  estimated_cubic_yards: number;
  truck_fraction: string;
  dense_materials_detected: boolean;
  special_handling_required: string[];
  prohibited_items_suspected: string[];
  photo_quality_issues: string[];
  overall_confidence: number;
}

export interface QuoteResponse {
  quoteId: string;
  expiresAt: string;
  result: QuoteResult;
  serviceArea: ServiceAreaResult;
  depositCents: number;
}

export interface SlotsResponse {
  timezone: string;
  slots: Slot[];
}

export interface BookingResponse {
  bookingId: string;
  status: "pending_payment" | "confirmed";
  depositCents: number;
  checkoutUrl: string | null;
}
