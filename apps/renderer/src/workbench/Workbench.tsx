// The workbench shell. It lays out the panels, routes their callbacks to the controller's commands and connects the
// native menu and the close handshake. It keeps only view state that no panel owns (the canvas view across remounts).
import { useCallback, useEffect, useRef } from "react";
import type { FaceApi, MenuCommand } from "../../../desktop/src/ipc.ts";
import { Canvas, type CanvasHandle } from "../canvas/Canvas.tsx";
import { ZOOM_STEP, type CanvasView } from "../canvas/viewport.ts";
import type { SourceEditorHandle } from "../editor/SourceEditor.tsx";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import { Inspector } from "../inspector/Inspector.tsx";
import type { SignalPickerRenderer } from "../inspector/SignalField.tsx";
import { isTextEntryTarget } from "../platform.ts";
import { SimulationDock } from "../simulation/SimulationDock.tsx";
import type { WorkbenchController } from "./controller.ts";
import { Palette } from "./Palette.tsx";
import { SourcePane } from "./SourcePane.tsx";
import { TopBar } from "./TopBar.tsx";

export interface WorkbenchProps {
  readonly controller: WorkbenchController;
  /** The desktop bridge; undefined when the renderer runs outside Electron. */
  readonly api?: FaceApi;
  readonly resolveEntityIcon?: EntityIconResolver;
  readonly renderSignalPicker?: SignalPickerRenderer;
}

export function Workbench({ controller, api, resolveEntityIcon, renderSignalPicker }: WorkbenchProps) {
  const { state, commands } = controller;
  const { circuit, selection, mode, tool, editable, simulation, project } = state;
  const canvasRef = useRef<CanvasHandle>(null);
  const editorRef = useRef<SourceEditorHandle>(null);
  // The canvas unmounts in Source mode; its view is kept here so that coming back does not reset it.
  const viewRef = useRef<CanvasView | undefined>(undefined);
  const rememberView = useCallback((view: CanvasView) => {
    viewRef.current = view;
  }, []);

  // Effects below read the latest state through this ref instead of re-subscribing on every change.
  const stateRef = useRef(state);
  stateRef.current = state;

  const deleteSelection = useCallback(() => commands.deleteEntities(stateRef.current.selection), [commands]);

  // Dirty-state handshake: main asks before closing a window that reported unsaved changes.
  useEffect(() => api?.setDirty(project.dirty), [api, project.dirty]);
  useEffect(() => api?.onSaveBeforeClose(() => commands.save()), [api, commands]);

  useEffect(() => {
    if (!api) return;
    const run = (command: MenuCommand): void => {
      const current = stateRef.current;
      // Edit commands belong to a focused text control when there is one, otherwise to the circuit.
      const typing = isTextEntryTarget(document.activeElement);
      const inSourceEditor = document.activeElement?.closest(".cm-editor") != null;
      switch (command.id) {
        case "file.new":
          return void commands.newProject();
        case "file.open":
          return void commands.openProject();
        case "file.openRecent":
          return void commands.loadProject(command.path);
        case "file.save":
          return void commands.save();
        case "file.saveAs":
          return void commands.saveAs();
        case "edit.undo":
          return typing && !inSourceEditor ? void document.execCommand("undo") : commands.undo();
        case "edit.redo":
          return typing && !inSourceEditor ? void document.execCommand("redo") : commands.redo();
        case "edit.delete":
          return typing ? void document.execCommand("delete") : commands.deleteEntities(current.selection);
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
  }, [api, commands]);

  const errors = state.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const selectedNames = circuit.entities.filter((entity) => selection.includes(entity.id)).map((entity) => entity.name);
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
        onFit={() => canvasRef.current?.fit()}
        onSave={() => void commands.save()}
      />

      <div className={`workbench mode-${mode}`}>
        {showCanvas && <Palette tool={tool} editable={editable} entities={circuit.entities} selection={selection} resolveEntityIcon={resolveEntityIcon} onToolChange={commands.setTool} onSelect={commands.select} />}

        <main className="workspace">
          <div className="editor-area">
            {showCanvas && (
              <div className="graph-pane">
                <Canvas
                  ref={canvasRef}
                  circuit={circuit}
                  selection={selection}
                  tool={tool}
                  editable={editable}
                  entityStatus={simulation.entityStatus}
                  resolveEntityIcon={resolveEntityIcon}
                  initialView={viewRef.current}
                  onViewChange={rememberView}
                  onSelect={commands.select}
                  onToolChange={commands.setTool}
                  onPlaceEntity={commands.placeEntity}
                  onMoveEntities={commands.moveEntities}
                  onAddWire={commands.addWire}
                  onDeleteSelection={deleteSelection}
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
            {/* Always mounted, so the editor keeps its history and scroll position while hidden. */}
            <SourcePane
              editorRef={editorRef}
              fileName={project.fileName}
              source={state.source}
              diagnostics={state.diagnostics}
              extensions={controller.editorExtensions}
              tokenize={controller.tokenize}
              hidden={mode === "circuit"}
              onSourceChange={commands.setSource}
              onRevealOffset={(offset) => editorRef.current?.revealOffset(offset)}
            />
          </div>
        </main>

        <Inspector
          circuit={circuit}
          selection={selection}
          editable={editable}
          resolveEntityIcon={resolveEntityIcon}
          renderSignalPicker={renderSignalPicker}
          onRename={commands.renameEntity}
          onChange={commands.updateEntity}
          onDelete={commands.deleteEntities}
          onRemoveWire={commands.removeWire}
          onSelect={commands.select}
        />
      </div>

      <SimulationDock simulation={simulation} onRun={commands.run} onPause={commands.pause} onStep={commands.step} onReset={commands.resetSimulation} onSpeedChange={commands.setSpeed} />

      <footer className="statusbar">
        <span className="status-lead">
          <span className={`status-dot${errors > 0 ? " error" : editable ? "" : " warning"}`} />
          {errors > 0 ? `${errors} ${errors === 1 ? "error" : "errors"} in source` : editable ? "Circuit ready" : "Canvas read-only"}
        </span>
        <span>
          {selectedNames.length === 0 ? "No selection" : selectedNames.length <= 4 ? selectedNames.join(", ") : `${selectedNames.length} entities selected`}
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
