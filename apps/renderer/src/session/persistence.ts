// The project as a file: what was loaded, what is saved, and whether the two differ. Pure; the IPC calls are in the session.
import type { CircuitFile, LoadedProject, ProjectData, ProjectManifest } from "../../../desktop/src/ipc.ts";
import { STARTER_PROJECT_NAME, STARTER_SOURCE } from "./starter.ts";

export const DEFAULT_FILE_NAME = "main.face";
export const DEFAULT_GAME_VERSION = "2.1.24";
export const DEFAULT_MODULES: readonly string[] = ["base", "space-age", "quality", "recycler", "elevated-rails"];

/** The editable project settings. */
export interface ProjectSettings {
  readonly name: string;
  /** Enabled module names as stored in face.json, unknown names included. */
  readonly modules: readonly string[];
}

export interface ProjectFile {
  /** Absolute project directory; null until the project was saved for the first time. */
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
}

function starterManifest(defaults?: ProjectManifest): ProjectManifest {
  return { formatVersion: 1, gameVersion: DEFAULT_GAME_VERSION, modules: DEFAULT_MODULES, customSignalGroups: [], ...defaults, name: STARTER_PROJECT_NAME, circuits: [DEFAULT_FILE_NAME] };
}

/** A new, unsaved project with the example circuit. `defaults` is the manifest the desktop shell creates for new projects. */
export function starterProject(defaults?: ProjectManifest): LoadedProject {
  return { path: null, data: { manifest: starterManifest(defaults), files: [{ name: DEFAULT_FILE_NAME, source: STARTER_SOURCE }] } };
}

export function openProjectFile(project: LoadedProject): { readonly file: ProjectFile; readonly source: string; readonly settings: ProjectSettings } {
  const { manifest, files } = project.data;
  const fileName = manifest.circuits[0] ?? DEFAULT_FILE_NAME;
  const source = files.find((file) => file.name === fileName)?.source ?? "";
  const settings: ProjectSettings = { name: manifest.name, modules: manifest.modules };
  return { file: { path: project.path, manifest, fileName, otherFiles: files.filter((file) => file.name !== fileName), savedSource: source, savedSettings: settings }, source, settings };
}

function sameModules(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

export function sameSettings(a: ProjectSettings, b: ProjectSettings): boolean {
  return a.name === b.name && sameModules(a.modules, b.modules);
}

export function isDirty(file: ProjectFile, source: string, settings: ProjectSettings): boolean {
  return source !== file.savedSource || !sameSettings(settings, file.savedSettings);
}

/** What goes to disk: the loaded manifest with the current name and modules, the edited source and the untouched other files. */
export function toProjectData(file: ProjectFile, source: string, settings: ProjectSettings): ProjectData {
  const circuits = file.manifest.circuits.length > 0 ? file.manifest.circuits : [file.fileName];
  const manifest: ProjectManifest = { ...file.manifest, name: settings.name, modules: sameModules(settings.modules, file.manifest.modules) ? file.manifest.modules : settings.modules, circuits };
  const sources = new Map<string, string>([...file.otherFiles.map((other) => [other.name, other.source] as const), [file.fileName, source]]);
  return { manifest, files: circuits.map((name) => ({ name, source: sources.get(name) ?? "" })) };
}

export function savedProjectFile(file: ProjectFile, path: string, data: ProjectData, source: string, settings: ProjectSettings): ProjectFile {
  return { ...file, path, manifest: data.manifest, savedSource: source, savedSettings: settings };
}
