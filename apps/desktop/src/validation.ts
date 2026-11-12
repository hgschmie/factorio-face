// Validators for everything that crosses the IPC boundary or is read from disk. Pure: no Electron, no filesystem access.
import { basename, isAbsolute, normalize } from "node:path";
import {
  CIRCUIT_FILE_EXTENSION,
  LIMITS,
  PROJECT_FILE_EXTENSION,
  PROJECT_FORMAT_VERSION,
  type CircuitFile,
  type CustomSignal,
  type CustomSignalGroup,
  type JsonValue,
  type ProjectData,
  type ProjectManifest,
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
function parseAbsolutePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail("Project path must be a non-empty string");
  if (value.length > LIMITS.pathLength) fail("Project path is too long");
  if (value.includes("\0")) fail("Project path contains a NUL character");
  if (!isAbsolute(value)) fail("Project path must be absolute");
  if (normalize(value) !== value) fail("Project path must be normalized");
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

const CIRCUIT_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9 ._-]*$/;

/** A plain `*.face` file name: project format v1 keeps circuit files at the root of the project file. */
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

const MANIFEST_FIELDS: ReadonlySet<string> = new Set(["formatVersion", "name", "gameVersion", "modules", "customSignalGroups", "circuits"]);

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

/** The in-memory manifest, as it crosses the IPC boundary: known fields plus `extras`. Anything else is dropped. */
export function parseManifest(value: unknown): ProjectManifest {
  if (!isRecord(value)) fail("Project manifest must be an object");
  if (value.formatVersion !== PROJECT_FORMAT_VERSION) fail(`Unsupported project format version: ${JSON.stringify(value.formatVersion)}`);
  const circuits = parseArray(value.circuits, "Circuit file list", LIMITS.circuitFiles).map(parseCircuitFileName);
  if (new Set(circuits.map((name) => name.toLowerCase())).size !== circuits.length) fail("Circuit file names must be unique");
  const extras = parseManifestExtras(value.extras);
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name: parseString(value.name, "Project name", LIMITS.projectNameLength),
    gameVersion: parseString(value.gameVersion, "Game version", 32, true),
    modules: parseArray(value.modules, "Module list", LIMITS.modules).map((module) => parseString(module, "Module name", LIMITS.identifierLength)),
    customSignalGroups: parseArray(value.customSignalGroups ?? [], "Custom signal groups", LIMITS.customSignalGroups).map(parseCustomSignalGroup),
    circuits,
    ...(extras ? { extras } : {}),
  };
}

/** The content of face.json: known fields are validated as in `parseManifest`, every other top-level field is kept in `extras`. */
export function parseManifestFile(value: unknown): ProjectManifest {
  if (!isRecord(value)) fail("Project manifest must be an object");
  const known: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) Object.defineProperty(MANIFEST_FIELDS.has(key) ? known : extras, key, { value: item, enumerable: true, writable: true, configurable: true });
  return parseManifest({ ...known, extras });
}

/** The content of face.json for a manifest: unknown fields return to the top level, after the known ones. */
export function manifestFileContent(manifest: ProjectManifest): Record<string, JsonValue> {
  const { extras, ...known } = manifest;
  const content: Record<string, JsonValue> = { ...(known as unknown as Record<string, JsonValue>) };
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
  return { manifest, files };
}

export function parseSaveProjectRequest(value: unknown): SaveProjectRequest {
  if (!isRecord(value)) fail("Save request must be an object");
  return { path: value.path === null ? null : parseProjectPath(value.path), data: parseProjectData(value.data) };
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
