// The language with the entity table of a modded game: `prototype = <name>` on the kinds that have a default prototype, its
// validation, the canonical printer, completion and the edit commands.
import { DEFAULT_ENTITY, ENTITY_KINDS, PROTOTYPES, prototypeOf, prototypesOf, setEntityTable, STANDARD_ENTITY_TABLE, type Entity } from "@face/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODDED_ENTITY_TABLE } from "../../../tests/fixtures/game/moddedEntities.ts";
import { analyze, applyChanges, checkEntity, completionContext, executeCommand, printCircuit, printEntity, propertyNames, type Completion, type EditCommand } from "../src/index.ts";
import { circuit, Generator, idOf, portable, valid } from "./helpers.ts";

const diagnostics = (source: string) => analyze(source).diagnostics.map((d) => [d.code, d.message]);
const entities = (body: string): readonly Entity[] => valid(circuit(body)).circuit.entities;
const prototypes = (body: string): (string | undefined)[] => entities(body).map((entity) => entity.prototype);

function run(source: string, command: (parsed: ReturnType<typeof valid>) => EditCommand): string {
  const parsed = valid(source);
  const result = executeCommand(parsed, command(parsed));
  if (!result.ok) throw new Error(result.message);
  return applyChanges(source, result.changes);
}

const MODDED = [
  "constant c { prototype = mod-constant virtual:signal-A = 1 }",
  "arithmetic a { prototype = mod-arithmetic virtual:signal-B = virtual:signal-A * 2 }",
  "decider d { prototype = mod-decider when virtual:signal-A > 0 output virtual:signal-A = 1 }",
  "selector s { prototype = mod-selector operation = count output = virtual:signal-C }",
  "lamp l { prototype = mod-lamp when virtual:signal-A > 0 }",
  'lamp f { prototype = "5d-lamp" }',
  "pole p { prototype = mod-pole }",
  "entity m { prototype = mod-loader read-transfers = true when virtual:signal-A > 0 }",
].join("\n");

describe("the prototype of an entity, with a table that has modded ones", () => {
  beforeAll(() => setEntityTable(MODDED_ENTITY_TABLE));
  afterAll(() => setEntityTable(STANDARD_ENTITY_TABLE));

  it("is the modded one an entity names, and the standard one of the kind without the property or with its name", () => {
    expect(entities(MODDED).map((entity) => [entity.kind, prototypeOf(entity)])).toEqual([
      ["constant", "mod-constant"], ["arithmetic", "mod-arithmetic"], ["decider", "mod-decider"], ["selector", "mod-selector"], ["lamp", "mod-lamp"], ["lamp", "5d-lamp"], ["pole", "mod-pole"], ["entity", "mod-loader"],
    ]);
    // The first of a kind goes without saying: said or not, the entity is the same, and it holds no prototype. A pole always holds its own.
    const plain = "constant c { }\narithmetic a { }\ndecider d { }\nselector s { }\nlamp l { }\nspeaker k { when virtual:signal-A > 0 }\npole p { }";
    const named =
      "constant c { prototype = constant-combinator }\narithmetic a { prototype = arithmetic-combinator }\ndecider d { prototype = decider-combinator }\nselector s { prototype = selector-combinator }\n" +
      "lamp l { prototype = small-lamp }\nspeaker k { prototype = programmable-speaker when virtual:signal-A > 0 }\npole p { prototype = small-electric-pole }";
    expect(entities(named)).toEqual(entities(plain));
    expect(prototypes(plain)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, "small-electric-pole"]);
    // The behaviour is the kind's: a modded combinator has every setting of the standard one.
    expect(entities("arithmetic a { prototype = mod-arithmetic virtual:signal-B = virtual:signal-A * 2 }")[0]).toEqual({ ...entities("arithmetic a { virtual:signal-B = virtual:signal-A * 2 }")[0], prototype: "mod-arithmetic" });
    expect(entities("entity m { prototype = mod-loader read-transfers = true }")[0]).toMatchObject({ kind: "entity", prototype: "mod-loader", settings: { "read-transfers": true } });
  });

  it("prints the prototype unless it is the first of the kind, quoted where it does not read as a word, and reads it back", () => {
    const parsed = valid(circuit(MODDED));
    const printed = printCircuit(parsed.circuit);
    expect(printed).toContain("    constant c at (40, 40) {\n        prototype = mod-constant\n        virtual:signal-A = 1\n    }");
    expect(printed).toContain('    lamp f at (1240, 40) {\n        prototype = "5d-lamp"\n    }');
    expect(printed).toContain("    pole p at (1480, 40) {\n        prototype = mod-pole\n    }");
    expect(portable(valid(printed).circuit)).toEqual(portable(parsed.circuit));
    expect(printEntity({ ...DEFAULT_ENTITY.lamp, id: "x", name: "l", position: { x: 0, y: 0 } })).toBe("lamp l at (0, 0) {\n}");
    expect(printEntity({ ...DEFAULT_ENTITY.lamp, id: "x", name: "l", position: { x: 0, y: 0 }, prototype: "mod-lamp" })).toBe("lamp l at (0, 0) {\n    prototype = mod-lamp\n}");
    expect(printCircuit(valid(circuit("lamp l { prototype = small-lamp }\npole p { prototype = small-electric-pole }")).circuit)).toBe('circuit "t" {\n    lamp l at (40, 40) {\n    }\n\n    pole p at (280, 40) {\n    }\n}\n');
  });

  it("round-trips generated circuits whose entities are of any prototype of their kind", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 150; seed++) {
      const generator = new Generator(seed);
      const generated = generator.circuit(generator.int(0, 8));
      for (const entity of generated.entities) if (entity.kind !== "entity") seen.add(prototypeOf(entity));
      expect(portable(valid(printCircuit(generated)).circuit)).toEqual(portable(generated));
    }
    expect([...seen].sort()).toEqual(ENTITY_KINDS.filter((kind) => kind !== "entity").flatMap((kind) => prototypesOf(kind)).sort());
    const generator = new Generator(99);
    for (let i = 0; i < 300; i++) expect(checkEntity(generator.entity(generator.pick(ENTITY_KINDS), "e"))).toEqual({ ok: true });
  });

  it("refuses a prototype of another kind and one the game data does not have, and says what to write", () => {
    expect(diagnostics(circuit("arithmetic a { prototype = mod-decider virtual:signal-B = virtual:signal-A * 2 }"))).toEqual([["invalid-value", "'mod-decider' is a decider combinator, not an arithmetic combinator: declare it as 'decider <name> { ... }'"]]);
    expect(diagnostics(circuit("lamp l { prototype = mod-pole }"))).toEqual([["invalid-value", "'mod-pole' is an electric pole, not a lamp: declare it as 'pole <name> { ... }'"]]);
    expect(diagnostics(circuit("constant c { prototype = mod-loader }")).filter(([code]) => code !== "unconfigured")).toEqual([["invalid-value", "'mod-loader' is not a constant combinator: declare it as 'entity <name> { prototype = mod-loader }'"]]);
    expect(diagnostics(circuit("lamp l { prototype = nixie-tube }"))).toEqual([["invalid-value", "Unknown prototype 'nixie-tube' for a lamp; the game data has small-lamp, 5d-lamp, mod-hidden-lamp, mod-lamp"]]);
    // A modded speaker has no kind: the editor does not have its instruments.
    expect(diagnostics(circuit("speaker s { prototype = mod-speaker when virtual:signal-A > 0 }"))).toEqual([["invalid-value", "Unknown prototype 'mod-speaker' for a programmable speaker; the game data has programmable-speaker"]]);
    expect(diagnostics(circuit("entity e { prototype = mod-speaker }"))[0]![1]).toMatch(/^Unknown prototype 'mod-speaker'/);
    expect(diagnostics(circuit("entity e { prototype = mod-lamp }"))).toEqual([["invalid-value", "'mod-lamp' has a kind of its own: declare it as 'lamp <name> { ... }'"]]);
    expect(diagnostics(circuit("lamp l { prototype = mod-lamp prototype = small-lamp }"))).toEqual([["duplicate-statement", "Duplicate property 'prototype'"]]);
    // The entity of a refused prototype is the first of its kind.
    expect(prototypeOf(analyze(circuit("lamp l { }")).circuit!.entities[0]!)).toBe("small-lamp");
  });

  it("places an entity by the tiles of its prototype", () => {
    // One tile for the modded arithmetic combinator, where the standard one needs a whole coordinate along its facing.
    expect(diagnostics(circuit("arithmetic a tile (0.5, 0.5) { prototype = mod-arithmetic virtual:signal-B = virtual:signal-A * 2 }"))).toEqual([]);
    expect(diagnostics(circuit("arithmetic a tile (0.5, 0.5) { virtual:signal-B = virtual:signal-A * 2 }"))).toEqual([
      ["tile-off-grid", "Not on the tile grid: facing east, the center of this arithmetic combinator needs a whole x and a y ending in .5; the nearest is (1, 0.5)"],
    ]);
    expect(diagnostics(circuit("lamp l tile (0.5, 0.5) { prototype = mod-lamp }"))).toEqual([["tile-off-grid", "Not on the tile grid: the center of this big lamp, which covers 2 x 2 tiles, needs a whole x and a whole y; the nearest is (1, 1)"]]);
    expect(diagnostics(circuit("lamp l tile (1, 1) { prototype = mod-lamp }\nlamp m tile (1.5, 1.5) { }"))).toEqual([
      ["tile-overlap", "Stands on a tile that 'm' stands on as well; in the game two entities cannot share a tile"],
      ["tile-overlap", "Stands on a tile that 'l' stands on as well; in the game two entities cannot share a tile"],
    ]);
    expect(diagnostics(circuit("constant c facing north { prototype = mod-constant virtual:signal-A = 1 }"))).toEqual([["unused-facing", "A constant combinator cannot be rotated; 'facing' is ignored"]]);
    // A modded pole has its own reach.
    const far = "pole a tile (1, 1) { prototype = mod-pole }\npole b tile (41, 1) { prototype = mod-pole }\nwire red a <-> b";
    expect(diagnostics(circuit(far))).toEqual([]);
    expect(diagnostics(circuit(far.replace("(41, 1)", "(50, 1)")))[0]![0]).toBe("wire-too-long");
  });

  it("offers the property and the prototypes of the kind where the game data has several", () => {
    const at = (text: string): readonly Completion[] => completionContext(analyze(text.replace("|", "")), text.indexOf("|")).expected;
    expect(propertyNames("lamp")).toEqual(["description", "prototype", "networks", "always-on", "colors", "red", "green", "blue", "rgb", "color"]);
    expect(propertyNames("arithmetic")).toEqual(["description", "prototype"]);
    expect(propertyNames("speaker")).not.toContain("prototype");
    expect(at(circuit("arithmetic a { | }"))).toContainEqual({ type: "property", kind: "arithmetic", names: ["description", "prototype"] });
    expect(at(circuit("arithmetic a { prototype = | }"))).toEqual([{ type: "enum", property: "prototype", values: ["arithmetic-combinator", "mod-arithmetic"] }]);
    expect(at(circuit("pole p { prototype = | }"))).toEqual([{ type: "enum", property: "prototype", values: ["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation", "mod-pole"] }]);
    expect(diagnostics(circuit("arithmetic a { size = 1 virtual:signal-B = virtual:signal-A * 2 }"))).toEqual([["unknown-property", "Unknown property 'size' in an arithmetic combinator; expected one of description, prototype"]]);
  });

  it("adds an entity of a prototype and changes the prototype of one, leaving the rest of the declaration as it is", () => {
    const empty = circuit("");
    const added = run(empty, () => ({ type: "addEntity", kind: "arithmetic", position: { x: 0, y: 0 }, prototype: "mod-arithmetic", tile: { x: 0.5, y: 0.5 } }));
    expect(added).toContain("    arithmetic arithmetic1 at (0, 0) tile (0.5, 0.5) {\n        prototype = mod-arithmetic\n    }");
    // The first of the kind is added without saying which.
    expect(run(empty, () => ({ type: "addEntity", kind: "arithmetic", position: { x: 0, y: 0 }, prototype: "arithmetic-combinator" }))).toContain("    arithmetic arithmetic1 at (0, 0) {\n    }");
    const refused = executeCommand(valid(empty), { type: "addEntity", kind: "lamp", position: { x: 0, y: 0 }, prototype: "mod-pole" });
    expect(refused).toMatchObject({ ok: false, code: "invalid-entity", message: "'mod-pole' is not a lamp; use small-lamp, 5d-lamp, mod-hidden-lamp, mod-lamp" });
    expect(executeCommand(valid(empty), { type: "addEntity", kind: "lamp", position: { x: 0, y: 0 }, tile: { x: 0.5, y: 0.5 }, prototype: "mod-lamp" })).toMatchObject({ ok: false, code: "invalid-position" });

    const source = circuit("lamp l at (20, 40) {\n    // a comment\n    when virtual:signal-A > 0\n}");
    const update = (text: string, prototype: string | undefined): string =>
      run(text, (parsed) => ({ type: "updateEntity", id: idOf(parsed, "l"), entity: { ...parsed.circuit.entities[0]!, prototype } as Entity }));
    const modded = update(source, "mod-lamp");
    expect(modded).toBe(circuit("lamp l at (20, 40) {\n    // a comment\n    prototype = mod-lamp\n    when virtual:signal-A > 0\n}"));
    expect(update(modded, "5d-lamp")).toContain('prototype = "5d-lamp"');
    // Back to the first of the kind: the statement that is there says so, as with every other property that has a default.
    expect(update(modded, undefined)).toBe(source.replace("    when", "    prototype = small-lamp\n    when"));
    // A statement that names the first of the kind by hand stays when something else changes.
    const explicit = circuit("lamp l { prototype = small-lamp }");
    expect(run(explicit, (parsed) => ({ type: "updateEntity", id: idOf(parsed, "l"), entity: { ...parsed.circuit.entities[0]!, alwaysOn: true } as Entity }))).toBe(circuit("lamp l { prototype = small-lamp always-on = true }"));
    expect(PROTOTYPES["mod-lamp"]!.kind).toBe("lamp");
  });
});

describe("a project made with mods, read with the standard game data", () => {
  it("says which prototypes are unknown, for a kind with one prototype as for any other", () => {
    expect(analyze(circuit(MODDED)).diagnostics.map((d) => d.message)).toEqual([
      "Unknown prototype 'mod-constant' for a constant combinator; the game data has constant-combinator",
      "Unknown prototype 'mod-arithmetic' for an arithmetic combinator; the game data has arithmetic-combinator",
      "Unknown prototype 'mod-decider' for a decider combinator; the game data has decider-combinator",
      "Unknown prototype 'mod-selector' for a selector combinator; the game data has selector-combinator",
      "Unknown prototype 'mod-lamp' for a lamp; the game data has small-lamp",
      "Unknown prototype '5d-lamp' for a lamp; the game data has small-lamp",
      "Unknown prototype 'mod-pole' for an electric pole; the game data has small-electric-pole, medium-electric-pole, big-electric-pole, substation",
      "Unknown prototype 'mod-loader'; did you mean loader?",
    ]);
  });

  it("does not offer the property for a kind with one prototype, and takes it all the same", () => {
    expect(propertyNames("lamp")).not.toContain("prototype");
    expect(propertyNames("pole")).toEqual(["description", "prototype"]);
    expect(analyze(circuit("arithmetic a { prototype = arithmetic-combinator virtual:signal-B = virtual:signal-A * 2 }")).diagnostics).toEqual([]);
  });
});
