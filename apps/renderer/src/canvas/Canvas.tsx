// The circuit canvas. It owns transient view state only (camera, gesture in progress, pending wire, context menu);
// every change to the circuit or the selection is emitted through a callback and comes back as new props.
import type { Circuit, EntityId, EntityKind, Point, TerminalRef, Wire, WireColor } from "@face/model";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type Ref } from "react";
import { KIND_INFO } from "../entities/kindInfo.ts";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { SignalDescriber } from "../inspector/SignalField.tsx";
import { isTextEntryTarget, SHORTCUT } from "../platform.ts";
import { SELECT_TOOL, type EntityMove, type EntityStatus, type Tool } from "../workbench/controller.ts";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.tsx";
import { changedPositions, dragPositions, exceedsDragThreshold, placementPosition, snapPoint, worldDelta, type EntityPosition } from "./drag.ts";
import { cardRect, entitiesBounds, expandRect, GRID, pinPoint, rectFromPoints, rectsIntersect, type Rect } from "./geometry.ts";
import { Scene } from "./Scene.tsx";
import { cameraFor, cullingRect, DEFAULT_CAMERA, fitCamera, panFrom, screenToWorld, viewOf, visibleWorldRect, wheelZoomFactor, ZOOM_STEP, zoomAround, type Camera, type CanvasView, type Size } from "./viewport.ts";
import { FEEDBACK_CLEARANCE } from "./wireRouting.ts";

export interface CanvasHandle {
  fit(): void;
  zoomBy(factor: number): void;
  resetZoom(): void;
  focus(): void;
  /** Where a paste puts the top-left corner of its group: the grid point under the pointer while that is over the canvas. */
  pasteCorner(): Point | undefined;
}

export interface CanvasProps {
  readonly ref?: Ref<CanvasHandle>;
  readonly circuit: Circuit;
  readonly selection: readonly EntityId[];
  readonly tool: Tool;
  /** When false the circuit is shown but cannot be changed (the source has errors). */
  readonly editable: boolean;
  readonly entityStatus?: ReadonlyMap<EntityId, EntityStatus>;
  /** Catalog icons and names for the signals in a card's status line. */
  readonly describeSignal?: SignalDescriber;
  readonly resolveEntityIcon?: EntityIconResolver;
  /** View to start with, for example the one in use before the canvas was unmounted. Without it the circuit is fitted. */
  readonly initialView?: CanvasView;
  onViewChange?(view: CanvasView): void;
  onSelect(ids: readonly EntityId[]): void;
  onToolChange(tool: Tool): void;
  onPlaceEntity(kind: EntityKind, position: Point): void;
  onMoveEntities(moves: readonly EntityMove[]): void;
  /** A wire gesture was completed between the pins of two different terminals: connect them, or disconnect them if this wire exists. */
  onToggleWire(wire: Wire): void;
  onDeleteSelection(): void;
  /** The clipboard actions of the context menu; an action the host cannot perform is absent and its item disabled. */
  onCopy?(): void;
  onCut?(): void;
}

type Gesture =
  | { readonly type: "pan"; readonly pointerId: number; readonly press: Point; readonly origin: Camera; readonly clearsSelection: boolean }
  | { readonly type: "drag"; readonly pointerId: number; readonly press: Point; readonly grabbedId: EntityId; readonly origins: readonly EntityPosition[]; readonly collapseTo: EntityId | null }
  | { readonly type: "marquee"; readonly pointerId: number; readonly press: Point; readonly startWorld: Point };

interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly onEntity: boolean;
}

/** Margins and cell size of the culling rectangle, in world units. */
const CULL_MARGIN = 120;
const CULL_CELL = 400;
/** Below this zoom, text is illegible and cards are drawn as outlines. */
const OUTLINE_ZOOM = 0.3;
const FIT_PADDING = 70;
/** Room kept for the context menu, so that it opens inside the canvas. */
const MENU_SIZE = { width: 200, height: 150 };
const NUDGE_KEYS: Readonly<Record<string, Point>> = { ArrowLeft: { x: -GRID, y: 0 }, ArrowRight: { x: GRID, y: 0 }, ArrowUp: { x: 0, y: -GRID }, ArrowDown: { x: 0, y: GRID } };

function clientPoint(event: { readonly clientX: number; readonly clientY: number }): Point {
  return { x: event.clientX, y: event.clientY };
}

/** The connection pin under the pointer: its terminal and the wire color it accepts. */
function pinAt(target: Element): { readonly terminal: TerminalRef; readonly color: WireColor } | null {
  const pin = target.closest("[data-terminal]");
  const side = pin?.getAttribute("data-terminal");
  const color = pin?.getAttribute("data-wire-color");
  const entity = target.closest("[data-entity-id]")?.getAttribute("data-entity-id");
  return entity && (side === "in" || side === "out") && (color === "red" || color === "green") ? { terminal: { entity, side }, color } : null;
}

function entityIdAt(target: Element): EntityId | null {
  return target.closest("[data-entity-id]")?.getAttribute("data-entity-id") ?? null;
}

function hintFor(tool: Tool, pending: TerminalRef | null, editable: boolean): string {
  if (!editable) return "Fix the source to edit the circuit. Drag to pan, scroll to zoom.";
  if (tool.type === "place") return `Click the canvas (or press Enter on it) to place a ${KIND_INFO[tool.kind].label.toLowerCase()}. Esc cancels.`;
  if (tool.type === "wire" && pending) return `Click a second ${tool.color} pin to connect. An existing ${tool.color} wire between the two is removed. Esc cancels.`;
  if (tool.type === "wire") return `Click a ${tool.color} pin of an input or output to start a ${tool.color} wire.`;
  return "Drag to arrange. Drag empty space to pan, Shift-drag to select an area, scroll to zoom.";
}

export function Canvas(props: CanvasProps) {
  const { circuit, selection, tool, editable, onSelect, onToolChange, onViewChange } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  /** The view to restore once the canvas has a size; a resize keeps its center in place. */
  const viewRef = useRef<CanvasView | undefined>(props.initialView);
  const sizeRef = useRef<Size>({ width: 0, height: 0 });
  /** Where the pointer is, while it is over the canvas. */
  const pointerRef = useRef<{ readonly clientX: number; readonly clientY: number } | null>(null);

  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [camera, setCameraState] = useState<Camera>(DEFAULT_CAMERA);
  const cameraRef = useRef(camera);
  const [previewPositions, setPreviewPositions] = useState<ReadonlyMap<EntityId, Point> | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [panning, setPanning] = useState(false);
  const [pendingWire, setPendingWire] = useState<TerminalRef | null>(null);
  const [pointerWorld, setPointerWorld] = useState<Point | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Several wheel or pointer events can arrive between two renders, so the ref is the source of truth for the camera.
  const setCamera = useCallback(
    (next: Camera) => {
      cameraRef.current = next;
      setCameraState(next);
      viewRef.current = viewOf(next, sizeRef.current);
      onViewChange?.(viewRef.current);
    },
    [onViewChange],
  );

  const entityById = useMemo(() => new Map(circuit.entities.map((entity) => [entity.id, entity])), [circuit.entities]);
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const selectedEntities = useMemo(() => circuit.entities.filter((entity) => selectionSet.has(entity.id)), [circuit.entities, selectionSet]);

  const fit = useCallback(() => {
    const bounds = entitiesBounds(circuit.entities);
    // Feedback loops pass above their card; keep them in view as well.
    setCamera(fitCamera(bounds && expandRect(bounds, FEEDBACK_CLEARANCE.green), size, FIT_PADDING));
  }, [circuit.entities, size, setCamera]);

  const zoomBy = useCallback((factor: number) => setCamera(zoomAround(cameraRef.current, { x: size.width / 2, y: size.height / 2 }, factor)), [size, setCamera]);

  useImperativeHandle(
    props.ref,
    () => ({
      fit,
      zoomBy,
      resetZoom: () => zoomBy(1 / cameraRef.current.zoom),
      focus: () => svgRef.current?.focus(),
      pasteCorner: () => (pointerRef.current && svgRef.current ? snapPoint(worldPoint(pointerRef.current)) : undefined),
    }),
    [fit, zoomBy],
  );

  // Measured before the first paint, so the scene is never drawn against a canvas of unknown size.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = (): void => setSize((previous) => (previous.width === container.clientWidth && previous.height === container.clientHeight ? previous : { width: container.clientWidth, height: container.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // First layout: restore the view that was handed in, or show the whole circuit. Later resizes keep the center.
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0 || (size.width === sizeRef.current.width && size.height === sizeRef.current.height)) return;
    sizeRef.current = size;
    if (viewRef.current) setCamera(cameraFor(viewRef.current, size));
    else fit();
    // Runs for size changes only; `fit` and `setCamera` are read at that moment.
  }, [size]);

  // React registers wheel listeners as passive, and a passive listener cannot stop the page from scrolling.
  // The listener sits on the container so that the wheel also zooms while the pointer is over an overlay.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const bounds = container.getBoundingClientRect();
      const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      setCamera(zoomAround(cameraRef.current, pointer, wheelZoomFactor(event.deltaY, event.ctrlKey)));
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [setCamera]);

  useEffect(() => {
    if (tool.type !== "wire") setPendingWire(null);
  }, [tool]);

  // A pending wire must not survive the removal of its start entity.
  useEffect(() => {
    if (pendingWire && !entityById.has(pendingWire.entity)) setPendingWire(null);
  }, [pendingWire, entityById]);

  const localPoint = (event: { readonly clientX: number; readonly clientY: number }): Point => {
    const bounds = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const worldPoint = (event: { readonly clientX: number; readonly clientY: number }): Point => screenToWorld(cameraRef.current, localPoint(event));

  const clickTerminal = (terminal: TerminalRef): void => {
    if (tool.type !== "wire") return;
    if (!pendingWire) {
      setPendingWire(terminal);
      return;
    }
    const sameTerminal = pendingWire.entity === terminal.entity && pendingWire.side === terminal.side;
    if (!sameTerminal) props.onToggleWire({ color: tool.color, a: pendingWire, b: terminal });
    setPendingWire(null);
  };

  const beginGesture = (event: PointerEvent<SVGSVGElement>, gesture: Gesture): void => {
    gestureRef.current = gesture;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 && event.button !== 1) return;
    event.currentTarget.focus();
    event.preventDefault();
    const target = event.target as Element;
    const press = clientPoint(event);
    const pan: Gesture = { type: "pan", pointerId: event.pointerId, press, origin: cameraRef.current, clearsSelection: false };
    if (event.button === 1) return beginGesture(event, pan);

    const entityId = entityIdAt(target);
    if (tool.type === "wire") {
      // Only the pins of the tool's color are targets.
      const pin = pinAt(target);
      if (pin && pin.color === tool.color && editable) clickTerminal(pin.terminal);
      else if (!entityId) beginGesture(event, pan);
      return;
    }
    if (tool.type === "place") {
      if (editable) props.onPlaceEntity(tool.kind, placementPosition(worldPoint(event)));
      return;
    }
    if (!entityId) {
      if (event.shiftKey) beginGesture(event, { type: "marquee", pointerId: event.pointerId, press, startWorld: worldPoint(event) });
      else beginGesture(event, { ...pan, clearsSelection: true });
      return;
    }
    if (event.shiftKey) {
      onSelect(selectionSet.has(entityId) ? selection.filter((id) => id !== entityId) : [...selection, entityId]);
      return;
    }
    const alreadySelected = selectionSet.has(entityId);
    if (!alreadySelected) onSelect([entityId]);
    if (!editable) return;
    const dragged = alreadySelected ? selectedEntities : circuit.entities.filter((entity) => entity.id === entityId);
    beginGesture(event, {
      type: "drag",
      pointerId: event.pointerId,
      press,
      grabbedId: entityId,
      origins: dragged.map(({ id, position }) => ({ id, position })),
      // A plain click on one member of a multi-selection narrows the selection to it.
      collapseTo: alreadySelected && selection.length > 1 ? entityId : null,
    });
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    pointerRef.current = { clientX: event.clientX, clientY: event.clientY };
    if (pendingWire) setPointerWorld(worldPoint(event));
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const current = clientPoint(event);
    if (gesture.type === "marquee") {
      setMarquee(rectFromPoints(gesture.startWorld, worldPoint(event)));
      return;
    }
    if (!exceedsDragThreshold(gesture.press, current)) return;
    if (gesture.type === "pan") {
      setPanning(true);
      setCamera(panFrom(gesture.origin, current.x - gesture.press.x, current.y - gesture.press.y));
    } else {
      const positions = dragPositions(gesture.origins, gesture.grabbedId, worldDelta(gesture.press, current, cameraRef.current.zoom));
      setPreviewPositions(new Map(positions.map(({ id, position }) => [id, position])));
    }
  };

  const endGesture = (event: PointerEvent<SVGSVGElement>, commit: boolean): void => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setPreviewPositions(null);
    setMarquee(null);
    setPanning(false);
    if (!commit) return;

    // The outcome is derived from the release event itself. The preview state may be one frame behind.
    const release = clientPoint(event);
    const moved = exceedsDragThreshold(gesture.press, release);
    if (gesture.type === "drag") {
      if (moved) {
        const positions = dragPositions(gesture.origins, gesture.grabbedId, worldDelta(gesture.press, release, cameraRef.current.zoom));
        const moves = changedPositions(gesture.origins, positions);
        if (moves.length > 0) props.onMoveEntities(moves);
      } else if (gesture.collapseTo) {
        onSelect([gesture.collapseTo]);
      }
    } else if (gesture.type === "marquee") {
      const area = rectFromPoints(gesture.startWorld, worldPoint(event));
      const inside = circuit.entities.filter((entity) => rectsIntersect(cardRect(entity.position), area)).map((entity) => entity.id);
      onSelect([...new Set([...selection, ...inside])]);
    } else if (!moved && gesture.clearsSelection && selection.length > 0) {
      onSelect([]);
    }
  };

  const onContextMenu = (event: MouseEvent<SVGSVGElement>): void => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const entityId = entityIdAt(event.target as Element);
    if (entityId && !selectionSet.has(entityId)) onSelect([entityId]);
    if (!entityId && selection.length > 0) onSelect([]);
    const bounds = container.getBoundingClientRect();
    // Keep the menu inside the canvas.
    const x = Math.min(event.clientX - bounds.left, bounds.width - MENU_SIZE.width);
    setMenu({ x, y: Math.min(event.clientY - bounds.top, bounds.height - MENU_SIZE.height), onEntity: entityId !== null });
  };

  const deleteSelection = (): void => {
    if (!editable || selection.length === 0) return;
    props.onDeleteSelection();
    svgRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isTextEntryTarget(event.target)) return;
    const nudge = NUDGE_KEYS[event.key];
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selection.length === 0) return;
      event.preventDefault();
      deleteSelection();
    } else if (event.key === "Escape") {
      if (pendingWire) setPendingWire(null);
      else if (tool.type !== "select") onToolChange(SELECT_TOOL);
      else if (selection.length > 0) onSelect([]);
    } else if (event.key === "Enter" && tool.type === "place" && editable && event.target === svgRef.current) {
      // Keyboard placement: the new card goes to the middle of the view.
      event.preventDefault();
      props.onPlaceEntity(tool.kind, placementPosition(screenToWorld(cameraRef.current, { x: size.width / 2, y: size.height / 2 })));
    } else if (event.key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSelect(circuit.entities.map((entity) => entity.id));
    } else if (nudge && editable && selectedEntities.length > 0) {
      event.preventDefault();
      props.onMoveEntities(selectedEntities.map(({ id, position }) => ({ id, position: { x: position.x + nudge.x, y: position.y + nudge.y } })));
    }
  };

  const closeMenu = useCallback(() => setMenu(null), []);
  // The focus goes back to the canvas first: the clipboard then sees the same state as with the keys, and they work afterwards.
  const clipboardAction = (action: (() => void) | undefined) => (): void => {
    svgRef.current?.focus();
    action?.();
  };
  const selectAll = (): void => onSelect(circuit.entities.map((entity) => entity.id));
  // A right click on empty canvas clears the selection, so cut and copy are only offered on a card.
  const menuItems: ContextMenuItem[] = menu?.onEntity
    ? [
        { id: "cut", label: "Cut", icon: "cut", shortcut: SHORTCUT.cut, disabled: !editable || !props.onCut, onSelect: clipboardAction(props.onCut) },
        { id: "copy", label: "Copy", icon: "copy", shortcut: SHORTCUT.copy, disabled: !props.onCopy, onSelect: clipboardAction(props.onCopy) },
        { id: "delete", label: selection.length > 1 ? `Delete ${selection.length} entities` : "Delete", icon: "trash", shortcut: SHORTCUT.delete, danger: true, disabled: !editable, separatorBefore: true, onSelect: deleteSelection },
      ]
    : [
        { id: "select-all", label: "Select all", icon: "selectAll", shortcut: SHORTCUT.selectAll, disabled: circuit.entities.length === 0, onSelect: selectAll },
        { id: "fit", label: "Fit to content", icon: "fit", shortcut: SHORTCUT.fit, onSelect: fit },
      ];

  const visibleRect = visibleWorldRect(camera, size);
  const cullRect = cullingRect(camera, size, CULL_MARGIN, CULL_CELL);
  const stableCullRect = useMemo<Rect>(() => ({ x: cullRect.x, y: cullRect.y, width: cullRect.width, height: cullRect.height }), [cullRect.x, cullRect.y, cullRect.width, cullRect.height]);

  const pendingEntity = pendingWire ? entityById.get(pendingWire.entity) : undefined;

  return (
    <div ref={containerRef} className={`canvas tool-${tool.type}${tool.type === "wire" ? ` wire-${tool.color}` : ""}${panning ? " panning" : ""}`} onKeyDown={onKeyDown} data-zoom={camera.zoom}>
      <svg
        ref={svgRef}
        className="canvas-svg"
        tabIndex={0}
        role="application"
        aria-label="Circuit canvas"
        viewBox={`${camera.x} ${camera.y} ${Math.max(1, visibleRect.width)} ${Math.max(1, visibleRect.height)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endGesture(event, true)}
        onPointerCancel={(event) => endGesture(event, false)}
        onPointerLeave={() => void (pointerRef.current = null)}
        onContextMenu={onContextMenu}
      >
        <defs>
          <pattern id="grid-dots" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <circle className="grid-dot" cx="0" cy="0" r="0.8" />
          </pattern>
          <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="7" stdDeviation="8" floodColor="#000" floodOpacity="0.25" />
          </filter>
          <linearGradient id="card-surface" x2="0" y2="1">
            <stop stopColor="var(--card-top)" />
            <stop offset="1" stopColor="var(--card-bottom)" />
          </linearGradient>
        </defs>
        {camera.zoom >= OUTLINE_ZOOM && <rect x={visibleRect.x} y={visibleRect.y} width={visibleRect.width} height={visibleRect.height} fill="url(#grid-dots)" />}
        <Scene
          circuit={circuit}
          previewPositions={previewPositions}
          selection={selectionSet}
          visible={stableCullRect}
          outline={camera.zoom < OUTLINE_ZOOM}
          pendingTerminal={pendingWire}
          pendingColor={pendingWire && tool.type === "wire" ? tool.color : undefined}
          entityStatus={props.entityStatus}
          describeSignal={props.describeSignal}
          resolveIcon={props.resolveEntityIcon}
        />
        {tool.type === "wire" && pendingWire && pendingEntity && pointerWorld && <PendingWire color={tool.color} from={pinPoint(pendingEntity.position, pendingWire.side, tool.color)} to={pointerWorld} />}
        {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} />}
      </svg>

      <div className="canvas-heading">
        <span className="eyebrow">Circuit workspace</span>
        <span className="counts">
          {circuit.entities.length} {circuit.entities.length === 1 ? "entity" : "entities"}
          <span className="meta-dot" />
          {circuit.wires.length} {circuit.wires.length === 1 ? "connection" : "connections"}
        </span>
      </div>

      {circuit.entities.length === 0 && (
        <div className="canvas-empty">
          <Icon name="grid" size={38} />
          <h2>Start with a signal.</h2>
          <p>Choose a component on the left, then click here to place it.</p>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} label="Canvas actions" items={menuItems} onClose={closeMenu} />}

      <div className="canvas-footer">
        <span className="canvas-hint" aria-live="polite">
          {hintFor(tool, pendingWire, editable)}
        </span>
        <div className="zoom-controls" role="group" aria-label="Zoom">
          <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <Icon name="minus" size={16} />
          </button>
          <output aria-label="Zoom level">{Math.round(camera.zoom * 100)}%</output>
          <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
            <Icon name="plus" size={16} />
          </button>
          <span className="divider" />
          <button type="button" title="Fit circuit" aria-label="Fit circuit" onClick={fit}>
            <Icon name="fit" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function PendingWire({ color, from, to }: { readonly color: string; readonly from: Point; readonly to: Point }) {
  return <path className={`wire-preview ${color}`} d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} />;
}
