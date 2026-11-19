// The project session: one object that owns the source document, its analysis, the selection, the simulation and the project
// file, and implements the WorkbenchController seam for the views. It does not depend on React or on a mounted view.
//
// Rules it enforces:
// - the document owns the editing history; every graphical command is one transaction made of small source patches;
// - while the source has errors the last valid circuit stays visible and neither commands nor the simulation run;
// - analysis results are only taken over for the document version they were requested for;
// - nothing in the simulation path touches the document.
import type { Extension, Transaction } from "@codemirror/state";
import { currentCatalog, type Catalog } from "@face/catalog";
import { executeCommand, type EditCommand, type EditResult, type ParseResult } from "@face/language";
import { canRotate, DEFAULT_FACING, facingOf, isPrototypeName, isWireReach, tileCenter, tileOrigin, wireKey, type Circuit, type Direction, type Entity, type EntityId, type Point, type PrototypeName } from "@face/model";
import type { FaceApi, HiddenModuleItems, IpcResult, LoadedProject, ProjectBook } from "../../../desktop/src/ipc.ts";
import { arrangeBoard, blockedMoves, blockedTurn, canStandAt, derivedTiles, editPositionOf } from "../canvas/board.ts";
import { blockedFlip, flipCards, flipTiles } from "../canvas/flip.ts";
import { editorChrome } from "../editor/extensions.ts";
import { builtInData, type DataInUse } from "../gameData/dataInUse.ts";
import { describeRecord, modsNotice, modsRecord } from "../gameData/projectMods.ts";
import { rotated } from "../entities/facing.ts";
import { hiddenItems, withHiddenModule, type HiddenItems } from "../settings/hiddenItems.ts";
import {
  DISPLAY_CAPABILITIES, DISPLAY_MODES, placeFacing, sameTool, SELECT_TOOL, toolAllowed,
  type Diagnostic, type DisplayMode, type EntityTile, type InspectorDraft, type ProjectView, type Tool, type UpdateOptions, type WorkbenchCommands,
  type WorkbenchController, type WorkbenchMode, type WorkbenchState,
} from "../workbench/controller.ts";
import { listOrder } from "../workbench/moduleOrder.ts";
import { Analysis } from "./analysis.ts";
import { circuitBlueprint, exportCircuit, importedProject, INVALID_SOURCE_PROBLEM, OPEN_PROJECT_HAD_OFF, originOf, readBlueprint, readBlueprintData, type ImportedBlueprint, type ImportedBook, type ImportModules } from "./blueprints.ts";
import { bookFileName, bookView, NO_BOOK, readBookText, storedBook, writeToBook, type BookChoice, type BookExport, type BookTarget, type BookView, type StoredBook } from "./book.ts";
import { CatalogService } from "./catalogService.ts";
import { clipboardText, pasteShift, readClipboardText } from "./clipboard.ts";
import { SourceDocument } from "./document.ts";
import { checkDraft, normalizeEntity } from "./drafts.ts";
import { languageSupport, lintTransaction } from "./editorSupport.ts";
import { createCatalogEnvironment } from "./environment.ts";
import { moduleUse, modulesUsedOff } from "./moduleUse.ts";
import {
  defaultModules, emptyProject, isDirty, neverSaved, openProjectFile, PROJECT_NAME_LIMIT, savedProjectFile, toProjectData, withModules, type ProjectFile, type ProjectSettings,
} from "./persistence.ts";
import { SimulationRunner, type Scheduler } from "./simulationRunner.ts";

const NO_DESKTOP = "Projects can only be opened and saved in the desktop app.";
const LAST_PROJECT_NOT_REOPENED = "The last project could not be reopened.";
const HIDDEN_NOT_STORED = "What you hid could not be stored, so it holds only until the app is closed:";
const NOT_A_FRAGMENT = "Nothing was pasted: the clipboard does not hold entities of a circuit.";
const NO_DIAGNOSTICS: readonly Diagnostic[] = [];
const NO_WIRES: readonly string[] = [];
const NO_MODULES: readonly string[] = [];

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export interface SessionOptions {
  /** The desktop bridge; without it the session works, but projects cannot be opened or saved. */
  readonly api?: FaceApi;
  readonly catalog?: Catalog;
  /**
   * Where the catalog and the model's entity table come from (`loadDataInUse`, which has applied them). With data read from a
   * game a save records the game's mods in the project file, and a project that was made with another game says so when it is
   * opened. Defaults to the built-in data.
   */
  readonly data?: DataInUse;
  /** Editor behaviour and appearance added to the document state. Defaults to the workbench's editor chrome. */
  readonly editorExtensions?: Extension;
  readonly scheduler?: Scheduler;
  /** The project to start with. Defaults to an empty, unsaved project with the modules of a new one. */
  readonly project?: LoadedProject;
  /** What the user hid of the modules on this machine, as the settings of the application have it when the window starts. Defaults to nothing. */
  readonly hidden?: readonly HiddenModuleItems[];
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
  private readonly data: DataInUse;
  private readonly analysis = new Analysis();
  private services: CatalogService;
  /** A setting of the application, not of the project: it stays through every project of the window. */
  private hidden: HiddenItems;
  private file: ProjectFile;
  private settings: ProjectSettings;
  /** The blueprint book of the project as its blueprint string; undefined without one. Which item the circuit came from is with the document (`origin`). */
  private bookString: string | undefined;
  /** Counts the books the session has held. An origin in the history of the document is of the book it was set for and void for every other. */
  private bookEpoch = 0;
  /** `bookString` decoded: made when first asked for and kept while the string is the same. */
  private decodedBook: StoredBook | undefined;
  private shownBook: { readonly book: StoredBook; readonly origin: readonly number[] | undefined; readonly view: BookView } | undefined;
  private epoch = 0;
  /** The catalog as a new project has it, which is what an imported blueprint starts from. Made on first use. */
  private importServices: CatalogService | undefined;
  /** The modules the source uses although they are off, as the latest analysis found them. */
  private modulesOff: readonly string[] = NO_MODULES;
  /** Set once the start has asked for the last project; settles when that is on show or it is clear that the empty project stays. */
  private started: Promise<void> | undefined;

  private selection: readonly EntityId[] = [];
  /** Selected wires as `wireKey`s. A key holds entity ids, so it survives renames and moves. */
  private wireSelection: readonly string[] = NO_WIRES;
  private mode: WorkbenchMode = "circuit";
  private displayMode: DisplayMode = "edit";
  private tool: Tool = SELECT_TOOL;
  private diagnostics: readonly Diagnostic[] = NO_DIAGNOSTICS;
  private draft: Draft | null = null;
  private error: string | null = null;
  /**
   * Set while `error` reports a refused edit. Such a message describes a document that is gone once the document changes, so
   * it goes with the next change; one about a turn of the selection also goes when other entities are selected.
   */
  private refusal: "edit" | "selection" | undefined;
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
    this.catalog = options.catalog ?? currentCatalog();
    this.data = options.data ?? builtInData();
    const { file, source, settings, book } = openProjectFile(options.project ?? this.asNew(emptyProject()));
    this.file = file;
    this.settings = settings;
    this.bookString = book?.string;
    this.hidden = hiddenItems(options.hidden ?? []);
    this.services = this.servicesFor(settings.modules);
    this.simulation = new SimulationRunner(createCatalogEnvironment(this.catalog, this.services.enabled), () => this.touch(), options.scheduler);
    const language = languageSupport({ parseOf: (text) => (this.analysis.parse?.source === text ? this.analysis.parse : undefined), catalog: () => this.services });
    this.document = new SourceDocument(source, [options.editorExtensions ?? editorChrome(), language], {
      applied: (transactions) => this.documentApplied(transactions),
      settled: () => this.leave(),
      replaced: () => this.analyze(),
    }, this.originIn(book?.origin));
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
    const dirty = this.dirty;
    const record = this.file.manifest.gameMods;
    const madeWith = record ? describeRecord(record) : null;
    const project: ProjectView = {
      ...{ name: this.settings.name, path: this.file.path, fileName: this.file.fileName, dirty, wireReach: this.settings.wireReach, epoch: this.epoch },
      ...{ madeWith, modsNotice: this.modsNotice(), gameData: this.data.source.kind === "game", modulesOff: this.modulesOff },
    };
    // The view keeps its identity while nothing in it changed.
    const shown = this.projectView;
    if (!shown || (Object.keys(project) as (keyof ProjectView)[]).some((key) => project[key] !== shown[key])) this.projectView = project;
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
      book: this.viewOfBook(),
      draft,
      error: this.error,
    };
  }

  // The blueprint book of the project

  /** The item of the book the circuit came from. It follows undo and redo, because it is part of the document's state. */
  private get origin(): readonly number[] | undefined {
    const origin = this.document.origin;
    return this.bookString !== undefined && origin?.book === this.bookEpoch ? origin.path : undefined;
  }

  /** `path` as an origin of the book the session holds now. */
  private originIn(path: readonly number[] | undefined): { readonly book: number; readonly path: readonly number[] } | undefined {
    const origin = originOf(path);
    return origin && { book: this.bookEpoch, path: origin };
  }

  /** The book as the project file holds it. */
  private get book(): ProjectBook | undefined {
    const origin = this.origin;
    return this.bookString === undefined ? undefined : { string: this.bookString, ...(origin && { origin }) };
  }

  private get dirty(): boolean {
    return isDirty(this.file, this.document.text, this.settings, this.book);
  }

  private storedBook(): StoredBook | undefined {
    if (this.bookString === undefined) return undefined;
    if (this.decodedBook?.string !== this.bookString) this.decodedBook = storedBook(this.bookString);
    return this.decodedBook;
  }

  /** The view keeps its identity while neither the book nor the origin changed. */
  private viewOfBook(): BookView | null {
    const book = this.storedBook();
    if (!book) return null;
    const origin = this.origin;
    if (this.shownBook?.book !== book || this.shownBook.origin !== origin) this.shownBook = { book, origin, view: bookView(book, origin) };
    return this.shownBook.view;
  }

  /** Another book in place of the one the project holds, or none: the circuit then comes from no item of it. */
  private replaceBook(book: StoredBook | undefined): void {
    this.bookString = book?.string;
    this.decodedBook = book;
    this.bookEpoch++;
    this.document.setOrigin(undefined);
  }

  /**
   * Replaces the circuit by the blueprint at `path` of the book, as one step of the history that also sets the origin: an undo
   * brings back the source and the origin before it. The modules the circuit needs are switched on, which is no part of that step.
   */
  private chooseFromBook(path: readonly number[]): BookChoice {
    const book = this.storedBook();
    if (!book?.ok) return { ok: false, message: book?.problem ?? NO_BOOK };
    const reading = readBlueprintData(book.data, this.services.instruments, path, (source) => this.modulesNeeded(source, this.services), OPEN_PROJECT_HAD_OFF);
    if (reading.kind !== "blueprint") return { ok: false, message: reading.message };
    const { name, source, modules, report } = reading.blueprint;
    this.change(() => {
      if (modules && !sameList(modules, this.settings.modules)) this.applySettings({ ...this.settings, modules });
      // The entities of the new circuit are others, whatever their ids: nothing said about the old ones holds.
      this.setSelection([]);
      this.pendingSelection = undefined;
      this.coalesce = undefined;
      this.show(null);
      this.tool = SELECT_TOOL;
      this.displayMode = "blueprint";
      this.epoch++;
      this.document.edit([{ from: 0, to: this.document.state.doc.length, insert: source }], false, this.originIn(path) ?? null);
    });
    return { ok: true, name, report };
  }

  /** Writes the circuit into the book. The book is no part of the history of the document: an undo does not take the blueprint out again. */
  private exportToBook(target: BookTarget): BookExport {
    const book = this.storedBook();
    if (!book?.ok) return { ok: false, reason: "book", message: book?.problem ?? NO_BOOK };
    const exported = this.editable ? circuitBlueprint(this.analysis.circuit, this.services.instruments) : { ok: false as const, problems: [INVALID_SOURCE_PROBLEM] };
    if (!exported.ok) return { ok: false, reason: "circuit", problems: exported.problems };
    const written = writeToBook(book, this.origin, target, exported.blueprint);
    if (!written.ok) return { ok: false, reason: "book", message: written.message };
    this.change(() => {
      this.bookString = written.book.string;
      this.decodedBook = written.book;
      this.document.setOrigin(this.originIn(written.path));
    });
    return { ok: true, path: written.path, warnings: exported.warnings };
  }

  private servicesFor(modules: readonly string[]): CatalogService {
    return new CatalogService(this.catalog, modules, this.hidden);
  }

  /** Not for offers: what the user hid plays no part in it. */
  private freshServices(): CatalogService {
    return (this.importServices ??= new CatalogService(this.catalog, defaultModules(this.catalog)));
  }

  /** The empty project as a new one is with the data in use: the game's own modules that the data has are on, mods are off. */
  private asNew(empty: LoadedProject): LoadedProject {
    return withModules(empty, defaultModules(this.catalog));
  }

  /**
   * The modules a circuit needs on top of those of `services` (for an import those of a new project): every module a signal or an
   * entity of the circuit is of, with what it requires. `switchedOn` are the titles of what that adds, in the order of the rows of the project settings.
   */
  private modulesNeeded(source: string, services: CatalogService): ImportModules {
    const modules = services.withModulesOn(modulesUsedOff(source, services));
    if (!modules) return { modules: services.requested, switchedOn: NO_MODULES };
    return { modules, switchedOn: listOrder(services.modules.filter((module) => !module.enabled && modules.includes(module.name))).map((module) => module.title) };
  }

  /** What the game the project was made with had that the data in use has not; null without a record or a difference. */
  private modsNotice(): string | null {
    const record = this.file.manifest.gameMods;
    return record ? modsNotice(record, this.data) : null;
  }

  // Document and analysis

  /** True when the analysis describes the current text and found no errors: the precondition of every graphical command. */
  private get editable(): boolean {
    return !this.analysis.hasErrors && this.analysis.isCurrent(this.document.version);
  }

  private documentApplied(transactions: readonly Transaction[]): void {
    this.depth++;
    if (transactions.some((transaction) => transaction.docChanged)) {
      if (this.refusal) this.show(null);
      this.analyze();
    } else this.followCaret(transactions);
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
    const use = moduleUse(this.services);
    const result = this.analysis.request(this.document.text, this.document.version, use.game, this.settings.wireReach);
    const off = use.off();
    if (!sameList(off, this.modulesOff)) this.modulesOff = off;
    this.acceptAnalysis(result);
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
    if (this.refusal === "selection") this.show(null);
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
    if (result && !result.ok) this.show(result.message, "edit");
    return result;
  }

  /** Sets the message on show, or takes it away. `refusal` says that it reports a refused edit and how long it therefore stays. */
  private show(message: string | null, refusal?: "edit" | "selection"): void {
    this.error = message;
    this.refusal = message === null ? undefined : refusal;
  }

  private entity(id: EntityId): Entity | undefined {
    return this.analysis.circuit.entities.find((entity) => entity.id === id);
  }

  private updateEntity(next: Entity, options: UpdateOptions = {}): void {
    const current = this.entity(next.id);
    // Which entity of the game it is, is the word of its declaration: no edit of the entity changes it.
    if (!this.editable || !current || current.prototype !== next.prototype) return;
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
    if (!result.ok) return this.show(result.message, "edit");
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
    if (blocked) return this.show(`Not rotated: ${this.entity(blocked.entity)?.name} would stand on a tile of ${this.entity(blocked.obstacle)?.name}.`, "selection");
    this.perform({ type: "faceEntities", facings });
  }

  /** Puts entities on the board, as one step, unless one of them would stand on a tile of an entity that is not among them. */
  private setTiles(tiles: readonly EntityTile[]): void {
    const circuit = this.analysis.circuit.entities;
    const centers = new Map(tiles.map(({ id, tile }) => [id, tile]));
    const moved = this.entities([...centers.keys()]);
    if (!this.editable || moved.length === 0) return;
    const origins = new Map(moved.map((entity) => [entity.id, tileOrigin(entity, facingOf(entity), centers.get(entity.id)!)]));
    if (blockedMoves(circuit, origins).size === 0) this.perform({ type: "setTiles", tiles: moved.map(({ id }) => ({ id, tile: centers.get(id)! })) });
  }

  /** Adds an entity and makes it the selection once its analysis has arrived; the tool goes back to select. */
  private addEntity(prototype: PrototypeName, position: Point, facing?: Direction, tile?: Point): void {
    const result = this.compute({ type: "addEntity", prototype, position, tile, facing });
    if (!result) return;
    if (!result.ok) return this.show(result.message, "edit");
    // The new entity gets its id from the analysis of the edit; it is selected when that arrives.
    this.pendingSelection = result.name === undefined ? undefined : [result.name];
    this.tool = SELECT_TOOL;
    this.document.edit(result.changes);
  }

  /** Inserts what the clipboard text declares, as one step; the copies become the selection when their analysis arrives. */
  private pasteEntities(text: string, corner?: Point): void {
    if (!this.editable) return;
    const fragment = readClipboardText(text);
    if (!fragment) return this.show(NOT_A_FRAGMENT, "edit");
    // A point of the board is not an edit position: there the copies go where they were copied from, like a duplicate.
    const at = DISPLAY_CAPABILITIES[this.displayMode].tiles ? undefined : corner;
    const result = this.compute({ type: "pasteFragment", fragment, shift: pasteShift(fragment, this.analysis.circuit.entities, at) });
    if (!result) return;
    if (!result.ok) return this.show(result.message, "edit");
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
      setTool: changing((tool) => {
        // What the game data in use does not have cannot be placed.
        if (tool.type === "place" && !isPrototypeName(tool.prototype)) return;
        const same = sameTool(this.tool, tool) && placeFacing(this.tool) === placeFacing(tool);
        if (!same && toolAllowed(tool, this.displayMode)) this.tool = tool;
      }),
      select: changing((ids, wires = NO_WIRES) => {
        const known = new Set(this.analysis.circuit.entities.map((entity) => entity.id));
        this.setSelection([...new Set(ids)].filter((id) => known.has(id)), this.existingWires(wires));
      }),
      dismissError: changing(() => this.show(null)),

      placeEntity: changing((prototype, position, facing) => this.addEntity(prototype, position, facing)),
      moveEntities: changing((moves) => void this.perform({ type: "moveEntities", moves: moves.filter((move) => this.entity(move.id) !== undefined) })),
      rotateEntities: changing((ids, turn) => this.faceEntities(ids, (entity) => rotated(facingOf(entity), turn))),
      faceEntities: changing((ids, direction) => this.faceEntities(ids, () => direction)),
      flipEntities: changing((ids, axis) => {
        const flipped = this.entities(ids);
        if (!this.editable || flipped.length === 0) return;
        const tiles = DISPLAY_CAPABILITIES[this.displayMode].tiles;
        const arrangements = tiles ? flipTiles(flipped, axis) : flipCards(flipped, axis);
        const blocked = tiles ? blockedFlip(this.analysis.circuit.entities, arrangements) : undefined;
        if (blocked) return this.show(`Not flipped: ${this.entity(blocked.entity)?.name} would stand on a tile of ${this.entity(blocked.obstacle)?.name}.`, "selection");
        this.perform({ type: "arrangeEntities", arrangements });
      }),
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
            return { id: entity.id, tile: tileCenter(entity, facing, { x: origin.x + delta.x, y: origin.y + delta.y }) };
          }),
        );
      }),
      placeHere: changing((ids) => {
        // The derived places keep clear of every entity with a tile and of each other, so there is nothing to check.
        const derived = derivedTiles(this.analysis.circuit.entities);
        const tiles = [...new Set(ids ?? derived.keys())].flatMap((id) => (derived.has(id) ? [{ id, tile: derived.get(id)! }] : []));
        if (tiles.length > 0) this.perform({ type: "setTiles", tiles });
      }),
      unplace: changing((ids) => {
        const tiles = this.entities(ids).filter((entity) => entity.placement?.tile !== undefined).map((entity) => ({ id: entity.id, tile: undefined }));
        if (tiles.length > 0) this.perform({ type: "setTiles", tiles });
      }),
      placeEntityOnTile: changing((prototype, tile, facing = DEFAULT_FACING) => {
        // An entity the game data does not have has no footprint to place by: the language refuses it, as without a tile.
        if (!isPrototypeName(prototype)) return this.addEntity(prototype, { x: 0, y: 0 });
        const circuit = this.analysis.circuit.entities;
        const shape = { prototype };
        const direction = canRotate(shape) ? facing : DEFAULT_FACING;
        const origin = tileOrigin(shape, direction, tile);
        if (!this.editable || !canStandAt(circuit, shape, origin, direction)) return;
        const position = editPositionOf(origin);
        const shift = pasteShift({ entities: [{ position }] }, circuit);
        this.addEntity(prototype, { x: position.x + shift.x, y: position.y + shift.y }, direction, tile);
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
      enableUsedModules: changing(() => {
        const modules = this.services.withModulesOn(this.modulesOff);
        if (modules) this.applySettings({ ...this.settings, modules });
      }),
      setProjectName: changing((name) => {
        const trimmed = name.trim().slice(0, PROJECT_NAME_LIMIT);
        if (trimmed !== "" && trimmed !== this.settings.name) this.settings = { ...this.settings, name: trimmed };
      }),
      setWireReach: changing((wireReach) => {
        if (isWireReach(wireReach) && wireReach !== this.settings.wireReach) this.applySettings({ ...this.settings, wireReach });
      }),
      // Only what is offered changes, so nothing is analyzed again: the window has the choice at once, the file a moment later.
      setHiddenItems: changing((items) => {
        this.hidden = hiddenItems(withHiddenModule(this.hidden.entries, items));
        this.services = this.services.withHidden(this.hidden);
        void this.storeHiddenItems(items);
      }),

      newProject: async () => void (await this.replaceProject(async (api) => {
        const empty = await api.newProject();
        return empty.ok ? { ok: true, value: this.asNew(empty.value) } : empty;
      })),
      openProject: async () => void (await this.replaceProject((api) => api.openProject())),
      loadProject: async (path) => void (await this.replaceProject((api) => api.loadProject(path))),
      openExample: async (file) => void (await this.replaceProject((api) => api.openExample(file))),
      save: () => this.writeProject(false),
      saveAs: () => this.writeProject(true),
      reloadWindow: async () => {
        const api = this.api;
        if (!api) {
          this.fail(NO_DESKTOP);
          return false;
        }
        await this.started;
        if (!(await this.mayReplaceProject(api))) return false;
        return this.unwrap(await api.applyGameData()) !== undefined;
      },

      readBlueprint: (text, select) => readBlueprint(text, this.freshServices().instruments, select, (source) => this.modulesNeeded(source, this.freshServices())),
      openBlueprint: (blueprint) => this.openImported(blueprint),
      openBook: (book) => this.openImported(book),
      chooseBlueprintFile: async () => {
        const api = this.api;
        if (!api) return void this.fail(NO_DESKTOP);
        return this.unwrap(await api.importBlueprintFile()) ?? undefined;
      },
      // The circuit on show lags behind a source with errors; a blueprint of it would not be the blueprint of the project.
      exportBlueprint: () => (this.editable ? exportCircuit(this.analysis.circuit, this.services.instruments) : { ok: false, problems: [INVALID_SOURCE_PROBLEM] }),
      saveBlueprintFile: async (exported) => {
        const api = this.api;
        if (!api) {
          this.fail(NO_DESKTOP);
          return false;
        }
        const written = this.unwrap(await api.exportBlueprintFile({ name: this.settings.name, text: exported.string }));
        if (!written) return false;
        const warnings = exported.warnings.length;
        this.change(() => this.show(`Blueprint exported to ${written.path}${warnings === 0 ? "" : `, with ${warnings} ${warnings === 1 ? "warning" : "warnings"}: File > Export Blueprint > Show Blueprint lists ${warnings === 1 ? "it" : "them"}`}.`));
        return true;
      },

      attachBook: (text) => {
        const read = readBookText(text);
        if (read.ok) this.change(() => this.replaceBook(read.book));
        return read.ok ? { ok: true } : read;
      },
      chooseFromBook: (path) => this.chooseFromBook(path),
      exportToBook: (target) => this.exportToBook(target),
      exportBook: () => {
        const book = this.storedBook();
        return book?.ok ? { ok: true, string: book.string } : { ok: false, message: book?.problem ?? NO_BOOK };
      },
      saveBookFile: async () => {
        const api = this.api;
        const book = this.storedBook();
        if (!api || !book?.ok) {
          this.fail(!api ? NO_DESKTOP : book && !book.ok ? book.problem : NO_BOOK);
          return false;
        }
        const written = this.unwrap(await api.exportBlueprintFile({ name: bookFileName(book, this.settings.name), text: book.string }));
        if (written) this.change(() => this.show(`Blueprint book exported to ${written.path}.`));
        return Boolean(written);
      },
      removeBook: changing(() => {
        if (this.bookString !== undefined) this.replaceBook(undefined);
      }),
    };
  }

  /** Opens a blueprint, or a book without a circuit, as a new project. The main process hands out the empty project and learns by it that the window shows a project without a file. */
  private openImported(imported: ImportedBlueprint | ImportedBook): Promise<boolean> {
    return this.replaceProject(async (api) => {
      const empty = await api.newProject();
      return empty.ok ? { ok: true, value: importedProject(this.asNew(empty.value).data, imported) } : empty;
    }, true);
  }

  // Project settings and files

  /**
   * New settings: signals are judged against the new module set, the simulation gets the matching environment and wires are
   * measured against the new reach. The text is not touched.
   */
  private applySettings(settings: ProjectSettings): void {
    const modulesChanged = settings.modules !== this.settings.modules;
    const reachChanged = settings.wireReach !== this.settings.wireReach;
    this.settings = settings;
    if (modulesChanged) {
      this.services = this.servicesFor(settings.modules);
      this.simulation.setEnvironment(createCatalogEnvironment(this.catalog, this.services.enabled));
    }
    if (modulesChanged || reachChanged) this.analyze();
  }

  /**
   * Replaces everything with `project`: a new document with an empty history, no selection, simulation at tick 0. `imported` says that
   * it is a blueprint of the game: it is shown on the blueprint board, where every entity of it has its tile, and it counts as changed.
   */
  load(project: LoadedProject, imported = false): void {
    this.change(() => {
      const { file, source, settings, book } = openProjectFile(project);
      this.file = imported ? neverSaved(file) : file;
      this.settings = settings;
      this.bookString = book?.string;
      this.decodedBook = undefined;
      this.bookEpoch++;
      this.epoch++;
      this.selection = [];
      this.wireSelection = NO_WIRES;
      this.draft = null;
      this.show(null);
      this.tool = SELECT_TOOL;
      this.displayMode = imported ? "blueprint" : "edit";
      this.coalesce = undefined;
      this.pendingSelection = undefined;
      this.lintShown = 0;
      this.services = this.servicesFor(settings.modules);
      this.simulation.clear();
      this.simulation.setSelection(this.selection);
      this.simulation.setEnvironment(createCatalogEnvironment(this.catalog, this.services.enabled));
      this.analysis.reset();
      this.document.replace(source, this.originIn(book?.origin));
      // The project opens whatever game it was made with; what the data in use lacks of it is said once, and stays in the project settings.
      // So does a book that cannot be read: the project opens, and the book stays in it.
      const stored = this.storedBook();
      const notices = [this.modsNotice(), stored && !stored.ok ? stored.problem : null].filter((notice) => notice !== null);
      if (notices.length > 0) this.show(notices.join(" "));
    });
  }

  /**
   * What a freshly started app does once: it opens the project that was open last in place of the empty one it began with, without a
   * prompt and without an unsaved change. With no such project the empty one stays; so it does, with a message, when the project
   * cannot be read any more. Later calls return the same promise.
   */
  start(): Promise<void> {
    return (this.started ??= this.reopenLastProject());
  }

  private async reopenLastProject(): Promise<void> {
    const api = this.api;
    if (!api) return;
    const file = this.file;
    // A call that fails outright must not leave a rejected promise behind: every later project command waits for this one.
    const last = await api.openLastProject().catch((error: unknown): IpcResult<null> => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (!last.ok) return this.fail(`${LAST_PROJECT_NOT_REOPENED} ${last.error}`);
    // What the user made of the empty project meanwhile is not thrown away.
    if (last.value && this.file === file && !this.dirty) this.load(last.value);
  }

  private fail(message: string): void {
    this.change(() => this.show(message));
  }

  /** Writes what is hidden of one module to the settings of the application. The window keeps the choice when that fails, and says so. */
  private async storeHiddenItems(items: HiddenModuleItems): Promise<void> {
    if (!this.api) return;
    const result = await this.api.setHiddenItems(items).catch((error: unknown): IpcResult<never> => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    if (!result.ok) this.fail(`${HIDDEN_NOT_STORED} ${result.error}`);
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
    const data = toProjectData(file, source, settings, modsRecord(this.data), this.book);
    const saved = this.unwrap(saveAs ? await api.saveProjectAs(data) : await api.saveProject({ path: file.path, data }));
    if (!saved) return false;
    if (this.file === file) this.change(() => void (this.file = savedProjectFile(file, saved.path, data, source, settings)));
    return true;
  }

  /** Before the current project is replaced: offers to save unsaved changes. Resolves false when the user cancels. */
  private async mayReplaceProject(api: FaceApi): Promise<boolean> {
    if (!this.dirty) return true;
    const choice = this.unwrap(await api.confirmUnsavedChanges());
    if (choice === "save") return this.writeProject(false);
    return choice === "discard";
  }

  /** Resolves true when the project `load` gives is on show: false when the user kept the current one, cancelled, or it could not be read. */
  private async replaceProject(load: (api: FaceApi) => Promise<IpcResult<LoadedProject | null>>, imported = false): Promise<boolean> {
    const api = this.api;
    if (!api) {
      this.fail(NO_DESKTOP);
      return false;
    }
    // A project chosen while the start is still asking for the last one is opened after it, not replaced by it.
    await this.started;
    if (!(await this.mayReplaceProject(api))) return false;
    const project = this.unwrap(await load(api));
    if (project) this.load(project, imported);
    return Boolean(project);
  }
}
