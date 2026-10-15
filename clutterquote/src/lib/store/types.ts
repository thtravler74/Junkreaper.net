import type { BookingRecord, BookingStatus, PhotoAnalysisRecord, QuoteRecord, Tenant } from "../types";

export interface Store {
  getTenantBySlug(slug: string): Promise<Tenant | null>;
  getTenantById(id: string): Promise<Tenant | null>;
  findTenantByStripeAccount(accountId: string): Promise<Tenant | null>;
  updateTenant(id: string, patch: Partial<Omit<Tenant, "id">>): Promise<Tenant>;

  savePhoto(key: string, data: Buffer, mime: string): Promise<void>;
  readPhoto(key: string): Promise<{ data: Buffer; mime: string } | null>;

  saveAnalysis(record: PhotoAnalysisRecord): Promise<void>;
  getAnalysis(id: string): Promise<PhotoAnalysisRecord | null>;

  saveQuote(record: QuoteRecord): Promise<void>;
  getQuote(id: string): Promise<QuoteRecord | null>;
  listQuotes(tenantId: string, limit: number): Promise<QuoteRecord[]>;

  /**
   * Atomically insert `booking` only if its slot still has capacity: fewer than
   * `capacity` bookings in that slot are confirmed or hold a live payment hold.
   * Returns false when the slot filled in the meantime.
   */
  createBookingIfAvailable(booking: BookingRecord, capacity: number, now: Date): Promise<boolean>;
  getBooking(id: string): Promise<BookingRecord | null>;
  getBookingByCheckoutSession(sessionId: string): Promise<BookingRecord | null>;
  updateBooking(id: string, patch: Partial<BookingRecord>): Promise<BookingRecord>;
  /**
   * Compare-and-set on status: apply `patch` only if the booking is currently in
   * `from`. Returns the updated booking, or null if another caller got there first.
   * This is what makes confirmation idempotent across the webhook and the
   * success-page fallback.
   */
  transitionBooking(id: string, from: BookingStatus, patch: Partial<BookingRecord>): Promise<BookingRecord | null>;
  /** Bookings whose window starts within [fromIso, toIso). */
  listBookings(tenantId: string, fromIso: string, toIso: string): Promise<BookingRecord[]>;
}
