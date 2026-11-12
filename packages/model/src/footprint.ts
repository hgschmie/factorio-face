// Tile footprints of the entities and the geometry between the game's center position (`placement.tile`) and whole tiles.
// Sizes, rotation and the direction of a combinator: docs/factorio-audit.md 3.1. Position rules: 5.4.
//
// A tile is named by the integer coordinates of its top-left corner; x grows to the east, y to the south. A center is "on the
// grid" when the footprint it describes covers whole tiles: both coordinates of a 1x1 entity end in .5, a 2x1 entity facing
// north or south has x ending in .5 and a whole y, facing east or west a whole x and y ending in .5.

import type { Direction, Entity, EntityId, EntityKind, Point } from "./circuit.ts";

/** The direction an entity without a `facing` clause faces. */
export const DEFAULT_FACING: Direction = "east";

export interface Footprint {
  /** Tiles along the facing direction; across it every entity is one tile wide. */
  readonly length: 1 | 2;
  readonly rotatable: boolean;
}

export const FOOTPRINTS: Readonly<Record<EntityKind, Footprint>> = {
  constant: { length: 1, rotatable: true },
  arithmetic: { length: 2, rotatable: true },
  decider: { length: 2, rotatable: true },
  selector: { length: 2, rotatable: true },
  lamp: { length: 1, rotatable: false },
};

export interface TileSize {
  readonly width: number;
  readonly height: number;
}

/** Input and output half of an entity; both are the same tile for a 1x1 entity. */
export interface TileHalves {
  readonly input: Point;
  readonly output: Point;
}

export type PlacedEntity = Pick<Entity, "id" | "kind" | "placement">;

/** A tile on which more than one entity stands. */
export interface TileOverlap {
  readonly tile: Point;
  /** At least two, in the order given. */
  readonly entities: readonly EntityId[];
}

const VECTOR: Readonly<Record<Direction, Point>> = { north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 } };

export function canRotate(kind: EntityKind): boolean {
  return FOOTPRINTS[kind].rotatable;
}

/** The direction the output points to: what the declaration says, east without a clause, and always east for a kind that cannot rotate. */
export function facingOf(entity: Pick<Entity, "kind" | "placement">): Direction {
  return canRotate(entity.kind) ? (entity.placement?.direction ?? DEFAULT_FACING) : DEFAULT_FACING;
}

export function tileSize(kind: EntityKind, direction: Direction = DEFAULT_FACING): TileSize {
  const { length } = FOOTPRINTS[kind];
  return direction === "north" || direction === "south" ? { width: 1, height: length } : { width: length, height: 1 };
}

/** The center of an entity whose top-left tile is `tile`. */
export function tileCenter(kind: EntityKind, direction: Direction, tile: Point): Point {
  const { width, height } = tileSize(kind, direction);
  return { x: tile.x + width / 2, y: tile.y + height / 2 };
}

/** The top-left tile of an entity; for a center that is off the grid, of the nearest footprint on it (a tie goes east and south). */
export function tileOrigin(kind: EntityKind, direction: Direction, center: Point): Point {
  const { width, height } = tileSize(kind, direction);
  // `|| 0`: Math.round gives -0 for -0.5.
  return { x: Math.round(center.x - width / 2) || 0, y: Math.round(center.y - height / 2) || 0 };
}

/** True when `center` is on the grid for the kind and direction. */
export function isTileCenter(kind: EntityKind, direction: Direction, center: Point): boolean {
  const { width, height } = tileSize(kind, direction);
  return Number.isInteger(center.x - width / 2) && Number.isInteger(center.y - height / 2);
}

/** The tiles an entity covers, from the top-left one to the east or south. */
export function occupiedTiles(kind: EntityKind, direction: Direction, center: Point): Point[] {
  const origin = tileOrigin(kind, direction, center);
  const { width, height } = tileSize(kind, direction);
  const tiles: Point[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles.push({ x: origin.x + x, y: origin.y + y });
  return tiles;
}

/** Which tile carries the input and which the output: the direction points from the input half to the output half. */
export function tileHalves(kind: EntityKind, direction: Direction, center: Point): TileHalves {
  const tiles = occupiedTiles(kind, direction, center);
  const [first, last] = [tiles[0]!, tiles[tiles.length - 1]!];
  return direction === "east" || direction === "south" ? { input: first, output: last } : { input: last, output: first };
}

/**
 * The center after an entity standing at `center` and facing `from` is turned to face `to`: the tile of the input half stays
 * where it is and the output half swings around it. A half turn therefore moves a 2x1 entity by one tile, as two quarter
 * turns do. A center that is off the grid is first moved to the nearest one on it; a 1x1 entity keeps its center as it is.
 */
export function rotateTile(kind: EntityKind, center: Point, from: Direction, to: Direction): Point {
  if (FOOTPRINTS[kind].length === 1 || from === to) return center;
  const { input } = tileHalves(kind, from, center);
  return { x: input.x + 0.5 + VECTOR[to].x / 2, y: input.y + 0.5 + VECTOR[to].y / 2 };
}

/** The tiles shared by several of the entities that have a `tile`, in the order they are first met. Linear in the number of entities. */
export function findTileOverlaps(entities: readonly PlacedEntity[]): TileOverlap[] {
  const byTile = new Map<string, { tile: Point; entities: EntityId[] }>();
  for (const entity of entities) {
    const center = entity.placement?.tile;
    if (!center) continue;
    for (const tile of occupiedTiles(entity.kind, facingOf(entity), center)) {
      const key = `${tile.x},${tile.y}`;
      const entry = byTile.get(key);
      if (entry) entry.entities.push(entity.id);
      else byTile.set(key, { tile, entities: [entity.id] });
    }
  }
  return [...byTile.values()].filter((entry) => entry.entities.length > 1);
}
