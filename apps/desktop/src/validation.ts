// Validators for everything that crosses the IPC boundary or is read from disk. Pure: no Electron, no filesystem access.
import { isAbsolute, normalize, resolve, sep } from "node:path";
import {
  CIRCUIT_FILE_EXTENSION,
  LIMITS,
  PROJECT_FORMAT_VERSION,
  type CircuitFile,
  type CustomSignal,
  type CustomSignalGroup,
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

/** An absolute, already normalized directory path. Relative paths and paths with `..` or `.` segments are rejected, not repaired. */
export function parseProjectPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail("Project path must be a non-empty string");
  if (value.length > LIMITS.pathLength) fail("Project path is too long");
  if (value.includes("\0")) fail("Project path contains a NUL character");
  if (!isAbsolute(value)) fail("Project path must be absolute");
  const withoutTrailingSeparator = value.length > 1 && value.endsWith(sep) ? value.slice(0, -1) : value;
  if (normalize(withoutTrailingSeparator) !== withoutTrailingSeparator) fail("Project path must be normalized");
  return withoutTrailingSeparator;
}

const CIRCUIT_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9 ._-]*$/;

/** A plain `*.face` file name: project format v1 keeps circuit files directly in the project directory. */
export function parseCircuitFileName(value: unknown): string {
  if (typeof value !== "string") fail("Circuit file name must be a string");
  if (value.length > LIMITS.circuitFileNameLength) fail("Circuit file name is too long");
  if (!value.endsWith(CIRCUIT_FILE_EXTENSION) || value.length === CIRCUIT_FILE_EXTENSION.length) fail(`Circuit file name must end in ${CIRCUIT_FILE_EXTENSION}: ${JSON.stringify(value)}`);
  if (!CIRCUIT_FILE_NAME.test(value) || value.includes("..")) fail(`Circuit file name is not a plain file name: ${JSON.stringify(value)}`);
  return value;
}

/** Resolves a validated circuit file name and proves that the result is directly inside the project directory. */
export function resolveInsideProject(projectPath: string, fileName: string): string {
  const directory = parseProjectPath(projectPath);
  const resolved = resolve(directory, parseCircuitFileName(fileName));
  const prefix = directory.endsWith(sep) ? directory : directory + sep;
  if (!resolved.startsWith(prefix) || resolved.slice(prefix.length).includes(sep)) fail("Circuit file is outside the project directory");
  return resolved;
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

export function parseManifest(value: unknown): ProjectManifest {
  if (!isRecord(value)) fail("Project manifest must be an object");
  if (value.formatVersion !== PROJECT_FORMAT_VERSION) fail(`Unsupported project format version: ${JSON.stringify(value.formatVersion)}`);
  const circuits = parseArray(value.circuits, "Circuit file list", LIMITS.circuitFiles).map(parseCircuitFileName);
  if (new Set(circuits.map((name) => name.toLowerCase())).size !== circuits.length) fail("Circuit file names must be unique");
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name: parseString(value.name, "Project name", LIMITS.projectNameLength),
    gameVersion: parseString(value.gameVersion, "Game version", 32, true),
    modules: parseArray(value.modules, "Module list", LIMITS.modules).map((module) => parseString(module, "Module name", LIMITS.identifierLength)),
    customSignalGroups: parseArray(value.customSignalGroups ?? [], "Custom signal groups", LIMITS.customSignalGroups).map(parseCustomSignalGroup),
    circuits,
  };
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
      const path = parseProjectPath(entry.path);
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
