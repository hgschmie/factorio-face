// The seam between the workbench views and the session that owns the document.
//
// Views render `WorkbenchState` and call `WorkbenchCommands`; they hold no document logic. The implementation is
// `ProjectSession` (session/projectSession.ts).
import type { EditorState, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { PickerGroup } from "@face/catalog";
import type { Circuit, Direction, Entity, EntityId, EntityKind, Point, SignalId, Wire, WireColor } from "@face/model";
import type { RotationTurn } from "../entities/facing.ts";

export const WORKBENCH_MODES = ["circuit", "source", "split"] as const;
export type WorkbenchMode = (typeof WORKBENCH_MODES)[number];

/**
 * How the canvas shows the circuit: `edit` is the free canvas of cards at their `at` position, `blueprint` the tile board on
 * which entities take the space they take in the game, at their `tile`.
 */
export const DISPLAY_MODES = ["edit", "blueprint"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

/** What can be done to the layout in a display mode. The views read it; the session uses it to refuse tools. */
export interface DisplayCapabilities {
  /** Dragging entities and moving the selection with the arrow keys. */
  readonly move: boolean;
  /** The building blocks of the palette. */
  readonly place: boolean;
  /** The wire tools. */
  readonly wire: boolean;
  /** Paste and duplicate. */
  readonly paste: boolean;
  /** The rotation keys and the rotation items of the context menu. */
  readonly rotate: boolean;
}

/** Blueprint mode only shows the board so far; editing on it is switched on here, one flag at a time. */
export const DISPLAY_CAPABILITIES: Readonly<Record<DisplayMode, DisplayCapabilities>> = {
  edit: { move: true, place: true, wire: true, paste: true, rotate: true },
  blueprint: { move: false, place: false, wire: false, paste: false, rotate: false },
};

/** True when the display mode offers the tool; the select tool always is. */
export function toolAllowed(tool: Tool, displayMode: DisplayMode): boolean {
  return tool.type === "select" || DISPLAY_CAPABILITIES[displayMode][tool.type];
}

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
  /** One-based line of `from`. */
  readonly line: number;
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
  /** Absolute path of the project file; null until the project was saved for the first time. */
  readonly path: string | null;
  /** Name of the circuit file shown in the editor. */
  readonly fileName: string;
  /** True while the source or the project settings differ from what is on disk. */
  readonly dirty: boolean;
  /** Counts loaded projects. Views drop what they remember about the previous project (the camera) when it changes. */
  readonly epoch: number;
}

/** One row of the simulation dock's trace area: one signal on the output of one entity, or the state of a lamp. */
export interface SignalTrace {
  readonly id: string;
  /** Plain-text label, `<entity> <signal>`. */
  readonly label: string;
  readonly entity: EntityId;
  readonly entityName: string;
  /** The traced output signal; absent for lamps and for entities that have not emitted anything. */
  readonly signal?: SignalId;
  /** Lamps only: the state at the current tick. */
  readonly lamp?: { readonly lit: boolean; readonly color?: string };
  /** Values for the most recent ticks, oldest first; at most `SimulationView.historyLength` entries. Lamps trace 1 while lit. */
  readonly values: readonly number[];
  /** Formatted value at the current tick. */
  readonly current: string;
  /** What the entity reads at the current tick, summed per wire color; shown on hover. */
  readonly inputs: string;
}

/** A signal value shown on a card. The engine's snapshot entries are passed through as they are. */
export interface StatusSignal {
  readonly signal: SignalId;
  readonly value: number;
}

/** What an entity reads on the network of one wire color. */
export interface StatusInput {
  /** False when no wire of the color is attached to the input terminal. */
  readonly wired: boolean;
  /** All signals on the network, in signal order. */
  readonly signals: readonly StatusSignal[];
}

/** Per-entity runtime annotation drawn on its card: one row per input color, one for the output or the lamp. */
export interface EntityStatus {
  /** The output or the lamp state as plain text, for example `A 5, B 10 +3`, `lit #ff0000` or `no output`. */
  readonly label: string;
  /** Highlights the card, for example a lit lamp. */
  readonly active: boolean;
  /** Absent for entities without an input terminal (constant combinators). */
  readonly input?: { readonly red: StatusInput; readonly green: StatusInput };
  /** All emitted signals, in signal order; the same on both wire colors. Absent for lamps. */
  readonly output?: readonly StatusSignal[];
  /** Lamps only; `color` is the `#rrggbb` of the light while lit with a color. */
  readonly lamp?: { readonly lit: boolean; readonly color?: string };
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

export type SignalStatus = "known" | "unknown" | "disabled";

/** What the catalog knows about a signal for the project's enabled modules. */
export interface SignalInfo {
  readonly status: SignalStatus;
  /** English display name; absent for signals the catalog does not contain. */
  readonly displayName?: string;
  /** Icon id below the catalog icon root, without extension, for example `item/iron-plate`. */
  readonly icon?: string;
}

export interface QualityOption {
  readonly name: string;
  readonly displayName: string;
  readonly icon: string;
  readonly color: string;
}

/** One of the standard modules, shown as a signal group in the project settings. */
export interface ModuleView {
  readonly name: string;
  readonly title: string;
  readonly version: string;
  readonly enabled: boolean;
  /** False for the module everything depends on. */
  readonly canDisable: boolean;
  /** Modules that are switched on together with this one. */
  readonly enables: readonly string[];
  /** Enabled modules that are switched off together with this one. */
  readonly disables: readonly string[];
  /** Hard dependencies that are not enabled; non-empty only for a hand-edited project file. */
  readonly missing: readonly string[];
  /** Number of selectable signals the module contributes. */
  readonly signalCount: number;
}

/** Catalog data for the project's enabled modules. A new object whenever the module set changes. */
export interface CatalogView {
  readonly gameVersion: string;
  readonly modules: readonly ModuleView[];
  /** Module names in the project file that the catalog does not know; kept on save. */
  readonly unknownModules: readonly string[];
  /** Selectable qualities, lowest first; empty unless the quality module is enabled. */
  readonly qualities: readonly QualityOption[];
  /** The signal picker for the enabled modules in game order, wildcards included. Built on first use. */
  picker(): readonly PickerGroup[];
  describe(signal: SignalId): SignalInfo;
}

/** An inspector edit that the circuit language cannot express yet. It lives next to the document and is never written as it is. */
export interface InspectorDraft {
  /** The incomplete configuration the inspector shows in place of the entity. */
  readonly entity: Entity;
  /** Why it is not written yet. */
  readonly message: string;
}

/**
 * The editor state the session owns: document, history and selection exist whether or not an editor view is mounted.
 * A mounted view starts from `state`, sends its transactions to `apply` and is kept in sync through `attach`.
 */
export interface EditorBinding {
  readonly state: EditorState;
  apply(transactions: readonly Transaction[]): void;
  /** Registers the view that mirrors the state. Returns the function that detaches it. */
  attach(view: EditorView): () => void;
}

/** Everything the views render. A new object is produced for every change; unchanged parts keep their identity. */
export interface WorkbenchState {
  readonly project: ProjectView;
  /** The last valid circuit. While `editable` is false it may lag behind the source text. */
  readonly circuit: Circuit;
  /** False while the source has errors: the canvas stays visible but graphical edits are blocked. */
  readonly editable: boolean;
  readonly selection: readonly EntityId[];
  /** The selected wires as `wireKey`s. They exist in `circuit`; entities and wires can be selected together. */
  readonly wireSelection: readonly string[];
  readonly mode: WorkbenchMode;
  /** View state like `mode`: not part of the document, not undoable, `edit` for every project that is opened. */
  readonly displayMode: DisplayMode;
  /** Always one the display mode offers (`toolAllowed`). */
  readonly tool: Tool;
  /** Full text of the circuit source shown in the editor. */
  readonly source: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly simulation: SimulationView;
  readonly catalog: CatalogView;
  /** Pending inspector edit of the single selected entity, if any. */
  readonly draft: InspectorDraft | null;
  /** A failure to show to the user, until dismissed. */
  readonly error: string | null;
}

export interface UpdateOptions {
  /**
   * Edits that carry the same key and directly follow each other are merged into one undo step. The inspector passes one key
   * per text field focus, so typing a value is undone as a whole.
   */
  readonly coalesce?: string;
}

/**
 * Every way the views can change something. Commands never throw; failures surface as `WorkbenchState.error`.
 * Document commands are no-ops while `editable` is false. Identity of this object is stable across state changes.
 */
export interface WorkbenchCommands {
  // View state: never part of undo history.
  setMode(mode: WorkbenchMode): void;
  /** Switches the canvas between the edit canvas and the blueprint board. A tool the new mode does not offer gives way to the select tool. */
  setDisplayMode(displayMode: DisplayMode): void;
  /** A tool the display mode does not offer is refused. */
  setTool(tool: Tool): void;
  /** Replaces the selection: these entities and these wires (`wireKey`s, none when omitted). What does not exist is left out. */
  select(ids: readonly EntityId[], wires?: readonly string[]): void;
  dismissError(): void;

  // Document edits: each call is one undoable step.
  /** Adds an entity of `kind` with a generated unique name at `position` (top-left, canvas units). */
  placeEntity(kind: EntityKind, position: Point): void;
  moveEntities(moves: readonly EntityMove[]): void;
  /**
   * Turns each of the entities a quarter turn in place, as one step. The source then says `facing` for each of them, east included.
   * An entity that cannot rotate (a lamp) is left alone; the `tile` of one that has it follows the turn (`rotateTile`).
   */
  rotateEntities(ids: readonly EntityId[], turn: RotationTurn): void;
  /** Makes the entities face `direction`, as one step, under the same rules. An entity that faces it already is left alone. */
  faceEntities(ids: readonly EntityId[], direction: Direction): void;
  /**
   * Replaces the configuration of the entity with `next.id`. Name and position changes go through their own commands.
   * A configuration the language cannot express yet is kept as `WorkbenchState.draft` and written once it becomes valid.
   */
  updateEntity(next: Entity, options?: UpdateOptions): void;
  discardDraft(): void;
  /** Renames the entity and every wire reference to it. Invalid or duplicate names are rejected with an error. */
  renameEntity(id: EntityId, name: string): void;
  /** Deletes the entities and every wire attached to them. */
  deleteEntities(ids: readonly EntityId[]): void;
  /** Deletes the selected entities with every wire attached to them, and the selected wires, as one step. */
  deleteSelection(): void;
  /**
   * The text a copy puts on the clipboard: the declarations of the entities and of the wires between them, in the circuit
   * language. Empty when none of the entities exists. It reads the circuit on show, so it also works while the source has errors.
   */
  copyEntities(ids: readonly EntityId[]): string;
  /**
   * Inserts the entities and wires that clipboard text declares and selects them. Taken names are replaced and `tile` is dropped.
   * With `corner` (canvas units) the top-left corner of the group goes there, otherwise the group goes where it was copied from;
   * either way it moves on until no copy sits exactly on another entity. Text that is not a circuit fragment changes nothing
   * and is reported.
   */
  pasteEntities(text: string, corner?: Point): void;
  /** Moves the selected entities by `delta` (canvas units) as one step. The selection stays; selected wires follow their entities. */
  nudgeSelection(delta: Point): void;
  /**
   * Copies the selected entities and the wires between them into the circuit and selects the copies: what `copyEntities` and
   * `pasteEntities` without a corner do, as one step and without a clipboard. Nothing happens with no entity selected.
   */
  duplicateSelection(): void;
  /** Adding a wire that already exists (in either direction) is a no-op without an undo entry. */
  addWire(wire: Wire): void;
  removeWire(wire: Wire): void;
  /** The wire gesture, as in the game: connects the two terminals, or removes the wire of this color if they are already connected (in either direction). */
  toggleWire(wire: Wire): void;
  /** Replaces the source text as one edit (the differing part only). Typing in the editor goes through `EditorBinding`. */
  setSource(source: string): void;
  undo(): void;
  redo(): void;

  // Simulation: never creates document edits.
  run(): void;
  pause(): void;
  step(): void;
  resetSimulation(): void;
  setSpeed(ticksPerSecond: number): void;

  // Project settings: part of the project file, not of the undo history.
  /** Enables or disables a standard module together with the modules that depend on it or that it requires. */
  setModuleEnabled(name: string, enabled: boolean): void;
  setProjectName(name: string): void;

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
  /** The source document; stable for the lifetime of the session. */
  readonly editor: EditorBinding;
}
