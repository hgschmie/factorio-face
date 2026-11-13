import { describe, expect, it } from "vitest";
import {
  clampWireReach, DEFAULT_WIRE_REACH, describeWireReach, footprintBox, footprintDistance, formatWireDistance, formatWireReach, isWireReach, tileCenter, tileUnit, UNLIMITED_WIRE_REACH, WIRE_REACH_RANGE, wireDistance,
  wireReachBetween, wireReachOwner, wireSpan,
  type Direction, type EntityKind, type PlacedShape, type Point, type PrototypeOfKind, type TileBox,
} from "../src/index.ts";

type Placed = PlacedShape;
/** An entity of `kind` whose top-left tile is `origin`. */
const standing = (kind: EntityKind, direction: Direction, origin: Point): Placed => ({ kind, placement: { tile: tileCenter({ kind }, direction, origin), direction } });
const constant = (x: number, y: number): Placed => standing("constant", "east", { x, y });
const pole = (prototype: PrototypeOfKind<"pole">, x: number, y: number): Placed => ({ kind: "pole", prototype, placement: { tile: tileCenter({ kind: "pole", prototype }, "east", { x, y }) } });
const unplaced: Placed = { kind: "decider", placement: { direction: "north" } };
/** Whether a wire between the two is too long for a project with the reach 9, or `reach`. */
const tooLong = (a: Placed, b: Placed, reach = 9): boolean => wireSpan(a, b, reach).tooLong;
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
    expect(footprintBox({ kind: "decider" }, "east", { x: 1, y: 0.5 })).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    expect(footprintBox({ kind: "decider" }, "north", { x: 0.75, y: 1.25 })).toEqual({ x: 0.25, y: 0.25, width: 1, height: 2 });
    expect(wireDistance(constant(0, 0), { kind: "constant", placement: { tile: { x: 10.75, y: 0.5 } } })).toBe(9.25);
    expect(wireDistance(constant(0, 0), { kind: "decider", placement: { tile: { x: 10.5, y: 0.5 }, direction: "east" } })).toBe(8.5);
  });

  it("calls a wire too long only when the entities are further apart than the reach", () => {
    // Nine empty tiles in a row connect, ten do not.
    expect(wireSpan(constant(0, 0), constant(10, 0), 9)).toEqual({ reach: 9, of: "project", distance: 9, tooLong: false });
    expect(wireSpan(constant(0, 0), constant(11, 0), 9)).toEqual({ reach: 9, of: "project", distance: 10, tooLong: true });
    // Six and six empty tiles connect (8.49), seven and seven do not (9.90).
    expect(tooLong(constant(0, 0), constant(7, 7))).toBe(false);
    expect(tooLong(constant(0, 0), constant(8, 8))).toBe(true);
    const offGrid: Placed = { kind: "constant", placement: { tile: { x: 10.51, y: 0.5 } } };
    expect(wireDistance(constant(0, 0), offGrid)).toBeCloseTo(9.01, 10);
    expect(tooLong(constant(0, 0), offGrid)).toBe(true);
    expect(tooLong(constant(0, 0), offGrid, 9.5)).toBe(false);
    expect(tooLong(constant(0, 0), constant(1, 0), 0.5)).toBe(false);
  });

  it("flags nothing between entities without a reach of their own when the project's reach is 0, which means unlimited", () => {
    expect(wireSpan(constant(0, 0), constant(1, 0), UNLIMITED_WIRE_REACH)).toEqual({ reach: 0, of: "project", distance: 0, tooLong: false });
    expect(tooLong(constant(0, 0), constant(2, 0), UNLIMITED_WIRE_REACH)).toBe(false);
    expect(tooLong(constant(0, 0), constant(5000, -5000), UNLIMITED_WIRE_REACH)).toBe(false);
    expect(formatWireReach(UNLIMITED_WIRE_REACH)).toBe("unlimited");
    expect(formatWireReach(9)).toBe("9");
    expect(formatWireReach(7.5)).toBe("7.5");
  });

  it("gives a wire with an end that is not placed no distance, and never flags it", () => {
    expect(wireDistance(constant(0, 0), unplaced)).toBeUndefined();
    expect(wireDistance(unplaced, constant(0, 0))).toBeUndefined();
    expect(wireDistance({ kind: "lamp" }, { kind: "lamp" })).toBeUndefined();
    expect(wireSpan(constant(0, 0), unplaced, 1)).toEqual({ reach: 1, of: "project", tooLong: false });
    expect(wireSpan(pole("small-electric-pole", 0, 0), unplaced, 9)).toEqual({ reach: 7.5, of: "small-electric-pole", tooLong: false });
  });

  it("never flags a wire from an entity to itself", () => {
    const gate = standing("decider", "east", { x: 40, y: 40 });
    expect(wireDistance(gate, gate)).toBe(0);
    expect(tooLong(gate, gate, 0.5)).toBe(false);
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

  it("gives a pole its own reach and every other entity the reach of the project", () => {
    const lamp = standing("lamp", "east", { x: 0, y: 0 });
    for (const [prototype, reach] of [["small-electric-pole", 7.5], ["medium-electric-pole", 9], ["big-electric-pole", 32], ["substation", 18]] as const) {
      expect(wireReachBetween(pole(prototype, 0, 0), pole(prototype, 5, 0), 9)).toEqual({ reach, of: prototype });
    }
    expect(wireReachBetween(lamp, constant(3, 0), 9)).toEqual({ reach: 9, of: "project" });
    expect(wireReachBetween(lamp, { kind: "speaker" }, 12.5)).toEqual({ reach: 12.5, of: "project" });
  });

  it("takes the smaller reach of the two ends, from either side", () => {
    const lamp = standing("lamp", "east", { x: 0, y: 0 });
    const small = pole("small-electric-pole", 0, 0);
    const big = pole("big-electric-pole", 0, 0);
    for (const [a, b] of [[lamp, small], [small, lamp]] as const) expect(wireReachBetween(a, b, 9)).toEqual({ reach: 7.5, of: "small-electric-pole" });
    for (const [a, b] of [[lamp, big], [big, lamp]] as const) expect(wireReachBetween(a, b, 9)).toEqual({ reach: 9, of: "project" });
    for (const [a, b] of [[small, big], [big, small]] as const) expect(wireReachBetween(a, b, 9)).toEqual({ reach: 7.5, of: "small-electric-pole" });
    expect(wireReachBetween(pole("substation", 0, 0), big, 9)).toEqual({ reach: 18, of: "substation" });
    // A project reach below the pole's own limits the wire to the other end.
    expect(wireReachBetween(lamp, small, 4)).toEqual({ reach: 4, of: "project" });
    // Equal reaches: the one an entity has by itself is named, and of two such the first end's.
    expect(wireReachBetween(lamp, pole("medium-electric-pole", 0, 0), 9)).toEqual({ reach: 9, of: "medium-electric-pole" });
    expect(wireReachBetween(pole("substation", 0, 0), lamp, 18)).toEqual({ reach: 18, of: "substation" });
  });

  it("lets an unlimited end not limit: a pole keeps its reach in a project without one", () => {
    const lamp = standing("lamp", "east", { x: 0, y: 0 });
    expect(wireReachBetween(lamp, pole("small-electric-pole", 0, 0), UNLIMITED_WIRE_REACH)).toEqual({ reach: 7.5, of: "small-electric-pole" });
    expect(wireReachBetween(pole("big-electric-pole", 0, 0), lamp, UNLIMITED_WIRE_REACH)).toEqual({ reach: 32, of: "big-electric-pole" });
    expect(tooLong(lamp, pole("small-electric-pole", 9, 0), UNLIMITED_WIRE_REACH)).toBe(true);
    expect(tooLong(lamp, pole("small-electric-pole", 8, 0), UNLIMITED_WIRE_REACH)).toBe(false);
  });

  it("measures a wire to a pole against the reach that applies", () => {
    const lamp = standing("lamp", "east", { x: 0, y: 0 });
    // Seven empty tiles to a small pole connect, eight do not; half a tile more is the limit.
    expect(wireSpan(lamp, pole("small-electric-pole", 8, 0), 9)).toEqual({ reach: 7.5, of: "small-electric-pole", distance: 7, tooLong: false });
    expect(wireSpan(lamp, pole("small-electric-pole", 9, 0), 9)).toEqual({ reach: 7.5, of: "small-electric-pole", distance: 8, tooLong: true });
    expect(tooLong(lamp, { kind: "pole", prototype: "small-electric-pole", placement: { tile: { x: 9, y: 0.5 } } })).toBe(false);
    // Two big poles span 32 tiles between their 2x2 footprints, whatever the project says.
    for (const reach of [9, 4, UNLIMITED_WIRE_REACH]) {
      expect(wireSpan(pole("big-electric-pole", 0, 0), pole("big-electric-pole", 34, 0), reach)).toEqual({ reach: 32, of: "big-electric-pole", distance: 32, tooLong: false });
      expect(tooLong(pole("big-electric-pole", 0, 0), pole("big-electric-pole", 35, 0), reach)).toBe(true);
    }
    // A big pole and a lamp: the lamp's end has the project's reach.
    expect(tooLong(pole("big-electric-pole", 0, 0), standing("lamp", "east", { x: 12, y: 0 }))).toBe(true);
    expect(tooLong(pole("big-electric-pole", 0, 0), standing("lamp", "east", { x: 11, y: 0 }))).toBe(false);
    expect(tooLong(pole("substation", 0, 0), pole("substation", 20, 0))).toBe(false);
    expect(tooLong(pole("substation", 0, 0), pole("substation", 21, 0))).toBe(true);
  });

  it("says whose reach applied", () => {
    expect(describeWireReach({ reach: 9, of: "project" })).toBe("the wire reach of the project is 9");
    expect(describeWireReach({ reach: 7.5, of: "small-electric-pole" })).toBe("the wire reach of a small electric pole is 7.5");
    expect(describeWireReach({ reach: 0, of: "project" })).toBe("the wire reach of the project is unlimited");
    expect(wireReachOwner({ reach: 18, of: "substation" })).toBe("a substation");
  });
});
