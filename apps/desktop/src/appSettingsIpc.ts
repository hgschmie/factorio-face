// IPC handlers for the settings of the application. None takes an argument: the one path involved, the game folder, comes
// from the native chooser in this process, so the renderer cannot make the main process read a folder of its choosing.
import { dialog, type BrowserWindow } from "electron";
import { gameFolderDialogOptions, type GameSettings } from "./gameSettings.ts";
import { CHANNELS } from "./ipc.ts";
import type { IpcHandle } from "./ipcHandle.ts";

export function registerAppSettingsIpc(window: BrowserWindow, handle: IpcHandle, settings: GameSettings): void {
  handle(CHANNELS.getAppSettings, () => settings.state());

  handle(CHANNELS.chooseGameFolder, () =>
    settings.chooseWith(async (state) => {
      const result = await dialog.showOpenDialog(window, gameFolderDialogOptions(process.platform, state.chosenFolder));
      return result.canceled ? undefined : result.filePaths[0];
    }),
  );

  handle(CHANNELS.resetGameFolder, () => settings.reset());
}
