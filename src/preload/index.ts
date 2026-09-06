import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { BRIDGE_VERSION, type JunkreaperApi, type Unsubscribe } from '../shared/api.ts';
import type { ElevatorAction } from '../shared/elevator.ts';
import type { AppInfo, SessionsSnapshot, StartOptions } from '../shared/ipc.ts';
import { IpcPush, IpcRequest } from '../shared/ipc.ts';
import type { LogEntry } from '../shared/types.ts';

/**
 * The only thing that crosses the context boundary.
 *
 * This bundle is CommonJS and runs in a **sandboxed** preload, so it may use
 * nothing but `contextBridge` and `ipcRenderer`: no `fs`, no `path`, no direct
 * access to the orchestrator. The renderer therefore cannot reach the filesystem
 * or Playwright except through the five verbs published below.
 *
 * Note that raw `IpcRendererEvent`s are never forwarded - handing the renderer an
 * event object would leak `sender`, and with it a way to send on arbitrary channels.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.off(channel, handler);
  };
}

const api: JunkreaperApi = {
  bridgeVersion: BRIDGE_VERSION,

  getAppInfo: () => ipcRenderer.invoke(IpcRequest.AppInfo) as Promise<AppInfo>,

  sessions: {
    snapshot: () => ipcRenderer.invoke(IpcRequest.SessionsSnapshot) as Promise<SessionsSnapshot>,
    start: (options?: StartOptions) => ipcRenderer.invoke(IpcRequest.SessionsStart, options ?? {}) as Promise<SessionsSnapshot>,
    stop: () => ipcRenderer.invoke(IpcRequest.SessionsStop) as Promise<SessionsSnapshot>,
    openProfileDir: (sessionId: string) => ipcRenderer.invoke(IpcRequest.OpenProfileDir, sessionId) as Promise<boolean>,
  },

  onSessionsChanged: (listener) => subscribe<SessionsSnapshot>(IpcPush.SessionsChanged, listener),
  onElevatorCommand: (listener) => subscribe<ElevatorAction>(IpcPush.ElevatorCommand, listener),
  onLog: (listener) => subscribe<LogEntry>(IpcPush.Log, listener),
};

contextBridge.exposeInMainWorld('junkreaper', api);
