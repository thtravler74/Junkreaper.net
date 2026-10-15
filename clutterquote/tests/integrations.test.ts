import { describe, expect, it, vi } from "vitest";
import { bookingsToIcs } from "@/lib/integrations/ical";
import { dispatchWebhook, signPayload, verifySignature } from "@/lib/integrations/webhooks";
import { demoTenant } from "@/lib/tenants/defaults";
import type { BookingRecord } from "@/lib/types";

describe("webhook signatures", () => {
  it("round-trips and rejects tampering or stale timestamps", () => {
    const header = signPayload("s3cret", '{"a":1}', 1_000);
    expect(verifySignature("s3cret", '{"a":1}', header, 1_100)).toBe(true);
    expect(verifySignature("s3cret", '{"a":2}', header, 1_100)).toBe(false);
    expect(verifySignature("other", '{"a":1}', header, 1_100)).toBe(false);
    expect(verifySignature("s3cret", '{"a":1}', header, 2_000)).toBe(false);
  });

  it("retries 5xx, stops on 4xx, and only sends subscribed events", async () => {
    const tenant = demoTenant();
    tenant.integrations.webhooks = [
      { id: "a", url: "https://a.test", secret: "x", events: ["booking.confirmed"] },
      { id: "b", url: "https://b.test", secret: "x", events: ["booking.confirmed"] },
      { id: "c", url: "https://c.test", secret: "x", events: ["quote.created"] },
    ];
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response("", { status: String(url).includes("a.test") ? 503 : 400 });
    }) as unknown as typeof fetch;
    const results = await dispatchWebhook(tenant, "booking.confirmed", {}, fetchImpl, async () => {});
    expect(results.map((r) => [r.endpointId, r.attempts])).toEqual([["a", 3], ["b", 1]]);
    expect(calls.filter((u) => u.includes("c.test"))).toHaveLength(0);
  });
});

describe("iCal feed", () => {
  it("emits confirmed bookings only, with escaped text and CRLF line endings", () => {
    const base: BookingRecord = {
      id: "11111111-1111-1111-1111-111111111111",
      tenantId: "t",
      quoteId: "q",
      status: "confirmed",
      slotKey: "2026-10-16T08:00",
      windowStart: "2026-10-16T12:00:00.000Z",
      windowEnd: "2026-10-16T14:00:00.000Z",
      customer: { name: "Pat, Jr.", email: "p@x.com", phone: "1", address: "1 Main St; Apt 2" },
      depositCents: 0,
      platformFeeCents: 0,
      createdAt: "2026-10-15T00:00:00.000Z",
    };
    const ics = bookingsToIcs(demoTenant(), [base, { ...base, id: "2", status: "cancelled" }], "https://app");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART:20261016T120000Z");
    expect(ics).toContain("SUMMARY:Junk pickup – Pat\\, Jr.");
    expect(ics).toContain(String.raw`LOCATION:1 Main St\; Apt 2`);
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});
