// Where the bubble of an entity goes on the blueprint board.
import { describe, expect, it } from "vitest";
import { BUBBLE_GAP, BUBBLE_MARGIN, placeBubble } from "../src/canvas/bubble.ts";

const VIEW = { width: 1000, height: 700 };
const BUBBLE = { width: 184, height: 128 };

describe("placeBubble", () => {
  it("goes to the right of the entity, centered on it, with the pointer at its middle", () => {
    expect(placeBubble({ x: 300, y: 300, width: 160, height: 80 }, BUBBLE, VIEW)).toEqual({ x: 460 + BUBBLE_GAP, y: 340 - 64, side: "right", pointer: 64 });
  });

  it("takes the left side when the right has no room, then below, then above", () => {
    expect(placeBubble({ x: 800, y: 300, width: 160, height: 80 }, BUBBLE, VIEW)).toMatchObject({ x: 800 - BUBBLE_GAP - 184, side: "left" });
    // As wide as the canvas: neither side has room.
    expect(placeBubble({ x: 100, y: 100, width: 800, height: 80 }, BUBBLE, VIEW)).toMatchObject({ x: 500 - 92, y: 180 + BUBBLE_GAP, side: "below", pointer: 92 });
    expect(placeBubble({ x: 100, y: 550, width: 800, height: 80 }, BUBBLE, VIEW)).toMatchObject({ y: 550 - BUBBLE_GAP - 128, side: "above" });
  });

  it("stays inside the canvas and keeps pointing at the entity as far as it reaches", () => {
    // An entity at the top edge: the bubble cannot be centered on it.
    const top = placeBubble({ x: 300, y: 0, width: 80, height: 80 }, BUBBLE, VIEW)!;
    expect(top).toMatchObject({ y: BUBBLE_MARGIN, side: "right", pointer: 40 - BUBBLE_MARGIN });
    // Mostly out of sight above: the pointer stops short of the corner.
    expect(placeBubble({ x: 300, y: -70, width: 80, height: 80 }, BUBBLE, VIEW)).toMatchObject({ y: BUBBLE_MARGIN, pointer: 14 });
    const bottom = placeBubble({ x: 300, y: 680, width: 80, height: 80 }, BUBBLE, VIEW)!;
    expect(bottom.y).toBe(VIEW.height - BUBBLE_MARGIN - BUBBLE.height);
    expect(bottom.pointer).toBeLessThan(BUBBLE.height);
    expect(bottom.pointer).toBeGreaterThan(BUBBLE.height / 2);
  });

  it("takes the side with the most room when it fits nowhere, and still stays inside", () => {
    // An entity that fills the view, as when zoomed in all the way.
    const placed = placeBubble({ x: -50, y: -50, width: 1100, height: 800 }, BUBBLE, VIEW)!;
    expect(placed.x).toBeGreaterThanOrEqual(BUBBLE_MARGIN);
    expect(placed.x + BUBBLE.width).toBeLessThanOrEqual(VIEW.width - BUBBLE_MARGIN);
    expect(placed.y).toBeGreaterThanOrEqual(BUBBLE_MARGIN);
    expect(placed.y + BUBBLE.height).toBeLessThanOrEqual(VIEW.height - BUBBLE_MARGIN);
    const small = placeBubble({ x: 10, y: 10, width: 40, height: 40 }, BUBBLE, { width: 150, height: 100 })!;
    expect(small).toMatchObject({ x: BUBBLE_MARGIN, y: BUBBLE_MARGIN });
  });

  it("is absent while the entity is out of sight", () => {
    expect(placeBubble({ x: 1200, y: 300, width: 80, height: 80 }, BUBBLE, VIEW)).toBeUndefined();
    expect(placeBubble({ x: 300, y: -300, width: 80, height: 80 }, BUBBLE, VIEW)).toBeUndefined();
  });
});
