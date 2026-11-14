// The complete contract between the Electron main process and the renderer.
// Main and preload import it at runtime; the renderer imports its types, and constants only through the pure modules it shares with
// the main process (emptyProject.ts). Keep it free of Node and Electron imports.

export const APP_NAME = "FActorio Circuit Editor";
export const APP_ID = "de.softwareforge.face";

/** The renderer bundle is served from `face-app://bundle/`, so its origin is not file:// and has no access to local files. */
export const APP_SCHEME = "face-app";
export const APP_HOST = "bundle";

export const ASSET_SCHEME = "face-asset";
/** Host part of asset URLs that maps to the catalog asset root: `face-asset://catalog/<relative path>`. */
export const ASSET_HOST_CATALOG = "catalog";

export const PROJECT_FORMAT_VERSION = 1;
/** A project is one file with this extension: a zip archive. */
export const PROJECT_FILE_EXTENSION = ".faceproj";
export const MANIFEST_FILE_NAME = "face.json";
export const CIRCUIT_FILE_EXTENSION = ".face";
export const DEFAULT_CIRCUIT_FILE = "main.face";

export const LIMITS = {
  pathLength: 4096,
  /** Size of a project file (the zip archive) on disk. */
  projectFileBytes: 64_000_000,
  /** Entries of a project file, ignored ones included. */
  projectEntries: 4096,
  /** Sum of the uncompressed sizes of the manifest and the circuit files of one project. */
  projectContentBytes: 128_000_000,
  projectNameLength: 200,
  circuitFiles: 256,
  circuitFileNameLength: 128,
  /** UTF-16 code units of one circuit source. */
  circuitSourceLength: 5_000_000,
  manifestBytes: 1_000_000,
  /** Nesting depth of unknown manifest fields. */
  manifestExtrasDepth: 32,
  modules: 64,
  customSignalGroups: 256,
  customSignalsPerGroup: 4096,
  identifierLength: 200,
  recentProjects: 10,
  /** Example projects listed from the examples directory. */
  examples: 64,
  exampleFileNameLength: 255,
} as const;

// Project format v1 (ADR 0001, item 6): a zip archive (*.faceproj) with face.json and the *.face sources at its root; assets/ is reserved for custom icons.

export interface CustomSignal {
  readonly name: string;
  /** Icon file inside the project's assets/ directory. */
  readonly icon?: string;
}

export interface CustomSignalGroup {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly signals: readonly CustomSignal[];
}

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ProjectManifest {
  readonly formatVersion: typeof PROJECT_FORMAT_VERSION;
  readonly name: string;
  readonly gameVersion: string;
  /** Enabled standard module groups, e.g. "base", "space-age". */
  readonly modules: readonly string[];
  readonly customSignalGroups: readonly CustomSignalGroup[];
  /** Circuit source file names: entries at the root of the project file. */
  readonly circuits: readonly string[];
  /** How far apart two entities may be for a circuit wire, in tiles (`WIRE_REACH_RANGE` of @face/model, 0 means unlimited); wires that span more are flagged. Absent: the default, 9. */
  readonly wireReach?: number;
  /**
   * Top-level fields of face.json that this version does not know. They are read into this record and written back as
   * top-level fields, so a project touched by a newer version survives a save. Absent when there are none.
   */
  readonly extras?: Readonly<Record<string, JsonValue>>;
}

export interface CircuitFile {
  readonly name: string;
  readonly source: string;
}

export interface ProjectData {
  readonly manifest: ProjectManifest;
  /** One entry per name in `manifest.circuits`. */
  readonly files: readonly CircuitFile[];
}

export interface LoadedProject {
  /** Absolute path of the project file; null for a new project that has never been saved. */
  readonly path: string | null;
  readonly data: ProjectData;
}

export interface SaveProjectRequest {
  /** Absolute path of the project file; null asks the user for a location first. */
  readonly path: string | null;
  readonly data: ProjectData;
}

export interface SavedProject {
  readonly path: string;
}

export interface RecentProject {
  readonly path: string;
  readonly name: string;
  /** ISO-8601 timestamp of the last open or save. */
  readonly openedAt: string;
}

export const UNSAVED_CHOICES = ["save", "discard", "cancel"] as const;
export type UnsavedChoice = (typeof UNSAVED_CHOICES)[number];

// Settings of the application on this machine. So far: where the game is installed, whose icon images the app reads.

/** `chosen`: the user's folder, usable or not. `detected`: found by the app. `none`: nothing chosen and nothing found. */
export type GameSource = "chosen" | "detected" | "none";
/** How the installed game relates to the release the catalog was generated from. */
export type GameVersionMatch = "equal" | "same-minor" | "different";

export interface GameModuleState {
  readonly name: string;
  readonly present: boolean;
}

/** What the renderer learns about the game installation. It names folders for display only; the renderer never passes one back. */
export interface AppSettingsState {
  /** The folder the user chose, as chosen; null while the app looks for the game itself. */
  readonly chosenFolder: string | null;
  /** The game's `data` directory the icons are read from; null when no installation is in use. */
  readonly dataDirectory: string | null;
  readonly source: GameSource;
  /** Version of the installation in use. */
  readonly gameVersion: string | null;
  /** The release the catalog and its icon table were generated from. */
  readonly catalogVersion: string;
  readonly versionMatch: GameVersionMatch | null;
  /** The game's own modules and whether the installation in use has them; empty without an installation. */
  readonly modules: readonly GameModuleState[];
  /** Why the chosen folder cannot be used. The choice stands; the app does not switch to another installation. */
  readonly problem: string | null;
  /** 0 for the installation found at start, one more after every change. Icon URLs carry it as `?r=<n>` once it is above 0, so images are fetched again. */
  readonly iconRevision: number;
}

/** Every invoke returns a result instead of rejecting, so errors cross the process boundary as plain data. */
export type IpcResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

// Commands forwarded from the native application menu to the renderer.

export const SIMPLE_MENU_COMMANDS = [
  "app.settings",
  "file.new",
  "file.open",
  "file.save",
  "file.saveAs",
  "edit.undo",
  "edit.redo",
  "edit.delete",
  "edit.selectAll",
  "view.circuit",
  "view.source",
  "view.split",
  "view.zoomIn",
  "view.zoomOut",
  "view.zoomReset",
  "view.fit",
  "simulation.toggleRun",
  "simulation.step",
  "simulation.reset",
  "help.shortcuts",
] as const;
export type SimpleMenuCommandId = (typeof SIMPLE_MENU_COMMANDS)[number];

export type MenuCommand =
  | { readonly id: SimpleMenuCommandId }
  | { readonly id: "file.openRecent"; readonly path: string }
  // `file`: the file name of an example, as the main process listed it.
  | { readonly id: "file.openExample"; readonly file: string };

export const CHANNELS = {
  newProject: "face:project:new",
  openProject: "face:project:open",
  loadProject: "face:project:load",
  openLastProject: "face:project:open-last",
  openExample: "face:project:open-example",
  saveProject: "face:project:save",
  saveProjectAs: "face:project:save-as",
  getRecentProjects: "face:recent:list",
  clearRecentProjects: "face:recent:clear",
  confirmUnsavedChanges: "face:confirm-unsaved",
  paste: "face:edit:paste",
  getAppSettings: "face:app-settings:get",
  chooseGameFolder: "face:app-settings:choose-game-folder",
  resetGameFolder: "face:app-settings:reset-game-folder",
  appSettingsChanged: "face:app-settings:changed",
  setDirty: "face:dirty",
  menuCommand: "face:menu-command",
  saveBeforeClose: "face:save-before-close",
  saveBeforeCloseResult: "face:save-before-close:result",
} as const;

/** The API the preload script exposes as `window.face`. */
export interface FaceApi {
  readonly platform: string;
  /** Base URL of the catalog asset root, with a trailing slash: `face-asset://catalog/`. */
  readonly catalogAssetUrl: string;
  /** Returns an empty, unsaved project. Nothing is written to disk. */
  newProject(): Promise<IpcResult<LoadedProject>>;
  /** Shows the native file dialog. Resolves with null when the user cancels. */
  openProject(): Promise<IpcResult<LoadedProject | null>>;
  loadProject(path: string): Promise<IpcResult<LoadedProject>>;
  /**
   * The project that was opened or saved last (the top of the recent projects), read as `loadProject` reads it; null when there is none.
   * An error when it cannot be read any more. Takes no arguments: the main process alone decides which project that is.
   */
  openLastProject(): Promise<IpcResult<LoadedProject | null>>;
  /**
   * An example that ships with the app, as an unsaved copy: `path` is null, so saving asks for a location and the shipped file is never
   * written. `file` is a file name the main process listed in File > Open Example, never a path; any other name is refused.
   */
  openExample(file: string): Promise<IpcResult<LoadedProject>>;
  /** Replaces the project file atomically. Resolves with null when a location dialog was cancelled. */
  saveProject(request: SaveProjectRequest): Promise<IpcResult<SavedProject | null>>;
  saveProjectAs(data: ProjectData): Promise<IpcResult<SavedProject | null>>;
  getRecentProjects(): Promise<IpcResult<readonly RecentProject[]>>;
  clearRecentProjects(): Promise<IpcResult<null>>;
  /** Native Save / Discard / Cancel prompt, for replacing a project with unsaved changes. */
  confirmUnsavedChanges(): Promise<IpcResult<UnsavedChoice>>;
  /**
   * Makes the window paste into itself, as Edit > Paste does: the page gets a `paste` event that carries the clipboard. For the Paste
   * item of the canvas context menu, because a page cannot start a paste. It takes no arguments and returns no clipboard content.
   */
  paste(): Promise<IpcResult<null>>;
  getAppSettings(): Promise<IpcResult<AppSettingsState>>;
  /**
   * Shows the native folder chooser for the game installation and stores the choice. Takes no arguments: the folder comes from the dialog
   * alone. Resolves with null when the user cancels or a chooser is already open; a folder without the game is an error and stores nothing.
   */
  chooseGameFolder(): Promise<IpcResult<AppSettingsState | null>>;
  /** Forgets the chosen folder; the app looks for the game itself again. */
  resetGameFolder(): Promise<IpcResult<AppSettingsState>>;
  /** Called after the game installation in use changed. */
  onAppSettingsChanged(listener: (state: AppSettingsState) => void): () => void;
  /** Dirty-state handshake: main prompts on window close while the renderer reports unsaved changes. */
  setDirty(dirty: boolean): void;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  /** Called when the user chose Save in the close prompt. Resolve true once the project is saved; false keeps the window open. */
  onSaveBeforeClose(handler: () => Promise<boolean>): () => void;
}
