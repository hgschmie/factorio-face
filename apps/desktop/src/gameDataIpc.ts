// IPC handlers for the data read from the user's game. None takes an argument: the program that is run is the one of the
// installation in use, whose folder comes from the native chooser alone, and it is run only after the user agreed in a
// native message box of this process, every time. The renderer can open that box, cancel a run, discard what was read,
// read the data and where it comes from, and have its own window loaded again.
import { dialog, type BrowserWindow } from "electron";
import { CONFIRM_RUN, type ReadConfirmation } from "./gameData/confirmation.ts";
import type { GameDataService } from "./gameData/service.ts";
import { CHANNELS } from "./ipc.ts";
import type { IpcHandle } from "./ipcHandle.ts";
import { ValidationError } from "./validation.ts";

/** The native confirmation: a sheet of the window. Anything but the button that agrees declines. */
export async function confirmGameRead(window: BrowserWindow, confirmation: ReadConfirmation): Promise<boolean> {
  if (window.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(window, { type: "question", ...confirmation, buttons: [...confirmation.buttons], noLink: true });
  return response === CONFIRM_RUN;
}

export function registerGameDataIpc(window: BrowserWindow, handle: IpcHandle, service: GameDataService): void {
  handle(CHANNELS.getGameData, async () => service.current());
  handle(CHANNELS.getGameDataStatus, () => service.status());
  handle(CHANNELS.readGameData, () => service.read());
  handle(CHANNELS.cancelGameDataRead, () => service.cancel());
  handle(CHANNELS.discardGameData, () => service.discard());
  // The page cannot navigate, itself included (security.ts), so the window is loaded again here; the answer goes out first.
  handle(CHANNELS.applyGameData, async (): Promise<null> => {
    if (service.busy) throw new ValidationError("The game is being read. Cancel that first.");
    setImmediate(() => {
      if (!window.isDestroyed()) window.webContents.reload();
    });
    return null;
  });
}
