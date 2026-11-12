import type { Entity, Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { analyze, applyChanges, EditError, executeCommand, setTiles, updateEntity, type ParseResult } from "../src/index.ts";
import { circuit, fixture, idOf, valid } from "./helpers.ts";

const comments = fixture("comments.face");
const parsed = valid(comments);

/** The source after the named entities got a tile (or lost theirs, for `undefined`), as one edit. */
function tiled(parse: ParseResult, tiles: Readonly<Record<string, Point | undefined>>): string {
  return applyChanges(parse.source, setTiles(parse, Object.entries(tiles).map(([name, tile]) => ({ id: idOf(parse, name), tile }))));
}

function tileOf(source: string, name: string): Point | undefined {
  return valid(source).circuit.entities.find((entity) => entity.name === name)!.placement?.tile;
}

function failure(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof EditError) return error.code;
    throw error;
  }
  return "no failure";
}

describe("setTiles", () => {
  it("inserts the clause behind the position and touches nothing else, comments included", () => {
    const changes = setTiles(parsed, [{ id: idOf(parsed, "twice"), tile: { x: 3, y: -1.5 } }]);
    const at = comments.indexOf("twice at (300, 80)") + "twice at (300, 80)".length;
    expect(changes).toEqual([{ from: at, to: at, insert: " tile (3, -1.5)" }]);
    const next = applyChanges(comments, changes);
    expect(tileOf(next, "twice")).toEqual({ x: 3, y: -1.5 });
    expect(next.match(/\/\/.*|\/\*[^]*?\*\//g)).toEqual(comments.match(/\/\/.*|\/\*[^]*?\*\//g));
    expect(analyze(next).diagnostics).toEqual(parsed.diagnostics);
  });

  it("puts a new clause behind at, wherever that stands, or behind the name, always in front of a facing that follows", () => {
    const parse = valid(circuit("constant a { }\nconstant b at (0, 0) facing north { }\nconstant c facing west at (20, 40) { }\nconstant d facing south {\n}"));
    const tile = { x: 0.5, y: 0.5 };
    expect(tiled(parse, { a: tile, b: { x: 1.5, y: 0.5 }, c: { x: 2.5, y: 0.5 }, d: { x: 3.5, y: 0.5 } })).toBe(
      circuit("constant a tile (0.5, 0.5) { }\nconstant b at (0, 0) tile (1.5, 0.5) facing north { }\nconstant c facing west at (20, 40) tile (2.5, 0.5) { }\nconstant d tile (3.5, 0.5) facing south {\n}"),
    );
    // An entity without `at` keeps the position the editor chose for it.
    expect(valid(tiled(parse, { a: tile })).circuit.entities[0]!.position).toEqual(parse.circuit.entities[0]!.position);
  });

  it("patches only the numbers that change, whatever surrounds them", () => {
    const parse = valid(circuit("lamp a tile ( 0.5 ,/* y */ -1.5 ) at (0, 0) { } // kept\nlamp b at (0, 0) tile (2.5, 2.5) { }"));
    const changes = setTiles(parse, [{ id: idOf(parse, "a"), tile: { x: 0.5, y: 7.5 } }, { id: idOf(parse, "b"), tile: { x: -3.5, y: 2.5 } }]);
    expect(changes.map((change) => [parse.source.slice(change.from, change.to), change.insert])).toEqual([["-1.5", "7.5"], ["2.5", "-3.5"]]);
    expect(applyChanges(parse.source, changes)).toBe(circuit("lamp a tile ( 0.5 ,/* y */ 7.5 ) at (0, 0) { } // kept\nlamp b at (0, 0) tile (-3.5, 2.5) { }"));
    expect(setTiles(parse, [{ id: idOf(parse, "a"), tile: { x: 0.5, y: -1.5 } }])).toEqual([]);
  });

  it("removes the clause with the blanks in front of it and leaves an entity without one alone", () => {
    const parse = valid(circuit("lamp a at (0, 0)   tile (0.5, 0.5) { } // kept\ndecider b tile (1, 1.5) facing east at (0, 200) { }\nlamp c tile (5.5, 5.5) { }\nlamp d { }"));
    expect(tiled(parse, { a: undefined, b: undefined, c: undefined, d: undefined })).toBe(circuit("lamp a at (0, 0) { } // kept\ndecider b facing east at (0, 200) { }\nlamp c { }\nlamp d { }"));
    expect(setTiles(parse, [{ id: idOf(parse, "d"), tile: undefined }])).toEqual([]);
  });

  it("gives several entities their tiles in one sorted change set and takes the last tile given for an entity", () => {
    const ids = parsed.circuit.entities.map((entity) => entity.id);
    // constant, arithmetic (2x1, facing east) and lamp in a row.
    const centers = [{ x: 0.5, y: 0.5 }, { x: 2, y: 0.5 }, { x: 3.5, y: 0.5 }];
    const changes = setTiles(parsed, [{ id: ids[0]!, tile: { x: 9.5, y: 9.5 } }, ...ids.map((id, i) => ({ id, tile: centers[i]! }))]);
    expect(changes).toHaveLength(3);
    for (let i = 1; i < changes.length; i++) expect(changes[i]!.from).toBeGreaterThan(changes[i - 1]!.to);
    const next = valid(applyChanges(comments, changes));
    expect(next.circuit.entities.map((entity) => entity.placement)).toEqual(centers.map((tile) => ({ tile })));
    expect(next.diagnostics).toEqual([]);
    // Nothing but the clauses differs.
    expect(next.circuit.entities.map(({ placement: _placement, ...entity }) => entity)).toEqual(parsed.circuit.entities);
    expect(next.circuit.wires).toEqual(parsed.circuit.wires);
  });

  it("accepts only a center on the grid for the kind and the direction of the entity", () => {
    const parse = valid(circuit("lamp l facing north { }\nconstant c { }\ndecider e { }\ndecider n facing north { }\nselector w facing west { }"));
    const set = (name: string, x: number, y: number) => failure(() => setTiles(parse, [{ id: idOf(parse, name), tile: { x, y } }]));
    // A lamp is 1x1 and its `facing` means nothing.
    expect([set("l", 0.5, 0.5), set("c", -0.5, 2.5), set("e", 1, 0.5), set("n", 0.5, 1), set("w", -2, 0.5)]).toEqual(Array(5).fill("no failure"));
    expect([set("l", 0, 0.5), set("c", 0.5, 1), set("e", 0.5, 1), set("e", 0.5, 0.5), set("n", 1, 0.5), set("w", 0.5, 2)]).toEqual(Array(6).fill("invalid-position"));
    expect([set("c", Number.NaN, 0.5), set("c", 0.5, Number.POSITIVE_INFINITY), set("e", 1.25, 0.5)]).toEqual(Array(3).fill("invalid-position"));
    // One bad tile refuses the whole command.
    expect(failure(() => setTiles(parse, [{ id: idOf(parse, "c"), tile: { x: 0.5, y: 0.5 } }, { id: idOf(parse, "e"), tile: { x: 0.5, y: 0.5 } }]))).toBe("invalid-position");
  });

  it("does not check for overlaps: the analysis warns about them", () => {
    const parse = valid(circuit("lamp a tile (0.5, 0.5) { }\nlamp b { }"));
    const next = tiled(parse, { b: { x: 0.5, y: 0.5 } });
    expect(analyze(next).diagnostics.map((d) => d.code)).toEqual(["tile-overlap", "tile-overlap"]);
  });

  it("refuses unknown entities and invalid source as typed failures and runs as a command object", () => {
    const id = idOf(parsed, "source");
    expect(failure(() => setTiles(parsed, [{ id: "nope", tile: undefined }]))).toBe("unknown-entity");
    expect(failure(() => setTiles(analyze(comments.replace("* 2", "*")), []))).toBe("invalid-source");
    expect(setTiles(parsed, [])).toEqual([]);
    expect(executeCommand(parsed, { type: "setTiles", tiles: [{ id, tile: { x: 0.5, y: 0.5 } }] })).toEqual({ ok: true, changes: [expect.objectContaining({ insert: " tile (0.5, 0.5)" })] });
    expect(executeCommand(parsed, { type: "setTiles", tiles: [{ id, tile: { x: 1, y: 0.5 } }] })).toMatchObject({ ok: false, code: "invalid-position" });
    expect(executeCommand(parsed, { type: "setTiles", tiles: [{ id: "nope", tile: undefined }] })).toMatchObject({ ok: false, code: "unknown-entity" });
  });
});

describe("updateEntity and the tile", () => {
  const update = (source: string, name: string, change: (entity: Entity) => Entity): string => {
    const parse = valid(source);
    const entity = parse.circuit.entities.find((e) => e.name === name)!;
    return applyChanges(source, updateEntity(parse, entity.id, change(entity)));
  };

  it("sets, changes and removes the tile as a patch of the clause", () => {
    const source = circuit("lamp l at (0, 0) /* where */ tile ( 0.5, 0.5 ) { } // kept\nconstant c { item:a = 1 }");
    expect(update(source, "l", (e) => ({ ...e, placement: { tile: { x: 0.5, y: -2.5 } } }))).toBe(source.replace("( 0.5, 0.5 )", "( 0.5, -2.5 )"));
    expect(update(source, "l", (e) => ({ ...e, placement: undefined }))).toBe(source.replace(" tile ( 0.5, 0.5 )", ""));
    expect(update(source, "c", (e) => ({ ...e, placement: { tile: { x: 1.5, y: 0.5 } } }))).toBe(source.replace("constant c", "constant c tile (1.5, 0.5)"));
    expect(update(source, "l", (e) => e)).toBe(source);
  });
});
