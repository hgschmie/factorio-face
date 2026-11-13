// How the window's renderer calls into the main process: every handler checks who is calling and answers with a result
// instead of rejecting, so errors cross the process boundary as plain data.
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { IpcResult } from "./ipc.ts";
import { RENDERER_URL } from "./protocols.ts";
import { ValidationError } from "./validation.ts";

/** Registers the handler of one channel. */
export type IpcHandle = <T>(channel: string, handler: (...args: unknown[]) => Promise<T>) => void;

function describeError(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  console.error("[face] IPC handler failed:", error);
  return error instanceof Error ? error.message : String(error);
}

export function createIpcHandle(window: BrowserWindow): IpcHandle {
  // Only the main frame of our own window may call in; anything else is a bug or an attack.
  const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
    const trusted = !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === RENDERER_URL;
    if (!trusted) throw new ValidationError("IPC call from an unknown sender");
  };

  return <T>(channel: string, handler: (...args: unknown[]) => Promise<T>): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<T>> => {
      try {
        assertTrustedSender(event);
        return { ok: true, value: await handler(...args) };
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    });
  };
}
