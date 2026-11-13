// Wire reach: the longest a circuit wire may be in a blueprint, a project setting. Game data: 9 tiles for every entity in scope
// (docs/factorio-audit.md 5.4).
//
// The length of a wire is the editor's definition, not the game's verified rule: the straight line between the center positions
// (`placement.tile`) of the two entities it connects, as a blueprint stores them. Where the game measures from (the entity, its
// connection point, a bounding box) is not verified; that is why the reach is a setting.

import type { Entity } from "./circuit.ts";

/** The reach of a project that does not set one. */
export const DEFAULT_WIRE_REACH = 9;

/** The values a project may set, in tiles; fractions are allowed. */
export const WIRE_REACH_RANGE = { min: 1, max: 100 } as const;

export function isWireReach(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= WIRE_REACH_RANGE.min && value <= WIRE_REACH_RANGE.max;
}

/**
 * The length of a wire between two entities, in tiles. Undefined when one of them has no `tile`: its place on the board is
 * only derived, so the wire has no length. A wire from an entity to itself has the length 0.
 */
export function wireLength(a: Pick<Entity, "placement">, b: Pick<Entity, "placement">): number | undefined {
  const from = a.placement?.tile;
  const to = b.placement?.tile;
  return from && to ? Math.hypot(to.x - from.x, to.y - from.y) : undefined;
}

/** True for a wire that is longer than the reach. A wire exactly as long as the reach is fine, one without a length too. */
export function exceedsWireReach(length: number | undefined, reach: number): boolean {
  return length !== undefined && length > reach;
}

/**
 * A length for display: one decimal, and more (up to three) where rounding would put it on the other side of the reach, so
 * that a wire of 9.014 tiles is not shown as "9.0" next to a reach of 9.
 */
export function formatWireLength(length: number, reach: number): string {
  const sameSide = (text: string): boolean => Number(text) > reach === length > reach;
  return [1, 2].map((digits) => length.toFixed(digits)).find(sameSide) ?? length.toFixed(3);
}
