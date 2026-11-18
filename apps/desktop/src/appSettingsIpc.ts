// IPC handlers for the settings of the application. Those about the game take no argument: the one path involved, the game
// folder, comes from the native chooser in this process, so the renderer cannot make the main process read a folder of its
// choosing. What the user hid of a module does come from the renderer; the store validates it before anything is written.
import { dialog, type BrowserWindow } from "electron";
import type { AppSettingsStore } from "./appSettings.ts";
import { gameFolderDialogOptions, type GameSettings } from "./gameSettings.ts";
import { CHANNELS } from "./ipc.ts";
import type { IpcHandle } from "./ipcHandle.ts";

export function registerAppSettingsIpc(window: BrowserWindow, handle: IpcHandle, settings: GameSettings, store: AppSettingsStore): void {
  handle(CHANNELS.getAppSettings, () => settings.state());

  handle(CHANNELS.chooseGameFolder, () =>
    settings.chooseWith(async (state) => {
      const result = await dialog.showOpenDialog(window, gameFolderDialogOptions(process.platform, state.chosenFolder));
      return result.canceled ? undefined : result.filePaths[0];
    }),
  );

  handle(CHANNELS.resetGameFolder, () => settings.reset());

  handle(CHANNELS.getHiddenItems, async () => (await store.get()).hidden);

  handle(CHANNELS.setHiddenItems, async (items) => (await store.setHiddenItems(items)).hidden);
}
