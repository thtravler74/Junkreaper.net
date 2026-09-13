import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SessionTarget } from '../../shared/types.ts';

/** Forwarded verbatim to Playwright's launch options. */
export interface ProxySettings {
  server: string;
  bypass?: string;
  username?: string;
  password?: string;
}

export interface SessionsDefaults {
  headless: boolean;
  concurrency: number;
  timeoutMs: number;
  waitUntil: NonNullable<SessionTarget['waitUntil']>;
  /** Keep each restored context (and its tab) open after it reports ready. */
  keepContextsOpen: boolean;
  /** Corporate/egress proxy every restored context should dial through. */
  proxy?: ProxySettings;
}

export interface SessionsConfig {
  defaults: SessionsDefaults;
  targets: SessionTarget[];
}

export interface LoadedSessionsConfig {
  config: SessionsConfig;
  /** Absolute path of the file that was actually read. */
  path: string;
  /** True when we fell back to the committed example file. */
  isExample: boolean;
}

export const DEFAULTS: SessionsDefaults = {
  headless: true,
  concurrency: 1,
  timeoutMs: 45_000,
  waitUntil: 'domcontentloaded',
  keepContextsOpen: true,
};

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(source: string, issues: string[]) {
    super(`Invalid sessions config (${source}):\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const WAIT_UNTIL = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Hand-rolled validation instead of a schema dependency: the surface is small, the
 * error messages can name the exact JSON path, and the main process stays free of
 * runtime deps it would otherwise have to bundle.
 */
export function parseSessionsConfig(raw: unknown, source: string): SessionsConfig {
  const issues: string[] = [];

  if (!isRecord(raw)) {
    throw new ConfigError(source, ['root must be a JSON object']);
  }

  const defaults: SessionsDefaults = { ...DEFAULTS };
  if (raw.defaults !== undefined) {
    if (!isRecord(raw.defaults)) {
      issues.push('`defaults` must be an object');
    } else {
      const d = raw.defaults;
      if (d.headless !== undefined) {
        if (typeof d.headless !== 'boolean') issues.push('`defaults.headless` must be a boolean');
        else defaults.headless = d.headless;
      }
      if (d.concurrency !== undefined) {
        if (typeof d.concurrency !== 'number' || !Number.isInteger(d.concurrency) || d.concurrency < 1) {
          issues.push('`defaults.concurrency` must be an integer >= 1');
        } else {
          defaults.concurrency = d.concurrency;
        }
      }
      if (d.timeoutMs !== undefined) {
        if (typeof d.timeoutMs !== 'number' || d.timeoutMs < 1000) issues.push('`defaults.timeoutMs` must be a number >= 1000');
        else defaults.timeoutMs = d.timeoutMs;
      }
      if (d.waitUntil !== undefined) {
        if (typeof d.waitUntil !== 'string' || !WAIT_UNTIL.has(d.waitUntil)) {
          issues.push(`\`defaults.waitUntil\` must be one of ${[...WAIT_UNTIL].join(' | ')}`);
        } else {
          defaults.waitUntil = d.waitUntil as SessionsDefaults['waitUntil'];
        }
      }
      if (d.keepContextsOpen !== undefined) {
        if (typeof d.keepContextsOpen !== 'boolean') issues.push('`defaults.keepContextsOpen` must be a boolean');
        else defaults.keepContextsOpen = d.keepContextsOpen;
      }
      if (d.proxy !== undefined) {
        if (!isRecord(d.proxy)) {
          issues.push('`defaults.proxy` must be an object');
        } else if (typeof d.proxy.server !== 'string' || !d.proxy.server.trim()) {
          issues.push('`defaults.proxy.server` must be a non-empty string, e.g. "http://proxy.internal:3128"');
        } else {
          const proxy: ProxySettings = { server: d.proxy.server };
          for (const key of ['bypass', 'username', 'password'] as const) {
            const value = d.proxy[key];
            if (value === undefined) continue;
            if (typeof value !== 'string') issues.push(`\`defaults.proxy.${key}\` must be a string`);
            else proxy[key] = value;
          }
          defaults.proxy = proxy;
        }
      }
    }
  }

  if (!Array.isArray(raw.targets)) {
    issues.push('`targets` must be an array');
    throw new ConfigError(source, issues);
  }

  const seen = new Set<string>();
  const targets: SessionTarget[] = [];

  raw.targets.forEach((entry, index) => {
    const at = `targets[${index}]`;
    if (!isRecord(entry)) {
      issues.push(`${at} must be an object`);
      return;
    }

    const id = entry.id;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
      issues.push(`${at}.id must be a slug matching /^[a-z0-9][a-z0-9._-]*$/i (it becomes a directory name)`);
      return;
    }
    if (seen.has(id)) {
      issues.push(`${at}.id "${id}" is duplicated`);
      return;
    }
    seen.add(id);

    if (typeof entry.url !== 'string') {
      issues.push(`${at}.url must be a string`);
      return;
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(entry.url);
    } catch {
      issues.push(`${at}.url is not a valid absolute URL: ${entry.url}`);
      return;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      issues.push(`${at}.url must be http(s), got ${parsedUrl.protocol}`);
      return;
    }

    const target: SessionTarget = {
      id,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id,
      url: entry.url,
      enabled: entry.enabled === undefined ? true : entry.enabled === true,
    };

    if (entry.profile !== undefined) {
      if (typeof entry.profile !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(entry.profile)) {
        issues.push(`${at}.profile must be a slug (it becomes a directory name)`);
      } else {
        target.profile = entry.profile;
      }
    }
    if (entry.floorLabel !== undefined) {
      if (typeof entry.floorLabel !== 'string') issues.push(`${at}.floorLabel must be a string`);
      else target.floorLabel = entry.floorLabel;
    }
    if (entry.waitUntil !== undefined) {
      if (typeof entry.waitUntil !== 'string' || !WAIT_UNTIL.has(entry.waitUntil)) {
        issues.push(`${at}.waitUntil must be one of ${[...WAIT_UNTIL].join(' | ')}`);
      } else {
        target.waitUntil = entry.waitUntil as SessionTarget['waitUntil'];
      }
    }
    if (entry.timeoutMs !== undefined) {
      if (typeof entry.timeoutMs !== 'number' || entry.timeoutMs < 1000) issues.push(`${at}.timeoutMs must be a number >= 1000`);
      else target.timeoutMs = entry.timeoutMs;
    }
    if (entry.probe !== undefined) {
      if (!isRecord(entry.probe)) {
        issues.push(`${at}.probe must be an object`);
      } else {
        const probe: NonNullable<SessionTarget['probe']> = {};
        for (const key of ['readySelector', 'loggedOutSelector'] as const) {
          const value = entry.probe[key];
          if (value === undefined) continue;
          if (typeof value !== 'string' || !value.trim()) issues.push(`${at}.probe.${key} must be a non-empty string`);
          else probe[key] = value;
        }
        const patterns = entry.probe.loggedOutUrlPattern;
        if (patterns !== undefined) {
          if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== 'string')) {
            issues.push(`${at}.probe.loggedOutUrlPattern must be an array of strings`);
          } else {
            probe.loggedOutUrlPattern = patterns as string[];
          }
        }
        target.probe = probe;
      }
    }

    targets.push(target);
  });

  if (issues.length > 0) throw new ConfigError(source, issues);
  return { defaults, targets };
}

export interface ConfigSearchOptions {
  stateRoot: string;
  cwd: string;
  explicitPath?: string | undefined;
  /**
   * `process.resourcesPath/config` in a packaged build, where `extraResources`
   * puts the shipped example. A packaged app's cwd is not the repo, so without
   * this the example is unreachable and a first run has no config at all.
   */
  resourcesDir?: string | undefined;
}

/**
 * Resolution order, first hit wins:
 *   1. `$JUNKREAPER_SESSIONS`                  — explicit override
 *   2. `<stateRoot>/sessions.json`             — the user's own copy (userData dir)
 *   3. `<cwd>/config/sessions.json`            — project-local, gitignored
 *   4. `<cwd>/config/sessions.example.json`    — committed sample, so a fresh clone runs
 *   5. `<resourcesDir>/sessions.json`          — shipped alongside a packaged build
 *   6. `<resourcesDir>/sessions.example.json`  — ditto, so a fresh install runs too
 */
export function candidateConfigPaths(options: ConfigSearchOptions): string[] {
  const paths: string[] = [];
  if (options.explicitPath) paths.push(path.resolve(options.explicitPath));
  paths.push(path.join(options.stateRoot, 'sessions.json'));
  paths.push(path.join(options.cwd, 'config', 'sessions.json'));
  paths.push(path.join(options.cwd, 'config', 'sessions.example.json'));
  if (options.resourcesDir) {
    paths.push(path.join(options.resourcesDir, 'sessions.json'));
    paths.push(path.join(options.resourcesDir, 'sessions.example.json'));
  }
  return paths;
}

export async function loadSessionsConfig(options: ConfigSearchOptions): Promise<LoadedSessionsConfig> {
  const candidates = candidateConfigPaths(options);
  const attempted: string[] = [];

  for (const candidate of candidates) {
    let text: string;
    try {
      text = await readFile(candidate, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        attempted.push(candidate);
        continue;
      }
      throw error;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(stripJsonComments(text));
    } catch (error) {
      throw new ConfigError(candidate, [`not valid JSON: ${(error as Error).message}`]);
    }

    return {
      config: parseSessionsConfig(raw, candidate),
      path: candidate,
      isExample: candidate.endsWith('sessions.example.json'),
    };
  }

  throw new ConfigError('no config found', [
    'none of these paths exist:',
    ...attempted.map((p) => `  ${p}`),
    'copy config/sessions.example.json to config/sessions.json to get started',
  ]);
}

/** Allows `//` and `/* *\/` comments in the config file without a JSON5 dependency. */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }

  return out;
}
