// The complete contract between the Electron main process and the renderer.
// Main and preload import it at runtime; the renderer imports its types, and constants only through the pure modules it shares with
// the main process (emptyProject.ts). Keep it free of Node and Electron imports.

import type { CatalogData } from "@face/catalog";

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
  /** Entries of the record of the mods a project was made with, the game's own modules included. */
  projectMods: 2000,
  recentProjects: 10,
  /** Example projects listed from the examples directory. */
  examples: 64,
  exampleFileNameLength: 255,
  /**
   * Bytes of a file File > Import Blueprint reads. The importer (`DEFAULT_LIMITS` of @face/blueprints) takes a blueprint string of up to
   * 8 MiB of characters and refuses text of more than twice that unread, which leaves room for line breaks and for the plain JSON.
   */
  blueprintFileBytes: 16 * 1024 * 1024,
  /** Characters of a blueprint string File > Export Blueprint writes: the longest one the importer reads back. */
  blueprintStringLength: 8 * 1024 * 1024,
} as const;

/** The extension a blueprint file gets unless the user names another one. The file is the blueprint string as text. */
export const BLUEPRINT_FILE_EXTENSION = ".txt";

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

/** Something a game had loaded, a module of its own or a mod, by its own account. */
export interface GameMod {
  readonly name: string;
  readonly version: string;
}

/**
 * The game a project was made with, when the editor's data was read from a game with mods: `gameMods` in face.json. A project
 * opens whatever it says; the editor compares it with the data in use and tells the user what differs.
 */
export interface ProjectMods {
  /** The release of the game the data was read from. */
  readonly gameVersion: string;
  /** What that game had loaded: its own modules, then the mods by name. */
  readonly mods: readonly GameMod[];
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
  /** Written while the data in use was read from a game with mods; kept as it is while other data is in use. */
  readonly gameMods?: ProjectMods;
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

/** A file the user chose in File > Import Blueprint, read as text. Whether it holds a blueprint is for the renderer's importer to say. */
export interface BlueprintFileText {
  /** The name of the file without its folders, for messages. */
  readonly name: string;
  readonly text: string;
}

export interface ExportBlueprintRequest {
  /** The name of the project; the file name the save dialog suggests is made from it. Never a path. */
  readonly name: string;
  /** The blueprint string: the character `0` and base64. */
  readonly text: string;
}

export interface ExportedBlueprint {
  /** Where the user had the blueprint written. */
  readonly path: string;
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

// The entity and signal data the editor works with: the one that comes with the build, or one read from the user's own game.

export type GameDataSource =
  | { readonly kind: "built-in"; readonly version: string }
  | { readonly kind: "game"; readonly version: string; readonly build?: number; /** When the game was read, ISO 8601. */ readonly readAt: string; /** Mods beside the game's own modules. */ readonly mods: number };

/** The steps of reading the game: the folder of the run, the three headless starts of the game, the tables. */
export type GameReadStep = "prepare" | "data" | "locale" | "runtime" | "collect";

/** Where a request to read the game stands. `done`, `failed` and `cancelled` stay until the next request. */
export type GameDataRun =
  | { readonly state: "idle" }
  /** The native confirmation is open; nothing has been started. */
  | { readonly state: "confirming" }
  | { readonly state: "running"; readonly step: GameReadStep; /** From 1. */ readonly index: number; readonly count: number; /** ISO 8601. */ readonly startedAt: string }
  | { readonly state: "done"; /** What the user should know although it worked. */ readonly warnings: readonly string[]; readonly steps: readonly { readonly step: GameReadStep; readonly seconds: number }[] }
  | { readonly state: "failed"; readonly message: string; /** The end of what the game printed, as plain text. */ readonly log: string; readonly warnings: readonly string[] }
  | { readonly state: "cancelled" };

export interface GameDataStatus {
  /** The data this window was given when it loaded. */
  readonly inUse: GameDataSource;
  /** The data the window gets when it is loaded again, when that is other data: after a read, or after going back to the built-in data. */
  readonly pending: GameDataSource | null;
  /** The game or its mods are not the ones the data in use was read from, as far as their files say. False for the built-in data. */
  readonly stale: boolean;
  /** Why the game cannot be read (no installation, an installation without the program, too old); null when it can. */
  readonly unavailable: string | null;
  /** Why data that was read earlier is not in use (a damaged file); the built-in data is. */
  readonly problem: string | null;
  /** There is something to discard: data read from a game, in use or waiting, or a file that cannot be used. */
  readonly discardable: boolean;
  readonly run: GameDataRun;
}

/** What a window works with. The tables are null for the built-in data, which the renderer has itself. */
export interface GameDataInUse {
  readonly source: GameDataSource;
  readonly problem: string | null;
  /** What the game had loaded: its own modules, then the mods. Empty for the built-in data. */
  readonly mods: readonly GameMod[];
  /** As `packages/catalog/data/catalog-<version>.json`. */
  readonly catalog: CatalogData | null;
  /** As `packages/model/data/entities-<version>.json`. */
  readonly entities: Readonly<Record<string, unknown>> | null;
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
  "file.importBlueprint",
  "file.pasteBlueprint",
  "file.exportBlueprint",
  "file.showBlueprint",
  "edit.undo",
  "edit.redo",
  // The same dialog as "file.pasteBlueprint", next to Paste; the key is on the item of the File menu.
  "edit.pasteBlueprint",
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
  importBlueprintFile: "face:blueprint:import-file",
  exportBlueprintFile: "face:blueprint:export-file",
  paste: "face:edit:paste",
  getAppSettings: "face:app-settings:get",
  chooseGameFolder: "face:app-settings:choose-game-folder",
  resetGameFolder: "face:app-settings:reset-game-folder",
  appSettingsChanged: "face:app-settings:changed",
  getGameData: "face:game-data:get",
  getGameDataStatus: "face:game-data:status",
  readGameData: "face:game-data:read",
  cancelGameDataRead: "face:game-data:cancel",
  discardGameData: "face:game-data:discard",
  applyGameData: "face:game-data:apply",
  gameDataRunChanged: "face:game-data:run-changed",
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
   * File > Import Blueprint: shows the native file dialog and reads the chosen file as text, up to `LIMITS.blueprintFileBytes`. Takes no
   * arguments: the file comes from the dialog alone. Resolves with null when the user cancels or one of the two blueprint dialogs is open.
   */
  importBlueprintFile(): Promise<IpcResult<BlueprintFileText | null>>;
  /**
   * File > Export Blueprint: shows the native save dialog and writes the blueprint string there, atomically. The location comes from the
   * dialog alone; the text must be a blueprint string. Resolves with null when the user cancels or one of the two blueprint dialogs is open.
   */
  exportBlueprintFile(request: ExportBlueprintRequest): Promise<IpcResult<ExportedBlueprint | null>>;
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
  /** The data this window works with: what it must apply before it reads a circuit. Takes no arguments. */
  getGameData(): Promise<IpcResult<GameDataInUse>>;
  /** Where the data comes from, whether the game changed since, whether the game can be read, and where a request to read it stands. */
  getGameDataStatus(): Promise<IpcResult<GameDataStatus>>;
  /**
   * Asks the user, in a native dialog of the main process, whether the installed game may be run, and runs it when they agree: headless,
   * isolated, to read the entity and signal data with the user's mods. Takes no arguments: the program is the one of the installation in
   * use. Resolves when that has ended, with the outcome in `run`; at once, and without a second dialog, while a request is under way.
   * The data that was read is used from the next load of the window (`pending`).
   */
  readGameData(): Promise<IpcResult<GameDataStatus>>;
  /** Stops the game when it is being read. */
  cancelGameDataRead(): Promise<IpcResult<GameDataStatus>>;
  /** Forgets the data read from the game: the built-in data applies from the next load of the window. Refused while the game is being read. */
  discardGameData(): Promise<IpcResult<GameDataStatus>>;
  /**
   * Loads the window again, which is how other data is applied (`pending`): the page starts over and asks for its data. The renderer
   * asks about unsaved changes first; what is not saved is gone. Refused while the game is being read.
   */
  applyGameData(): Promise<IpcResult<null>>;
  /** Called whenever a request to read the game moves on. */
  onGameDataRunChanged(listener: (run: GameDataRun) => void): () => void;
  /** Dirty-state handshake: main prompts on window close while the renderer reports unsaved changes. */
  setDirty(dirty: boolean): void;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  /** Called when the user chose Save in the close prompt. Resolve true once the project is saved; false keeps the window open. */
  onSaveBeforeClose(handler: () => Promise<boolean>): () => void;
}
