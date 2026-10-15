# Junkreaper

> This repo also contains **[ClutterQuote](clutterquote/README.md)**, an instant-quote and booking engine for junk removal businesses, in `clutterquote/`.

A desktop app whose main view is an elevator riding up a high-rise while, in the
background, Playwright drives headless Chromium to bring your saved account
sessions back online. **Every account that comes back online is one floor.** Reach
the penthouse and every session is live.

Electron + React + Playwright, TypeScript throughout.

```
┌──────────────┐   restores    ┌──────────────────┐   ElevatorAction   ┌───────────┐
│ cookie jars  │ ────────────► │ headless Chromium│ ─────────────────► │  the car  │
│ + profiles   │               │ (one per account)│   "advance"        │ goes up 1 │
└──────────────┘               └──────────────────┘                    └───────────┘
```

---

## Quick start

```bash
npm install
npx playwright install chromium     # or: npm run setup:browsers
cp config/sessions.example.json config/sessions.json
npm run dev
```

`npm run dev` starts three things in one process tree: the Vite dev server for the
renderer (with HMR), esbuild in watch mode for the main/preload/CLI bundles, and
Electron pointed at the dev server — restarted automatically whenever a main or
preload file changes. `Ctrl+C` tears the whole tree down.

No display handy? The background service runs standalone:

```bash
npm run sessions:probe -- --only my-app --verbose
```

Want to see the UI without Electron? `npm run dev:web` opens it in a normal
browser, where a mock bridge stands in for the preload and drives a scripted
restore (see [Demo mode](#demo-mode)).

### Background music

Drop a looping track at `assets/audio/elevator-music.mp3`. It is deliberately not
committed — see [`assets/audio/README.md`](assets/audio/README.md). The app is fully
functional without it; the arrival chime is synthesised with the Web Audio API and
needs no file at all.

---

## How it fits together

Three processes, one shared vocabulary.

```
src/
├── shared/            imported by ALL THREE processes; zero dependencies
│   ├── elevator.ts    the state machine (pure, unit-tested)
│   ├── types.ts       SessionTarget, SessionRecord, phases
│   ├── ipc.ts         channel names + payload types (single source of truth)
│   └── api.ts         the exact shape of window.junkreaper
│
├── main/              Electron main process — Node, full privileges
│   ├── index.ts       app lifecycle, single-instance lock, teardown
│   ├── window.ts      BrowserWindow + navigation hardening
│   ├── protocol.ts    the app:// scheme that serves the built renderer
│   ├── ipc/register.ts   handlers, sender validation, push bridge
│   ├── config/        sessions.json loading + validation
│   └── services/      ← ELECTRON-FREE. The CLI reuses all of this verbatim.
│       ├── bootstrap.ts          builds the service graph
│       ├── sessionOrchestrator.ts  runs the sweep, emits ElevatorActions
│       ├── playwrightRunner.ts   one persistent Chromium context per account
│       ├── profileStore.ts       profile dirs + cookie jar parsing
│       └── logger.ts
│
├── preload/index.ts   sandboxed bridge; the ONLY thing crossing the boundary
├── renderer/          React app
└── cli/probe.ts       headless driver for the same pipeline
```

### The elevator is a pure state machine

`src/shared/elevator.ts` has no React, no Electron, no DOM. It exposes
`ElevatorState` — carrying `current_floor`, `total_floors` and `status_message`
exactly as named — and a reducer over a small `ElevatorAction` union:

| action      | meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `configure` | start a new ride; the building is as tall as the account count |
| `advance`   | climb one floor — **what a restored session emits**             |
| `goto`      | jump to an absolute floor (clamped)                            |
| `status`    | update the indicator text without moving                       |
| `doors`     | open/close without moving                                      |
| `settle`    | the car finished travelling: stop, open up                     |
| `reset`     | back to the lobby                                              |

Being pure is what lets the CLI reduce the *same* action stream into ASCII
(`src/cli/probe.ts`) that the React app reduces into a moving car — and it is why
the ride is covered by fast unit tests rather than browser automation.

Movement is two-phase on purpose. `advance` starts the ride and records how long it
should take (`state.rideMs`, derived from the distance); `settle` ends it. The
settle fires from a timer rather than a `transitionend` listener, because
`transitionend` never fires when the duration is zero (reduced motion) or the
element is off-screen — the car would hang between floors forever.

### Three ways to drive the car

All three land in the same reducer:

1. **The React tree** — the buttons in the control bar.
2. **In-page background tasks**, via a DOM `CustomEvent`:

   ```js
   window.dispatchEvent(
     new CustomEvent('junkreaper:elevator', { detail: { type: 'advance' } }),
   );
   // or, from the devtools console:
   window.elevator.advance('Reporting API');
   window.elevator.status('waiting on SSO');
   window.elevator.state; // live read-only view
   ```

3. **The Electron main process**, via `IpcPush.ElevatorCommand` — this is the path a
   restored Playwright context takes.

`window.elevator` funnels through the same DOM event an external caller would use,
so there is no privileged back door into the reducer.

### Session restoration

`PlaywrightSessionRunner` stacks two independent mechanisms per account:

1. **A real persistent Chromium profile.** `chromium.launchPersistentContext(dir)`
   gives each account its own durable cookie jar, localStorage, IndexedDB and
   service workers, so a session that was alive last run is usually alive again
   with nothing injected at all.
2. **Cookies injected from disk.** This is what bootstraps a *new* profile, and it
   has to be done by hand: `launchPersistentContext` has no `storageState` option,
   unlike `browser.newContext()`. Cookies go in with `context.addCookies()`;
   localStorage is replayed with an origin-guarded `addInitScript`.

After a successful restore the live state is exported back to
`storage-state/<id>.json`, so each run refreshes the jar with rotated cookies.

**A floor is awarded only when a session actually comes online.** A failure holds
the car where it is, writes a diagnostic screenshot, and says what went wrong —
almost always "this profile needs a fresh sign-in".

### Everything the runner can read as a cookie jar

Drop any of these at `<state>/cookies/<target-id>.json` (or `.txt`):

- a Playwright `storageState` object — `{ cookies, origins }`
- a bare JSON array, which is what most browser cookie-export extensions emit
- Netscape `cookies.txt`, the curl/wget/yt-dlp jar format, `#HttpOnly_` prefix included

They are normalised on the way in: millisecond expiries become seconds, expired
cookies are dropped and counted, `sameSite` is mapped to Playwright's spelling, and
`SameSite=None` forces `secure` — because Chromium rejects that combination
outright rather than telling you why.

---

## Configuration

`config/sessions.json` (gitignored). Resolution order, first hit wins:

1. `$JUNKREAPER_SESSIONS`
2. `<userData>/sessions.json`
3. `<repo>/config/sessions.json`
4. `<repo>/config/sessions.example.json` — so a fresh clone runs
5. `<resources>/sessions.json` — packaged builds only
6. `<resources>/sessions.example.json` — shipped by `extraResources`, so a fresh
   *install* runs too

Steps 5 and 6 matter because a packaged app's working directory is not the repo.
Without them a first run of an installed build finds no config at all and dies on
an error dialog.

Comments are allowed. Validation reports **every** problem at once, each with its
JSON path (`targets[2].probe.readySelector must be a non-empty string`).

```jsonc
{
  "defaults": {
    "headless": true,
    "concurrency": 1,          // 1 keeps the elevator legible
    "timeoutMs": 45000,
    "waitUntil": "domcontentloaded",
    "keepContextsOpen": true,  // leave restored tabs alive and usable
    "proxy": { "server": "http://proxy.internal:3128", "bypass": "localhost" }
  },
  "targets": [
    {
      "id": "admin",                    // also the profile directory name
      "label": "Admin Console",
      "url": "https://admin.example.com/dashboard",
      "profile": "shared-sso",          // optional: share one profile across targets
      "floorLabel": "Admin",            // optional: the floor plaque
      "enabled": true,
      "timeoutMs": 30000,
      "probe": {
        "readySelector": "[data-user-menu]",
        "loggedOutSelector": "input[type='password']",
        "loggedOutUrlPattern": ["*/login*", "*/signin*"]
      }
    }
  ]
}
```

### About `probe`

Strongest signal first: `readySelector` beats `loggedOutSelector`, which beats
`loggedOutUrlPattern`, which beats the bare HTTP status. Configure at least a
`readySelector` — without one the app can only check that the page loaded, and it
will honestly report the session as *unverified* rather than claim it is signed in.

### State on disk

Under the Electron `userData` directory (or `.junkreaper/` for the CLI, overridable
with `$JUNKREAPER_HOME`):

```
profiles/<profile>/       persistent Chromium user-data-dir
storage-state/<id>.json   exported after each successful run   (mode 0600)
cookies/<id>.json|.txt    your seed export, read but never written
diagnostics/<id>.png      screenshot captured when a restore fails
```

These directories hold live session credentials. They are gitignored, written with
restrictive permissions, and should be treated like any other secret store.

---

## Scripts

| script                  | what it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run dev`           | Vite + esbuild watch + Electron, with auto-restart                |
| `npm run dev:web`       | renderer only, in a browser, with the demo bridge                |
| `npm run build`         | esbuild bundles + `vite build` into `dist/`                       |
| `npm start`             | build, then run the packaged-style app                           |
| `npm run typecheck`     | both surfaces, strictly (see below)                              |
| `npm test`              | unit tests for the reducer, config loader and cookie parsing      |
| `npm run test:smoke`    | end-to-end restore against a local sign-in server                 |
| `npm run sessions:probe`| drive the background service headlessly                          |
| `npm run setup:browsers`| `playwright install chromium`                                    |
| `npm run package`       | electron-builder                                                 |

### Two typecheck passes, not one

`tsconfig.node.json` (no DOM lib) and `tsconfig.web.json` (no Node types) are
checked separately. That is what catches a DOM API leaking into the main process or
a Node API leaking into the renderer — a single merged config would happily accept
both. `src/shared/` is compiled by both, so it is provably portable.

### Why relative imports carry their extension

Every relative import in this repo is written as `./foo.ts` / `./Bar.tsx`. That is
the one spelling understood by all four consumers: Vite, esbuild, tsc, and — the
reason it is worth it — Node's native type-stripping loader. So `npm test` is
literally `node --test "tests/**/*.test.ts"` against the TypeScript sources, with
no test framework, no transpile step and no watch-mode indirection.

---

## Security posture

The renderer is treated as untrusted, because it renders text that came from
whatever web app you pointed the runner at.

- `contextIsolation: true`, `nodeIntegration: false`, **`sandbox: true`**. The
  sandboxed preload is why the preload bundle is CommonJS, and why it may use
  nothing but `contextBridge` and `ipcRenderer`.
- The renderer's entire capability surface is five verbs on `window.junkreaper`.
  No `fs`, no `path`, no Playwright handle. Raw `IpcRendererEvent`s are never
  forwarded — handing one to the renderer would leak `sender`.
- Every `ipcMain.handle` validates its sender's origin.
- `openProfileDir` only ever reveals a directory a *configured target* owns, and
  target ids are slug-validated so a config cannot escape the state root with `..`.
- Production is served from a privileged `app://` scheme, not `file://` — a real
  origin, a secure context, path-traversal checked, with CSP,
  `X-Content-Type-Options` and `Referrer-Policy` sent as real headers.
  (`frame-ancestors` is *ignored* in a `<meta>` CSP, which is exactly why it is
  delivered as a header.)
- Navigation is pinned to that one origin; anything else is handed to the user's
  real browser. `webview` attachment is refused.
- Values read out of cookie files are escaped before being embedded in the
  generated localStorage seed script, `<`/`>`/U+2028/U+2029 included.

---

## Demo mode

With no preload bridge — `npm run dev:web`, or a `vite preview` build — the app
installs a mock implementing the same `JunkreaperApi` interface, so the React tree
has exactly one code path either way. It scripts a six-account restore, including
one deliberate failure, and it moves the car **only** through the public
`junkreaper:elevator` DOM event. It is a working demonstration of the background-task
contract, not a special case inside the UI.

---

## Packaging

```bash
npm run package
```

The one real gotcha: **Playwright's Chromium is not captured by the packager.** It
lives in a shared cache outside `node_modules` (`~/.cache/ms-playwright`,
`~/Library/Caches/ms-playwright`, `%LOCALAPPDATA%\ms-playwright`). Pick one:

- run `npx playwright install chromium` on the target machine;
- set `PLAYWRIGHT_BROWSERS_PATH=0` before `npm install`, which puts the browser
  inside `node_modules/playwright-core` where `asarUnpack` will ship it (~150 MB);
- or point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an existing Chrome/Chromium.

Playwright itself is unpacked from the asar archive, because it resolves its driver
relative to its own package directory and spawns it as a child process.

Linux output is an AppImage (~124 MB) and a `.deb` (~97 MB) in `release/`. The deb's
maintainer comes from `author` in `package.json` - the target refuses to build
without an email there - and `desktopName` lives in `package.json` too, because
Electron derives the Linux `app_id`/`WM_CLASS` from it; `linux.syncDesktopName`
keeps the generated `.desktop` entry's `StartupWMClass` in step so the running
window associates with its launcher icon.

---

## Troubleshooting

**Everything fails with `net::ERR_TUNNEL_CONNECTION_FAILED` or `ERR_PROXY_*`.**
You are behind a proxy Chromium cannot negotiate. Set `defaults.proxy.server` in
the config — it is forwarded to Playwright's launch options.

**A session that works in my browser reports "signed out".** The profile is
separate from your everyday browser profile by design. Seed it once: export the
cookies for that site and drop them at `<state>/cookies/<id>.json`, then run again.
Check `diagnostics/<id>.png` to see what Chromium actually rendered.

**Everything reports "loaded, sign-in unverified".** No `probe` is configured, so
the app can only see the HTTP status. Add a `readySelector`.

**Electron dies with `Running as root without --no-sandbox is not supported`.**
`npm run dev` adds the flag automatically when it detects uid 0, and says so. Never
ship a build that way.

**The music never starts.** Chromium blocks autoplay until the origin has seen a
user gesture. The player detects the `NotAllowedError` and retries behind the first
click or keypress — click the window once.

---

## Tests

```bash
npm test            # 55 unit tests: reducer, config validation, cookie parsing, origin checks
npm run test:smoke  # end-to-end, no network egress required
```

The smoke test stands up a local sign-in-protected server and runs the real
background service against it twice: once with a cold profile (must be classified
signed out, car stays in the lobby, screenshot captured), then again with a seeded
cookie jar (cookie must be injected, session detected, car must reach the top
floor, refreshed jar exported). That is the Phase 3 claim verified rather than
asserted.

## Licence

MIT
