// The blueprint board: where entities without a `tile` go, what counts as a conflict, and where the pins sit on a footprint.
import { analyze } from "@face/language";
import { DIRECTIONS, facingOf, isTileCenter, occupiedTiles, prototypesOf, TERMINALS, tileHalves, tileCenter, tileOrigin, tileSize, WIRE_COLORS, type Entity, type Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { arrangeBoard, blockedMoves, blockedReshape, blockedTurn, BOARD_PIN, boardPinOffset, boardWireLine, canStandAt, derivedTiles, EDIT_UNITS_PER_TILE, editPositionOf, footprintOriginAt, freeOriginNear, TILE, WIRE_PIN_CLEARANCE } from "../src/canvas/board.ts";
import { CARD, GRID, PIN_SPACING } from "../src/canvas/geometry.ts";
import { EXAMPLE_SOURCE } from "./fixtures/example.ts";
import { gridSource } from "../../../tests/e2e/fixtures.ts";

function entitiesOf(source: string): readonly Entity[] {
  const result = analyze(source.includes("circuit ") ? source : `circuit "t" {\n${source}\n}\n`);
  if (!result.circuit) throw new Error(JSON.stringify(result.diagnostics));
  return result.circuit.entities;
}

/** The tiles every entity covers, by name. */
function tilesByName(entities: readonly Entity[]): Record<string, Point[]> {
  const derived = derivedTiles(entities);
  return Object.fromEntries(entities.map((entity) => [entity.name, occupiedTiles(entity, facingOf(entity), entity.placement?.tile ?? derived.get(entity.id)!)]));
}

function expectNoOverlap(entities: readonly Entity[]): void {
  const all = Object.values(tilesByName(entities)).flat().map((tile) => `${tile.x},${tile.y}`);
  expect(new Set(all).size).toBe(all.length);
}

const at = (x: number, y: number): Point => ({ x, y });

describe("derivedTiles", () => {
  it("scales the corner of the card down to a tile, half a card width per tile in both directions", () => {
    expect(EDIT_UNITS_PER_TILE).toBe(CARD.width / 2);
    const entities = entitiesOf(EXAMPLE_SOURCE);
    // source (40, 80), gate (300, 80), twice (300, 240), light (560, 80): three tiles between the columns, two between the rows.
    expect(tilesByName(entities)).toEqual({ source: [at(0, 1)], gate: [at(3, 1), at(4, 1)], twice: [at(3, 3), at(4, 3)], light: [at(6, 1)] });
    expect([...derivedTiles(entities).values()]).toEqual([at(0.5, 1.5), at(4, 1.5), at(4, 3.5), at(6.5, 1.5)]);
  });

  it("gives centers that are on the grid for the kind and the facing, and none for an entity that has a tile", () => {
    const entities = entitiesOf(`constant-combinator c at (-100, -100) facing north { }\ndecider-combinator d at (0, 0) facing south { }\nselector-combinator s at (0, 400) facing west { }\nsmall-lamp l at (400, 0) { }\narithmetic-combinator placed at (0, 0) tile (20, 0.5) { }`);
    const derived = derivedTiles(entities);
    expect([...derived.keys()]).toEqual(entities.slice(0, 4).map((entity) => entity.id));
    for (const entity of entities.slice(0, 4)) expect(isTileCenter(entity, facingOf(entity), derived.get(entity.id)!), entity.name).toBe(true);
    expect(tilesByName(entities)).toMatchObject({ c: [at(-1, -1)], d: [at(0, 0), at(0, 1)], s: [at(0, 4), at(1, 4)], l: [at(4, 0)] });
  });

  it("moves an entity whose place is taken to the nearest free one: ring by ring, the nearest first, then the upper, then the left", () => {
    // Five lamps on one spot: the second goes above (the upper of the four nearest), then left, right, below.
    const lamps = entitiesOf([1, 2, 3, 4, 5, 6].map((n) => `small-lamp l${n} at (200, 200) { }`).join("\n"));
    expect(tilesByName(lamps)).toEqual({ l1: [at(2, 2)], l2: [at(2, 1)], l3: [at(1, 2)], l4: [at(3, 2)], l5: [at(2, 3)], l6: [at(1, 1)] });
    // A 2x1 entity needs both of its tiles: one tile to the left it would still stand on the lamp, so the second one goes right.
    const long = entitiesOf(`small-lamp l at (200, 200) { }\ndecider-combinator d at (200, 200) { }\ndecider-combinator e at (200, 200) { }`);
    expect(tilesByName(long)).toEqual({ l: [at(2, 2)], d: [at(2, 1), at(3, 1)], e: [at(3, 2), at(4, 2)] });
    expectNoOverlap(long);
  });

  it("keeps clear of the entities that have a tile, wherever they come in the circuit", () => {
    const entities = entitiesOf(`decider-combinator loose at (0, 0) { }\nconstant-combinator early at (92, 0) { }\ndecider-combinator placed at (900, 900) tile (1, 0.5) { }\nsmall-lamp lamp1 at (0, 0) { }`);
    const tiles = tilesByName(entities);
    expect(tiles.placed).toEqual([at(0, 0), at(1, 0)]);
    expect(tiles.loose).toEqual([at(0, -1), at(1, -1)]);
    // (1, 0) is taken by `placed`, above it stands `loose`, to the left is `placed` again.
    expect(tiles.early).toEqual([at(2, 0)]);
    expect(tiles.lamp1).toEqual([at(-1, 0)]);
    expectNoOverlap(entities);
  });

  it("is the same for the same circuit and leaves no overlap in a crowded one", () => {
    const crowded = entitiesOf(Array.from({ length: 60 }, (_, i) => `${i % 3 === 0 ? "small-lamp" : "arithmetic-combinator"} n${i} at (${(i % 4) * 40}, ${(i % 5) * 40})${i % 3 === 1 ? " facing south" : ""} { }`).join("\n"));
    expect([...derivedTiles(crowded)]).toEqual([...derivedTiles(crowded)]);
    expectNoOverlap(crowded);
    const grid = entitiesOf(gridSource(200, 20));
    expectNoOverlap(grid);
    // Cards that do not overlap in the edit layout keep their place: nothing had to give way.
    const derived = derivedTiles(grid);
    for (const entity of grid) expect(tileOrigin(entity, "east", derived.get(entity.id)!)).toEqual(at(Math.round(entity.position.x / EDIT_UNITS_PER_TILE), Math.round(entity.position.y / EDIT_UNITS_PER_TILE)));
  });
});

describe("arrangeBoard", () => {
  it("puts placed entities on their tile and derived ones where derivedTiles says", () => {
    const entities = entitiesOf(`constant-combinator c at (0, 0) tile (2.5, -0.5) facing north { }\ndecider-combinator d at (184, 92) facing south { }`);
    const [c, d] = entities.map((entity) => arrangeBoard(entities).get(entity.id)!);
    expect(c).toEqual({ origin: at(2, -1), size: { width: 1, height: 1 }, facing: "north", placed: true, conflict: false, moving: false, blocked: false });
    expect(d).toEqual({ origin: at(2, 1), size: { width: 1, height: 2 }, facing: "south", placed: false, conflict: false, moving: false, blocked: false });
  });

  it("marks a tile that is off the grid and tiles that are shared, and draws both where the tile says", () => {
    const entities = entitiesOf(`decider-combinator off at (0, 0) tile (0.5, 0.5) { }\nsmall-lamp a at (0, 0) tile (5.5, 5.5) { }\nconstant-combinator b at (0, 0) tile (5.5, 5.5) { }\nsmall-lamp fine at (0, 0) tile (9.5, 9.5) { }\nsmall-lamp loose at (460, 460) { }`);
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
    const entities = entitiesOf(`decider-combinator d at (0, 0) tile (1, 0.5) { }\nsmall-lamp l at (0, 0) { }`);
    const board = arrangeBoard(entities, new Map([[entities[1]!.id, at(7, 7)]]));
    expect(board.get(entities[0]!.id)).toMatchObject({ origin: at(0, 0), placed: true, moving: false, blocked: false });
    expect(board.get(entities[1]!.id)).toMatchObject({ origin: at(7, 7), placed: false, moving: true, blocked: false, conflict: false });
  });

  it("shows a move in progress as it would end: entities without a tile give way, and a taken tile blocks and is in conflict", () => {
    const entities = entitiesOf(`decider-combinator d at (0, 0) tile (1, 0.5) { }\nsmall-lamp loose at (460, 0) { }\nsmall-lamp held at (0, 0) tile (8.5, 0.5) { }\nconstant-combinator c at (0, 0) tile (0.5, 5.5) { }`);
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
    `decider-combinator d at (0, 0) tile (1, 0.5) { }\nsmall-lamp l at (0, 0) tile (3.5, 0.5) { }\narithmetic-combinator s at (0, 0) tile (5.5, 1) facing south { }\nconstant-combinator loose at (184, 92) { }\nselector-combinator free at (0, 368) { }`,
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
    const broken = entitiesOf(`small-lamp a at (0, 0) tile (0.5, 0.5) { }\nconstant-combinator b at (0, 0) tile (0.5, 0.5) { }\ndecider-combinator off at (0, 0) tile (4.5, 0.5) { }\nsmall-lamp other at (0, 0) tile (0.5, 3.5) { }`);
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
    const tight = entitiesOf(`decider-combinator d at (0, 0) tile (1, 0.5) { }\nsmall-lamp below at (0, 0) tile (0.5, 1.5) { }\nsmall-lamp beside at (0, 0) tile (2.5, 0.5) { }\nconstant-combinator loose at (0, 92) { }`);
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
    const pair = entitiesOf(`decider-combinator a at (0, 0) tile (1, 0.5) { }\ndecider-combinator b at (0, 0) tile (3, 0.5) { }\nsmall-lamp loose at (0, 92) { }`);
    expect(arrangeBoard(pair).get(pair[2]!.id)!.origin).toEqual(at(0, 1));
    expect(turn(pair, { a: "south", b: "south" })).toBeUndefined();
    expect(turn(pair, { loose: "south" })).toBeUndefined();
    // x lies on (1, 0) and (2, 0) and would stand up onto (1, 1), the right tile of y, unless y stands up in the same step and leaves it.
    const swap = entitiesOf(`decider-combinator x at (0, 0) tile (2, 0.5) { }\ndecider-combinator y at (0, 0) tile (1, 1.5) { }`);
    expect(turn(swap, { x: "south" })).toBe("x onto y");
    expect(turn(swap, { y: "south" })).toBeUndefined();
    expect(turn(swap, { x: "south", y: "south" })).toBeUndefined();
    // b stands upright on (1, 0) and (1, 1); lying down it would need (2, 0), where the lamp is.
    const upright = entitiesOf(`decider-combinator b at (0, 0) tile (1.5, 1) facing south { }\nsmall-lamp c at (0, 0) tile (2.5, 0.5) { }`);
    expect(turn(upright, { b: "east" })).toBe("b onto c");
    expect(turn(upright, { b: "north" })).toBeUndefined();
    // Two entities on the same tiles: a turn that takes one of them to a free tile is how the conflict is repaired.
    const stacked = entitiesOf(`decider-combinator a at (0, 0) tile (1, 0.5) { }\ndecider-combinator b at (0, 0) tile (1, 0.5) { }`);
    expect(turn(stacked, { a: "south" })).toBeUndefined();
    expect(turn(stacked, { a: "west" })).toBeUndefined();
    // An entity whose tile is off the grid is first moved onto it, as the turn itself does.
    const off = entitiesOf(`decider-combinator a at (0, 0) tile (0.5, 0.5) { }\nsmall-lamp below at (0, 0) tile (0.5, 1.5) { }`);
    expect(turn(off, { a: "south" })).toBe("a onto below");
  });

  it("puts the footprint of a new entity around the pointer and lets it stand on free tiles only", () => {
    // One tile: the tile under the point. Two tiles: the point is in the middle, so it snaps where a tile ends.
    expect(footprintOriginAt({ x: 10, y: 150 }, { prototype: "small-lamp" })).toEqual(at(0, 1));
    expect(footprintOriginAt({ x: -10, y: -1 }, { prototype: "constant-combinator" })).toEqual(at(-1, -1));
    expect(footprintOriginAt({ x: 100, y: 40 }, { prototype: "decider-combinator" })).toEqual(at(0, 0));
    expect(footprintOriginAt({ x: 130, y: 40 }, { prototype: "decider-combinator" })).toEqual(at(1, 0));
    expect(footprintOriginAt({ x: 40, y: 100 }, { prototype: "decider-combinator" }, "south")).toEqual(at(0, 0));
    expect(canStandAt(entities, { prototype: "small-lamp" }, at(2, 0))).toBe(true);
    expect(canStandAt(entities, { prototype: "small-lamp" }, at(1, 0))).toBe(false);
    expect(canStandAt(entities, { prototype: "decider-combinator" }, at(2, 0))).toBe(false);
    expect(canStandAt(entities, { prototype: "decider-combinator" }, at(4, 1))).toBe(false);
    // Where an entity without a tile is shown, a new one can stand.
    expect(canStandAt(entities, { prototype: "decider-combinator" }, at(2, 1))).toBe(true);
    // Turned, it is the upright footprint that has to be free: (2, 0) and (2, 1) are, (3, -1) and (3, 0) are not.
    expect(canStandAt(entities, { prototype: "decider-combinator" }, at(2, 0), "south")).toBe(true);
    expect(canStandAt(entities, { prototype: "decider-combinator" }, at(3, -1), "north")).toBe(false);
  });

  it("finds the free place nearest to a wanted one for a new entity", () => {
    expect(freeOriginNear(entities, { prototype: "small-lamp" }, at(9, 9))).toEqual(at(9, 9));
    // (3, 0) is the lamp: the upper of the nearest tiles. A 2x1 entity on (0, 0) has to leave d: up as well.
    expect(freeOriginNear(entities, { prototype: "small-lamp" }, at(3, 0))).toEqual(at(3, -1));
    expect(freeOriginNear(entities, { prototype: "decider-combinator" }, at(0, 0))).toEqual(at(0, -1));
    expect(freeOriginNear([], { prototype: "decider-combinator" }, at(-4, 2))).toEqual(at(-4, 2));
    // Upright, the decider fits where it does not fit lying.
    expect(freeOriginNear(entities, { prototype: "decider-combinator" }, at(2, 0), "north")).toEqual(at(2, 0));
    expect(freeOriginNear(entities, { prototype: "decider-combinator" }, at(2, 0))).not.toEqual(at(2, 0));
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
  const standard = (kind: (typeof kinds)[number]) => ({ prototype: prototypesOf(kind)[0]! });

  it("puts the input pins on the input half and the output pins on the output half, at the outer end of the tile", () => {
    for (const kind of kinds) {
      for (const facing of kind === "lamp" ? (["east"] as const) : DIRECTIONS) {
        const halves = tileHalves(standard(kind), facing, tileCenter(standard(kind), facing, at(0, 0)));
        for (const side of TERMINALS[kind]) {
          const half = side === "out" ? halves.output : halves.input;
          for (const color of WIRE_COLORS) {
            const pin = boardPinOffset(standard(kind), facing, side, color);
            expect({ x: Math.floor(pin.x / TILE), y: Math.floor(pin.y / TILE), width: 1, height: 1 }, `${kind} ${facing} ${side} ${color}`).toEqual(half);
            const size = tileSize(standard(kind), facing);
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
    expect(boardPinOffset({ prototype: "decider-combinator" }, "east", "in", "red")).toEqual(at(12, 30));
    expect(boardPinOffset({ prototype: "decider-combinator" }, "east", "in", "green")).toEqual(at(12, 50));
    expect(boardPinOffset({ prototype: "decider-combinator" }, "east", "out", "red")).toEqual(at(148, 30));
    expect(boardPinOffset({ prototype: "decider-combinator" }, "east", "out", "green")).toEqual(at(148, 50));
    // Facing south: output at the bottom, red right of green.
    expect(boardPinOffset({ prototype: "decider-combinator" }, "south", "out", "red")).toEqual(at(50, 148));
    expect(boardPinOffset({ prototype: "decider-combinator" }, "south", "in", "green")).toEqual(at(30, 12));
    // Facing west: output on the left, red below green.
    expect(boardPinOffset({ prototype: "decider-combinator" }, "west", "out", "red")).toEqual(at(12, 50));
    expect(boardPinOffset({ prototype: "decider-combinator" }, "west", "in", "red")).toEqual(at(148, 50));
    // Facing north: output on top, red left of green.
    expect(boardPinOffset({ prototype: "decider-combinator" }, "north", "out", "red")).toEqual(at(30, 12));
    expect(boardPinOffset({ prototype: "decider-combinator" }, "north", "in", "green")).toEqual(at(50, 148));
    for (const facing of DIRECTIONS) {
      const [red, green] = WIRE_COLORS.map((color) => boardPinOffset({ prototype: "constant-combinator" }, facing, "out", color));
      expect(Math.hypot(red!.x - green!.x, red!.y - green!.y)).toBe(PIN_SPACING);
    }
    // A lamp has its input on the west end of its tile, a constant its output where it faces.
    expect(boardPinOffset({ prototype: "small-lamp" }, "east", "in", "red")).toEqual(at(12, 30));
    expect(boardPinOffset({ prototype: "constant-combinator" }, "north", "out", "green")).toEqual(at(50, 12));
  });

  it("puts the pins of a speaker where a lamp has them and the one point of a pole in the middle of the top end, also on 2x2 tiles", () => {
    expect(boardPinOffset({ prototype: "programmable-speaker" }, "east", "in", "red")).toEqual(at(12, 30));
    // A pole has no direction: its point is at the top, red left of green at one height, whatever facing it is asked with.
    for (const facing of DIRECTIONS) {
      expect(boardPinOffset({ prototype: "small-electric-pole" }, facing, "io", "red")).toEqual(at(30, 12));
      expect(boardPinOffset({ prototype: "small-electric-pole" }, facing, "io", "green")).toEqual(at(50, 12));
    }
    for (const prototype of ["big-electric-pole", "substation"] as const) {
      expect(boardPinOffset({ prototype }, "east", "io", "red")).toEqual(at(70, 12));
      expect(boardPinOffset({ prototype }, "east", "io", "green")).toEqual(at(90, 12));
    }
    // Side by side around the middle of the top end, one pin spacing apart and one inset below it, as the pins of an output at the top are.
    const [red, green] = WIRE_COLORS.map((color) => boardPinOffset({ prototype: "small-electric-pole" }, "east", "io", color));
    expect([green!.x - red!.x, green!.y - red!.y]).toEqual([PIN_SPACING, 0]);
    expect((red!.x + green!.x) / 2).toBe(TILE / 2);
    expect([red, green]).toEqual(WIRE_COLORS.map((color) => boardPinOffset({ prototype: "constant-combinator" }, "north", "out", color)));
  });

  it("arranges poles and speakers on the board with the tiles their prototype covers", () => {
    const circuit = { entities: entitiesOf("big-electric-pole big at (0, 0) tile (1, 1) { }\nsmall-electric-pole small at (0, 0) tile (3.5, 0.5) { }\nprogrammable-speaker s at (0, 0) { }\nsubstation loose at (0, 0) { }") };
    const placements = arrangeBoard(circuit.entities);
    const [big, small, speaker, loose] = circuit.entities.map((entity) => placements.get(entity.id)!);
    expect([big!.origin, big!.size, big!.conflict]).toEqual([at(0, 0), { width: 2, height: 2 }, false]);
    expect([small!.origin, small!.size]).toEqual([at(3, 0), { width: 1, height: 1 }]);
    // Without a tile they give way: the speaker to the big pole, the substation with all four of its tiles to everything.
    expect([speaker!.placed, speaker!.size]).toEqual([false, { width: 1, height: 1 }]);
    expect(loose!.size).toEqual({ width: 2, height: 2 });
    const taken = new Set(circuit.entities.flatMap((entity) => occupiedTiles(entity, "east", entity.placement?.tile ?? derivedTiles(circuit.entities).get(entity.id)!).map((tile) => `${tile.x},${tile.y}`)));
    expect(taken.size).toBe(4 + 1 + 1 + 4);
    // A lamp cannot be put onto a tile of the big pole, and a turn does nothing to it.
    expect(canStandAt(circuit.entities, { prototype: "small-lamp" }, at(1, 1))).toBe(false);
    expect(canStandAt(circuit.entities, { prototype: "big-electric-pole" }, at(2, 0))).toBe(false);
    expect(canStandAt(circuit.entities, { prototype: "big-electric-pole" }, at(4, 0))).toBe(true);
    expect(blockedTurn(circuit.entities, new Map([[circuit.entities[0]!.id, "south"]]))).toBeUndefined();
    expect(footprintOriginAt({ x: 160, y: 160 }, { prototype: "substation" })).toEqual(at(1, 1));
  });
});

describe("the line of a wire on the board", () => {
  /** The pins of a pole on one tile whose top-left tile is (x, y), by color. */
  const pole = (x: number, y: number): Record<"red" | "green", Point> => ({ red: at(x * TILE + 30, y * TILE + 12), green: at(x * TILE + 50, y * TILE + 12) });
  const line = (color: "red" | "green", a: Record<"red" | "green", Point>, b: Record<"red" | "green", Point>): Point[] => {
    const other = color === "red" ? "green" : "red";
    return boardWireLine(color, a[color], b[color], [a[other], b[other]]);
  };
  /** Distance from `point` to the segment between `from` and `to`. */
  const distanceTo = (point: Point, from: Point, to: Point): number => {
    const [dx, dy] = [to.x - from.x, to.y - from.y];
    const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
  };
  const clearance = (points: readonly Point[], pin: Point): number => Math.min(...points.slice(1).map((point, index) => distanceTo(pin, points[index]!, point)));

  it("is straight where the pin of the other color is not in its way", () => {
    const [a, below, diagonal] = [pole(0, 0), pole(0, 3), pole(3, 3)];
    for (const color of WIRE_COLORS) {
      // In a column the two colors are a pin spacing apart, on a diagonal of 45 degrees 14 units: neither comes near the pin of the other.
      expect(line(color, a, below)).toEqual([a[color], below[color]]);
      expect(line(color, a, diagonal)).toEqual([a[color], diagonal[color]]);
    }
    expect(boardWireLine("red", at(12, 30), at(148, 30), [at(12, 50), at(148, 50)])).toEqual([at(12, 30), at(148, 30)]);
  });

  it("runs red above and green below the pins of poles in a row, each stepping over to its own pins", () => {
    const [a, b] = [pole(0, 0), pole(3, 0)];
    expect(line("red", a, b)).toEqual([at(30, 12), at(30, 2), at(270, 2), at(270, 12)]);
    expect(line("green", a, b)).toEqual([at(50, 12), at(50, 22), at(290, 22), at(290, 12)]);
    // The red wire passes the green pin of the left pole, the green wire the red pin of the right one.
    expect(clearance(line("red", a, b), a.green)).toBe(WIRE_PIN_CLEARANCE);
    expect(clearance(line("green", a, b), b.red)).toBe(WIRE_PIN_CLEARANCE);
    expect(WIRE_PIN_CLEARANCE).toBe(PIN_SPACING / 2);
  });

  it("does not depend on the order of the ends", () => {
    const a = pole(0, 0);
    for (const [x, y] of [[3, 0], [-3, 0], [0, 3], [0, -3], [5, 1], [5, -1], [-5, 1], [-5, -1], [2, 2], [1, 6]] as const) {
      // Up to rounding: the path of a wire has two decimals.
      const rounded = (points: readonly Point[]): Point[] => points.map((point) => at(Math.round(point.x * 1000) / 1000, Math.round(point.y * 1000) / 1000));
      for (const color of WIRE_COLORS) expect(rounded(line(color, pole(x, y), a)), `${color} ${x},${y}`).toEqual(rounded(line(color, a, pole(x, y)).toReversed()));
    }
  });

  it("keeps the two colors of poles on a shallow diagonal off each other's pins and at least as far apart, without crossing", () => {
    const a = pole(0, 0);
    for (const [x, y] of [[5, 1], [5, -1], [-5, 1], [-5, -1], [9, 1], [3, 1], [-3, -1], [2, 1]] as const) {
      const b = pole(x, y);
      const [red, green] = [line("red", a, b), line("green", a, b)];
      for (const pin of [a.green, b.green]) expect(clearance(red, pin), `red ${x},${y}`).toBeGreaterThanOrEqual(WIRE_PIN_CLEARANCE - 1e-9);
      for (const pin of [a.red, b.red]) expect(clearance(green, pin), `green ${x},${y}`).toBeGreaterThanOrEqual(WIRE_PIN_CLEARANCE - 1e-9);
      // The long runs are parallels on the same side of each other at both ends.
      const run = (points: readonly Point[]): [Point, Point] => (points.length === 2 ? [points[0]!, points[1]!] : [points[1]!, points[2]!]);
      const [[r1, r2], [g1, g2]] = [run(red), run(green)];
      const side = (point: Point): number => Math.sign((r2.x - r1.x) * (point.y - r1.y) - (r2.y - r1.y) * (point.x - r1.x));
      expect(side(g1), `${x},${y}`).toBe(side(g2));
      expect(distanceTo(g1, r1, r2), `${x},${y}`).toBeGreaterThanOrEqual(WIRE_PIN_CLEARANCE - 1e-9);
    }
  });

  it("steps aside in a column of combinators as in a row of poles: red to the left, green to the right", () => {
    // The inputs of two deciders facing east, one tile row below the other: red (12, 30) and green (12, 50) on both.
    const [upper, lower] = [{ red: at(12, 30), green: at(12, 50) }, { red: at(12, 190), green: at(12, 210) }];
    expect(line("red", upper, lower)).toEqual([at(12, 30), at(2, 30), at(2, 190), at(12, 190)]);
    expect(line("green", upper, lower)).toEqual([at(12, 50), at(22, 50), at(22, 210), at(12, 210)]);
  });
});

describe("another prototype on the board", () => {
  const entities = entitiesOf("small-electric-pole p at (0, 0) tile (2.5, 0.5) { }\nsmall-lamp right at (0, 0) tile (3.5, 0.5) { }\nsmall-lamp below at (0, 0) tile (2.5, 2.5) { }\nsmall-lamp loose at (0, 0) { }");
  const [pole, right] = entities as [Entity, Entity];
  const big = (tile: Point): Entity => ({ ...pole, prototype: "big-electric-pole", placement: { tile } }) as Entity;

  it("is blocked by the entity whose tile the bigger footprint would newly cover", () => {
    // From the tile (2, 0) a big pole covers (2..3, 0..1): the lamp on (3, 0) is in the way.
    expect(blockedReshape(entities, big({ x: 3, y: 1 }))).toBe(right.id);
    // One tile further left it covers (1..2, 0..1), which is free: the lamp below stands on (2, 2).
    expect(blockedReshape(entities, big({ x: 2, y: 1 }))).toBeUndefined();
  });

  it("is never blocked without a tile, by an entity without one, or by the tiles the entity covers already", () => {
    expect(blockedReshape(entities, { ...pole, prototype: "big-electric-pole", placement: undefined } as Entity)).toBeUndefined();
    expect(blockedReshape(entities.slice(2), big({ x: 3, y: 1 }))).toBeUndefined();
    const crowded = entitiesOf("substation p at (0, 0) tile (3, 1) { }\nsmall-lamp inside at (0, 0) tile (3.5, 1.5) { }");
    expect(blockedReshape(crowded, { ...crowded[0]!, prototype: "big-electric-pole" } as Entity)).toBeUndefined();
    expect(blockedReshape(crowded, { ...crowded[0]!, prototype: "small-electric-pole", placement: { tile: { x: 2.5, y: 0.5 } } } as Entity)).toBeUndefined();
  });
});
