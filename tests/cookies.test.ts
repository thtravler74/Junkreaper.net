import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCookieSource, parseNetscapeCookieJar } from '../src/main/services/profileStore.ts';
import { localStorageSeedScript, matchesUrlPattern } from '../src/main/services/playwrightRunner.ts';

const YEAR_2100 = 4_102_444_800;
const YEAR_2000 = 946_684_800;

describe('parseCookieSource', () => {
  it('reads a Playwright storageState object', () => {
    const source = JSON.stringify({
      cookies: [{ name: 'sid', value: 'abc', domain: '.example.com', path: '/', expires: YEAR_2100 }],
      origins: [{ origin: 'https://example.com', localStorage: [{ name: 'theme', value: 'dark' }] }],
    });

    const parsed = parseCookieSource(source, 'storage-state.json');
    assert.equal(parsed.cookies.length, 1);
    assert.equal(parsed.cookies[0]?.domain, '.example.com');
    assert.equal(parsed.origins.length, 1);
    assert.equal(parsed.origins[0]?.origin, 'https://example.com');
  });

  it('reads the bare array that browser export extensions produce', () => {
    const source = JSON.stringify([
      { name: 'sid', value: 'abc', domain: 'example.com', path: '/app', secure: true, httpOnly: true },
    ]);

    const parsed = parseCookieSource(source, 'export.json');
    assert.deepEqual(parsed.cookies, [
      { name: 'sid', value: 'abc', domain: 'example.com', path: '/app', httpOnly: true, secure: true },
    ]);
  });

  it('drops cookies that have already expired, and counts them', () => {
    const source = JSON.stringify([
      { name: 'stale', value: '1', domain: 'example.com', expires: YEAR_2000 },
      { name: 'fresh', value: '2', domain: 'example.com', expires: YEAR_2100 },
      { name: 'session', value: '3', domain: 'example.com', expires: -1 },
    ]);

    const parsed = parseCookieSource(source, 'export.json');
    assert.deepEqual(parsed.cookies.map((cookie) => cookie.name), ['fresh', 'session']);
    assert.equal(parsed.expiredDropped, 1);
  });

  it('converts millisecond expiries to the seconds Playwright expects', () => {
    const source = JSON.stringify([{ name: 'a', value: '1', domain: 'example.com', expirationDate: YEAR_2100 * 1000 }]);
    assert.equal(parseCookieSource(source, 'export.json').cookies[0]?.expires, YEAR_2100);
  });

  it('skips entries that identify neither a domain nor a url', () => {
    const source = JSON.stringify([{ name: 'orphan', value: '1' }, { name: 'ok', value: '2', url: 'https://example.com/' }]);
    const parsed = parseCookieSource(source, 'export.json');
    assert.equal(parsed.malformedDropped, 1);
    assert.equal(parsed.cookies.length, 1);
    assert.equal(parsed.cookies[0]?.url, 'https://example.com/');
  });

  it('normalises SameSite and forces `secure` on SameSite=None', () => {
    const source = JSON.stringify([
      { name: 'a', value: '1', domain: 'example.com', sameSite: 'no_restriction' },
      { name: 'b', value: '2', domain: 'example.com', sameSite: 'lax' },
      { name: 'c', value: '3', domain: 'example.com', sameSite: 'unspecified' },
    ]);

    const [none, lax, unspecified] = parseCookieSource(source, 'export.json').cookies;
    // Chromium rejects SameSite=None outright unless the cookie is also Secure.
    assert.equal(none?.sameSite, 'None');
    assert.equal(none?.secure, true);
    assert.equal(lax?.sameSite, 'Lax');
    assert.equal(lax?.secure, false);
    assert.equal(unspecified?.sameSite, undefined, 'let Chromium apply its own default');
  });

  it('defaults the path when a domain cookie omits it', () => {
    const parsed = parseCookieSource(JSON.stringify([{ name: 'a', value: '1', domain: 'example.com' }]), 'x.json');
    assert.equal(parsed.cookies[0]?.path, '/');
  });

  it('treats an empty file as an empty jar', () => {
    assert.deepEqual(parseCookieSource('   \n', 'empty.json').cookies, []);
  });

  it('reports the file name when the JSON is broken', () => {
    assert.throws(() => parseCookieSource('{ nope', 'broken.json'), /broken\.json: not valid JSON/);
  });
});

describe('parseNetscapeCookieJar', () => {
  const jar = [
    '# Netscape HTTP Cookie File',
    '# This is a generated file.  Do not edit.',
    '',
    ['.example.com', 'TRUE', '/', 'TRUE', String(YEAR_2100), 'sid', 'abc123'].join('\t'),
    '#HttpOnly_.example.com\tTRUE\t/api\tTRUE\t' + YEAR_2100 + '\tauth\tsecret',
    'malformed line without tabs',
  ].join('\n');

  it('parses the curl/wget jar format, including the HttpOnly convention', () => {
    const cookies = parseCookieSource(jar, 'cookies.txt').cookies;
    assert.equal(cookies.length, 2);

    assert.deepEqual(cookies[0], {
      name: 'sid',
      value: 'abc123',
      domain: '.example.com',
      path: '/',
      expires: YEAR_2100,
      secure: true,
    });

    assert.equal(cookies[1]?.name, 'auth');
    assert.equal(cookies[1]?.httpOnly, true);
    assert.equal(cookies[1]?.path, '/api');
  });

  it('ignores comments and short lines instead of throwing', () => {
    assert.equal(parseNetscapeCookieJar('# just a comment\nnot\tenough\tfields').length, 0);
  });

  it('keeps tabs that are part of a cookie value', () => {
    const line = ['example.com', 'FALSE', '/', 'FALSE', '-1', 'weird', 'a\tb'].join('\t');
    const parsed = parseNetscapeCookieJar(line) as Array<{ value: string }>;
    assert.equal(parsed[0]?.value, 'a\tb');
  });
});

describe('matchesUrlPattern', () => {
  it('treats a pattern without a wildcard as a substring test', () => {
    assert.equal(matchesUrlPattern('https://example.com/login?next=/', '/login'), true);
    assert.equal(matchesUrlPattern('https://example.com/home', '/login'), false);
  });

  it('anchors wildcard patterns end to end', () => {
    assert.equal(matchesUrlPattern('https://example.com/login?next=/', '*/login*'), true);
    assert.equal(matchesUrlPattern('https://example.com/dashboard', '*/login*'), false);
  });

  it('escapes regex metacharacters in the literal parts', () => {
    assert.equal(matchesUrlPattern('https://example.com/a.b', 'https://example.com/a.b'), true);
    assert.equal(matchesUrlPattern('https://example.com/axb', '*/a.b'), false);
  });
});

describe('localStorageSeedScript', () => {
  it('guards on the origin so the seed cannot leak across sites', () => {
    const script = localStorageSeedScript('https://example.com', [{ name: 'theme', value: 'dark' }]);
    assert.match(script, /window\.location\.origin !== "https:\/\/example\.com"/);
    assert.match(script, /setItem\(entry\.name, entry\.value\)/);
  });

  it('serialises values safely rather than interpolating them raw', () => {
    const script = localStorageSeedScript('https://example.com', [{ name: 'x', value: '</script><script>evil()' }]);
    assert.ok(!script.includes('<script>evil()'), 'the payload must be JSON-escaped');
  });
});
