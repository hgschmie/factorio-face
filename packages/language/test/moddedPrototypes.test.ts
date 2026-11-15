// The language with the entity table of a modded game: an entity is declared by the name a mod gives it like one of the game,
// with the kind of its prototype type; the names that need quotes, the ones the editor does not support, the canonical printer,
// completion and the edit commands.
import { DEFAULT_ENTITY, ENTITY_KINDS, parseEntityTable, PROTOTYPE_NAMES, PROTOTYPES, prototypesOf, setEntityTable, STANDARD_ENTITY_TABLE, type Entity } from "@face/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODDED_ENTITY_TABLE, MODDED_RECORDS, moddedEntityData } from "../../../tests/fixtures/game/moddedEntities.ts";
import { analyze, applyChanges, checkEntity, completionContext, executeCommand, KEYWORDS, parse, printCircuit, printEntity, printName, propertyNames, type Completion, type CstEntity, type EditCommand } from "../src/index.ts";
import { circuit, Generator, idOf, portable, valid } from "./helpers.ts";

const diagnostics = (source: string) => analyze(source).diagnostics.map((d) => [d.code, d.message]);
const entities = (body: string): readonly Entity[] => valid(circuit(body)).circuit.entities;

function run(source: string, command: (parsed: ReturnType<typeof valid>) => EditCommand): string {
  const parsed = valid(source);
  const result = executeCommand(parsed, command(parsed));
  if (!result.ok) throw new Error(result.message);
  return applyChanges(source, result.changes);
}

const MODDED = [
  "mod-constant c { virtual:signal-A = 1 }",
  "mod-arithmetic a { virtual:signal-B = virtual:signal-A * 2 }",
  "mod-decider d { when virtual:signal-A > 0 output virtual:signal-A = 1 }",
  "mod-selector s { operation = count output = virtual:signal-C }",
  "mod-lamp l { when virtual:signal-A > 0 }",
  '"5d-lamp" f { }',
  "mod-pole p { }",
  "mod-loader m { read-transfers = true when virtual:signal-A > 0 }",
].join("\n");

describe("the entities of a table that has modded ones", () => {
  beforeAll(() => setEntityTable(MODDED_ENTITY_TABLE));
  afterAll(() => setEntityTable(STANDARD_ENTITY_TABLE));

  it("are declared by their names and have the kind of their prototype type", () => {
    expect(entities(MODDED).map((entity) => [entity.kind, entity.prototype])).toEqual([
      ["constant", "mod-constant"], ["arithmetic", "mod-arithmetic"], ["decider", "mod-decider"], ["selector", "mod-selector"], ["lamp", "mod-lamp"], ["lamp", "5d-lamp"], ["pole", "mod-pole"], ["entity", "mod-loader"],
    ]);
    // Every entity holds its prototype, the standard one of a kind like any other.
    const standard = "constant-combinator c { }\narithmetic-combinator a { }\ndecider-combinator d { }\nselector-combinator s { }\nsmall-lamp l { }\nprogrammable-speaker k { when virtual:signal-A > 0 }\nsmall-electric-pole p { }";
    expect(entities(standard).map((entity) => entity.prototype)).toEqual(["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator", "small-lamp", "programmable-speaker", "small-electric-pole"]);
    // The behaviour is the kind's: a modded combinator has every setting of the standard one.
    expect(entities("mod-arithmetic a { virtual:signal-B = virtual:signal-A * 2 }")[0]).toEqual({ ...entities("arithmetic-combinator a { virtual:signal-B = virtual:signal-A * 2 }")[0], prototype: "mod-arithmetic" });
    expect(entities("mod-loader m { read-transfers = true }")[0]).toMatchObject({ kind: "entity", prototype: "mod-loader", settings: { "read-transfers": true } });
    // The body is read by the kind of the word: what a decider takes is nothing an arithmetic combinator of a mod takes.
    expect(diagnostics(circuit("mod-arithmetic a { when virtual:signal-A > 0 }")).map(([code]) => code)).toEqual(["unconfigured", "invalid-statement"]);
    expect(diagnostics(circuit("mod-arithmetic a { size = 1 virtual:signal-B = virtual:signal-A * 2 }"))).toEqual([["unknown-property", "Unknown property 'size' in an arithmetic combinator; expected one of description"]]);
  });

  it("takes a name bare or in quotes, and wants the quotes where the name does not read as one word", () => {
    for (const { name } of MODDED_RECORDS.filter((record) => PROTOTYPES[record.name])) expect(entities(`"${name}" e { }`)[0]!.prototype, name).toBe(name);
    expect(entities('"small-lamp" a { }\nsmall-lamp b { }').map((entity) => entity.prototype)).toEqual(["small-lamp", "small-lamp"]);
    expect([printName("mod-lamp"), printName("5d-lamp"), printName("substation"), printName("mod.lamp"), printName("mod lamp")]).toEqual(["mod-lamp", '"5d-lamp"', "substation", '"mod.lamp"', '"mod lamp"']);
    // Bare, the name is a number and a word to the lexer.
    expect(analyze(circuit("5d-lamp f { }")).hasErrors).toBe(true);
    const node = parse(circuit('"5d-lamp" f at (0, 0) { }')).cst.circuit!.members[0] as CstEntity;
    expect([node.word.kind, node.word.text, node.prototype, node.kind, node.name?.text]).toEqual(["string", '"5d-lamp"', "5d-lamp", "lamp", "f"]);
  });

  it("prints the name as the word of the declaration, quoted where it has to be, and reads it back", () => {
    const parsed = valid(circuit(MODDED));
    const printed = printCircuit(parsed.circuit);
    expect(printed).toContain("    mod-constant c at (40, 40) {\n        virtual:signal-A = 1\n    }");
    expect(printed).toContain('    "5d-lamp" f at (1240, 40) {\n    }');
    expect(printed).toContain("    mod-pole p at (1480, 40) {\n    }");
    expect(printed).not.toContain("prototype");
    expect(portable(valid(printed).circuit)).toEqual(portable(parsed.circuit));
    expect(printEntity({ ...DEFAULT_ENTITY.lamp, id: "x", name: "l", position: { x: 0, y: 0 }, prototype: "small-lamp" })).toBe("small-lamp l at (0, 0) {\n}");
    expect(printEntity({ ...DEFAULT_ENTITY.lamp, id: "x", name: "l", position: { x: 0, y: 0 }, prototype: "mod-lamp" })).toBe("mod-lamp l at (0, 0) {\n}");
  });

  it("round-trips a new entity of every prototype of the table", () => {
    expect(PROTOTYPE_NAMES).toHaveLength(107);
    for (const prototype of PROTOTYPE_NAMES) {
      const entity = { ...DEFAULT_ENTITY[PROTOTYPES[prototype]!.kind], prototype, id: "e1", name: "e", position: { x: 20, y: -40 } } as Entity;
      const printed = printCircuit({ name: "", entities: [entity], wires: [] });
      expect(printed.split("\n")[1], prototype).toBe(`    ${printName(prototype)} e at (20, -40) {`);
      // A new constant combinator, decider or speaker has nothing set, which is a warning and no error.
      expect(analyze(printed).circuit?.entities, prototype).toEqual([entity]);
      expect(checkEntity(entity), prototype).toEqual({ ok: true });
    }
  });

  it("round-trips generated circuits whose entities are of any prototype of their kind", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 150; seed++) {
      const generator = new Generator(seed);
      const generated = generator.circuit(generator.int(0, 8));
      for (const entity of generated.entities) if (entity.kind !== "entity") seen.add(entity.prototype);
      expect(portable(valid(printCircuit(generated)).circuit)).toEqual(portable(generated));
    }
    expect([...seen].sort()).toEqual(ENTITY_KINDS.filter((kind) => kind !== "entity").flatMap((kind) => prototypesOf(kind)).sort());
    const generator = new Generator(99);
    for (let i = 0; i < 300; i++) expect(checkEntity(generator.entity(generator.pick(ENTITY_KINDS), "e"))).toEqual({ ok: true });
  });

  it("says that a prototype the game has and the editor gives no kind is not supported", () => {
    // A modded speaker: the editor has the instruments of the standard one only.
    expect(diagnostics(circuit("mod-speaker s at (0, 0) { when virtual:signal-A > 0 instrument = piano }"))).toEqual([
      ["unsupported-prototype", "'mod-speaker' (Loud speaker) is not supported: it is a programmable speaker of its own, and the editor has the instruments of 'programmable-speaker' only"],
    ]);
    expect(diagnostics(circuit('"mod-oddity" o { anything = at all }'))).toEqual([["unsupported-prototype", "'mod-oddity' (Oddity) is not supported: it is a simple-entity-with-owner, for which the editor has no settings"]]);
    // It is no entity: the rest of the file is read, and a wire that ends at it, at either end, is left out without another error.
    const result = analyze(circuit("mod-lamp l { }\nmod-speaker s { when virtual:signal-A > 0 }\nmod-pole p { }\nwire red p <-> l.in\nwire red p <-> s.in\nwire green s.in <-> l.in\nwire red s.in <-> s.in"));
    expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([["unsupported-prototype", expect.stringContaining("'mod-speaker'")]]);
    expect(result.sourceMap.entities.size).toBe(2);
    expect(result.sourceMap.wires.size).toBe(1);
    expect(result.cst.circuit!.passed.map((declaration) => [declaration.word.text, declaration.name?.text])).toEqual([["mod-speaker", "s"]]);
    expect(diagnostics(circuit("nixie-tube l { }"))).toEqual([
      ["unknown-prototype", "Unknown entity 'nixie-tube': the game data in use has no entity of this name (the names are the game's, as a blueprint has them: constant-combinator, small-lamp, steel-chest)"],
    ]);
    expect(diagnostics(circuit("mod-lamps l { }"))).toEqual([["unknown-prototype", "Unknown entity 'mod-lamps'; did you mean mod-lamp?"]]);
  });

  it("places an entity by the tiles of its prototype", () => {
    // One tile for the modded arithmetic combinator, where the standard one needs a whole coordinate along its facing.
    expect(diagnostics(circuit("mod-arithmetic a tile (0.5, 0.5) { virtual:signal-B = virtual:signal-A * 2 }"))).toEqual([]);
    expect(diagnostics(circuit("arithmetic-combinator a tile (0.5, 0.5) { virtual:signal-B = virtual:signal-A * 2 }"))).toEqual([
      ["tile-off-grid", "Not on the tile grid: facing east, the center of this arithmetic combinator needs a whole x and a y ending in .5; the nearest is (1, 0.5)"],
    ]);
    expect(diagnostics(circuit("mod-lamp l tile (0.5, 0.5) { }"))).toEqual([["tile-off-grid", "Not on the tile grid: the center of this big lamp, which covers 2 x 2 tiles, needs a whole x and a whole y; the nearest is (1, 1)"]]);
    expect(diagnostics(circuit("mod-lamp l tile (1, 1) { }\nsmall-lamp m tile (1.5, 1.5) { }"))).toEqual([
      ["tile-overlap", "Stands on a tile that 'm' stands on as well; in the game two entities cannot share a tile"],
      ["tile-overlap", "Stands on a tile that 'l' stands on as well; in the game two entities cannot share a tile"],
    ]);
    expect(diagnostics(circuit("mod-constant c facing north { virtual:signal-A = 1 }"))).toEqual([["unused-facing", "A constant combinator cannot be rotated; 'facing' is ignored"]]);
    // A modded pole has its own reach.
    const far = "mod-pole a tile (1, 1) { }\nmod-pole b tile (41, 1) { }\nwire red a <-> b";
    expect(diagnostics(circuit(far))).toEqual([]);
    expect(diagnostics(circuit(far.replace("(41, 1)", "(50, 1)")))[0]![0]).toBe("wire-too-long");
  });

  it("offers every entity of the table at the start of a member, and no property that says which one an entity is", () => {
    const at = (text: string): readonly Completion[] => completionContext(analyze(text.replace("|", "")), text.indexOf("|")).expected;
    expect(at(circuit("mod-lamp l { }\n|"))).toEqual([{ type: "keyword", values: ["wire"] }, { type: "entity", prototypes: PROTOTYPE_NAMES }]);
    expect(PROTOTYPE_NAMES).toEqual(expect.arrayContaining(["mod-arithmetic", "5d-lamp", "mod-loader", "small-lamp", "steel-chest"]));
    // What the editor does not support is not offered.
    expect(PROTOTYPE_NAMES).not.toContain("mod-speaker");
    for (const kind of ENTITY_KINDS) expect(propertyNames(kind)).not.toContain("prototype");
    expect(at(circuit("mod-arithmetic a { | }"))).toContainEqual({ type: "property", kind: "arithmetic", names: ["description"] });
    expect(at(circuit("mod-loader m { | }"))).toContainEqual({ type: "property", kind: "entity", names: propertyNames("entity", "mod-loader") });
  });

  it("adds an entity of a prototype and changes the prototype of one, leaving the rest of the declaration as it is", () => {
    const empty = circuit("");
    const added = run(empty, () => ({ type: "addEntity", prototype: "mod-arithmetic", position: { x: 0, y: 0 }, tile: { x: 0.5, y: 0.5 } }));
    expect(added).toContain("    mod-arithmetic arithmetic1 at (0, 0) tile (0.5, 0.5) {\n    }");
    expect(run(empty, () => ({ type: "addEntity", prototype: "arithmetic-combinator", position: { x: 0, y: 0 } }))).toContain("    arithmetic-combinator arithmetic1 at (0, 0) {\n    }");
    expect(run(empty, () => ({ type: "addEntity", prototype: "5d-lamp", position: { x: 0, y: 0 } }))).toContain('    "5d-lamp" lamp1 at (0, 0) {\n    }');
    expect(executeCommand(valid(empty), { type: "addEntity", prototype: "mod-speaker", position: { x: 0, y: 0 } })).toMatchObject({ ok: false, code: "invalid-entity", message: "'mod-speaker' is not an entity of the game data in use" });
    expect(executeCommand(valid(empty), { type: "addEntity", prototype: "mod-lamp", position: { x: 0, y: 0 }, tile: { x: 0.5, y: 0.5 } })).toMatchObject({ ok: false, code: "invalid-position" });

    // The Type of the inspector: another prototype of the kind is another word, and nothing else changes.
    const source = circuit("small-lamp l at (20, 40) {\n    // a comment\n    when virtual:signal-A > 0\n}\nwire red l.in <-> l.in".replace("\nwire red l.in <-> l.in", ""));
    const update = (text: string, prototype: string): string => run(text, (parsed) => ({ type: "updateEntity", id: idOf(parsed, "l"), entity: { ...parsed.circuit.entities[0]!, prototype } as Entity }));
    const modded = update(source, "mod-lamp");
    expect(modded).toBe(source.replace("small-lamp l", "mod-lamp l"));
    const quoted = update(modded, "5d-lamp");
    expect(quoted).toBe(source.replace("small-lamp l", '"5d-lamp" l'));
    expect(update(quoted, "small-lamp")).toBe(source);
    expect(update(update('circuit "t" { "small-lamp" l { always-on = true } }', "mod-lamp"), "small-lamp")).toBe('circuit "t" { small-lamp l { always-on = true } }');
    // The same word and another setting: the word stays as it is written.
    const quotedLamp = 'circuit "t" { "small-lamp" l { always-on = true } }';
    expect(run(quotedLamp, (parsed) => ({ type: "updateEntity", id: idOf(parsed, "l"), entity: { ...parsed.circuit.entities[0]!, alwaysOn: false } as Entity }))).toBe(quotedLamp.replace("true", "false"));
    // Another kind is another entity.
    expect(executeCommand(valid(source), { type: "updateEntity", id: "e1", entity: { ...valid(source).circuit.entities[0]!, prototype: "mod-pole" } as Entity })).toMatchObject({ ok: false });
  });
});

describe("an entity whose name is a word of the language", () => {
  // A mod may name an entity anything: every reserved word and a few words that are none.
  const WORDS = [...KEYWORDS, "none", "prototype", "lamp", "entity"];
  const table = parseEntityTable({ ...(moddedEntityData() as { entities: object[] }), entities: [...(moddedEntityData() as { entities: object[] }).entities, ...WORDS.map((name) => ({ name, type: "lamp", displayName: `Lamp ${name}` }))] });
  beforeAll(() => setEntityTable(table));
  afterAll(() => setEntityTable(STANDARD_ENTITY_TABLE));

  it("is written in quotes when the word is reserved, and bare otherwise", () => {
    for (const word of KEYWORDS) expect(printName(word), word).toBe(`"${word}"`);
    expect(["none", "prototype", "lamp", "entity"].map(printName)).toEqual(["none", "prototype", "lamp", "entity"]);
    const body = WORDS.map((word, index) => `${printName(word)} e${index} at (${index * 20}, 0) { when virtual:signal-A > ${index} }`).join("\n");
    const parsed = valid(circuit(`${body}\nwire red e0.in <-> e1.in`));
    expect(parsed.circuit.entities.map((entity) => entity.prototype)).toEqual(WORDS);
    expect(portable(valid(printCircuit(parsed.circuit)).circuit)).toEqual(portable(parsed.circuit));
    expect(printCircuit(parsed.circuit)).toContain('    "wire" e1 at (20, 0) {\n        when virtual:signal-A > 1\n    }');
    for (const word of WORDS) expect(checkEntity({ ...DEFAULT_ENTITY.lamp, id: "x", name: "l", position: { x: 0, y: 0 }, prototype: word }), word).toEqual({ ok: true });
  });

  it("is refused bare where the word is reserved, with what to write", () => {
    expect(diagnostics(circuit("small-lamp a { }\nred r at (0, 0) { when virtual:signal-A > 0 }\nsmall-lamp b { }\nwire red a.in <-> b.in"))).toEqual([
      ["syntax-error", "'red' is a reserved word; an entity of this name is declared in quotes: \"red\" r"],
    ]);
    expect(diagnostics(circuit("section s { }")).map(([code]) => code)).toEqual(["syntax-error"]);
    // A body is not taken for a declaration: `section` in a constant combinator stays a section, also behind a string.
    expect(diagnostics(circuit('constant-combinator c { description = "abc" section { virtual:signal-A = 1 } }'))).toEqual([]);
    expect(diagnostics(circuit('"section" s { }\nconstant-combinator c { section "group" { virtual:signal-A = 1 } }'))).toEqual([]);
  });
});

describe("a project made with mods, read with the standard game data", () => {
  it("has one error per declaration of an entity the data does not have and none for the wires to them, and the rest of the circuit", () => {
    const result = analyze(circuit(`${MODDED}\nsmall-lamp light { }\nwire red c.out <-> light.in\nwire red c.out <-> a.in\nwire green p <-> m\nwire green light.in <-> f.in`));
    const missing = (name: string): string => `Unknown entity '${name}': the game data in use has no entity of this name (the names are the game's, as a blueprint has them: constant-combinator, small-lamp, steel-chest)`;
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      ...["mod-constant", "mod-arithmetic", "mod-decider", "mod-selector", "mod-lamp", "5d-lamp", "mod-pole"].map(missing),
      // A name of the game inside the one of the mod is offered.
      "Unknown entity 'mod-loader'; did you mean loader?",
    ]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(Array.from({ length: 8 }, () => "unknown-prototype"));
    expect([...result.sourceMap.entities.values()].map((entity) => entity.name)).toEqual(["light"]);
    expect(result.sourceMap.wires.size).toBe(0);
    expect(result.cst.circuit!.passed.map((declaration) => declaration.name?.text)).toEqual(["c", "a", "d", "s", "l", "f", "p", "m"]);
  });
});
