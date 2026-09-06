import path from 'node:path';
import process from 'node:process';
import { BrowserWindow, shell } from 'electron';
import { isSameOrigin } from './origin.ts';
import { APP_INDEX, APP_ORIGIN } from './protocol.ts';

export interface WindowOptions {
  preloadPath: string;
  /** Set by `scripts/dev.mjs`; absent in a packaged build. */
  devServerUrl?: string | undefined;
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    // Matches the renderer's shaft background, so the first paint does not flash white.
    backgroundColor: '#070910',
    autoHideMenuBar: true,
    title: 'Junkreaper',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: options.preloadPath,
      // The three settings that matter. `sandbox: true` is why the preload bundle is
      // CommonJS and why it may only touch `contextBridge`/`ipcRenderer`.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());
  hardenNavigation(window, options.devServerUrl);

  if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadURL(APP_INDEX);
  }

  return window;
}

/**
 * The renderer is an app shell, not a browser. Anything that would navigate it
 * somewhere else, or spawn a second window, is refused; genuine outbound links are
 * handed to the user's real browser instead.
 */
function hardenNavigation(window: BrowserWindow, devServerUrl: string | undefined): void {
  const allowedOrigin = devServerUrl ? new URL(devServerUrl).origin : APP_ORIGIN;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isSameOrigin(url, allowedOrigin)) return;
    event.preventDefault();
    if (url.startsWith('https://')) void shell.openExternal(url);
  });

  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

export function resolvePreloadPath(): string {
  // `__dirname` is dist/main at runtime, because esbuild emits CommonJS.
  return path.join(__dirname, '..', 'preload', 'index.cjs');
}

export function resolveRendererRoot(): string {
  return path.join(__dirname, '..', 'renderer');
}
