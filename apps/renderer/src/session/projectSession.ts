// The project session: one object that owns the source document, its analysis, the selection, the simulation and the project
// file, and implements the WorkbenchController seam for the views. It does not depend on React or on a mounted view.
//
// Rules it enforces:
// - the document owns the editing history; every graphical command is one transaction made of small source patches;
// - while the source has errors the last valid circuit stays visible and neither commands nor the simulation run;
// - analysis results are only taken over for the document version they were requested for;
// - nothing in the simulation path touches the document.
import type { Extension, Transaction } from "@codemirror/state";
import { loadStandardCatalog, type Catalog } from "@face/catalog";
import { executeCommand, type EditCommand, type EditResult, type ParseResult } from "@face/language";
import { DEFAULT_FACING, facingOf, tileCenter, tileOrigin, wireKey, type Circuit, type Direction, type Entity, type EntityId, type EntityKind, type Point } from "@face/model";
import type { FaceApi, IpcResult, LoadedProject } from "../../../desktop/src/ipc.ts";
import { arrangeBoard, blockedMoves, blockedTurn, canStandAt, derivedTiles, editPositionOf } from "../canvas/board.ts";
import { editorChrome } from "../editor/extensions.ts";
import { rotated } from "../entities/facing.ts";
import {
  DISPLAY_CAPABILITIES, DISPLAY_MODES, sameTool, SELECT_TOOL, toolAllowed, type Diagnostic, type DisplayMode, type EntityTile, type InspectorDraft, type ProjectView, type Tool, type UpdateOptions, type WorkbenchCommands,
  type WorkbenchController, type WorkbenchMode, type WorkbenchState,
} from "../workbench/controller.ts";
import { Analysis } from "./analysis.ts";
import { CatalogService } from "./catalogService.ts";
import { clipboardText, pasteShift, readClipboardText } from "./clipboard.ts";
import { SourceDocument } from "./document.ts";
import { checkDraft, normalizeEntity } from "./drafts.ts";
import { languageSupport, lintTransaction } from "./editorSupport.ts";
import { createCatalogEnvironment } from "./environment.ts";
import { isDirty, openProjectFile, savedProjectFile, starterProject, toProjectData, type ProjectFile, type ProjectSettings } from "./persistence.ts";
import { SimulationRunner, type Scheduler } from "./simulationRunner.ts";

const NO_DESKTOP = "Projects can only be opened and saved in the desktop app.";
const PROJECT_NAME_LIMIT = 200;
const NOT_A_FRAGMENT = "Nothing was pasted: the clipboard does not hold entities of a circuit.";
const NO_DIAGNOSTICS: readonly Diagnostic[] = [];
const NO_WIRES: readonly string[] = [];

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export interface SessionOptions {
  /** The desktop bridge; without it the session works, but projects cannot be opened or saved. */
  readonly api?: FaceApi;
  readonly catalog?: Catalog;
  /** Editor behaviour and appearance added to the document state. Defaults to the workbench's editor chrome. */
  readonly editorExtensions?: Extension;
  readonly scheduler?: Scheduler;
  /** The project to start with. Defaults to a new project with the example circuit. */
  readonly project?: LoadedProject;
}

interface Draft extends InspectorDraft {
  readonly id: EntityId;
  /** The entity the draft was derived from; the draft is void once the circuit holds a different one. */
  readonly base: Entity;
}

export class ProjectSession {
  readonly document: SourceDocument;
  readonly commands: WorkbenchCommands;
  readonly simulation: SimulationRunner;
  private readonly api: FaceApi | undefined;
  private readonly catalog: Catalog;
  private readonly analysis = new Analysis();
  private services: CatalogService;
  private file: ProjectFile;
  private settings: ProjectSettings;
  private epoch = 0;

  private selection: readonly EntityId[] = [];
  /** Selected wires as `wireKey`s. A key holds entity ids, so it survives renames and moves. */
  private wireSelection: readonly string[] = NO_WIRES;
  private mode: WorkbenchMode = "circuit";
  private displayMode: DisplayMode = "edit";
  private tool: Tool = SELECT_TOOL;
  private diagnostics: readonly Diagnostic[] = NO_DIAGNOSTICS;
  private draft: Draft | null = null;
  private error: string | null = null;
  /** Names of the entities to select once the analysis of the edit that created them has arrived. */
  private pendingSelection: readonly string[] | undefined;
  /** The last inspector edit that may still be extended into the same undo step. */
  private coalesce: { readonly key: string; readonly version: number } | undefined;

  private lintPending = false;
  private lintShown = 0;
  private depth = 0;
  private controller: WorkbenchController;
  private projectView: ProjectView | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(options: SessionOptions = {}) {
    this.api = options.api;
    this.catalog = options.catalog ?? loadStandardCatalog();
    const { file, source, settings } = openProjectFile(options.project ?? starterProject());
    this.file = file;
    this.settings = settings;
    this.services = new CatalogService(this.catalog, settings.modules);
    this.simulation = new SimulationRunner(createCatalogEnvironment(this.catalog, this.services.enabled), () => this.touch(), options.scheduler);
    const language = languageSupport({ parseOf: (text) => (this.analysis.parse?.source === text ? this.analysis.parse : undefined), catalog: () => this.services });
    this.document = new SourceDocument(source, [options.editorExtensions ?? editorChrome(), language], {
      applied: (transactions) => this.documentApplied(transactions),
      settled: () => this.leave(),
      replaced: () => this.analyze(),
    });
    this.commands = this.createCommands();
    this.depth++;
    this.analyze();
    this.leave();
    this.controller = { state: this.buildState(), commands: this.commands, editor: this.document };
  }

  // Store

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getController = (): WorkbenchController => this.controller;

  get state(): WorkbenchState {
    return this.controller.state;
  }

  /** The latest analysis result that was taken over. */
  get parse(): ParseResult | undefined {
    return this.analysis.parse;
  }

  dispose(): void {
    this.simulation.dispose();
    this.listeners.clear();
  }

  /** Runs `action` as one change: listeners are notified once, after everything it caused has settled, and only if the state differs. */
  private change(action: () => void): void {
    this.depth++;
    try {
      action();
    } finally {
      this.leave();
    }
  }

  /** Something changed outside a `change` (a simulation tick). */
  private touch(): void {
    if (this.depth === 0) this.publish();
  }

  private leave(): void {
    // Showing diagnostics is a transaction of its own; it is dispatched when the change that produced them is complete.
    if (this.depth === 1 && this.lintPending) {
      this.lintPending = false;
      this.document.dispatch(lintTransaction(this.document.state, this.diagnostics));
    }
    if (--this.depth === 0) this.publish();
  }

  private publish(): void {
    if (this.controller === undefined) return;
    const next = this.buildState();
    const previous = this.controller.state;
    if ((Object.keys(next) as (keyof WorkbenchState)[]).every((key) => Object.is(next[key], previous[key]))) return;
    this.controller = { state: next, commands: this.commands, editor: this.document };
    for (const listener of [...this.listeners]) listener();
  }

  private buildState(): WorkbenchState {
    const dirty = isDirty(this.file, this.document.text, this.settings);
    const project = this.projectView;
    if (!project || project.name !== this.settings.name || project.path !== this.file.path || project.fileName !== this.file.fileName || project.dirty !== dirty || project.epoch !== this.epoch) {
      this.projectView = { name: this.settings.name, path: this.file.path, fileName: this.file.fileName, dirty, epoch: this.epoch };
    }
    const draft = this.draft && this.selection.length === 1 && this.selection[0] === this.draft.id ? this.draft : null;
    return {
      project: this.projectView!,
      circuit: this.analysis.circuit,
      editable: this.editable,
      selection: this.selection,
      wireSelection: this.wireSelection,
      mode: this.mode,
      displayMode: this.displayMode,
      tool: this.tool,
      source: this.document.text,
      diagnostics: this.diagnostics,
      canUndo: this.document.canUndo,
      canRedo: this.document.canRedo,
      simulation: this.simulation.view(),
      catalog: this.services,
      draft,
      error: this.error,
    };
  }

  // Document and analysis

  /** True when the analysis describes the current text and found no errors: the precondition of every graphical command. */
  private get editable(): boolean {
    return !this.analysis.hasErrors && this.analysis.isCurrent(this.document.version);
  }

  private documentApplied(transactions: readonly Transaction[]): void {
    this.depth++;
    if (transactions.some((transaction) => transaction.docChanged)) this.analyze();
    else this.followCaret(transactions);
  }

  /** A caret placed by the user inside an entity declaration selects that entity, one inside a wire declaration that wire. */
  private followCaret(transactions: readonly Transaction[]): void {
    const moved = transactions.findLast((transaction) => transaction.selection !== undefined && transaction.isUserEvent("select"));
    const map = this.analysis.parse?.sourceMap;
    if (!moved || !map || !this.editable) return;
    const head = moved.newSelection.main.head;
    const id = map.entityAt(head);
    const wire = id === undefined ? map.wireAt(head) : undefined;
    if (id !== undefined) this.setSelection([id]);
    else if (wire !== undefined) this.setSelection([], [wire]);
  }

  private analyze(): void {
    this.acceptAnalysis(this.analysis.request(this.document.text, this.document.version, this.services));
  }

  /**
   * Takes over an analysis result. Results that do not answer the latest request are ignored, so a late answer for an older
   * text can never replace a newer draft. This is the entry point for a worker, should the analysis move to one.
   */
  acceptAnalysis(result: ParseResult): boolean {
    if (!this.analysis.accept(result)) return false;
    this.change(() => {
      const doc = this.document.state.doc;
      this.diagnostics = result.diagnostics.length === 0 ? NO_DIAGNOSTICS : result.diagnostics.map((diagnostic) => ({ ...diagnostic, line: doc.lineAt(Math.min(diagnostic.from, doc.length)).number }));
      this.lintPending = this.diagnostics.length > 0 || this.lintShown > 0;
      this.lintShown = this.diagnostics.length;
      if (!result.circuit) {
        const errors = this.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
        this.simulation.block(`Paused: ${errors} ${errors === 1 ? "error" : "errors"} in the source`);
        return;
      }
      this.circuitChanged(this.analysis.circuit);
    });
    return true;
  }

  private circuitChanged(circuit: Circuit): void {
    const byId = new Map(circuit.entities.map((entity) => [entity.id, entity]));
    const pending = new Set(this.pendingSelection);
    const created = circuit.entities.filter((entity) => pending.has(entity.name)).map((entity) => entity.id);
    this.pendingSelection = undefined;
    if (created.length > 0) this.setSelection(created);
    else this.setSelection(this.selection.filter((id) => byId.has(id)), this.existingWires(this.wireSelection));
    if (this.draft && byId.get(this.draft.id) !== this.draft.base) this.draft = null;
    this.simulation.setCircuit(circuit);
  }

  /** The keys among `keys` that name a wire of the circuit on show, each once. */
  private existingWires(keys: readonly string[]): readonly string[] {
    if (keys.length === 0) return NO_WIRES;
    const known = new Set(this.analysis.circuit.wires.map(wireKey));
    return [...new Set(keys)].filter((key) => known.has(key));
  }

  private setSelection(selection: readonly EntityId[], wires: readonly string[] = NO_WIRES): void {
    if (!sameList(wires, this.wireSelection)) this.wireSelection = wires;
    // The inspector shows a draft only for an entity that is selected alone.
    if (this.draft && !(selection.length === 1 && selection[0] === this.draft.id && wires.length === 0)) this.draft = null;
    if (sameList(selection, this.selection)) return;
    this.selection = selection;
    this.simulation.setSelection(selection);
  }

  // Graphical commands

  /**
   * Computes the text changes of a language edit command against the current analysis. Undefined while the source cannot be
   * edited graphically. The language reports refusals as values; anything it throws is a defect, which must not take the
   * session down or leave the document half changed, so it becomes a visible error as well.
   */
  private compute(command: EditCommand): EditResult | undefined {
    const parse = this.analysis.parse;
    if (!parse || !this.editable) return undefined;
    try {
      return executeCommand(parse, command);
    } catch (error) {
      console.error("[face] edit command failed:", command.type, error);
      return { ok: false, code: "invalid-source", message: `The edit could not be applied (${error instanceof Error ? error.message : String(error)}).` };
    }
  }

  /** Runs an edit command and dispatches its changes as one transaction (one undo step). No changes, no transaction. */
  private execute(command: EditCommand, join = false): EditResult | undefined {
    const result = this.compute(command);
    if (result?.ok) this.document.edit(result.changes, join);
    return result;
  }

  /** Like `execute`, with failures shown to the user. */
  private perform(command: EditCommand): EditResult | undefined {
    const result = this.execute(command);
    if (result && !result.ok) this.error = result.message;
    return result;
  }

  private entity(id: EntityId): Entity | undefined {
    return this.analysis.circuit.entities.find((entity) => entity.id === id);
  }

  private updateEntity(next: Entity, options: UpdateOptions = {}): void {
    const current = this.entity(next.id);
    if (!this.editable || !current || current.kind !== next.kind) return;
    // Name, position and placement belong to their own commands; a draft made before a move must not undo the move.
    const wanted = normalizeEntity({ ...next, name: current.name, position: current.position, placement: current.placement });
    const check = checkDraft(wanted);
    if (!check.ok) {
      this.draft = { id: current.id, base: current, entity: wanted, message: check.message };
      return;
    }
    const join = options.coalesce !== undefined && this.coalesce?.key === options.coalesce && this.coalesce.version === this.document.version;
    const result = this.execute({ type: "updateEntity", id: current.id, entity: wanted }, join);
    if (!result) return;
    if (!result.ok) {
      this.error = result.message;
      return;
    }
    if (this.draft?.id === current.id) this.draft = null;
    if (result.changes.length > 0) this.coalesce = options.coalesce === undefined ? undefined : { key: options.coalesce, version: this.document.version };
  }

  /** The entities of the circuit among `ids`, each once, in the order of `ids`. */
  private entities(ids: readonly EntityId[]): Entity[] {
    const byId = new Map(this.analysis.circuit.entities.map((entity) => [entity.id, entity]));
    return [...new Set(ids)].flatMap((id) => byId.get(id) ?? []);
  }

  /**
   * Writes the direction `directionOf` gives for each of the entities that exist, as one step. The language command leaves lamps
   * out and moves a `tile` with the turn. Where positions are tiles, a turn onto a taken tile is refused for all of them.
   */
  private faceEntities(ids: readonly EntityId[], directionOf: (entity: Entity) => Direction): void {
    const facings = this.entities(ids).map((entity) => ({ id: entity.id, direction: directionOf(entity) }));
    if (!this.editable || facings.length === 0) return;
    const blocked = DISPLAY_CAPABILITIES[this.displayMode].tiles ? blockedTurn(this.analysis.circuit.entities, new Map(facings.map(({ id, direction }) => [id, direction]))) : undefined;
    if (blocked) return void (this.error = `Not rotated: ${this.entity(blocked.entity)?.name} would stand on a tile of ${this.entity(blocked.obstacle)?.name}.`);
    this.perform({ type: "faceEntities", facings });
  }

  /** Puts entities on the board, as one step, unless one of them would stand on a tile of an entity that is not among them. */
  private setTiles(tiles: readonly EntityTile[]): void {
    const circuit = this.analysis.circuit.entities;
    const centers = new Map(tiles.map(({ id, tile }) => [id, tile]));
    const moved = this.entities([...centers.keys()]);
    if (!this.editable || moved.length === 0) return;
    const origins = new Map(moved.map((entity) => [entity.id, tileOrigin(entity.kind, facingOf(entity), centers.get(entity.id)!)]));
    if (blockedMoves(circuit, origins).size === 0) this.perform({ type: "setTiles", tiles: moved.map(({ id }) => ({ id, tile: centers.get(id)! })) });
  }

  /** Adds an entity and makes it the selection once its analysis has arrived; the tool goes back to select. */
  private addEntity(kind: EntityKind, position: Point, tile?: Point): void {
    const result = this.compute({ type: "addEntity", kind, position, tile });
    if (!result) return;
    if (!result.ok) return void (this.error = result.message);
    // The new entity gets its id from the analysis of the edit; it is selected when that arrives.
    this.pendingSelection = result.name === undefined ? undefined : [result.name];
    this.tool = SELECT_TOOL;
    this.document.edit(result.changes);
  }

  /** Inserts what the clipboard text declares, as one step; the copies become the selection when their analysis arrives. */
  private pasteEntities(text: string, corner?: Point): void {
    if (!this.editable) return;
    const fragment = readClipboardText(text);
    if (!fragment) return void (this.error = NOT_A_FRAGMENT);
    const result = this.compute({ type: "pasteFragment", fragment, shift: pasteShift(fragment, this.analysis.circuit.entities, corner) });
    if (!result) return;
    if (!result.ok) return void (this.error = result.message);
    this.pendingSelection = result.names;
    this.tool = SELECT_TOOL;
    this.document.edit(result.changes);
  }

  private createCommands(): WorkbenchCommands {
    const changing = <A extends unknown[]>(action: (...args: A) => void) => (...args: A): void => this.change(() => action(...args));
    return {
      setMode: changing((mode) => void (this.mode = mode)),
      setDisplayMode: changing((displayMode) => {
        if (!DISPLAY_MODES.includes(displayMode)) return;
        this.displayMode = displayMode;
        if (!toolAllowed(this.tool, displayMode)) this.tool = SELECT_TOOL;
      }),
      setTool: changing((tool) => void (sameTool(this.tool, tool) || !toolAllowed(tool, this.displayMode) || (this.tool = tool))),
      select: changing((ids, wires = NO_WIRES) => {
        const known = new Set(this.analysis.circuit.entities.map((entity) => entity.id));
        this.setSelection([...new Set(ids)].filter((id) => known.has(id)), this.existingWires(wires));
      }),
      dismissError: changing(() => void (this.error = null)),

      placeEntity: changing((kind, position) => this.addEntity(kind, position)),
      moveEntities: changing((moves) => void this.perform({ type: "moveEntities", moves: moves.filter((move) => this.entity(move.id) !== undefined) })),
      rotateEntities: changing((ids, turn) => this.faceEntities(ids, (entity) => rotated(facingOf(entity), turn))),
      faceEntities: changing((ids, direction) => this.faceEntities(ids, () => direction)),
      updateEntity: changing((next, options) => this.updateEntity(next, options)),
      discardDraft: changing(() => void (this.draft = null)),
      renameEntity: changing((id, name) => void (this.entity(id) && this.perform({ type: "renameEntity", id, name }))),
      deleteEntities: changing((ids) => {
        const existing = [...new Set(ids)].filter((id) => this.entity(id) !== undefined);
        if (existing.length > 0) this.perform({ type: "deleteEntities", ids: existing });
      }),
      deleteSelection: changing(() => {
        // Both lists were checked against the circuit when it arrived, so while the source is editable everything in them exists.
        if (this.selection.length + this.wireSelection.length > 0) this.perform({ type: "deleteEntities", ids: this.selection, wires: this.wireSelection });
      }),
      copyEntities: (ids) => clipboardText(this.analysis.circuit, ids),
      pasteEntities: changing((text, corner) => this.pasteEntities(text, corner)),
      nudgeSelection: changing((delta) => {
        const moves = this.selection.flatMap((id) => this.entity(id) ?? []).map(({ id, position }) => ({ id, position: { x: position.x + delta.x, y: position.y + delta.y } }));
        if (moves.length > 0) this.perform({ type: "moveEntities", moves });
      }),
      duplicateSelection: changing(() => {
        const text = clipboardText(this.analysis.circuit, this.selection);
        if (text !== "") this.pasteEntities(text);
      }),

      setTiles: changing((tiles) => this.setTiles(tiles)),
      nudgeTiles: changing((delta) => {
        const board = arrangeBoard(this.analysis.circuit.entities);
        this.setTiles(
          this.entities(this.selection).map((entity) => {
            const { origin, facing } = board.get(entity.id)!;
            return { id: entity.id, tile: tileCenter(entity.kind, facing, { x: origin.x + delta.x, y: origin.y + delta.y }) };
          }),
        );
      }),
      snapToTiles: changing((ids) => {
        // The derived places keep clear of every entity with a tile and of each other, so there is nothing to check.
        const derived = derivedTiles(this.analysis.circuit.entities);
        const tiles = [...new Set(ids ?? derived.keys())].flatMap((id) => (derived.has(id) ? [{ id, tile: derived.get(id)! }] : []));
        if (tiles.length > 0) this.perform({ type: "setTiles", tiles });
      }),
      clearTiles: changing((ids) => {
        const tiles = this.entities(ids).filter((entity) => entity.placement?.tile !== undefined).map((entity) => ({ id: entity.id, tile: undefined }));
        if (tiles.length > 0) this.perform({ type: "setTiles", tiles });
      }),
      placeEntityOnTile: changing((kind, tile) => {
        const circuit = this.analysis.circuit.entities;
        const origin = tileOrigin(kind, DEFAULT_FACING, tile);
        if (!this.editable || !canStandAt(circuit, kind, origin)) return;
        const position = editPositionOf(origin);
        const shift = pasteShift({ entities: [{ position }] }, circuit);
        this.addEntity(kind, { x: position.x + shift.x, y: position.y + shift.y }, tile);
      }),
      addWire: changing((wire) => void this.perform({ type: "addWire", color: wire.color, a: wire.a, b: wire.b })),
      removeWire: changing((wire) => {
        const key = wireKey(wire);
        if (this.analysis.parse?.sourceMap.wires.has(key)) this.perform({ type: "removeWire", key });
      }),
      toggleWire: changing((wire) => {
        const key = wireKey(wire);
        if (this.analysis.parse?.sourceMap.wires.has(key)) this.perform({ type: "removeWire", key });
        else this.perform({ type: "addWire", color: wire.color, a: wire.a, b: wire.b });
      }),
      setSource: changing((source) => this.document.setText(source)),
      undo: changing(() => void this.document.undo()),
      redo: changing(() => void this.document.redo()),

      run: () => this.simulation.run(),
      pause: () => this.simulation.pause(),
      step: () => this.simulation.step(),
      resetSimulation: () => this.simulation.reset(),
      setSpeed: (speed) => this.simulation.setSpeed(speed),

      setModuleEnabled: changing((name, enabled) => {
        const modules = this.services.withModule(name, enabled);
        if (modules) this.applySettings({ ...this.settings, modules });
      }),
      setProjectName: changing((name) => {
        const trimmed = name.trim().slice(0, PROJECT_NAME_LIMIT);
        if (trimmed !== "" && trimmed !== this.settings.name) this.settings = { ...this.settings, name: trimmed };
      }),

      newProject: () => this.replaceProject(async (api) => {
        const created = await api.newProject();
        return created.ok ? { ok: true, value: starterProject(created.value.data.manifest) } : created;
      }),
      openProject: () => this.replaceProject((api) => api.openProject()),
      loadProject: (path) => this.replaceProject((api) => api.loadProject(path)),
      save: () => this.writeProject(false),
      saveAs: () => this.writeProject(true),
    };
  }

  // Project settings and files

  /** New settings: signals are judged against the new module set and the simulation gets the matching environment. The text is not touched. */
  private applySettings(settings: ProjectSettings): void {
    const modulesChanged = settings.modules !== this.settings.modules;
    this.settings = settings;
    if (!modulesChanged) return;
    this.services = new CatalogService(this.catalog, settings.modules);
    this.simulation.setEnvironment(createCatalogEnvironment(this.catalog, this.services.enabled));
    this.analyze();
  }

  /** Replaces everything with `project`: a new document with an empty history, no selection, simulation at tick 0. */
  load(project: LoadedProject): void {
    this.change(() => {
      const { file, source, settings } = openProjectFile(project);
      this.file = file;
      this.settings = settings;
      this.epoch++;
      this.selection = [];
      this.wireSelection = NO_WIRES;
      this.draft = null;
      this.error = null;
      this.tool = SELECT_TOOL;
      this.displayMode = "edit";
      this.coalesce = undefined;
      this.pendingSelection = undefined;
      this.lintShown = 0;
      this.services = new CatalogService(this.catalog, settings.modules);
      this.simulation.clear();
      this.simulation.setSelection(this.selection);
      this.simulation.setEnvironment(createCatalogEnvironment(this.catalog, this.services.enabled));
      this.analysis.reset();
      this.document.replace(source);
    });
  }

  private fail(message: string): void {
    this.change(() => void (this.error = message));
  }

  /** Unwraps an IPC result; a failure becomes the visible error and yields undefined. */
  private unwrap<T>(result: IpcResult<T>): T | undefined {
    if (result.ok) return result.value;
    this.fail(result.error);
    return undefined;
  }

  private async writeProject(saveAs: boolean): Promise<boolean> {
    const api = this.api;
    if (!api) {
      this.fail(NO_DESKTOP);
      return false;
    }
    // What is written is the state at this moment; edits made while the save is in flight stay unsaved.
    const file = this.file;
    const source = this.document.text;
    const settings = this.settings;
    const data = toProjectData(file, source, settings);
    const saved = this.unwrap(saveAs ? await api.saveProjectAs(data) : await api.saveProject({ path: file.path, data }));
    if (!saved) return false;
    if (this.file === file) this.change(() => void (this.file = savedProjectFile(file, saved.path, data, source, settings)));
    return true;
  }

  /** Before the current project is replaced: offers to save unsaved changes. Resolves false when the user cancels. */
  private async mayReplaceProject(api: FaceApi): Promise<boolean> {
    if (!isDirty(this.file, this.document.text, this.settings)) return true;
    const choice = this.unwrap(await api.confirmUnsavedChanges());
    if (choice === "save") return this.writeProject(false);
    return choice === "discard";
  }

  private async replaceProject(load: (api: FaceApi) => Promise<IpcResult<LoadedProject | null>>): Promise<void> {
    const api = this.api;
    if (!api) return this.fail(NO_DESKTOP);
    if (!(await this.mayReplaceProject(api))) return;
    const project = this.unwrap(await load(api));
    if (project) this.load(project);
  }
}
