import { chromium } from 'playwright';
import type { BrowserContext, Page, Response } from 'playwright';
import type { ProxySettings } from '../config/sessionsConfig.ts';
import type { SessionTarget } from '../../shared/types.ts';
import { describeError, type Logger } from './logger.ts';
import type { ProfileStore } from './profileStore.ts';

export type RestorePhase = 'launching' | 'restoring' | 'navigating' | 'verifying';

export interface RestoreHooks {
  onPhase(phase: RestorePhase, message: string): void;
}

export interface RestoreSuccess {
  ok: true;
  finalUrl: string;
  title: string;
  /** Cookies present in the context once the page settled. */
  cookieCount: number;
  /** Cookies we injected from disk before navigating. */
  restoredCookieCount: number;
  durationMs: number;
  /** True when no probe was configured and we fell back to the HTTP status. */
  unverified: boolean;
}

export interface RestoreFailure {
  ok: false;
  reason: string;
  durationMs: number;
  diagnosticsPath?: string;
}

export type RestoreOutcome = RestoreSuccess | RestoreFailure;

export interface RunnerOptions {
  store: ProfileStore;
  logger: Logger;
  headless: boolean;
  timeoutMs: number;
  waitUntil: NonNullable<SessionTarget['waitUntil']>;
  /** Keep each restored context (and its tab) alive after it reports ready. */
  keepContextsOpen: boolean;
  executablePath?: string | undefined;
  slowMoMs?: number | undefined;
  /** Egress proxy for every context this runner launches. */
  proxy?: ProxySettings | undefined;
  /** Screenshot + HTML dump on failure, written to the diagnostics dir. */
  captureDiagnostics?: boolean;
}

export class AbortedError extends Error {
  constructor() {
    super('run stopped');
    this.name = 'AbortedError';
  }
}

/**
 * Drives one headless Chromium **persistent context per account**.
 *
 * Two independent restoration mechanisms are stacked deliberately:
 *
 *  1. `chromium.launchPersistentContext(userDataDir)` gives each account a real,
 *     durable Chromium profile - its own cookie jar, localStorage, IndexedDB and
 *     service workers - so a session that was alive last run is usually alive again
 *     with nothing injected at all.
 *  2. Cookies exported to disk (`storage-state/<id>.json`, or a seed the user drops
 *     into `cookies/<id>.json`) are injected with `context.addCookies()` before the
 *     first navigation. This is the part that bootstraps a brand-new profile, and it
 *     has to be done by hand: `launchPersistentContext` has no `storageState` option,
 *     unlike `browser.newContext()`.
 *
 * After a successful restore the live state is exported back out, so each run
 * refreshes the on-disk jar with rotated cookies.
 */
export class PlaywrightSessionRunner {
  readonly #options: RunnerOptions;
  readonly #contexts = new Map<string, BrowserContext>();
  #stopped = false;

  constructor(options: RunnerOptions) {
    this.#options = options;
  }

  get openContextCount(): number {
    return this.#contexts.size;
  }

  /** Contexts kept alive after a successful restore, keyed by target id. */
  contextFor(targetId: string): BrowserContext | undefined {
    return this.#contexts.get(targetId);
  }

  async restore(target: SessionTarget, hooks: RestoreHooks): Promise<RestoreOutcome> {
    const started = Date.now();
    const log = this.#options.logger.child(target.id);
    const timeout = target.timeoutMs ?? this.#options.timeoutMs;
    const since = () => Date.now() - started;

    let context: BrowserContext | undefined;
    try {
      this.#assertRunning();

      // --- 1. launch the account's own persistent profile --------------------
      const userDataDir = this.#options.store.profileDir(target);
      hooks.onPhase('launching', `Opening profile ${target.profile ?? target.id}`);
      log.debug(`launching persistent context at ${userDataDir}`);

      context = await chromium.launchPersistentContext(userDataDir, {
        headless: this.#options.headless,
        timeout,
        viewport: { width: 1366, height: 900 },
        executablePath: this.#options.executablePath,
        slowMo: this.#options.slowMoMs,
        // Mirrors Playwright's own default. Flip to `true` on a workstation where
        // the Chromium SUID sandbox helper is available; it has to stay off for
        // the root/containerised runs this app is regularly launched from.
        chromiumSandbox: false,
        ...(this.#options.proxy ? { proxy: this.#options.proxy } : {}),
        args: ['--disable-blink-features=AutomationControlled'],
      });
      context.setDefaultTimeout(timeout);
      context.setDefaultNavigationTimeout(timeout);

      // --- 2. inject anything saved on disk ----------------------------------
      this.#assertRunning();
      hooks.onPhase('restoring', 'Restoring saved cookies');
      const bundle = await this.#options.store.readRestorable(target);
      if (bundle.cookies.length > 0) {
        await context.addCookies(bundle.cookies);
      }
      for (const origin of bundle.origins) {
        await context.addInitScript({ content: localStorageSeedScript(origin.origin, origin.localStorage) });
      }
      log.info(
        bundle.sources.length === 0
          ? 'no saved cookies on disk - relying on the persistent profile alone'
          : `restored ${bundle.cookies.length} cookies from ${bundle.sources.length} source(s)` +
              (bundle.expiredDropped > 0 ? `, dropped ${bundle.expiredDropped} expired` : '') +
              (bundle.malformedDropped > 0 ? `, skipped ${bundle.malformedDropped} malformed` : ''),
      );

      // --- 3. open the target in a tab of that context ------------------------
      this.#assertRunning();
      hooks.onPhase('navigating', `Loading ${hostOf(target.url)}`);
      const page = context.pages()[0] ?? (await context.newPage());
      const response = await page.goto(target.url, {
        waitUntil: target.waitUntil ?? this.#options.waitUntil,
        timeout,
      });

      // --- 4. decide whether the session actually survived --------------------
      this.#assertRunning();
      hooks.onPhase('verifying', 'Checking whether the session is still signed in');
      const verdict = await verifySession(page, response, target, timeout);
      if (!verdict.ok) {
        const diagnosticsPath = await this.#captureDiagnostics(page, target);
        await context.close();
        log.warn(`session not usable: ${verdict.reason}`);
        return {
          ok: false,
          reason: verdict.reason,
          durationMs: since(),
          ...(diagnosticsPath ? { diagnosticsPath } : {}),
        };
      }

      // --- 5. write the refreshed jar back to disk ---------------------------
      const cookies = await context.cookies();
      try {
        const state = await context.storageState();
        await this.#options.store.writeStorageState(target, state);
      } catch (error) {
        // Never fail a good session because the export failed.
        log.warn(`could not export storage state: ${describeError(error)}`);
      }

      const title = await page.title().catch(() => '');
      const finalUrl = page.url();

      if (this.#options.keepContextsOpen) {
        this.#contexts.set(target.id, context);
        context.once('close', () => this.#contexts.delete(target.id));
      } else {
        await context.close();
      }

      log.info(`ready in ${since()}ms (${cookies.length} cookies, ${finalUrl})`);
      return {
        ok: true,
        finalUrl,
        title,
        cookieCount: cookies.length,
        restoredCookieCount: bundle.cookies.length,
        durationMs: since(),
        unverified: verdict.unverified,
      };
    } catch (error) {
      if (context) await context.close().catch(() => {});
      if (error instanceof AbortedError) throw error;
      log.error('restore failed', error);
      return { ok: false, reason: describeError(error), durationMs: since() };
    }
  }

  /** Closes every context kept open by `keepContextsOpen`. */
  async closeAll(): Promise<void> {
    const contexts = [...this.#contexts.values()];
    this.#contexts.clear();
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  }

  /**
   * Marks the runner stopped and tears down every open context. In-flight
   * navigations reject as their context disappears, which is how a `stop()`
   * interrupts a `page.goto()` that is still waiting on the network.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    await this.closeAll();
  }

  resume(): void {
    this.#stopped = false;
  }

  #assertRunning(): void {
    if (this.#stopped) throw new AbortedError();
  }

  async #captureDiagnostics(page: Page, target: SessionTarget): Promise<string | undefined> {
    if (this.#options.captureDiagnostics === false) return undefined;
    const file = this.#options.store.diagnosticsPath(target, 'png');
    try {
      await page.screenshot({ path: file, fullPage: false });
      return file;
    } catch {
      return undefined;
    }
  }
}

interface Verdict {
  ok: boolean;
  reason: string;
  unverified: boolean;
}

/**
 * Ordered strongest-signal-first: an explicit "you are logged in" selector beats an
 * explicit "you are logged out" selector, which beats a redirect to a known login
 * URL, which beats the bare HTTP status.
 */
export async function verifySession(
  page: Page,
  response: Response | null,
  target: SessionTarget,
  timeout: number,
): Promise<Verdict> {
  const probe = target.probe;
  const budget = Math.min(timeout, 20_000);

  if (probe?.readySelector) {
    try {
      await page.waitForSelector(probe.readySelector, { state: 'visible', timeout: budget });
      return { ok: true, reason: `matched readySelector ${probe.readySelector}`, unverified: false };
    } catch {
      const loggedOut = probe.loggedOutSelector
        ? await isVisible(page, probe.loggedOutSelector)
        : false;
      return {
        ok: false,
        reason: loggedOut
          ? 'signed out - the login form is showing, this account needs a fresh sign-in'
          : `readySelector ${probe.readySelector} never appeared within ${budget}ms`,
        unverified: false,
      };
    }
  }

  if (probe?.loggedOutSelector && (await isVisible(page, probe.loggedOutSelector))) {
    return { ok: false, reason: 'signed out - matched loggedOutSelector', unverified: false };
  }

  const finalUrl = page.url();
  const matched = probe?.loggedOutUrlPattern?.find((pattern) => matchesUrlPattern(finalUrl, pattern));
  if (matched) {
    return { ok: false, reason: `redirected to a sign-in URL (matched "${matched}")`, unverified: false };
  }

  const status = response?.status();
  if (status !== undefined && status >= 400) {
    return { ok: false, reason: `server answered HTTP ${status}`, unverified: false };
  }

  return {
    ok: true,
    reason: 'page loaded; no probe configured, so sign-in state was not verified',
    unverified: !probe?.readySelector && !probe?.loggedOutSelector && !probe?.loggedOutUrlPattern?.length,
  };
}

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
}

/** Glob-ish matcher: `*` matches any run of characters, everything else is literal. */
export function matchesUrlPattern(url: string, pattern: string): boolean {
  if (!pattern.includes('*')) return url.includes(pattern);
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(url);
}

/**
 * `launchPersistentContext` cannot take a `storageState`, so localStorage is
 * replayed with an init script that runs before any page script on the matching
 * origin - the same trick Playwright uses internally for `newContext`.
 */
export function localStorageSeedScript(origin: string, items: ReadonlyArray<{ name: string; value: string }>): string {
  return `(() => {
  if (window.location.origin !== ${embeddableJson(origin)}) return;
  try {
    for (const entry of ${embeddableJson(items)}) window.localStorage.setItem(entry.name, entry.value);
  } catch (error) {
    console.warn('[junkreaper] localStorage seed failed', error);
  }
})();`;
}

/**
 * `JSON.stringify` alone is not safe to splice into generated source: it leaves
 * `<` and `>` intact (so a value containing `</script>` can terminate a script
 * context downstream) and leaves U+2028/U+2029 raw, which JavaScript treats as
 * line terminators inside string literals. These values come from cookie files on
 * disk, so they are attacker-influenced input as far as this function is concerned.
 * The escapes decode back to the original characters at runtime.
 */
function embeddableJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
