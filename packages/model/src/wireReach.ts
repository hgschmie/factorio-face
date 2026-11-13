// Wire reach: how far apart two entities may be for a circuit wire between them, a project setting. Game data: 9 tiles for every
// entity in scope (docs/factorio-audit.md 5.4).
//
// The measure is the game's rule, verified against Factorio 2.1.24 by fixture F-24 (tests/fixtures/game/F-24-wire-reach.json,
// recorded by tools/game-probe/wire-reach.mjs): the straight line between the nearest points of the two tile footprints, that is
// per axis the gap between the footprints in tiles (0 where they overlap on that axis) and then the hypotenuse. A wire connects
// when that distance is at most the reach. Neither the facing beyond the footprint, nor the connector, nor the collision box matter.
//
// The game takes the smaller of the two entities' reaches. One value for the project is enough while every entity of the editor
// has the same reach; power poles (7.5 for a small one) would need a reach per kind.

import type { Entity } from "./circuit.ts";
import { facingOf, footprintBox, type TileBox } from "./footprint.ts";

/** The reach of a project that does not set one. */
export const DEFAULT_WIRE_REACH = 9;

/** The reach that stands for "no limit": no wire is ever flagged. */
export const UNLIMITED_WIRE_REACH = 0;

/** The values a project may set, in tiles; fractions are allowed and the minimum means unlimited. */
export const WIRE_REACH_RANGE = { min: UNLIMITED_WIRE_REACH, max: 64 } as const;

export function isWireReach(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= WIRE_REACH_RANGE.min && value <= WIRE_REACH_RANGE.max;
}

/** A number brought into the range: below it becomes the minimum (unlimited), above it the maximum. For values a person typed or a file holds. */
export function clampWireReach(value: number): number {
  return Math.min(Math.max(value, WIRE_REACH_RANGE.min), WIRE_REACH_RANGE.max);
}

/** The distance between two footprints in tiles: 0 when they touch or overlap, the gap along one axis when they overlap on the other. */
export function footprintDistance(a: TileBox, b: TileBox): number {
  // Along one axis: how far b starts behind the end of a, or a behind the end of b; 0 when the two spans meet.
  const gap = (aFrom: number, aSize: number, bFrom: number, bSize: number): number => Math.max(0, bFrom - (aFrom + aSize), aFrom - (bFrom + bSize));
  return Math.hypot(gap(a.x, a.width, b.x, b.width), gap(a.y, a.height, b.y, b.height));
}

/**
 * What a wire between two entities has to span, in tiles: the distance between their footprints. Undefined when one of them has
 * no `tile`: its place on the board is only derived. A wire from an entity to itself spans 0.
 */
export function wireDistance(a: Pick<Entity, "kind" | "placement">, b: Pick<Entity, "kind" | "placement">): number | undefined {
  const from = a.placement?.tile;
  const to = b.placement?.tile;
  return from && to ? footprintDistance(footprintBox(a.kind, facingOf(a), from), footprintBox(b.kind, facingOf(b), to)) : undefined;
}

/** True for a wire whose entities are further apart than the reach. Exactly the reach is fine, and so is everything without a distance or with an unlimited reach. */
export function exceedsWireReach(distance: number | undefined, reach: number): boolean {
  return distance !== undefined && reach !== UNLIMITED_WIRE_REACH && distance > reach;
}

/**
 * A distance for display: one decimal, and more (up to three) where rounding would put it on the other side of the reach, so
 * that 9.014 tiles are not shown as "9.0" next to a reach of 9. An unlimited reach has no sides: one decimal.
 */
export function formatWireDistance(distance: number, reach: number): string {
  const sameSide = (text: string): boolean => exceedsWireReach(Number(text), reach) === exceedsWireReach(distance, reach);
  return [1, 2].map((digits) => distance.toFixed(digits)).find(sameSide) ?? distance.toFixed(3);
}

/** A reach for display: the number, or "unlimited". */
export function formatWireReach(reach: number): string {
  return reach === UNLIMITED_WIRE_REACH ? "unlimited" : String(reach);
}
