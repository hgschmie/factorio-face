// Validators for everything that crosses the IPC boundary or is read from disk. Pure: no Electron, no filesystem access.
import { clampWireReach, isSignalKind } from "@face/model";
import { basename, isAbsolute, normalize } from "node:path";
import type { AppSettings } from "./appSettings.ts";
import {
  BOOK_FILE_NAME,
  CIRCUIT_FILE_EXTENSION,
  LIMITS,
  PROJECT_FILE_EXTENSION,
  PROJECT_FORMAT_VERSION,
  PROJECT_FORMAT_VERSION_WITH_BOOK,
  type CircuitFile,
  type CustomSignal,
  type CustomSignalGroup,
  type ExportBlueprintRequest,
  type GameMod,
  type HiddenModuleItems,
  type JsonValue,
  type ProjectBook,
  type ProjectData,
  type ProjectFormatVersion,
  type ProjectManifest,
  type ProjectMods,
  type RecentProject,
  type SaveProjectRequest,
} from "./ipc.ts";

export class ValidationError extends Error {
  override readonly name = "ValidationError";
}

function fail(message: string): never {
  throw new ValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function parseBoolean(value: unknown, what: string): boolean {
  return typeof value === "boolean" ? value : fail(`${what} must be a boolean`);
}

function parseString(value: unknown, what: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string") fail(`${what} must be a string`);
  if (!allowEmpty && value.length === 0) fail(`${what} must not be empty`);
  if (value.length > maxLength) fail(`${what} is too long (limit ${maxLength})`);
  if (hasControlCharacters(value)) fail(`${what} contains control characters`);
  return value;
}

function parseArray(value: unknown, what: string, maxLength: number): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${what} must be an array`);
  if (value.length > maxLength) fail(`${what} has too many entries (limit ${maxLength})`);
  return value;
}

/** An absolute, already normalized path. Relative paths and paths with `..` or `.` segments are rejected, not repaired. */
function parseAbsolutePath(value: unknown, what = "Project path"): string {
  if (typeof value !== "string" || value.length === 0) fail(`${what} must be a non-empty string`);
  if (value.length > LIMITS.pathLength) fail(`${what} is too long`);
  if (value.includes("\0")) fail(`${what} contains a NUL character`);
  if (!isAbsolute(value)) fail(`${what} must be absolute`);
  if (normalize(value) !== value) fail(`${what} must be normalized`);
  return value;
}

function hasProjectExtension(path: string): boolean {
  return path.toLowerCase().endsWith(PROJECT_FILE_EXTENSION) && basename(path).length > PROJECT_FILE_EXTENSION.length;
}

/** The absolute, normalized path of a project file. The extension is required, so a caller cannot name an arbitrary file. */
export function parseProjectPath(value: unknown): string {
  const path = parseAbsolutePath(value);
  if (!hasProjectExtension(path)) fail(`Not a face project file (the name must end in ${PROJECT_FILE_EXTENSION}): ${path}`);
  return path;
}

/** Appends the project file extension unless the path already has it. */
export function withProjectExtension(path: string): string {
  return hasProjectExtension(path) ? path : path + PROJECT_FILE_EXTENSION;
}

/**
 * The file name of an example project: a plain project file name, never a path. No separator of any platform, no drive or stream
 * colon, no `..`, no hidden file. Whether such an example exists is for the list of examples to say (examples.ts).
 */
export function parseExampleFileName(value: unknown): string {
  const name = parseString(value, "Example name", LIMITS.exampleFileNameLength);
  if (/[\\/:]/.test(name) || name.includes("..") || name.startsWith(".")) fail("Example name must be a plain file name");
  if (!hasProjectExtension(name)) fail(`Not an example project (the name must end in ${PROJECT_FILE_EXTENSION})`);
  return name;
}

const CIRCUIT_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9 ._-]*$/;

/** A plain `*.face` file name: circuit files are entries at the root of the project file. Never the name of another entry the format knows (face.json, book.txt). */
export function parseCircuitFileName(value: unknown): string {
  if (typeof value !== "string") fail("Circuit file name must be a string");
  if (value.length > LIMITS.circuitFileNameLength) fail("Circuit file name is too long");
  if (!value.endsWith(CIRCUIT_FILE_EXTENSION) || value.length === CIRCUIT_FILE_EXTENSION.length) fail(`Circuit file name must end in ${CIRCUIT_FILE_EXTENSION}: ${JSON.stringify(value)}`);
  if (!CIRCUIT_FILE_NAME.test(value) || value.includes("..")) fail(`Circuit file name is not a plain file name: ${JSON.stringify(value)}`);
  return value;
}

const ASSETS_ENTRY_PREFIX = "assets/";

/**
 * Checks the name of an entry of a project file, which is untrusted. "root" entries sit directly in the archive; "assets"
 * entries are tolerated below `assets/`. Anything that could name a place outside the archive root is rejected.
 */
export function parseArchiveEntryName(name: string): "root" | "assets" {
  const unsafe = name.length === 0 || name.includes("\0") || name.includes("\\") || name.includes("..") || name.startsWith("/") || /^[A-Za-z]:/.test(name);
  if (unsafe) fail(`The project file contains an entry with an unsafe name: ${JSON.stringify(name.slice(0, 80))}`);
  if (!name.includes("/")) return "root";
  if (!name.startsWith(ASSETS_ENTRY_PREFIX)) fail(`The project file contains an entry in a folder: ${JSON.stringify(name.slice(0, 80))}`);
  return "assets";
}

function parseCustomSignal(value: unknown): CustomSignal {
  if (!isRecord(value)) fail("Custom signal must be an object");
  const name = parseString(value.name, "Custom signal name", LIMITS.identifierLength);
  if (value.icon === undefined) return { name };
  const icon = parseString(value.icon, "Custom signal icon", LIMITS.circuitFileNameLength);
  if (!/^[A-Za-z0-9_][A-Za-z0-9 ._-]*$/.test(icon) || icon.includes("..")) fail("Custom signal icon must be a plain file name");
  return { name, icon };
}

function parseCustomSignalGroup(value: unknown): CustomSignalGroup {
  if (!isRecord(value)) fail("Custom signal group must be an object");
  return {
    id: parseString(value.id, "Custom signal group id", LIMITS.identifierLength),
    name: parseString(value.name, "Custom signal group name", LIMITS.identifierLength),
    enabled: parseBoolean(value.enabled, "Custom signal group enabled flag"),
    signals: parseArray(value.signals, "Custom signals", LIMITS.customSignalsPerGroup).map(parseCustomSignal),
  };
}

// A reach out of range is brought into it instead of refusing the project: the file may come from a hand or from another tool.
function parseWireReach(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? clampWireReach(value) : fail("Wire reach must be a number");
}

const MOD_VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;

function parseModVersion(value: unknown, what: string): string {
  return typeof value === "string" && MOD_VERSION.test(value) ? value : fail(`${what} must be a version of three numbers`);
}

/** The record of the game a project was made with: a game version and a bounded list of names with versions, each name once. */
function parseProjectMods(value: unknown): ProjectMods {
  if (!isRecord(value)) fail("The record of the game's mods must be an object");
  const mods = parseArray(value.mods, "The list of the game's mods", LIMITS.projectMods).map((mod): GameMod => {
    if (!isRecord(mod)) fail("A mod must be an object");
    return { name: parseString(mod.name, "Mod name", LIMITS.identifierLength), version: parseModVersion(mod.version, "Mod version") };
  });
  if (new Set(mods.map((mod) => mod.name)).size !== mods.length) fail("A mod is listed twice");
  return { gameVersion: parseModVersion(value.gameVersion, "The game version of the mods"), mods };
}

/** What the game writes and reads: the version character `0`, then base64 with its padding. Nothing else, so no blanks and no line breaks. */
const BLUEPRINT_STRING = /^0[A-Za-z0-9+/]+={0,2}$/;

function parseBlueprintString(value: unknown, what: string, mismatch: string): string {
  if (typeof value !== "string") fail(`${what} must be a string`);
  if (value.length > LIMITS.blueprintStringLength) fail(`${what} is too long (limit ${LIMITS.blueprintStringLength} characters)`);
  if (!BLUEPRINT_STRING.test(value)) fail(mismatch);
  return value;
}

/** Where in a book a circuit came from: whole numbers from 0, at least one, bounded in count and in value. */
function parseBookOrigin(value: unknown): readonly number[] {
  const origin = parseArray(value, "The origin in the blueprint book", LIMITS.bookOriginDepth);
  if (origin.length === 0) fail("The origin in the blueprint book must not be empty");
  return origin.map((position) => (typeof position === "number" && Number.isInteger(position) && position >= 0 && position <= LIMITS.bookOriginIndex ? position : fail(`The origin in the blueprint book must be whole numbers from 0 to ${LIMITS.bookOriginIndex}`)));
}

/** The blueprint book of a project, from the renderer or from a project file: a blueprint string of bounded length and an optional origin. Anything else of it is dropped. */
export function parseProjectBook(value: unknown): ProjectBook {
  if (!isRecord(value)) fail("The blueprint book must be an object");
  const string = parseBlueprintString(value.string, "The blueprint book", "The blueprint book is not a blueprint string");
  return { string, ...(value.origin === undefined ? {} : { origin: parseBookOrigin(value.origin) }) };
}

/** What face.json says of the book of a project: that the project file holds one, as the entry `BOOK_FILE_NAME`, and the origin. */
export type ManifestBook = Pick<ProjectBook, "origin">;

/** face.json as read: the manifest, and `book` when the file says it has one. */
export interface ManifestFile {
  readonly manifest: ProjectManifest;
  readonly book?: ManifestBook;
}

function parseManifestBook(value: unknown): ManifestBook {
  if (!isRecord(value)) fail("The blueprint book of the manifest must be an object");
  // One book, in one entry whose name is fixed: a name of the file's choosing could be that of the manifest or of a circuit.
  if (value.file !== BOOK_FILE_NAME) fail(`The blueprint book of a project is its entry ${BOOK_FILE_NAME}; the manifest names another one`);
  return value.origin === undefined ? {} : { origin: parseBookOrigin(value.origin) };
}

const MANIFEST_FIELDS: ReadonlySet<string> = new Set(["formatVersion", "name", "gameVersion", "modules", "customSignalGroups", "circuits", "wireReach", "gameMods", "book"]);

function parseFormatVersion(value: unknown): ProjectFormatVersion {
  return value === PROJECT_FORMAT_VERSION || value === PROJECT_FORMAT_VERSION_WITH_BOOK ? value : fail(`Unsupported project format version: ${JSON.stringify(value)}`);
}

function parseJsonValue(value: unknown, what: string, depth: number): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : fail(`${what} contains a number that JSON cannot represent`);
  if (depth >= LIMITS.manifestExtrasDepth) fail(`${what} is nested too deeply`);
  if (Array.isArray(value)) return value.map((item) => parseJsonValue(item, what, depth + 1));
  if (!isRecord(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail(`${what} must be plain JSON data`);
  // Entries are copied as own data properties, so a "__proto__" key stays an ordinary key.
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parseJsonValue(item, what, depth + 1)]));
}

/** Unknown manifest fields: plain JSON data, none of them named like a known field, bounded in depth and size. */
function parseManifestExtras(value: unknown): Readonly<Record<string, JsonValue>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail("Unknown manifest fields must be an object");
  const extras: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (MANIFEST_FIELDS.has(key)) fail(`Unknown manifest fields must not redefine ${JSON.stringify(key)}`);
    parseString(key, "Manifest field name", LIMITS.identifierLength);
    Object.defineProperty(extras, key, { value: parseJsonValue(item, `Manifest field ${JSON.stringify(key)}`, 0), enumerable: true, writable: true, configurable: true });
  }
  if (Object.keys(extras).length === 0) return undefined;
  if (JSON.stringify(extras).length > LIMITS.manifestBytes) fail("Unknown manifest fields are too large");
  return extras;
}

/**
 * The in-memory manifest, as it crosses the IPC boundary: known fields plus `extras`. Anything else is dropped, a `book` as well:
 * in memory the book is part of the project data, not of the manifest.
 */
export function parseManifest(value: unknown): ProjectManifest {
  if (!isRecord(value)) fail("Project manifest must be an object");
  const formatVersion = parseFormatVersion(value.formatVersion);
  const circuits = parseArray(value.circuits, "Circuit file list", LIMITS.circuitFiles).map(parseCircuitFileName);
  if (new Set(circuits.map((name) => name.toLowerCase())).size !== circuits.length) fail("Circuit file names must be unique");
  const extras = parseManifestExtras(value.extras);
  return {
    formatVersion,
    name: parseString(value.name, "Project name", LIMITS.projectNameLength),
    gameVersion: parseString(value.gameVersion, "Game version", 32, true),
    modules: parseArray(value.modules, "Module list", LIMITS.modules).map((module) => parseString(module, "Module name", LIMITS.identifierLength)),
    customSignalGroups: parseArray(value.customSignalGroups ?? [], "Custom signal groups", LIMITS.customSignalGroups).map(parseCustomSignalGroup),
    circuits,
    ...(value.wireReach === undefined ? {} : { wireReach: parseWireReach(value.wireReach) }),
    ...(value.gameMods === undefined ? {} : { gameMods: parseProjectMods(value.gameMods) }),
    ...(extras ? { extras } : {}),
  };
}

/**
 * The content of face.json: known fields are validated as in `parseManifest`, every other top-level field is kept in `extras`.
 * `book` is taken whatever the format version says, so a file of version 1 can have a book and one of version 2 can have none.
 */
export function parseManifestFile(value: unknown): ManifestFile {
  if (!isRecord(value)) fail("Project manifest must be an object");
  const known: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) Object.defineProperty(MANIFEST_FIELDS.has(key) ? known : extras, key, { value: item, enumerable: true, writable: true, configurable: true });
  const manifest = parseManifest({ ...known, extras });
  return known.book === undefined ? { manifest } : { manifest, book: parseManifestBook(known.book) };
}

/**
 * The content of face.json for a manifest, and for the book of the project when it has one: unknown fields return to the top
 * level, after the known ones. The format version is set here and nowhere else: the one for a book with a book, else the one
 * every build reads, whatever the manifest says.
 */
export function manifestFileContent(manifest: ProjectManifest, book?: ManifestBook): Record<string, JsonValue> {
  const { extras, ...known } = manifest;
  const content: Record<string, JsonValue> = { ...(known as unknown as Record<string, JsonValue>), formatVersion: book ? PROJECT_FORMAT_VERSION_WITH_BOOK : PROJECT_FORMAT_VERSION };
  if (book) content.book = { file: BOOK_FILE_NAME, ...(book.origin ? { origin: book.origin } : {}) };
  for (const [key, item] of Object.entries(extras ?? {})) Object.defineProperty(content, key, { value: item, enumerable: true, writable: true, configurable: true });
  return content;
}

function parseCircuitFile(value: unknown): CircuitFile {
  if (!isRecord(value)) fail("Circuit file must be an object");
  const name = parseCircuitFileName(value.name);
  if (typeof value.source !== "string") fail(`Source of ${name} must be a string`);
  if (value.source.length > LIMITS.circuitSourceLength) fail(`Source of ${name} is too large`);
  return { name, source: value.source };
}

export function parseProjectData(value: unknown): ProjectData {
  if (!isRecord(value)) fail("Project data must be an object");
  const manifest = parseManifest(value.manifest);
  const files = parseArray(value.files, "Circuit files", LIMITS.circuitFiles).map(parseCircuitFile);
  const listed = new Set(manifest.circuits);
  if (files.length !== listed.size || files.some((file) => !listed.has(file.name))) fail("Circuit files must match the manifest's circuit list");
  if (new Set(files.map((file) => file.name)).size !== files.length) fail("Circuit files must be unique");
  return { manifest, files, ...(value.book === undefined ? {} : { book: parseProjectBook(value.book) }) };
}

export function parseSaveProjectRequest(value: unknown): SaveProjectRequest {
  if (!isRecord(value)) fail("Save request must be an object");
  return { path: value.path === null ? null : parseProjectPath(value.path), data: parseProjectData(value.data) };
}

/** What File > Export Blueprint writes to a file: a blueprint string of bounded length, and the project name the file name is suggested from. */
export function parseExportBlueprintRequest(value: unknown): ExportBlueprintRequest {
  if (!isRecord(value)) fail("Export request must be an object");
  const name = parseString(value.name, "Project name", LIMITS.projectNameLength);
  return { name, text: parseBlueprintString(value.text, "Blueprint string", "Not a blueprint string") };
}

/** Tolerant reader for the recent-projects file: malformed entries are dropped instead of failing the whole list. */
export function parseRecentProjects(value: unknown): RecentProject[] {
  if (!Array.isArray(value)) return [];
  const result: RecentProject[] = [];
  for (const entry of value) {
    if (result.length >= LIMITS.recentProjects) break;
    try {
      if (!isRecord(entry)) continue;
      // Any absolute path is kept: an entry that is not a project file (any more) fails when it is opened, with a clear message.
      const path = parseAbsolutePath(entry.path);
      const name = parseString(entry.name, "Project name", LIMITS.projectNameLength);
      const openedAt = parseString(entry.openedAt, "Timestamp", 40);
      if (Number.isNaN(Date.parse(openedAt)) || result.some((known) => known.path === path)) continue;
      result.push({ path, name, openedAt });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }
  return result;
}

export const APP_SETTINGS_VERSION = 1;

/** The folder of the game installation as the user chose it: absolute and normalized. Whether the game is there is for the inspection to say. */
export function parseGameDirectory(value: unknown): string {
  return parseAbsolutePath(value, "Game folder");
}

/** A signal kind and a name. The name is the game's or a mod's and is not looked into: it only ever compares equal to a signal of the data or not. */
const HIDDEN_SIGNAL = /^([a-z-]+):./;

function parseHiddenItem(value: unknown, what: "signal" | "entity"): string {
  const item = parseString(value, `Hidden ${what}`, LIMITS.hiddenItemLength);
  if (what === "signal" && !isSignalKind(HIDDEN_SIGNAL.exec(item)?.[1] ?? "")) fail("Hidden signal must be a signal kind and a name");
  return item;
}

/** What the renderer asks to hide of one module: bounded, each signal and entity once. A module with two empty lists is valid: nothing of it is hidden. */
export function parseHiddenModuleItems(value: unknown): HiddenModuleItems {
  if (!isRecord(value)) fail("Hidden items must be an object");
  const list = (items: unknown, what: "signal" | "entity"): string[] => [...new Set(parseArray(items, `Hidden ${what} list`, LIMITS.hiddenItems).map((item) => parseHiddenItem(item, what)))];
  const hidden = { module: parseString(value.module, "Module name", LIMITS.identifierLength), signals: list(value.signals, "signal"), entities: list(value.entities, "entity") };
  if (hidden.signals.length + hidden.entities.length > LIMITS.hiddenItems) fail(`Too many hidden signals and entities (limit ${LIMITS.hiddenItems})`);
  return hidden;
}

/** How many signals and entities the entries hide together. */
export function hiddenItemCount(hidden: readonly HiddenModuleItems[]): number {
  return hidden.reduce((sum, entry) => sum + entry.signals.length + entry.entities.length, 0);
}

/**
 * Tolerant reader for the hidden signals and entities of the settings file: an entry or an item that is malformed, a module
 * named twice and whatever is beyond the limits are dropped, the rest is kept. An entry that hides nothing is dropped as well.
 */
export function parseHiddenItemsFile(value: unknown): HiddenModuleItems[] {
  if (!Array.isArray(value)) return [];
  const result: HiddenModuleItems[] = [];
  let budget: number = LIMITS.hiddenItems;
  const list = (items: unknown, what: "signal" | "entity"): string[] => {
    const kept = new Set<string>();
    for (const item of Array.isArray(items) ? items : []) {
      if (kept.size >= budget) break;
      try {
        kept.add(parseHiddenItem(item, what));
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
      }
    }
    budget -= kept.size;
    return [...kept];
  };
  for (const entry of value) {
    if (result.length >= LIMITS.hiddenModules || budget <= 0) break;
    if (!isRecord(entry) || typeof entry.module !== "string" || entry.module === "" || entry.module.length > LIMITS.identifierLength || hasControlCharacters(entry.module)) continue;
    if (result.some((known) => known.module === entry.module)) continue;
    const hidden = { module: entry.module, signals: list(entry.signals, "signal"), entities: list(entry.entities, "entity") };
    if (hidden.signals.length + hidden.entities.length > 0) result.push(hidden);
  }
  return result;
}

/** Tolerant reader for the settings file of this machine: unknown or damaged content reads as the defaults, each setting on its own. */
export function parseAppSettingsFile(value: unknown): AppSettings {
  if (!isRecord(value) || value.version !== APP_SETTINGS_VERSION) return { gameDirectory: null, hidden: [] };
  let gameDirectory: string | null = null;
  try {
    if (value.gameDirectory !== null && value.gameDirectory !== undefined) gameDirectory = parseGameDirectory(value.gameDirectory);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }
  return { gameDirectory, hidden: parseHiddenItemsFile(value.hidden) };
}
