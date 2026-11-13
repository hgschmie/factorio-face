// Finds and inspects the user's installation of the game, whose image files the app reads. Nothing here starts the game
// or writes anywhere. The platform, environment and home directory are parameters, so every platform's rules can be
// tested on any machine; file access never throws, a folder that cannot be read is simply not an installation.
import { stat } from "node:fs/promises";
import path from "node:path";
import { GAME_MODULES, type GameModuleName } from "./gameIcons/iconTable.ts";
import { readRegularFile } from "./regularFile.ts";

export interface Host {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
}

export interface GameModule {
  readonly name: GameModuleName;
  /** `core` carries no version. */
  readonly version?: string;
}

/** How the installed game relates to the release the catalog was generated from. */
export type VersionMatch = "equal" | "same-minor" | "different";

export interface GameInstallation {
  /** The game's `data` directory: the one that holds `base` and `core`. */
  readonly dataDirectory: string;
  /** Version of the `base` module. */
  readonly version: string;
  readonly modules: readonly GameModule[];
  readonly versionMatch: VersionMatch;
}

export type InstallationProblem = "not-found" | "not-game-data" | "no-images" | "timeout";

export type Inspection =
  | { readonly ok: true; readonly installation: GameInstallation }
  | { readonly ok: false; readonly problem: InstallationProblem; readonly message: string };

export const DETECTION_TIMEOUT_MS = 3000;

const INFO_FILE_BYTES = 64 * 1024;
const LIBRARY_FILE_BYTES = 256 * 1024;
const MAX_STEAM_LIBRARIES = 32;
const VERSION = /^\d+\.\d+\.\d+$/;
/** An image every full installation has and the app needs; a headless build or a copy of the Lua data lacks it. */
const PROBE_IMAGE = ["base", "graphics", "icons", "signal", "signal_A.png"];
const STEAM_GAME = ["steamapps", "common", "Factorio"];
const MAC_BUNDLE = "factorio.app";

const pathsOf = (platform: NodeJS.Platform): path.PlatformPath => (platform === "win32" ? path.win32 : path.posix);

export function compareGameVersion(version: string, catalogVersion: string): VersionMatch {
  const [major, minor, patch] = version.split(".");
  const [catalogMajor, catalogMinor, catalogPatch] = catalogVersion.split(".");
  if (major !== catalogMajor || minor !== catalogMinor) return "different";
  return patch === catalogPatch ? "equal" : "same-minor";
}

/** Where Steam keeps its own library on this platform. Further libraries are listed in `steamapps/libraryfolders.vdf` below each. */
export function steamRoots({ platform, env, home }: Host): string[] {
  const { join } = pathsOf(platform);
  if (platform === "darwin") return [join(home, "Library", "Application Support", "Steam")];
  if (platform === "win32") return [join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam")];
  if (platform === "linux") return [join(home, ".steam", "steam"), join(home, ".local", "share", "Steam"), join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam")];
  return [];
}

const steamGameFolder = (library: string, platform: NodeJS.Platform): string => pathsOf(platform).join(library, ...STEAM_GAME, ...(platform === "darwin" ? [MAC_BUNDLE] : []));

/** The folders where an installation usually is, most likely first. Pure: nothing is looked at. */
export function installationCandidates(host: Host): string[] {
  const { platform, env, home } = host;
  const { join } = pathsOf(platform);
  const steam = steamRoots(host).map((root) => steamGameFolder(root, platform));
  if (platform === "darwin") return [join("/Applications", MAC_BUNDLE), join(home, "Applications", MAC_BUNDLE), ...steam];
  if (platform === "win32") return [join(env.ProgramFiles || "C:\\Program Files", "Factorio"), ...steam, "C:\\GOG Games\\Factorio"];
  if (platform === "linux") return [...steam, join(home, "factorio"), "/opt/factorio"];
  return [];
}

/** The library folders named by the `"path"` lines of a Steam `libraryfolders.vdf`. */
export function parseLibraryFolders(text: string): string[] {
  const folders: string[] = [];
  for (const match of text.matchAll(/^\s*"path"\s+"((?:[^"\\\r\n]|\\.)*)"\s*$/gm)) {
    const folder = match[1]!.replace(/\\(.)/g, "$1");
    if (folder && !folders.includes(folder) && folders.length < MAX_STEAM_LIBRARIES) folders.push(folder);
  }
  return folders;
}

/**
 * The game's folder in each further Steam library a `libraryfolders.vdf` lists. On macOS, libraries on other volumes are
 * left out: looking at a removable or network volume can make the system ask the user for permission, which a search
 * nobody asked for must not do.
 */
export function steamLibraryCandidates(libraryFile: string, { platform }: Host): string[] {
  const { isAbsolute, normalize } = pathsOf(platform);
  return parseLibraryFolders(libraryFile)
    .filter((folder) => isAbsolute(folder) && !folder.includes("\0"))
    .map((folder) => normalize(folder))
    .filter((folder) => !(platform === "darwin" && /^\/Volumes(\/|$)/i.test(folder)))
    .map((folder) => steamGameFolder(folder, platform));
}

async function readText(file: string, maxBytes: number): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await readRegularFile(file, maxBytes));
  } catch {
    return undefined;
  }
}

/** Every folder auto-detection looks at, in order: the usual places, then the further Steam libraries. */
export async function detectionCandidates(host: Host): Promise<string[]> {
  const { join } = pathsOf(host.platform);
  const libraryFiles = await Promise.all(steamRoots(host).map((root) => readText(join(root, "steamapps", "libraryfolders.vdf"), LIBRARY_FILE_BYTES)));
  const candidates = [...installationCandidates(host), ...libraryFiles.flatMap((text) => (text === undefined ? [] : steamLibraryCandidates(text, host)))];
  return [...new Set(candidates)];
}

/** The places the `data` directory can be relative to a folder a user would point at: the directory itself, the game folder, the macOS bundle, the folder around the bundle. */
export function dataDirectoryCandidates(folder: string, platform: NodeJS.Platform): string[] {
  const { join } = pathsOf(platform);
  return [folder, join(folder, "data"), join(folder, "Contents", "data"), join(folder, MAC_BUNDLE, "Contents", "data")];
}

async function readModule(dataDirectory: string, name: GameModuleName): Promise<GameModule | undefined> {
  const text = await readText(path.join(dataDirectory, name, "info.json"), INFO_FILE_BYTES);
  if (text === undefined) return undefined;
  try {
    const info: unknown = JSON.parse(text);
    if (typeof info !== "object" || info === null || (info as { name?: unknown }).name !== name) return undefined;
    const version = (info as { version?: unknown }).version;
    return typeof version === "string" && VERSION.test(version) ? { name, version } : { name };
  } catch {
    return undefined;
  }
}

const isFile = (target: string): Promise<boolean> => stat(target).then((info) => info.isFile(), () => false);
const isDirectory = (target: string): Promise<boolean> => stat(target).then((info) => info.isDirectory(), () => false);

const PROBLEM_MESSAGES: Readonly<Record<InstallationProblem, string>> = {
  "not-found": "This folder does not exist or cannot be read",
  "not-game-data": "This folder does not contain the game's data",
  "no-images": "This folder has the game's data but no images (a headless build, or a copy of the data alone)",
  timeout: "This folder did not answer in time",
};

const problem = (kind: InstallationProblem, folder: string): Inspection => ({ ok: false, problem: kind, message: `${PROBLEM_MESSAGES[kind]}: ${folder}` });

/** Decides whether a directory is the `data` directory of a full installation, and what is in it. Reads a handful of small files. */
export async function inspectDataDirectory(dataDirectory: string, catalogVersion: string): Promise<Inspection> {
  const [modules, hasImages] = await Promise.all([Promise.all(GAME_MODULES.map((name) => readModule(dataDirectory, name))), isFile(path.join(dataDirectory, ...PROBE_IMAGE))]);
  const present = modules.filter((module) => module !== undefined);
  const version = present.find((module) => module.name === "base")?.version;
  if (version === undefined || !present.some((module) => module.name === "core")) return problem((await isDirectory(dataDirectory)) ? "not-game-data" : "not-found", dataDirectory);
  if (!hasImages) return problem("no-images", dataDirectory);
  return { ok: true, installation: { dataDirectory, version, modules: present, versionMatch: compareGameVersion(version, catalogVersion) } };
}

/**
 * Finds the installation a folder stands for: the folder may be the `data` directory, the game folder, the macOS
 * application bundle or the folder around the bundle. Without one, the answer says whether game data without images was
 * found, the folder holds something else, or it is not there at all.
 */
export async function inspectGameFolder(folder: string, catalogVersion: string, platform: NodeJS.Platform): Promise<Inspection> {
  if (!pathsOf(platform).isAbsolute(folder) || folder.includes("\0")) return problem("not-found", folder);
  let withoutImages: Inspection | undefined;
  for (const candidate of dataDirectoryCandidates(folder, platform)) {
    const inspection = await inspectDataDirectory(candidate, catalogVersion);
    if (inspection.ok) return inspection;
    if (inspection.problem === "no-images") withoutImages ??= inspection;
  }
  return withoutImages ?? problem((await isDirectory(folder)) ? "not-game-data" : "not-found", folder);
}

/** Runs a search with a deadline. A file system that hangs (a dead network mount) must not hold up the app; the abandoned reads end on their own. */
export function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** `inspectGameFolder` with a deadline. */
export function inspectGameFolderInTime(folder: string, catalogVersion: string, platform: NodeJS.Platform, timeoutMs = DETECTION_TIMEOUT_MS): Promise<Inspection> {
  return withTimeout(inspectGameFolder(folder, catalogVersion, platform), timeoutMs, () => problem("timeout", folder));
}

/** The first of the folders that holds a full installation, or undefined when none does or the deadline passes. */
export function findInstallation(
  folders: readonly string[] | Promise<readonly string[]>,
  catalogVersion: string,
  platform: NodeJS.Platform,
  timeoutMs = DETECTION_TIMEOUT_MS,
): Promise<GameInstallation | undefined> {
  const deadline = Date.now() + timeoutMs;
  const search = async (): Promise<GameInstallation | undefined> => {
    for (const folder of await folders) {
      if (Date.now() >= deadline) break;
      const inspection = await inspectGameFolder(folder, catalogVersion, platform);
      if (inspection.ok) return inspection.installation;
    }
    return undefined;
  };
  return withTimeout(search(), timeoutMs, () => undefined);
}

/** Auto-detection: looks through the usual places of this platform and the Steam libraries. */
export function detectInstallation(host: Host, catalogVersion: string, timeoutMs = DETECTION_TIMEOUT_MS): Promise<GameInstallation | undefined> {
  return findInstallation(detectionCandidates(host), catalogVersion, host.platform, timeoutMs);
}
