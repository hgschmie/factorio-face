// The circuit canvas. It owns transient view state only (camera, gesture in progress, pending wire, context menu);
// every change to the circuit or the selection is emitted through a callback and comes back as new props.
import { canRotate, type Circuit, type EntityId, type EntityKind, type Point, type TerminalRef, type Wire, type WireColor } from "@face/model";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type Ref } from "react";
import type { RotationTurn } from "../entities/facing.ts";
import { KIND_INFO } from "../entities/kindInfo.ts";
import type { EntityIconResolver } from "../icons/EntityIcon.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { SignalDescriber } from "../inspector/SignalField.tsx";
import { isTextEntryTarget } from "../platform.ts";
import { shortcutFor, shortcutLabel, withShortcut } from "../shortcuts/shortcuts.ts";
import { DISPLAY_CAPABILITIES, DISPLAY_MODES, SELECT_TOOL, type DisplayMode, type EntityMove, type EntityStatus, type Tool } from "../workbench/controller.ts";
import { countLabel } from "../workbench/selectionText.ts";
import { TILE } from "./board.ts";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.tsx";
import { changedPositions, dragPositions, exceedsDragThreshold, placementPosition, snapPoint, worldDelta, type EntityPosition } from "./drag.ts";
import { EntityBubble } from "./EntityBubble.tsx";
import { expandRect, GRID, rectFromPoints, rectsIntersect, type Rect } from "./geometry.ts";
import { layoutFor } from "./layout.ts";
import { Scene } from "./Scene.tsx";
import { cameraFor, cullingRect, DEFAULT_CAMERA, fitCamera, panFrom, screenToWorld, viewOf, visibleWorldRect, wheelZoomFactor, worldToScreen, ZOOM_STEP, zoomAround, type Camera, type CanvasView, type Size } from "./viewport.ts";

export interface CanvasHandle {
  fit(): void;
  zoomBy(factor: number): void;
  resetZoom(): void;
  focus(): void;
  /** Where a paste puts the top-left corner of its group: the grid point under the pointer while that is over the canvas. */
  pasteCorner(): Point | undefined;
  /** Drops a wire that was started and not finished. False when there was none. */
  cancelPendingWire(): boolean;
}

export interface CanvasProps {
  readonly ref?: Ref<CanvasHandle>;
  readonly circuit: Circuit;
  readonly selection: readonly EntityId[];
  /** The selected wires, as `wireKey`s. */
  readonly wireSelection: readonly string[];
  readonly tool: Tool;
  /** The edit canvas or the blueprint board. The camera is kept per mode. */
  readonly displayMode: DisplayMode;
  /** When false the circuit is shown but cannot be changed (the source has errors). */
  readonly editable: boolean;
  readonly entityStatus?: ReadonlyMap<EntityId, EntityStatus>;
  /** Catalog icons and names for the signals in a card's status line. */
  readonly describeSignal?: SignalDescriber;
  readonly resolveEntityIcon?: EntityIconResolver;
  /** Views to start with, for example the ones in use before the canvas was unmounted. A display mode without one is fitted when it is first shown. */
  readonly initialViews?: CanvasViews;
  onViewChange?(view: CanvasView, displayMode: DisplayMode): void;
  /** The new selection: these entities and these wires (none when omitted). */
  onSelect(ids: readonly EntityId[], wires?: readonly string[]): void;
  onToolChange(tool: Tool): void;
  onDisplayModeChange(displayMode: DisplayMode): void;
  onPlaceEntity(kind: EntityKind, position: Point): void;
  onMoveEntities(moves: readonly EntityMove[]): void;
  /** A wire gesture was completed between the pins of two different terminals: connect them, or disconnect them if this wire exists. */
  onToggleWire(wire: Wire): void;
  onDeleteSelection(): void;
  /** Turns the selected entities a quarter turn; offered in the context menu of a card. */
  onRotate?(turn: RotationTurn): void;
  /** The clipboard actions of the context menu; an action the host cannot perform is absent and its item disabled. */
  onCopy?(): void;
  onCut?(): void;
  /** Paste with the top-left corner of the group at `corner`, the grid point at which the menu was opened. */
  onPaste?(corner: Point): void;
}

/** The view of each display mode that has been shown. */
export type CanvasViews = Readonly<Partial<Record<DisplayMode, CanvasView>>>;

type Gesture =
  | { readonly type: "pan"; readonly pointerId: number; readonly press: Point; readonly origin: Camera; readonly clearsSelection: boolean }
  | { readonly type: "drag"; readonly pointerId: number; readonly press: Point; readonly grabbedId: EntityId; readonly origins: readonly EntityPosition[]; readonly collapseTo: EntityId | null }
  | { readonly type: "marquee"; readonly pointerId: number; readonly press: Point; readonly startWorld: Point };

interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly on: "entity" | "wire" | "canvas";
  /** The grid point that was right-clicked: where Paste puts its group. */
  readonly corner: Point;
}

/** Margins and cell size of the culling rectangle, in world units. */
const CULL_MARGIN = 120;
const CULL_CELL = 400;
const FIT_PADDING = 70;
const DISPLAY_LABELS: Readonly<Record<DisplayMode, string>> = { edit: "Edit", blueprint: "Blueprint" };
/** Room kept for the context menu, so that it opens inside the canvas. */
const MENU_SIZE = { width: 250, height: 245 };

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

/** The wire under the pointer, as its `wireKey`. */
function wireAt(target: Element): string | null {
  return target.closest("[data-wire]")?.getAttribute("data-wire") ?? null;
}

function toggled<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((other) => other !== item) : [...list, item];
}

function hintFor(tool: Tool, pending: TerminalRef | null, editable: boolean, displayMode: DisplayMode): string {
  if (displayMode === "blueprint") return "Blueprint view: entities on the tiles they take in the game; dashed ones have no tile yet. Click to select, drag empty space to pan, Shift-drag to select an area. Entities cannot be moved here yet.";
  if (!editable) return "Fix the source to edit the circuit. Drag to pan, scroll to zoom.";
  if (tool.type === "place") return `Click the canvas (or press Enter on it) to place a ${KIND_INFO[tool.kind].label.toLowerCase()}. Esc cancels.`;
  if (tool.type === "wire" && pending) return `Click a second ${tool.color} pin to connect. An existing ${tool.color} wire between the two is removed. Esc cancels.`;
  if (tool.type === "wire") return `Click a ${tool.color} pin of an input or output to start a ${tool.color} wire.`;
  return "Drag to arrange, click a wire to select it. Drag empty space to pan, Shift-drag to select an area, scroll to zoom.";
}

export function Canvas(props: CanvasProps) {
  const { circuit, selection, wireSelection, tool, displayMode, editable, onSelect, onToolChange, onViewChange } = props;
  const capabilities = DISPLAY_CAPABILITIES[displayMode];
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  /** The view of each display mode. The one on show is restored once the canvas has a size; a resize keeps its center in place. */
  const viewsRef = useRef<CanvasViews>(props.initialViews ?? {});
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
      const view = viewOf(next, sizeRef.current);
      viewsRef.current = { ...viewsRef.current, [displayMode]: view };
      onViewChange?.(view, displayMode);
    },
    [onViewChange, displayMode],
  );

  const entityById = useMemo(() => new Map(circuit.entities.map((entity) => [entity.id, entity])), [circuit.entities]);
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const wireSelectionSet = useMemo(() => new Set(wireSelection), [wireSelection]);
  const selectedCount = selection.length + wireSelection.length;
  const selectedEntities = useMemo(() => circuit.entities.filter((entity) => selectionSet.has(entity.id)), [circuit.entities, selectionSet]);

  // Everything below that needs to know where an entity or a pin is asks the layout of the display mode.
  const layout = useMemo(() => layoutFor(displayMode, circuit.entities, previewPositions), [displayMode, circuit.entities, previewPositions]);

  const fit = useCallback(() => {
    const bounds = layout.bounds();
    setCamera(fitCamera(bounds && expandRect(bounds, layout.fitMargin), size, FIT_PADDING));
  }, [layout, size, setCamera]);

  const zoomBy = useCallback((factor: number) => setCamera(zoomAround(cameraRef.current, { x: size.width / 2, y: size.height / 2 }, factor)), [size, setCamera]);

  useImperativeHandle(
    props.ref,
    () => ({
      fit,
      zoomBy,
      resetZoom: () => zoomBy(1 / cameraRef.current.zoom),
      focus: () => svgRef.current?.focus(),
      pasteCorner: () => (pointerRef.current && svgRef.current ? snapPoint(worldPoint(pointerRef.current), layout.step) : undefined),
      cancelPendingWire: () => {
        setPendingWire(null);
        return pendingWire !== null;
      },
    }),
    [fit, zoomBy, pendingWire, layout.step],
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

  const showView = (): void => {
    const view = viewsRef.current[displayMode];
    if (view) setCamera(cameraFor(view, size));
    else fit();
  };

  // First layout: restore the view that was handed in, or show the whole circuit. Later resizes keep the center.
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0 || (size.width === sizeRef.current.width && size.height === sizeRef.current.height)) return;
    sizeRef.current = size;
    showView();
    // Runs for size changes only; `fit` and `setCamera` are read at that moment.
  }, [size]);

  // The other display mode: its own view, fitted the first time, and nothing of a gesture or a menu that belonged to the old one.
  const shownModeRef = useRef(displayMode);
  useLayoutEffect(() => {
    if (shownModeRef.current === displayMode) return;
    shownModeRef.current = displayMode;
    gestureRef.current = null;
    setPreviewPositions(null);
    setMarquee(null);
    setPanning(false);
    setMenu(null);
    if (sizeRef.current.width > 0 && sizeRef.current.height > 0) showView();
  }, [displayMode]);

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
    // From here on the select tool. Cards and their pins lie above the wires, so a wire is only found where neither is in the way.
    const wire = entityId ? null : wireAt(target);
    if (wire) {
      if (event.shiftKey) return onSelect(selection, toggled(wireSelection, wire));
      onSelect([], [wire]);
      // A drag that starts on a wire still moves the view.
      return beginGesture(event, pan);
    }
    if (!entityId) {
      if (event.shiftKey) beginGesture(event, { type: "marquee", pointerId: event.pointerId, press, startWorld: worldPoint(event) });
      else beginGesture(event, { ...pan, clearsSelection: true });
      return;
    }
    if (event.shiftKey) {
      onSelect(toggled(selection, entityId), wireSelection);
      return;
    }
    const alreadySelected = selectionSet.has(entityId);
    if (!alreadySelected) onSelect([entityId]);
    if (!editable || !capabilities.move) {
      // Nothing can be dragged, so a click on one member of a multi-selection narrows the selection to it at once.
      if (alreadySelected && selectedCount > 1) onSelect([entityId]);
      return;
    }
    const dragged = alreadySelected ? selectedEntities : circuit.entities.filter((entity) => entity.id === entityId);
    beginGesture(event, {
      type: "drag",
      pointerId: event.pointerId,
      press,
      grabbedId: entityId,
      origins: dragged.map((entity) => {
        const { x, y } = layout.rect(entity);
        return { id: entity.id, position: { x, y } };
      }),
      // A plain click on one member of a multi-selection narrows the selection to it.
      collapseTo: alreadySelected && selectedCount > 1 ? entityId : null,
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
      const positions = dragPositions(gesture.origins, gesture.grabbedId, worldDelta(gesture.press, current, cameraRef.current.zoom), layout.step);
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
        const positions = dragPositions(gesture.origins, gesture.grabbedId, worldDelta(gesture.press, release, cameraRef.current.zoom), layout.step);
        const moves = changedPositions(gesture.origins, positions);
        if (moves.length > 0) props.onMoveEntities(moves);
      } else if (gesture.collapseTo) {
        onSelect([gesture.collapseTo]);
      }
    } else if (gesture.type === "marquee") {
      const area = rectFromPoints(gesture.startWorld, worldPoint(event));
      const inside = circuit.entities.filter((entity) => rectsIntersect(layout.rect(entity), area)).map((entity) => entity.id);
      onSelect([...new Set([...selection, ...inside])], wireSelection);
    } else if (!moved && gesture.clearsSelection && selectedCount > 0) {
      onSelect([]);
    }
  };

  const onContextMenu = (event: MouseEvent<SVGSVGElement>): void => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const entityId = entityIdAt(event.target as Element);
    const wire = entityId || tool.type !== "select" ? null : wireAt(event.target as Element);
    if (entityId && !selectionSet.has(entityId)) onSelect([entityId]);
    if (wire && !wireSelectionSet.has(wire)) onSelect([], [wire]);
    if (!entityId && !wire && selectedCount > 0) onSelect([]);
    const bounds = container.getBoundingClientRect();
    // Keep the menu inside the canvas.
    const x = Math.min(event.clientX - bounds.left, bounds.width - MENU_SIZE.width);
    setMenu({ x, y: Math.min(event.clientY - bounds.top, bounds.height - MENU_SIZE.height), on: entityId ? "entity" : wire ? "wire" : "canvas", corner: snapPoint(worldPoint(event), layout.step) });
  };

  const deleteSelection = (): void => {
    if (!editable || selectedCount === 0) return;
    props.onDeleteSelection();
    svgRef.current?.focus();
  };

  // The keys that need the focus inside the canvas. The others of the shortcut table are handled by the workbench.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isTextEntryTarget(event.target)) return;
    const shortcut = shortcutFor(event.nativeEvent)?.id;
    if (shortcut === "edit.delete") {
      if (selectedCount === 0) return;
      event.preventDefault();
      deleteSelection();
    } else if (shortcut === "tool.cancel") {
      if (pendingWire) setPendingWire(null);
      else if (tool.type !== "select") onToolChange(SELECT_TOOL);
      else if (selectedCount > 0) onSelect([]);
    } else if (shortcut === "tool.placeAtCenter" && tool.type === "place" && editable && event.target === svgRef.current) {
      // Keyboard placement: the new card goes to the middle of the view.
      event.preventDefault();
      props.onPlaceEntity(tool.kind, placementPosition(screenToWorld(cameraRef.current, { x: size.width / 2, y: size.height / 2 })));
    } else if (event.key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSelect(circuit.entities.map((entity) => entity.id));
    }
  };

  const closeMenu = useCallback(() => setMenu(null), []);
  // The focus goes back to the canvas first: the clipboard then sees the same state as with the keys, and they work afterwards.
  const clipboardAction = (action: (() => void) | undefined) => (): void => {
    svgRef.current?.focus();
    action?.();
  };
  const selectAll = (): void => onSelect(circuit.entities.map((entity) => entity.id));
  // A right click on empty canvas clears the selection, so the actions on it are only offered on a card or a wire. Cut, copy
  // and the rotations take the selected entities; a selection of wires alone has none of them. Paste needs no selection: its
  // group goes to the point the menu was opened at, wherever the pointer is by the time the item is clicked.
  const paste = (): void => {
    if (menu) props.onPaste?.(menu.corner);
  };
  const pasteItem: ContextMenuItem = { id: "paste", label: "Paste", icon: "paste", shortcut: shortcutLabel("edit.paste"), disabled: !editable || !capabilities.paste || !props.onPaste, onSelect: clipboardAction(paste) };
  const clipboardItems: ContextMenuItem[] = [
    { id: "cut", label: "Cut", icon: "cut", shortcut: shortcutLabel("edit.cut"), disabled: !editable || !props.onCut, onSelect: clipboardAction(props.onCut) },
    { id: "copy", label: "Copy", icon: "copy", shortcut: shortcutLabel("edit.copy"), disabled: !props.onCopy, onSelect: clipboardAction(props.onCopy) },
    pasteItem,
  ];
  // Each selected entity turns in place. The focus goes back to the canvas, so that the keys work afterwards.
  const rotate = (turn: RotationTurn) => (): void => {
    svgRef.current?.focus();
    props.onRotate?.(turn);
  };
  // A lamp does not rotate; with nothing else selected the two items are off. Only looked at while the menu is open.
  const canTurn = menu !== null && circuit.entities.some((entity) => selectionSet.has(entity.id) && canRotate(entity.kind));
  const noRotation = !editable || !capabilities.rotate || !props.onRotate || !canTurn;
  const rotateItems: ContextMenuItem[] = [
    { id: "rotate", label: "Rotate clockwise", icon: "rotateRight", shortcut: shortcutLabel("edit.rotate"), disabled: noRotation, separatorBefore: true, onSelect: rotate("clockwise") },
    { id: "rotate-back", label: "Rotate counter-clockwise", icon: "rotateLeft", shortcut: shortcutLabel("edit.rotateBack"), disabled: noRotation, onSelect: rotate("counterclockwise") },
  ];
  const withEntities = selection.length > 0;
  const menuItems: ContextMenuItem[] = menu && menu.on !== "canvas"
    ? [
        ...(withEntities ? [...clipboardItems, ...rotateItems] : []),
        { id: "delete", label: selectedCount > 1 ? `Delete ${countLabel(selection.length, wireSelection.length)}` : "Delete", icon: "trash", shortcut: shortcutLabel("edit.delete"), danger: true, disabled: !editable, separatorBefore: withEntities, onSelect: deleteSelection },
      ]
    : [
        pasteItem,
        { id: "select-all", label: "Select all", icon: "selectAll", shortcut: shortcutLabel("edit.selectAll"), disabled: circuit.entities.length === 0, separatorBefore: true, onSelect: selectAll },
        { id: "fit", label: "Fit to content", icon: "fit", shortcut: shortcutLabel("view.fit"), onSelect: fit },
      ];

  const visibleRect = visibleWorldRect(camera, size);
  const cullRect = cullingRect(camera, size, CULL_MARGIN, CULL_CELL);
  const stableCullRect = useMemo<Rect>(() => ({ x: cullRect.x, y: cullRect.y, width: cullRect.width, height: cullRect.height }), [cullRect.x, cullRect.y, cullRect.width, cullRect.height]);

  const pendingEntity = pendingWire ? entityById.get(pendingWire.entity) : undefined;
  const outline = camera.zoom < layout.detailZoom;
  // The bubble: the full card of the one selected entity, where the board itself only has room for the compact form.
  const bubbleEntity = layout.mode === "blueprint" && selection.length === 1 && wireSelection.length === 0 ? entityById.get(selection[0]!) : undefined;
  const bubbleRect = bubbleEntity && layout.rect(bubbleEntity);

  return (
    <div
      ref={containerRef}
      className={`canvas display-${displayMode} tool-${tool.type}${tool.type === "wire" ? ` wire-${tool.color}` : ""}${capabilities.move ? "" : " fixed-entities"}${panning ? " panning" : ""}`}
      onKeyDown={onKeyDown}
      data-zoom={camera.zoom}
      data-display={displayMode}
    >
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
          {/* Two by two tiles: the tile at (0, 0) and the one diagonally below it are the lighter ones. */}
          <pattern id="board-tiles" width={2 * TILE} height={2 * TILE} patternUnits="userSpaceOnUse">
            <rect className="board-tile dark" width={2 * TILE} height={2 * TILE} />
            <rect className="board-tile light" width={TILE} height={TILE} />
            <rect className="board-tile light" x={TILE} y={TILE} width={TILE} height={TILE} />
          </pattern>
          <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="7" stdDeviation="8" floodColor="#000" floodOpacity="0.25" />
          </filter>
          <linearGradient id="card-surface" x2="0" y2="1">
            <stop stopColor="var(--card-top)" />
            <stop offset="1" stopColor="var(--card-bottom)" />
          </linearGradient>
        </defs>
        {(layout.mode === "blueprint" || !outline) && (
          <rect className="canvas-ground" x={visibleRect.x} y={visibleRect.y} width={visibleRect.width} height={visibleRect.height} fill={layout.mode === "blueprint" ? "url(#board-tiles)" : "url(#grid-dots)"} />
        )}
        <Scene
          circuit={circuit}
          layout={layout}
          selection={selectionSet}
          wireSelection={wireSelectionSet}
          visible={stableCullRect}
          outline={outline}
          pendingTerminal={pendingWire}
          pendingColor={pendingWire && tool.type === "wire" ? tool.color : undefined}
          entityStatus={props.entityStatus}
          describeSignal={props.describeSignal}
          resolveIcon={props.resolveEntityIcon}
        />
        {tool.type === "wire" && pendingWire && pendingEntity && pointerWorld && <PendingWire color={tool.color} from={layout.pin(pendingEntity, pendingWire.side, tool.color)} to={pointerWorld} />}
        {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} />}
      </svg>

      <div className="canvas-heading">
        <span className="canvas-title">
          <span className="eyebrow">Circuit workspace</span>
          <span className="display-switch" role="group" aria-label="Display mode">
            {DISPLAY_MODES.map((candidate) => (
              <button key={candidate} type="button" aria-pressed={displayMode === candidate} title={withShortcut(`${DISPLAY_LABELS[candidate]} view`, "view.display")} onClick={() => props.onDisplayModeChange(candidate)}>
                {DISPLAY_LABELS[candidate]}
              </button>
            ))}
          </span>
        </span>
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

      {bubbleEntity && bubbleRect && (
        <EntityBubble
          entity={bubbleEntity}
          anchor={{ ...worldToScreen(camera, bubbleRect), width: bubbleRect.width * camera.zoom, height: bubbleRect.height * camera.zoom }}
          view={size}
          status={props.entityStatus?.get(bubbleEntity.id)}
          describeSignal={props.describeSignal}
          resolveIcon={props.resolveEntityIcon}
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} label="Canvas actions" items={menuItems} onClose={closeMenu} />}

      <div className="canvas-footer">
        <span className="canvas-hint" aria-live="polite">
          {hintFor(tool, pendingWire, editable, displayMode)}
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
