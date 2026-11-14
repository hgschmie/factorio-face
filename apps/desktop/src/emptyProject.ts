// The project a new project and a freshly started app begin with. Pure data: the main process hands it out for File > New Project and
// the renderer shows it until a project is opened, so both import this module at runtime. Keep it free of Node and Electron imports.
import { DEFAULT_CIRCUIT_FILE, PROJECT_FORMAT_VERSION, type ProjectData } from "./ipc.ts";

export const DEFAULT_GAME_VERSION = "2.1.24";
export const DEFAULT_MODULES = ["base", "space-age", "quality", "recycler", "elevated-rails"] as const;
export const DEFAULT_PROJECT_NAME = "Untitled circuit";

/** A project with one circuit that has no entities and no wires. */
export function createEmptyProject(name = DEFAULT_PROJECT_NAME): ProjectData {
  return {
    manifest: { formatVersion: PROJECT_FORMAT_VERSION, name, gameVersion: DEFAULT_GAME_VERSION, modules: [...DEFAULT_MODULES], customSignalGroups: [], circuits: [DEFAULT_CIRCUIT_FILE] },
    files: [{ name: DEFAULT_CIRCUIT_FILE, source: `circuit ${JSON.stringify(name)} {\n}\n` }],
  };
}
