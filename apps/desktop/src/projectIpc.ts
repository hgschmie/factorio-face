// IPC handlers of the window: the project operations and the paste of the canvas context menu. Every argument is validated before
// it reaches the filesystem or a dialog.
import { dialog, ipcMain, type BrowserWindow, type FileFilter, type IpcMainInvokeEvent } from "electron";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { CHANNELS, PROJECT_FILE_EXTENSION, UNSAVED_CHOICES, type IpcResult, type LoadedProject, type ProjectData, type SavedProject, type UnsavedChoice } from "./ipc.ts";
import { createEmptyProject, readProject, writeProject } from "./projectStore.ts";
import { RENDERER_URL } from "./protocols.ts";
import type { RecentProjects } from "./recentProjects.ts";
import { parseProjectData, parseProjectPath, parseSaveProjectRequest, ValidationError, withProjectExtension } from "./validation.ts";

export interface ProjectIpcContext {
  readonly window: BrowserWindow;
  readonly recentProjects: RecentProjects;
  /** Folder the open and save dialogs start in; undefined leaves the choice to the operating system. */
  readonly projectsDirectory?: string;
  onRecentProjectsChanged(): void;
  /** The window now shows the project at `path`; null for an unsaved project. */
  onProjectPathChanged(path: string | null): void;
}

export async function askUnsavedChanges(window: BrowserWindow): Promise<UnsavedChoice> {
  const { response } = await dialog.showMessageBox(window, {
    type: "question",
    message: "Save changes to this project?",
    detail: "Your changes will be lost if you do not save them.",
    buttons: ["Save", "Discard Changes", "Cancel"],
    defaultId: 0,
    cancelId: 2,
  });
  return UNSAVED_CHOICES[response] ?? "cancel";
}

function describeError(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  console.error("[face] IPC handler failed:", error);
  return error instanceof Error ? error.message : String(error);
}

const PROJECT_FILE_FILTERS: FileFilter[] = [{ name: "face project", extensions: [PROJECT_FILE_EXTENSION.slice(1)] }];

function suggestedFileName(projectName: string): string {
  const cleaned = projectName.replace(/[^A-Za-z0-9 ._-]+/g, " ").trim();
  return withProjectExtension(cleaned.length > 0 ? cleaned : "face-project");
}

export function registerProjectIpc(context: ProjectIpcContext): void {
  const { window, recentProjects, projectsDirectory } = context;

  // Only the main frame of our own window may call in; anything else is a bug or an attack.
  const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
    const trusted = !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === RENDERER_URL;
    if (!trusted) throw new ValidationError("IPC call from an unknown sender");
  };

  const handle = <T>(channel: string, handler: (...args: unknown[]) => Promise<T>): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<T>> => {
      try {
        assertTrustedSender(event);
        return { ok: true, value: await handler(...args) };
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    });
  };

  const remember = async (path: string, name: string): Promise<void> => {
    await recentProjects.add(path, name);
    context.onRecentProjectsChanged();
    context.onProjectPathChanged(path);
  };

  const load = async (path: string): Promise<LoadedProject> => {
    const project = await readProject(path);
    await remember(path, project.data.manifest.name);
    return project;
  };

  const save = async (path: string, data: ProjectData): Promise<SavedProject> => {
    await writeProject(path, data);
    await remember(path, data.manifest.name);
    return { path };
  };

  const saveWithDialog = async (data: ProjectData): Promise<SavedProject | null> => {
    const name = suggestedFileName(data.manifest.name);
    const result = await dialog.showSaveDialog(window, {
      title: "Save Project As",
      message: "A face project is a single file. Choose its name and location.",
      nameFieldLabel: "Project file:",
      buttonLabel: "Save Project",
      defaultPath: projectsDirectory === undefined ? name : join(projectsDirectory, name),
      filters: PROJECT_FILE_FILTERS,
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return null;
    const path = withProjectExtension(result.filePath);
    // The panel asked about replacing the name it returned, not the one that only exists once the extension is appended.
    if (path !== result.filePath && existsSync(path)) throw new ValidationError(`${basename(path)} already exists. Choose that file in the dialog to replace it.`);
    return save(parseProjectPath(path), data);
  };

  handle(CHANNELS.newProject, async (): Promise<LoadedProject> => {
    context.onProjectPathChanged(null);
    return { path: null, data: createEmptyProject() };
  });

  handle(CHANNELS.openProject, async (): Promise<LoadedProject | null> => {
    const result = await dialog.showOpenDialog(window, { title: "Open Project", buttonLabel: "Open Project", defaultPath: projectsDirectory, filters: PROJECT_FILE_FILTERS, properties: ["openFile"] });
    const selected = result.filePaths[0];
    return result.canceled || selected === undefined ? null : load(parseProjectPath(selected));
  });

  handle(CHANNELS.loadProject, (path) => load(parseProjectPath(path)));

  handle(CHANNELS.saveProject, (request) => {
    const { path, data } = parseSaveProjectRequest(request);
    return path === null ? saveWithDialog(data) : save(path, data);
  });

  handle(CHANNELS.saveProjectAs, (data) => saveWithDialog(parseProjectData(data)));

  handle(CHANNELS.getRecentProjects, () => recentProjects.list());

  handle(CHANNELS.clearRecentProjects, async (): Promise<null> => {
    await recentProjects.clear();
    context.onRecentProjectsChanged();
    return null;
  });

  handle(CHANNELS.confirmUnsavedChanges, () => askUnsavedChanges(window));

  // The page cannot start a paste, so the window does it on its behalf. The clipboard reaches the page in the paste event only.
  handle(CHANNELS.paste, async (): Promise<null> => {
    window.webContents.paste();
    return null;
  });
}
