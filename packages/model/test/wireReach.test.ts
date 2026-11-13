import { describe, expect, it } from "vitest";
import {
  clampWireReach, DEFAULT_WIRE_REACH, exceedsWireReach, footprintBox, footprintDistance, formatWireDistance, formatWireReach, isWireReach, tileCenter, tileUnit, UNLIMITED_WIRE_REACH, WIRE_REACH_RANGE, wireDistance,
  type Direction, type Entity, type EntityKind, type Point, type TileBox,
} from "../src/index.ts";

type Placed = Pick<Entity, "kind" | "placement">;
/** An entity of `kind` whose top-left tile is `origin`. */
const standing = (kind: EntityKind, direction: Direction, origin: Point): Placed => ({ kind, placement: { tile: tileCenter(kind, direction, origin), direction } });
const constant = (x: number, y: number): Placed => standing("constant", "east", { x, y });
const unplaced: Placed = { kind: "decider", placement: { direction: "north" } };
const box = (x: number, y: number, width = 1, height = 1): TileBox => ({ x, y, width, height });

describe("wire reach", () => {
  it("defaults to the 9 tiles of the game data and allows 0 to 64, fractions included", () => {
    expect(DEFAULT_WIRE_REACH).toBe(9);
    expect(UNLIMITED_WIRE_REACH).toBe(0);
    expect(WIRE_REACH_RANGE).toEqual({ min: 0, max: 64 });
    expect([0, 0.5, 1, 7.5, 9, 64].every(isWireReach)).toBe(true);
    expect([-1, -0.01, 64.5, 64.01, 100, Number.NaN, Number.POSITIVE_INFINITY, "9", null, undefined].some(isWireReach)).toBe(false);
    expect([-1, -0.01, -0, 0, 0.5, 9, 64, 64.01, 100].map(clampWireReach)).toEqual([0, 0, 0, 0, 0.5, 9, 64, 64, 64]);
  });

  it("measures two footprints between their nearest points", () => {
    // Touching or overlapping: nothing to span.
    expect(footprintDistance(box(0, 0), box(1, 0))).toBe(0);
    expect(footprintDistance(box(0, 0), box(1, 1))).toBe(0);
    expect(footprintDistance(box(0, 0, 2, 2), box(1, 1, 3, 1))).toBe(0);
    expect(footprintDistance(box(0, 0), box(0, 0))).toBe(0);
    // Overlapping on one axis: the gap along the other.
    expect(footprintDistance(box(0, 0), box(10, 0))).toBe(9);
    expect(footprintDistance(box(0, 0, 1, 2), box(-5, 1))).toBe(4);
    expect(footprintDistance(box(0, 3, 4, 1), box(2, -6, 1, 2))).toBe(7);
    // Apart on both: corner to corner, the same from either side.
    expect(footprintDistance(box(0, 0), box(4, 5))).toBe(5);
    expect(footprintDistance(box(4, 5), box(0, 0))).toBe(5);
    expect(footprintDistance(box(0, 0, 2, 2), box(-4, -5, 1, 1))).toBe(5);
    expect(footprintDistance(box(0, 0), box(7, 7))).toBeCloseTo(8.485, 3);
    expect(footprintDistance(box(0, 0), box(8, 8))).toBeCloseTo(9.899, 3);
  });

  it("gives entities side by side the distance 0 and counts the empty tiles between two 1x1 entities", () => {
    expect(wireDistance(constant(0, 0), constant(1, 0))).toBe(0);
    expect(wireDistance(constant(0, 0), constant(0, -1))).toBe(0);
    expect(wireDistance(constant(0, 0), constant(1, 1))).toBe(0);
    expect(wireDistance(constant(0, 0), constant(5, 0))).toBe(4);
    expect(wireDistance(constant(0, 0), constant(4, 5))).toBe(5);
    expect(wireDistance(constant(4, 5), constant(0, 0))).toBe(5);
    expect(wireDistance(constant(-3, -1), standing("lamp", "east", { x: 1, y: -6 }))).toBe(5);
  });

  it("measures a 2x1 combinator from the nearer of its tiles, whichever way it faces", () => {
    const lamp = standing("lamp", "east", { x: 0, y: 0 });
    // Lying on the tiles (4, 0) and (5, 0): three empty tiles from the lamp, from either side.
    for (const direction of ["east", "west"] as const) {
      expect(wireDistance(lamp, standing("decider", direction, { x: 4, y: 0 }))).toBe(3);
      expect(wireDistance(standing("decider", direction, { x: -5, y: 0 }), lamp)).toBe(3);
    }
    // Upright on the tiles (4, 0) and (4, 1): the same three tiles, and the second tile is the nearer one from below.
    for (const direction of ["north", "south"] as const) {
      expect(wireDistance(lamp, standing("arithmetic", direction, { x: 4, y: 0 }))).toBe(3);
      expect(wireDistance(lamp, standing("arithmetic", direction, { x: 4, y: -1 }))).toBe(3);
      expect(wireDistance(standing("lamp", "east", { x: 4, y: 6 }), standing("arithmetic", direction, { x: 4, y: 0 }))).toBe(4);
      expect(wireDistance(standing("lamp", "east", { x: 0, y: 6 }), standing("arithmetic", direction, { x: 4, y: 0 }))).toBe(5);
    }
    // A lamp does not turn: its `facing` clause does not change its footprint.
    expect(wireDistance({ kind: "lamp", placement: { tile: { x: 0.5, y: 0.5 }, direction: "north" } }, constant(0, 3))).toBe(2);
    expect(wireDistance(standing("selector", "east", { x: 0, y: 0 }), standing("selector", "north", { x: 0, y: 3 }))).toBe(2);
  });

  it("measures an entity that is off the grid from where it stands, not from the nearest tiles", () => {
    expect(footprintBox("decider", "east", { x: 1, y: 0.5 })).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    expect(footprintBox("decider", "north", { x: 0.75, y: 1.25 })).toEqual({ x: 0.25, y: 0.25, width: 1, height: 2 });
    expect(wireDistance(constant(0, 0), { kind: "constant", placement: { tile: { x: 10.75, y: 0.5 } } })).toBe(9.25);
    expect(wireDistance(constant(0, 0), { kind: "decider", placement: { tile: { x: 10.5, y: 0.5 }, direction: "east" } })).toBe(8.5);
  });

  it("calls a wire too long only when the entities are further apart than the reach", () => {
    // Nine empty tiles in a row connect, ten do not.
    expect(wireDistance(constant(0, 0), constant(10, 0))).toBe(9);
    expect(exceedsWireReach(9, 9)).toBe(false);
    expect(exceedsWireReach(wireDistance(constant(0, 0), constant(11, 0)), 9)).toBe(true);
    // Six and six empty tiles connect (8.49), seven and seven do not (9.90).
    expect(exceedsWireReach(wireDistance(constant(0, 0), constant(7, 7)), 9)).toBe(false);
    expect(exceedsWireReach(wireDistance(constant(0, 0), constant(8, 8)), 9)).toBe(true);
    expect(exceedsWireReach(9.01, 9)).toBe(true);
    expect(exceedsWireReach(9.01, 9.5)).toBe(false);
    expect(exceedsWireReach(7.5, 7.5)).toBe(false);
    expect(exceedsWireReach(0, 0.5)).toBe(false);
  });

  it("flags nothing with the reach 0, which means unlimited", () => {
    expect(exceedsWireReach(0, UNLIMITED_WIRE_REACH)).toBe(false);
    expect(exceedsWireReach(1, UNLIMITED_WIRE_REACH)).toBe(false);
    expect(exceedsWireReach(wireDistance(constant(0, 0), constant(5000, -5000)), UNLIMITED_WIRE_REACH)).toBe(false);
    expect(formatWireReach(UNLIMITED_WIRE_REACH)).toBe("unlimited");
    expect(formatWireReach(9)).toBe("9");
    expect(formatWireReach(7.5)).toBe("7.5");
  });

  it("gives a wire with an end that is not placed no distance, and never flags it", () => {
    expect(wireDistance(constant(0, 0), unplaced)).toBeUndefined();
    expect(wireDistance(unplaced, constant(0, 0))).toBeUndefined();
    expect(wireDistance({ kind: "lamp" }, { kind: "lamp" })).toBeUndefined();
    expect(exceedsWireReach(undefined, 1)).toBe(false);
  });

  it("never flags a wire from an entity to itself", () => {
    const gate = standing("decider", "east", { x: 40, y: 40 });
    expect(wireDistance(gate, gate)).toBe(0);
    expect(exceedsWireReach(wireDistance(gate, gate), 0.5)).toBe(false);
    expect(wireDistance(unplaced, unplaced)).toBeUndefined();
  });

  it("shows a whole distance without a decimal, any other with one, and with more where that would hide on which side of the reach it is", () => {
    expect(formatWireDistance(0, 9)).toBe("0");
    expect(formatWireDistance(1, 9)).toBe("1");
    expect(formatWireDistance(4, 9)).toBe("4");
    expect(formatWireDistance(12.3693, 9)).toBe("12.4");
    expect(formatWireDistance(9, 9)).toBe("9");
    expect(formatWireDistance(Math.hypot(3, 4), 9)).toBe("5");
    expect(formatWireDistance(12, UNLIMITED_WIRE_REACH)).toBe("12");
    // Not exactly eight: the decimal stays.
    expect(formatWireDistance(8.02, 9)).toBe("8.0");
    expect([0, 1, 1.04, 2, 9].map(tileUnit)).toEqual(["tiles", "tile", "tiles", "tiles", "tiles"]);
    expect(formatWireDistance(Math.hypot(9, 0.5), 9)).toBe("9.01");
    expect(formatWireDistance(9.0004, 9)).toBe("9.000");
    expect(formatWireDistance(8.96, 9)).toBe("9.0");
    expect(formatWireDistance(8.96, 8.97)).toBe("8.96");
    // Unlimited: there is no side to be on.
    expect(formatWireDistance(0.04, UNLIMITED_WIRE_REACH)).toBe("0.0");
    expect(formatWireDistance(12.3693, UNLIMITED_WIRE_REACH)).toBe("12.4");
  });
});
