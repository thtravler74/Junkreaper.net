import process from 'node:process';
import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import type { AppInfo, SessionsSnapshot, StartOptions } from '../../shared/ipc.ts';
import { IpcPush, IpcRequest } from '../../shared/ipc.ts';
import type { Services } from '../services/bootstrap.ts';
import { isSameOrigin } from '../origin.ts';
import { APP_ORIGIN } from '../protocol.ts';

export interface IpcRegistration {
  dispose(): void;
}

/**
 * Wires the background service to the window in both directions.
 *
 * Renderer to main is request/response over `invoke`/`handle`; main to renderer is
 * a push of the whole snapshot. Every handler validates its sender, because
 * `ipcMain.handle` is reachable from any frame the window ever loads - including,
 * without the navigation hardening in `window.ts`, a hostile one.
 */
export function registerIpc(services: Services, devServerUrl: string | undefined): IpcRegistration {
  const { orchestrator, store, config, configPath, logBus } = services;
  const allowedOrigin = devServerUrl ? new URL(devServerUrl).origin : APP_ORIGIN;

  const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
    const url = event.senderFrame?.url;
    if (!url) throw new Error('ipc: sender frame is gone');
    if (!isSameOrigin(url, allowedOrigin)) {
      throw new Error(`ipc: refusing a call from ${url}`);
    }
  };

  const broadcast = <T>(channel: string, payload: T): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(channel, payload);
    }
  };

  // --- renderer -> main -----------------------------------------------------

  ipcMain.handle(IpcRequest.AppInfo, (event): AppInfo => {
    assertTrustedSender(event);
    return {
      appVersion: app.getVersion(),
      versions: {
        electron: process.versions.electron ?? 'unknown',
        chrome: process.versions.chrome ?? 'unknown',
        node: process.versions.node,
        v8: process.versions.v8,
      },
      platform: process.platform,
      profileRoot: store.profilesDir,
      configPath,
      targetCount: config.targets.filter((target) => target.enabled !== false).length,
      headlessDefault: config.defaults.headless,
      packaged: app.isPackaged,
    };
  });

  ipcMain.handle(IpcRequest.SessionsSnapshot, (event): SessionsSnapshot => {
    assertTrustedSender(event);
    return orchestrator.snapshot();
  });

  ipcMain.handle(IpcRequest.SessionsStart, (event, options: StartOptions = {}): SessionsSnapshot => {
    assertTrustedSender(event);
    return orchestrator.start(options ?? {});
  });

  ipcMain.handle(IpcRequest.SessionsStop, async (event): Promise<SessionsSnapshot> => {
    assertTrustedSender(event);
    return orchestrator.stop();
  });

  ipcMain.handle(IpcRequest.OpenProfileDir, async (event, sessionId: unknown): Promise<boolean> => {
    assertTrustedSender(event);
    if (typeof sessionId !== 'string') return false;
    // Only ever reveal a directory that a configured target actually owns.
    const target = config.targets.find((candidate) => candidate.id === sessionId);
    if (!target) return false;
    const error = await shell.openPath(store.profileDir(target));
    return error === '';
  });

  // --- main -> renderer -----------------------------------------------------

  const unsubscribe = [
    orchestrator.onSnapshot((snapshot) => broadcast(IpcPush.SessionsChanged, snapshot)),
    orchestrator.onElevator((action) => broadcast(IpcPush.ElevatorCommand, action)),
    logBus.onEntry((entry) => broadcast(IpcPush.Log, entry)),
  ];

  return {
    dispose() {
      for (const off of unsubscribe) off();
      for (const channel of Object.values(IpcRequest)) ipcMain.removeHandler(channel);
    },
  };
}
