#!/usr/bin/env node
/**
 * End-to-end check of the background service, with no network egress required.
 *
 * Two passes against a local sign-in-protected server:
 *
 *   pass 1 - a fresh profile with no cookies. The probe must classify the target as
 *            signed out (redirected to /login) and the elevator must stay in the
 *            lobby.
 *   pass 2 - the same target, with a seed cookie jar dropped into `cookies/<id>.json`.
 *            Playwright must inject it, the app must render the signed-in heading,
 *            the elevator must reach the top floor, and the refreshed jar must be
 *            exported to `storage-state/<id>.json`.
 *
 * That is the full Phase 3 claim - "restore a saved session, then step the
 * elevator" - verified rather than asserted.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { startSmokeServer, VALID_TOKEN } from './smoke-server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE = path.join(ROOT, 'dist', 'cli', 'probe.cjs');

function runProbe(home, configPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PROBE, '--home', home, '--config', configPath], {
      cwd: ROOT,
      env: { ...process.env, JUNKREAPER_LOG_LEVEL: 'info' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ code, output }));
  });
}

const failures = [];
function check(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail && !condition ? `\n         ${detail}` : ''}`);
  if (!condition) failures.push(label);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const server = await startSmokeServer();
const home = await mkdtemp(path.join(tmpdir(), 'junkreaper-smoke-'));
console.log(`smoke server on ${server.origin}\nstate root ${home}\n`);

try {
  if (!(await exists(PROBE))) {
    console.error(`missing ${PROBE} - run \`npm run build:main\` first`);
    process.exit(2);
  }

  const configPath = path.join(home, 'sessions.json');
  await writeFile(
    configPath,
    JSON.stringify(
      {
        defaults: { headless: true, concurrency: 1, timeoutMs: 20000, keepContextsOpen: false },
        targets: [
          {
            id: 'smoke-app',
            label: 'Smoke App',
            url: `${server.origin}/app`,
            probe: {
              readySelector: '[data-signed-in]',
              loggedOutSelector: "input[type='password']",
              loggedOutUrlPattern: ['*/login*'],
            },
          },
        ],
      },
      null,
      2,
    ),
  );

  // --- pass 1: no cookies anywhere -----------------------------------------
  console.log('pass 1 - cold profile, expecting a signed-out verdict');
  const cold = await runProbe(home, configPath);
  check('probe exits non-zero when the session cannot be restored', cold.code === 1, `exit=${cold.code}`);
  check('the target is reported as signed out', /signed out|login/i.test(cold.output), cold.output.slice(-400));
  check('the elevator stays in the lobby', /\bL \|\[###\]\| Lobby/.test(cold.output), cold.output.slice(-400));
  check('a diagnostic screenshot was captured', await exists(path.join(home, 'diagnostics', 'smoke-app.png')));

  // --- pass 2: seed a saved cookie jar --------------------------------------
  console.log('\npass 2 - with a saved cookie jar, expecting a restored session');
  await mkdir(path.join(home, 'cookies'), { recursive: true });
  await writeFile(
    path.join(home, 'cookies', 'smoke-app.json'),
    JSON.stringify([{ name: 'sid', value: VALID_TOKEN, domain: '127.0.0.1', path: '/', expires: -1 }], null, 2),
  );

  const warm = await runProbe(home, configPath);
  check('probe exits zero once the session is restored', warm.code === 0, `exit=${warm.code}`);
  check('the saved cookie was injected before navigating', /restored 1 cookies/.test(warm.output), warm.output.slice(-400));
  check('the session is reported online', /smoke-app\s+ready \(floor 1\)/.test(warm.output), warm.output.slice(-400));
  check('the elevator reached the top floor', /^\s+1 \|\[\| \|\]\|/m.test(warm.output), warm.output.slice(-500));
  check('the penthouse message fired', /Penthouse/.test(warm.output), warm.output.slice(-300));

  const exported = path.join(home, 'storage-state', 'smoke-app.json');
  check('the refreshed jar was exported', await exists(exported));
  if (await exists(exported)) {
    const state = JSON.parse(await readFile(exported, 'utf8'));
    check(
      'the exported jar carries the live session cookie',
      Array.isArray(state.cookies) && state.cookies.some((c) => c.name === 'sid' && c.value === VALID_TOKEN),
    );
  }
} finally {
  await server.close();
  await rm(home, { recursive: true, force: true });
}

console.log(`\n${failures.length === 0 ? 'smoke: all checks passed' : `smoke: ${failures.length} check(s) failed`}`);
process.exit(failures.length === 0 ? 0 : 1);
