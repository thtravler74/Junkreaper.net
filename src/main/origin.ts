/**
 * Origin comparison that works for the app's custom `app://` scheme.
 *
 * `URL.origin` is specified to return the opaque string `"null"` for any scheme
 * that is not one of the handful the URL Standard calls "special" (http, https,
 * ws, wss, ftp, file). `app:` is not one of them, so
 *
 *     new URL('app://bundle/index.html').origin  // => "null"
 *
 * Comparing that against the literal `'app://bundle'` fails, which - if the IPC
 * sender check were written the obvious way - would reject every call the real
 * renderer makes in a packaged build while quietly working in development, where
 * the renderer is served over http. Protocol and host are well defined for every
 * parseable URL, so those are what get compared.
 */
export function isSameOrigin(url: string | undefined, expected: string): boolean {
  if (!url) return false;
  try {
    const actual = new URL(url);
    const allowed = new URL(expected);
    return actual.protocol === allowed.protocol && actual.host === allowed.host;
  } catch {
    return false;
  }
}
