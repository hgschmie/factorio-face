// The blueprint board in canvas units: the tile size, where every entity stands, the places of entities without a `tile`,
// and where the connection pins sit on a footprint. Built on the footprints of `@face/model`. Pure.
import {
  facingOf, findTileOverlaps, isTileCenter, occupiedTiles, tileCenter, tileHalves, tileOrigin, tileSize, type Direction, type Entity, type EntityId, type EntityKind, type Point, type TerminalSide, type TileSize,
  type WireColor,
} from "@face/model";
import { CARD, DIRECTION_VECTOR, PIN_SPACING, pinHeading } from "./geometry.ts";

/** Edge of one tile in canvas units. */
export const TILE = 80;

/**
 * Canvas units of the edit layout that become one tile for an entity without a `tile`: half a card width, in both directions,
 * so that a card is as wide as a 2x1 entity and the derived picture keeps the proportions of the edit layout.
 */
export const EDIT_UNITS_PER_TILE = CARD.width / 2;

/** Connection pins on a footprint: distance of their center from the end of the tile, and their radius. */
export const BOARD_PIN = { inset: 12, radius: 5 } as const;

export interface BoardPlacement {
  /** The top-left tile of the footprint. */
  readonly origin: Point;
  readonly size: TileSize;
  readonly facing: Direction;
  /** False for an entity without a `tile`: it stands at a derived place that is not in the source. */
  readonly placed: boolean;
  /** A `tile` that is off the grid (the entity then stands on the nearest footprint) or that shares a tile with another entity. */
  readonly conflict: boolean;
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
  const fits = (x: number, y: number): boolean => {
    for (let dy = 0; dy < size.height; dy++) for (let dx = 0; dx < size.width; dx++) if (taken.has(tileKey(x + dx, y + dy))) return false;
    return true;
  };
  for (let radius = 0; ; radius++) {
    for (const offset of ring(radius)) if (fits(wanted.x + offset.x, wanted.y + offset.y)) return { x: wanted.x + offset.x, y: wanted.y + offset.y };
  }
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
  const take = (kind: EntityKind, facing: Direction, center: Point): void => {
    for (const tile of occupiedTiles(kind, facing, center)) taken.add(tileKey(tile.x, tile.y));
  };
  for (const entity of entities) if (entity.placement?.tile) take(entity.kind, facingOf(entity), entity.placement.tile);
  const derived = new Map<EntityId, Point>();
  for (const entity of entities) {
    if (entity.placement?.tile) continue;
    const facing = facingOf(entity);
    // `|| 0`: Math.round gives -0 for small negative values.
    const wanted = { x: Math.round(entity.position.x / EDIT_UNITS_PER_TILE) || 0, y: Math.round(entity.position.y / EDIT_UNITS_PER_TILE) || 0 };
    const center = tileCenter(entity.kind, facing, nearestFree(wanted, tileSize(entity.kind, facing), taken));
    take(entity.kind, facing, center);
    derived.set(entity.id, center);
  }
  return derived;
}

/**
 * Every entity on the board. One with a `tile` stands where it says (on the nearest footprint when the center is off the
 * grid) and is in conflict when it is off the grid or shares a tile; one without stands where `derivedTiles` puts it.
 * `moved` overrides the top-left tile of single entities, for a drag in progress.
 */
export function arrangeBoard(entities: readonly Entity[], moved?: ReadonlyMap<EntityId, Point> | null): Map<EntityId, BoardPlacement> {
  const derived = derivedTiles(entities);
  const overlapping = new Set(findTileOverlaps(entities).flatMap((overlap) => overlap.entities));
  const placements = new Map<EntityId, BoardPlacement>();
  for (const entity of entities) {
    const facing = facingOf(entity);
    const tile = entity.placement?.tile;
    const origin = moved?.get(entity.id) ?? tileOrigin(entity.kind, facing, tile ?? derived.get(entity.id)!);
    const conflict = tile !== undefined && (!isTileCenter(entity.kind, facing, tile) || overlapping.has(entity.id));
    placements.set(entity.id, { origin, size: tileSize(entity.kind, facing), facing, placed: tile !== undefined, conflict });
  }
  return placements;
}

/**
 * Center of a connection pin relative to the top-left corner of the footprint, in canvas units. The input pins are on the
 * input half and the output pins on the output half, each at the outer end of its tile; red is on the left seen along the
 * facing, as on the cards (facing east: red above green).
 */
export function boardPinOffset(kind: EntityKind, facing: Direction, side: TerminalSide, color: WireColor): Point {
  const halves = tileHalves(kind, facing, tileCenter(kind, facing, { x: 0, y: 0 }));
  const half = side === "out" ? halves.output : halves.input;
  const heading = DIRECTION_VECTOR[pinHeading(side, facing)];
  const forward = DIRECTION_VECTOR[facing];
  const reach = TILE / 2 - BOARD_PIN.inset;
  const across = (color === "red" ? 1 : -1) * (PIN_SPACING / 2);
  // The left of (x, y) is (y, -x) where y grows downwards.
  return { x: (half.x + 0.5) * TILE + heading.x * reach + forward.y * across, y: (half.y + 0.5) * TILE + heading.y * reach - forward.x * across };
}
