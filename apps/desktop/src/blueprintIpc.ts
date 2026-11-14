// IPC handlers for blueprint files. Neither takes a path: the file to read and the place to write come from the native dialogs of
// this process, so the renderer cannot make the main process read or write a path of its choosing.
import { dialog, type BrowserWindow, type FileFilter } from "electron";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { readBlueprintFile, suggestedBlueprintFileName, withBlueprintExtension, writeBlueprintFile } from "./blueprintFiles.ts";
import { BLUEPRINT_FILE_EXTENSION, CHANNELS, type BlueprintFileText, type ExportedBlueprint } from "./ipc.ts";
import type { IpcHandle } from "./ipcHandle.ts";
import { parseExportBlueprintRequest, ValidationError } from "./validation.ts";

export interface BlueprintIpcContext {
  readonly window: BrowserWindow;
  /** Folder the dialogs start in; undefined leaves the choice to the operating system. */
  readonly projectsDirectory?: string;
}

const TEXT_FILES: FileFilter = { name: "Blueprint string", extensions: [BLUEPRINT_FILE_EXTENSION.slice(1)] };
// The game also imports the plain JSON of a blueprint, and so does the importer.
const IMPORT_FILTERS: FileFilter[] = [{ ...TEXT_FILES, extensions: [...TEXT_FILES.extensions, "json"] }, { name: "All files", extensions: ["*"] }];

export function registerBlueprintIpc(handle: IpcHandle, { window, projectsDirectory }: BlueprintIpcContext): void {
  // One of the two dialogs at a time: a second call while one is open answers like a cancelled dialog.
  let dialogOpen = false;
  const withDialog = async <T>(show: () => Promise<T | null>): Promise<T | null> => {
    if (dialogOpen) return null;
    dialogOpen = true;
    try {
      return await show();
    } finally {
      dialogOpen = false;
    }
  };

  handle(CHANNELS.importBlueprintFile, () =>
    withDialog(async (): Promise<BlueprintFileText | null> => {
      const result = await dialog.showOpenDialog(window, {
        title: "Import Blueprint",
        message: "Choose a text file that holds a blueprint string.",
        buttonLabel: "Import",
        defaultPath: projectsDirectory,
        filters: IMPORT_FILTERS,
        properties: ["openFile"],
      });
      const selected = result.filePaths[0];
      return result.canceled || selected === undefined ? null : readBlueprintFile(selected);
    }),
  );

  handle(CHANNELS.exportBlueprintFile, async (request) => {
    const { name, text } = parseExportBlueprintRequest(request);
    return withDialog(async (): Promise<ExportedBlueprint | null> => {
      const suggested = suggestedBlueprintFileName(name);
      const result = await dialog.showSaveDialog(window, {
        title: "Export Blueprint",
        message: "The file holds the blueprint string, as the game takes it in Import string.",
        nameFieldLabel: "Blueprint file:",
        buttonLabel: "Export",
        defaultPath: projectsDirectory === undefined ? suggested : join(projectsDirectory, suggested),
        filters: [TEXT_FILES],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return null;
      const path = withBlueprintExtension(result.filePath);
      // The panel asked about replacing the name it returned, not the one that only exists once the extension is appended.
      if (path !== result.filePath && existsSync(path)) throw new ValidationError(`${basename(path)} already exists. Choose that file in the dialog to replace it.`);
      await writeBlueprintFile(path, text);
      return { path };
    });
  });
}
