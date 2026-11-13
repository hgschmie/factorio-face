// The blueprint board: where entities without a `tile` go, what counts as a conflict, and where the pins sit on a footprint.
import { analyze } from "@face/language";
import { DIRECTIONS, facingOf, isTileCenter, occupiedTiles, TERMINALS, tileHalves, tileCenter, tileOrigin, tileSize, WIRE_COLORS, type Entity, type Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { arrangeBoard, blockedMoves, blockedTurn, BOARD_PIN, boardPinOffset, canStandAt, derivedTiles, EDIT_UNITS_PER_TILE, editPositionOf, footprintOriginAt, freeOriginNear, TILE } from "../src/canvas/board.ts";
import { CARD, GRID, PIN_SPACING } from "../src/canvas/geometry.ts";
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
    expect(c).toEqual({ origin: at(2, -1), size: { width: 1, height: 1 }, facing: "north", placed: true, conflict: false, moving: false, blocked: false });
    expect(d).toEqual({ origin: at(2, 1), size: { width: 1, height: 2 }, facing: "south", placed: false, conflict: false, moving: false, blocked: false });
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
    expect(board.get(entities[0]!.id)).toMatchObject({ origin: at(0, 0), placed: true, moving: false, blocked: false });
    expect(board.get(entities[1]!.id)).toMatchObject({ origin: at(7, 7), placed: false, moving: true, blocked: false, conflict: false });
  });

  it("shows a move in progress as it would end: entities without a tile give way, and a taken tile blocks and is in conflict", () => {
    const entities = entitiesOf(`decider d at (0, 0) tile (1, 0.5) { }\nlamp loose at (460, 0) { }\nlamp held at (0, 0) tile (8.5, 0.5) { }\nconstant c at (0, 0) tile (0.5, 5.5) { }`);
    const [d, loose, held, c] = entities.map((entity) => entity.id) as [string, string, string, string];
    expect(arrangeBoard(entities).get(loose)).toMatchObject({ origin: at(5, 0), placed: false });
    // Over the entity without a tile: that one moves out of the way, to the nearest free place (the upper one of the nearest).
    const over = arrangeBoard(entities, new Map([[d, at(4, 0)]]));
    expect(over.get(d)).toMatchObject({ origin: at(4, 0), moving: true, blocked: false, conflict: false });
    expect(over.get(loose)).toMatchObject({ origin: at(5, -1), placed: false, moving: false, conflict: false });
    // Over an entity with a tile: blocked, and both are drawn as a conflict.
    const onto = arrangeBoard(entities, new Map([[d, at(7, 0)]]));
    expect(onto.get(d)).toMatchObject({ origin: at(7, 0), moving: true, blocked: true, conflict: true });
    expect(onto.get(held)).toMatchObject({ origin: at(8, 0), moving: false, blocked: false, conflict: true });
    expect(onto.get(c)).toMatchObject({ conflict: false });
    // A group: only the member that stands on something is marked.
    const group = arrangeBoard(entities, new Map([[d, at(7, 0)], [c, at(7, 5)]]));
    expect([group.get(d)!.blocked, group.get(c)!.blocked]).toEqual([true, false]);
  });
});

describe("the rules of editing on the board", () => {
  // d on (0, 0) and (1, 0), a lamp on (3, 0), a decider facing south on (5, 0) and (5, 1), and two entities without a tile.
  const entities = entitiesOf(
    `decider d at (0, 0) tile (1, 0.5) { }\nlamp l at (0, 0) tile (3.5, 0.5) { }\narithmetic s at (0, 0) tile (5.5, 1) facing south { }\nconstant loose at (184, 92) { }\nselector free at (0, 368) { }`,
  );
  const id = (name: string): string => entities.find((entity) => entity.name === name)!.id;
  const blocked = (moves: Readonly<Record<string, Point>>): string[] => [...blockedMoves(entities, new Map(Object.entries(moves).map(([name, origin]) => [id(name), origin])))].map((entity) => entities.find((e) => e.id === entity)!.name);

  it("blocks a move onto a tile of an entity that has a tile and is not moved, with any tile of the footprint", () => {
    expect(blocked({ d: at(0, 1) })).toEqual([]);
    expect(blocked({ d: at(1, 0) })).toEqual([]);
    // The right tile of d on the lamp, the left one on it, and d on the lower tile of s.
    expect(blocked({ d: at(2, 0) })).toEqual(["d"]);
    expect(blocked({ d: at(3, 0) })).toEqual(["d"]);
    expect(blocked({ d: at(4, 1) })).toEqual(["d"]);
    expect(blocked({ l: at(1, 0) })).toEqual(["l"]);
    expect(blocked({ l: at(2, 0) })).toEqual([]);
    // Where it stands itself is free for it: one tile to the right it covers its own old tile.
    expect(blocked({ d: at(0, 0) })).toEqual([]);
  });

  it("does not let an entity without a tile be in the way, and lets one be moved onto a free tile only", () => {
    // `loose` is shown on (2, 1): nothing is blocked there, it will give way.
    expect(arrangeBoard(entities).get(id("loose"))!.origin).toEqual(at(2, 1));
    expect(blocked({ d: at(1, 1) })).toEqual([]);
    expect(blocked({ loose: at(7, 7) })).toEqual([]);
    expect(blocked({ loose: at(3, 0), free: at(0, 2) })).toEqual(["loose"]);
  });

  it("moves a group as it is: its members are not in each other's way", () => {
    // One tile to the right d takes the place the lamp leaves.
    expect(blocked({ d: at(2, 0), l: at(4, 0) })).toEqual([]);
    expect(blocked({ d: at(2, 0), l: at(5, 0) })).toEqual(["l"]);
    expect(blocked({ d: at(3, 0), l: at(5, 0), s: at(7, 0) })).toEqual([]);
  });

  it("lets a conflict of the source be repaired by a move, and keeps it out of the way of the others", () => {
    const broken = entitiesOf(`lamp a at (0, 0) tile (0.5, 0.5) { }\nconstant b at (0, 0) tile (0.5, 0.5) { }\ndecider off at (0, 0) tile (4.5, 0.5) { }\nlamp other at (0, 0) tile (0.5, 3.5) { }`);
    const [a, b, off, other] = broken.map((entity) => entity.id) as [string, string, string, string];
    const check = (moves: [string, Point][]): number => blockedMoves(broken, new Map(moves)).size;
    expect(check([[b, at(1, 0)]])).toBe(0);
    expect(check([[other, at(1, 3)]])).toBe(0);
    // Both at once keep sharing a tile; that is their business. Back onto the other one alone is blocked.
    expect(check([[a, at(2, 2)], [b, at(2, 2)]])).toBe(0);
    expect(check([[b, at(0, 0)]])).toBe(1);
    // A tile off the grid takes the tiles of the nearest footprint, (4, 0) and (5, 0); moved, it comes onto the grid.
    expect(check([[other, at(5, 0)]])).toBe(1);
    expect(check([[other, at(6, 0)]])).toBe(0);
    expect(check([[off, at(4, 0)]])).toBe(0);
  });

  const turn = (list: readonly Entity[], turns: Readonly<Record<string, "north" | "east" | "south" | "west">>): string | undefined => {
    const name = (entity: string): string => list.find((e) => e.id === entity)!.name;
    const result = blockedTurn(list, new Map(Object.entries(turns).map(([entity, direction]) => [list.find((e) => e.name === entity)!.id, direction])));
    return result && `${name(result.entity)} onto ${name(result.obstacle)}`;
  };

  it("blocks a turn that would put a 2x1 entity onto a tile of another entity with a tile", () => {
    // d on (0, 0) and (1, 0) would come to stand on (0, 0) and (0, 1), where the lamp is.
    const tight = entitiesOf(`decider d at (0, 0) tile (1, 0.5) { }\nlamp below at (0, 0) tile (0.5, 1.5) { }\nlamp beside at (0, 0) tile (2.5, 0.5) { }\nconstant loose at (0, 92) { }`);
    expect(turn(tight, { d: "south" })).toBe("d onto below");
    expect(turn(tight, { d: "north" })).toBe("d onto below");
    // A half turn keeps both tiles; turning to where it faces changes nothing.
    expect(turn(tight, { d: "west" })).toBeUndefined();
    expect(turn(tight, { d: "east" })).toBeUndefined();
    // A 1x1 entity keeps its tile, and a lamp does not turn at all.
    expect(turn(tight, { below: "south", beside: "north" })).toBeUndefined();
    expect(turn(entities, { d: "south", s: "east" })).toBeUndefined();
  });

  it("looks at the board after the whole turn, ignores entities without a tile and does not count tiles covered before", () => {
    // Side by side, both turned: a on (0, 0) and (0, 1), b on (2, 0) and (2, 1). An entity without a tile is never in the way.
    const pair = entitiesOf(`decider a at (0, 0) tile (1, 0.5) { }\ndecider b at (0, 0) tile (3, 0.5) { }\nlamp loose at (0, 92) { }`);
    expect(arrangeBoard(pair).get(pair[2]!.id)!.origin).toEqual(at(0, 1));
    expect(turn(pair, { a: "south", b: "south" })).toBeUndefined();
    expect(turn(pair, { loose: "south" })).toBeUndefined();
    // x lies on (1, 0) and (2, 0) and would stand up onto (1, 1), the right tile of y, unless y stands up in the same step and leaves it.
    const swap = entitiesOf(`decider x at (0, 0) tile (2, 0.5) { }\ndecider y at (0, 0) tile (1, 1.5) { }`);
    expect(turn(swap, { x: "south" })).toBe("x onto y");
    expect(turn(swap, { y: "south" })).toBeUndefined();
    expect(turn(swap, { x: "south", y: "south" })).toBeUndefined();
    // b stands upright on (1, 0) and (1, 1); lying down it would need (2, 0), where the lamp is.
    const upright = entitiesOf(`decider b at (0, 0) tile (1.5, 1) facing south { }\nlamp c at (0, 0) tile (2.5, 0.5) { }`);
    expect(turn(upright, { b: "east" })).toBe("b onto c");
    expect(turn(upright, { b: "north" })).toBeUndefined();
    // Two entities on the same tiles: a turn that takes one of them to a free tile is how the conflict is repaired.
    const stacked = entitiesOf(`decider a at (0, 0) tile (1, 0.5) { }\ndecider b at (0, 0) tile (1, 0.5) { }`);
    expect(turn(stacked, { a: "south" })).toBeUndefined();
    expect(turn(stacked, { a: "west" })).toBeUndefined();
    // An entity whose tile is off the grid is first moved onto it, as the turn itself does.
    const off = entitiesOf(`decider a at (0, 0) tile (0.5, 0.5) { }\nlamp below at (0, 0) tile (0.5, 1.5) { }`);
    expect(turn(off, { a: "south" })).toBe("a onto below");
  });

  it("puts the footprint of a new entity around the pointer and lets it stand on free tiles only", () => {
    // One tile: the tile under the point. Two tiles: the point is in the middle, so it snaps where a tile ends.
    expect(footprintOriginAt({ x: 10, y: 150 }, "lamp")).toEqual(at(0, 1));
    expect(footprintOriginAt({ x: -10, y: -1 }, "constant")).toEqual(at(-1, -1));
    expect(footprintOriginAt({ x: 100, y: 40 }, "decider")).toEqual(at(0, 0));
    expect(footprintOriginAt({ x: 130, y: 40 }, "decider")).toEqual(at(1, 0));
    expect(footprintOriginAt({ x: 40, y: 100 }, "decider", "south")).toEqual(at(0, 0));
    expect(canStandAt(entities, "lamp", at(2, 0))).toBe(true);
    expect(canStandAt(entities, "lamp", at(1, 0))).toBe(false);
    expect(canStandAt(entities, "decider", at(2, 0))).toBe(false);
    expect(canStandAt(entities, "decider", at(4, 1))).toBe(false);
    // Where an entity without a tile is shown, a new one can stand.
    expect(canStandAt(entities, "decider", at(2, 1))).toBe(true);
    // Turned, it is the upright footprint that has to be free: (2, 0) and (2, 1) are, (3, -1) and (3, 0) are not.
    expect(canStandAt(entities, "decider", at(2, 0), "south")).toBe(true);
    expect(canStandAt(entities, "decider", at(3, -1), "north")).toBe(false);
  });

  it("finds the free place nearest to a wanted one for a new entity", () => {
    expect(freeOriginNear(entities, "lamp", at(9, 9))).toEqual(at(9, 9));
    // (3, 0) is the lamp: the upper of the nearest tiles. A 2x1 entity on (0, 0) has to leave d: up as well.
    expect(freeOriginNear(entities, "lamp", at(3, 0))).toEqual(at(3, -1));
    expect(freeOriginNear(entities, "decider", at(0, 0))).toEqual(at(0, -1));
    expect(freeOriginNear([], "decider", at(-4, 2))).toEqual(at(-4, 2));
    // Upright, the decider fits where it does not fit lying.
    expect(freeOriginNear(entities, "decider", at(2, 0), "north")).toEqual(at(2, 0));
    expect(freeOriginNear(entities, "decider", at(2, 0))).not.toEqual(at(2, 0));
  });

  it("gives a new entity the edit position its tile is derived from, on the grid of the edit canvas", () => {
    for (const origin of [at(0, 0), at(3, 1), at(-7, 12), at(41, -5)]) {
      const position = editPositionOf(origin);
      expect([position.x % GRID, position.y % GRID].map(Math.abs)).toEqual([0, 0]);
      expect(at(Math.round(position.x / EDIT_UNITS_PER_TILE), Math.round(position.y / EDIT_UNITS_PER_TILE))).toEqual(origin);
    }
    expect(editPositionOf(at(3, 1))).toEqual({ x: 280, y: 100 });
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
