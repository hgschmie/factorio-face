// IPC handlers of the window: the project operations and the paste of the canvas context menu. Every argument is validated before
// it reaches the filesystem or a dialog.
import { dialog, type BrowserWindow, type FileFilter } from "electron";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { createEmptyProject } from "./emptyProject.ts";
import type { Examples } from "./examples.ts";
import { CHANNELS, PROJECT_FILE_EXTENSION, UNSAVED_CHOICES, type LoadedProject, type ProjectData, type SavedProject, type UnsavedChoice } from "./ipc.ts";
import type { IpcHandle } from "./ipcHandle.ts";
import { readProject, writeProject } from "./projectStore.ts";
import { readLastProject, type RecentProjects } from "./recentProjects.ts";
import { parseProjectData, parseProjectPath, parseSaveProjectRequest, ValidationError, withProjectExtension } from "./validation.ts";

export interface ProjectIpcContext {
  readonly window: BrowserWindow;
  readonly recentProjects: RecentProjects;
  readonly examples: Examples;
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

const PROJECT_FILE_FILTERS: FileFilter[] = [{ name: "face project", extensions: [PROJECT_FILE_EXTENSION.slice(1)] }];

function suggestedFileName(projectName: string): string {
  const cleaned = projectName.replace(/[^A-Za-z0-9 ._-]+/g, " ").trim();
  return withProjectExtension(cleaned.length > 0 ? cleaned : "face-project");
}

export function registerProjectIpc(handle: IpcHandle, context: ProjectIpcContext): void {
  const { window, recentProjects, examples, projectsDirectory } = context;

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

  // What a freshly started window asks for: the last project, recorded as opened like one chosen by hand. One that cannot be read
  // any more keeps its place in the list, as it does when it is chosen from File > Open Recent: its volume may only be missing for now.
  handle(CHANNELS.openLastProject, async (): Promise<LoadedProject | null> => {
    const project = await readLastProject(recentProjects);
    if (project?.path) await remember(project.path, project.data.manifest.name);
    return project;
  });

  // An example opens as a copy without a path: saving asks for a location, and it does not join the recent projects.
  handle(CHANNELS.openExample, async (file): Promise<LoadedProject> => {
    const project = await examples.open(file);
    context.onProjectPathChanged(null);
    return project;
  });

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
