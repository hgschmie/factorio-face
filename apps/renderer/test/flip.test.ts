// Mirroring a selection: the direction of one entity, the cards of a group on the edit canvas, the footprints of a group on the
// board, when there is something to flip, and when the board refuses.
import { analyze } from "@face/language";
import { DIRECTIONS, facingOf, isTileCenter, occupiedTiles, type Direction, type Entity, type Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { firstObstacle } from "../src/canvas/board.ts";
import { blockedFlip, canFlip, flipCards, flipTiles } from "../src/canvas/flip.ts";
import { FLIP_AXES, flipped } from "../src/entities/facing.ts";
import { flippedTool, placeFacing, type PlaceTool } from "../src/workbench/controller.ts";

function entitiesOf(body: string): readonly Entity[] {
  const result = analyze(`circuit "t" {\n${body}\n}\n`);
  if (!result.circuit) throw new Error(JSON.stringify(result.diagnostics));
  return result.circuit.entities;
}

const named = (entities: readonly Entity[], ...names: string[]): Entity[] => names.map((name) => entities.find((entity) => entity.name === name)!);
const at = (x: number, y: number): Point => ({ x, y });

describe("flipped", () => {
  it("swaps east and west for a horizontal flip and north and south for a vertical one, and keeps the others", () => {
    expect(DIRECTIONS.map((direction) => [direction, flipped(direction, "horizontal"), flipped(direction, "vertical")])).toEqual([
      ["north", "north", "south"],
      ["east", "west", "east"],
      ["south", "south", "north"],
      ["west", "east", "west"],
    ]);
    // A flip is its own inverse, and both together are a half turn.
    for (const axis of FLIP_AXES) for (const direction of DIRECTIONS) expect(flipped(flipped(direction, axis), axis)).toBe(direction);
    const half: Readonly<Record<Direction, Direction>> = { north: "south", south: "north", east: "west", west: "east" };
    for (const direction of DIRECTIONS) expect(flipped(flipped(direction, "horizontal"), "vertical")).toBe(half[direction]);
  });

  it("mirrors what a place tool is about to place, and nothing that cannot turn", () => {
    const decider: PlaceTool = { type: "place", kind: "decider" };
    expect(flippedTool(decider, "horizontal")).toEqual({ type: "place", kind: "decider", facing: "west" });
    expect(placeFacing(flippedTool(decider, "vertical")!)).toBe("east");
    expect(flippedTool({ ...decider, facing: "north" }, "vertical")).toEqual({ type: "place", kind: "decider", facing: "south" });
    expect(flippedTool({ type: "place", kind: "lamp" }, "horizontal")).toBeUndefined();
    expect(flippedTool({ type: "place", kind: "pole", prototype: "substation" }, "vertical")).toBeUndefined();
    expect(flippedTool({ type: "select" }, "horizontal")).toBeUndefined();
    expect(flippedTool({ type: "wire", color: "red" }, "horizontal")).toBeUndefined();
  });
});

const CARDS = entitiesOf(`
  constant a at (40, 80) { }
  decider b at (300, 80) facing north { }
  lamp c at (560, 260) { }
  arithmetic d at (310, 400) facing west { }
`);

describe("flipCards", () => {
  it("turns a single entity in place", () => {
    const [a, b, c] = named(CARDS, "a", "b", "c");
    expect(flipCards([a!], "horizontal")).toEqual([{ id: a!.id, direction: "west", position: at(40, 80) }]);
    expect(flipCards([a!], "vertical")).toEqual([{ id: a!.id, direction: "east", position: at(40, 80) }]);
    expect(flipCards([b!], "vertical")).toEqual([{ id: b!.id, direction: "south", position: at(300, 80) }]);
    // A lamp does not turn: it gets no direction.
    expect(flipCards([c!], "horizontal")).toEqual([{ id: c!.id, position: at(560, 260) }]);
  });

  it("mirrors the cards of a group within the bounds of the group and flips each direction", () => {
    const horizontal = flipCards(CARDS, "horizontal");
    expect(horizontal.map(({ direction, position }) => [direction, position])).toEqual([
      ["west", at(560, 80)],
      ["north", at(300, 80)],
      [undefined, at(40, 260)],
      ["east", at(290, 400)],
    ]);
    const vertical = flipCards(CARDS, "vertical");
    expect(vertical.map(({ direction, position }) => [direction, position])).toEqual([
      ["east", at(40, 400)],
      ["south", at(300, 400)],
      [undefined, at(560, 220)],
      ["west", at(310, 80)],
    ]);
    // The bounds keep their place, and a second flip puts everything back.
    for (const flips of [horizontal, vertical]) {
      expect(Math.min(...flips.map((flip) => flip.position!.x))).toBe(40);
      expect(Math.max(...flips.map((flip) => flip.position!.x))).toBe(560);
      expect(Math.min(...flips.map((flip) => flip.position!.y))).toBe(80);
      expect(Math.max(...flips.map((flip) => flip.position!.y))).toBe(400);
    }
    const back = flipCards(CARDS.map((entity, index) => ({ ...entity, position: horizontal[index]!.position! })), "horizontal");
    expect(back.map((flip) => flip.position)).toEqual(CARDS.map((entity) => entity.position));
    // No tile is written on the edit canvas.
    expect(horizontal.every((flip) => flip.tile === undefined)).toBe(true);
  });
});

/**
 * Row 0: a (0,0), b lying on (2..3, 0), lamp c on (7, 0). d upright on (5, 1..2), e lying on (2..3, 2) facing west, big pole
 * p on (0..1, 3..4). `loose` has no tile.
 */
const BOARD = entitiesOf(`
  constant a at (40, 80) tile (0.5, 0.5) { }
  decider b at (300, 80) tile (3, 0.5) { }
  lamp c at (560, 80) tile (7.5, 0.5) { }
  arithmetic d at (300, 260) tile (5.5, 2) facing south { }
  selector e at (560, 260) tile (3, 2.5) facing west { operation = count }
  pole p at (40, 400) tile (1, 4) { prototype = big-electric-pole }
  decider loose at (40, 600) facing north { }
`);

describe("flipTiles", () => {
  const tilesAfter = (entities: readonly Entity[], flips: ReturnType<typeof flipTiles>): Record<string, [Direction | undefined, Point | undefined]> =>
    Object.fromEntries(entities.map((entity, index) => [entity.name, [flips[index]!.direction, flips[index]!.tile]]));

  it("flips a single entity on its own tiles: a combinator swaps its ends, a square entity stays as it is", () => {
    const [b, d, c, p] = named(BOARD, "b", "d", "c", "p");
    expect(flipTiles([b!], "horizontal")).toEqual([{ id: b!.id, direction: "west", tile: at(3, 0.5) }]);
    expect(flipTiles([b!], "vertical")).toEqual([{ id: b!.id, direction: "east", tile: at(3, 0.5) }]);
    expect(flipTiles([d!], "vertical")).toEqual([{ id: d!.id, direction: "north", tile: at(5.5, 2) }]);
    expect(flipTiles([c!], "horizontal")).toEqual([{ id: c!.id, tile: at(7.5, 0.5) }]);
    expect(flipTiles([p!], "vertical")).toEqual([{ id: p!.id, tile: at(1, 4) }]);
  });

  it("mirrors the footprints of a group within the bounds of the group, every one on the grid", () => {
    const placed = BOARD.filter((entity) => entity.placement?.tile);
    // Columns 0 to 7: a footprint from column x of width w goes to column 8 - x - w.
    expect(tilesAfter(placed, flipTiles(placed, "horizontal"))).toEqual({
      a: ["west", at(7.5, 0.5)],
      b: ["west", at(5, 0.5)],
      c: [undefined, at(0.5, 0.5)],
      d: ["south", at(2.5, 2)],
      e: ["east", at(5, 2.5)],
      p: [undefined, at(7, 4)],
    });
    // Rows 0 to 4: a footprint from row y of height h goes to row 5 - y - h.
    expect(tilesAfter(placed, flipTiles(placed, "vertical"))).toEqual({
      a: ["east", at(0.5, 4.5)],
      b: ["east", at(3, 4.5)],
      c: [undefined, at(7.5, 4.5)],
      d: ["north", at(5.5, 3)],
      e: ["west", at(3, 2.5)],
      p: [undefined, at(1, 1)],
    });
    for (const axis of FLIP_AXES) {
      const flips = flipTiles(placed, axis);
      const after = placed.map((entity, index) => ({ ...entity, placement: { ...entity.placement, tile: flips[index]!.tile!, direction: flips[index]!.direction ?? facingOf(entity) } }));
      for (const entity of after) expect(isTileCenter(entity, facingOf(entity), entity.placement.tile), `${axis} ${entity.name}`).toBe(true);
      // Nothing overlaps afterwards, and the tiles covered are the mirror image of the tiles covered before.
      const covered = (entities: readonly Entity[]): string[] => entities.flatMap((entity) => occupiedTiles(entity, facingOf(entity), entity.placement!.tile!)).map((tile) => `${tile.x},${tile.y}`);
      expect(new Set(covered(after)).size).toBe(covered(after).length);
      const mirror = (key: string): string => {
        const [x = 0, y = 0] = key.split(",").map(Number);
        return axis === "horizontal" ? `${7 - x},${y}` : `${x},${4 - y}`;
      };
      expect(covered(after).sort()).toEqual(covered(placed).map(mirror).sort());
      // A second flip puts everything back.
      const back = flipTiles(after, axis);
      expect(back.map((flip, index) => [flip.direction ?? facingOf(placed[index]!), flip.tile])).toEqual(placed.map((entity) => [facingOf(entity), entity.placement!.tile]));
    }
  });

  it("only turns an entity without a tile: it has no tiles to mirror and does not count for the bounds", () => {
    const [a, b, loose] = named(BOARD, "a", "b", "loose");
    expect(flipTiles([a!, b!, loose!], "vertical")).toEqual([
      { id: a!.id, direction: "east", tile: at(0.5, 0.5) },
      { id: b!.id, direction: "east", tile: at(3, 0.5) },
      { id: loose!.id, direction: "south" },
    ]);
    expect(flipTiles([a!, b!, loose!], "horizontal").map((flip) => flip.tile)).toEqual([at(3.5, 0.5), at(1, 0.5), undefined]);
    expect(flipTiles([loose!], "horizontal")).toEqual([{ id: loose!.id, direction: "north" }]);
  });

  it("counts an entity whose tile is off the grid with the footprint the board shows", () => {
    const entities = entitiesOf(`
      decider x at (0, 0) tile (1.4, 0.5) { }
      lamp y at (0, 0) tile (4.5, 0.5) { }
    `);
    // x is shown on (0..1, 0): columns 0 to 4.
    expect(flipTiles(entities, "horizontal").map((flip) => flip.tile)).toEqual([at(4, 0.5), at(0.5, 0.5)]);
  });
});

describe("canFlip", () => {
  it("needs something that can turn or two entities to swap sides", () => {
    const [a, c, p, loose] = named(BOARD, "a", "c", "p", "loose");
    for (const tiles of [false, true]) {
      expect(canFlip([], tiles)).toBe(false);
      expect(canFlip([c!], tiles)).toBe(false);
      expect(canFlip([p!], tiles)).toBe(false);
      expect(canFlip([a!], tiles)).toBe(true);
      expect(canFlip([c!, p!], tiles)).toBe(true);
      expect(canFlip([loose!], tiles)).toBe(true);
    }
    // On the board entities without a tile have nothing to mirror: two loose lamps cannot be flipped, on the edit canvas they can.
    const lamps = entitiesOf("lamp one at (0, 0) { }\nlamp two at (200, 0) { }\nlamp three at (400, 0) tile (0.5, 0.5) { }");
    expect(canFlip(lamps.slice(0, 2), false)).toBe(true);
    expect(canFlip(lamps.slice(0, 2), true)).toBe(false);
    expect(canFlip(lamps, true)).toBe(false);
  });
});

describe("blockedFlip", () => {
  it("refuses a flip that puts an entity on a tile of an entity outside the selection, and names both", () => {
    const [a, b, c, e] = named(BOARD, "a", "b", "c", "e");
    // a and c swap the ends of row 0; b stands between them and is not in the way.
    expect(blockedFlip(BOARD, flipTiles([a!, c!], "horizontal"))).toBeUndefined();
    // a and e, columns 0 to 3: a goes to (3, 0), where b stands.
    expect(blockedFlip(BOARD, flipTiles([a!, e!], "horizontal"))).toEqual({ entity: a!.id, obstacle: b!.id });
    // With b in the selection nothing is in the way.
    expect(blockedFlip(BOARD, flipTiles([a!, b!, e!], "horizontal"))).toBeUndefined();
    // A flip in place and a flip of entities without a tile are never refused.
    expect(blockedFlip(BOARD, flipTiles([b!], "horizontal"))).toBeUndefined();
    expect(blockedFlip(BOARD, flipTiles(named(BOARD, "loose"), "vertical"))).toBeUndefined();
  });

  it("does not count an entity without a tile as an obstacle", () => {
    const entities = entitiesOf(`
      lamp one at (0, 0) tile (0.5, 0.5) { }
      lamp two at (184, 92) tile (2.5, 1.5) { }
      lamp loose at (184, 0) { }
    `);
    // `loose` is shown on (2, 0), where `one` goes.
    expect(firstObstacle(entities, new Map([[entities[0]!.id, at(2, 0)]]))).toBeUndefined();
    expect(blockedFlip(entities, flipTiles(entities.slice(0, 2), "horizontal"))).toBeUndefined();
    expect(firstObstacle(entities, new Map([[entities[0]!.id, at(2, 1)]]))).toEqual({ entity: entities[0]!.id, obstacle: entities[1]!.id });
  });
});
