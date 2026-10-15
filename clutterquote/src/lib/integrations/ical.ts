import type { BookingRecord, Tenant } from "../types";

/** RFC 5545 text escaping. */
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Fold lines to 75 octets as the spec requires (approximated by characters). */
function fold(line: string): string {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 74) out.push((i ? " " : "") + line.slice(i, i + 74));
  return out.join("\r\n");
}

/** Read-only feed of confirmed jobs; subscribe from Google, Apple or Outlook calendars. */
export function bookingsToIcs(tenant: Tenant, bookings: BookingRecord[], appUrl: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ClutterQuote//Bookings//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(`${tenant.name} – ClutterQuote jobs`)}`,
  ];
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.id}@clutterquote`,
      `DTSTAMP:${stamp(b.confirmedAt ?? b.createdAt)}`,
      `DTSTART:${stamp(b.windowStart)}`,
      `DTEND:${stamp(b.windowEnd)}`,
      `SUMMARY:${esc(`Junk pickup – ${b.customer.name}`)}`,
      `LOCATION:${esc(b.customer.address)}`,
      `DESCRIPTION:${esc(`${b.customer.phone} · ${b.customer.email}${b.customer.notes ? `\n${b.customer.notes}` : ""}\n${appUrl}/dashboard/${tenant.slug}`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
