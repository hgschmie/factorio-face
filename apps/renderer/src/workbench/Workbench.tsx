// The workbench shell. It lays out the panels, routes their callbacks to the controller's commands and connects the
// native menu and the close handshake. It keeps only view state that no panel owns (the canvas view across remounts).
import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceApi, MenuCommand } from "../../../desktop/src/ipc.ts";
import { Canvas, type CanvasHandle } from "../canvas/Canvas.tsx";
import { ZOOM_STEP, type CanvasView } from "../canvas/viewport.ts";
import type { SourceEditorHandle } from "../editor/SourceEditor.tsx";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { Inspector, type HistoryDirection, type InspectorHandle } from "../inspector/Inspector.tsx";
import type { SignalDescriber, SignalPickerRenderer } from "../inspector/SignalField.tsx";
import { isTextEntryTarget, isTextField } from "../platform.ts";
import { ProjectSettings } from "../settings/ProjectSettings.tsx";
import { SimulationDock } from "../simulation/SimulationDock.tsx";
import type { Diagnostic, WorkbenchController } from "./controller.ts";
import { selectedItems, selectionStatus } from "./selectionText.ts";
import { Palette, type WireIconResolver } from "./Palette.tsx";
import { SourcePane } from "./SourcePane.tsx";
import { TopBar } from "./TopBar.tsx";

export interface WorkbenchProps {
  readonly controller: WorkbenchController;
  /** The desktop bridge; undefined when the renderer runs outside Electron. */
  readonly api?: FaceApi;
  readonly resolveEntityIcon?: EntityIconResolver;
  readonly resolveWireIcon?: WireIconResolver;
  readonly renderSignalPicker?: SignalPickerRenderer;
  /** Catalog names and icons of signals, for the inspector, the cards and the dock. */
  readonly describeSignal?: SignalDescriber;
}

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

/** True when text of the page itself, such as a message, is selected. A selection left behind in the source editor does not count. */
function pageTextIsSelected(): boolean {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
  return anchor != null && anchor.closest(".cm-editor") === null;
}

export function Workbench({ controller, api, resolveEntityIcon, resolveWireIcon, renderSignalPicker, describeSignal }: WorkbenchProps) {
  const { state, commands } = controller;
  const { circuit, selection, wireSelection, mode, tool, editable, simulation, project } = state;
  const canvasRef = useRef<CanvasHandle>(null);
  const editorRef = useRef<SourceEditorHandle>(null);
  const inspectorRef = useRef<InspectorHandle>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const revealDiagnostic = useCallback((diagnostic: Diagnostic) => editorRef.current?.reveal(diagnostic.from, diagnostic.to), []);
  // The canvas unmounts in Source mode; its view is kept here so that coming back does not reset it.
  const viewRef = useRef<CanvasView | undefined>(undefined);
  const rememberView = useCallback((view: CanvasView) => {
    viewRef.current = view;
  }, []);
  // Another project: the remembered camera belongs to the previous one, so the canvas starts over and fits the new circuit.
  const epochRef = useRef(project.epoch);
  if (epochRef.current !== project.epoch) {
    epochRef.current = project.epoch;
    viewRef.current = undefined;
  }

  // Effects below read the latest state through this ref instead of re-subscribing on every change.
  const stateRef = useRef(state);
  stateRef.current = state;

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
  // events are left alone wherever they mean text, and while the canvas is not shown.
  useEffect(() => {
    const onClipboard = (event: ClipboardEvent): void => {
      const canvas = canvasRef.current;
      const data = event.clipboardData;
      if (!canvas || !data || focusIsOnText()) return;
      // Cut and copy take the selected entities (with the wires between them); selected wires are left alone.
      const { selection, editable } = stateRef.current;
      if (event.type === "paste") {
        if (!editable) return;
        event.preventDefault();
        commands.pasteEntities(data.getData("text/plain"), canvas.pasteCorner());
        return;
      }
      if (pageTextIsSelected() || (event.type === "cut" && !editable)) return;
      const text = commands.copyEntities(selection);
      if (text === "") return;
      event.preventDefault();
      data.setData("text/plain", text);
      if (event.type === "cut") commands.deleteEntities(selection);
    };
    const clipboardEvents = ["cut", "copy", "paste"] as const;
    for (const type of clipboardEvents) document.addEventListener(type, onClipboard);
    return () => {
      for (const type of clipboardEvents) document.removeEventListener(type, onClipboard);
    };
  }, [commands]);

  // The context menu of the canvas starts the same events for a cut and a copy. A page cannot start a paste (the main process
  // would have to do it on its behalf), so the menu has none: pasting is Edit > Paste and Cmd/Ctrl+V.
  const menuCopy = useCallback(() => void document.execCommand("copy"), []);
  const menuCut = useCallback(() => void document.execCommand("cut"), []);

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
        case "file.new":
          return void commands.newProject();
        case "file.open":
          return void commands.openProject();
        case "file.openRecent":
          return void commands.loadProject(command.path);
        case "file.save":
          return void save();
        case "file.saveAs":
          writeFocusedField();
          return void commands.saveAs();
        case "edit.undo":
          return history("undo");
        case "edit.redo":
          return history("redo");
        case "edit.delete":
          return typing ? void document.execCommand("delete") : commands.deleteSelection();
        case "edit.selectAll":
          return typing ? void document.execCommand("selectAll") : commands.select(current.circuit.entities.map((entity) => entity.id));
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
      }
    };
    return api.onMenuCommand(run);
  }, [api, commands, history, save]);

  const errors = state.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = state.diagnostics.length - errors;
  const selectionText = selectionStatus(circuit, selectedItems(circuit, selection, wireSelection));
  const showCanvas = mode !== "source";

  return (
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
        onFit={() => canvasRef.current?.fit()}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onSave={() => void save()}
      />
      {settingsOpen && <ProjectSettings project={project} catalog={state.catalog} onRename={commands.setProjectName} onModuleChange={commands.setModuleEnabled} close={closeSettings} />}

      <div className={`workbench mode-${mode}`}>
        {showCanvas && <Palette tool={tool} editable={editable} entities={circuit.entities} selection={selection} resolveEntityIcon={resolveEntityIcon} resolveWireIcon={resolveWireIcon} onToolChange={commands.setTool} onSelect={commands.select} />}

        <main className="workspace">
          <div className="editor-area">
            {showCanvas && (
              <div className="graph-pane">
                <Canvas
                  key={project.epoch}
                  ref={canvasRef}
                  circuit={circuit}
                  selection={selection}
                  wireSelection={wireSelection}
                  tool={tool}
                  editable={editable}
                  entityStatus={simulation.entityStatus}
                  resolveEntityIcon={resolveEntityIcon}
                  describeSignal={describeSignal}
                  initialView={viewRef.current}
                  onViewChange={rememberView}
                  onSelect={commands.select}
                  onToolChange={commands.setTool}
                  onPlaceEntity={commands.placeEntity}
                  onMoveEntities={commands.moveEntities}
                  onToggleWire={commands.toggleWire}
                  onDeleteSelection={commands.deleteSelection}
                  onCopy={menuCopy}
                  onCut={menuCut}
                />
                {!editable && (
                  <div className="invalid-banner" role="status">
                    <span>The canvas cannot be edited until the source is valid. It shows the last valid circuit.</span>
                    <button type="button" onClick={() => commands.setMode("split")}>
                      Show source <Icon name="arrow" size={14} />
                    </button>
                  </div>
                )}
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
          resolveEntityIcon={resolveEntityIcon}
          renderSignalPicker={renderSignalPicker}
          describeSignal={describeSignal}
          draft={state.draft}
          onRename={commands.renameEntity}
          onChange={commands.updateEntity}
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
          <span className={`status-dot${errors > 0 ? " error" : editable ? "" : " warning"}`} />
          {errors > 0 ? `${errors} ${errors === 1 ? "error" : "errors"} in source` : editable ? "Circuit ready" : "Canvas read-only"}
          {warnings > 0 && (
            <button type="button" className="status-warnings" title="Show the source and its problems" onClick={() => mode === "circuit" && commands.setMode("split")}>
              {warnings} {warnings === 1 ? "warning" : "warnings"}
            </button>
          )}
        </span>
        <span>
          <span className="status-selection">{selectionText}</span>
          <span className="meta-dot" />
          20 unit grid
        </span>
        <span>FActorio Circuit Editor</span>
      </footer>

      {state.error && (
        <div className="toast" role="alert">
          <span>{state.error}</span>
          <button type="button" aria-label="Dismiss message" onClick={commands.dismissError}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
