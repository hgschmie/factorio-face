// arrangeEntities: the edit position, the tile and the direction of several entities in one change set, as mirroring a group needs it.
import { describe, expect, it } from "vitest";
import { applyChanges, arrangeEntities, EditError, executeCommand, faceEntities, type EntityArrangement, type ParseResult } from "../src/index.ts";
import { circuit, idOf, portable, valid } from "./helpers.ts";

type Named = Omit<EntityArrangement, "id"> & { readonly name: string };

function arranged(parse: ParseResult, arrangements: readonly Named[]): string {
  return applyChanges(parse.source, arrangeEntities(parse, arrangements.map(({ name, ...rest }) => ({ id: idOf(parse, name), ...rest }))));
}

const GROUP = circuit(
  [
    "constant a at (0, 0) tile (0.5, 0.5) { virtual:signal-A = 1 } // first",
    "decider b at (200, 0) tile (3, 0.5) facing west { when virtual:signal-A > 0 output virtual:signal-A = 1 }",
    "lamp c at (400, 40) { }",
    "arithmetic d { virtual:signal-B = virtual:signal-A + 1 }",
    "wire red a.out <-> b.in",
  ].join("\n"),
);
const parse = valid(GROUP);

describe("arrangeEntities", () => {
  it("writes position, tile and direction of several entities as one sorted change set and touches nothing else", () => {
    const changes = arrangeEntities(parse, [
      { id: idOf(parse, "b"), position: { x: 0, y: 0 }, tile: { x: 1, y: 0.5 }, direction: "east" },
      { id: idOf(parse, "a"), position: { x: 200, y: 0 }, tile: { x: 3.5, y: 0.5 }, direction: "west" },
    ]);
    expect(changes.map((change) => change.insert)).toEqual(["200", "3.5", " facing west", "0", "1", "east"]);
    expect([...changes].sort((x, y) => x.from - y.from)).toEqual(changes);
    const next = applyChanges(GROUP, changes);
    expect(next).toBe(GROUP.replace("a at (0, 0) tile (0.5, 0.5)", "a at (200, 0) tile (3.5, 0.5) facing west").replace("b at (200, 0) tile (3, 0.5) facing west", "b at (0, 0) tile (1, 0.5) facing east"));
    // The meaning is the same circuit with other places: the wire and every setting stay.
    expect(portable(valid(next).circuit).wires).toEqual(portable(parse.circuit).wires);
    expect(next).toContain("// first");
  });

  it("leaves alone what an arrangement does not say and what is as it says already", () => {
    expect(arrangeEntities(parse, [])).toEqual([]);
    expect(arrangeEntities(parse, [{ id: idOf(parse, "a") }, { id: idOf(parse, "b"), position: { x: 200, y: 0 }, tile: { x: 3, y: 0.5 }, direction: "west" }])).toEqual([]);
    expect(arranged(parse, [{ name: "b", position: { x: 200, y: 20 } }])).toBe(GROUP.replace("b at (200, 0)", "b at (200, 20)"));
    expect(arranged(parse, [{ name: "a", tile: { x: 0.5, y: 4.5 } }])).toBe(GROUP.replace("tile (0.5, 0.5)", "tile (0.5, 4.5)"));
    // The last arrangement given for an entity counts.
    expect(arranged(parse, [{ name: "a", position: { x: 20, y: 0 } }, { name: "a", position: { x: 40, y: 0 } }])).toBe(GROUP.replace("a at (0, 0)", "a at (40, 0)"));
  });

  it("inserts the clauses an entity lacks in their order: at, tile, facing", () => {
    expect(arranged(parse, [{ name: "d", position: { x: 20, y: 40 }, tile: { x: 1.5, y: 2 }, direction: "south" }])).toBe(GROUP.replace("arithmetic d {", "arithmetic d at (20, 40) tile (1.5, 2) facing south {"));
    expect(arranged(parse, [{ name: "c", tile: { x: 2.5, y: 2.5 } }])).toBe(GROUP.replace("c at (400, 40)", "c at (400, 40) tile (2.5, 2.5)"));
  });

  it("turns like faceEntities: a lamp is not turned, and a turned entity without a tile of its own keeps its top-left tile", () => {
    expect(arrangeEntities(parse, [{ id: idOf(parse, "c"), direction: "west" }])).toEqual([]);
    const turn = [{ id: idOf(parse, "b"), direction: "south" as const }];
    expect(arrangeEntities(parse, turn)).toEqual(faceEntities(parse, turn));
    expect(arranged(parse, [{ name: "b", direction: "south" }])).toBe(GROUP.replace("tile (3, 0.5) facing west", "tile (2.5, 1) facing south"));
    // A flipped direction covers the same tiles, so the tile stays.
    expect(arranged(parse, [{ name: "b", direction: "east" }])).toBe(GROUP.replace("facing west", "facing east"));
  });

  it("wants a tile on the grid for the direction the entity faces afterwards", () => {
    const code = (run: () => unknown): string | undefined => {
      try {
        run();
      } catch (error) {
        return error instanceof EditError ? error.code : undefined;
      }
      return "no error";
    };
    // (2.5, 1) is the center of an upright footprint: wrong while b lies, right once it is turned south.
    expect(code(() => arrangeEntities(parse, [{ id: idOf(parse, "b"), tile: { x: 2.5, y: 1 } }]))).toBe("invalid-position");
    expect(arranged(parse, [{ name: "b", tile: { x: 6.5, y: 1 }, direction: "north" }])).toBe(GROUP.replace("tile (3, 0.5) facing west", "tile (6.5, 1) facing north"));
    expect(code(() => arrangeEntities(parse, [{ id: idOf(parse, "c"), tile: { x: 1, y: 1 } }]))).toBe("invalid-position");
    expect(code(() => arrangeEntities(parse, [{ id: "nope", direction: "east" }]))).toBe("unknown-entity");
    expect(code(() => arrangeEntities(parse, [{ id: idOf(parse, "a"), direction: "up" as "north" }]))).toBe("invalid-entity");
    expect(code(() => arrangeEntities(parse, [{ id: idOf(parse, "a"), position: { x: Number.NaN, y: 0 } }]))).toBe("invalid-position");
  });

  it("runs as a command object and reports refusals as values", () => {
    const arrangements = [{ id: idOf(parse, "a"), direction: "west" as const }];
    expect(executeCommand(parse, { type: "arrangeEntities", arrangements })).toEqual({ ok: true, changes: arrangeEntities(parse, arrangements) });
    expect(executeCommand(parse, { type: "arrangeEntities", arrangements: [{ id: idOf(parse, "c"), tile: { x: 1, y: 1 } }] })).toEqual({ ok: false, code: "invalid-position", message: "tile (1, 1) is not on the tile grid for 'c'" });
    expect(executeCommand(parse, { type: "arrangeEntities", arrangements: [{ id: idOf(parse, "b"), tile: { x: 3, y: 0.5 }, direction: "south" }] })).toMatchObject({ ok: false, message: "tile (3, 0.5) is not on the tile grid for 'b' facing south" });
  });
});
