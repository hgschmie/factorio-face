// DEMO ONLY. An in-memory implementation of WorkbenchController, so every gesture of the workbench can be exercised
// before the language session exists. It applies commands directly to a Circuit and prints source text from it.
//
// What is fake here, and goes away with the real session:
// - the circuit is the source of truth and text is printed from it (in the product, text is the source of truth);
// - text typed into the editor is kept but never parsed; the next canvas edit replaces it;
// - projects opened from disk are shown as source only, because nothing can parse them yet;
// - undo is a stack of circuit snapshots (in the product, the editor's history is the single undo authority);
// - simulation traces are a synthetic waveform, clearly labelled in the dock.
import { DEFAULT_ENTITY, hasTerminal, normalizeWire, terminalKey, wireKey, type Circuit, type Entity, type EntityId, type EntityKind, type Point, type Wire } from "@face/model";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { FaceApi, IpcResult, LoadedProject, ProjectData, ProjectManifest } from "../../../desktop/src/ipc.ts";
import { SELECT_TOOL, type Diagnostic, type EntityMove, type SimulationView, type Tool, type WorkbenchCommands, type WorkbenchController, type WorkbenchMode, type WorkbenchState } from "./controller.ts";
import { createDemoCircuit, createGridCircuit } from "./demoCircuit.ts";
import { printDemoSource } from "./demoSource.ts";

const HISTORY_LIMIT = 200;
const TRACE_HISTORY = 80;
const TRACE_ROWS = 3;
const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60] as const;
const DEFAULT_FILE_NAME = "main.face";
const ENTITY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface DemoState {
  readonly projectName: string;
  readonly projectPath: string | null;
  /** Manifest of the opened project, kept so that saving preserves the parts the demo does not edit. */
  readonly manifest: ProjectManifest | null;
  readonly fileName: string;
  readonly circuit: Circuit;
  /** False for projects opened from disk: their text cannot be turned into a circuit here. */
  readonly canvasAttached: boolean;
  readonly source: string;
  /** True once the user typed in the editor; the text then no longer corresponds to `circuit`. */
  readonly sourceEdited: boolean;
  readonly savedSource: string;
  readonly selection: readonly EntityId[];
  readonly mode: WorkbenchMode;
  readonly tool: Tool;
  readonly past: readonly Circuit[];
  readonly future: readonly Circuit[];
  readonly nextEntityNumber: number;
  readonly running: boolean;
  readonly tick: number;
  readonly speed: number;
  readonly error: string | null;
}

export type DemoAction =
  | { readonly type: "setMode"; readonly mode: WorkbenchMode }
  | { readonly type: "setTool"; readonly tool: Tool }
  | { readonly type: "select"; readonly ids: readonly EntityId[] }
  | { readonly type: "fail"; readonly message: string }
  | { readonly type: "dismissError" }
  | { readonly type: "placeEntity"; readonly kind: EntityKind; readonly position: Point }
  | { readonly type: "moveEntities"; readonly moves: readonly EntityMove[] }
  | { readonly type: "updateEntity"; readonly entity: Entity }
  | { readonly type: "renameEntity"; readonly id: EntityId; readonly name: string }
  | { readonly type: "deleteEntities"; readonly ids: readonly EntityId[] }
  | { readonly type: "addWire"; readonly wire: Wire }
  | { readonly type: "removeWire"; readonly wire: Wire }
  | { readonly type: "setSource"; readonly source: string }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "run" }
  | { readonly type: "pause" }
  | { readonly type: "step" }
  | { readonly type: "resetSimulation" }
  | { readonly type: "setSpeed"; readonly speed: number }
  | { readonly type: "loadCircuit"; readonly circuit: Circuit }
  | { readonly type: "projectLoaded"; readonly project: LoadedProject }
  | { readonly type: "projectSaved"; readonly path: string; readonly source: string };

function freshState(circuit: Circuit, overrides: Partial<DemoState> = {}): DemoState {
  const source = printDemoSource(circuit);
  return {
    projectName: circuit.name,
    projectPath: null,
    manifest: null,
    fileName: DEFAULT_FILE_NAME,
    circuit,
    canvasAttached: true,
    source,
    sourceEdited: false,
    savedSource: source,
    selection: [],
    mode: "circuit",
    tool: SELECT_TOOL,
    past: [],
    future: [],
    nextEntityNumber: circuit.entities.length + 1,
    running: false,
    tick: 0,
    speed: 2,
    error: null,
    ...overrides,
  };
}

export function createDemoState(): DemoState {
  return freshState(createDemoCircuit());
}

/** Records `circuit` as a new undoable step and regenerates the source from it. */
function commit(state: DemoState, circuit: Circuit, changes: Partial<DemoState> = {}): DemoState {
  if (circuit === state.circuit) return { ...state, ...changes };
  return { ...state, circuit, source: printDemoSource(circuit), sourceEdited: false, past: [...state.past, state.circuit].slice(-HISTORY_LIMIT), future: [], ...changes };
}

function travel(state: DemoState, from: readonly Circuit[], to: readonly Circuit[]): { readonly circuit: Circuit; readonly from: readonly Circuit[]; readonly to: readonly Circuit[] } | null {
  const circuit = from.at(-1);
  return circuit ? { circuit, from: from.slice(0, -1), to: [...to, state.circuit] } : null;
}

function uniqueName(circuit: Circuit, kind: EntityKind): string {
  const used = new Set(circuit.entities.map((entity) => entity.name));
  for (let n = 1; ; n++) if (!used.has(`${kind}${n}`)) return `${kind}${n}`;
}

function existingIds(state: DemoState, ids: readonly EntityId[]): EntityId[] {
  const known = new Set(state.circuit.entities.map((entity) => entity.id));
  return [...new Set(ids)].filter((id) => known.has(id));
}

function wireError(circuit: Circuit, wire: Wire): string | null {
  for (const end of [wire.a, wire.b]) {
    const entity = circuit.entities.find((candidate) => candidate.id === end.entity);
    if (!entity) return "A wire needs two existing entities.";
    if (!hasTerminal(entity.kind, end.side)) return `${entity.name} has no ${end.side === "in" ? "input" : "output"} terminal.`;
  }
  return terminalKey(wire.a) === terminalKey(wire.b) ? "A wire cannot connect a terminal to itself." : null;
}

/** Document edits. Returns the unchanged state for no-ops, so no undo entry is created for them. */
function edit(state: DemoState, action: DemoAction): DemoState {
  const circuit = state.circuit;
  switch (action.type) {
    case "placeEntity": {
      const entity = { ...DEFAULT_ENTITY[action.kind], id: `e${state.nextEntityNumber}`, name: uniqueName(circuit, action.kind), position: { x: Math.round(action.position.x), y: Math.round(action.position.y) } } as Entity;
      return commit(state, { ...circuit, entities: [...circuit.entities, entity] }, { nextEntityNumber: state.nextEntityNumber + 1, selection: [entity.id], tool: SELECT_TOOL });
    }
    case "moveEntities": {
      const targets = new Map(action.moves.map((move) => [move.id, { x: Math.round(move.position.x), y: Math.round(move.position.y) }]));
      const changed = circuit.entities.some((entity) => {
        const target = targets.get(entity.id);
        return target !== undefined && (target.x !== entity.position.x || target.y !== entity.position.y);
      });
      // Untouched entities keep their identity, so their memoized cards are not re-rendered.
      return changed ? commit(state, { ...circuit, entities: circuit.entities.map((entity) => (targets.has(entity.id) ? { ...entity, position: targets.get(entity.id)! } : entity)) }) : state;
    }
    case "updateEntity": {
      const current = circuit.entities.find((entity) => entity.id === action.entity.id);
      if (!current || current.kind !== action.entity.kind) return state;
      const next = { ...action.entity, name: current.name, position: current.position };
      return commit(state, { ...circuit, entities: circuit.entities.map((entity) => (entity === current ? next : entity)) });
    }
    case "renameEntity": {
      const current = circuit.entities.find((entity) => entity.id === action.id);
      if (!current || current.name === action.name) return state;
      if (!ENTITY_NAME.test(action.name)) return { ...state, error: `"${action.name}" is not a valid entity name.` };
      if (circuit.entities.some((entity) => entity.name === action.name)) return { ...state, error: `The name "${action.name}" is already used.` };
      return commit(state, { ...circuit, entities: circuit.entities.map((entity) => (entity === current ? { ...entity, name: action.name } : entity)) });
    }
    case "deleteEntities": {
      const doomed = new Set(existingIds(state, action.ids));
      if (doomed.size === 0) return state;
      const next = { ...circuit, entities: circuit.entities.filter((entity) => !doomed.has(entity.id)), wires: circuit.wires.filter((wire) => !doomed.has(wire.a.entity) && !doomed.has(wire.b.entity)) };
      return commit(state, next, { selection: state.selection.filter((id) => !doomed.has(id)) });
    }
    case "addWire": {
      const problem = wireError(circuit, action.wire);
      if (problem) return { ...state, error: problem };
      const wire = normalizeWire(action.wire);
      return circuit.wires.some((existing) => wireKey(existing) === wireKey(wire)) ? state : commit(state, { ...circuit, wires: [...circuit.wires, wire] });
    }
    case "removeWire": {
      const key = wireKey(action.wire);
      const wires = circuit.wires.filter((wire) => wireKey(wire) !== key);
      return wires.length === circuit.wires.length ? state : commit(state, { ...circuit, wires });
    }
    default:
      return state;
  }
}

const EDIT_ACTIONS: ReadonlySet<DemoAction["type"]> = new Set(["placeEntity", "moveEntities", "updateEntity", "renameEntity", "deleteEntities", "addWire", "removeWire"]);

export function reduceDemo(state: DemoState, action: DemoAction): DemoState {
  if (EDIT_ACTIONS.has(action.type)) return state.canvasAttached ? edit(state, action) : state;
  switch (action.type) {
    case "setMode":
      return { ...state, mode: action.mode };
    case "setTool":
      return { ...state, tool: action.tool };
    case "select": {
      const selection = existingIds(state, action.ids);
      const unchanged = selection.length === state.selection.length && selection.every((id, index) => id === state.selection[index]);
      return unchanged ? state : { ...state, selection };
    }
    case "fail":
      return { ...state, error: action.message };
    case "dismissError":
      return { ...state, error: null };
    case "setSource":
      return action.source === state.source ? state : { ...state, source: action.source, sourceEdited: true };
    case "undo": {
      const step = travel(state, state.past, state.future);
      return step ? { ...state, circuit: step.circuit, past: step.from, future: step.to, source: printDemoSource(step.circuit), sourceEdited: false, selection: existingIds({ ...state, circuit: step.circuit }, state.selection) } : state;
    }
    case "redo": {
      const step = travel(state, state.future, state.past);
      return step ? { ...state, circuit: step.circuit, future: step.from, past: step.to, source: printDemoSource(step.circuit), sourceEdited: false, selection: existingIds({ ...state, circuit: step.circuit }, state.selection) } : state;
    }
    case "run":
      return state.canvasAttached ? { ...state, running: true } : state;
    case "pause":
      return { ...state, running: false };
    case "step":
      return state.canvasAttached ? { ...state, tick: state.tick + 1 } : state;
    case "resetSimulation":
      return { ...state, running: false, tick: 0 };
    case "setSpeed":
      return SPEED_OPTIONS.some((speed) => speed === action.speed) ? { ...state, speed: action.speed } : state;
    case "loadCircuit":
      return freshState(action.circuit, { mode: state.mode });
    case "projectLoaded": {
      const { path, data } = action.project;
      const file = data.files[0];
      const base = { projectName: data.manifest.name, projectPath: path, manifest: data.manifest, fileName: file?.name ?? DEFAULT_FILE_NAME };
      // A new project is an empty circuit the demo can edit. Anything read from disk is text it cannot parse.
      if (path === null) return freshState({ name: data.manifest.name, entities: [], wires: [] }, { ...base, mode: state.mode });
      const source = file?.source ?? "";
      return freshState({ name: data.manifest.name, entities: [], wires: [] }, { ...base, canvasAttached: false, source, savedSource: source, mode: "source" });
    }
    case "projectSaved":
      return { ...state, projectPath: action.path, savedSource: action.source };
    default:
      return state;
  }
}

// Views of the demo state

const NO_DIAGNOSTICS: readonly Diagnostic[] = [];
const TEXT_NOT_PARSED: readonly Diagnostic[] = [{ from: 0, to: 0, severity: "info", code: "demo-text-not-parsed", message: "Demo mode: typed text is not parsed. The next canvas edit regenerates the source." }];
const SOURCE_ONLY: readonly Diagnostic[] = [{ from: 0, to: 0, severity: "info", code: "demo-source-only", message: "Demo mode: an opened project is shown as source only until the language session is connected." }];

/** A deterministic placeholder waveform; it has nothing to do with the circuit's behaviour. */
function demoTraceValue(row: number, tick: number): number {
  return (tick * (row + 1)) % (8 + 4 * row);
}

function demoSimulation(state: DemoState): SimulationView {
  const selected = state.circuit.entities.filter((entity) => state.selection.includes(entity.id));
  const traced = (selected.length > 0 ? selected : state.circuit.entities).slice(0, TRACE_ROWS);
  const firstTick = Math.max(0, state.tick - TRACE_HISTORY + 1);
  return {
    available: state.canvasAttached,
    running: state.running,
    tick: state.tick,
    speed: state.speed,
    speedOptions: SPEED_OPTIONS,
    historyLength: TRACE_HISTORY,
    traces: traced.map((entity, row) => ({
      id: entity.id,
      label: entity.name,
      values: Array.from({ length: state.tick - firstTick + 1 }, (_, index) => demoTraceValue(row, firstTick + index)),
      current: String(demoTraceValue(row, state.tick)),
    })),
    entityStatus: new Map(),
    notice: "Demo waveform: the simulation engine is not connected yet",
  };
}

export function isDirty(state: DemoState): boolean {
  return state.source !== state.savedSource;
}

export function toWorkbenchState(state: DemoState): WorkbenchState {
  return {
    project: { name: state.projectName, path: state.projectPath, fileName: state.fileName, dirty: isDirty(state) },
    circuit: state.circuit,
    editable: state.canvasAttached,
    selection: state.selection,
    mode: state.mode,
    tool: state.tool,
    source: state.source,
    diagnostics: !state.canvasAttached ? SOURCE_ONLY : state.sourceEdited ? TEXT_NOT_PARSED : NO_DIAGNOSTICS,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    simulation: demoSimulation(state),
    error: state.error,
  };
}

export function toProjectData(state: DemoState): ProjectData {
  const manifest: ProjectManifest = {
    formatVersion: 1,
    gameVersion: "2.1.24",
    modules: ["base", "space-age", "quality", "recycler", "elevated-rails"],
    customSignalGroups: [],
    ...state.manifest,
    name: state.projectName,
    circuits: [state.fileName],
  };
  return { manifest, files: [{ name: state.fileName, source: state.source }] };
}

// Store

export interface DemoSession {
  subscribe(listener: () => void): () => void;
  getController(): WorkbenchController;
  getState(): DemoState;
  dispatch(action: DemoAction): void;
  dispose(): void;
}

const NO_DESKTOP = "Projects can only be opened and saved in the desktop app.";

export function createDemoSession(api: FaceApi | undefined, initial: DemoState = createDemoState()): DemoSession {
  let state = initial;
  let controller: WorkbenchController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();

  const syncTimer = (): void => {
    clearInterval(timer);
    timer = state.running ? setInterval(() => dispatch({ type: "step" }), 1000 / state.speed) : undefined;
  };

  const dispatch = (action: DemoAction): void => {
    const previous = state;
    state = reduceDemo(state, action);
    if (state === previous) return;
    controller = undefined;
    if (state.running !== previous.running || state.speed !== previous.speed) syncTimer();
    for (const listener of listeners) listener();
  };

  /** Unwraps an IPC result; a failure becomes the visible error and yields undefined. */
  const unwrap = <T>(result: IpcResult<T>): T | undefined => {
    if (result.ok) return result.value;
    dispatch({ type: "fail", message: result.error });
    return undefined;
  };

  const writeProject = async (saveAs: boolean): Promise<boolean> => {
    if (!api) {
      dispatch({ type: "fail", message: NO_DESKTOP });
      return false;
    }
    const snapshot = state;
    const data = toProjectData(snapshot);
    const saved = unwrap(saveAs ? await api.saveProjectAs(data) : await api.saveProject({ path: snapshot.projectPath, data }));
    if (!saved) return false;
    dispatch({ type: "projectSaved", path: saved.path, source: snapshot.source });
    return true;
  };

  /** Before the current project is replaced: offers to save unsaved changes. Resolves false when the user cancels. */
  const mayReplaceProject = async (): Promise<boolean> => {
    if (!api) {
      dispatch({ type: "fail", message: NO_DESKTOP });
      return false;
    }
    if (!isDirty(state)) return true;
    const choice = unwrap(await api.confirmUnsavedChanges());
    if (choice === "save") return writeProject(false);
    return choice === "discard";
  };

  const replaceProject = async (load: (desktop: FaceApi) => Promise<IpcResult<LoadedProject | null>>): Promise<void> => {
    if (!api || !(await mayReplaceProject())) return;
    const project = unwrap(await load(api));
    if (project) dispatch({ type: "projectLoaded", project });
  };

  const commands: WorkbenchCommands = {
    setMode: (mode) => dispatch({ type: "setMode", mode }),
    setTool: (tool) => dispatch({ type: "setTool", tool }),
    select: (ids) => dispatch({ type: "select", ids }),
    dismissError: () => dispatch({ type: "dismissError" }),
    placeEntity: (kind, position) => dispatch({ type: "placeEntity", kind, position }),
    moveEntities: (moves) => dispatch({ type: "moveEntities", moves }),
    updateEntity: (entity) => dispatch({ type: "updateEntity", entity }),
    renameEntity: (id, name) => dispatch({ type: "renameEntity", id, name }),
    deleteEntities: (ids) => dispatch({ type: "deleteEntities", ids }),
    addWire: (wire) => dispatch({ type: "addWire", wire }),
    removeWire: (wire) => dispatch({ type: "removeWire", wire }),
    setSource: (source) => dispatch({ type: "setSource", source }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    run: () => dispatch({ type: "run" }),
    pause: () => dispatch({ type: "pause" }),
    step: () => dispatch({ type: "step" }),
    resetSimulation: () => dispatch({ type: "resetSimulation" }),
    setSpeed: (speed) => dispatch({ type: "setSpeed", speed }),
    newProject: () => replaceProject((desktop) => desktop.newProject()),
    openProject: () => replaceProject((desktop) => desktop.openProject()),
    loadProject: (path) => replaceProject((desktop) => desktop.loadProject(path)),
    save: () => writeProject(false),
    saveAs: () => writeProject(true),
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getController: () => (controller ??= { state: toWorkbenchState(state), commands }),
    getState: () => state,
    dispatch,
    dispose: () => clearInterval(timer),
  };
}

/** Hook for scripted checks (end-to-end tests, scale measurements). Exists only while the demo session does. */
export interface DemoTestHook {
  loadGrid(entityCount: number): void;
  loadCircuit(circuit: Circuit): void;
  getCircuit(): Circuit;
}

declare global {
  interface Window {
    faceDemo?: DemoTestHook;
  }
}

/** The demo controller for `App`. The session object is created once and lives as long as the component. */
export function useDemoSession(api: FaceApi | undefined): WorkbenchController {
  const [session] = useState(() => createDemoSession(api));
  useEffect(() => {
    window.faceDemo = {
      loadGrid: (entityCount) => session.dispatch({ type: "loadCircuit", circuit: createGridCircuit(entityCount) }),
      loadCircuit: (circuit) => session.dispatch({ type: "loadCircuit", circuit }),
      getCircuit: () => session.getState().circuit,
    };
    return () => {
      delete window.faceDemo;
      session.dispose();
    };
  }, [session]);
  return useSyncExternalStore(session.subscribe, session.getController);
}
