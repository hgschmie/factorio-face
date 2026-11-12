// The blueprint board: where entities without a `tile` go, what counts as a conflict, and where the pins sit on a footprint.
import { analyze } from "@face/language";
import { DIRECTIONS, facingOf, isTileCenter, occupiedTiles, TERMINALS, tileHalves, tileCenter, tileOrigin, tileSize, WIRE_COLORS, type Entity, type Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { arrangeBoard, BOARD_PIN, boardPinOffset, derivedTiles, EDIT_UNITS_PER_TILE, TILE } from "../src/canvas/board.ts";
import { CARD, PIN_SPACING } from "../src/canvas/geometry.ts";
import { STARTER_SOURCE } from "../src/session/starter.ts";
import { gridSource } from "../../../tests/e2e/fixtures.ts";

function entitiesOf(source: string): readonly Entity[] {
  const result = analyze(source.includes("circuit ") ? source : `circuit "t" {\n${source}\n}\n`);
  if (!result.circuit) throw new Error(JSON.stringify(result.diagnostics));
  return result.circuit.entities;
}

/** The tiles every entity covers, by name. */
function tilesByName(entities: readonly Entity[]): Record<string, Point[]> {
  const derived = derivedTiles(entities);
  return Object.fromEntries(entities.map((entity) => [entity.name, occupiedTiles(entity.kind, facingOf(entity), entity.placement?.tile ?? derived.get(entity.id)!)]));
}

function expectNoOverlap(entities: readonly Entity[]): void {
  const all = Object.values(tilesByName(entities)).flat().map((tile) => `${tile.x},${tile.y}`);
  expect(new Set(all).size).toBe(all.length);
}

const at = (x: number, y: number): Point => ({ x, y });

describe("derivedTiles", () => {
  it("scales the corner of the card down to a tile, half a card width per tile in both directions", () => {
    expect(EDIT_UNITS_PER_TILE).toBe(CARD.width / 2);
    const entities = entitiesOf(STARTER_SOURCE);
    // source (40, 80), gate (300, 80), twice (300, 240), light (560, 80): three tiles between the columns, two between the rows.
    expect(tilesByName(entities)).toEqual({ source: [at(0, 1)], gate: [at(3, 1), at(4, 1)], twice: [at(3, 3), at(4, 3)], light: [at(6, 1)] });
    expect([...derivedTiles(entities).values()]).toEqual([at(0.5, 1.5), at(4, 1.5), at(4, 3.5), at(6.5, 1.5)]);
  });

  it("gives centers that are on the grid for the kind and the facing, and none for an entity that has a tile", () => {
    const entities = entitiesOf(`constant c at (-100, -100) facing north { }\ndecider d at (0, 0) facing south { }\nselector s at (0, 400) facing west { }\nlamp l at (400, 0) { }\narithmetic placed at (0, 0) tile (20, 0.5) { }`);
    const derived = derivedTiles(entities);
    expect([...derived.keys()]).toEqual(entities.slice(0, 4).map((entity) => entity.id));
    for (const entity of entities.slice(0, 4)) expect(isTileCenter(entity.kind, facingOf(entity), derived.get(entity.id)!), entity.name).toBe(true);
    expect(tilesByName(entities)).toMatchObject({ c: [at(-1, -1)], d: [at(0, 0), at(0, 1)], s: [at(0, 4), at(1, 4)], l: [at(4, 0)] });
  });

  it("moves an entity whose place is taken to the nearest free one: ring by ring, the nearest first, then the upper, then the left", () => {
    // Five lamps on one spot: the second goes above (the upper of the four nearest), then left, right, below.
    const lamps = entitiesOf([1, 2, 3, 4, 5, 6].map((n) => `lamp l${n} at (200, 200) { }`).join("\n"));
    expect(tilesByName(lamps)).toEqual({ l1: [at(2, 2)], l2: [at(2, 1)], l3: [at(1, 2)], l4: [at(3, 2)], l5: [at(2, 3)], l6: [at(1, 1)] });
    // A 2x1 entity needs both of its tiles: one tile to the left it would still stand on the lamp, so the second one goes right.
    const long = entitiesOf(`lamp l at (200, 200) { }\ndecider d at (200, 200) { }\ndecider e at (200, 200) { }`);
    expect(tilesByName(long)).toEqual({ l: [at(2, 2)], d: [at(2, 1), at(3, 1)], e: [at(3, 2), at(4, 2)] });
    expectNoOverlap(long);
  });

  it("keeps clear of the entities that have a tile, wherever they come in the circuit", () => {
    const entities = entitiesOf(`decider loose at (0, 0) { }\nconstant early at (92, 0) { }\ndecider placed at (900, 900) tile (1, 0.5) { }\nlamp lamp1 at (0, 0) { }`);
    const tiles = tilesByName(entities);
    expect(tiles.placed).toEqual([at(0, 0), at(1, 0)]);
    expect(tiles.loose).toEqual([at(0, -1), at(1, -1)]);
    // (1, 0) is taken by `placed`, above it stands `loose`, to the left is `placed` again.
    expect(tiles.early).toEqual([at(2, 0)]);
    expect(tiles.lamp1).toEqual([at(-1, 0)]);
    expectNoOverlap(entities);
  });

  it("is the same for the same circuit and leaves no overlap in a crowded one", () => {
    const crowded = entitiesOf(Array.from({ length: 60 }, (_, i) => `${i % 3 === 0 ? "lamp" : "arithmetic"} n${i} at (${(i % 4) * 40}, ${(i % 5) * 40})${i % 3 === 1 ? " facing south" : ""} { }`).join("\n"));
    expect([...derivedTiles(crowded)]).toEqual([...derivedTiles(crowded)]);
    expectNoOverlap(crowded);
    const grid = entitiesOf(gridSource(200, 20));
    expectNoOverlap(grid);
    // Cards that do not overlap in the edit layout keep their place: nothing had to give way.
    const derived = derivedTiles(grid);
    for (const entity of grid) expect(tileOrigin(entity.kind, "east", derived.get(entity.id)!)).toEqual(at(Math.round(entity.position.x / EDIT_UNITS_PER_TILE), Math.round(entity.position.y / EDIT_UNITS_PER_TILE)));
  });
});

describe("arrangeBoard", () => {
  it("puts placed entities on their tile and derived ones where derivedTiles says", () => {
    const entities = entitiesOf(`constant c at (0, 0) tile (2.5, -0.5) facing north { }\ndecider d at (184, 92) facing south { }`);
    const [c, d] = entities.map((entity) => arrangeBoard(entities).get(entity.id)!);
    expect(c).toEqual({ origin: at(2, -1), size: { width: 1, height: 1 }, facing: "north", placed: true, conflict: false });
    expect(d).toEqual({ origin: at(2, 1), size: { width: 1, height: 2 }, facing: "south", placed: false, conflict: false });
  });

  it("marks a tile that is off the grid and tiles that are shared, and draws both where the tile says", () => {
    const entities = entitiesOf(`decider off at (0, 0) tile (0.5, 0.5) { }\nlamp a at (0, 0) tile (5.5, 5.5) { }\nconstant b at (0, 0) tile (5.5, 5.5) { }\nlamp fine at (0, 0) tile (9.5, 9.5) { }\nlamp loose at (460, 460) { }`);
    const board = arrangeBoard(entities);
    const named = Object.fromEntries(entities.map((entity) => [entity.name, board.get(entity.id)!]));
    // (0.5, 0.5) is no center of a 2x1 entity facing east; the nearest footprint is the one on tiles (0, 0) and (1, 0).
    expect(named.off).toMatchObject({ origin: at(0, 0), placed: true, conflict: true });
    expect(named.a).toMatchObject({ origin: at(5, 5), placed: true, conflict: true });
    expect(named.b).toMatchObject({ origin: at(5, 5), placed: true, conflict: true });
    expect(named.fine).toMatchObject({ placed: true, conflict: false });
    // A derived entity never is in conflict: it moved out of the way of the two that share (5, 5).
    expect(named.loose).toMatchObject({ origin: at(5, 4), placed: false, conflict: false });
  });

  it("takes the top-left tile of a moved entity from the caller", () => {
    const entities = entitiesOf(`decider d at (0, 0) tile (1, 0.5) { }\nlamp l at (0, 0) { }`);
    const board = arrangeBoard(entities, new Map([[entities[1]!.id, at(7, 7)]]));
    expect(board.get(entities[0]!.id)).toMatchObject({ origin: at(0, 0), placed: true });
    expect(board.get(entities[1]!.id)).toMatchObject({ origin: at(7, 7), placed: false });
  });
});

describe("pins on a footprint", () => {
  const kinds = ["constant", "arithmetic", "decider", "selector", "lamp"] as const;

  it("puts the input pins on the input half and the output pins on the output half, at the outer end of the tile", () => {
    for (const kind of kinds) {
      for (const facing of kind === "lamp" ? (["east"] as const) : DIRECTIONS) {
        const halves = tileHalves(kind, facing, tileCenter(kind, facing, at(0, 0)));
        for (const side of TERMINALS[kind]) {
          const half = side === "out" ? halves.output : halves.input;
          for (const color of WIRE_COLORS) {
            const pin = boardPinOffset(kind, facing, side, color);
            expect({ x: Math.floor(pin.x / TILE), y: Math.floor(pin.y / TILE) }, `${kind} ${facing} ${side} ${color}`).toEqual(half);
            const size = tileSize(kind, facing);
            // One pin inset away from exactly one end of the footprint, never on its border.
            const ends = [pin.x, size.width * TILE - pin.x, pin.y, size.height * TILE - pin.y];
            expect(ends.filter((distance) => distance === BOARD_PIN.inset).length).toBe(1);
            expect(Math.min(...ends)).toBe(BOARD_PIN.inset);
          }
        }
      }
    }
  });

  it("turns with the facing as the pins of a card do: red on the left seen along the facing", () => {
    // Facing east: input on the left tile, output on the right tile, red above green.
    expect(boardPinOffset("decider", "east", "in", "red")).toEqual(at(12, 30));
    expect(boardPinOffset("decider", "east", "in", "green")).toEqual(at(12, 50));
    expect(boardPinOffset("decider", "east", "out", "red")).toEqual(at(148, 30));
    expect(boardPinOffset("decider", "east", "out", "green")).toEqual(at(148, 50));
    // Facing south: output at the bottom, red right of green.
    expect(boardPinOffset("decider", "south", "out", "red")).toEqual(at(50, 148));
    expect(boardPinOffset("decider", "south", "in", "green")).toEqual(at(30, 12));
    // Facing west: output on the left, red below green.
    expect(boardPinOffset("decider", "west", "out", "red")).toEqual(at(12, 50));
    expect(boardPinOffset("decider", "west", "in", "red")).toEqual(at(148, 50));
    // Facing north: output on top, red left of green.
    expect(boardPinOffset("decider", "north", "out", "red")).toEqual(at(30, 12));
    expect(boardPinOffset("decider", "north", "in", "green")).toEqual(at(50, 148));
    for (const facing of DIRECTIONS) {
      const [red, green] = WIRE_COLORS.map((color) => boardPinOffset("constant", facing, "out", color));
      expect(Math.hypot(red!.x - green!.x, red!.y - green!.y)).toBe(PIN_SPACING);
    }
    // A lamp has its input on the west end of its tile, a constant its output where it faces.
    expect(boardPinOffset("lamp", "east", "in", "red")).toEqual(at(12, 30));
    expect(boardPinOffset("constant", "north", "out", "green")).toEqual(at(50, 12));
  });
});
