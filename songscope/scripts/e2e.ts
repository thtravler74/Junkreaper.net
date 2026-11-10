/**
 * End-to-end check against the production build:
 *
 *   npm run build && npm run test:e2e
 *
 * Serves dist/ with `vite preview`, drives Chromium through a real file upload
 * (a synthesized WAV written to a temp dir), waits for the report, verifies key
 * facts, downloads the Markdown, exercises the demo button, and saves screenshots
 * to test-results/.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { encodeWav, synthArrangement } from "../src/demo/synth";

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve("test-results");
await mkdir(OUT, { recursive: true });
let failures = 0;
const check = (cond: boolean, label: string): void => { console.log(`${cond ? "  ✓" : "  ✗"} ${label}`); if (!cond) failures++; };

const tmp = await mkdtemp(path.join(tmpdir(), "songscope-e2e-"));
const wavPath = path.join(tmp, "arrangement-120bpm.wav");
const audio = synthArrangement(120, 44100, true);
await writeFile(wavPath, encodeWav(audio.channels, audio.sampleRate));

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
const stop = (): void => { try { process.kill(-server.pid!, "SIGTERM"); } catch { /* already gone */ } };
process.on("exit", stop);
server.stderr.on("data", (d: Buffer) => process.stderr.write(`[vite] ${d}`));
for (let i = 0; ; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
  if (i > 60) { console.error("preview server did not start"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 500));
}

// CHROMIUM_PATH points at a system Chromium when the bundled browser build is unavailable.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

console.log("Upload flow");
await page.goto(BASE);
await page.setInputFiles('[data-testid="file-input"]', wavPath);
await page.waitForSelector('[data-testid="report"]', { timeout: 120_000 });
const text = await page.textContent('[data-testid="report"]');
check(!!text && text.includes("C major"), "report names the key (C major)");
check(!!text && /1(19|20)\.\d BPM/.test(text), "report states ~120 BPM");
check(!!text && text.includes("4/4"), "report states 4/4");
check(!!text && text.includes("Intro") && text.includes("Chorus"), "report describes the structure");
check(!!text && text.includes("LUFS"), "report includes loudness");
check(!!text && text.includes("Axis"), "report recognises the Axis progression");
const words = (text ?? "").split(/\s+/).filter(Boolean).length;
check(words > 1500, `description is long (${words} words)`);
check((await page.locator(".section-block").count()) >= 4, "section lane is drawn");
check((await page.locator(".chord-block").count()) >= 8, "chord lane is drawn");
check(await page.locator("audio.player").isVisible(), "audio player is available for playback");
await page.screenshot({ path: path.join(OUT, "report.png"), fullPage: false });

const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="download-md"]')]);
const mdPath = path.join(tmp, download.suggestedFilename());
await download.saveAs(mdPath);
const md = await readFile(mdPath, "utf8");
check(download.suggestedFilename().endsWith("-description.md"), `markdown download named ${download.suggestedFilename()}`);
check(md.startsWith("# ") && md.includes("## Loudness and mastering"), "markdown export has headings");

await page.click('[data-testid="tab-visual"]');
check(await page.locator('[data-testid="timeline"]').isVisible(), "timeline tables render");
await page.click('[data-testid="tab-data"]');
const json = await page.textContent('[data-testid="json"]');
check(!!json && JSON.parse(json).harmony.key.name === "C major", "raw JSON is valid and matches");
await page.screenshot({ path: path.join(OUT, "data.png") });

console.log("Demo flow");
await page.click("text=Analyze another");
await page.click('[data-testid="demo-button"]');
await page.waitForSelector('[data-testid="report"]', { timeout: 120_000 });
const demoText = await page.textContent('[data-testid="report"]');
check(!!demoText && demoText.includes("Synthesized demo"), "demo report renders");
check(!!demoText && /11[12]\.\d BPM/.test(demoText), "demo tempo ≈ 112 BPM");
await page.screenshot({ path: path.join(OUT, "demo.png"), fullPage: true });

check(errors.length === 0, errors.length ? `no page errors (got: ${errors.join(" | ").slice(0, 300)})` : "no page errors");
await browser.close();
stop();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
