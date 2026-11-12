import { DIRECTIONS, type Direction } from "@face/model";
import { describe, expect, it } from "vitest";
import { analyze, applyChanges, DEFAULT_FACING, EditError, executeCommand, faceEntities, printCircuit, type ParseResult } from "../src/index.ts";
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
    const parse = valid(circuit("lamp a at (0, 0) facing /* in game */ north { } // kept\nlamp b facing west at (20, 40) { }"));
    const changes = faceEntities(parse, [{ id: idOf(parse, "a"), direction: "east" }, { id: idOf(parse, "b"), direction: "north" }]);
    expect(changes).toEqual([
      { from: parse.source.indexOf("north"), to: parse.source.indexOf("north") + 5, insert: "east" },
      { from: parse.source.indexOf("west"), to: parse.source.indexOf("west") + 4, insert: "north" },
    ]);
    expect(applyChanges(parse.source, changes)).toBe(circuit("lamp a at (0, 0) facing /* in game */ east { } // kept\nlamp b facing north at (20, 40) { }"));
  });

  it("puts a new clause behind tile, behind at, or behind the name of an entity without a position", () => {
    const parse = valid(circuit("lamp a { }\nlamp b at (0, 0) tile (1, 2) { }\nlamp c tile (3, 4) at (20, 40) { }\nlamp d tile (5, 6) {\n}"));
    expect(faced(parse, { a: "north", b: "south", c: "west", d: "north" })).toBe(
      circuit("lamp a facing north { }\nlamp b at (0, 0) tile (1, 2) facing south { }\nlamp c tile (3, 4) at (20, 40) facing west { }\nlamp d tile (5, 6) facing north {\n}"),
    );
    // An entity without `at` keeps the position the editor chose for it.
    const before = parse.circuit.entities[0]!.position;
    expect(valid(faced(parse, { a: "north" })).circuit.entities[0]!.position).toEqual(before);
  });

  it("writes every direction, east included, and never removes a clause", () => {
    const parse = valid(circuit("lamp a at (0, 0) { }\nlamp b at (0, 200) facing south { }"));
    for (const direction of DIRECTIONS) {
      expect(directionOf(faced(parse, { b: direction }), "b")).toBe(direction);
      expect(faced(parse, { b: direction })).toBe(parse.source.replace("facing south", `facing ${direction}`));
    }
    expect(faced(parse, { b: "east" })).toContain("lamp b at (0, 200) facing east { }");
  });

  it("leaves an entity alone that faces the wanted direction already, with or without a clause", () => {
    const parse = valid(circuit("lamp a at (0, 0) { }\nlamp b at (0, 200) facing south { }\nlamp c at (0, 400) facing east { }"));
    expect(DEFAULT_FACING).toBe("east");
    expect(faceEntities(parse, [{ id: idOf(parse, "a"), direction: "east" }, { id: idOf(parse, "b"), direction: "south" }, { id: idOf(parse, "c"), direction: "east" }])).toEqual([]);
    expect(faceEntities(parse, [])).toEqual([]);
  });

  it("changes several entities in one sorted change set and takes the last direction given for an entity", () => {
    const ids = parsed.circuit.entities.map((entity) => entity.id);
    const changes = faceEntities(parsed, [...ids.map((id) => ({ id, direction: "west" as const })), { id: ids[0]!, direction: "north" }]);
    expect(changes).toHaveLength(ids.length);
    for (let i = 1; i < changes.length; i++) expect(changes[i]!.from).toBeGreaterThan(changes[i - 1]!.to);
    const next = valid(applyChanges(comments, changes));
    expect(next.circuit.entities.map((entity) => entity.placement?.direction)).toEqual(["north", ...ids.slice(1).map(() => "west")]);
    // Nothing but the clauses differs: without them the canonical text is the one of the original.
    expect(printCircuit({ ...next.circuit, entities: next.circuit.entities.map(({ placement: _placement, ...entity }) => entity) })).toBe(printCircuit(parsed.circuit));
  });

  it("keeps the meaning of the circuit: wires and configuration are the same after a turn", () => {
    const next = valid(faced(parsed, { twice: "north" }));
    expect(next.circuit.wires).toEqual(parsed.circuit.wires);
    expect(next.circuit.entities.map(({ placement: _placement, ...entity }) => entity)).toEqual(parsed.circuit.entities.map(({ placement: _placement, ...entity }) => entity));
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
