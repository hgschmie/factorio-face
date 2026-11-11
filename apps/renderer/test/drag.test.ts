import { describe, expect, it } from "vitest";
import { changedPositions, dragPositions, exceedsDragThreshold, placementPosition, snapPoint, snapToGrid, worldDelta } from "../src/canvas/drag.ts";
import { CARD, GRID } from "../src/canvas/geometry.ts";

describe("snap to grid", () => {
  it("rounds to the nearest multiple of 20", () => {
    expect(GRID).toBe(20);
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(9.9)).toBe(0);
    expect(snapToGrid(10)).toBe(20);
    expect(snapToGrid(29)).toBe(20);
    expect(snapToGrid(-9)).toBe(0);
    expect(Object.is(snapToGrid(-9), 0)).toBe(true);
    expect(snapToGrid(-11)).toBe(-20);
    expect(snapPoint({ x: 407, y: -133 })).toEqual({ x: 400, y: -140 });
  });
});

describe("drag gesture", () => {
  it("treats small pointer travel as a click", () => {
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(false);
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 102, y: 102 })).toBe(true);
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 96, y: 100 })).toBe(true);
  });

  it("converts pointer travel to world units with the zoom", () => {
    expect(worldDelta({ x: 100, y: 100 }, { x: 160, y: 40 }, 1)).toEqual({ x: 60, y: -60 });
    expect(worldDelta({ x: 100, y: 100 }, { x: 160, y: 40 }, 0.5)).toEqual({ x: 120, y: -120 });
    expect(worldDelta({ x: 100, y: 100 }, { x: 160, y: 40 }, 2)).toEqual({ x: 30, y: -30 });
  });

  it("computes the drop from press and release alone", () => {
    const origins = [{ id: "a", position: { x: 300, y: 80 } }];
    const delta = worldDelta({ x: 500, y: 300 }, { x: 607, y: 437 }, 1);
    expect(dragPositions(origins, "a", delta)).toEqual([{ id: "a", position: { x: 400, y: 220 } }]);
  });

  it("snaps the grabbed entity and moves the others by the same amount", () => {
    const origins = [
      { id: "a", position: { x: 300, y: 80 } },
      { id: "b", position: { x: 47, y: 13 } },
    ];
    const moved = dragPositions(origins, "a", { x: 33, y: -8 });
    expect(moved).toEqual([
      { id: "a", position: { x: 340, y: 80 } },
      { id: "b", position: { x: 87, y: 13 } },
    ]);
  });

  it("puts an off-grid grabbed entity onto the grid", () => {
    expect(dragPositions([{ id: "a", position: { x: 47, y: 13 } }], "a", { x: 1, y: 1 })).toEqual([{ id: "a", position: { x: 40, y: 20 } }]);
  });

  it("reports only entities whose position changed", () => {
    const origins = [
      { id: "a", position: { x: 300, y: 80 } },
      { id: "b", position: { x: 40, y: 20 } },
    ];
    expect(changedPositions(origins, dragPositions(origins, "a", { x: 4, y: -6 }))).toEqual([]);
    expect(changedPositions(origins, dragPositions(origins, "a", { x: 20, y: 0 })).map((move) => move.id)).toEqual(["a", "b"]);
    expect(dragPositions([], "a", { x: 20, y: 0 })).toEqual([]);
  });
});

describe("placement", () => {
  it("centers the new card on the pointer and snaps it", () => {
    expect(placementPosition({ x: 192, y: 464 })).toEqual({ x: 100, y: 400 });
    expect(placementPosition({ x: CARD.width / 2, y: CARD.height / 2 })).toEqual({ x: 0, y: 0 });
    expect(placementPosition({ x: 0, y: 0 })).toEqual({ x: -100, y: -60 });
  });
});
