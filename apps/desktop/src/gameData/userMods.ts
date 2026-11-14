// The user's mods: where the game keeps them, what is there, and a private mod directory for a run of the game that the app
// starts. The game rewrites `mod-list.json` and `mod-settings.dat` in the mod directory it is given, so it never gets the
// user's: the private one holds copies of those two files and links to the mods themselves. Nothing here writes into the
// user's folders; the platform and home directory are parameters, as in gameInstallation.ts.
import { createHash } from "node:crypto";
import { copyFile, link, lstat, mkdir, readdir, realpath, rm, rmdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GameModule, Host } from "../gameInstallation.ts";
import { readRegularFile } from "../regularFile.ts";
import { executablePath } from "./executable.ts";

export const MOD_LIST_FILE = "mod-list.json";
export const MOD_SETTINGS_FILE = "mod-settings.dat";
export const USER_MOD_LIMITS = { configBytes: 1024 * 1024, modListBytes: 4 * 1024 * 1024, modSettingsBytes: 64 * 1024 * 1024, infoBytes: 64 * 1024, entries: 20_000, nameLength: 200 } as const;

const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const VERSIONED = /^(.+)_(\d{1,5}\.\d{1,5}\.\d{1,5})$/;
const pathsOf = (platform: NodeJS.Platform): path.PlatformPath => (platform === "win32" ? path.win32 : path.posix);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function readText(file: string, maxBytes: number): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await readRegularFile(file, maxBytes));
  } catch {
    return undefined;
  }
}

/** The value of `key` in an INI text: in `section`, or before the first section when none is named. Comment lines start with `;` or `#`. */
export function iniValue(text: string, section: string | undefined, key: string): string | undefined {
  let current: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) current = header[1];
    else if (current === section && !line.startsWith(";") && !line.startsWith("#") && line.startsWith(`${key}=`)) return line.slice(key.length + 1).trim();
  }
  return undefined;
}

/** Where the game keeps a user's files when nothing says otherwise. Pure. */
export function systemWriteData({ platform, env, home }: Host): string | undefined {
  const { join } = pathsOf(platform);
  if (platform === "darwin") return join(home, "Library", "Application Support", "factorio");
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "Factorio");
  if (platform === "linux") return join(home, ".factorio");
  return undefined;
}

export interface UserDataLocation {
  /** The game's write-data directory: saves, mods, its configuration, its log. */
  readonly writeData: string;
  readonly modDirectory: string;
  /** What decided: the `write-data` of this `config.ini`, or the platform's default. */
  readonly decidedBy: string;
}

/**
 * Finds the user's write-data directory the way the game does when it starts without arguments: `config-path.cfg` beside
 * the `data` directory names the folder of `config.ini` and says whether the system's per-user folder is the default; the
 * `[path] write-data` of that `config.ini` is the answer, with the game's placeholders resolved. Without either file, and
 * for a value that is no absolute path, the default applies. Undefined on a platform without a default.
 */
export async function locateUserData(dataDirectory: string, host: Host): Promise<UserDataLocation | undefined> {
  const { join, dirname, normalize, isAbsolute } = pathsOf(host.platform);
  const system = systemWriteData(host);
  if (system === undefined) return undefined;
  const gameRoot = dirname(dataDirectory);
  const placeholders: Readonly<Record<string, string>> = { executable: dirname(executablePath(dataDirectory, host.platform) ?? join(gameRoot, "bin")), "system-write-data": system, "system-read-data": dataDirectory };
  const expand = (value: string): string | undefined => {
    const expanded = normalize(value.replace(/__PATH__([a-z-]+)__/g, (whole, name: string) => placeholders[name] ?? whole));
    return isAbsolute(expanded) && !expanded.includes("__PATH__") && !/[\u0000-\u001f]/.test(expanded) ? expanded : undefined;
  };
  const pathFile = await readText(join(gameRoot, "config-path.cfg"), USER_MOD_LIMITS.configBytes);
  const configDirectory = (pathFile === undefined ? undefined : expand(iniValue(pathFile, undefined, "config-path") ?? "")) ?? join(system, "config");
  const useSystem = pathFile === undefined || iniValue(pathFile, undefined, "use-system-read-write-data-directories") !== "false";
  const configFile = join(configDirectory, "config.ini");
  const config = await readText(configFile, USER_MOD_LIMITS.configBytes);
  const configured = config === undefined ? undefined : expand(iniValue(config, "path", "write-data") ?? "");
  const writeData = configured ?? (useSystem ? system : gameRoot);
  return { writeData, modDirectory: join(writeData, "mods"), decidedBy: configured === undefined ? "default" : configFile };
}

/** The files of the user that a game started with the user's own configuration rewrites at once: looked at before and after a run, by size and time alone. */
export function watchedUserFiles({ writeData, modDirectory }: UserDataLocation): string[] {
  return [path.join(writeData, "factorio-current.log"), path.join(writeData, "player-data.json"), path.join(writeData, "config", "config.ini"), modDirectory, path.join(modDirectory, MOD_LIST_FILE), path.join(modDirectory, MOD_SETTINGS_FILE)];
}

export interface ModFile {
  /** The entry of the mod directory: `name_1.2.3.zip`, or a folder (or a link to one). */
  readonly fileName: string;
  readonly kind: "zip" | "directory";
  /** From the file name, for a folder without a version in its name from its `info.json`; absent when neither says. */
  readonly name?: string;
  readonly version?: string;
}

export interface ModListEntry {
  readonly name: string;
  readonly enabled: boolean;
  /** A version the user pinned. */
  readonly version?: string;
}

export interface UserMods {
  readonly directory: string;
  /** False when there is no such directory: a game without mods. */
  readonly exists: boolean;
  /** The entries of `mod-list.json`; undefined without the file or when it cannot be read, and the game then enables whatever it finds. */
  readonly list: readonly ModListEntry[] | undefined;
  readonly files: readonly ModFile[];
  /** SHA-256 of `mod-settings.dat`, null without the file. */
  readonly settingsHash: string | null;
  /** What could not be read, for the user. */
  readonly problems: readonly string[];
}

/** A game without mods: no mod directory. */
export const noUserMods = (directory = ""): UserMods => ({ directory, exists: false, list: undefined, files: [], settingsHash: null, problems: [] });

function parseModList(text: string): ModListEntry[] | undefined {
  try {
    const value: unknown = JSON.parse(text);
    const mods = isRecord(value) ? value.mods : undefined;
    if (!Array.isArray(mods) || mods.length > USER_MOD_LIMITS.entries) return undefined;
    return mods.flatMap((entry: unknown): ModListEntry[] => {
      if (!isRecord(entry) || typeof entry.name !== "string" || entry.name === "" || entry.name.length > USER_MOD_LIMITS.nameLength) return [];
      const version = typeof entry.version === "string" && VERSION.test(entry.version) ? { version: entry.version } : {};
      return [{ name: entry.name, enabled: entry.enabled === true, ...version }];
    });
  } catch {
    return undefined;
  }
}

async function modFile(directory: string, fileName: string): Promise<ModFile | undefined> {
  // Links are followed: a mod under development is usually a link to its folder.
  const info = await stat(path.join(directory, fileName)).catch(() => undefined);
  const kind = info?.isDirectory() ? "directory" : info?.isFile() && fileName.toLowerCase().endsWith(".zip") ? "zip" : undefined;
  if (kind === undefined) return undefined;
  const versioned = VERSIONED.exec(kind === "zip" ? fileName.slice(0, -".zip".length) : fileName);
  if (versioned) return { fileName, kind, name: versioned[1]!, version: versioned[2]! };
  if (kind === "zip") return { fileName, kind };
  try {
    const described: unknown = JSON.parse((await readText(path.join(directory, fileName, "info.json"), USER_MOD_LIMITS.infoBytes)) ?? "");
    if (isRecord(described) && typeof described.name === "string" && described.name !== "" && typeof described.version === "string" && VERSION.test(described.version)) return { fileName, kind, name: described.name, version: described.version };
  } catch {
    // Not a mod the app can name; the game decides what it is.
  }
  return { fileName, kind };
}

/** Reads what is in a mod directory: the list, the settings' hash and the mods by file. Never throws; a directory that is not there is a game without mods. */
export async function readUserMods(directory: string): Promise<UserMods> {
  const problems: string[] = [];
  let names: string[];
  try {
    names = (await readdir(directory)).sort();
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { ...noUserMods(directory), problems: missing ? [] : [`The mod directory cannot be read: ${directory}`] };
  }
  if (names.length > USER_MOD_LIMITS.entries) {
    problems.push(`The mod directory has more than ${USER_MOD_LIMITS.entries} entries; the rest is ignored`);
    names = names.slice(0, USER_MOD_LIMITS.entries);
  }
  let list: ModListEntry[] | undefined;
  if (names.includes(MOD_LIST_FILE)) {
    const text = await readText(path.join(directory, MOD_LIST_FILE), USER_MOD_LIMITS.modListBytes);
    list = text === undefined ? undefined : parseModList(text);
    if (list === undefined) problems.push(`${MOD_LIST_FILE} cannot be read; the game decides which mods it enables`);
  }
  let settingsHash: string | null = null;
  if (names.includes(MOD_SETTINGS_FILE)) {
    try {
      settingsHash = createHash("sha256").update(await readRegularFile(path.join(directory, MOD_SETTINGS_FILE), USER_MOD_LIMITS.modSettingsBytes)).digest("hex");
    } catch {
      problems.push(`${MOD_SETTINGS_FILE} cannot be read; the game runs with the default settings of the mods`);
    }
  }
  const candidates = names.filter((name) => !name.startsWith(".") && name !== MOD_LIST_FILE && name !== MOD_SETTINGS_FILE);
  const files = (await Promise.all(candidates.map((name) => modFile(directory, name)))).filter((file) => file !== undefined);
  return { directory, exists: true, list, files, settingsHash, problems };
}

function compareVersions(a: string, b: string): number {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
}

/** Whether the game would load this file: not when the list switches its mod off. A mod the list does not mention is new, and the game enables it. */
function isWanted(mods: UserMods, file: ModFile): boolean {
  const listed = file.name === undefined ? undefined : mods.list?.find((entry) => entry.name === file.name);
  return listed === undefined || listed.enabled;
}

export interface EnabledMod {
  readonly name: string;
  /** Null when no file says which version it is. */
  readonly version: string | null;
}

/**
 * What the game will load as far as the files say, sorted by name: its own modules that are installed and not switched off,
 * and the mods that are enabled or new, each in the pinned version or the highest one there. This is read before a run and
 * again at any later time to see whether the game's state changed; what the game really loaded, it says itself in its dump.
 */
export function enabledMods(mods: UserMods, gameModules: readonly GameModule[]): EnabledMod[] {
  const out = new Map<string, string | null>();
  const own = gameModules.filter((module) => module.name !== "core");
  for (const module of own) if (mods.list?.find((entry) => entry.name === module.name)?.enabled ?? true) out.set(module.name, module.version ?? null);
  const versions = new Map<string, string[]>();
  for (const file of mods.files) {
    if (file.name === undefined || own.some((module) => module.name === file.name) || !isWanted(mods, file)) continue;
    versions.set(file.name, [...(versions.get(file.name) ?? []), ...(file.version === undefined ? [] : [file.version])]);
  }
  for (const [name, found] of versions) {
    const pinned = mods.list?.find((entry) => entry.name === name)?.version;
    out.set(name, pinned !== undefined && found.includes(pinned) ? pinned : (found.sort(compareVersions).at(-1) ?? null));
  }
  return [...out].map(([name, version]) => ({ name, version })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface PrivateMods {
  readonly directory: string;
  /** Mods the game finds in it. */
  readonly mods: number;
  /** File names that had to be copied because the platform refused a link. */
  readonly copied: readonly string[];
}

/**
 * Creates `target` (which must not exist) as the mod directory for one run: copies of the user's `mod-list.json` and
 * `mod-settings.dat`, which the game rewrites, and for every mod the list does not switch off a link to the user's file or
 * folder, which the game only reads. Without `source`, or for a game without mods, the directory is empty and the game
 * enables its own modules as it does on a first start.
 */
export async function buildPrivateModDirectory(source: UserMods | undefined, target: string, platform: NodeJS.Platform): Promise<PrivateMods> {
  await mkdir(target);
  if (!source?.exists) return { directory: target, mods: 0, copied: [] };
  for (const [name, limit] of [[MOD_LIST_FILE, USER_MOD_LIMITS.modListBytes], [MOD_SETTINGS_FILE, USER_MOD_LIMITS.modSettingsBytes]] as const) {
    const bytes = await readRegularFile(path.join(source.directory, name), limit).catch(() => undefined);
    if (bytes !== undefined) await writeFile(path.join(target, name), bytes, { flag: "wx", mode: 0o644 });
  }
  const copied: string[] = [];
  const wanted = source.files.filter((file) => isWanted(source, file));
  for (const file of wanted) {
    const original = await realpath(path.join(source.directory, file.fileName));
    const entry = path.join(target, file.fileName);
    if (file.kind === "directory") await symlink(original, entry, platform === "win32" ? "junction" : "dir");
    else {
      // Windows lets only privileged users create links to files: a hard link then, and a copy where that is refused too (another volume).
      await symlink(original, entry, "file").catch(() => link(original, entry)).catch(async () => {
        await copyFile(original, entry);
        copied.push(file.fileName);
      });
    }
  }
  return { directory: target, mods: wanted.length, copied };
}

/**
 * Removes a private mod directory without following a link: links are taken away one by one first, so that whatever removes
 * the rest can never reach the user's files through them. A directory that is not there is fine.
 */
export async function removePrivateModDirectory(target: string): Promise<void> {
  const names = await readdir(target).catch(() => [] as string[]);
  for (const name of names) {
    const entry = path.join(target, name);
    const info = await lstat(entry).catch(() => undefined);
    // A junction is a directory to `unlink` and a link to `rmdir`.
    if (info?.isSymbolicLink()) await unlink(entry).catch(() => rmdir(entry));
  }
  await rm(target, { recursive: true, force: true });
}
