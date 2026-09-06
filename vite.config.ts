import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Production is locked down: no inline script, no outbound connections, no framing.
 * The dev server needs two concessions - `'unsafe-inline'` for the React Refresh
 * preamble that `@vitejs/plugin-react` injects, and a websocket for HMR - so the
 * policy is swapped per mode rather than being weakened everywhere.
 */
const CSP_PROD = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  // `frame-ancestors` is intentionally absent: it is ignored in a <meta> CSP.
  // `src/main/protocol.ts` sends it as a real header on every app:// response.
].join('; ');

const CSP_DEV = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: http://localhost:5173",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'junkreaper-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        return html.replace('%JUNKREAPER_CSP%', ctx.server ? CSP_DEV : CSP_PROD);
      },
    },
  };
}

/**
 * The renderer is an ordinary Vite + React app rooted at `src/renderer`.
 *
 * `base: './'` keeps every emitted asset URL relative, because in production the
 * bundle is not served from a web origin: `src/main/protocol.ts` registers a
 * privileged `app://` scheme and streams `dist/renderer` through it. (Loading the
 * bundle over `file://` would break, since Chromium refuses cross-origin
 * `<script type="module">` fetches from opaque file origins.)
 *
 * `publicDir` points at the repo-level `assets/` folder, so `assets/audio/*.mp3`
 * is reachable from the renderer as `audio/*.mp3` in both dev and production.
 */
export default defineConfig({
  root: here('./src/renderer'),
  base: './',
  publicDir: here('./assets'),
  plugins: [react(), cspPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: here('./dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
    // The renderer only ever runs inside this app's bundled Chromium.
    target: 'chrome130',
  },
  clearScreen: false,
});
