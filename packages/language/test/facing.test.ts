import { DEFAULT_FACING, DIRECTIONS, type Direction } from "@face/model";
import { describe, expect, it } from "vitest";
import { analyze, applyChanges, EditError, executeCommand, faceEntities, printCircuit, type ParseResult } from "../src/index.ts";
import { circuit, fixture, idOf, valid } from "./helpers.ts";

const comments = fixture("comments.face");
const parsed = valid(comments);

/** The source after the named entities were made to face a direction, as one edit. */
function faced(parse: ParseResult, facings: Readonly<Record<string, Direction>>): string {
  return applyChanges(parse.source, faceEntities(parse, Object.entries(facings).map(([name, direction]) => ({ id: idOf(parse, name), direction }))));
}

function directionOf(source: string, name: string): Direction | undefined {
  return valid(source).circuit.entities.find((entity) => entity.name === name)!.placement?.direction;
}

describe("faceEntities", () => {
  it("inserts the clause behind the position and touches nothing else, comments included", () => {
    const changes = faceEntities(parsed, [{ id: idOf(parsed, "twice"), direction: "south" }]);
    const at = comments.indexOf("twice at (300, 80)") + "twice at (300, 80)".length;
    expect(changes).toEqual([{ from: at, to: at, insert: " facing south" }]);
    const next = applyChanges(comments, changes);
    expect(next).toBe(comments.replace("twice at (300, 80)", "twice at (300, 80) facing south"));
    expect(directionOf(next, "twice")).toBe("south");
    // Every comment of the file is still there, in place.
    expect(next.match(/\/\/.*|\/\*[^]*?\*\//g)).toEqual(comments.match(/\/\/.*|\/\*[^]*?\*\//g));
  });

  it("patches only the direction word of an existing clause, whatever surrounds it", () => {
    const parse = valid(circuit("constant a at (0, 0) facing /* in game */ north { } // kept\nconstant b facing west at (20, 40) { }"));
    const changes = faceEntities(parse, [{ id: idOf(parse, "a"), direction: "east" }, { id: idOf(parse, "b"), direction: "north" }]);
    expect(changes).toEqual([
      { from: parse.source.indexOf("north"), to: parse.source.indexOf("north") + 5, insert: "east" },
      { from: parse.source.indexOf("west"), to: parse.source.indexOf("west") + 4, insert: "north" },
    ]);
    expect(applyChanges(parse.source, changes)).toBe(circuit("constant a at (0, 0) facing /* in game */ east { } // kept\nconstant b facing north at (20, 40) { }"));
  });

  it("puts a new clause behind tile, behind at, or behind the name of an entity without a position", () => {
    const parse = valid(circuit("constant a { }\nconstant b at (0, 0) tile (1, 2) { }\nconstant c tile (3, 4) at (20, 40) { }\nconstant d tile (5, 6) {\n}"));
    expect(faced(parse, { a: "north", b: "south", c: "west", d: "north" })).toBe(
      circuit("constant a facing north { }\nconstant b at (0, 0) tile (1, 2) facing south { }\nconstant c tile (3, 4) at (20, 40) facing west { }\nconstant d tile (5, 6) facing north {\n}"),
    );
    // An entity without `at` keeps the position the editor chose for it.
    const before = parse.circuit.entities[0]!.position;
    expect(valid(faced(parse, { a: "north" })).circuit.entities[0]!.position).toEqual(before);
  });

  it("writes every direction, east included, and never removes a clause", () => {
    const parse = valid(circuit("constant a at (0, 0) { }\nconstant b at (0, 200) facing south { }"));
    for (const direction of DIRECTIONS) {
      expect(directionOf(faced(parse, { b: direction }), "b")).toBe(direction);
      expect(faced(parse, { b: direction })).toBe(parse.source.replace("facing south", `facing ${direction}`));
    }
    expect(faced(parse, { b: "east" })).toContain("constant b at (0, 200) facing east { }");
  });

  it("leaves an entity alone that faces the wanted direction already, with or without a clause", () => {
    const parse = valid(circuit("constant a at (0, 0) { }\nconstant b at (0, 200) facing south { }\nconstant c at (0, 400) facing east { }"));
    expect(DEFAULT_FACING).toBe("east");
    expect(faceEntities(parse, [{ id: idOf(parse, "a"), direction: "east" }, { id: idOf(parse, "b"), direction: "south" }, { id: idOf(parse, "c"), direction: "east" }])).toEqual([]);
    expect(faceEntities(parse, [])).toEqual([]);
  });

  it("changes several entities in one sorted change set and takes the last direction given for an entity", () => {
    const ids = parsed.circuit.entities.map((entity) => entity.id);
    const changes = faceEntities(parsed, [...ids.map((id) => ({ id, direction: "west" as const })), { id: ids[0]!, direction: "north" }]);
    // The lamp of the three is left out.
    expect(changes).toHaveLength(2);
    for (let i = 1; i < changes.length; i++) expect(changes[i]!.from).toBeGreaterThan(changes[i - 1]!.to);
    const next = valid(applyChanges(comments, changes));
    expect(next.circuit.entities.map((entity) => [entity.kind, entity.placement?.direction])).toEqual([["constant", "north"], ["arithmetic", "west"], ["lamp", undefined]]);
    // Nothing but the clauses differs: without them the canonical text is the one of the original.
    expect(printCircuit({ ...next.circuit, entities: next.circuit.entities.map(({ placement: _placement, ...entity }) => entity) })).toBe(printCircuit(parsed.circuit));
  });

  it("keeps the meaning of the circuit: wires and configuration are the same after a turn", () => {
    const next = valid(faced(parsed, { twice: "north" }));
    expect(next.circuit.wires).toEqual(parsed.circuit.wires);
    expect(next.circuit.entities.map(({ placement: _placement, ...entity }) => entity)).toEqual(parsed.circuit.entities.map(({ placement: _placement, ...entity }) => entity));
  });

  it("leaves a lamp alone: it cannot rotate, whatever its clause says", () => {
    const parse = valid(circuit("lamp a at (0, 0) { }\nlamp b at (0, 200) tile (0.5, 0.5) facing south { }\nconstant c { }"));
    for (const direction of DIRECTIONS) expect(faceEntities(parse, [{ id: idOf(parse, "a"), direction }, { id: idOf(parse, "b"), direction }])).toEqual([]);
    expect(faced(parse, { a: "north", b: "west", c: "north" })).toBe(parse.source.replace("constant c", "constant c facing north"));
  });

  it("moves the tile of a 2x1 entity with the turn: the top-left tile of the footprint stays", () => {
    // On the tiles (0, 0) and (1, 0); a quarter turn puts it on (0, 0) and (0, 1), a half turn keeps both tiles.
    const parse = valid(circuit("decider d at (0, 0) tile (1, 0.5) { }"));
    expect(faced(parse, { d: "south" })).toBe(circuit("decider d at (0, 0) tile (0.5, 1) facing south { }"));
    expect(faced(parse, { d: "west" })).toBe(circuit("decider d at (0, 0) tile (1, 0.5) facing west { }"));
    expect(faced(parse, { d: "north" })).toBe(circuit("decider d at (0, 0) tile (0.5, 1) facing north { }"));
    let source = parse.source;
    for (const direction of ["south", "west", "north", "east"] as const) {
      source = faced(valid(source), { d: direction });
      expect(analyze(source).diagnostics.map((d) => d.code)).toEqual(["unconfigured"]);
    }
    expect(source).toBe(circuit("decider d at (0, 0) tile (1, 0.5) facing east { }"));
  });

  it("patches only the numbers of the tile that change and keeps what surrounds them", () => {
    const parse = valid(circuit("selector s facing /* way */ south tile ( 6.5 , /* y */ -21 ) at (0, 0) { } // kept"));
    const changes = faceEntities(parse, [{ id: idOf(parse, "s"), direction: "west" }]);
    // Facing south the top-left tile is (6, -22); facing west the entity covers that tile and the one east of it.
    expect(changes.map((change) => [parse.source.slice(change.from, change.to), change.insert])).toEqual([["south", "west"], ["6.5", "7"], ["-21", "-21.5"]]);
    expect(applyChanges(parse.source, changes)).toBe(circuit("selector s facing /* way */ west tile ( 7 , /* y */ -21.5 ) at (0, 0) { } // kept"));
    const west = valid(circuit("arithmetic a tile (0, 0.5) facing west { }"));
    expect(faceEntities(west, [{ id: idOf(west, "a"), direction: "south" }]).map((change) => change.insert)).toEqual(["-0.5", "1", "south"]);
    // A half turn keeps the tile and writes the direction only.
    const half = valid(circuit("arithmetic a tile (1, 0.5) { }"));
    expect(faceEntities(half, [{ id: idOf(half, "a"), direction: "west" }]).map((change) => change.insert)).toEqual([" facing west"]);
  });

  it("keeps the tile of a 1x1 entity and puts a tile that is off the grid on it", () => {
    const parse = valid(circuit("constant c tile (2.5, 0.5) { }\nconstant odd tile (1, 2) { }\ndecider d tile (0.5, 0.5) { }"));
    expect(faced(parse, { c: "north", odd: "north", d: "south" })).toBe(circuit("constant c tile (2.5, 0.5) facing north { }\nconstant odd tile (1, 2) facing north { }\ndecider d tile (0.5, 1) facing south { }"));
  });

  it("refuses unknown entities, unknown directions and invalid source as typed failures", () => {
    const code = (action: () => unknown): string => {
      try {
        action();
      } catch (error) {
        if (error instanceof EditError) return error.code;
        throw error;
      }
      return "no failure";
    };
    expect(code(() => faceEntities(parsed, [{ id: "nope", direction: "north" }]))).toBe("unknown-entity");
    expect(code(() => faceEntities(parsed, [{ id: idOf(parsed, "twice"), direction: "up" as Direction }]))).toBe("invalid-entity");
    expect(code(() => faceEntities(analyze(comments.replace("* 2", "*")), []))).toBe("invalid-source");
    expect(executeCommand(parsed, { type: "faceEntities", facings: [{ id: idOf(parsed, "twice"), direction: "west" }] })).toEqual({ ok: true, changes: [expect.objectContaining({ insert: " facing west" })] });
    expect(executeCommand(parsed, { type: "faceEntities", facings: [{ id: "nope", direction: "west" }] })).toMatchObject({ ok: false, code: "unknown-entity" });
  });
});
