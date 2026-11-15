// The generic entity: every prototype of the game without a kind of its own, declared like every entity by its name in the
// game. Its settings are the table of the model (`ENTITY_SETTINGS`), which these tests walk row by row.
import {
  BOTH_NETWORKS, conditionRole, DEFAULT_ENTITY, ENTITY_SETTINGS, entityTable, newEntity, normalizedSettings, prototypesOf, settingDefault, settingSpecsOf, signalKey, UNSET_CONDITION,
  type Condition, type Entity, type EntityOfKind, type SettingSpec, type SettingValue, type SignalId,
} from "@face/model";
import { describe, expect, it } from "vitest";
import {
  addEntity, analyze, analyzeFragment, applyChanges, checkEntity, completionContext, conditionRoles, enumValues, executeCommand, extractFragment, isKeyword, lookupProperty, pasteFragment, printCircuit, printEntity, printFragment,
  propertyNames, tokenize, updateEntity, type Completion, type EditCommand,
} from "../src/index.ts";
import { circuit, idOf, valid } from "./helpers.ts";

const A: SignalId = { kind: "virtual", name: "signal-A" };
const IRON: SignalId = { kind: "item", name: "iron-plate" };
const BELOW: Condition = { first: IRON, comparator: "<", second: { type: "constant", value: 100 } };

type Generic = EntityOfKind<"entity">;

function entity(declaration: string): Generic {
  const found = valid(circuit(declaration)).circuit.entities[0]!;
  expect(found.kind).toBe("entity");
  return found as Generic;
}

const diagnostics = (source: string, options?: Parameters<typeof analyze>[2]) => analyze(source, undefined, options).diagnostics.map((d) => [d.code, d.message]);
const codes = (source: string) => diagnostics(source).map(([code]) => code);
const generic = (prototype: string, settings: Generic["settings"] = {}, more: Partial<Generic> = {}): Generic => ({ id: "x", name: "e", position: { x: 0, y: 0 }, kind: "entity", prototype, settings, ...more });

/** Runs a command on `source` and returns the new source. */
function run(source: string, command: (parsed: ReturnType<typeof valid>) => EditCommand): string {
  const parsed = valid(source);
  const result = executeCommand(parsed, command(parsed));
  if (!result.ok) throw new Error(result.message);
  return applyChanges(source, result.changes);
}

/** A value of a setting that is not its default, and the text that says it. */
function sample(spec: SettingSpec, prototype: string): { value: SettingValue; text: string } {
  const fallback = settingDefault(spec, entityTable().byName.get(prototype)!);
  switch (spec.type) {
    case "boolean": return { value: !spec.default, text: `${spec.key} = ${!spec.default}` };
    case "enum": {
      const word = spec.values.find((value) => value.word !== spec.default)!.word;
      return { value: word, text: `${spec.key} = ${word}` };
    }
    case "signal": {
      const id: SignalId = fallback && signalKey(fallback as SignalId) === "virtual:signal-A" ? { kind: "virtual", name: "signal-B" } : A;
      return { value: id, text: `${spec.key} = ${signalKey(id)}` };
    }
    case "networks": return { value: { red: false, green: true }, text: `${spec.key} = green` };
    case "condition": {
      const role = conditionRole(spec.key);
      return { value: BELOW, text: `${role === undefined ? "" : `${role} `}when item:iron-plate < 100` };
    }
  }
}

/** One prototype of the standard game per prototype type that has a row of settings; a type only mods wire (`loader-1x1`) has none. */
const ONE_PER_TYPE = Object.keys(ENTITY_SETTINGS).flatMap((type) => entityTable().entities.find((prototype) => prototype.type === type)?.name ?? []);

describe("the word entity", () => {
  it("is a word like any other: a name for an entity, no entity of the game, and the kind of a signal", () => {
    expect(isKeyword("entity")).toBe(false);
    expect(codes(circuit("small-lamp entity { }\nwire red entity.in <-> entity.in"))).toEqual(["self-wire"]);
    expect(codes(circuit("entity e { }"))).toEqual(["unknown-prototype"]);
    expect(tokenize("entity e { } entity:small-biter").filter((token) => token.kind === "ident" || token.kind === "signal").map((token) => [token.kind, token.text])).toEqual([["ident", "entity"], ["ident", "e"], ["signal", "entity:small-biter"]]);
    expect(codes(circuit("constant-combinator c { entity:small-biter = 3 }"))).toEqual([]);
  });
});

describe("declaration", () => {
  it("reads the prototype, the settings of its type and the conditions", () => {
    const feeder = entity("fast-inserter feeder at (300, 80) tile (3.5, 0.5) facing north {\n    when item:iron-plate < 100\n    read-hand = pulse\n    set-filters = true\n}");
    expect(feeder).toEqual({
      id: "e1", name: "feeder", position: { x: 300, y: 80 }, placement: { tile: { x: 3.5, y: 0.5 }, direction: "north" }, kind: "entity", prototype: "fast-inserter",
      settings: { when: BELOW, "set-filters": true, "read-hand": "pulse" },
    });
    // In the order of the table, whatever the order of the source.
    expect(Object.keys(feeder.settings)).toEqual(["when", "set-filters", "read-hand"]);
  });

  it("takes every prototype of the kind, bare or quoted, with nothing but its name", () => {
    expect(prototypesOf("entity")).toHaveLength(88);
    for (const prototype of prototypesOf("entity")) {
      expect(entity(`${prototype} e { }`)).toEqual({ id: "e1", name: "e", position: { x: 40, y: 40 }, kind: "entity", prototype, settings: {} });
      expect(entity(`"${prototype}" e { }`).prototype).toBe(prototype);
    }
  });

  it("reads every setting of every prototype type and prints it back", () => {
    let settings = 0;
    for (const prototype of ONE_PER_TYPE) {
      const specs = settingSpecsOf(prototype);
      const samples = specs.map((spec) => ({ spec, ...sample(spec, prototype) }));
      const expected = Object.fromEntries(samples.map(({ spec, value }) => [spec.key, value]));
      // All of them at once, in reverse order of the table.
      const all = entity(`${prototype} e { ${samples.map(({ text }) => text).reverse().join(" ")} }`);
      expect(all.settings, prototype).toEqual(expected);
      expect(Object.keys(all.settings)).toEqual(specs.map((spec) => spec.key));
      expect(printEntity(all)).toBe([`${prototype} e at (40, 40) {`, ...samples.map(({ text }) => `    ${text}`), "}"].join("\n"));
      // And each alone.
      for (const { spec, value, text } of samples) {
        expect(entity(`${prototype} e { ${text} }`).settings, `${prototype} ${spec.key}`).toEqual({ [spec.key]: value });
        settings++;
      }
    }
    expect(ONE_PER_TYPE).toHaveLength(41);
    expect(settings).toBe(240);
  });

  it("accepts a setting at its default and holds none", () => {
    for (const prototype of ONE_PER_TYPE) {
      const game = entityTable().byName.get(prototype)!;
      const texts = settingSpecsOf(prototype).flatMap((spec) => {
        const fallback = settingDefault(spec, game);
        if (fallback === undefined || spec.type === "networks") return [];
        return [`${spec.key} = ${spec.type === "signal" ? signalKey(fallback as SignalId) : String(fallback)}`];
      });
      const written = valid(circuit(`${prototype} e { ${texts.join(" ")} }`));
      expect((written.circuit.entities[0] as Generic).settings, prototype).toEqual({});
      // The statements stay as written until the entity is changed, and an unchanged entity is no change.
      expect(updateEntity(written, "e1", written.circuit.entities[0]!)).toEqual([]);
    }
    expect(entity("steel-chest box { read-contents = true empty-slots-signal = virtual:signal-E }").settings).toEqual({});
    expect(entity("steel-chest box { read-contents = false empty-slots-signal = virtual:signal-A }").settings).toEqual({ "read-contents": false, "empty-slots-signal": A });
  });

  it("reads the conditions as statements, the further ones with their role", () => {
    const tower = entity("agricultural-tower t { plant when anything > virtual:signal-A harvest when everything != 0; logistic when item:iron-plate < 100 when virtual:signal-A = virtual:signal-A }");
    expect(tower.settings).toEqual({
      when: { first: A, comparator: "=", second: { type: "signal", signal: A } },
      "logistic-when": BELOW,
      "harvest-when": { first: { kind: "virtual", name: "signal-everything" }, comparator: "!=", second: { type: "constant", value: 0 } },
      "plant-when": { first: { kind: "virtual", name: "signal-anything" }, comparator: ">", second: { type: "signal", signal: A } },
    });
    expect(entity("splitter s { input-left when item:iron-plate < 100 output-right when item:iron-plate < 100 }").settings).toEqual({ "input-left-when": BELOW, "output-right-when": BELOW });
    expect(entity("stone-wall w { open-gate when item:iron-plate < 100 }").settings).toEqual({ "open-gate-when": BELOW });
    expect(entity("rail-signal r { close when item:iron-plate < 100 }").settings).toEqual({ "close-when": BELOW });
    expect(entity("gun-turret g { ignore-unlisted when item:iron-plate < 100 }").settings).toEqual({ "ignore-unlisted-when": BELOW });
    // A property value in front of a condition is not its role.
    expect(entity("radar d { mode = universe }").settings).toEqual({ mode: "universe" });
    expect(entity("inserter i { read-hand = hold when item:iron-plate < 100 networks = none logistic when item:iron-plate < 100 }").settings).toEqual({ when: BELOW, "logistic-when": BELOW, networks: { red: false, green: false }, "read-hand": "hold" });
  });

  it("reads 'when unset' as a condition that is in use and names no signal, for every condition a prototype has", () => {
    expect(entity("express-transport-belt belt1 at (0, 0) {\n    when unset\n}").settings).toEqual({ when: UNSET_CONDITION });
    expect(entity("fast-inserter i { logistic when unset when item:iron-plate < 100 }").settings).toEqual({ when: BELOW, "logistic-when": UNSET_CONDITION });
    expect(entity("stone-wall w { open-gate when unset }").settings).toEqual({ "open-gate-when": UNSET_CONDITION });
    expect(entity("splitter s { input-left when unset output-right when item:iron-plate < 100 }").settings).toEqual({ "input-left-when": UNSET_CONDITION, "output-right-when": BELOW });
    for (const prototype of prototypesOf("entity")) {
      const conditions = settingSpecsOf(prototype).filter((spec) => spec.type === "condition");
      if (conditions.length === 0) continue;
      const statements = conditions.map((spec) => `${[conditionRole(spec.key), "when"].filter(Boolean).join(" ")} unset`);
      const settings = Object.fromEntries(conditions.map((spec) => [spec.key, UNSET_CONDITION]));
      const read = entity(`${prototype} e {\n${statements.join("\n")}\n}`);
      expect(read.settings, prototype).toEqual(settings);
      // The printer writes the same statements, and they read back.
      expect(printEntity(read).split("\n").slice(1, -1).map((line) => line.trim()), prototype).toEqual(statements);
      expect(checkEntity(read), prototype).toEqual({ ok: true });
    }
    // The word means this only in the place of a comparison: it is no keyword and no signal, and a name like any other.
    expect(isKeyword("unset")).toBe(false);
    expect(tokenize("when unset").filter((token) => token.kind !== "whitespace").map((token) => token.kind)).toEqual(["keyword", "ident"]);
    const named = valid(circuit("transport-belt unset { when unset }\nconstant-combinator c { virtual:unset = 1 }\nwire red c.out <-> unset")).circuit;
    expect(named.entities.map((one) => one.name)).toEqual(["unset", "c"]);
    expect((named.entities[0] as Generic).settings).toEqual({ when: UNSET_CONDITION });
    expect(entity("transport-belt b { when virtual:unset > 0 }").settings).toEqual({ when: { first: { kind: "virtual", name: "unset" }, comparator: ">", second: { type: "constant", value: 0 } } });
    expect(entity("transport-belt b { when anything > 0 logistic when everything > 0 }").settings).toMatchObject({ when: { first: { name: "signal-anything" } }, "logistic-when": { first: { name: "signal-everything" } } });
    // Before the next statement and before the next declaration, with or without a line break.
    expect(entity("transport-belt b { when unset read-contents = hold logistic when unset networks = red }").settings).toEqual({ when: UNSET_CONDITION, "logistic-when": UNSET_CONDITION, networks: { red: true, green: false }, "read-contents": "hold" });
    expect(valid(circuit("transport-belt b { when unset } small-lamp l { when unset } transport-belt b2 { logistic when unset }")).circuit.entities).toHaveLength(3);
  });

  it("keeps the blueprint data byte for byte", () => {
    const texts = ["{}", '{"recipe":"iron-gear-wheel"}', '{ "spaced" : [1, 2.50, -0, 1e3], "nested": {"a": null} }', '{"text":"line\\nbreak \\"quoted\\" back\\\\slash \\u00fc tab\\t Grüße 日本語 → 𝒜 // no comment /* none */"}'];
    for (const text of texts) {
      const made = generic("assembling-machine-2", {}, { blueprintData: text });
      const printed = printCircuit({ name: "", entities: [made], wires: [] });
      const read = valid(printed).circuit.entities[0] as Generic;
      expect(read.blueprintData).toBe(text);
      expect(printCircuit({ name: "", entities: [read], wires: [] })).toBe(printed);
      expect(checkEntity(made)).toEqual({ ok: true });
    }
    expect(entity('steel-chest e { blueprint-data = "{\\"bar\\":3}" }').blueprintData).toBe('{"bar":3}');
    expect(entity("steel-chest e { }")).not.toHaveProperty("blueprintData");
  });
});

describe("diagnostics", () => {
  it("wants a name the game data has: one error on the word, with the nearest names", () => {
    expect(diagnostics(circuit("chest e { }"))).toEqual([["unknown-prototype", "Unknown entity 'chest'; did you mean active-provider-chest, blue-chest, bottomless-chest?"]]);
    expect(diagnostics(circuit("steel-chst e { }"))).toEqual([["unknown-prototype", "Unknown entity 'steel-chst'; did you mean steel-chest?"]]);
    expect(diagnostics(circuit("gate e { }"))).toEqual([
      ["unknown-prototype", "Unknown entity 'gate': the game data in use has no entity of this name (the names are the game's, as a blueprint has them: constant-combinator, small-lamp, steel-chest)"],
    ]);
    // What the declaration says is not judged: the settings of nothing cannot be.
    expect(codes(circuit("gate e { read-contents = pulse when item:a > 1 logistic when item:a > 1 nope = 1 ) }"))).toEqual(["unknown-prototype"]);
    // The property that once said which entity it is means nothing any more.
    expect(diagnostics(circuit("steel-chest e { prototype = iron-chest }"))).toEqual([
      ["unknown-property", "A steel chest (steel-chest) has no setting 'prototype'; it has description, output-networks, read-contents, read-empty-slots, empty-slots-signal, blueprint-data"],
    ]);
    expect(codes(circuit("5 e { }"))).toEqual(["syntax-error"]);
  });

  it("names the prototype and what it has for a setting its type does not have", () => {
    expect(diagnostics(circuit("steel-chest e { read-hand = pulse }"))).toEqual([
      ["unknown-property", "A steel chest (steel-chest) has no setting 'read-hand'; it has description, output-networks, read-contents, read-empty-slots, empty-slots-signal, blueprint-data"],
    ]);
    expect(diagnostics(circuit("fast-inserter e { nope = 1 }"))).toEqual([
      ["unknown-property", "A fast inserter (fast-inserter) has no setting 'nope'; it has description, networks, output-networks, set-filters, read-hand, set-stack-size, stack-size-signal, blueprint-data, when, logistic when"],
    ]);
    expect(diagnostics(circuit("steel-chest e { when item:a > 1 }"))).toEqual([["invalid-statement", "A steel chest (steel-chest) has no 'when' condition; it has no conditions"]]);
    expect(diagnostics(circuit("fast-inserter e { harvest when item:a > 1 }"))).toEqual([["invalid-statement", "A fast inserter (fast-inserter) has no 'harvest when' condition; it has 'when', 'logistic when'"]]);
    expect(diagnostics(circuit("splitter e { when item:a > 1 }"))).toEqual([
      ["invalid-statement", "A splitter (splitter) has no 'when' condition; it has 'input-left when', 'input-right when', 'output-left when', 'output-right when'"],
    ]);
    expect(diagnostics(circuit("display-panel e { read-contents = true }"))).toEqual([["unknown-property", "A display panel (display-panel) has no setting 'read-contents'; it has description, blueprint-data"]]);
  });

  it("checks the values by the form the setting has for the prototype", () => {
    expect(diagnostics(circuit("steel-chest e { read-contents = pulse }"))).toEqual([["invalid-value", "Invalid value 'pulse' for 'read-contents'; expected true or false"]]);
    expect(diagnostics(circuit("transport-belt e { read-contents = true }"))).toEqual([["invalid-value", "Invalid value 'true' for 'read-contents'; expected one of none, pulse, hold, entire-belt-hold"]]);
    expect(diagnostics(circuit("steel-chest e { empty-slots-signal = 5 }"))).toEqual([["invalid-value", "Invalid value '5' for 'empty-slots-signal'; expected a signal"]]);
    expect(diagnostics(circuit("steel-chest e { output-networks = both }"))).toEqual([["invalid-value", "Invalid value 'both' for 'output-networks'; expected one of red, green, none"]]);
    expect(codes(circuit("steel-chest e { empty-slots-signal = each }"))).toEqual(["illegal-wildcard"]);
    expect(codes(circuit("steel-chest e { empty-slots-signal = bogus:x }"))).toEqual(["invalid-signal"]);
    expect(codes(circuit("steel-chest e { read-contents = false read-contents = false }"))).toEqual(["duplicate-statement"]);
    expect(codes(circuit("steel-chest e { item:a = 1 }"))).toEqual(["invalid-statement"]);
    expect(codes(circuit("steel-chest e { output item:a = 1 }"))).toEqual(["invalid-statement"]);
    expect(codes(circuit("steel-chest e { section { } }"))).toEqual(["invalid-statement"]);
  });

  it("takes a single comparison as a condition, with the wildcards of a lamp and no network selection", () => {
    const inserter = (statements: string) => circuit(`inserter e { ${statements} }`);
    expect(diagnostics(inserter("when item:a > 1 and item:b > 2"))).toEqual([["syntax-error", "An entity condition is a single comparison"]]);
    expect(diagnostics(inserter("when item:a[red] > 1"))).toEqual([["syntax-error", "An entity condition signal (use the 'networks' property) takes no network selection"]]);
    expect(diagnostics(inserter("when item:a > item:b[green]"))).toEqual([["syntax-error", "An entity condition signal takes no network selection"]]);
    expect(codes(inserter("when each > 1"))).toEqual(["illegal-wildcard"]);
    expect(codes(inserter("when item:a > anything"))).toEqual(["illegal-wildcard"]);
    expect(codes(inserter("when anything > 1 logistic when everything > 1"))).toEqual([]);
    expect(diagnostics(inserter("when item:a > 1 when item:b > 1"))).toEqual([["duplicate-statement", "Duplicate 'when' condition"]]);
    expect(diagnostics(inserter("logistic when item:a > 1 logistic when item:b > 1"))).toEqual([["duplicate-statement", "Duplicate 'logistic when' condition"]]);
    expect(codes(inserter("when item:a > 2147483648"))).toEqual(["integer-range"]);
    expect(codes(inserter("when item:a >"))).toEqual(["syntax-error"]);
    expect(codes(inserter("logistic when"))).toEqual(["syntax-error"]);
    // A role in front of `when` belongs to a generic entity only.
    expect(diagnostics(circuit("small-lamp l { logistic when item:a > 1 }"))).toEqual([["invalid-statement", "A lamp has no 'logistic when' condition; write 'when'"]]);
    expect(codes(circuit("decider-combinator d { close when item:a > 1 output item:a = 1 }"))).toEqual(["unconfigured", "invalid-statement"]);
  });

  it("lets 'unset' stand alone, and only where the condition has a switch", () => {
    const belt = (statements: string) => circuit(`transport-belt e { ${statements} }`);
    const alone = "'unset' is the condition without a signal and stands alone: nothing is compared. Remove this, or name a signal in the place of 'unset'";
    for (const rest of ["> 5", "= 0", "< virtual:signal-A", "and item:a > 1", "or unset", "> 5 and item:a > 1"]) {
      const source = belt(`when unset ${rest}`);
      const found = analyze(source).diagnostics;
      expect(found.map((d) => [d.code, d.message]), rest).toEqual([["syntax-error", alone]]);
      expect(source.slice(found[0]!.from, found[0]!.to), rest).toBe(rest);
    }
    expect(diagnostics(belt("logistic when unset > 5"))).toEqual([["syntax-error", alone]]);
    expect(diagnostics(circuit("small-lamp l { when unset >= 1 }"))).toEqual([["syntax-error", alone]]);
    expect(diagnostics(belt("when unset >"))).toEqual([["syntax-error", alone]]);
    // As the second comparison it is one too many, like any other.
    expect(diagnostics(belt("when item:a > 1 and unset"))).toEqual([["syntax-error", "An entity condition is a single comparison"]]);
    expect(diagnostics(belt("when unset when unset"))).toEqual([["duplicate-statement", "Duplicate 'when' condition"]]);
    expect(diagnostics(belt("when"))).toEqual([["syntax-error", "Expected a signal or 'unset' but found '}'"]]);
    // It is no operand and no value.
    expect(codes(belt("when item:a > unset"))).toEqual(["syntax-error"]);
    expect(codes(circuit("steel-chest c { empty-slots-signal = unset }"))).toEqual(["invalid-value"]);
    // A decider combinator has no switch per condition, and a speaker none at all: without 'when' its condition is the blank one.
    const decider = "A decider combinator has no switch for a condition, so none of its conditions is 'unset'; name a signal";
    expect(diagnostics(circuit("decider-combinator d { when unset output item:a = 1 }"))).toEqual([["invalid-statement", decider]]);
    expect(diagnostics(circuit("decider-combinator d { when item:a > 1 and unset output item:a = 1 }"))).toEqual([["invalid-statement", decider]]);
    expect(diagnostics(circuit("decider-combinator d { when unset > 5 or item:a > 1 output item:a = 1 }"))).toEqual([["invalid-statement", decider]]);
    expect(diagnostics(circuit("programmable-speaker s { when unset }"))).toEqual([
      ["invalid-statement", "A programmable speaker has no switch for its condition, so there is no 'unset' to write: without a 'when' statement its condition has no signal"],
    ]);
    expect(diagnostics(circuit("small-lamp l { open when unset }"))).toEqual([["invalid-statement", "A lamp has no 'open when' condition; write 'when'"]]);
    expect(diagnostics(circuit("steel-chest c { when unset }")).map(([code]) => code)).toEqual(["invalid-statement"]);
  });

  it("wants the blueprint data to be the JSON text of an object", () => {
    const message = "'blueprint-data' is the JSON text of an object, as a blueprint has it for the entity";
    for (const text of ['""', '"[]"', '"5"', '"null"', '"{"', '"{\\"a\\":1} trailing"']) expect(diagnostics(circuit(`steel-chest e { blueprint-data = ${text} }`)), text).toEqual([["invalid-value", message]]);
    expect(codes(circuit("steel-chest e { blueprint-data = 5 }"))).toEqual(["invalid-value"]);
    expect(diagnostics(circuit('small-lamp l { blueprint-data = "{}" }'))[0]![0]).toBe("unknown-property");
  });
});

describe("terminal", () => {
  const WIRED = circuit(["    constant-combinator source { virtual:signal-A = 1 }", "    steel-chest box { }", "    inserter arm { }", "    wire red source.out <-> box", "    wire green box <-> arm"].join("\n"));

  it("is the bare name", () => {
    const { circuit: read } = valid(WIRED);
    expect(read.wires).toEqual([
      { color: "red", a: { entity: "e1", side: "out" }, b: { entity: "e2", side: "io" } },
      { color: "green", a: { entity: "e2", side: "io" }, b: { entity: "e3", side: "io" } },
    ]);
    expect(printCircuit(read)).toContain("    wire red source.out <-> box\n    wire green box <-> arm\n");
    expect(diagnostics(WIRED.replace("<-> box", "<-> box.in"))).toEqual([["invalid-terminal", "A steel chest has no 'in' terminal; write the bare name 'box'"]]);
    expect(diagnostics(WIRED.replace("box <-> arm", "box <-> arm.out"))).toEqual([["invalid-terminal", "An inserter has no 'out' terminal; write the bare name 'arm'"]]);
    expect(codes(WIRED.replace("box <-> arm", "box <-> box"))).toEqual(["self-wire"]);
  });

  it("is offered without a side, and no side behind a dot", () => {
    const source = `${WIRED.trimEnd().slice(0, -1)}    wire red box.`;
    const context = completionContext(analyze(source), source.length);
    expect(context.expected).toEqual([{ type: "side", entity: "box", sides: [] }]);
    const open = `${WIRED.trimEnd().slice(0, -1)}    wire red `;
    const terminals = completionContext(analyze(open), open.length).expected.find((e): e is Extract<Completion, { type: "terminal" }> => e.type === "terminal")!;
    expect(terminals.entities).toEqual([{ name: "source", kind: "constant", sides: ["out"] }, { name: "box", kind: "entity", sides: ["io"] }, { name: "arm", kind: "entity", sides: ["io"] }]);
  });
});

describe("placement", () => {
  const warnings = (source: string, options?: Parameters<typeof analyze>[2]) => diagnostics(source, options).filter(([code]) => code !== "unconfigured");

  it("knows the footprint and the rotation of the prototype", () => {
    expect(warnings(circuit("assembling-machine-2 a tile (1.5, 1.5) { }"))).toEqual([]);
    expect(warnings(circuit("assembling-machine-2 a tile (1, 1.5) { }"))).toEqual([
      ["tile-off-grid", "Not on the tile grid: the center of this assembling machine 2, which covers 3 x 3 tiles, needs x and y ending in .5; the nearest is (1.5, 1.5)"],
    ]);
    // A boiler is 3 x 2 facing north and turns.
    expect(warnings(circuit("boiler b tile (1.5, 1) facing north { }"))).toEqual([]);
    expect(warnings(circuit("boiler b tile (1.5, 1) { }"))).toEqual([
      ["tile-off-grid", "Not on the tile grid: facing east, the center of this boiler, which covers 2 x 3 tiles, needs a whole x and a y ending in .5; the nearest is (2, 1.5)"],
    ]);
    expect(warnings(circuit("rocket-silo s tile (4.5, 4.5) { }\nwooden-chest c tile (8.5, 8.5) { }")).map(([code]) => code)).toEqual(["tile-overlap", "tile-overlap"]);
    expect(warnings(circuit("rocket-silo s tile (4.5, 4.5) { }\nwooden-chest c tile (9.5, 8.5) { }"))).toEqual([]);
  });

  it("warns about facing on a prototype that cannot turn, by its name", () => {
    expect(warnings(circuit("wooden-chest c facing north { }"))).toEqual([["unused-facing", "A wooden chest cannot be rotated; 'facing' is ignored"]]);
    expect(warnings(circuit("inserter i facing north { }"))).toEqual([]);
    // The storage tank is built in two directions; south and west are kept as written.
    expect(warnings(circuit("storage-tank t tile (1.5, 1.5) facing south { }"))).toEqual([]);
  });

  it("lets a land mine stand anywhere", () => {
    expect(warnings(circuit("land-mine m tile (1.25, -0.75) { }"))).toEqual([]);
    expect(warnings(circuit("stone-wall m tile (1.25, -0.75) { }")).map(([code]) => code)).toEqual(["tile-off-grid"]);
  });

  it("measures a wire with the reach of the prototype", () => {
    const pair = (prototype: string, gap: number) => circuit(`wooden-chest a tile (0.5, 0.5) { }\n${prototype} b tile (${gap + 2}, 1) { }\nwire red a <-> b`);
    // The smaller reach of the two ends: the chest has the project's, the switch its own 10.
    expect(warnings(pair("power-switch", 9))).toEqual([]);
    expect(warnings(pair("power-switch", 10)).map(([, message]) => message)).toEqual(["Wire from 'a' to 'b': the entities are 10 tiles apart; the wire reach of the project is 9"]);
    expect(warnings(pair("power-switch", 10), { wireReach: 20 })).toEqual([]);
    expect(warnings(pair("power-switch", 11), { wireReach: 20 }).map(([, message]) => message)).toEqual(["Wire from 'a' to 'b': the entities are 11 tiles apart; the wire reach of a power switch is 10"]);
  });
});

describe("canonical printer", () => {
  it("writes the prototype as the word, the settings in the order of the table and the blueprint data last", () => {
    const made = generic("fast-inserter", { "read-hand": "hold", "logistic-when": BELOW, networks: { red: true, green: false }, when: { first: { kind: "virtual", name: "signal-anything" }, comparator: ">=", second: { type: "signal", signal: A } } }, {
      name: "feeder", description: "two\nlines", placement: { tile: { x: 3.5, y: 0.5 }, direction: "north" }, blueprintData: '{"quality":"rare"}',
    });
    expect(printEntity(made)).toBe(
      [
        "fast-inserter feeder at (0, 0) tile (3.5, 0.5) facing north {",
        '    description = "two\\nlines"',
        "    when anything >= virtual:signal-A",
        "    logistic when item:iron-plate < 100",
        "    networks = red",
        "    read-hand = hold",
        '    blueprint-data = "{\\"quality\\":\\"rare\\"}"',
        "}",
      ].join("\n"),
    );
    expect(printEntity(generic("wooden-chest"))).toBe("wooden-chest e at (0, 0) {\n}");
    expect(printEntity({ ...newEntity("wooden-chest"), id: "x", name: "e", position: { x: 0, y: 0 } })).toBe("wooden-chest e at (0, 0) {\n}");
  });

  it("tells an entity that is not in the form of the model", () => {
    expect(checkEntity(generic("steel-chest", { "read-contents": false }))).toEqual({ ok: true });
    // At its default, of another type, or no value of the setting: `normalizedSettings` makes the form.
    expect(checkEntity(generic("steel-chest", { "read-contents": true }))).toMatchObject({ ok: false, code: "unrepresentable" });
    expect(checkEntity(generic("steel-chest", { "read-hand": "pulse" }))).toMatchObject({ ok: false, code: "unrepresentable" });
    expect(checkEntity(generic("steel-chest", { "output-networks": BOTH_NETWORKS }))).toMatchObject({ ok: false, code: "unrepresentable" });
    expect(checkEntity(generic("steel-chest", normalizedSettings("steel-chest", { "read-contents": true, "read-hand": "pulse", "output-networks": BOTH_NETWORKS })))).toEqual({ ok: true });
    expect(checkEntity(generic("steel-chest", { "empty-slots-signal": { kind: "virtual", name: "signal-each" } }))).toMatchObject({ ok: false, code: "invalid-entity" });
    expect(checkEntity(generic("gate"))).toMatchObject({ ok: false, code: "invalid-entity" });
    // The kind is the one of the prototype: a lamp that says it is a generic entity is not what the source reads back.
    expect(checkEntity(generic("small-lamp"))).toMatchObject({ ok: false, code: "unrepresentable" });
    expect(checkEntity(generic("steel-chest", {}, { blueprintData: "[]" }))).toMatchObject({ ok: false, code: "invalid-entity" });
  });
});

describe("commands", () => {
  const EMPTY = 'circuit "t" {\n}\n';

  it("adds an entity of a prototype and names it after it", () => {
    let parse = valid(EMPTY);
    const names: string[] = [];
    for (const prototype of ["fast-inserter", "fast-inserter", "assembling-machine-2", "assembling-machine-3", "steel-chest", "stone-wall", "crash-site-chest-1"]) {
      const { changes, name } = addEntity(parse, prototype, { x: 0, y: 0 });
      names.push(name);
      parse = valid(applyChanges(parse.source, changes), parse);
    }
    expect(names).toEqual(["fast_inserter1", "fast_inserter2", "assembling_machine1", "assembling_machine2", "steel_chest1", "stone_wall1", "crash_site_chest1"]);
    expect(parse.circuit.entities.map((e) => (e as Generic).prototype)).toEqual(["fast-inserter", "fast-inserter", "assembling-machine-2", "assembling-machine-3", "steel-chest", "stone-wall", "crash-site-chest-1"]);
    expect(applyChanges(EMPTY, addEntity(valid(EMPTY), "pump", { x: 20, y: 40 }).changes)).toBe('circuit "t" {\n    pump pump1 at (20, 40) {\n    }\n}\n');
    // The other kinds keep the kind as their name.
    expect(addEntity(valid(EMPTY), "substation", { x: 0, y: 0 }).name).toBe("pole1");
  });

  it("wants a prototype the game data has", () => {
    const failure = (prototype: string) => {
      const result = executeCommand(valid(EMPTY), { type: "addEntity", prototype, position: { x: 0, y: 0 } });
      return result.ok ? "ok" : `${result.code}: ${result.message}`;
    };
    expect(failure("gate")).toBe("invalid-entity: 'gate' is not an entity of the game data in use");
    expect(failure("entity")).toBe("invalid-entity: 'entity' is not an entity of the game data in use");
    expect(failure("steel-chest")).toBe("ok");
    expect(failure("small-lamp")).toBe("ok");
  });

  it("places a new entity by the footprint and the rotation of its prototype", () => {
    const add = (prototype: string, tile: { x: number; y: number }, facing?: "north" | "east" | "south" | "west") => {
      const result = executeCommand(valid(EMPTY), { type: "addEntity", prototype, position: { x: 0, y: 0 }, tile, ...(facing && { facing }) });
      return result.ok ? applyChanges(EMPTY, result.changes).split("\n")[1]!.trim() : result.code;
    };
    expect(add("boiler", { x: 1, y: 1.5 })).toBe("boiler boiler1 at (0, 0) tile (1, 1.5) {");
    expect(add("boiler", { x: 1.5, y: 1 }, "north")).toBe("boiler boiler1 at (0, 0) tile (1.5, 1) facing north {");
    expect(add("boiler", { x: 1.5, y: 1 })).toBe("invalid-position");
    // A chest does not turn: no clause.
    expect(add("steel-chest", { x: 0.5, y: 0.5 }, "south")).toBe("steel-chest steel_chest1 at (0, 0) tile (0.5, 0.5) {");
    expect(add("land-mine", { x: 0.25, y: 0.1 })).toBe("land-mine land_mine1 at (0, 0) tile (0.25, 0.1) {");
    expect(add("rocket-silo", { x: 4.5, y: 4.5 })).toBe("rocket-silo rocket_silo1 at (0, 0) tile (4.5, 4.5) {");
  });

  const SOURCE = circuit(
    [
      "    constant-combinator source { virtual:signal-A = 1 }",
      "    fast-inserter feeder at (300, 80) tile (3.5, 0.5) facing north { // the arm",
      "        when item:iron-plate < 100 // stop when full",
      "        read-hand = pulse",
      '        blueprint-data = "{\\"quality\\":\\"rare\\"}"',
      "    }",
      "    wire red source.out <-> feeder",
    ].join("\n"),
  );
  const feederOf = (parsed: ReturnType<typeof valid>) => parsed.circuit.entities.find((e) => e.name === "feeder") as Generic;
  const update = (change: (feeder: Generic) => Generic, source = SOURCE) => run(source, (parsed) => ({ type: "updateEntity", id: idOf(parsed, "feeder"), entity: change(feederOf(parsed)) }));

  it("changes one setting as one statement and leaves the rest of the text alone", () => {
    expect(update((feeder) => ({ ...feeder, settings: { ...feeder.settings, "read-hand": "hold" } }))).toBe(SOURCE.replace("read-hand = pulse", "read-hand = hold"));
    expect(update((feeder) => ({ ...feeder, settings: { ...feeder.settings, when: { ...BELOW, comparator: ">=" } } }))).toBe(SOURCE.replace("iron-plate < 100", "iron-plate >= 100"));
    // A new setting goes where the table has it: a condition behind the conditions, a switch before the mode.
    expect(update((feeder) => ({ ...feeder, settings: normalizedSettings(feeder.prototype, { ...feeder.settings, "logistic-when": BELOW, "set-filters": true }) }))).toBe(
      SOURCE.replace("// stop when full\n", "// stop when full\n        logistic when item:iron-plate < 100\n        set-filters = true\n"),
    );
    // A condition that is not in use goes; a property that is back at its default says the default, as for every kind.
    const { "read-hand": _mode, when: _when, ...rest } = feederOf(valid(SOURCE)).settings;
    expect(update((feeder) => ({ ...feeder, settings: rest }))).toBe(SOURCE.replace("        when item:iron-plate < 100 // stop when full\n", "").replace("read-hand = pulse", "read-hand = none"));
    expect(update((feeder) => feeder)).toBe(SOURCE);
  });

  it("writes a condition that loses its signal as 'when unset', and one that gets a signal as the comparison", () => {
    const unset = update((feeder) => ({ ...feeder, settings: { ...feeder.settings, when: UNSET_CONDITION } }));
    expect(unset).toBe(SOURCE.replace("when item:iron-plate < 100", "when unset"));
    expect(update((feeder) => ({ ...feeder, settings: { ...feeder.settings, when: BELOW } }), unset)).toBe(SOURCE);
    expect(update((feeder) => ({ ...feeder, settings: normalizedSettings(feeder.prototype, { ...feeder.settings, "logistic-when": UNSET_CONDITION }) }))).toBe(SOURCE.replace("// stop when full\n", "// stop when full\n        logistic when unset\n"));
    const { when: _when, ...rest } = feederOf(valid(unset)).settings;
    expect(update((feeder) => ({ ...feeder, settings: rest }), unset)).toBe(SOURCE.replace("        when item:iron-plate < 100 // stop when full\n", ""));
  });

  it("changes the blueprint data and the prototype", () => {
    expect(update((feeder) => ({ ...feeder, blueprintData: '{"quality":"epic"}' }))).toBe(SOURCE.replace("rare", "epic"));
    const { blueprintData: _data, ...bare } = feederOf(valid(SOURCE));
    expect(update(() => bare)).toBe(SOURCE.replace('        blueprint-data = "{\\"quality\\":\\"rare\\"}"\n', ""));
    // Another prototype of the type keeps the settings; one of another type cannot hold what it does not have.
    expect(update((feeder) => ({ ...feeder, prototype: "bulk-inserter" }))).toBe(SOURCE.replace("fast-inserter", "bulk-inserter"));
    const result = executeCommand(valid(SOURCE), { type: "updateEntity", id: "e2", entity: { ...feederOf(valid(SOURCE)), prototype: "steel-chest" } });
    expect(result).toMatchObject({ ok: false, code: "unrepresentable" });
    expect(update((feeder) => ({ ...feeder, prototype: "steel-chest", settings: {} }))).toBe(SOURCE.replace("fast-inserter", "steel-chest").replace("        when item:iron-plate < 100 // stop when full\n", "").replace("        read-hand = pulse\n", ""));
    // The chest cannot turn: the clause that the inserter needed stays and is said to be unused.
    expect(codes(update((feeder) => ({ ...feeder, prototype: "steel-chest", settings: {} })))).toEqual(["unused-facing"]);
    expect(executeCommand(valid(SOURCE), { type: "updateEntity", id: "e2", entity: { ...DEFAULT_ENTITY.lamp, prototype: "small-lamp", id: "e2", name: "feeder", position: { x: 300, y: 80 } } })).toMatchObject({ ok: false, code: "kind-mismatch" });
  });

  it("renames, wires, turns, moves and deletes it like any other entity", () => {
    expect(run(SOURCE, (parsed) => ({ type: "renameEntity", id: idOf(parsed, "feeder"), name: "arm" }))).toBe(SOURCE.replace("fast-inserter feeder", "fast-inserter arm").replace("<-> feeder", "<-> arm"));
    const wired = run(SOURCE, (parsed) => ({ type: "addWire", color: "green", a: { entity: idOf(parsed, "feeder"), side: "io" }, b: { entity: idOf(parsed, "source"), side: "out" } }));
    expect(wired).toBe(SOURCE.replace("<-> feeder\n", "<-> feeder\n    wire green feeder <-> source.out\n"));
    expect(executeCommand(valid(SOURCE), { type: "addWire", color: "green", a: { entity: "e2", side: "in" }, b: { entity: "e1", side: "out" } })).toMatchObject({ ok: false, code: "invalid-terminal" });
    expect(run(SOURCE, (parsed) => ({ type: "faceEntities", facings: [{ id: idOf(parsed, "feeder"), direction: "west" }] }))).toBe(SOURCE.replace("facing north", "facing west"));
    expect(run(SOURCE, (parsed) => ({ type: "setTiles", tiles: [{ id: idOf(parsed, "feeder"), tile: { x: -2.5, y: 7.5 } }] }))).toBe(SOURCE.replace("tile (3.5, 0.5)", "tile (-2.5, 7.5)"));
    expect(executeCommand(valid(SOURCE), { type: "setTiles", tiles: [{ id: "e2", tile: { x: 3, y: 0.5 } }] })).toMatchObject({ ok: false, code: "invalid-position" });
    expect(valid(run(SOURCE, (parsed) => ({ type: "deleteEntities", ids: [idOf(parsed, "feeder")] }))).circuit).toMatchObject({ entities: [{ name: "source" }], wires: [] });
  });

  it("turns an oblong entity on its top-left tile and leaves one that cannot turn", () => {
    const source = circuit("    boiler b tile (1.5, 1) facing north { }\n    steel-chest c tile (5.5, 0.5) { }\n    storage-tank t tile (9.5, 1.5) { }");
    const turned = run(source, (parsed) => ({ type: "faceEntities", facings: parsed.circuit.entities.map((e) => ({ id: e.id, direction: "east" as const })) }));
    expect(turned).toBe(source.replace("tile (1.5, 1) facing north", "tile (1, 1.5) facing east"));
    const south = run(source, (parsed) => ({ type: "faceEntities", facings: parsed.circuit.entities.map((e) => ({ id: e.id, direction: "south" as const })) }));
    // A half turn of the boiler keeps its tiles; the tank faces north or east only, so south is north for it: a new clause, the same tiles.
    expect(south).toBe(source.replace("facing north", "facing south").replace("tile (9.5, 1.5)", "tile (9.5, 1.5) facing north"));
  });

  it("copies and pastes it with its settings, the blueprint data and its wires, without the tile", () => {
    const parsed = valid(SOURCE);
    const fragment = extractFragment(parsed.circuit, parsed.circuit.entities.map((e) => e.id));
    const text = printFragment(fragment);
    expect(text).toContain('fast-inserter feeder at (300, 80) tile (3.5, 0.5) facing north {\n    when item:iron-plate < 100\n    read-hand = pulse\n    blueprint-data = "{\\"quality\\":\\"rare\\"}"\n}');
    const read = analyzeFragment(text);
    expect(read.diagnostics).toEqual([]);
    const { changes, names } = pasteFragment(parsed, read.fragment!, { x: 40, y: 40 });
    expect(names).toEqual(["source2", "feeder2"]);
    const after = valid(applyChanges(SOURCE, changes), parsed);
    const copy = after.circuit.entities.find((e) => e.name === "feeder2") as Generic;
    const { id: _id, name: _name, position: _position, placement: _placement, ...original } = feederOf(parsed);
    expect(copy).toMatchObject({ ...original, position: { x: 340, y: 120 }, placement: { direction: "north" } });
    expect(after.circuit.wires).toHaveLength(2);
    // An entity that was named by `addEntity` is counted on.
    const named = valid(circuit("    fast-inserter fast_inserter1 { }\n    fast-inserter fast_inserter2 { }"));
    expect(pasteFragment(named, extractFragment(named.circuit, ["e1", "e2"])).names).toEqual(["fast_inserter3", "fast_inserter4"]);
  });
});

describe("schema and completion", () => {
  /** Completion at the `|` marker. */
  function at(marked: string): { prefix: string; expected: readonly Completion[]; get<T extends Completion["type"]>(type: T): Extract<Completion, { type: T }> | undefined } {
    const offset = marked.indexOf("|");
    const context = completionContext(analyze(marked.replace("|", "")), offset);
    return { ...context, get: (type) => context.expected.find((e) => e.type === type) as never };
  }

  it("has the properties of a prototype from the table", () => {
    expect(propertyNames("entity", "steel-chest")).toEqual(["description", "output-networks", "read-contents", "read-empty-slots", "empty-slots-signal", "blueprint-data"]);
    expect(propertyNames("entity", "radar")).toEqual(["description", "mode", "channel", "blueprint-data"]);
    expect(conditionRoles("agricultural-tower")).toEqual(["logistic", "harvest", "plant"]);
    expect(conditionRoles("steel-chest")).toEqual([]);
    expect(enumValues("entity", "read-contents", "steel-chest")).toEqual(["true", "false"]);
    expect(enumValues("entity", "read-contents", "transport-belt")).toEqual(["none", "pulse", "hold", "entire-belt-hold"]);
    expect(enumValues("entity", "read-contents", "pipe")).toEqual(["none", "contents", "segment-contents"]);
    expect(enumValues("entity", "networks", "inserter")).toEqual(["red", "green", "none"]);
    expect(lookupProperty("entity", "read-hand", "steel-chest")).toEqual({ status: "inapplicable", operations: [] });
    expect(lookupProperty("entity", "nope", "steel-chest")).toEqual({ status: "unknown" });
    // Without a prototype: every word any entity has.
    for (const prototype of prototypesOf("entity")) for (const name of propertyNames("entity", prototype)) expect(propertyNames("entity")).toContain(name);
  });

  it("offers what the prototype has, and nothing in the block of an entity the game does not have", () => {
    expect(at(circuit("entity e { | }")).expected).toEqual([]);
    const inserter = at(circuit("fast-inserter e { | }"));
    expect(inserter.get("keyword")!.values).toEqual(["when", "logistic"]);
    expect(inserter.get("property")).toEqual({ type: "property", kind: "entity", names: propertyNames("entity", "fast-inserter") });
    expect(at(circuit("splitter e { | }")).get("keyword")!.values).toEqual(["when", "input-left", "input-right", "output-left", "output-right"]);
    expect(at(circuit("steel-chest e { | }")).get("keyword")!.values).toEqual(["when"]);
  });

  it("offers the words of a setting, the signals of a condition and `when` behind a role", () => {
    expect(at(circuit("fast-inserter e { read-hand = | }")).get("enum")).toEqual({ type: "enum", property: "read-hand", values: ["none", "pulse", "hold"] });
    expect(at(circuit("fast-inserter e { set-filters = | }")).get("enum")!.values).toEqual(["true", "false"]);
    expect(at(circuit("fast-inserter e { networks = | }")).get("enum")!.values).toEqual(["red", "green", "none"]);
    expect(at(circuit("fast-inserter e { stack-size-signal = | }")).get("signal")).toEqual({ type: "signal", wildcards: [] });
    expect(at(circuit("fast-inserter e { when | }")).get("signal")).toEqual({ type: "signal", wildcards: ["anything", "everything"] });
    expect(at(circuit("fast-inserter e { logistic when | }")).get("signal")).toEqual({ type: "signal", wildcards: ["anything", "everything"] });
    expect(at(circuit("fast-inserter e { when item:a > | }")).get("signal")).toEqual({ type: "signal", wildcards: [] });
    expect(at(circuit("fast-inserter e { logistic | }")).expected).toEqual([{ type: "keyword", values: ["when"] }]);
    expect(at(circuit("fast-inserter e { log| }")).get("keyword")!.values).toEqual(["when", "logistic"]);
    expect(at(circuit('fast-inserter e { blueprint-data = | }')).expected).toEqual([{ type: "literal", kind: "string" }]);
    // A condition takes no `and`.
    expect(at(circuit("fast-inserter e { when item:a > 1 | }")).get("keyword")!.values).toEqual(["when", "logistic"]);
  });
});
