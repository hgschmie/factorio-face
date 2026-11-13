// What the application settings dialog says about the game installation, and which of two reports about it is the newer.
// Pure: the dialog renders the result, the hook keeps the state.
import type { AppSettingsState, IpcResult } from "../../../desktop/src/ipc.ts";

export const NO_INSTALLATION = "No installation found";

export interface VersionView {
  readonly text: string;
  /** Why the version matters, when it is not the catalog's. */
  readonly note: string | null;
  /** `warning`: another release line, where icons may be missing or different. The installation is used all the same. */
  readonly level: "ok" | "note" | "warning";
}

export interface AppSettingsView {
  /** The folder as the user chose it, the data directory the app found, or `NO_INSTALLATION`. */
  readonly folder: string;
  readonly found: boolean;
  readonly origin: string;
  /** Where the icons are read, when that is not the folder shown. */
  readonly dataDirectory: string | null;
  readonly version: VersionView | null;
  readonly modulesFound: readonly string[];
  readonly modulesMissing: readonly string[];
  readonly problem: string | null;
  readonly canReset: boolean;
}

function versionView({ gameVersion, catalogVersion, versionMatch }: AppSettingsState): VersionView | null {
  if (gameVersion === null) return null;
  const text = `Factorio ${gameVersion}`;
  const catalog = `The signal catalog of this app is from ${catalogVersion}.`;
  if (versionMatch === "same-minor") return { text, level: "note", note: `${catalog} Within ${catalogVersion.split(".").slice(0, 2).join(".")} the icons are the same with few exceptions.` };
  const different = `${catalog} This installation is used all the same; icons that it names differently or does not have are shown as placeholders.`;
  if (versionMatch === "different") return { text, level: "warning", note: different };
  return { text, level: "ok", note: null };
}

export function appSettingsView(state: AppSettingsState): AppSettingsView {
  const chosen = state.chosenFolder !== null;
  const folder = state.chosenFolder ?? state.dataDirectory;
  return {
    folder: folder ?? NO_INSTALLATION,
    found: folder !== null,
    origin: chosen ? "Chosen by you" : state.dataDirectory !== null ? "Found automatically" : "The app looked in the usual places for the game on this system",
    dataDirectory: state.dataDirectory !== null && state.dataDirectory !== folder ? state.dataDirectory : null,
    version: versionView(state),
    modulesFound: state.modules.filter((module) => module.present).map((module) => module.name),
    modulesMissing: state.modules.filter((module) => !module.present).map((module) => module.name),
    problem: state.problem,
    canReset: chosen,
  };
}

/** True when no icon of the game can be shown and the user should be told where to set the game folder. */
export function needsGameFolderHint(state: AppSettingsState | undefined, iconsMissing: boolean): boolean {
  return state !== undefined && state.dataDirectory === null && iconsMissing;
}

/** That hint: a text short enough for the title bar, and the whole of it. */
export function gameFolderHint(state: AppSettingsState): { readonly text: string; readonly detail: string } {
  const text = state.chosenFolder !== null ? "The chosen Factorio folder cannot be used" : "No Factorio installation found";
  return { text, detail: `${text}, so signals and entities are shown without the game's icons. The game folder is set in the settings of the application.` };
}

/** The newer of two reports about the settings. A report can arrive twice, as the answer to a request and as the event for the change it made, and in either order. */
export function newerSettings(current: AppSettingsState | undefined, incoming: AppSettingsState): AppSettingsState {
  return current !== undefined && incoming.iconRevision < current.iconRevision ? current : incoming;
}

export interface AppSettingsStatus {
  readonly state: AppSettingsState | undefined;
  /** A request is on its way; while the native chooser is open the dialog's buttons are disabled. */
  readonly busy: boolean;
  /** Why the last request failed, for example the reason a chosen folder was refused. */
  readonly error: string | null;
}

export const INITIAL_APP_SETTINGS: AppSettingsStatus = { state: undefined, busy: false, error: null };

export type AppSettingsEvent =
  | { readonly type: "requested" }
  /** The answer to a request; null when the chooser was cancelled. */
  | { readonly type: "answered"; readonly result: IpcResult<AppSettingsState | null> }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "changed"; readonly state: AppSettingsState };

export function reduceAppSettings(status: AppSettingsStatus, event: AppSettingsEvent): AppSettingsStatus {
  switch (event.type) {
    case "requested":
      return { ...status, busy: true, error: null };
    case "answered":
      if (!event.result.ok) return { ...status, busy: false, error: event.result.error };
      return { state: event.result.value === null ? status.state : newerSettings(status.state, event.result.value), busy: false, error: null };
    case "failed":
      return { ...status, busy: false, error: event.error };
    case "changed":
      return { ...status, state: newerSettings(status.state, event.state) };
  }
}
