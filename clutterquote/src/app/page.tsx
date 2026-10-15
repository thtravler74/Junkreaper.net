import { QuoteWidget } from "@/components/widget/QuoteWidget";
import { publicConfig } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: "📸", title: "Photo or checklist", body: "Customers snap up to 5 photos or tap items off a visual inventory. Whichever is easier for them." },
  { icon: "🧠", title: "AI volume engine", body: "Vision AI itemizes the pile, maps it to calibrated item volumes, and cross-checks a whole-scene estimate." },
  { icon: "🚛", title: "Truckload pricing", body: "Your price curve, billed in 1/8-truck steps, with weight-based pricing for concrete, dirt and shingles." },
  { icon: "🧾", title: "Transparent fees", body: "Stairs, basement, long carry, mattress & Freon surcharges and curbside discounts, itemized live." },
  { icon: "📅", title: "Book + deposit", body: "Real arrival windows with crew capacity, Stripe Connect deposits, and Google Calendar sync." },
  { icon: "🔌", title: "Plugs into your CRM", body: "Signed webhooks (Workiz, Housecall Pro, Jobber via Zapier) and an iCal feed for dispatch." },
];

export default async function Home() {
  const demo = await getStore().getTenantBySlug("demo");
  return (
    <main>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[1fr_minmax(0,560px)] lg:py-20">
        <div className="space-y-6 lg:pt-10">
          <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">For junk removal & hauling companies</span>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
            Turn website visitors into booked jobs in <span className="text-emerald-600">60 seconds</span>.
          </h1>
          <p className="text-lg text-slate-600">
            ClutterQuote is an instant-estimate widget for your site. Customers upload photos of their junk, see a real price range
            and truckload size on the spot, then book an arrival window with a deposit. No callbacks, no on-site estimates for small jobs.
          </p>
          <div className="rounded-2xl bg-slate-900 p-4 font-mono text-xs text-emerald-300 sm:text-sm">
            <div className="mb-1 text-slate-400">{"<!-- Paste on any page of your site -->"}</div>
            {'<script src="https://YOUR-HOST/widget.js" data-tenant="your-business" async></script>'}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-2xl">{f.icon}</div>
                <div className="mt-1 font-semibold text-slate-900">{f.title}</div>
                <p className="text-sm text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-3 text-center text-sm font-medium text-slate-500">Live demo · try ZIP 43215</div>
          {demo ? <QuoteWidget config={publicConfig(demo)} /> : <p className="text-center text-slate-500">Demo tenant not found.</p>}
        </div>
      </section>
    </main>
  );
}
