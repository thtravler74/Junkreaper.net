import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext } from 'playwright';
import type { SessionTarget } from '../../shared/types.ts';

/**
 * Derive the cookie/origin shapes straight from Playwright's own signatures so
 * they cannot drift when the dependency moves.
 */
export type RestorableCookie = Parameters<BrowserContext['addCookies']>[0][number];
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
export type StorageOrigin = StorageState['origins'][number];

export interface RestoreBundle {
  cookies: RestorableCookie[];
  origins: StorageOrigin[];
  /** Files that contributed, in the order they were merged. */
  sources: string[];
  /** Cookies discarded because their expiry had already passed. */
  expiredDropped: number;
  /** Cookies discarded because they identified no domain or url. */
  malformedDropped: number;
}

const SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Owns every path the background service writes to, and knows how to turn the
 * various shapes of "saved browser cookies" people actually have on disk into
 * something `BrowserContext.addCookies()` accepts.
 *
 * Layout under the state root (Electron `userData`, or `.junkreaper/` for the CLI):
 *
 *   profiles/<profile>/      persistent Chromium user-data-dir (its own cookie jar)
 *   storage-state/<id>.json  Playwright storageState written after each good run
 *   cookies/<id>.json|.txt   user-supplied seed export (JSON or Netscape cookies.txt)
 *   diagnostics/<id>.png     screenshot captured when a restore fails
 */
export class ProfileStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  get profilesDir(): string {
    return path.join(this.root, 'profiles');
  }
  get storageStateDir(): string {
    return path.join(this.root, 'storage-state');
  }
  get seedsDir(): string {
    return path.join(this.root, 'cookies');
  }
  get diagnosticsDir(): string {
    return path.join(this.root, 'diagnostics');
  }

  async ensureDirs(): Promise<void> {
    await Promise.all(
      [this.profilesDir, this.storageStateDir, this.seedsDir, this.diagnosticsDir].map((dir) =>
        mkdir(dir, { recursive: true }),
      ),
    );
  }

  /** Guards against a config slug escaping the state root via a relative path. */
  #slug(value: string, field: string): string {
    if (!SLUG.test(value)) {
      throw new Error(`refusing to use ${field} "${value}" as a directory name`);
    }
    return value;
  }

  profileDir(target: SessionTarget): string {
    const name = this.#slug(target.profile ?? target.id, target.profile ? 'profile' : 'id');
    return path.join(this.profilesDir, name);
  }

  storageStatePath(target: SessionTarget): string {
    return path.join(this.storageStateDir, `${this.#slug(target.id, 'id')}.json`);
  }

  diagnosticsPath(target: SessionTarget, ext: string): string {
    return path.join(this.diagnosticsDir, `${this.#slug(target.id, 'id')}.${ext}`);
  }

  /** Seed exports the user dropped in by hand, tried in order. */
  seedPaths(target: SessionTarget): string[] {
    const id = this.#slug(target.id, 'id');
    return [
      path.join(this.seedsDir, `${id}.json`),
      path.join(this.seedsDir, `${id}.txt`),
      path.join(this.seedsDir, `${id}.cookies.txt`),
    ];
  }

  /**
   * Merge everything restorable for a target. A hand-supplied seed is applied
   * first, then whatever we exported after the last successful run wins - so a
   * refreshed cookie from a real session always beats a stale manual export.
   */
  async readRestorable(target: SessionTarget): Promise<RestoreBundle> {
    const bundle: RestoreBundle = { cookies: [], origins: [], sources: [], expiredDropped: 0, malformedDropped: 0 };
    const byKey = new Map<string, RestorableCookie>();
    const originByUrl = new Map<string, StorageOrigin>();

    const files = [...this.seedPaths(target), this.storageStatePath(target)];
    for (const file of files) {
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      const parsed = parseCookieSource(text, file);
      bundle.expiredDropped += parsed.expiredDropped;
      bundle.malformedDropped += parsed.malformedDropped;
      bundle.sources.push(file);

      for (const cookie of parsed.cookies) byKey.set(cookieKey(cookie), cookie);
      for (const origin of parsed.origins) originByUrl.set(origin.origin, origin);
    }

    bundle.cookies = [...byKey.values()];
    bundle.origins = [...originByUrl.values()];
    return bundle;
  }

  /** Atomic write: a crash mid-export must not leave a truncated cookie jar. */
  async writeStorageState(target: SessionTarget, state: StorageState): Promise<string> {
    const destination = this.storageStatePath(target);
    const temporary = `${destination}.${process.pid}.tmp`;
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, destination);
    return destination;
  }
}

function cookieKey(cookie: RestorableCookie): string {
  return `${cookie.name} ${cookie.domain ?? cookie.url ?? ''} ${cookie.path ?? '/'}`;
}

interface ParsedCookieSource {
  cookies: RestorableCookie[];
  origins: StorageOrigin[];
  expiredDropped: number;
  malformedDropped: number;
}

/**
 * Accepts the three shapes a "saved cookie export" realistically arrives in:
 *   - a Playwright `storageState` object (`{ cookies, origins }`)
 *   - a bare JSON array, which is what most browser cookie-export extensions emit
 *   - Netscape `cookies.txt` (the curl / wget / yt-dlp jar format)
 */
export function parseCookieSource(text: string, source: string): ParsedCookieSource {
  const trimmed = text.trim();
  if (!trimmed) return { cookies: [], origins: [], expiredDropped: 0, malformedDropped: 0 };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`${source}: not valid JSON (${(error as Error).message})`);
    }

    if (Array.isArray(raw)) return normalizeCookies(raw);

    if (typeof raw === 'object' && raw !== null) {
      const record = raw as { cookies?: unknown; origins?: unknown };
      const normalized = normalizeCookies(Array.isArray(record.cookies) ? record.cookies : []);
      if (Array.isArray(record.origins)) {
        normalized.origins = record.origins.filter(isStorageOrigin);
      }
      return normalized;
    }

    throw new Error(`${source}: expected an object or array of cookies`);
  }

  return normalizeCookies(parseNetscapeCookieJar(trimmed));
}

function isStorageOrigin(value: unknown): value is StorageOrigin {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StorageOrigin).origin === 'string' &&
    Array.isArray((value as StorageOrigin).localStorage)
  );
}

/**
 * Netscape jar lines are tab separated:
 * `domain`, `includeSubdomains`, `path`, `secure`, `expiry`, `name`, `value`.
 * Lines starting with `#` are comments, except the `#HttpOnly_` prefix that curl
 * uses to mark an HttpOnly cookie.
 */
export function parseNetscapeCookieJar(text: string): unknown[] {
  const out: unknown[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let httpOnly = false;
    let body = line;
    if (body.startsWith('#HttpOnly_')) {
      httpOnly = true;
      body = body.slice('#HttpOnly_'.length);
    } else if (body.startsWith('#')) {
      continue;
    }

    const parts = body.split('	');
    if (parts.length < 7) continue;
    const [domain, , cookiePath, secure, expires, name, ...valueParts] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      ...string[],
    ];

    out.push({
      name,
      value: valueParts.join('	'),
      domain,
      path: cookiePath || '/',
      secure: secure.toUpperCase() === 'TRUE',
      httpOnly,
      expires: Number.parseInt(expires, 10) || -1,
    });
  }
  return out;
}

function normalizeCookies(entries: unknown[]): ParsedCookieSource {
  const cookies: RestorableCookie[] = [];
  const nowSeconds = Date.now() / 1000;
  let expiredDropped = 0;
  let malformedDropped = 0;

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) {
      malformedDropped += 1;
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name : undefined;
    const value = typeof raw.value === 'string' ? raw.value : undefined;
    if (!name || value === undefined) {
      malformedDropped += 1;
      continue;
    }

    const domain = typeof raw.domain === 'string' && raw.domain ? raw.domain : undefined;
    const url = typeof raw.url === 'string' && raw.url ? raw.url : undefined;
    if (!domain && !url) {
      // addCookies() requires either a url, or a domain plus a path.
      malformedDropped += 1;
      continue;
    }

    const expires = toExpiry(raw.expires ?? raw.expirationDate);
    if (expires !== undefined && expires > 0 && expires < nowSeconds) {
      expiredDropped += 1;
      continue;
    }

    const sameSite = toSameSite(raw.sameSite);
    const cookie: RestorableCookie = { name, value };
    if (domain) {
      cookie.domain = domain;
      cookie.path = typeof raw.path === 'string' && raw.path ? raw.path : '/';
    }
    if (url && !domain) cookie.url = url;
    if (expires !== undefined) cookie.expires = expires;
    if (raw.httpOnly === true) cookie.httpOnly = true;
    if (sameSite) cookie.sameSite = sameSite;
    // Chromium rejects SameSite=None on a non-secure cookie outright, so the
    // combination is normalised here rather than silently dropped by the browser.
    cookie.secure = raw.secure === true || sameSite === 'None';

    cookies.push(cookie);
  }

  return { cookies, origins: [], expiredDropped, malformedDropped };
}

function toExpiry(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  // Some exports use milliseconds; Playwright wants seconds since the epoch.
  const seconds = value > 1e12 ? value / 1000 : value;
  return Math.trunc(seconds);
}

function toSameSite(value: unknown): 'Strict' | 'Lax' | 'None' | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value.toLowerCase()) {
    case 'strict':
      return 'Strict';
    case 'lax':
      return 'Lax';
    case 'none':
    case 'no_restriction':
      return 'None';
    default:
      // "unspecified" and friends: let Chromium apply its own default.
      return undefined;
  }
}
