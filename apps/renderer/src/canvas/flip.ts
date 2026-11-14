// Mirroring a selection, as the game flips a blueprint: the entities swap sides within the bounds of the selection and each
// one that can turn faces the mirrored way. On the edit canvas the cards are mirrored, on the board the footprints of the
// entities that have a `tile`. The result is what the language command `arrangeEntities` writes. Pure.
import type { EntityArrangement } from "@face/language";
import { canRotate, facingOf, tileCenter, tileOrigin, tileSize, type Entity } from "@face/model";
import { flipped, type FlipAxis } from "../entities/facing.ts";
import { firstObstacle, type BlockedTurn } from "./board.ts";

/** The entities a flip moves: all of them on the edit canvas, on the board those that stand on tiles of their own. */
function mirrored(entities: readonly Entity[], tiles: boolean): readonly Entity[] {
  return tiles ? entities.filter((entity) => entity.placement?.tile !== undefined) : entities;
}

/**
 * True when a flip of `entities` can do something: one of them can turn, or there are at least two to swap sides. A single
 * lamp or pole has nothing to flip, and neither have entities of the board that all have no `tile` and do not turn.
 */
export function canFlip(entities: readonly Entity[], tiles: boolean): boolean {
  return entities.some(canRotate) || mirrored(entities, tiles).length > 1;
}

/** The mirrored direction of an entity that can turn; nothing for one that cannot. */
function turned(entity: Entity, axis: FlipAxis): Pick<EntityArrangement, "direction"> {
  return canRotate(entity) ? { direction: flipped(facingOf(entity), axis) } : {};
}

/** Mirrors within the bounds of `spans`: where the low end of a span goes, given its high end. The bounds keep their place. */
function mirror(spans: readonly { readonly low: number; readonly high: number }[]): (high: number) => number {
  const start = Math.min(...spans.map((span) => span.low));
  const end = Math.max(...spans.map((span) => span.high));
  return (high) => start + end - high;
}

/**
 * The edit canvas: every card goes to the mirrored place within the bounds of all of them (all cards have one size, so the
 * bounds of their top-left corners do), and every entity that can turn faces the mirrored way. `tile` is left alone: a
 * flipped direction keeps the tiles of a footprint.
 */
export function flipCards(entities: readonly Entity[], axis: FlipAxis): EntityArrangement[] {
  const coordinate = axis === "horizontal" ? "x" : "y";
  const at = mirror(entities.map((entity) => ({ low: entity.position[coordinate], high: entity.position[coordinate] })));
  return entities.map((entity) => {
    return { id: entity.id, ...turned(entity, axis), position: { ...entity.position, [coordinate]: at(entity.position[coordinate]) } };
  });
}

/**
 * The board: the entities with a `tile` swap sides within the bounds of their footprints (as the board shows them: an entity
 * whose `tile` is off the grid counts with the nearest footprint on it), so every footprint stays on the grid. Every entity
 * that can turn faces the mirrored way; a flipped direction covers the same tiles. An entity without a `tile` has no tiles
 * to mirror: it is turned and stays at its derived place. `at` is left alone, as by every edit of the board.
 */
export function flipTiles(entities: readonly Entity[], axis: FlipAxis): EntityArrangement[] {
  const [coordinate, length] = axis === "horizontal" ? (["x", "width"] as const) : (["y", "height"] as const);
  const footprints = new Map(mirrored(entities, true).map((entity) => [entity.id, { origin: tileOrigin(entity, facingOf(entity), entity.placement!.tile!), size: tileSize(entity, facingOf(entity)) }]));
  const at = mirror([...footprints.values()].map(({ origin, size }) => ({ low: origin[coordinate], high: origin[coordinate] + size[length] })));
  return entities.map((entity) => {
    const footprint = footprints.get(entity.id);
    if (!footprint) return { id: entity.id, ...turned(entity, axis) };
    const { origin, size } = footprint;
    // A flipped direction covers the same tiles, so the center is the one of the footprint as it lies.
    return { id: entity.id, ...turned(entity, axis), tile: tileCenter(entity, facingOf(entity), { ...origin, [coordinate]: at(origin[coordinate] + size[length]) }) };
  });
}

/**
 * The rule of the board for a flip: it is refused, for the whole selection, when a mirrored entity would stand on a tile of an
 * entity that has a `tile` and is not flipped with it. `flips` is the result of `flipTiles`; the first such pair is returned.
 */
export function blockedFlip(entities: readonly Entity[], flips: readonly EntityArrangement[]): BlockedTurn | undefined {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const origins = new Map(
    flips.flatMap(({ id, tile }) => {
      const entity = byId.get(id);
      return entity && tile ? [[id, tileOrigin(entity, facingOf(entity), tile)] as const] : [];
    }),
  );
  return firstObstacle(entities, origins);
}
