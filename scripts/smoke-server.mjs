/**
 * A two-page web app that exists only to be signed into.
 *
 * `/app` renders a "signed in" heading when it sees a valid `sid` cookie, and
 * otherwise redirects to `/login`, which renders a password form. That is exactly
 * the shape `SessionTarget.probe` is built to distinguish, so pointing the real
 * background service at this server exercises cookie restoration end to end
 * without depending on a third-party site or on network egress.
 */
import { createServer } from 'node:http';

export const VALID_TOKEN = 'smoke-session-token';

function parseCookies(header = '') {
  const jar = new Map();
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return jar;
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

export function startSmokeServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const cookies = parseCookies(request.headers.cookie);
    const signedIn = cookies.get('sid') === VALID_TOKEN;

    if (url.pathname === '/login') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        page(
          'Sign in',
          '<h1>Sign in</h1><form method="post" action="/login"><input name="user"><input type="password" name="pw"><button>Go</button></form>',
        ),
      );
      return;
    }

    if (url.pathname === '/app') {
      if (!signedIn) {
        response.writeHead(302, { location: '/login' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        page('Dashboard', '<h1 data-signed-in>Signed in as ada</h1><p>Restored from a saved cookie.</p>'),
      );
      return;
    }

    response.writeHead(302, { location: '/app' });
    response.end();
  });

  return new Promise((resolve) => {
    // Port 0: let the OS pick, so a busy machine cannot make the smoke test flaky.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
