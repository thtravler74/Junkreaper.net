#!/usr/bin/env node
/**
 * End-to-end smoke test against a production build.
 *
 *   npm run build && npm run test:e2e
 *
 * Boots `next start` on a throwaway data dir (file store, mock vision, no Stripe),
 * then drives Chromium through both quote funnels, checks the capacity guard, a
 * signed CRM webhook, the owner dashboard, and the cross-origin embed. Screenshots
 * land in test-results/.
 */
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PORT = 3100;
const HOST_PORT = 3201;
const HOOK_PORT = 3202;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve("test-results");
const dataDir = await mkdtemp(path.join(tmpdir(), "cq-e2e-"));
await mkdir(OUT, { recursive: true });

let failures = 0;
function check(cond, label) {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
  if (!cond) failures++;
}

// ── a webhook receiver that verifies signatures ──────────────────────────────
const received = [];
const hookServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const header = req.headers["x-clutterquote-signature"] ?? "";
    const { t, v1 } = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));
    const expected = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    received.push({ valid: expected === v1, body: JSON.parse(body) });
    res.end("ok");
  });
}).listen(HOOK_PORT);

// ── a "hauler website" on another origin that embeds the widget ──────────────
const hostServer = createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><html><body style="background:#fef3c7;font-family:sans-serif">
    <h1>Bob's Hauling</h1><p>Get a quote:</p>
    <script src="${BASE}/widget.js" data-tenant="demo" async></script></body></html>`);
}).listen(HOST_PORT);

// ── boot the app ─────────────────────────────────────────────────────────────
const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: { ...process.env, DATA_DIR: dataDir, ALLOW_FILE_STORE: "1", INSECURE_OPEN_DASHBOARD: "1", APP_URL: BASE, OPENAI_API_KEY: "", STRIPE_SECRET_KEY: "", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
  // Own process group, so teardown kills next-server too, not just the npx wrapper.
  detached: true,
});
const stopServer = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stopServer);
server.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
if (await fetch(`${BASE}/api/t/demo/config`).then(() => true, () => false)) {
  throw new Error(`port ${PORT} is already in use; stop the other server first`);
}
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/t/demo/config`)).ok) break;
  } catch {}
  if (i > 60) throw new Error("server did not start");
  await new Promise((r) => setTimeout(r, 500));
}

// Register a CRM webhook on the seeded demo tenant.
const dbFile = path.join(dataDir, "db.json");
const db = JSON.parse(await readFile(dbFile, "utf8"));
db.tenants[0].integrations.webhooks.push({
  id: "wh1",
  url: `http://localhost:${HOOK_PORT}/hook`,
  secret: "whsec_test",
  events: ["quote.created", "booking.confirmed"],
  label: "test receiver",
});
await writeFile(dbFile, JSON.stringify(db));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

try {
  // ── 1. Inventory funnel ────────────────────────────────────────────────────
  console.log("Inventory funnel");
  {
    const page = await (await browser.newContext(mobile)).newPage();
    await page.goto(`${BASE}/embed/demo`);
    await page.getByLabel("Pickup ZIP code").fill("43215");
    await page.screenshot({ path: `${OUT}/01-zip.png`, fullPage: true });
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("tab", { name: /Pick items/ }).click();
    await page.getByRole("button", { name: "More Sofa (3-seat)" }).click();
    await page.getByRole("button", { name: "More Recliner / armchair" }).click();
    await page.getByRole("tab", { name: /Mattresses/ }).click();
    await page.getByRole("button", { name: "More Mattress (queen/king)" }).click();
    await page.getByRole("tab", { name: /Appliances/ }).click();
    await page.getByRole("button", { name: "More Refrigerator" }).click();
    await page.screenshot({ path: `${OUT}/02-items.png`, fullPage: true });
    const footer = await page.locator("footer").innerText();
    check(/\$\d+ – \$\d+/.test(footer), `live price shown in footer (${footer.replace(/\s+/g, " ")})`);

    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "More flights of stairs" }).click();
    const breakdown = await page.locator("dl").innerText();
    check(breakdown.includes("Stairs fee (1 flight)") && breakdown.includes("+$25"), "stairs fee itemized");
    check(breakdown.includes("Freon recovery") && breakdown.includes("Mattress recycling"), "item surcharges itemized");
    await page.screenshot({ path: `${OUT}/03-estimate.png`, fullPage: true });

    await page.getByRole("button", { name: "Book a pickup" }).click();
    await page.getByText("Arrival window").waitFor();
    await page.locator("form section").nth(1).getByRole("button").first().click();
    await page.getByPlaceholder("Full name").fill("Pat Customer");
    await page.getByPlaceholder("Mobile phone").fill("(614) 555-0199");
    await page.getByPlaceholder("Email").fill("pat@example.com");
    await page.getByPlaceholder("Pickup address").fill("100 Main St, Columbus OH");
    await page.screenshot({ path: `${OUT}/04-book.png`, fullPage: true });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.getByText("You're booked!").waitFor({ timeout: 10_000 });
    await page.screenshot({ path: `${OUT}/05-done.png`, fullPage: true });
    check(true, "booking confirmed (no deposit when Stripe isn't configured)");
  }

  // ── 2. Photo funnel (mock vision) ──────────────────────────────────────────
  console.log("Photo funnel");
  {
    const ctx = await browser.newContext(mobile);
    const page = await ctx.newPage();
    // Any real image will do for the mock provider; render one.
    const shot = await page.screenshot();
    await page.goto(`${BASE}/embed/demo`);
    await page.getByLabel("Pickup ZIP code").fill("43215");
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByTestId("photo-input").setInputFiles([
      { name: "pile1.png", mimeType: "image/png", buffer: shot },
      { name: "pile2.png", mimeType: "image/png", buffer: shot },
    ]);
    await page.getByRole("button", { name: /Estimate from 2 photos/ }).click();
    await page.getByText("Here's what we spotted").waitFor({ timeout: 15_000 });
    check(await page.getByText("Demo mode").isVisible(), "mock provider is labelled as demo output");
    check(await page.getByText("Sofa (3-seat)").isVisible(), "detected sofa listed for review");
    await page.screenshot({ path: `${OUT}/06-photo-review.png`, fullPage: true });
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("checkbox").first().check(); // curbside
    const breakdown = await page.locator("dl").innerText();
    check(breakdown.includes("Curbside discount"), "curbside discount applied");
    await page.screenshot({ path: `${OUT}/07-photo-estimate.png`, fullPage: true });
    await page.getByRole("button", { name: "Book a pickup" }).click();
    await page.getByText("Arrival window").waitFor();
    check(true, "photo quote issued by the server");
  }

  // ── 3. API: authoritative pricing, capacity guard ──────────────────────────
  console.log("API");
  {
    const quote = await (
      await fetch(`${BASE}/api/t/demo/quotes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          zip: "43215",
          method: "inventory",
          lines: [{ kind: "catalog", catalogId: "sofa_3_seat", quantity: 1 }],
          access: { stairsFlights: 0, basement: false, longCarry: false, curbside: false },
        }),
      })
    ).json();
    check(quote.result?.truckLabel === "1/4 truckload", `server quote: ${quote.result?.truckLabel} ${quote.result?.lowCents}–${quote.result?.highCents}`);

    const bad = await fetch(`${BASE}/api/t/demo/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zip: "4321", method: "inventory", lines: [], access: {} }),
    });
    check(bad.status === 422, "invalid quote request rejected with 422");

    const { slots } = await (await fetch(`${BASE}/api/t/demo/slots`)).json();
    const slot = slots.find((s) => s.remaining === 2) ?? slots[0];
    const book = () =>
      fetch(`${BASE}/api/t/demo/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` },
        body: JSON.stringify({
          quoteId: quote.quoteId,
          slotKey: slot.key,
          customer: { name: "Racer", email: "r@example.com", phone: "6145550100", address: "1 Race Way, Columbus" },
        }),
      });
    const statuses = (await Promise.all([book(), book(), book()])).map((r) => r.status).sort();
    check(JSON.stringify(statuses) === "[200,200,409]", `concurrent bookings for a 2-crew window → ${statuses.join(",")}`);
  }

  // ── 4. Webhooks ────────────────────────────────────────────────────────────
  console.log("Webhooks");
  await new Promise((r) => setTimeout(r, 1500));
  check(received.some((r) => r.body.event === "quote.created"), "quote.created delivered");
  check(received.some((r) => r.body.event === "booking.confirmed" && r.body.data.customerName === "Pat Customer"), "booking.confirmed delivered with CRM fields");
  check(received.length > 0 && received.every((r) => r.valid), `all ${received.length} deliveries carry a valid HMAC signature`);

  // ── 5. Dashboard + iCal ────────────────────────────────────────────────────
  console.log("Dashboard");
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(`${BASE}/dashboard/demo`);
    check(await page.getByText("Pat Customer").isVisible(), "booking appears under upcoming jobs");
    check((await page.locator("img[alt='Customer photo']").count()) >= 2, "customer photos visible to owner");
    await page.screenshot({ path: `${OUT}/08-dashboard.png`, fullPage: true });
    const token = JSON.parse(await readFile(dbFile, "utf8")).tenants[0].integrations.icalToken;
    const ics = await (await fetch(`${BASE}/api/t/demo/calendar.ics?token=${token}`)).text();
    check(ics.includes("BEGIN:VEVENT") && ics.includes("Pat Customer"), "iCal feed lists the booking");
    check((await fetch(`${BASE}/api/t/demo/calendar.ics?token=wrong`)).status === 404, "iCal feed rejects a bad token");
  }

  // ── 6. Cross-origin embed ──────────────────────────────────────────────────
  console.log("Embed");
  {
    const page = await (await browser.newContext(mobile)).newPage();
    await page.goto(`http://localhost:${HOST_PORT}/`);
    const frame = page.frameLocator("iframe");
    await frame.getByLabel("Pickup ZIP code").waitFor();
    await page.waitForTimeout(500);
    const h1 = await page.locator("iframe").evaluate((el) => el.style.height);
    await frame.getByLabel("Pickup ZIP code").fill("43215");
    await frame.getByRole("button", { name: "Start" }).click();
    await frame.getByRole("tab", { name: /Pick items/ }).click();
    await page.waitForTimeout(500);
    const h2 = await page.locator("iframe").evaluate((el) => el.style.height);
    check(h1 !== "620px" && h1 !== h2, `iframe auto-resizes (${h1} → ${h2})`);
    await page.screenshot({ path: `${OUT}/09-embedded.png`, fullPage: true });
    const csp = (await fetch(`${BASE}/embed/demo`)).headers.get("content-security-policy");
    check(csp?.includes("frame-ancestors"), `embed CSP: ${csp}`);
    check((await fetch(`${BASE}/`)).headers.get("x-frame-options") === "DENY", "non-embed pages refuse framing");
  }
} finally {
  await browser.close();
  stopServer();
  hookServer.close();
  hostServer.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll e2e checks passed");
process.exit(failures ? 1 : 0);
