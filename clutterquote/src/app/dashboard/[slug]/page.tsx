import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { checkOwner } from "@/lib/auth";
import { googleConfigured } from "@/lib/integrations/googleCalendar";
import { getStripe } from "@/lib/payments/stripe";
import { formatUsd } from "@/lib/pricing/engine";
import { getStore } from "@/lib/store";
import type { BookingRecord, QuoteRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Dashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = getStore();
  const tenant = await store.getTenantBySlug(slug);
  if (!tenant) notFound();
  const owner = await checkOwner(tenant);
  if (!owner.ok) {
    if (owner.reason === "signed_out") redirect(`/login?next=/dashboard/${slug}`);
    return <main className="p-10 text-center">You don't have access to this business.</main>;
  }

  const now = Date.now();
  const [quotes, bookings] = await Promise.all([
    store.listQuotes(tenant.id, 50),
    store.listBookings(tenant.id, new Date(now - 30 * 86_400_000).toISOString(), new Date(now + 60 * 86_400_000).toISOString()),
  ]);
  const photoMap = new Map<string, string[]>();
  await Promise.all(
    quotes
      .filter((q) => q.analysisId)
      .slice(0, 25)
      .map(async (q) => {
        const a = await store.getAnalysis(q.analysisId!);
        if (a) photoMap.set(q.id, a.photoKeys);
      }),
  );
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const upcoming = bookings.filter((b) => b.status === "confirmed" && new Date(b.windowEnd).getTime() > now);
  const recentQuotes = quotes.filter((q) => now - new Date(q.createdAt).getTime() < 30 * 86_400_000);
  const confirmed30 = bookings.filter((b) => b.status === "confirmed" && now - new Date(b.createdAt).getTime() < 30 * 86_400_000);
  const pipeline = upcoming.reduce((sum, b) => sum + (quoteById.get(b.quoteId)?.result.highCents ?? 0), 0);

  const host = (await headers()).get("host");
  const appUrl = process.env.APP_URL || `http://${host}`;
  const tz = tenant.scheduling.timezone;
  const when = (b: BookingRecord) =>
    new Date(b.windowStart).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric" });

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      {owner.devBypass && (
        <p className="rounded-xl bg-violet-50 px-4 py-2 text-sm text-violet-800">
          Local dev mode: the dashboard has no login because Supabase Auth isn't configured. Never deploy like this.
        </p>
      )}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">ClutterQuote dashboard</div>
          <h1 className="text-3xl font-black">{tenant.name}</h1>
        </div>
        <a href={`/embed/${tenant.slug}`} target="_blank" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">
          Open my widget ↗
        </a>
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <Stat label="Quotes (30 days)" value={String(recentQuotes.length)} />
        <Stat label="Bookings (30 days)" value={String(confirmed30.length)} />
        <Stat label="Quote → booking" value={recentQuotes.length ? `${Math.round((confirmed30.length / recentQuotes.length) * 100)}%` : "—"} />
        <Stat label="Upcoming pipeline (high end)" value={formatUsd(pipeline)} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Upcoming jobs</h2>
        <Table empty="No upcoming jobs yet." headers={["When", "Customer", "Address", "Load", "Estimate", "Deposit"]}>
          {upcoming.map((b) => {
            const q = quoteById.get(b.quoteId);
            return (
              <tr key={b.id} id={b.id}>
                <td>{when(b)}</td>
                <td>
                  <div className="font-medium">{b.customer.name}</div>
                  <div className="text-xs text-slate-500">
                    {b.customer.phone} · {b.customer.email}
                  </div>
                </td>
                <td className="max-w-56">
                  {b.customer.address}
                  {b.customer.notes && <div className="text-xs text-slate-500">{b.customer.notes}</div>}
                </td>
                <td>{q ? `${q.result.truckLabel} · ~${q.result.estimatedMinutes} min` : "—"}</td>
                <td>{q ? `${formatUsd(q.result.lowCents)}–${formatUsd(q.result.highCents)}` : "—"}</td>
                <td>{b.depositCents ? formatUsd(b.depositCents) : "—"}</td>
              </tr>
            );
          })}
        </Table>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Recent quotes</h2>
        <Table empty="No quotes yet. Share your widget!" headers={["Created", "ZIP", "Method", "Load", "Range", "Photos"]}>
          {quotes.slice(0, 25).map((q: QuoteRecord) => (
            <tr key={q.id}>
              <td>{new Date(q.createdAt).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
              <td>{q.zip}</td>
              <td className="capitalize">{q.input.method}</td>
              <td>
                {q.result.truckLabel}
                <div className="text-xs text-slate-500">
                  ~{q.result.volumeYd3} yd³ · {q.result.weightLbs.toLocaleString()} lb
                </div>
              </td>
              <td>
                {formatUsd(q.result.lowCents)}–{formatUsd(q.result.highCents)}
              </td>
              <td>
                <div className="flex gap-1">
                  {(photoMap.get(q.id) ?? []).map((key) => (
                    <a key={key} href={`/api/photos/${key}`} target="_blank">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/photos/${key}`} alt="Customer photo" className="h-10 w-10 rounded object-cover" />
                    </a>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="Payments (Stripe Connect)">
          {!getStripe() ? (
            <p>Stripe isn't configured on this server (STRIPE_SECRET_KEY). Bookings are confirmed without a deposit.</p>
          ) : tenant.integrations.stripeChargesEnabled ? (
            <p>✅ Connected. Deposits go straight to your Stripe account.</p>
          ) : (
            <>
              <p>{tenant.integrations.stripeAccountId ? "Onboarding not finished yet." : "Connect Stripe to collect booking deposits."}</p>
              <a className="mt-2 inline-block rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white" href={`/api/stripe/connect?tenant=${tenant.slug}`}>
                {tenant.integrations.stripeAccountId ? "Finish Stripe setup" : "Connect Stripe"}
              </a>
            </>
          )}
        </Card>
        <Card title="Google Calendar">
          {tenant.integrations.googleCalendar ? (
            <p>✅ Connected. Confirmed jobs appear on your calendar{tenant.integrations.googleCalendar.blockOnBusy ? ", and busy times block booking windows" : ""}.</p>
          ) : googleConfigured() ? (
            <a className="inline-block rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white" href={`/api/integrations/google/start?tenant=${tenant.slug}`}>
              Connect Google Calendar
            </a>
          ) : (
            <p>Not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Use the iCal feed below instead.</p>
          )}
        </Card>
        <Card title="iCal feed (any calendar app)">
          <p className="mb-1">Subscribe to this private URL in Google, Apple or Outlook Calendar:</p>
          <code className="block break-all rounded bg-slate-100 p-2 text-xs">{`${appUrl}/api/t/${tenant.slug}/calendar.ics?token=${tenant.integrations.icalToken}`}</code>
        </Card>
        <Card title="Embed on your website">
          <code className="block break-all rounded bg-slate-100 p-2 text-xs">{`<script src="${appUrl}/widget.js" data-tenant="${tenant.slug}" async></script>`}</code>
          <p className="mt-2 text-xs text-slate-500">
            {tenant.integrations.webhooks.length} CRM webhook{tenant.integrations.webhooks.length === 1 ? "" : "s"} configured.
          </p>
        </Card>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <h3 className="mb-2 font-bold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

function Table({ headers: cols, children, empty }: { headers: string[]; children: React.ReactNode[]; empty: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_tr]:border-t [&_tr]:border-slate-100">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children.length ? (
            children
          ) : (
            <tr>
              <td colSpan={cols.length} className="py-8 text-center text-slate-500">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
