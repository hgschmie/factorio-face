// Which installation of the game the app uses, while it runs: found at start, changed when the user chooses a folder or
// goes back to auto-detection. Free of Electron; the native folder chooser is handed in. Nothing here starts the game or
// writes into its folder, and the only path that is ever stored comes from that chooser.
import { GAME_MODULES } from "@face/catalog/icons";
import type { OpenDialogOptions } from "electron";
import { locateGame, type AppSettingsStore, type GameLocation } from "./appSettings.ts";
import { DETECTION_TIMEOUT_MS, inspectGameFolderInTime, type Host } from "./gameInstallation.ts";
import type { AppSettingsState } from "./ipc.ts";
import { parseGameDirectory, ValidationError } from "./validation.ts";

/** What the renderer is told about a location. */
export function appSettingsState(location: GameLocation, catalogVersion: string, iconRevision: number): AppSettingsState {
  const installation = location.status === "chosen" || location.status === "detected" ? location.installation : undefined;
  const chosenFolder = location.status === "chosen" || location.status === "chosen-unusable" ? location.folder : null;
  return {
    chosenFolder,
    dataDirectory: installation?.dataDirectory ?? null,
    source: chosenFolder !== null ? "chosen" : installation ? "detected" : "none",
    gameVersion: installation?.version ?? null,
    catalogVersion,
    versionMatch: installation?.versionMatch ?? null,
    modules: installation ? GAME_MODULES.map((name) => ({ name, present: installation.modules.some((module) => module.name === name) })) : [],
    problem: location.status === "chosen-unusable" ? location.message : null,
    iconRevision,
  };
}

/**
 * The native chooser for the game folder. On macOS the game is an application bundle, which the panel treats as a file: files
 * are offered as well, limited to applications, so `factorio.app` itself can be picked, and so can a folder (a Steam library,
 * a `data` directory). Elsewhere the game is a folder.
 */
export function gameFolderDialogOptions(platform: NodeJS.Platform, chosenFolder: string | null): OpenDialogOptions {
  const mac = platform === "darwin";
  return {
    title: "Choose the Factorio Installation",
    message: mac ? "Choose factorio.app, or the folder that holds the game or its data." : "Choose the folder of the game or its data folder.",
    buttonLabel: "Use This Installation",
    defaultPath: chosenFolder ?? (mac ? "/Applications" : undefined),
    ...(mac ? { filters: [{ name: "Applications", extensions: ["app"] }] } : {}),
    properties: mac ? ["openFile", "openDirectory"] : ["openDirectory"],
  };
}

export interface GameSettingsOptions {
  readonly store: AppSettingsStore;
  /** Told the data directory in use whenever a search has ended (`GameIcons.reset`). */
  readonly icons: { reset(dataDirectory: string | undefined): void };
  readonly host: Host;
  /** The release the catalog was generated from. */
  readonly catalogVersion: string;
  readonly timeoutMs?: number;
  /** Called after the installation in use changed while the app runs; not for the search at start. */
  onChange(state: AppSettingsState): void;
}

export class GameSettings {
  private readonly options: GameSettingsOptions;
  private location: Promise<GameLocation>;
  private revision = 0;
  private choosing = false;
  /** Changes run one after the other. */
  private pending: Promise<unknown> = Promise.resolve();

  /** Starts looking for the game; nothing waits for the search but `ready` and `state`. */
  constructor(options: GameSettingsOptions) {
    this.options = options;
    this.location = this.locate();
  }

  /** Resolves once it is known which installation is in use, after a change as well as at start. Never rejects. */
  ready(): Promise<unknown> {
    return this.location;
  }

  async state(): Promise<AppSettingsState> {
    return appSettingsState(await this.location, this.options.catalogVersion, this.revision);
  }

  /** Makes a folder the user's choice. A folder that holds no usable installation is refused with its reason and nothing is stored. */
  choose(folder: unknown): Promise<AppSettingsState> {
    return this.change(async () => {
      const { store, host, catalogVersion, timeoutMs = DETECTION_TIMEOUT_MS } = this.options;
      const chosen = parseGameDirectory(folder);
      const inspection = await inspectGameFolderInTime(chosen, catalogVersion, host.platform, timeoutMs);
      if (!inspection.ok) throw new ValidationError(inspection.message);
      await store.setGameDirectory(chosen);
    });
  }

  /**
   * Lets the user choose a folder through `ask`, the native chooser, which resolves with undefined when it was cancelled.
   * Resolves with null then, and also when a chooser is already open: a second request is ignored.
   */
  async chooseWith(ask: (state: AppSettingsState) => Promise<string | undefined>): Promise<AppSettingsState | null> {
    if (this.choosing) return null;
    this.choosing = true;
    try {
      const folder = await ask(await this.state());
      return folder === undefined ? null : await this.choose(folder);
    } finally {
      this.choosing = false;
    }
  }

  /** Forgets the user's choice and looks for the game again. */
  reset(): Promise<AppSettingsState> {
    return this.change(() => this.options.store.setGameDirectory(null));
  }

  private async locate(): Promise<GameLocation> {
    const { store, icons, host, catalogVersion, timeoutMs = DETECTION_TIMEOUT_MS } = this.options;
    const location = await locateGame(await store.get(), host, catalogVersion, timeoutMs).catch((error: unknown): GameLocation => {
      console.error("[face] looking for the game failed:", error);
      return { status: "none" };
    });
    icons.reset(location.status === "chosen" || location.status === "detected" ? location.installation.dataDirectory : undefined);
    return location;
  }

  /** Applies a change of the settings, then looks for the game under the new settings and tells the renderer. */
  private change(apply: () => Promise<unknown>): Promise<AppSettingsState> {
    const done = this.pending.then(async () => {
      await apply();
      this.location = this.locate();
      await this.location;
      this.revision++;
      const state = await this.state();
      this.options.onChange(state);
      return state;
    });
    this.pending = done.catch(() => undefined);
    return done;
  }
}
