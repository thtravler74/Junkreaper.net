# ClutterQuote

Instant estimating, volume calculation and booking for junk removal businesses.
Haulers drop one `<script>` tag on their site. A customer uploads photos of their
junk (or ticks items off a visual checklist) and sees a price range and a truckload
size on the spot. They then book an arrival window and pay a deposit, all within
about a minute.

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · OpenAI vision ·
Supabase (Postgres + Auth + Storage) · Stripe Connect · Google Calendar / iCal ·
signed CRM webhooks.

```bash
cd clutterquote
npm install
npm run dev            # http://localhost:3000 — demo widget on the home page, ZIP 43215
npm test               # unit tests (pricing, vision reconciliation, scheduling, service area)
npm run build && npm run test:e2e   # drives the real app in Chromium (see below)
```

With no environment variables set, everything still runs. Data goes to `.data/`,
photo analysis returns clearly labelled demo output, bookings confirm with no
deposit, and the owner dashboard (`/dashboard/demo`) is open. Copy `.env.example`
to `.env.local` to turn each integration on.

---

## The customer funnel

```
ZIP check ──► describe the load ──────────────► estimate ──────────► book
 service       📷 photos → AI → editable list    access options      slot + contact
 radius /      ☑️ catalog checklist              live breakdown      Stripe deposit
 trip fee      (live price in the footer)        server-issued quote → confirmed
```

* **Live price everywhere.** The pricing engine is a pure module that runs in the
  browser as items are toggled. When the customer clicks *Book*, the server
  recomputes the quote from scratch and stores it. Bookings reference that stored
  quote, so a tampered client cannot book at a made-up price.
* **Photos stay editable.** The vision output is mapped onto catalog items, shown
  as "Here's what we spotted", and the customer can correct quantities before
  pricing.

## The volume and pricing model (`src/lib/pricing/engine.ts`)

1. **Volume → truck fraction → billed fraction.** Volume is summed in *loaded*
   cubic yards from the item catalog (`src/lib/catalog.ts`, ~60 items with
   calibrated yd³, lb and surcharge class). It is divided by the truck capacity
   (default 15 yd³) and rounded **up** to the billing increment (1/8 truck). The
   result is priced on the tenant's piecewise-linear price curve. Loads over one
   truck bill whole trucks plus the remainder on the curve.
2. **Weight past an allowance.** The allowance scales with the billed fraction
   (default 3,000 lb per full truck). The excess is billed per ton, the way the
   transfer station bills the hauler. This is what prices concrete, dirt and
   shingles correctly. Loads over the truck's payload are flagged as multi-trip.
3. **Itemized adjustments.** These cover disposal surcharges (mattress recycling,
   Freon recovery, e-waste, CRT, tires, hot tub, piano), access fees (stairs per
   flight, basement, long carry), the extended-area trip fee, and a curbside
   discount. Curbside suppresses the access fees and warns the customer that it
   did.
4. **A range, not a point.** Checklists are skewed high (−5% / +20%) because
   customers forget things. Photo estimates are symmetric. Their spread starts at
   ±15% and widens with model uncertainty, capped at ±40%. Prices are then rounded
   to $5 and the minimum charge is applied.

It also outputs an estimated on-site time, used to size calendar events. Every
number is in the tenant's `PricingConfig`; `src/lib/tenants/defaults.ts` holds
editable starting values.

## The vision pipeline (`src/lib/vision/`)

* **One request per job.** All photos go to the model together, so it can
  deduplicate an item seen from two angles. This is the biggest single source of
  over-quoting.
* **Structured Outputs.** The model runs in strict JSON-schema mode, and **the
  catalog ids are an enum**. The model has to map what it sees onto items whose
  volumes we control. Anything it can't map comes back as `other` with its own
  size, clamped. Loose clutter and dense debris come back as separate figures.
  The response keeps the contract fields from the spec: `detected_items`,
  `estimated_cubic_yards`, `truck_fraction`, `dense_materials_detected` and
  `special_handling_required`.
* **Prompt.** The prompt gives the model scale references (80″ doors, 8′
  ceilings, 0.16 yd³ trash bags, 2.5 yd³ pickup beds), a pile formula
  (L×W×H ÷ 27 × 0.7 packing), the rule to ignore built-ins and vehicles, and
  checks for prohibited materials and photo quality.
* **Reconciliation** (`reconcile.ts`). Itemized volume uses our catalog
  numbers. The model's holistic estimate is a cross-check: when it is larger,
  half the gap is added as loose volume, since missed items are the usual
  failure. Disagreement, low confidence and photo-quality issues widen the price
  range rather than move it. Dense debris maps onto the per-yard catalog
  materials, so it carries the right weight.
* **Validation and fallback.** zod validates ranges after the model call, since
  strict mode guarantees shape but not bounds. Photos are downscaled in the
  browser (1600 px JPEG), magic-byte checked on the server, rate-limited per IP,
  and stored privately for the owner to review.

## Booking, deposits, integrations

* **Slots** (`availability.ts`, `time.ts`): arrival windows in the tenant's IANA
  timezone (DST-correct with no date library), lead time, horizon, work days,
  blackout dates and crews per window. A linked Google Calendar can block busy
  windows.
* **Capacity under concurrency:** `create_booking_if_available` takes a
  per-slot advisory lock in Postgres, and the file store serializes access. The
  e2e test fires three simultaneous bookings at a two-crew window: two succeed
  and one gets a 409.
* **Deposits:** Stripe Checkout runs as a Connect **destination charge**
  (`transfer_data.destination` + `on_behalf_of`), with the platform fee as
  `application_fee_amount` (`PLATFORM_FEE_BPS`). The slot is held for 35 minutes
  while Checkout lives for 31. The webhook and the success page both confirm
  through a compare-and-set, so side effects run exactly once. Cancelling or
  expiring Checkout releases the hold. Haulers onboard via Express
  (`/api/stripe/connect`). Inside the iframe, the host script performs the
  top-level redirect, because Checkout can't be framed.
* **CRM webhooks:** `quote.created`, `booking.confirmed` and `booking.cancelled`.
  Each has a flat, Zapier-friendly payload, a Stripe-style
  `X-ClutterQuote-Signature: t=…,v1=HMAC-SHA256`, and retries on 5xx/429.
  Workiz, Housecall Pro and Jobber don't ingest arbitrary webhooks natively;
  connect them through Zapier or Make.
* **Calendars:** confirmed jobs are inserted into Google Calendar (OAuth, one
  refresh token per tenant, deterministic event ids so retries don't duplicate).
  Every tenant also gets a private iCal feed URL.
* **Side effects** run in `after()`, so a slow CRM never delays the customer.

## Embedding

```html
<script src="https://YOUR-HOST/widget.js" data-tenant="your-slug" async></script>
```

The loader creates an iframe of `/embed/<slug>` and auto-sizes it from
`postMessage`. It only navigates the host page to `https://checkout.stripe.com/`.
It also re-emits funnel steps as `window` `clutterquote` events for analytics.
`src/proxy.ts` sets `frame-ancestors` per tenant (`allowedOrigins`; empty means
any https origin), and every other route sends `X-Frame-Options: DENY`.

## Multi-tenancy and security

* Tenants are keyed by slug. Pricing, area, scheduling and deposit policy are
  per tenant. Credentials live in `tenant_integrations`, which has no RLS policy
  and is never serialized to the browser (`publicConfig`).
* Owners sign in with a Supabase magic link. Access requires the signed-in email
  to be in `tenant.ownerEmails` (checked with `getUser()`, which revalidates the
  JWT). RLS also restricts direct reads to owners.
* Customers need no account. Booking ids are random UUIDs, and the status
  endpoint returns no personal data.

## Deploying

1. Create a Supabase project and run `supabase/migrations/0001_init.sql`. Insert
   your first tenant: the JSON columns take the shapes in
   `src/lib/tenants/defaults.ts`, and add a `tenant_integrations` row with an
   `icalToken`.
2. Deploy `clutterquote/` to Vercel (or any Node host) with the env vars from
   `.env.example`. The file store refuses to run in production unless
   `ALLOW_FILE_STORE=1`.
3. In Stripe, enable Connect. Add a webhook endpoint at
   `$APP_URL/api/stripe/webhook` for `checkout.session.*`, and a Connect endpoint
   for `account.updated`.
4. Optional: create a Google OAuth client with redirect URI
   `$APP_URL/api/integrations/google/callback`.

## Known gaps

* The rate limiter is in-memory, per instance. Use Redis or Upstash for a global
  limit on serverless. It keys on `x-forwarded-for`, which is trustworthy only
  behind a proxy that overwrites it (Vercel does).
* ZIP geocoding uses the free Zippopotam.us API with an in-process cache. Bundle
  a ZIP-centroid dataset for production volume. If geocoding fails, the customer
  can continue ("unverified") instead of being blocked.
* There's no UI yet for editing pricing, service area or webhooks; they are
  edited in the database. There's also no cancel/reschedule flow (the
  `booking.cancelled` event is defined but not yet emitted) and no SMS
  notifications.
* The Supabase store, Stripe and Google paths are typechecked but have not been
  run against live accounts in this repo's tests. The e2e suite covers the file
  store, mock vision and the no-deposit path.
