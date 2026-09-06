import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';

export const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://bundle`;
export const APP_INDEX = `${APP_ORIGIN}/index.html`;

/**
 * Must run before `app.whenReady()`.
 *
 * The production renderer is served from a custom `app://` scheme rather than
 * `file://` for three concrete reasons:
 *
 *  - Chromium refuses cross-origin `<script type="module">` fetches from an opaque
 *    `file://` origin, and Vite emits module scripts.
 *  - `file://` is not a secure context, so `crypto.subtle`, service workers and a
 *    meaningful CSP are all off the table.
 *  - A real origin means `localStorage` and friends are scoped to the app instead of
 *    being shared with every other page the user ever opened from disk.
 */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Delivered as a real header rather than only as the `<meta>` tag in index.html,
 * because `frame-ancestors` is ignored in a meta-delivered policy. The meta tag
 * stays as defence in depth and to cover the Vite dev server, which is not served
 * through this handler.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** Must run after `app.whenReady()`. Streams `dist/renderer` over `app://bundle/`. */
export function serveRendererBundle(rendererRoot: string): void {
  const root = path.resolve(rendererRoot);

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const requested = decodeURIComponent(url.pathname);
    const relative = requested === '/' || requested === '' ? '/index.html' : requested;

    // Resolve, then prove the result is still inside the bundle: `..` segments and
    // encoded separators must not be able to read the rest of the filesystem.
    const resolved = path.resolve(root, `.${relative}`);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
    }

    try {
      const upstream = await net.fetch(pathToFileURL(resolved).toString());
      const headers = new Headers(upstream.headers);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
  });
}
