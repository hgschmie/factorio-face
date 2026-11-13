// The blueprint board in canvas units: the tile size, where every entity stands, the places of entities without a `tile`,
// the rules of editing on the board (moving, turning, placing), and where the connection pins sit on a footprint. Built on
// the footprints of `@face/model`. Pure.
import {
  canRotate, DEFAULT_FACING, facingOf, findTileOverlaps, isTileCenter, occupiedTiles, rotateTile, tileCenter, tileHalves, tileOrigin, tileSize, type Direction, type Entity, type EntityId, type EntityShape, type Point,
  type TerminalSide, type TileSize, type WireColor,
} from "@face/model";
import { snapPoint } from "./drag.ts";
import { CARD, DIRECTION_VECTOR, GRID, PIN_SPACING, pinHeading } from "./geometry.ts";

/** Edge of one tile in canvas units. */
export const TILE = 80;

/**
 * Canvas units of the edit layout that become one tile for an entity without a `tile`: half a card width, in both directions,
 * so that a card is as wide as a 2x1 entity and the derived picture keeps the proportions of the edit layout.
 */
export const EDIT_UNITS_PER_TILE = CARD.width / 2;

/**
 * Connection pins on a footprint: distance of their center from the end of the tile, their radius, and how far the green pin
 * of a point without a direction sits below the red one.
 */
export const BOARD_PIN = { inset: 12, radius: 5, drop: 10 } as const;

export interface BoardPlacement {
  /** The top-left tile of the footprint. */
  readonly origin: Point;
  readonly size: TileSize;
  readonly facing: Direction;
  /** False for an entity without a `tile`: it stands at a derived place that is not in the source. */
  readonly placed: boolean;
  /** A `tile` that is off the grid (the entity then stands on the nearest footprint) or that shares a tile with another entity. */
  readonly conflict: boolean;
  /** Part of a move in progress: it stands where the move would put it. */
  readonly moving: boolean;
  /** Part of a move in progress that cannot end here: it stands on a tile of an entity that is not moved (`blockedMoves`). */
  readonly blocked: boolean;
}

/** A turn that is refused: `entity` would come to stand on a tile of `obstacle`. */
export interface BlockedTurn {
  readonly entity: EntityId;
  readonly obstacle: EntityId;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Offsets of the tiles at Chebyshev distance `radius`, nearest in a straight line first, then the upper, then the left one. */
const RINGS: Point[][] = [];

function ring(radius: number): readonly Point[] {
  let offsets = RINGS[radius];
  if (offsets) return offsets;
  offsets = [];
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) if (Math.max(Math.abs(x), Math.abs(y)) === radius) offsets.push({ x, y });
  offsets.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y) || a.y - b.y || a.x - b.x);
  RINGS[radius] = offsets;
  return offsets;
}

/**
 * The top-left tile nearest to `wanted` at which a footprint of `size` covers free tiles only. There always is one: `taken` is
 * finite, and `wanted` comes from a card position, a 32-bit integer in the language, so every offset gives another tile.
 */
function nearestFree(wanted: Point, size: TileSize, taken: ReadonlySet<string>): Point {
  for (let radius = 0; ; radius++) {
    for (const offset of ring(radius)) {
      const origin = { x: wanted.x + offset.x, y: wanted.y + offset.y };
      if (isFree(origin, size, taken)) return origin;
    }
  }
}

/** True when a footprint of `size` with its top-left tile at `origin` covers no tile of `taken`. */
function isFree(origin: Point, size: TileSize, taken: ReadonlySet<string>): boolean {
  for (let dy = 0; dy < size.height; dy++) for (let dx = 0; dx < size.width; dx++) if (taken.has(tileKey(origin.x + dx, origin.y + dy))) return false;
  return true;
}

/** The tiles of the entities that have a `tile` (of the nearest footprint when it is off the grid), without the entities in `except`. */
function takenTiles(entities: readonly Entity[], except?: ReadonlyMap<EntityId, unknown>): Set<string> {
  const taken = new Set<string>();
  for (const entity of entities) {
    const tile = entity.placement?.tile;
    if (!tile || except?.has(entity.id)) continue;
    for (const covered of occupiedTiles(entity, facingOf(entity), tile)) taken.add(tileKey(covered.x, covered.y));
  }
  return taken;
}

/**
 * Where the entities without a `tile` stand on the board: per entity the center a `tile` clause would hold, on the grid for
 * its kind and facing. The top-left corner of the card is scaled down to a tile (`EDIT_UNITS_PER_TILE`), which keeps the
 * shape of the edit layout. An entity whose footprint would then touch a tile that is taken moves to the nearest free place:
 * the nearest ring of tiles around the wanted one, in it the nearest tile in a straight line, then the upper, then the left
 * one. Taken are the tiles of all entities that have a `tile` and of the entities without one that come earlier in the
 * circuit, so the result is the same for the same circuit and no two derived entities overlap each other or a placed one.
 */
export function derivedTiles(entities: readonly Entity[]): Map<EntityId, Point> {
  const taken = new Set<string>();
  const take = (entity: Entity, facing: Direction, center: Point): void => {
    for (const tile of occupiedTiles(entity, facing, center)) taken.add(tileKey(tile.x, tile.y));
  };
  for (const entity of entities) if (entity.placement?.tile) take(entity, facingOf(entity), entity.placement.tile);
  const derived = new Map<EntityId, Point>();
  for (const entity of entities) {
    if (entity.placement?.tile) continue;
    const facing = facingOf(entity);
    // `|| 0`: Math.round gives -0 for small negative values.
    const wanted = { x: Math.round(entity.position.x / EDIT_UNITS_PER_TILE) || 0, y: Math.round(entity.position.y / EDIT_UNITS_PER_TILE) || 0 };
    const center = tileCenter(entity, facing, nearestFree(wanted, tileSize(entity, facing), taken));
    take(entity, facing, center);
    derived.set(entity.id, center);
  }
  return derived;
}

/**
 * Every entity on the board. One with a `tile` stands where it says (on the nearest footprint when the center is off the
 * grid) and is in conflict when it is off the grid or shares a tile; one without stands where `derivedTiles` puts it.
 * `moved` is a move in progress: the top-left tile of the entities being moved. They stand there as if it were their `tile`,
 * so the entities without one give way to them and whatever they stand on is in conflict with them.
 */
export function arrangeBoard(entities: readonly Entity[], moved?: ReadonlyMap<EntityId, Point> | null): Map<EntityId, BoardPlacement> {
  const standing = moved?.size ? entities.map((entity) => withOrigin(entity, moved.get(entity.id))) : entities;
  const derived = derivedTiles(standing);
  const overlapping = new Set(findTileOverlaps(standing).flatMap((overlap) => overlap.entities));
  const blocked = moved?.size ? blockedMoves(entities, moved) : undefined;
  const placements = new Map<EntityId, BoardPlacement>();
  entities.forEach((entity, index) => {
    const facing = facingOf(entity);
    const tile = standing[index]!.placement?.tile;
    const origin = tileOrigin(entity, facing, tile ?? derived.get(entity.id)!);
    const conflict = tile !== undefined && (!isTileCenter(entity, facing, tile) || overlapping.has(entity.id));
    placements.set(entity.id, { origin, size: tileSize(entity, facing), facing, placed: entity.placement?.tile !== undefined, conflict, moving: moved?.has(entity.id) ?? false, blocked: blocked?.has(entity.id) ?? false });
  });
  return placements;
}

/** The entity with the `tile` of a footprint whose top-left tile is `origin`; the entity itself without one. */
export function withOrigin(entity: Entity, origin: Point | undefined): Entity {
  return origin ? { ...entity, placement: { ...entity.placement, tile: tileCenter(entity, facingOf(entity), origin) } } : entity;
}

// The rules of editing on the board. They all rest on one: only an entity with a `tile` takes tiles. An entity without one
// stands at a derived place, gives way to the others and is never in the way of a move, a turn or a new entity.

/**
 * Moving (a drag, the arrow keys): `origins` are the top-left tiles the moved entities would get. The move is blocked when one
 * of them would cover a tile of an entity that has a `tile` and is not moved; the result names those of the moved entities.
 * A blocked move changes nothing. What the moved entities do to each other is not looked at: a group moves as it is.
 */
export function blockedMoves(entities: readonly Entity[], origins: ReadonlyMap<EntityId, Point>): Set<EntityId> {
  const taken = takenTiles(entities, origins);
  const blocked = new Set<EntityId>();
  for (const entity of entities) {
    const origin = origins.get(entity.id);
    if (origin && !isFree(origin, tileSize(entity, facingOf(entity)), taken)) blocked.add(entity.id);
  }
  return blocked;
}

/**
 * Turning: `facings` are the directions the turned entities would get. A turned entity with a `tile` keeps its top-left tile
 * (`rotateTile`), so a 2x1 entity comes to cover one new tile with a quarter turn (a square one covers the same tiles). The turn is blocked, for all of them, when
 * one would newly cover a tile on which another entity with a `tile` stands after the turn; the first such pair is returned.
 * Tiles an entity covers already do not count, so one that stands in a conflict can still be turned out of it.
 */
export function blockedTurn(entities: readonly Entity[], facings: ReadonlyMap<EntityId, Direction>): BlockedTurn | undefined {
  const turned = (entity: Entity): Direction => (canRotate(entity) ? (facings.get(entity.id) ?? facingOf(entity)) : facingOf(entity));
  const after = (entity: Entity, tile: Point): Point[] => occupiedTiles(entity, turned(entity), rotateTile(entity, tile, facingOf(entity), turned(entity)));
  const standing = new Map<string, EntityId[]>();
  for (const entity of entities) {
    const tile = entity.placement?.tile;
    if (!tile) continue;
    for (const covered of after(entity, tile)) {
      const key = tileKey(covered.x, covered.y);
      standing.set(key, [...(standing.get(key) ?? []), entity.id]);
    }
  }
  for (const entity of entities) {
    const tile = entity.placement?.tile;
    if (!tile || !facings.has(entity.id)) continue;
    const before = new Set(occupiedTiles(entity, facingOf(entity), tile).map((covered) => tileKey(covered.x, covered.y)));
    for (const covered of after(entity, tile)) {
      const key = tileKey(covered.x, covered.y);
      const obstacle = before.has(key) ? undefined : standing.get(key)?.find((id) => id !== entity.id);
      if (obstacle !== undefined) return { entity: entity.id, obstacle };
    }
  }
  return undefined;
}

/**
 * Changing what an entity is (another prototype of its kind, which may cover other tiles): `changed` is the entity as it would
 * be, with the `tile` it would have. The change is blocked when it would newly cover a tile of another entity that has a
 * `tile`; that entity is returned. Tiles the entity covers already do not count, as for a turn.
 */
export function blockedReshape(entities: readonly Entity[], changed: Entity): EntityId | undefined {
  const tile = changed.placement?.tile;
  const current = entities.find((entity) => entity.id === changed.id);
  if (!tile || !current) return undefined;
  const before = takenTiles([current]);
  const taken = new Map<string, EntityId>();
  for (const entity of entities) {
    const center = entity.placement?.tile;
    if (!center || entity.id === changed.id) continue;
    for (const covered of occupiedTiles(entity, facingOf(entity), center)) taken.set(tileKey(covered.x, covered.y), entity.id);
  }
  for (const covered of occupiedTiles(changed, facingOf(changed), tile)) {
    const key = tileKey(covered.x, covered.y);
    if (!before.has(key) && taken.has(key)) return taken.get(key);
  }
  return undefined;
}

/** Placing a new entity with the pointer: the top-left tile of a footprint that has `point` (canvas units) in its middle. A new entity faces east unless its place tool was turned. */
export function footprintOriginAt(point: Point, entity: EntityShape, facing: Direction = DEFAULT_FACING): Point {
  const size = tileSize(entity, facing);
  // `|| 0`: Math.round gives -0 for small negative values.
  return { x: Math.round(point.x / TILE - size.width / 2) || 0, y: Math.round(point.y / TILE - size.height / 2) || 0 };
}

/** True when a new entity can stand with its top-left tile at `origin`: it would cover no tile of an entity that has a `tile`. */
export function canStandAt(entities: readonly Entity[], entity: EntityShape, origin: Point, facing: Direction = DEFAULT_FACING): boolean {
  return isFree(origin, tileSize(entity, facing), takenTiles(entities));
}

/** Placing a new entity with the keyboard: the top-left tile nearest to `wanted` at which it can stand, in the order `derivedTiles` looks for a free place. */
export function freeOriginNear(entities: readonly Entity[], entity: EntityShape, wanted: Point, facing: Direction = DEFAULT_FACING): Point {
  return nearestFree(wanted, tileSize(entity, facing), takenTiles(entities));
}

/** The edit position for a new entity placed on the board: the one from which `derivedTiles` would give it the top-left tile `origin`, on the grid of the edit canvas. */
export function editPositionOf(origin: Point): Point {
  return snapPoint({ x: origin.x * EDIT_UNITS_PER_TILE, y: origin.y * EDIT_UNITS_PER_TILE }, GRID);
}

/**
 * The end of the footprint that carries the pins of a terminal, as the direction from its middle: where the entity faces for
 * an output, the other way for an input. A connection point without a direction (`io`: a pole, which does not turn either) is at
 * the top, where the wires hang on a pole in the game.
 */
export function boardPinHeading(side: TerminalSide, facing: Direction): Direction {
  return side === "io" ? "north" : pinHeading(side, facing);
}

/**
 * Center of a connection pin relative to the top-left corner of the footprint, in canvas units. The input pins are on the
 * input half and the output pins on the output half (`tileHalves`), each at the outer end of it; red is on the left seen along
 * the facing, as on the cards (facing east: red above green). An entity without halves has its pins at the end of the whole
 * footprint its one terminal points to: a lamp and a speaker on the left. The one point of an entity without input and output
 * (`io`) sits in the middle of the top end, on one tile as on 2x2: red left of green and green a little lower, so that the two
 * wires between poles in a row, as between poles in a column, run beside each other and not on one line.
 */
export function boardPinOffset(entity: EntityShape, facing: Direction, side: TerminalSide, color: WireColor): Point {
  if (side === "io") {
    const middle = (tileSize(entity, facing).width * TILE) / 2;
    return color === "red" ? { x: middle - PIN_SPACING / 2, y: BOARD_PIN.inset } : { x: middle + PIN_SPACING / 2, y: BOARD_PIN.inset + BOARD_PIN.drop };
  }
  const halves = tileHalves(entity, facing, tileCenter(entity, facing, { x: 0, y: 0 }));
  const half = side === "out" ? halves.output : halves.input;
  const heading = DIRECTION_VECTOR[pinHeading(side, facing)];
  const forward = DIRECTION_VECTOR[facing];
  const middle = { x: (half.x + half.width / 2) * TILE, y: (half.y + half.height / 2) * TILE };
  // From the middle of the half to its end along the heading, less the inset.
  const reach = ((heading.x !== 0 ? half.width : half.height) * TILE) / 2 - BOARD_PIN.inset;
  const across = (color === "red" ? 1 : -1) * (PIN_SPACING / 2);
  // The left of (x, y) is (y, -x) where y grows downwards.
  return { x: middle.x + heading.x * reach + forward.y * across, y: middle.y + heading.y * reach - forward.x * across };
}
