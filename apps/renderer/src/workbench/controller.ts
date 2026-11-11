// The seam between the workbench views and whatever owns the document.
//
// Views render `WorkbenchState` and call `WorkbenchCommands`; they hold no document logic. Today the only implementation
// is the in-memory demo (demoSession.ts). The language session replaces it by providing the same two objects.
import type { Extension } from "@codemirror/state";
import type { Circuit, Entity, EntityId, EntityKind, Point, Wire, WireColor } from "@face/model";

export const WORKBENCH_MODES = ["circuit", "source", "split"] as const;
export type WorkbenchMode = (typeof WORKBENCH_MODES)[number];

/** The active canvas tool. */
export type Tool = { readonly type: "select" } | { readonly type: "place"; readonly kind: EntityKind } | { readonly type: "wire"; readonly color: WireColor };

export const SELECT_TOOL: Tool = { type: "select" };

export function sameTool(a: Tool, b: Tool): boolean {
  if (a.type === "place" && b.type === "place") return a.kind === b.kind;
  if (a.type === "wire" && b.type === "wire") return a.color === b.color;
  return a.type === b.type;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  /** Source offsets, in UTF-16 code units. */
  readonly from: number;
  readonly to: number;
  readonly severity: DiagnosticSeverity;
  /** Stable machine-readable code. */
  readonly code: string;
  readonly message: string;
}

/** Lexical token for source highlighting; `kind` is mapped to a CSS class by the editor (editor/tokenHighlight.ts). */
export interface SourceToken {
  readonly kind: string;
  readonly from: number;
  readonly to: number;
}
export type Tokenizer = (source: string) => readonly SourceToken[];

export interface EntityMove {
  readonly id: EntityId;
  /** New top-left position in canvas units. */
  readonly position: Point;
}

export interface ProjectView {
  readonly name: string;
  /** Absolute project directory; null until the project was saved for the first time. */
  readonly path: string | null;
  /** Name of the circuit file shown in the editor. */
  readonly fileName: string;
  /** True while the source differs from what is on disk. */
  readonly dirty: boolean;
}

/** One row of the simulation dock's trace area. */
export interface SignalTrace {
  readonly id: string;
  readonly label: string;
  /** Values for the most recent ticks, oldest first; at most `SimulationView.historyLength` entries. */
  readonly values: readonly number[];
  /** Formatted value at the current tick. */
  readonly current: string;
}

/** Per-entity runtime annotation drawn on its card. */
export interface EntityStatus {
  readonly label: string;
  /** Highlights the card, for example a lit lamp. */
  readonly active: boolean;
}

export interface SimulationView {
  /** False while the circuit cannot be simulated (for example because the source has errors). */
  readonly available: boolean;
  readonly running: boolean;
  readonly tick: number;
  /** Ticks per second while running. */
  readonly speed: number;
  readonly speedOptions: readonly number[];
  readonly historyLength: number;
  readonly traces: readonly SignalTrace[];
  readonly entityStatus: ReadonlyMap<EntityId, EntityStatus>;
  /** Optional message shown in the dock, for example why no data is available. */
  readonly notice?: string;
}

/** Everything the views render. A new object is produced for every change; unchanged parts keep their identity. */
export interface WorkbenchState {
  readonly project: ProjectView;
  /** The last valid circuit. While `editable` is false it may lag behind the source text. */
  readonly circuit: Circuit;
  /** False while the source has errors: the canvas stays visible but graphical edits are blocked. */
  readonly editable: boolean;
  readonly selection: readonly EntityId[];
  readonly mode: WorkbenchMode;
  readonly tool: Tool;
  /** Full text of the circuit source shown in the editor. */
  readonly source: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly simulation: SimulationView;
  /** A failure to show to the user, until dismissed. */
  readonly error: string | null;
}

/**
 * Every way the views can change something. Commands never throw; failures surface as `WorkbenchState.error`.
 * Document commands are no-ops while `editable` is false. Identity of this object is stable across state changes.
 */
export interface WorkbenchCommands {
  // View state: never part of undo history.
  setMode(mode: WorkbenchMode): void;
  setTool(tool: Tool): void;
  select(ids: readonly EntityId[]): void;
  dismissError(): void;

  // Document edits: each call is one undoable step.
  /** Adds an entity of `kind` with a generated unique name at `position` (top-left, canvas units). */
  placeEntity(kind: EntityKind, position: Point): void;
  moveEntities(moves: readonly EntityMove[]): void;
  /** Replaces the configuration of the entity with `next.id`. Name and position changes go through their own commands. */
  updateEntity(next: Entity): void;
  /** Renames the entity and every wire reference to it. Invalid or duplicate names are rejected with an error. */
  renameEntity(id: EntityId, name: string): void;
  /** Deletes the entities and every wire attached to them. */
  deleteEntities(ids: readonly EntityId[]): void;
  /** Adding a wire that already exists (in either direction) is a no-op without an undo entry. */
  addWire(wire: Wire): void;
  removeWire(wire: Wire): void;
  /** The user edited the source text. */
  setSource(source: string): void;
  undo(): void;
  redo(): void;

  // Simulation: never creates document edits.
  run(): void;
  pause(): void;
  step(): void;
  resetSimulation(): void;
  setSpeed(ticksPerSecond: number): void;

  // Project lifecycle. Replacing a project with unsaved changes asks the user first.
  newProject(): Promise<void>;
  openProject(): Promise<void>;
  loadProject(path: string): Promise<void>;
  /** Resolves true when the project is on disk afterwards, false when saving failed or was cancelled. */
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
}

/** What `App` hands to the workbench. */
export interface WorkbenchController {
  readonly state: WorkbenchState;
  readonly commands: WorkbenchCommands;
  /** CodeMirror extensions contributed by the session: language support, diagnostics, completion, listeners. */
  readonly editorExtensions?: readonly Extension[];
  /** Tokenizer for source highlighting. Without it the source is shown unstyled. */
  readonly tokenize?: Tokenizer;
}
