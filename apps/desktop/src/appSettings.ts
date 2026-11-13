// Settings of the application on this machine, as opposed to those of a project: stored as JSON under userData. So far
// the one setting is where the game is installed; the rules for which installation the app uses are here too.
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import { DETECTION_TIMEOUT_MS, detectionCandidates, findInstallation, inspectGameFolderInTime, type GameInstallation, type Host, type InstallationProblem } from "./gameInstallation.ts";
import { writeFileAtomic } from "./projectStore.ts";
import { APP_SETTINGS_VERSION, parseAppSettingsFile, parseGameDirectory } from "./validation.ts";

export const APP_SETTINGS_FILE_NAME = "app-settings.json";

export interface AppSettings {
  /** The folder the user chose for the game, as chosen (the application bundle, the game folder or its data directory); null to let the app look for it. */
  readonly gameDirectory: string | null;
}

export class AppSettingsStore {
  private readonly filePath: string;
  private settings: AppSettings | undefined;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async get(): Promise<AppSettings> {
    if (!this.settings) {
      try {
        this.settings = parseAppSettingsFile(JSON.parse(await readFile(this.filePath, "utf8")));
      } catch {
        // Missing or corrupt file: defaults; the next change rewrites it.
        this.settings = parseAppSettingsFile(undefined);
      }
    }
    return this.settings;
  }

  /** Stores the folder the user chose, or null to return to auto-detection. The settings in memory change only once the file is written. */
  async setGameDirectory(gameDirectory: string | null): Promise<AppSettings> {
    const settings: AppSettings = { ...(await this.get()), gameDirectory: gameDirectory === null ? null : parseGameDirectory(gameDirectory) };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFileAtomic(this.filePath, JSON.stringify({ version: APP_SETTINGS_VERSION, ...settings }, null, 2) + "\n");
    this.settings = settings;
    return settings;
  }
}

/** FACE_GAME_DIR: the one folder auto-detection looks at instead of the usual places. For tests and development, so a run does not depend on what is installed. */
export function gameDirectoryFromEnv(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const directory = env.FACE_GAME_DIR;
  if (directory === undefined || directory === "") return undefined;
  if (!isAbsolute(directory)) throw new Error(`FACE_GAME_DIR must be an absolute path: ${directory}`);
  return normalize(directory);
}

export type GameDirectorySource =
  /** The user's choice. It is used or reported as unusable, never replaced by another installation. */
  | { readonly kind: "chosen"; readonly folder: string }
  /** Auto-detection, in `folders` when given and in the platform's usual places otherwise. */
  | { readonly kind: "detect"; readonly folders?: readonly string[] };

/** Where to look for the game: a stored choice wins; otherwise auto-detection, which FACE_GAME_DIR narrows to one folder. */
export function gameDirectorySource(settings: AppSettings, env: Readonly<Record<string, string | undefined>>): GameDirectorySource {
  if (settings.gameDirectory !== null) return { kind: "chosen", folder: settings.gameDirectory };
  const override = gameDirectoryFromEnv(env);
  return override === undefined ? { kind: "detect" } : { kind: "detect", folders: [override] };
}

export type GameLocation =
  | { readonly status: "chosen"; readonly folder: string; readonly installation: GameInstallation }
  /** The chosen folder holds no usable installation (any more): the choice stands and the problem is shown. */
  | { readonly status: "chosen-unusable"; readonly folder: string; readonly problem: InstallationProblem; readonly message: string }
  | { readonly status: "detected"; readonly installation: GameInstallation }
  | { readonly status: "none" };

/** The installation the app uses for these settings on this host. Reads the file system; never throws for what it finds there. */
export async function locateGame(settings: AppSettings, host: Host, catalogVersion: string, timeoutMs = DETECTION_TIMEOUT_MS): Promise<GameLocation> {
  const source = gameDirectorySource(settings, host.env);
  if (source.kind === "chosen") {
    const inspection = await inspectGameFolderInTime(source.folder, catalogVersion, host.platform, timeoutMs);
    const { folder } = source;
    return inspection.ok ? { status: "chosen", folder, installation: inspection.installation } : { status: "chosen-unusable", folder, problem: inspection.problem, message: inspection.message };
  }
  const installation = await findInstallation(source.folders ?? detectionCandidates(host), catalogVersion, host.platform, timeoutMs);
  return installation ? { status: "detected", installation } : { status: "none" };
}
