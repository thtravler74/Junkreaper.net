import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { holdsCapacity } from "../availability";
import { demoTenant } from "../tenants/defaults";
import type { BookingRecord, BookingStatus, PhotoAnalysisRecord, QuoteRecord, Tenant } from "../types";
import type { Store } from "./types";

interface Db {
  tenants: Tenant[];
  analyses: PhotoAnalysisRecord[];
  quotes: QuoteRecord[];
  bookings: BookingRecord[];
  photoMime: Record<string, string>;
}

/**
 * Single-process JSON store for local development and demos. Every operation
 * runs through one promise chain, so read-modify-write cycles (in particular the
 * capacity check in createBookingIfAvailable) are serialized. Not for production:
 * it doesn't coordinate across processes or serverless instances.
 */
export class FileStore implements Store {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly dbPath: string;
  private readonly photoDir: string;

  constructor(private readonly dir: string) {
    this.dbPath = path.join(dir, "db.json");
    this.photoDir = path.join(dir, "photos");
  }

  private run<T>(fn: (db: Db) => T | Promise<T>, write = false): Promise<T> {
    const next = this.chain.then(async () => {
      const db = await this.load();
      const out = await fn(db);
      if (write) await this.save(db);
      return out;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<Db> {
    try {
      return JSON.parse(await readFile(this.dbPath, "utf8")) as Db;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const db: Db = { tenants: [demoTenant()], analyses: [], quotes: [], bookings: [], photoMime: {} };
      await this.save(db);
      return db;
    }
  }

  private async save(db: Db): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.dbPath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, this.dbPath);
  }

  getTenantBySlug(slug: string) {
    return this.run((db) => db.tenants.find((t) => t.slug === slug) ?? null);
  }

  getTenantById(id: string) {
    return this.run((db) => db.tenants.find((t) => t.id === id) ?? null);
  }

  findTenantByStripeAccount(accountId: string) {
    return this.run((db) => db.tenants.find((t) => t.integrations.stripeAccountId === accountId) ?? null);
  }

  updateTenant(id: string, patch: Partial<Omit<Tenant, "id">>) {
    return this.run((db) => {
      const i = db.tenants.findIndex((t) => t.id === id);
      if (i < 0) throw new Error(`tenant ${id} not found`);
      db.tenants[i] = { ...db.tenants[i]!, ...patch };
      return db.tenants[i]!;
    }, true);
  }

  async savePhoto(key: string, data: Buffer, mime: string) {
    const file = this.photoPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    await this.run((db) => {
      db.photoMime[key] = mime;
    }, true);
  }

  async readPhoto(key: string) {
    const mime = await this.run((db) => db.photoMime[key]);
    if (!mime) return null;
    return { data: await readFile(this.photoPath(key)), mime };
  }

  private photoPath(key: string): string {
    // Keys are server-generated (uuid/index), but never let one escape the directory.
    const file = path.resolve(this.photoDir, key);
    if (!file.startsWith(path.resolve(this.photoDir) + path.sep)) throw new Error("invalid photo key");
    return file;
  }

  saveAnalysis(record: PhotoAnalysisRecord) {
    return this.run((db) => void db.analyses.push(record), true);
  }

  getAnalysis(id: string) {
    return this.run((db) => db.analyses.find((a) => a.id === id) ?? null);
  }

  saveQuote(record: QuoteRecord) {
    return this.run((db) => void db.quotes.push(record), true);
  }

  getQuote(id: string) {
    return this.run((db) => db.quotes.find((q) => q.id === id) ?? null);
  }

  listQuotes(tenantId: string, limit: number) {
    return this.run((db) =>
      db.quotes
        .filter((q) => q.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
    );
  }

  createBookingIfAvailable(booking: BookingRecord, capacity: number, now: Date) {
    return this.run((db) => {
      const taken = db.bookings.filter(
        (b) => b.tenantId === booking.tenantId && b.slotKey === booking.slotKey && holdsCapacity(b, now),
      ).length;
      if (taken >= capacity) return false;
      db.bookings.push(booking);
      return true;
    }, true);
  }

  getBooking(id: string) {
    return this.run((db) => db.bookings.find((b) => b.id === id) ?? null);
  }

  getBookingByCheckoutSession(sessionId: string) {
    return this.run((db) => db.bookings.find((b) => b.checkoutSessionId === sessionId) ?? null);
  }

  updateBooking(id: string, patch: Partial<BookingRecord>) {
    return this.run((db) => {
      const i = db.bookings.findIndex((b) => b.id === id);
      if (i < 0) throw new Error(`booking ${id} not found`);
      db.bookings[i] = { ...db.bookings[i]!, ...patch };
      return db.bookings[i]!;
    }, true);
  }

  transitionBooking(id: string, from: BookingStatus, patch: Partial<BookingRecord>) {
    return this.run((db) => {
      const i = db.bookings.findIndex((b) => b.id === id && b.status === from);
      if (i < 0) return null;
      db.bookings[i] = { ...db.bookings[i]!, ...patch };
      return db.bookings[i]!;
    }, true);
  }

  listBookings(tenantId: string, fromIso: string, toIso: string) {
    return this.run((db) =>
      db.bookings
        .filter((b) => b.tenantId === tenantId && b.windowStart >= fromIso && b.windowStart < toIso)
        .sort((a, b) => a.windowStart.localeCompare(b.windowStart)),
    );
  }
}
