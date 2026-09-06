import process from 'node:process';
import { app, dialog, BrowserWindow } from 'electron';
import { registerIpc, type IpcRegistration } from './ipc/register.ts';
import { registerAppSchemePrivileges, serveRendererBundle } from './protocol.ts';
import { createServices, type Services } from './services/bootstrap.ts';
import { createMainWindow, resolvePreloadPath, resolveRendererRoot } from './window.ts';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let services: Services | null = null;
let ipc: IpcRegistration | null = null;

// Custom scheme privileges have to be declared before the app is ready.
registerAppSchemePrivileges();

// A second launch should focus the running window, not start a second Chromium
// fleet against the same profile directories.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void main();
}

async function main(): Promise<void> {
  await app.whenReady();

  if (!devServerUrl) serveRendererBundle(resolveRendererRoot());

  try {
    services = await createServices({
      stateRoot: app.getPath('userData'),
      cwd: app.isPackaged ? app.getPath('userData') : process.cwd(),
    });
  } catch (error) {
    dialog.showErrorBox('Junkreaper could not start', (error as Error).message);
    app.quit();
    return;
  }

  ipc = registerIpc(services, devServerUrl);
  createMainWindow({ preloadPath: resolvePreloadPath(), devServerUrl });

  app.on('activate', () => {
    // macOS: clicking the dock icon with no windows open reopens one.
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow({ preloadPath: resolvePreloadPath(), devServerUrl });
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Headless Chromium instances are children of this process; none of them may
// outlive the window. `before-quit` is deferred once so the teardown can finish.
let teardownStarted = false;
app.on('before-quit', (event) => {
  if (teardownStarted || !services) return;
  teardownStarted = true;
  event.preventDefault();
  void (async () => {
    ipc?.dispose();
    await services?.orchestrator.dispose().catch(() => {});
    app.exit(0);
  })();
});

app.on('web-contents-created', (_event, contents) => {
  // Belt and braces alongside window.ts: nothing in this app should ever attach a
  // webview or open a second renderer.
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
