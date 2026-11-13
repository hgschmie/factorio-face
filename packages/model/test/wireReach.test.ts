import { describe, expect, it } from "vitest";
import { DEFAULT_WIRE_REACH, exceedsWireReach, formatWireLength, isWireReach, tileCenter, WIRE_REACH_RANGE, wireLength, type Direction, type EntityKind, type Placement, type Point } from "../src/index.ts";

const on = (x: number, y: number, direction?: Direction): { placement: Placement } => ({ placement: { tile: { x, y }, direction } });
const standing = (kind: EntityKind, direction: Direction, origin: Point): { placement: Placement } => ({ placement: { tile: tileCenter(kind, direction, origin), direction } });
const unplaced = { placement: { direction: "north" as const } };

describe("wire reach", () => {
  it("defaults to the 9 tiles of the game data and allows 1 to 100, fractions included", () => {
    expect(DEFAULT_WIRE_REACH).toBe(9);
    expect(WIRE_REACH_RANGE).toEqual({ min: 1, max: 100 });
    expect([1, 9, 9.5, 100].every(isWireReach)).toBe(true);
    expect([0, 0.99, 100.01, -9, Number.NaN, Number.POSITIVE_INFINITY, "9", null, undefined].some(isWireReach)).toBe(false);
  });

  it("measures the straight line between the centers of two 1x1 entities", () => {
    expect(wireLength(on(0.5, 0.5), on(4.5, 0.5))).toBe(4);
    expect(wireLength(on(0.5, 0.5), on(3.5, 4.5))).toBe(5);
    expect(wireLength(on(3.5, 4.5), on(0.5, 0.5))).toBe(5);
    expect(wireLength(on(-2.5, -0.5), on(0.5, -4.5))).toBe(5);
  });

  it("measures a 2x1 entity from its center, wherever it faces", () => {
    const lamp = standing("lamp", "east", { x: 0, y: 0 });
    // On the tiles (4, 0) and (5, 0): the center is on the line between them.
    expect(wireLength(lamp, standing("decider", "east", { x: 4, y: 0 }))).toBe(4.5);
    expect(wireLength(lamp, standing("decider", "west", { x: 4, y: 0 }))).toBe(4.5);
    // On the tiles (4, 0) and (4, 1): half a tile further down, so the wire is longer than to a 1x1 entity on (4, 0).
    expect(wireLength(lamp, standing("decider", "south", { x: 4, y: 0 }))).toBeCloseTo(Math.hypot(4, 0.5), 12);
    expect(wireLength(lamp, standing("decider", "north", { x: 4, y: 0 }))).toBeCloseTo(Math.hypot(4, 0.5), 12);
    expect(wireLength(standing("arithmetic", "east", { x: 0, y: 0 }), standing("selector", "north", { x: 0, y: 3 }))).toBeCloseTo(Math.hypot(0.5, 3.5), 12);
  });

  it("calls a wire over-long only when it is longer than the reach", () => {
    const exact = wireLength(on(0.5, 0.5), on(9.5, 0.5));
    expect(exact).toBe(9);
    expect(exceedsWireReach(exact, 9)).toBe(false);
    // A 2x1 entity turned north next to the same tile: the center moves half a tile across, the wire is just over.
    const over = wireLength(on(0.5, 0.5), standing("decider", "north", { x: 9, y: 0 }));
    expect(over).toBeCloseTo(9.0139, 4);
    expect(exceedsWireReach(over, 9)).toBe(true);
    expect(exceedsWireReach(over, 9.5)).toBe(false);
    expect(exceedsWireReach(wireLength(on(0.5, 0.5), on(10.5, 0.5)), 9)).toBe(true);
  });

  it("gives a wire with an end that is not placed no length, and never flags it", () => {
    expect(wireLength(on(0.5, 0.5), unplaced)).toBeUndefined();
    expect(wireLength(unplaced, on(0.5, 0.5))).toBeUndefined();
    expect(wireLength({}, {})).toBeUndefined();
    expect(exceedsWireReach(undefined, 1)).toBe(false);
  });

  it("never flags a wire from an entity to itself", () => {
    const gate = standing("decider", "east", { x: 40, y: 40 });
    expect(wireLength(gate, gate)).toBe(0);
    expect(exceedsWireReach(wireLength(gate, gate), WIRE_REACH_RANGE.min)).toBe(false);
    expect(wireLength(unplaced, unplaced)).toBeUndefined();
  });

  it("shows a length with one decimal, and with more where that would hide on which side of the reach it is", () => {
    expect(formatWireLength(4, 9)).toBe("4.0");
    expect(formatWireLength(12.3693, 9)).toBe("12.4");
    expect(formatWireLength(9, 9)).toBe("9.0");
    expect(formatWireLength(Math.hypot(9, 0.5), 9)).toBe("9.01");
    expect(formatWireLength(9.0004, 9)).toBe("9.000");
    expect(formatWireLength(8.96, 9)).toBe("9.0");
    expect(formatWireLength(8.96, 8.97)).toBe("8.96");
  });
});
