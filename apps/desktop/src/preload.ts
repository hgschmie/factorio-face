// Sandboxed preload: exposes the narrow FaceApi and nothing else. Bundled to CommonJS; it may only import electron and ipc.ts.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { ASSET_HOST_CATALOG, ASSET_SCHEME, CHANNELS, type FaceApi, type MenuCommand } from "./ipc.ts";

const api: FaceApi = {
  platform: process.platform,
  catalogAssetUrl: `${ASSET_SCHEME}://${ASSET_HOST_CATALOG}/`,
  newProject: () => ipcRenderer.invoke(CHANNELS.newProject),
  openProject: () => ipcRenderer.invoke(CHANNELS.openProject),
  loadProject: (path) => ipcRenderer.invoke(CHANNELS.loadProject, path),
  saveProject: (request) => ipcRenderer.invoke(CHANNELS.saveProject, request),
  saveProjectAs: (data) => ipcRenderer.invoke(CHANNELS.saveProjectAs, data),
  getRecentProjects: () => ipcRenderer.invoke(CHANNELS.getRecentProjects),
  clearRecentProjects: () => ipcRenderer.invoke(CHANNELS.clearRecentProjects),
  confirmUnsavedChanges: () => ipcRenderer.invoke(CHANNELS.confirmUnsavedChanges),
  paste: () => ipcRenderer.invoke(CHANNELS.paste),
  setDirty: (dirty) => ipcRenderer.send(CHANNELS.setDirty, dirty === true),
  onMenuCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: MenuCommand): void => listener(command);
    ipcRenderer.on(CHANNELS.menuCommand, handler);
    return () => ipcRenderer.removeListener(CHANNELS.menuCommand, handler);
  },
  onSaveBeforeClose: (handler) => {
    const listener = (): void => {
      handler()
        .catch(() => false)
        .then((saved) => ipcRenderer.send(CHANNELS.saveBeforeCloseResult, saved === true));
    };
    ipcRenderer.on(CHANNELS.saveBeforeClose, listener);
    return () => ipcRenderer.removeListener(CHANNELS.saveBeforeClose, listener);
  },
};

contextBridge.exposeInMainWorld("face", api);
