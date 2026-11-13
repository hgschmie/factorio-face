// Tile footprints of the entities and the geometry between the game's center position (`placement.tile`) and whole tiles.
// Sizes and rotation per prototype: `prototypes.ts`. The direction of a combinator: docs/factorio-audit.md 3.1. Position rules: 5.4.
//
// A tile is named by the integer coordinates of its top-left corner; x grows to the east, y to the south. A center is "on the
// grid" when the footprint it describes covers whole tiles: along an axis on which the footprint has an odd number of tiles the
// coordinate ends in .5, along one with an even number it is whole. So both coordinates of a 1x1 entity end in .5, both of a 2x2
// entity are whole, and a 1x2 combinator facing north or south has x ending in .5 and a whole y, facing east or west the reverse.

import { TERMINALS, type Direction, type Entity, type EntityId, type Placement, type Point } from "./circuit.ts";
import { prototypeData, type EntityShape } from "./prototypes.ts";

/** The direction an entity without a `facing` clause faces. */
export const DEFAULT_FACING: Direction = "east";

export interface TileSize {
  readonly width: number;
  readonly height: number;
}

/** A rectangle in tile coordinates: its top-left corner and its size. */
export interface TileBox extends Point, TileSize {}

/**
 * The part of the footprint that carries the input and the part that carries the output. Only an entity with an input and an
 * output connector that is longer than one tile has two halves; for every other one both are its whole footprint.
 */
export interface TileHalves {
  readonly input: TileBox;
  readonly output: TileBox;
}

/** An entity as far as its footprint goes. Every `Entity` is one. */
export type PlacedShape = EntityShape & { readonly placement?: Placement };
export type PlacedEntity = PlacedShape & Pick<Entity, "id">;

/** A tile on which more than one entity stands. */
export interface TileOverlap {
  readonly tile: Point;
  /** At least two, in the order given. */
  readonly entities: readonly EntityId[];
}

export function canRotate(entity: EntityShape): boolean {
  return prototypeData(entity).rotatable;
}

/** The direction the output points to: what the declaration says, east without a clause, and always east for an entity that cannot rotate. */
export function facingOf(entity: PlacedShape): Direction {
  return canRotate(entity) ? (entity.placement?.direction ?? DEFAULT_FACING) : DEFAULT_FACING;
}

/** The tiles an entity covers when it faces `direction`. One that cannot rotate covers the same in every direction. */
export function tileSize(entity: EntityShape, direction: Direction = DEFAULT_FACING): TileSize {
  const { width, height, rotatable } = prototypeData(entity);
  return rotatable && (direction === "east" || direction === "west") ? { width: height, height: width } : { width, height };
}

/** The center of an entity whose top-left tile is `tile`. */
export function tileCenter(entity: EntityShape, direction: Direction, tile: Point): Point {
  const { width, height } = tileSize(entity, direction);
  return { x: tile.x + width / 2, y: tile.y + height / 2 };
}

/** The top-left tile of an entity; for a center that is off the grid, of the nearest footprint on it (a tie goes east and south). */
export function tileOrigin(entity: EntityShape, direction: Direction, center: Point): Point {
  const { width, height } = tileSize(entity, direction);
  // `|| 0`: Math.round gives -0 for -0.5.
  return { x: Math.round(center.x - width / 2) || 0, y: Math.round(center.y - height / 2) || 0 };
}

/** The footprint of an entity around `center` as it is: a center that is off the grid is not moved onto it. */
export function footprintBox(entity: EntityShape, direction: Direction, center: Point): TileBox {
  const { width, height } = tileSize(entity, direction);
  return { x: center.x - width / 2, y: center.y - height / 2, width, height };
}

/** True when `center` is on the grid for the entity and direction. */
export function isTileCenter(entity: EntityShape, direction: Direction, center: Point): boolean {
  const { width, height } = tileSize(entity, direction);
  return Number.isInteger(center.x - width / 2) && Number.isInteger(center.y - height / 2);
}

/** The tiles an entity covers, row by row from the top-left one. */
export function occupiedTiles(entity: EntityShape, direction: Direction, center: Point): Point[] {
  const origin = tileOrigin(entity, direction, center);
  const { width, height } = tileSize(entity, direction);
  const tiles: Point[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles.push({ x: origin.x + x, y: origin.y + y });
  return tiles;
}

/**
 * Which part of the footprint carries the input and which the output. An entity with both connectors (`TERMINALS`) that is
 * longer than one tile along its facing is cut in the middle of that length: the direction points from the input half to the
 * output half. Every other entity has no halves: both are the whole footprint, as for a 1x1 entity or a 2x2 pole.
 */
export function tileHalves(entity: EntityShape, direction: Direction, center: Point): TileHalves {
  const origin = tileOrigin(entity, direction, center);
  const { width, height } = tileSize(entity, direction);
  const whole = { ...origin, width, height };
  const along = direction === "east" || direction === "west" ? width : height;
  if (TERMINALS[entity.kind].length < 2 || along < 2) return { input: whole, output: whole };
  const half = along / 2;
  const [first, last] = along === width ? [{ ...whole, width: half }, { ...whole, x: origin.x + half, width: half }] : [{ ...whole, height: half }, { ...whole, y: origin.y + half, height: half }];
  return direction === "east" || direction === "south" ? { input: first, output: last } : { input: last, output: first };
}

/**
 * The center after an entity standing at `center` and facing `from` is turned to face `to`: the top-left tile of the footprint
 * stays where it is. A 1x2 entity on the tiles (0, 0) and (1, 0) so stands on (0, 0) and (0, 1) after a quarter turn either way,
 * and a half turn keeps both tiles and swaps the input and the output half, as flipping a combinator does in the game. A center
 * that is off the grid is first moved to the nearest one on it. An entity that covers a square, or that cannot rotate, keeps its
 * center as it is.
 */
export function rotateTile(entity: EntityShape, center: Point, from: Direction, to: Direction): Point {
  const { width, height, rotatable } = prototypeData(entity);
  if (!rotatable || width === height || from === to) return center;
  return tileCenter(entity, to, tileOrigin(entity, from, center));
}

/** The tiles shared by several of the entities that have a `tile`, in the order they are first met. Linear in the number of entities. */
export function findTileOverlaps(entities: readonly PlacedEntity[]): TileOverlap[] {
  const byTile = new Map<string, { tile: Point; entities: EntityId[] }>();
  for (const entity of entities) {
    const center = entity.placement?.tile;
    if (!center) continue;
    for (const tile of occupiedTiles(entity, facingOf(entity), center)) {
      const key = `${tile.x},${tile.y}`;
      const entry = byTile.get(key);
      if (entry) entry.entities.push(entity.id);
      else byTile.set(key, { tile, entities: [entity.id] });
    }
  }
  return [...byTile.values()].filter((entry) => entry.entities.length > 1);
}
