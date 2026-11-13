// Where an entity and its pins are in a display mode. The canvas asks a layout instead of assuming cards: hit testing, the
// marquee, culling, Fit, the pending wire and the wires all go through it. Two implementations: the edit canvas (cards at
// `entity.position`, routed wires) and the blueprint board (footprints on tiles, straight wires). Pure.
import { facingOf, wireDistance, type Entity, type EntityId, type Point, type TerminalSide, type Wire, type WireColor } from "@face/model";
import type { DisplayMode } from "../workbench/controller.ts";
import { arrangeBoard, boardPinOffset, TILE, withOrigin, type BoardPlacement } from "./board.ts";
import { boundsOfPoints, cardRect, DIRECTION_VECTOR, entitiesBounds, GRID, pinPoint, type Rect } from "./geometry.ts";
import { FEEDBACK_CLEARANCE, routeBounds, routePath, routeWire } from "./wireRouting.ts";

export interface WireRoute {
  /** SVG path data. */
  readonly path: string;
  readonly bounds: Rect;
}

export interface CanvasLayout {
  readonly mode: DisplayMode;
  /** Positions snap to multiples of this, in canvas units. */
  readonly step: number;
  /** Space Fit keeps around `bounds`, in canvas units: wires may pass beside an entity. */
  readonly fitMargin: number;
  /** Below this zoom entities are drawn without their text. */
  readonly detailZoom: number;
  /** The rectangle an entity takes: what a marquee has to touch and what is culled. Its corner is the position a drag moves. */
  rect(entity: Entity): Rect;
  /** Center of the connection pin of one wire color on one terminal: where wires of that color end. */
  pin(entity: Entity, side: TerminalSide, color: WireColor): Point;
  /** The line of a wire between two entities of the circuit (the same one for a feedback wire). */
  route(wire: Wire, a: Entity, b: Entity): WireRoute;
  /** The rectangle around all entities, without `fitMargin`; undefined for an empty circuit. */
  bounds(): Rect | undefined;
}

export interface EditLayout extends CanvasLayout {
  readonly mode: "edit";
}

export interface BlueprintLayout extends CanvasLayout {
  readonly mode: "blueprint";
  /** Tiles, facing and whether the entity has a place of its own. */
  placement(entity: Entity): BoardPlacement;
  /**
   * How far apart two entities are for a wire, in tiles (`wireDistance`), as they stand: an entity of a move in progress counts
   * with the tile the move would give it, also one that has none yet. Undefined while one of them has no tile.
   */
  wireDistance(a: Entity, b: Entity): number | undefined;
}

export type Layout = EditLayout | BlueprintLayout;

/** Positions that stand in for the ones of the document while a drag is in progress: top-left corners in canvas units. */
export type PreviewPositions = ReadonlyMap<EntityId, Point> | null | undefined;

/** Below this zoom the text of a card is illegible. */
const EDIT_DETAIL_ZOOM = 0.3;
/** The text on a tile is smaller than on a card. */
const BLUEPRINT_DETAIL_ZOOM = 0.5;
/**
 * How far the wire from the output of an entity to its own input bends away from the straight line between the two pins, in
 * canvas units: just past the long edge of the entity, so that it runs around the icon and the text instead of through them.
 */
export const SELF_WIRE_SAG = 32;

/** The edit canvas: cards of one size at `entity.position`, pins on the edges the facing gives them, wires routed around the cards. */
export function editLayout(entities: readonly Entity[], preview?: PreviewPositions): EditLayout {
  const positionOf = (entity: Entity): Point => preview?.get(entity.id) ?? entity.position;
  return {
    mode: "edit",
    step: GRID,
    // Feedback loops pass 40 units beside their card, on the side its facing decides.
    fitMargin: FEEDBACK_CLEARANCE.green,
    detailZoom: EDIT_DETAIL_ZOOM,
    rect: (entity) => cardRect(positionOf(entity)),
    pin: (entity, side, color) => pinPoint(positionOf(entity), side, color, facingOf(entity)),
    route: (wire, a, b) => {
      const route = routeWire(wire.color, { position: positionOf(a), side: wire.a.side, facing: facingOf(a) }, { position: positionOf(b), side: wire.b.side, facing: facingOf(b) }, a.id === b.id);
      return { path: routePath(route), bounds: routeBounds(route) };
    },
    bounds: () => entitiesBounds(entities),
  };
}

/**
 * The blueprint board: every entity on the tiles `arrangeBoard` gives it, pins inside the footprint, wires as straight lines
 * from pin to pin. A wire from the output of an entity to its own input is an arc over the long edge on the side of its color, so
 * that it does not run through the middle of the entity. A preview position is rounded to whole tiles.
 */
export function blueprintLayout(entities: readonly Entity[], preview?: PreviewPositions): BlueprintLayout {
  const moved = preview && new Map([...preview].map(([id, position]) => [id, { x: Math.round(position.x / TILE) || 0, y: Math.round(position.y / TILE) || 0 }]));
  const placements = arrangeBoard(entities, moved);
  const standing = (entity: Entity): Entity => withOrigin(entity, moved?.get(entity.id));
  // An entity the layout was not built for is placed on its own; the canvas never asks for one.
  const placement = (entity: Entity): BoardPlacement => placements.get(entity.id) ?? arrangeBoard([entity]).get(entity.id)!;
  const rect = (entity: Entity): Rect => {
    const { origin, size } = placement(entity);
    return { x: origin.x * TILE, y: origin.y * TILE, width: size.width * TILE, height: size.height * TILE };
  };
  const pin = (entity: Entity, side: TerminalSide, color: WireColor): Point => {
    const { origin, facing } = placement(entity);
    const offset = boardPinOffset(entity.kind, facing, side, color);
    return { x: origin.x * TILE + offset.x, y: origin.y * TILE + offset.y };
  };
  return {
    mode: "blueprint",
    step: TILE,
    fitMargin: TILE / 2,
    detailZoom: BLUEPRINT_DETAIL_ZOOM,
    placement,
    wireDistance: (a, b) => wireDistance(standing(a), standing(b)),
    rect,
    pin,
    route: (wire, a, b) => {
      const from = pin(a, wire.a.side, wire.color);
      const to = pin(b, wire.b.side, wire.color);
      if (a.id !== b.id) return { path: `M ${from.x} ${from.y} L ${to.x} ${to.y}`, bounds: boundsOfPoints([from, to]) };
      // Both pins are on the same side of the middle line: red on the left seen along the facing, green on the right. A
      // quadratic curve comes half the way to its control point, hence twice the sag.
      const forward = DIRECTION_VECTOR[placement(a).facing];
      const bend = (wire.color === "red" ? 2 : -2) * SELF_WIRE_SAG;
      const control = { x: (from.x + to.x) / 2 + forward.y * bend, y: (from.y + to.y) / 2 - forward.x * bend };
      return { path: `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`, bounds: boundsOfPoints([from, control, to]) };
    },
    bounds: () => {
      if (entities.length === 0) return undefined;
      const rects = entities.map(rect);
      return boundsOfPoints(rects.flatMap((area) => [area, { x: area.x + area.width, y: area.y + area.height }]));
    },
  };
}

/** The layout of a display mode. */
export function layoutFor(mode: DisplayMode, entities: readonly Entity[], preview?: PreviewPositions): Layout {
  return mode === "blueprint" ? blueprintLayout(entities, preview) : editLayout(entities, preview);
}
