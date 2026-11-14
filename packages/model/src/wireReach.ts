// Wire reach: how far apart two entities may be for a circuit wire between them.
//
// The reach is per entity, as in the game: an electric pole has its own (7.5 tiles for a small one, 32 for a big one), and so has
// every other prototype the game gives another reach than its standard 9 (`hasOwnWireReach`: the power switch with 10 and the
// agricultural tower with 30). Every other entity has the reach of the project, a setting (9 tiles in the game; docs/factorio-audit.md 5.4, 13.3). A
// wire may span the smaller reach of its two ends. The project's reach may be set to "unlimited"; an end that is unlimited does
// not limit, so a wire between two such ends is never too long and one to a pole has the pole's reach.
//
// The measure is the game's rule, verified against Factorio 2.1.24 by fixture F-24 (tests/fixtures/game/F-24-wire-reach.json,
// recorded by tools/game-probe/wire-reach.mjs). Between two electric poles it is the straight line from center to center.
// For every other pair, a pole and something else included, it is the straight line between the nearest points of the two
// selection boxes (`selectionBox`: the tiles an entity covers for most prototypes, a little less or more for some), that is per
// axis the gap between the boxes in tiles (0 where they overlap on that axis) and then the hypotenuse. A wire connects when that
// distance is at most the reach. A box turns with its entity; the connector that is wired and the collision box do not matter.

import { facingOf, selectionBox, type PlacedShape, type TileBox } from "./footprint.ts";
import { STANDARD_WIRE_REACH } from "./entityTable.ts";
import { gamePrototype, prototypeData, prototypeOf, PROTOTYPES, withArticle, type EntityShape, type PrototypeName } from "./prototypes.ts";

/** The reach of a project that does not set one: the game's. */
export const DEFAULT_WIRE_REACH = STANDARD_WIRE_REACH;

/** The reach that stands for "no limit". */
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

/** The distance between two boxes in tiles: 0 when they touch or overlap, the gap along one axis when they overlap on the other. */
export function boxDistance(a: TileBox, b: TileBox): number {
  // Along one axis: how far b starts behind the end of a, or a behind the end of b; 0 when the two spans meet.
  const gap = (aFrom: number, aSize: number, bFrom: number, bSize: number): number => Math.max(0, bFrom - (aFrom + aSize), aFrom - (bFrom + bSize));
  return Math.hypot(gap(a.x, a.width, b.x, b.width), gap(a.y, a.height, b.y, b.height));
}

/** What the distance of a wire is measured between: the centers of two electric poles, the selection boxes of every other pair. */
export type WireMeasure = "centers" | "boxes";

export function wireMeasure(a: EntityShape, b: EntityShape): WireMeasure {
  return [a, b].every((end) => gamePrototype(end).type === "electric-pole") ? "centers" : "boxes";
}

/**
 * What a wire between two entities has to span, in tiles (`wireMeasure`). Undefined when one of them has no `tile`: its place on
 * the board is only derived. A wire from an entity to itself spans 0.
 */
export function wireDistance(a: PlacedShape, b: PlacedShape): number | undefined {
  const from = a.placement?.tile;
  const to = b.placement?.tile;
  if (!from || !to) return undefined;
  return wireMeasure(a, b) === "centers" ? Math.hypot(to.x - from.x, to.y - from.y) : boxDistance(selectionBox(a, facingOf(a), from), selectionBox(b, facingOf(b), to));
}

/** How far a wire may span and whose limit that is. */
export interface WireReach {
  /** In tiles; `UNLIMITED_WIRE_REACH` when neither end limits. */
  readonly reach: number;
  /** The prototype of the end whose own reach it is, or "project" for the setting. */
  readonly of: PrototypeName | "project";
}

/**
 * The reach of a wire between two entities: the smaller of the reaches of its two ends, where an end without a reach of its own
 * has `projectReach` and an unlimited one does not limit. Of two equal reaches the one an entity has by itself is named.
 */
export function wireReachBetween(a: EntityShape, b: EntityShape, projectReach: number): WireReach {
  const [first, second] = [a, b].map((end): WireReach => {
    const own = prototypeData(end).wireReach;
    return own === undefined ? { reach: projectReach, of: "project" } : { reach: own, of: prototypeOf(end) };
  }) as [WireReach, WireReach];
  if (second.reach === UNLIMITED_WIRE_REACH) return first;
  if (first.reach === UNLIMITED_WIRE_REACH || second.reach < first.reach) return second;
  return second.reach === first.reach && first.of === "project" ? second : first;
}

/** A wire between two entities measured against its reach. */
export interface WireSpan extends WireReach {
  /** `wireDistance`; undefined when an end has no `tile`. */
  readonly distance?: number;
  readonly measure: WireMeasure;
  /** Further apart than the reach. Exactly the reach is fine, and so is everything without a distance or with an unlimited reach. */
  readonly tooLong: boolean;
}

/** Distance, reach and verdict for a wire between two entities in a project whose wire reach is `projectReach`. */
export function wireSpan(a: PlacedShape, b: PlacedShape, projectReach: number): WireSpan {
  const limit = wireReachBetween(a, b, projectReach);
  const distance = wireDistance(a, b);
  return { ...limit, ...(distance !== undefined && { distance }), measure: wireMeasure(a, b), tooLong: exceeds(distance, limit.reach) };
}

function exceeds(distance: number | undefined, reach: number): boolean {
  return distance !== undefined && reach !== UNLIMITED_WIRE_REACH && distance > reach;
}

/**
 * A distance for display. A whole number of tiles, as every straight run is, has no decimal: "9". Everything else has one, and
 * more (up to three) where rounding would put it on the other side of the reach, so that 9.014 tiles are not shown as "9.0" next
 * to a reach of 9. So "9" is exactly nine tiles and "9.0" is not. An unlimited reach has no sides: one decimal.
 */
export function formatWireDistance(distance: number, reach: number): string {
  if (Number.isInteger(distance)) return String(distance);
  const sameSide = (text: string): boolean => exceeds(Number(text), reach) === exceeds(distance, reach);
  return [1, 2].map((digits) => distance.toFixed(digits)).find(sameSide) ?? distance.toFixed(3);
}

/** The word behind a distance: "1 tile apart", "9 tiles apart", "1.0 tiles apart". */
export function tileUnit(distance: number): string {
  return distance === 1 ? "tile" : "tiles";
}

/** A distance in a sentence, saying what it is where it is not the gap between the two entities: "9 tiles apart", "8 tiles apart from center to center". */
export function describeWireDistance(distance: number, reach: number, measure: WireMeasure): string {
  return `${formatWireDistance(distance, reach)} ${tileUnit(distance)} apart${measure === "centers" ? " from center to center" : ""}`;
}

/** The two ends of a wire in a sentence about their distance: "entities", and "poles" where two poles are measured from center to center. */
export function wireEndsNoun(measure: WireMeasure): string {
  return measure === "centers" ? "poles" : "entities";
}

/** A reach for display: the number, or "unlimited". */
export function formatWireReach(reach: number): string {
  return reach === UNLIMITED_WIRE_REACH ? "unlimited" : String(reach);
}

/** Whose reach it is, for a sentence: "the project", "a small electric pole". */
export function wireReachOwner(limit: WireReach): string {
  return limit.of === "project" ? "the project" : withArticle(PROTOTYPES[limit.of]?.label ?? limit.of);
}

/** The reach that applied and why, as a clause: "the wire reach of the project is 9", "the wire reach of a small electric pole is 7.5". */
export function describeWireReach(limit: WireReach): string {
  return `the wire reach of ${wireReachOwner(limit)} is ${formatWireReach(limit.reach)}`;
}
