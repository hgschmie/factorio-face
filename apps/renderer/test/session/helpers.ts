import type { Entity, EntityId } from "@face/model";
import { createEmptyProject } from "../../../desktop/src/emptyProject.ts";
import type { AppSettingsState, FaceApi, IpcResult, LoadedProject, ProjectData, ProjectManifest } from "../../../desktop/src/ipc.ts";
import { DEFAULT_FILE_NAME } from "../../src/session/persistence.ts";
import { ProjectSession, type SessionOptions } from "../../src/session/projectSession.ts";
import type { Scheduler } from "../../src/session/simulationRunner.ts";
import { EXAMPLE_PROJECT_NAME, EXAMPLE_SOURCE } from "../fixtures/example.ts";

/** A scheduler whose timers only fire when the test says so. */
export class ManualScheduler implements Scheduler {
  readonly timers: { readonly milliseconds: number; readonly callback: () => void }[] = [];

  every(milliseconds: number, callback: () => void): () => void {
    const timer = { milliseconds, callback };
    this.timers.push(timer);
    return () => void this.timers.splice(this.timers.indexOf(timer), 1);
  }

  fire(times = 1): void {
    for (let i = 0; i < times; i++) for (const timer of [...this.timers]) timer.callback();
  }
}

export const MANIFEST: ProjectManifest = { formatVersion: 1, name: "Test project", gameVersion: "2.1.24", modules: ["base", "space-age", "quality", "recycler", "elevated-rails"], customSignalGroups: [], circuits: [DEFAULT_FILE_NAME] };

export function project(source: string, manifest: Partial<ProjectManifest> = {}, path: string | null = null): LoadedProject {
  return { path, data: { manifest: { ...MANIFEST, ...manifest }, files: [{ name: DEFAULT_FILE_NAME, source }] } };
}

/** The example that ships with the app, as the app opens it: an unsaved copy. */
export function exampleProject(): LoadedProject {
  return project(EXAMPLE_SOURCE, { name: EXAMPLE_PROJECT_NAME });
}

/** The source of the empty project the app starts with and File > New Project gives. */
export const EMPTY_SOURCE = 'circuit "Untitled circuit" {\n}\n';

export interface TestSession {
  readonly session: ProjectSession;
  readonly scheduler: ManualScheduler;
  /** Number of times listeners were notified. */
  readonly notifications: () => number;
}

/** A session on `source`; without one, on the example project, which most tests work with. */
export function createSession(source?: string, options: SessionOptions = {}): TestSession {
  const scheduler = new ManualScheduler();
  const session = new ProjectSession({ scheduler, editorExtensions: [], project: source === undefined ? exampleProject() : project(source), ...options });
  let count = 0;
  session.subscribe(() => count++);
  return { session, scheduler, notifications: () => count };
}

export function entityNamed(session: ProjectSession, name: string): Entity {
  const entity = session.state.circuit.entities.find((candidate) => candidate.name === name);
  if (!entity) throw new Error(`No entity named ${name}`);
  return entity;
}

export function idOf(session: ProjectSession, name: string): EntityId {
  return entityNamed(session, name).id;
}

export function errorsOf(session: ProjectSession): string[] {
  return session.state.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code);
}

/** Types `text` at `offset` the way the editor does: one transaction with the `input.type` user event. */
export function type(session: ProjectSession, offset: number, text: string): void {
  session.document.dispatch({ changes: { from: offset, insert: text }, userEvent: "input.type" });
}

export function replaceText(session: ProjectSession, search: string, replacement: string): void {
  const from = session.document.text.indexOf(search);
  if (from < 0) throw new Error(`Text not found: ${search}`);
  session.document.dispatch({ changes: { from, to: from + search.length, insert: replacement }, userEvent: "input.type" });
}

export interface FakeDesktop {
  readonly api: FaceApi;
  /** Projects "on disk", by path. */
  readonly disk: Map<string, ProjectData>;
  /** The example projects of the application, by file name. */
  readonly examples: Map<string, ProjectData>;
  readonly dirtyReports: boolean[];
  /** Path of the project at the top of the recent projects; null when there is none. */
  lastProject: string | null;
  savePath: string | null;
  unsavedChoice: "save" | "discard" | "cancel";
  confirmations: number;
}

const NO_GAME: AppSettingsState = { chosenFolder: null, dataDirectory: null, source: "none", gameVersion: null, catalogVersion: "2.1.24", versionMatch: null, modules: [], problem: null, iconRevision: 0 };

/** An in-memory stand-in for the desktop bridge. Data is cloned on the way in and out, like over IPC. */
export function fakeDesktop(): FakeDesktop {
  const ok = <T>(value: T): Promise<IpcResult<T>> => Promise.resolve({ ok: true, value: structuredClone(value) });
  const desktop: FakeDesktop = {
    disk: new Map(),
    examples: new Map(),
    dirtyReports: [],
    lastProject: null,
    savePath: "/projects/saved",
    unsavedChoice: "discard",
    confirmations: 0,
    api: {
      platform: "test",
      catalogAssetUrl: "face-asset://catalog/",
      newProject: () => ok({ path: null, data: createEmptyProject() }),
      openProject: () => ok(null),
      loadProject: (path) => {
        const data = desktop.disk.get(path);
        return data ? ok({ path, data }) : Promise.resolve({ ok: false, error: `Not a face project (no face.json): ${path}` });
      },
      openLastProject: () => (desktop.lastProject === null ? ok(null) : desktop.api.loadProject(desktop.lastProject)),
      openExample: (file) => {
        const data = desktop.examples.get(file);
        return data ? ok({ path: null, data }) : Promise.resolve({ ok: false, error: `Not an example of this application: ${file}` });
      },
      saveProject: (request) => {
        const path = request.path ?? desktop.savePath;
        if (path === null) return ok(null);
        desktop.disk.set(path, structuredClone(request.data));
        return ok({ path });
      },
      saveProjectAs: (data) => {
        if (desktop.savePath === null) return ok(null);
        desktop.disk.set(desktop.savePath, structuredClone(data));
        return ok({ path: desktop.savePath });
      },
      getRecentProjects: () => ok([]),
      clearRecentProjects: () => ok(null),
      confirmUnsavedChanges: () => {
        desktop.confirmations++;
        return ok(desktop.unsavedChoice);
      },
      paste: () => ok(null),
      getAppSettings: () => ok(NO_GAME),
      chooseGameFolder: () => ok(null),
      resetGameFolder: () => ok(NO_GAME),
      onAppSettingsChanged: () => () => undefined,
      setDirty: (dirty) => void desktop.dirtyReports.push(dirty),
      onMenuCommand: () => () => undefined,
      onSaveBeforeClose: () => () => undefined,
    },
  };
  return desktop;
}

/** A hand-written document: comments in every position, irregular spacing, mixed indentation, a reversed duplicate wire. */
export const IRREGULAR = `// Header comment
circuit   "Irregular"   {
  /* about the source */ constant   src   at ( 40 ,80 )   { virtual:signal-A = 1   // one per tick
  }

\tdecider gate at (300, 80) {
\t\twhen virtual:signal-A < 10   // limit
\t\toutput virtual:signal-A = input
\t}
  lamp light at (560,   80) { when virtual:signal-A > 3 }

  wire red src.out <-> gate.in   // first
  wire  green  gate.out<->gate.in
  wire red gate.in <-> src.out // reversed duplicate
  wire green gate.out <-> light.in
}
`;
