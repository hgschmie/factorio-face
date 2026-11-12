import { DEFAULT_FACING } from "@face/language";
import { DIRECTIONS, ENTITY_KINDS, TERMINAL_SIDES, TERMINALS, WIRE_COLORS, type Direction } from "@face/model";
import { describe, expect, it } from "vitest";
import { CARD, DIRECTION_VECTOR, GRID, PIN_RADIUS, PIN_SPACING, pinEdge, pinHeading, pinPoint, type CardEdge } from "../src/canvas/geometry.ts";
import { CLOCKWISE, facingOf, opposite, rotated } from "../src/entities/facing.ts";

describe("connection pins", () => {
  const position = { x: 40, y: 80 };

  it("puts inputs on the left edge and outputs on the right edge of the card", () => {
    for (const color of WIRE_COLORS) {
      expect(pinPoint(position, "in", color).x).toBe(position.x);
      expect(pinPoint(position, "out", color).x).toBe(position.x + CARD.width);
    }
  });

  it("puts the red pin above the green pin, at the same height on both sides", () => {
    for (const side of TERMINAL_SIDES) {
      const red = pinPoint(position, side, "red");
      const green = pinPoint(position, side, "green");
      expect(red.x).toBe(green.x);
      expect(green.y - red.y).toBe(PIN_SPACING);
    }
    expect(pinPoint(position, "in", "red").y).toBe(pinPoint(position, "out", "red").y);
    expect(pinPoint(position, "out", "red")).toEqual({ x: 224, y: 140 });
    expect(pinPoint(position, "out", "green")).toEqual({ x: 224, y: 160 });
  });

  it("moves with the card", () => {
    const pin = pinPoint(position, "in", "green");
    expect(pinPoint({ x: position.x + 60, y: position.y - 40 }, "in", "green")).toEqual({ x: pin.x + 60, y: pin.y - 40 });
  });

  it("keeps the two pins of a terminal clearly apart and inside the height of the card", () => {
    // Room for a click target of half the spacing around each pin, with a visible gap between the two dots.
    expect(PIN_SPACING).toBeGreaterThanOrEqual(20);
    expect(PIN_SPACING - 2 * PIN_RADIUS).toBeGreaterThanOrEqual(6);
    for (const color of WIRE_COLORS) {
      expect(CARD.pinY[color] - PIN_SPACING / 2).toBeGreaterThan(0);
      expect(CARD.pinY[color] + PIN_SPACING / 2).toBeLessThan(CARD.height);
    }
  });

  it("puts the pins on grid lines, so wires between aligned cards run straight along the grid", () => {
    for (const color of WIRE_COLORS) expect(CARD.pinY[color] % GRID).toBe(0);
  });
});

describe("connection pins of rotated entities", () => {
  const position = { x: 40, y: 80 };
  /** Offsets from the top-left corner of the card, per direction: [output red, output green, input red, input green]. */
  const expected: Readonly<Record<Direction, readonly (readonly [number, number])[]>> = {
    east: [[184, 60], [184, 80], [0, 60], [0, 80]],
    south: [[100, 128], [80, 128], [100, 0], [80, 0]],
    west: [[0, 80], [0, 60], [184, 80], [184, 60]],
    north: [[80, 0], [100, 0], [80, 128], [100, 128]],
  };
  const pins = (facing: Direction, at = position) => [pinPoint(at, "out", "red", facing), pinPoint(at, "out", "green", facing), pinPoint(at, "in", "red", facing), pinPoint(at, "in", "green", facing)];

  it("has the pins of every direction where the table says, on the card that moves", () => {
    for (const facing of DIRECTIONS) {
      expect(pins(facing)).toEqual(expected[facing].map(([x, y]) => ({ x: position.x + x, y: position.y + y })));
      expect(pins(facing, { x: -260, y: 300 })).toEqual(expected[facing].map(([x, y]) => ({ x: -260 + x, y: 300 + y })));
    }
  });

  it("faces east when no direction is given, exactly as before entities could be rotated", () => {
    expect(DEFAULT_FACING).toBe("east");
    for (const side of TERMINAL_SIDES) for (const color of WIRE_COLORS) expect(pinPoint(position, side, color)).toEqual(pinPoint(position, side, color, "east"));
    expect(facingOf({})).toBe("east");
    expect(facingOf({ placement: { tile: { x: 1, y: 2 } } })).toBe("east");
    expect(facingOf({ placement: { direction: "north" } })).toBe("north");
  });

  it("puts the output on the edge the entity faces and the input on the opposite edge, for the one terminal a constant or a lamp has as well", () => {
    const edges: Readonly<Record<Direction, CardEdge>> = { east: "right", south: "bottom", west: "left", north: "top" };
    for (const facing of DIRECTIONS) {
      expect(pinEdge("out", facing)).toBe(edges[facing]);
      expect(pinEdge("in", facing)).toBe(edges[opposite(facing)]);
      expect(pinHeading("out", facing)).toBe(facing);
      expect(pinHeading("in", facing)).toBe(opposite(facing));
      for (const kind of ENTITY_KINDS) {
        for (const side of TERMINALS[kind]) {
          for (const color of WIRE_COLORS) {
            const pin = pinPoint(position, side, color, facing);
            const onEdge = { left: pin.x === position.x, right: pin.x === position.x + CARD.width, top: pin.y === position.y, bottom: pin.y === position.y + CARD.height };
            expect(onEdge[pinEdge(side, facing)]).toBe(true);
          }
        }
      }
    }
  });

  it("turns the pins with the entity as one rigid figure: seen along the facing direction, red is always on the left", () => {
    for (const facing of DIRECTIONS) {
      const ahead = DIRECTION_VECTOR[facing];
      for (const side of TERMINAL_SIDES) {
        const red = pinPoint(position, side, "red", facing);
        const green = pinPoint(position, side, "green", facing);
        // The step from red to green is a quarter turn clockwise from the facing direction.
        expect({ x: green.x - red.x, y: green.y - red.y }).toEqual({ x: -ahead.y * PIN_SPACING + 0, y: ahead.x * PIN_SPACING + 0 });
      }
      // From the input to the output is along the facing direction.
      const across = { x: pinPoint(position, "out", "red", facing).x - pinPoint(position, "in", "red", facing).x, y: pinPoint(position, "out", "red", facing).y - pinPoint(position, "in", "red", facing).y };
      expect([Math.sign(across.x), Math.sign(across.y)]).toEqual([ahead.x, ahead.y]);
    }
  });

  it("keeps every pin on a grid line and the pins on the top and bottom edge around the middle of the card", () => {
    for (const facing of DIRECTIONS) {
      for (const pin of pins(facing, { x: 0, y: 0 })) {
        const along = facing === "east" || facing === "west" ? pin.y : pin.x;
        expect(along % GRID).toBe(0);
      }
    }
    expect((CARD.pinX.red + CARD.pinX.green) / 2).toBeGreaterThan(CARD.width / 2 - GRID / 2);
    expect((CARD.pinX.red + CARD.pinX.green) / 2).toBeLessThan(CARD.width / 2 + GRID / 2);
    expect(CARD.pinX.green - CARD.pinX.red).toBe(PIN_SPACING);
  });

  it("rotates clockwise from east over south and west to north, and back", () => {
    expect(CLOCKWISE).toEqual(["east", "south", "west", "north"]);
    for (const [index, facing] of CLOCKWISE.entries()) {
      expect(rotated(facing, "clockwise")).toBe(CLOCKWISE[(index + 1) % 4]);
      expect(rotated(rotated(facing, "clockwise"), "counterclockwise")).toBe(facing);
      expect(opposite(facing)).toBe(rotated(rotated(facing, "clockwise"), "clockwise"));
    }
  });
});
