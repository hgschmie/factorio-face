// The workbench shell. It lays out the panels, routes their callbacks to the controller's commands and connects the
// native menu and the close handshake. It keeps only view state that no panel owns (the canvas view across remounts).
import type { Point } from "@face/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlueprintFileText, FaceApi, MenuCommand } from "../../../desktop/src/ipc.ts";
import { AttachBook, BookExported, BookUnavailable, ChooseFromBook, ExportToBook, RemoveBook } from "../blueprint/BlueprintBook.tsx";
import { readBookPreview } from "../blueprint/bookText.ts";
import { BlueprintString, ExportProblems } from "../blueprint/ExportBlueprint.tsx";
import { ImportBlueprint, ImportReport } from "../blueprint/ImportBlueprint.tsx";
import { Canvas, type CanvasHandle, type CanvasViews } from "../canvas/Canvas.tsx";
import { canFlip } from "../canvas/flip.ts";
import { ZOOM_STEP, type CanvasView } from "../canvas/viewport.ts";
import type { SourceEditorHandle } from "../editor/SourceEditor.tsx";
import type { FlipAxis, RotationTurn } from "../entities/facing.ts";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { Inspector, type HistoryDirection, type InspectorHandle } from "../inspector/Inspector.tsx";
import { InstrumentsContext } from "../inspector/instruments.ts";
import type { SignalDescriber, SignalPickerRenderer } from "../inspector/SignalField.tsx";
import { isTextEntryTarget, isTextField, usesArrowKeys } from "../platform.ts";
import { clipboardIsForEntities, dropTextSelectionOnPress, pageTextIsSelected } from "../textSelection.ts";
import type { BlueprintExport, BlueprintProblem, ImportedBlueprint, ImportedBook, ImportReportView } from "../session/blueprints.ts";
import type { BookChoice, BookResult, BookTarget } from "../session/book.ts";
import type { GameDataController } from "../gameData/useGameData.ts";
import { takeSettingsOpen } from "../gameData/reopen.ts";
import { offerSelectAll } from "../dialog/selectAll.ts";
import { AppSettings } from "../settings/AppSettings.tsx";
import { ModuleItems } from "../settings/ModuleItems.tsx";
import { gameFolderHint, needsGameFolderHint } from "../settings/appSettings.ts";
import { ProjectSettings } from "../settings/ProjectSettings.tsx";
import type { AppSettingsController } from "../settings/useAppSettings.ts";
import { ShortcutOverview } from "../shortcuts/ShortcutOverview.tsx";
import { nudgeDelta, shortcutFor } from "../shortcuts/shortcuts.ts";
import { SimulationDock } from "../simulation/SimulationDock.tsx";
import { CanvasStrip, type WireIconResolver } from "./CanvasStrip.tsx";
import { DISPLAY_CAPABILITIES, flippedTool, SELECT_TOOL, toolAllowed, turnedTool, type Diagnostic, type DisplayMode, type WorkbenchController } from "./controller.ts";
import { Palette } from "./Palette.tsx";
import { selectedItems, selectionStatus } from "./selectionText.ts";
import { SourcePane } from "./SourcePane.tsx";
import { bookLine, NOT_SAVED_YET, saveStateText, splitPath, statusLead } from "./statusText.ts";
import { TopBar } from "./TopBar.tsx";

export interface WorkbenchProps {
  readonly controller: WorkbenchController;
  /** The desktop bridge; undefined when the renderer runs outside Electron. */
  readonly api?: FaceApi;
  /** The settings of the application on this machine; undefined outside Electron. */
  readonly appSettings?: AppSettingsController;
  /** The game data and the action that reads it from the game: a section of the application settings. */
  readonly gameData?: GameDataController;
  /** Why data read from the game is not in use although there is some; said in the title bar until it is dismissed. */
  readonly dataProblem?: string | null;
  /** No icon of the game can be shown: neither an installation nor bundled icons provide one. */
  readonly iconsMissing?: boolean;
  readonly resolveEntityIcon?: EntityIconResolver;
  readonly resolveWireIcon?: WireIconResolver;
  /** URL of a catalog icon id (a group of the game's items); undefined where no icon is to be had. */
  readonly resolveCatalogIcon?: (icon: string) => string | undefined;
  readonly renderSignalPicker?: SignalPickerRenderer;
  /** Catalog names and icons of signals, for the inspector, the cards and the dock. */
  readonly describeSignal?: SignalDescriber;
}

/** The blueprint dialog on show: one at a time, each the answer to a command of the File menu or the next step of one. */
type BlueprintDialog =
  /** The text box to paste a blueprint string into; with `file`, what a chosen file holds when that is not one blueprint. */
  | { readonly type: "import"; readonly file?: BlueprintFileText }
  | { readonly type: "report"; readonly name: string; readonly report: ImportReportView }
  | { readonly type: "string"; readonly exported: BlueprintExport & { readonly ok: true } }
  | { readonly type: "problems"; readonly problems: readonly BlueprintProblem[] }
  // The blueprint book of the project. What these show of the book is read from the state when they are drawn.
  | { readonly type: "chooseFromBook" }
  /** The text box to paste the string of a book into; with `file`, what a chosen file holds. */
  | { readonly type: "attachBook"; readonly file?: BlueprintFileText }
  | { readonly type: "exportToBook" }
  /** After an export into the book: `replaced` is the label the overwritten blueprint had, null for a new blueprint. */
  | { readonly type: "bookExported"; readonly replaced: string | null; readonly warnings: readonly string[] }
  | { readonly type: "bookString"; readonly string: string }
  | { readonly type: "removeBook" }
  /** A command needs a book and the project has none, or one that cannot be read. */
  | { readonly type: "bookUnavailable" };

/** The dialogs that show a book that can be read; they go when the project has no such book any more (another project was opened under them). */
const SHOWS_BOOK: ReadonlySet<BlueprintDialog["type"]> = new Set(["chooseFromBook", "exportToBook", "bookExported", "bookString"]);

const clipboardEvents = ["cut", "copy", "paste"] as const;

/**
 * Text a field writes only when it is left (a name, a description) would be missing from a save made while the focus is still
 * in it. The field is left and entered again, which writes the text; the caret stays where it is.
 */
function writeFocusedField(): void {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused.dataset.unwritten === undefined) return;
  focused.blur();
  focused.focus();
}

/** True when cut, copy and paste belong to text: the focus is in a text control, in the source editor or in a dialog. */
function focusIsOnText(): boolean {
  const focused = document.activeElement;
  return isTextEntryTarget(focused) || focused?.closest('[role="dialog"]') != null;
}

/** True when a key pressed there is no shortcut of the circuit: it is text, or it belongs to a dialog or to an open menu. */
function keyIsTaken(target: EventTarget | null): boolean {
  return isTextEntryTarget(target) || (target instanceof Element && target.closest('[role="dialog"], [role="menu"]') !== null);
}

export function Workbench({ controller, api, appSettings, gameData, dataProblem = null, iconsMissing = false, resolveEntityIcon, resolveWireIcon, resolveCatalogIcon, renderSignalPicker, describeSignal }: WorkbenchProps) {
  const { state, commands } = controller;
  const { circuit, selection, wireSelection, mode, displayMode, tool, editable, simulation, project } = state;
  const capabilities = DISPLAY_CAPABILITIES[displayMode];
  const canvasRef = useRef<CanvasHandle>(null);
  const editorRef = useRef<SourceEditorHandle>(null);
  const inspectorRef = useRef<InspectorHandle>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  // The module whose signals and entities the user is hiding: a dialog over the project settings, which stay open under it.
  const [itemsModuleName, setItemsModuleName] = useState<string | null>(null);
  const closeItems = useCallback(() => setItemsModuleName(null), []);
  const itemsModule = settingsOpen && itemsModuleName !== null ? state.catalog.modules.find((module) => module.name === itemsModuleName) : undefined;
  // Another project, or other modules, may not have the module: the dialog is then closed for good, not until it is back.
  useEffect(() => {
    if (itemsModuleName !== null && !itemsModule) setItemsModuleName(null);
  }, [itemsModuleName, itemsModule]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  // After the window was loaded again for other game data, the dialog that asked for it is open again.
  const [appSettingsOpen, setAppSettingsOpen] = useState(takeSettingsOpen);
  const [dataProblemDismissed, setDataProblemDismissed] = useState(false);
  const closeAppSettings = useCallback(() => setAppSettingsOpen(false), []);
  const [iconHintDismissed, setIconHintDismissed] = useState(false);
  const [blueprintDialog, setBlueprintDialog] = useState<BlueprintDialog | null>(null);
  const closeBlueprintDialog = useCallback(() => setBlueprintDialog(null), []);
  const book = state.book;
  const readableBook = book !== null && book.problem === null ? book : null;
  // A dialog about the book does not outlive the book it is about: it is closed for good, not until a book is back.
  useEffect(() => {
    if (!blueprintDialog) return;
    const { type } = blueprintDialog;
    if (SHOWS_BOOK.has(type) ? readableBook === null : type === "removeBook" ? book === null : type === "bookUnavailable" && readableBook !== null) setBlueprintDialog(null);
  }, [blueprintDialog, book, readableBook]);
  const revealDiagnostic = useCallback((diagnostic: Diagnostic) => editorRef.current?.reveal(diagnostic.from, diagnostic.to), []);
  // The canvas unmounts in Source mode; its views, one per display mode, are kept here so that coming back does not reset them.
  const viewsRef = useRef<CanvasViews>({});
  const rememberView = useCallback((view: CanvasView, shown: DisplayMode) => {
    viewsRef.current = { ...viewsRef.current, [shown]: view };
  }, []);
  // Another project: the remembered cameras belong to the previous one, so the canvas starts over and fits the new circuit.
  const epochRef = useRef(project.epoch);
  if (epochRef.current !== project.epoch) {
    epochRef.current = project.epoch;
    viewsRef.current = {};
  }

  // Effects below read the latest state through this ref instead of re-subscribing on every change.
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Where the Paste of the canvas context menu puts its group; set until the paste event it asked for has arrived. */
  const menuCornerRef = useRef<Point | undefined>(undefined);

  const save = useCallback(() => {
    writeFocusedField();
    return commands.save();
  }, [commands]);

  // Undo and redo have one authority, the document history. From the inspector, whose fields write to the document, the request
  // goes through the inspector (it first takes back text that is not written). A text field that is not part of the document
  // (project settings, signal search) has no undo: the browser's own would reach into the other fields of the window.
  const history = useCallback(
    (direction: HistoryDirection): void => {
      if (inspectorRef.current?.history(direction)) return;
      if (!isTextField(document.activeElement)) commands[direction]();
    },
    [commands],
  );

  // The browser keeps one undo stack for all text fields of the window and applies it on Ctrl+Z (not on macOS, where the key
  // only reaches the menu). Applied to an inspector field it would arrive as typing and be written as a new edit, so the request
  // is taken over here. The source editor does the same for itself.
  useEffect(() => {
    const onBeforeInput = (event: InputEvent): void => {
      const direction = event.inputType === "historyUndo" ? "undo" : event.inputType === "historyRedo" ? "redo" : undefined;
      if (direction === undefined || (event.target instanceof Element && event.target.closest(".cm-editor") !== null)) return;
      event.preventDefault();
      history(direction);
    };
    document.addEventListener("beforeinput", onBeforeInput, true);
    return () => document.removeEventListener("beforeinput", onBeforeInput, true);
  }, [history]);

  // Cut, copy and paste of entities. The Edit menu items and the keys both end in the browser's clipboard events, which carry
  // the clipboard for the length of the event; that needs no access to the clipboard and nothing from the main process. The
  // events are left alone wherever they mean text (`clipboardIsForEntities` has the rule), and while the canvas is not shown.
  useEffect(() => {
    const onClipboard = (event: ClipboardEvent): void => {
      // The corner of a context-menu paste is good for one paste event, whatever becomes of that event.
      const menuCorner = menuCornerRef.current;
      if (event.type === "paste") menuCornerRef.current = undefined;
      const canvas = canvasRef.current;
      const data = event.clipboardData;
      if (!canvas || !data) return;
      const { selection, editable, displayMode } = stateRef.current;
      const type = event.type as (typeof clipboardEvents)[number];
      if (!clipboardIsForEntities(type, { focusOnText: focusIsOnText(), textSelected: pageTextIsSelected(), editable, canPaste: DISPLAY_CAPABILITIES[displayMode].paste })) return;
      if (type === "paste") {
        event.preventDefault();
        commands.pasteEntities(data.getData("text/plain"), menuCorner ?? canvas.pasteCorner());
        return;
      }
      // Cut and copy take the selected entities (with the wires between them); selected wires are left alone.
      const text = commands.copyEntities(selection);
      if (text === "") return;
      event.preventDefault();
      data.setData("text/plain", text);
      if (event.type === "cut") commands.deleteEntities(selection);
    };
    for (const type of clipboardEvents) document.addEventListener(type, onClipboard);
    return () => {
      for (const type of clipboardEvents) document.removeEventListener(type, onClipboard);
    };
  }, [commands]);

  // Selected text of a message would stay selected while the user goes on to work on the canvas, and the next copy would take it.
  useEffect(() => {
    document.addEventListener("pointerdown", dropTextSelectionOnPress, true);
    return () => document.removeEventListener("pointerdown", dropTextSelectionOnPress, true);
  }, []);

  // The keys of the shortcut table that do not need the focus in the canvas: tools, the display mode, rotation and flipping as in
  // the game (R, Shift+R, H, V: the selection, or with a place tool what it is about to place), moving with the arrows, duplicating, the overview.
  // What the display mode does not offer does nothing. They belong to the circuit wherever the focus is while the canvas is shown,
  // except where a key is text or moves through a list: a text control, the source editor, a dialog, a menu. Only the arrows repeat.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.defaultPrevented) return;
      const shortcut = shortcutFor(event);
      if (!shortcut || shortcut.scope === "canvas" || (event.repeat && !shortcut.repeats) || keyIsTaken(event.target)) return;
      const { circuit, selection, editable, mode, tool, displayMode } = stateRef.current;
      if (shortcut.scope === "circuit" && mode === "source") return;
      const editing = editable && selection.length > 0;
      const offered = DISPLAY_CAPABILITIES[displayMode];
      switch (shortcut.id) {
        case "view.shortcuts":
          setShortcutsOpen(true);
          break;
        case "view.display":
          commands.setDisplayMode(displayMode === "edit" ? "blueprint" : "edit");
          break;
        case "tool.cancel":
          // Inside the canvas the key is the canvas's own. From elsewhere it ends what is pending there: the wire, then the tool.
          if (event.target instanceof Element && event.target.closest(".canvas") !== null) return;
          if (canvasRef.current?.cancelPendingWire()) break;
          if (tool.type === "select") return;
          commands.setTool(SELECT_TOOL);
          break;
        case "edit.rotate":
        case "edit.rotateBack": {
          const turn = shortcut.id === "edit.rotate" ? "clockwise" : "counterclockwise";
          if (tool.type === "place") {
            // As in the game: with something in hand the keys turn that, not what is selected. A lamp does not turn.
            const turned = editable && offered.rotate ? turnedTool(tool, turn) : undefined;
            if (!turned) return;
            commands.setTool(turned);
            break;
          }
          if (!editing || !offered.rotate) return;
          commands.rotateEntities(selection, turn);
          break;
        }
        case "edit.flipHorizontal":
        case "edit.flipVertical": {
          const axis = shortcut.id === "edit.flipHorizontal" ? "horizontal" : "vertical";
          if (tool.type === "place") {
            // What is about to be placed is mirrored, as R turns it.
            const mirrored = editable && offered.rotate ? flippedTool(tool, axis) : undefined;
            if (!mirrored) return;
            commands.setTool(mirrored);
            break;
          }
          if (!editing || !offered.rotate || !canFlip(selectedItems(circuit, selection, []).entities, offered.tiles)) return;
          commands.flipEntities(selection, axis);
          break;
        }
        case "edit.nudge":
        case "edit.nudgeFar":
          if (!editing || !offered.move || usesArrowKeys(event.target)) return;
          // One step is a tile on the board and a grid step on the edit canvas.
          if (offered.tiles) commands.nudgeTiles(nudgeDelta(event.key, shortcut.id === "edit.nudgeFar", 1));
          else commands.nudgeSelection(nudgeDelta(event.key, shortcut.id === "edit.nudgeFar"));
          break;
        case "edit.duplicate":
          if (!editing || !offered.paste) return;
          commands.duplicateSelection();
          break;
        default:
          // The tools. Those that change the circuit are off while it cannot be edited or the display mode has no use for them, like their buttons.
          if (!shortcut.tool || (shortcut.tool.type !== "select" && !editable) || !toolAllowed(shortcut.tool, displayMode)) return;
          commands.setTool(shortcut.tool);
      }
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [commands]);
  const rotateSelection = useCallback((turn: RotationTurn) => commands.rotateEntities(stateRef.current.selection, turn), [commands]);
  const flipSelection = useCallback((axis: FlipAxis) => commands.flipEntities(stateRef.current.selection, axis), [commands]);
  const placeAll = useCallback(() => commands.placeHere(), [commands]);

  // The context menu of the canvas starts the same events for a cut and a copy. A page cannot start a paste, so the main process
  // does it on its behalf. The paste event that follows takes the corner; it may arrive before or after the call returns. A
  // call that fails raises no event, so it takes its corner back.
  const menuCopy = useCallback(() => void document.execCommand("copy"), []);
  const menuCut = useCallback(() => void document.execCommand("cut"), []);
  const menuPaste = useCallback(
    (corner: Point) => {
      if (!api) return;
      menuCornerRef.current = corner;
      const forget = (): void => {
        if (menuCornerRef.current === corner) menuCornerRef.current = undefined;
      };
      api.paste().then((result) => {
        if (!result.ok) forget();
      }, forget);
    },
    [api],
  );

  // A blueprint opens as a new project; what the import left out is reported once it is open.
  const openBlueprint = useCallback(
    async (blueprint: ImportedBlueprint): Promise<boolean> => {
      if (!(await commands.openBlueprint(blueprint))) return false;
      setBlueprintDialog(blueprint.report ? { type: "report", name: blueprint.name, report: blueprint.report } : null);
      return true;
    },
    [commands],
  );
  const openBook = useCallback(
    async (imported: ImportedBook): Promise<boolean> => {
      if (!(await commands.openBook(imported))) return false;
      setBlueprintDialog(null);
      return true;
    },
    [commands],
  );
  // A file that holds one blueprint needs no dialog. A book, or text that is no blueprint, is shown in the import dialog.
  const importBlueprintFile = useCallback(async (): Promise<void> => {
    const file = await commands.chooseBlueprintFile();
    if (!file) return;
    const reading = commands.readBlueprint(file.text);
    if (reading.kind === "blueprint") void openBlueprint(reading.blueprint);
    else setBlueprintDialog({ type: "import", file });
  }, [commands, openBlueprint]);
  // The circuit as a blueprint string: in a dialog to copy it from, or in a file. What is in the way of one is shown instead.
  const exportBlueprint = useCallback(
    (target: "dialog" | "file"): void => {
      writeFocusedField();
      const exported = commands.exportBlueprint();
      if (!exported.ok) setBlueprintDialog({ type: "problems", problems: exported.problems });
      else if (target === "dialog") setBlueprintDialog({ type: "string", exported });
      else {
        setBlueprintDialog(null);
        void commands.saveBlueprintFile(exported);
      }
    },
    [commands],
  );

  // The blueprint book of the project. A command that needs one that can be read says so in a dialog when there is none.
  const withBook = useCallback((run: () => void): void => {
    const current = stateRef.current.book;
    if (current === null || current.problem !== null) setBlueprintDialog({ type: "bookUnavailable" });
    else run();
  }, []);
  const chooseBlueprint = useCallback(() => withBook(() => setBlueprintDialog({ type: "chooseFromBook" })), [withBook]);
  // The blueprint replaces the circuit; what its import left out is reported as after an import.
  const chooseFromBook = useCallback(
    (path: readonly number[]): BookChoice => {
      const choice = commands.chooseFromBook(path);
      if (choice.ok) setBlueprintDialog(choice.report ? { type: "report", name: choice.name, report: choice.report } : null);
      return choice;
    },
    [commands],
  );
  const pasteBook = useCallback(() => setBlueprintDialog({ type: "attachBook" }), []);
  // What the file holds is shown before it becomes the book of the project, with the book it replaces.
  const loadBookFile = useCallback(async (): Promise<void> => {
    const file = await commands.chooseBlueprintFile();
    if (file) setBlueprintDialog({ type: "attachBook", file });
  }, [commands]);
  const attachBook = useCallback(
    (text: string): BookResult => {
      const result = commands.attachBook(text);
      if (result.ok) setBlueprintDialog(null);
      return result;
    },
    [commands],
  );
  // What is in the way of a blueprint of the circuit is said before the user chooses where in the book it goes.
  const openExportToBook = useCallback(
    () =>
      withBook(() => {
        writeFocusedField();
        const exported = commands.exportBlueprint();
        setBlueprintDialog(exported.ok ? { type: "exportToBook" } : { type: "problems", problems: exported.problems });
      }),
    [commands, withBook],
  );
  const exportToBook = useCallback(
    (target: BookTarget, replaced: string | null): string | undefined => {
      const result = commands.exportToBook(target);
      if (result.ok) setBlueprintDialog({ type: "bookExported", replaced, warnings: result.warnings });
      else if (result.reason === "circuit") setBlueprintDialog({ type: "problems", problems: result.problems });
      else return result.message;
      return undefined;
    },
    [commands],
  );
  const exportBook = useCallback(
    (target: "dialog" | "file"): void =>
      withBook(() => {
        // The file: the session shows the save dialog and says in the message on show where the book went.
        if (target === "file") {
          setBlueprintDialog(null);
          return void commands.saveBookFile();
        }
        const exported = commands.exportBook();
        setBlueprintDialog(exported.ok ? { type: "bookString", string: exported.string } : { type: "bookUnavailable" });
      }),
    [commands, withBook],
  );
  // A book that cannot be read can be removed as well.
  const askRemoveBook = useCallback(() => setBlueprintDialog({ type: stateRef.current.book === null ? "bookUnavailable" : "removeBook" }), []);
  const removeBook = useCallback((): void => {
    commands.removeBook();
    setBlueprintDialog(null);
  }, [commands]);

  const showBoard = useCallback(
    (names: readonly string[]): void => {
      const { circuit, mode } = stateRef.current;
      const wanted = new Set(names);
      setBlueprintDialog(null);
      if (mode === "source") commands.setMode("circuit");
      commands.setDisplayMode("blueprint");
      commands.select(circuit.entities.filter((entity) => wanted.has(entity.name)).map((entity) => entity.id));
    },
    [commands],
  );

  // Dirty-state handshake: main asks before closing a window that reported unsaved changes.
  useEffect(() => api?.setDirty(project.dirty), [api, project.dirty]);
  useEffect(() => api?.onSaveBeforeClose(save), [api, save]);

  useEffect(() => {
    if (!api) return;
    const run = (command: MenuCommand): void => {
      const current = stateRef.current;
      // Edit commands belong to a focused text control when there is one, otherwise to the circuit.
      const typing = isTextEntryTarget(document.activeElement);
      switch (command.id) {
        case "app.settings":
          return setAppSettingsOpen(true);
        case "file.new":
          return void commands.newProject();
        case "file.open":
          return void commands.openProject();
        case "file.openRecent":
          return void commands.loadProject(command.path);
        case "file.openExample":
          return void commands.openExample(command.file);
        case "file.save":
          return void save();
        case "file.saveAs":
          writeFocusedField();
          return void commands.saveAs();
        case "file.importBlueprint":
          return void importBlueprintFile();
        case "file.pasteBlueprint":
          return setBlueprintDialog({ type: "import" });
        case "file.exportBlueprint":
          return exportBlueprint("file");
        case "file.showBlueprint":
          return exportBlueprint("dialog");
        case "file.exportToBook":
          return openExportToBook();
        case "file.chooseFromBook":
          return chooseBlueprint();
        case "file.loadBook":
          return void loadBookFile();
        case "file.pasteBook":
          return pasteBook();
        case "file.exportBook":
          return exportBook("file");
        case "file.showBook":
          return exportBook("dialog");
        case "file.removeBook":
          return askRemoveBook();
        case "edit.undo":
          return history("undo");
        case "edit.redo":
          return history("redo");
        case "edit.delete":
          return typing ? void document.execCommand("delete") : commands.deleteSelection();
        case "edit.selectAll":
          if (typing) return void document.execCommand("selectAll");
          // A list with the focus selects its own rows.
          if (offerSelectAll(document.activeElement)) return;
          return commands.select(current.circuit.entities.map((entity) => entity.id));
        case "view.circuit":
          return commands.setMode("circuit");
        case "view.source":
          return commands.setMode("source");
        case "view.split":
          return commands.setMode("split");
        case "view.zoomIn":
          return canvasRef.current?.zoomBy(ZOOM_STEP);
        case "view.zoomOut":
          return canvasRef.current?.zoomBy(1 / ZOOM_STEP);
        case "view.zoomReset":
          return canvasRef.current?.resetZoom();
        case "view.fit":
          return canvasRef.current?.fit();
        case "simulation.toggleRun":
          return current.simulation.running ? commands.pause() : commands.run();
        case "simulation.step":
          return commands.step();
        case "simulation.reset":
          return commands.resetSimulation();
        case "help.shortcuts":
          return setShortcutsOpen(true);
      }
    };
    return api.onMenuCommand(run);
  }, [api, commands, history, save, importBlueprintFile, exportBlueprint, openExportToBook, chooseBlueprint, loadBookFile, pasteBook, exportBook, askRemoveBook]);

  const errors = state.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = state.diagnostics.length - errors;
  const lead = statusLead(errors, editable);
  const [pathHead, pathTail] = splitPath(project.path ?? NOT_SAVED_YET);
  const bookStatus = book && bookLine(book);
  /** On the board: how many entities have no `tile`. */
  const unplacedCount = useMemo(() => (capabilities.tiles ? circuit.entities.filter((entity) => !entity.placement?.tile).length : 0), [capabilities.tiles, circuit.entities]);
  const selectionText = selectionStatus(circuit, selectedItems(circuit, selection, wireSelection));
  const showCanvas = mode !== "source";
  // A message of the controller: over the canvas, above its hint line, while there is one; over the bottom of the source otherwise.
  const toast = state.error && (
    <div className="toast" role="alert">
      <span>{state.error}</span>
      <button type="button" aria-label="Dismiss message" onClick={commands.dismissError}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );

  return (
    <InstrumentsContext value={state.catalog.speakerInstruments}>
    <div className={`app-shell platform-${api?.platform ?? "web"}`}>
      <TopBar
        project={project}
        mode={mode}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        canFit={showCanvas}
        onModeChange={commands.setMode}
        onUndo={commands.undo}
        onRedo={commands.redo}
        settingsOpen={settingsOpen}
        notice={
          dataProblem !== null && !dataProblemDismissed ? (
            <div className="icon-hint data-hint" role="status" title={dataProblem}>
              <span>{dataProblem}</span>
              <button type="button" className="open-settings" onClick={() => setAppSettingsOpen(true)}>
                Game data...
              </button>
              <button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setDataProblemDismissed(true)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ) : (
            appSettings?.state &&
            !iconHintDismissed &&
            needsGameFolderHint(appSettings.state, iconsMissing) && (
              <div className="icon-hint" role="status" title={gameFolderHint(appSettings.state).detail}>
                <span>{gameFolderHint(appSettings.state).text}</span>
                <button type="button" className="open-settings" onClick={() => setAppSettingsOpen(true)}>
                  Game folder...
                </button>
                <button type="button" className="icon-button" aria-label="Dismiss hint" onClick={() => setIconHintDismissed(true)}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            )
          )
        }
        onFit={() => canvasRef.current?.fit()}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onSave={() => void save()}
      />
      {settingsOpen && (
        <ProjectSettings
          project={project}
          catalog={state.catalog}
          onRename={commands.setProjectName}
          onWireReachChange={commands.setWireReach}
          onModuleChange={commands.setModuleEnabled}
          onEnableUsedModules={commands.enableUsedModules}
          onChooseItems={setItemsModuleName}
          covered={itemsModule !== undefined}
          close={closeSettings}
        />
      )}

      <div className={`workbench mode-${mode}`}>
        {showCanvas && (
          <Palette
            registry={state.catalog.entities()}
            tool={tool}
            canPlace={editable && capabilities.place}
            entities={circuit.entities}
            selection={selection}
            resolveEntityIcon={resolveEntityIcon}
            iconUrl={resolveCatalogIcon}
            onToolChange={commands.setTool}
            onSelect={commands.select}
          />
        )}

        <main className="workspace">
          <div className="editor-area">
            {showCanvas && (
              <div className="graph-pane">
                <CanvasStrip
                  entityCount={circuit.entities.length}
                  wireCount={circuit.wires.length}
                  tool={tool}
                  canWire={editable && capabilities.wire}
                  displayMode={displayMode}
                  unplacedCount={unplacedCount}
                  editable={editable}
                  resolveWireIcon={resolveWireIcon}
                  onToolChange={commands.setTool}
                  onDisplayModeChange={commands.setDisplayMode}
                  onPlaceAll={placeAll}
                />
                <div className="canvas-area">
                  <Canvas
                    key={project.epoch}
                    ref={canvasRef}
                    circuit={circuit}
                    selection={selection}
                    wireSelection={wireSelection}
                    tool={tool}
                    displayMode={displayMode}
                    wireReach={project.wireReach}
                    editable={editable}
                    unplacedCount={unplacedCount}
                    entityStatus={simulation.entityStatus}
                    resolveEntityIcon={resolveEntityIcon}
                    describeSignal={describeSignal}
                    initialViews={viewsRef.current}
                    onViewChange={rememberView}
                    onSelect={commands.select}
                    onToolChange={commands.setTool}
                    onPlaceEntity={commands.placeEntity}
                    onMoveEntities={commands.moveEntities}
                    onPlaceEntityOnTile={commands.placeEntityOnTile}
                    onSetTiles={commands.setTiles}
                    onPlaceHere={commands.placeHere}
                    onUnplace={commands.unplace}
                    onToggleWire={commands.toggleWire}
                    onDeleteSelection={commands.deleteSelection}
                    onRotate={rotateSelection}
                    onFlip={flipSelection}
                    onCopy={menuCopy}
                    onCut={menuCut}
                    onPaste={api && menuPaste}
                  />
                  {toast}
                  {!editable && (
                    <div className="invalid-banner" role="status">
                      <span>The canvas cannot be edited until the source is valid. It shows the last valid circuit.</span>
                      <button type="button" onClick={() => commands.setMode("split")}>
                        Show source <Icon name="arrow" size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Text, history and selection belong to the session; the pane stays mounted only to keep its scroll position. */}
            <SourcePane editorRef={editorRef} fileName={project.fileName} binding={controller.editor} diagnostics={state.diagnostics} hidden={mode === "circuit"} onReveal={revealDiagnostic} />
          </div>
        </main>

        <Inspector
          ref={inspectorRef}
          circuit={circuit}
          selection={selection}
          wireSelection={wireSelection}
          editable={editable}
          showTile={capabilities.tiles}
          wireReach={project.wireReach}
          resolveEntityIcon={resolveEntityIcon}
          renderSignalPicker={renderSignalPicker}
          describeSignal={describeSignal}
          entityWarning={(prototype) => state.catalog.entityWarning(prototype)}
          draft={state.draft}
          onRename={commands.renameEntity}
          onChange={commands.updateEntity}
          onFace={commands.faceEntities}
          onDiscardDraft={commands.discardDraft}
          onDelete={commands.deleteEntities}
          onDeleteSelection={commands.deleteSelection}
          onRemoveWire={commands.removeWire}
          onSelect={commands.select}
          onUndo={commands.undo}
          onRedo={commands.redo}
        />
      </div>

      <SimulationDock simulation={simulation} describeSignal={describeSignal} onRun={commands.run} onPause={commands.pause} onStep={commands.step} onReset={commands.resetSimulation} onSpeedChange={commands.setSpeed} />

      <footer className="statusbar">
        <span className="status-lead">
          <span className="status-source" data-level={lead.level} title={lead.title}>
            <span className={`status-dot ${lead.level}`} />
            {lead.text}
          </span>
          {warnings > 0 && (
            <button type="button" className="status-warnings" title="Show the source and its problems" onClick={() => mode === "circuit" && commands.setMode("split")}>
              {warnings} {warnings === 1 ? "warning" : "warnings"}
            </button>
          )}
        </span>
        <span className="status-middle">
          <span className="status-selection">{selectionText}</span>
          <span className="meta-dot" />
          {displayMode === "blueprint" ? "Tile grid" : "20 unit grid"}
        </span>
        <span className="project-meta">
          {/* The blueprint book of the project and the blueprint the circuit came from; nothing without a book. Long labels are cut off. */}
          {bookStatus && (
            <>
              <button type="button" className="status-book" title={bookStatus.title} onClick={chooseBlueprint}>
                <span>{bookStatus.label}</span>
                {bookStatus.origin !== null && <span>{bookStatus.origin}</span>}
              </button>
              <span className="meta-dot" />
            </>
          )}
          {/* Shortened in the middle: the folders give way, the file name stays. */}
          <span className="path" title={project.path ?? undefined}>
            {pathHead !== "" && <span className="path-head">{pathHead}</span>}
            <span className="path-tail">{pathTail}</span>
          </span>
          <span className="meta-dot" />
          <span className={`save-state${project.dirty ? " unsaved" : ""}`} data-testid="save-state" role="status">
            {saveStateText(project)}
          </span>
        </span>
      </footer>

      {itemsModule && (
        <ModuleItems
          key={itemsModule.name}
          module={itemsModule}
          items={state.catalog.items(itemsModule.name)}
          hidden={state.catalog.hiddenOf(itemsModule.name)}
          iconUrl={resolveCatalogIcon}
          resolveEntityIcon={resolveEntityIcon}
          onChange={commands.setHiddenItems}
          close={closeItems}
        />
      )}
      {shortcutsOpen && <ShortcutOverview close={closeShortcuts} />}
      {appSettingsOpen && appSettings && <AppSettings settings={appSettings} gameData={gameData} close={closeAppSettings} />}
      {blueprintDialog?.type === "import" && (
        <ImportBlueprint key={blueprintDialog.file?.name} file={blueprintDialog.file} read={commands.readBlueprint} open={openBlueprint} openBook={openBook} close={closeBlueprintDialog} />
      )}
      {blueprintDialog?.type === "report" && <ImportReport name={blueprintDialog.name} report={blueprintDialog.report} close={closeBlueprintDialog} />}
      {blueprintDialog?.type === "string" && <BlueprintString exported={blueprintDialog.exported} close={closeBlueprintDialog} />}
      {blueprintDialog?.type === "problems" && <ExportProblems problems={blueprintDialog.problems} showBoard={showBoard} close={closeBlueprintDialog} />}
      {blueprintDialog?.type === "chooseFromBook" && readableBook && <ChooseFromBook book={readableBook} choose={chooseFromBook} close={closeBlueprintDialog} />}
      {blueprintDialog?.type === "attachBook" && (
        <AttachBook key={blueprintDialog.file?.name} file={blueprintDialog.file} current={book} read={readBookPreview} attach={attachBook} close={closeBlueprintDialog} />
      )}
      {blueprintDialog?.type === "exportToBook" && readableBook && <ExportToBook book={readableBook} write={exportToBook} close={closeBlueprintDialog} />}
      {blueprintDialog?.type === "bookExported" && readableBook && (
        <BookExported book={readableBook} replaced={blueprintDialog.replaced} warnings={blueprintDialog.warnings} close={closeBlueprintDialog} />
      )}
      {blueprintDialog?.type === "bookString" && readableBook && <BlueprintString kind="book" exported={blueprintDialog} close={closeBlueprintDialog} />}
      {blueprintDialog?.type === "removeBook" && book && <RemoveBook book={book} remove={removeBook} close={closeBlueprintDialog} />}
      {blueprintDialog?.type === "bookUnavailable" && !readableBook && (
        <BookUnavailable problem={book?.problem ?? null} loadFile={() => void loadBookFile()} paste={pasteBook} remove={askRemoveBook} close={closeBlueprintDialog} />
      )}

      {!showCanvas && toast}
    </div>
    </InstrumentsContext>
  );
}
