import { TERMINAL_SIDES, WIRE_COLORS } from "@face/model";
import { describe, expect, it } from "vitest";
import { CARD, GRID, PIN_RADIUS, PIN_SPACING, pinPoint } from "../src/canvas/geometry.ts";

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
