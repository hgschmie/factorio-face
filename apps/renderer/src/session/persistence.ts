// The project as a file: what was loaded, what is saved, and whether the two differ. Pure; the IPC calls are in the session.
import { DEFAULT_WIRE_REACH } from "@face/model";
import { DEFAULT_MODULES, createEmptyProject } from "../../../desktop/src/emptyProject.ts";
import type { CircuitFile, LoadedProject, ProjectBook, ProjectData, ProjectManifest, ProjectMods } from "../../../desktop/src/ipc.ts";

export const DEFAULT_FILE_NAME = "main.face";
/** Longest project name: what the main process accepts in a manifest. */
export const PROJECT_NAME_LIMIT = 200;

/** The editable project settings. */
export interface ProjectSettings {
  readonly name: string;
  /** Enabled module names as stored in face.json, unknown names included. */
  readonly modules: readonly string[];
  /** How far apart two entities may be for a circuit wire, in tiles, 0 for unlimited; `DEFAULT_WIRE_REACH` for a project file that does not say. */
  readonly wireReach: number;
}

export interface ProjectFile {
  /** Absolute path of the project file; null until the project was saved for the first time. */
  readonly path: string | null;
  /** The manifest as loaded; everything this version does not edit (custom signal groups, unknown fields) is written back from here. */
  readonly manifest: ProjectManifest;
  /** Name of the circuit file shown in the editor. */
  readonly fileName: string;
  /** The project's other circuit files, written back unchanged. */
  readonly otherFiles: readonly CircuitFile[];
  /** Source and settings as they are on disk (for a new project: as it started). */
  readonly savedSource: string;
  readonly savedSettings: ProjectSettings;
  /** The blueprint book as it is on disk; absent when the file has none. */
  readonly savedBook?: ProjectBook;
}

/** What a session shows before a project is opened: the empty project File > New Project gives, not saved anywhere. */
export function emptyProject(): LoadedProject {
  return { path: null, data: createEmptyProject() };
}

/**
 * The modules a new project has on with the data in use: the game's own, as far as the data has them (a game with Quality
 * switched off has no such module), in the order of the empty project. Mods are off until the project switches them on.
 */
export function defaultModules(catalog: { readonly modules: readonly { readonly name: string }[] }): readonly string[] {
  return DEFAULT_MODULES.filter((name) => catalog.modules.some((module) => module.name === name));
}

/** The project with another module list, as it would have been loaded with it. */
export function withModules(project: LoadedProject, modules: readonly string[]): LoadedProject {
  return { ...project, data: { ...project.data, manifest: { ...project.data.manifest, modules: [...modules] } } };
}

/** `book` is the blueprint book the project holds, as the file has it: the string is not looked at here. */
export function openProjectFile(project: LoadedProject): { readonly file: ProjectFile; readonly source: string; readonly settings: ProjectSettings; readonly book?: ProjectBook } {
  const { manifest, files, book } = project.data;
  const fileName = manifest.circuits[0] ?? DEFAULT_FILE_NAME;
  const source = files.find((file) => file.name === fileName)?.source ?? "";
  const settings: ProjectSettings = { name: manifest.name, modules: manifest.modules, wireReach: manifest.wireReach ?? DEFAULT_WIRE_REACH };
  const file: ProjectFile = { path: project.path, manifest, fileName, otherFiles: files.filter((other) => other.name !== fileName), savedSource: source, savedSettings: settings, ...(book && { savedBook: book }) };
  return { file, source, settings, ...(book && { book }) };
}

/**
 * The file of a project that exists nowhere but in the window (an imported blueprint, with the book it is of): it counts as
 * changed until it is saved, so that closing the window or opening another project asks first.
 */
export function neverSaved(file: ProjectFile): ProjectFile {
  const { savedBook: _unsaved, ...rest } = file;
  return { ...rest, savedSource: "" };
}

function sameModules(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

export function sameSettings(a: ProjectSettings, b: ProjectSettings): boolean {
  return a.name === b.name && a.wireReach === b.wireReach && sameModules(a.modules, b.modules);
}

/** The same book, or none on both sides: the same string and the same origin. */
export function sameBook(a: ProjectBook | undefined, b: ProjectBook | undefined): boolean {
  if (!a || !b) return a === b;
  const [left, right] = [a.origin ?? [], b.origin ?? []];
  return a.string === b.string && left.length === right.length && left.every((position, index) => position === right[index]);
}

/** `book` is the blueprint book the project holds now; a project without one passes none. */
export function isDirty(file: ProjectFile, source: string, settings: ProjectSettings, book?: ProjectBook): boolean {
  return source !== file.savedSource || !sameSettings(settings, file.savedSettings) || !sameBook(book, file.savedBook);
}

/**
 * What goes to disk: the loaded manifest with the current settings, the edited source and the untouched other files. The wire
 * reach is written only when it is not the default, so a project that never changed it has no such field. `gameMods` is the
 * record of the game the data in use was read from, when it was read from a game with mods (`modsRecord`): it replaces the
 * project's record. Without it the project keeps the record it was loaded with. `book` is the blueprint book the project
 * holds, with the item its circuit came from; without one the data has no `book` at all.
 */
export function toProjectData(file: ProjectFile, source: string, settings: ProjectSettings, gameMods?: ProjectMods, book?: ProjectBook): ProjectData {
  const circuits = file.manifest.circuits.length > 0 ? file.manifest.circuits : [file.fileName];
  const { wireReach: _loaded, ...loaded } = file.manifest;
  const manifest: ProjectManifest = {
    ...loaded,
    name: settings.name,
    modules: sameModules(settings.modules, file.manifest.modules) ? file.manifest.modules : settings.modules,
    circuits,
    ...(settings.wireReach === DEFAULT_WIRE_REACH ? {} : { wireReach: settings.wireReach }),
    ...(gameMods ? { gameMods } : {}),
  };
  const sources = new Map<string, string>([...file.otherFiles.map((other) => [other.name, other.source] as const), [file.fileName, source]]);
  const files = circuits.map((name) => ({ name, source: sources.get(name) ?? "" }));
  return book ? { manifest, files, book: { string: book.string, ...(book.origin?.length ? { origin: book.origin } : {}) } } : { manifest, files };
}

export function savedProjectFile(file: ProjectFile, path: string, data: ProjectData, source: string, settings: ProjectSettings): ProjectFile {
  const { savedBook: _replaced, ...rest } = file;
  return { ...rest, path, manifest: data.manifest, savedSource: source, savedSettings: settings, ...(data.book && { savedBook: data.book }) };
}
