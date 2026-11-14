// The generic entities (kind `entity`): every prototype type of the settings table of the model, into a blueprint and back.
// The tests over all types are driven by `ENTITY_SETTINGS`, so a further row is covered without a further test.
import { analyze, checkEntity, printCircuit } from "@face/language";
import {
  ENTITY_SETTINGS, entityTable, facingOf, PROTOTYPES, prototypesOf, settingDefault, settingFields, settingSpecsOf, signal, tileCenter,
  type Circuit, type Condition, type Direction, type Entity, type EntityOfKind, type EntityPrototype, type EntitySettings, type NetworkSelection, type SettingSpec, type SettingValue, type SignalId,
} from "@face/model";
import { describe, expect, it } from "vitest";
import { COMPARATOR_SIGNS, exportBlueprint, importBlueprint, type BlueprintEntity } from "../src/index.ts";
import { A, B, blueprintOf, exported, imported, importedEntity, IRON, parse } from "./helpers.ts";
import { configuredSettings, GENERIC_SAMPLES, unsampledBehaviors } from "./samples.ts";

const TYPES = Object.keys(ENTITY_SETTINGS);
const game = (prototype: string): EntityPrototype => entityTable().byName.get(prototype)!;
const prototypesOfType = (type: string): string[] => entityTable().entities.filter((entity) => entity.type === type).map((entity) => entity.name);

/** A generic entity on a place that fits it, facing north (which a blueprint does not write) unless told otherwise. */
function generic(prototype: string, settings: EntitySettings = {}, more: Partial<Pick<EntityOfKind<"entity">, "blueprintData" | "description">> & { direction?: Direction } = {}): EntityOfKind<"entity"> {
  const { direction = "north", ...rest } = more;
  const shape = { kind: "entity" as const, prototype };
  return { id: "e1", name: "a", position: { x: 0, y: 0 }, kind: "entity", prototype, settings, placement: { tile: tileCenter(shape, direction, { x: 0, y: 0 }), direction }, ...rest };
}

const circuitOf = (...entities: Entity[]): Circuit => ({ name: "", entities: entities.map((entity, index) => ({ ...entity, id: `e${index + 1}`, name: `n${index + 1}` })), wires: [] });

/** The one entity of a blueprint of one entity, without number, name and position. */
function recordOf(entity: Entity): Record<string, unknown> {
  const { entity_number: _number, name: _name, position: _position, ...rest } = exported(circuitOf(entity)).blueprint.entities[0]!;
  return rest;
}

const blueprintSignal = (id: SignalId): object => ({ ...(id.kind !== "item" && { type: id.kind }), name: id.name, ...(id.quality && { quality: id.quality }) });

/** What a setting is in a `control_behavior`, spelled out here independently of the exporter. */
function fieldsOf(spec: SettingSpec, value: SettingValue): Record<string, unknown> {
  switch (spec.type) {
    case "boolean": return { [spec.field]: value };
    case "signal": return { [spec.field]: blueprintSignal(value as SignalId) };
    case "networks": return { [spec.field]: { red: (value as NetworkSelection).red, green: (value as NetworkSelection).green } };
    case "condition": {
      const { first, comparator, second } = value as Condition;
      return { [spec.flag]: true, [spec.field]: { first_signal: blueprintSignal(first!), ...(second.type === "signal" ? { second_signal: blueprintSignal(second.signal) } : { constant: second.value }), comparator: COMPARATOR_SIGNS[comparator] } };
    }
    case "enum": {
      const number = spec.values.find((entry) => entry.word === value)!.value;
      if (!spec.flag) return { [spec.field]: number };
      return value === spec.flag.off ? { [spec.flag.field]: false } : { [spec.flag.field]: true, [spec.field]: number };
    }
  }
}

/** A setting at its default, written out as a blueprint may have it. */
function defaultFields(spec: SettingSpec, prototype: EntityPrototype): Record<string, unknown> {
  const fallback = settingDefault(spec, prototype);
  if (spec.type === "condition") return { [spec.flag]: false };
  return fallback === undefined ? {} : fieldsOf(spec, fallback);
}

describe("generic entities: the settings table", () => {
  it("covers 41 prototype types and the 88 prototypes without a kind of their own", () => {
    expect(TYPES).toHaveLength(41);
    expect(TYPES.flatMap(prototypesOfType).sort()).toEqual([...prototypesOf("entity")].sort());
    expect(prototypesOf("entity")).toHaveLength(88);
  });

  describe.each(TYPES)("%s", (type) => {
    const prototypes = prototypesOfType(type);

    it("writes every setting to its field and reads it back", () => {
      for (const prototype of prototypes) {
        const specs = settingSpecsOf(prototype);
        const settings = configuredSettings(prototype);
        // Every setting of the row is away from its default.
        expect(Object.keys(settings), prototype).toEqual(specs.map((spec) => spec.key));
        const record = recordOf(generic(prototype, settings));
        const expected = Object.assign({}, ...specs.map((spec) => fieldsOf(spec, settings[spec.key]!))) as Record<string, unknown>;
        expect(record, prototype).toEqual(specs.length ? { control_behavior: expected } : {});
        expect(Object.keys((record.control_behavior ?? {}) as object).sort()).toEqual([...new Set(specs.flatMap(settingFields))].sort());

        const { entity, notes } = importedEntity(prototype, record);
        expect(notes, prototype).toEqual([]);
        expect(entity, prototype).toEqual(JSON.parse(JSON.stringify({ kind: "entity", prototype, settings })));
      }
    });

    it("writes nothing for an entity at its defaults, and reads the defaults whether they are left out or spelled out", () => {
      for (const prototype of prototypes) {
        expect(recordOf(generic(prototype)), prototype).toEqual({});
        const fresh = { entity: { kind: "entity", prototype, settings: {} }, notes: [] };
        expect(importedEntity(prototype), prototype).toEqual(fresh);
        expect(importedEntity(prototype, { control_behavior: {} }), prototype).toEqual(fresh);
        const spelled = Object.assign({}, ...settingSpecsOf(prototype).map((spec) => defaultFields(spec, game(prototype)))) as Record<string, unknown>;
        expect(importedEntity(prototype, { control_behavior: spelled }), prototype).toEqual(fresh);
      }
    });

    it("gives an entity the language can say exactly, whatever stands in its fields", () => {
      const junk: readonly unknown[] = [null, true, 0, -1, 7, 1.5, "text", [], {}, { name: "signal-each", type: "virtual" }, { first_signal: { type: "virtual", name: "signal-each" } }, { first_signal: A, second_signal: { type: "virtual", name: "signal-anything" } }, { red: "no" }];
      const [prototype] = prototypes;
      const fields = [...new Set(settingSpecsOf(prototype!).flatMap(settingFields))];
      for (const value of junk) {
        const control = Object.fromEntries(fields.map((field) => [field, value]));
        const result = importBlueprint(blueprintOf([{ entity_number: 1, name: prototype, position: { x: 0.5, y: 0.5 }, control_behavior: control }]));
        if (!result.ok) throw new Error(result.message);
        expect(checkEntity(result.circuit.entities[0]!), `${prototype} ${JSON.stringify(value)}`).toEqual({ ok: true });
        const printed = analyze(printCircuit(result.circuit));
        expect(printed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      }
    });
  });
});

describe("generic entities: settings by example", () => {
  const when = { first_signal: IRON, constant: 100, comparator: "<" };
  const condition: Condition = { first: signal("item", "iron-plate"), comparator: "<", second: { type: "constant", value: 100 } };

  it("reads an inserter: the enable condition, the hand read mode folded into one word, what it keeps", () => {
    const fields = {
      direction: 4,
      control_behavior: { circuit_enabled: true, circuit_condition: when, circuit_read_hand_contents: true, circuit_hand_read_mode: 1, circuit_set_filters: true, stack_control_input_signal: { type: "virtual", name: "signal-S" } },
      filters: [{ index: 1, name: "iron-plate", quality: "normal", comparator: "=" }],
      use_filters: true,
    };
    expect(importedEntity("fast-inserter", fields)).toEqual({
      entity: { kind: "entity", prototype: "fast-inserter", settings: { when: JSON.parse(JSON.stringify(condition)), "set-filters": true, "read-hand": "hold" }, blueprintData: '{"filters":[{"index":1,"name":"iron-plate","quality":"normal","comparator":"="}],"use_filters":true}' },
      notes: [],
    });
    expect(importedEntity("fast-inserter", { control_behavior: { circuit_read_hand_contents: true } }).entity.settings).toEqual({ "read-hand": "pulse" });
    // A mode that is kept while the checkbox is off means nothing.
    expect(importedEntity("fast-inserter", { control_behavior: { circuit_read_hand_contents: false, circuit_hand_read_mode: 1 } })).toEqual({ entity: { kind: "entity", prototype: "fast-inserter", settings: {} }, notes: [] });
    expect(importedEntity("fast-inserter", { control_behavior: { circuit_hand_read_mode: 1 } }).entity.settings).toEqual({});
  });

  it("writes an inserter as it read it", () => {
    const entity = generic("fast-inserter", { when: condition, "set-filters": true, "read-hand": "hold", networks: { red: false, green: true } }, { direction: "east", blueprintData: '{"filters":[{"index":1,"name":"iron-plate"}],"use_filters":true}' });
    expect(recordOf(entity)).toEqual({
      direction: 4,
      control_behavior: { circuit_enabled: true, circuit_condition: when, input_networks: { red: false, green: true }, circuit_set_filters: true, circuit_read_hand_contents: true, circuit_hand_read_mode: 1 },
      filters: [{ index: 1, name: "iron-plate" }],
      use_filters: true,
    });
    expect(recordOf(generic("fast-inserter", { "read-hand": "pulse" }, { direction: "north" }))).toEqual({ control_behavior: { circuit_read_hand_contents: true, circuit_hand_read_mode: 0 } });
  });

  it("reads and writes the modes whose checkbox is on by default: a mining drill that reads nothing says so", () => {
    expect(importedEntity("electric-mining-drill", { control_behavior: { circuit_read_resources: false } }).entity.settings).toEqual({ "read-resources": "none" });
    expect(importedEntity("electric-mining-drill", { control_behavior: { circuit_read_resources: true, circuit_resource_read_mode: 1 } }).entity.settings).toEqual({ "read-resources": "entire-patch" });
    expect(importedEntity("electric-mining-drill", { control_behavior: { circuit_resource_read_mode: 1 } }).entity.settings).toEqual({ "read-resources": "entire-patch" });
    expect(recordOf(generic("electric-mining-drill", { "read-resources": "none" }, { direction: "north" }))).toEqual({ control_behavior: { circuit_read_resources: false } });
    expect(recordOf(generic("electric-mining-drill", { "read-resources": "entire-patch" }, { direction: "north" }))).toEqual({ control_behavior: { circuit_read_resources: true, circuit_resource_read_mode: 1 } });
  });

  it("reads a mode without a checkbox by its number, and the roboport's also as the boolean the API reference gives it", () => {
    expect(importedEntity("storage-tank", { control_behavior: { circuit_mode_of_operation: 2 } }).entity.settings).toEqual({ "read-contents": "segment-contents" });
    expect(importedEntity("storage-tank", { control_behavior: { circuit_mode_of_operation: 1 } }).entity.settings).toEqual({});
    expect(importedEntity("radar", { control_behavior: { mode: 1, universe_channel: A } }).entity.settings).toEqual({ mode: "universe", channel: { kind: "virtual", name: "signal-A" } });
    expect(importedEntity("roboport", { control_behavior: { read_items_mode: 2 } }).entity.settings).toEqual({ "read-items": "missing-requests" });
    expect(importedEntity("roboport", { control_behavior: { read_items_mode: false } })).toEqual({ entity: { kind: "entity", prototype: "roboport", settings: { "read-items": "none" } }, notes: [] });
    expect(importedEntity("roboport", { control_behavior: { read_items_mode: true } }).entity.settings).toEqual({});
    expect(recordOf(generic("roboport", { "read-items": "none" }))).toEqual({ control_behavior: { read_items_mode: 0 } });
  });

  it("takes a signal that is the prototype's own as not said, and writes one only when it is another", () => {
    const E = { type: "virtual", name: "signal-E" };
    expect(importedEntity("steel-chest", { control_behavior: { read_empty_slots: true, empty_slots_signal: E } }).entity.settings).toEqual({ "read-empty-slots": true });
    expect(importedEntity("steel-chest", { control_behavior: { empty_slots_signal: B } }).entity.settings).toEqual({ "empty-slots-signal": { kind: "virtual", name: "signal-B" } });
    // The crash site chests have no signal of their own: there every signal is said.
    expect(importedEntity("crash-site-chest-1", { control_behavior: { empty_slots_signal: E } }).entity.settings).toEqual({ "empty-slots-signal": { kind: "virtual", name: "signal-E" } });
    expect(recordOf(generic("steel-chest", { "empty-slots-signal": signal("item", "iron-plate", "rare") }))).toEqual({ control_behavior: { empty_slots_signal: { name: "iron-plate", quality: "rare" } } });
  });

  it("has a condition exactly while its flag is on and it has a left side, and says what it did otherwise", () => {
    const blank = { comparator: "<", constant: 0 };
    expect(importedEntity("transport-belt", { control_behavior: { circuit_enabled: true, circuit_condition: when } }).entity.settings).toEqual({ when: JSON.parse(JSON.stringify(condition)) });
    expect(importedEntity("transport-belt", { control_behavior: { circuit_enabled: true, circuit_condition: blank } })).toEqual({ entity: { kind: "entity", prototype: "transport-belt", settings: {} }, notes: ["changed control_behavior.circuit_enabled"] });
    expect(importedEntity("transport-belt", { control_behavior: { circuit_enabled: true } }).notes).toEqual(["changed control_behavior.circuit_enabled"]);
    expect(importedEntity("transport-belt", { control_behavior: { circuit_enabled: false, circuit_condition: when } })).toEqual({ entity: { kind: "entity", prototype: "transport-belt", settings: {} }, notes: ["changed control_behavior.circuit_condition"] });
    // A blank condition next to a flag that is off is what an untouched entity may have: nothing to say.
    expect(importedEntity("transport-belt", { control_behavior: { circuit_enabled: false, circuit_condition: blank, connect_to_logistic_network: false, logistic_condition: blank } }).notes).toEqual([]);
    expect(importedEntity("requester-chest", { control_behavior: { circuit_condition_enabled: true, circuit_condition: when } }).entity.settings).toEqual({ when: JSON.parse(JSON.stringify(condition)) });
    expect(importedEntity("stone-wall", { control_behavior: { circuit_open_gate: true, circuit_condition: when } }).entity.settings).toEqual({ "open-gate-when": JSON.parse(JSON.stringify(condition)) });
    expect(importedEntity("rail-signal", { control_behavior: { circuit_close_signal: true, circuit_condition: when, circuit_read_signal: false } }).entity.settings).toEqual({ "close-when": JSON.parse(JSON.stringify(condition)), "read-signal": false });
  });

  it("shares the flag of a splitter side between its two conditions", () => {
    const left = { first_signal: A, constant: 1, comparator: "=" };
    const one = importedEntity("splitter", { control_behavior: { set_input_side: true, input_left_condition: left, input_right_condition: { comparator: "<" }, set_output_side: true } });
    expect(one.entity.settings).toEqual({ "input-left-when": { first: { kind: "virtual", name: "signal-A" }, comparator: "=", second: { type: "constant", value: 1 } } });
    // The input side has a condition; the output side is on with none.
    expect(one.notes).toEqual(["changed control_behavior.set_output_side"]);
    const both: EntitySettings = { "input-left-when": condition, "input-right-when": { ...condition, comparator: ">=" }, "output-right-when": condition };
    const record = recordOf(generic("splitter", both, { direction: "north" }));
    expect(record).toEqual({ control_behavior: { set_input_side: true, input_left_condition: when, input_right_condition: { ...when, comparator: "≥" }, set_output_side: true, output_right_condition: when } });
    expect(importedEntity("splitter", record)).toEqual({ entity: { kind: "entity", prototype: "splitter", settings: JSON.parse(JSON.stringify(both)), }, notes: [] });
  });

  it("keeps the wildcards a condition takes and resets an entity whose condition the language cannot say", () => {
    const anything = importedEntity("pump", { control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: { type: "virtual", name: "signal-anything" }, second_signal: B, comparator: "≠" } } });
    expect(anything).toEqual({ entity: { kind: "entity", prototype: "pump", settings: { when: { first: { kind: "virtual", name: "signal-anything" }, comparator: "!=", second: { type: "signal", signal: { kind: "virtual", name: "signal-B" } } } } }, notes: [] });
    const each = importedEntity("pump", { fluid_filter: "water", control_behavior: { set_filter: true, circuit_enabled: true, circuit_condition: { first_signal: { type: "virtual", name: "signal-each" }, constant: 1, comparator: ">" } } });
    // What it kept of the blueprint is data, not settings, and stays.
    expect(each).toEqual({ entity: { kind: "entity", prototype: "pump", settings: {}, blueprintData: '{"fluid_filter":"water"}' }, notes: ["reset control_behavior"] });
  });

  it("reports a field that holds what it cannot hold, and uses the default", () => {
    const { entity, notes } = importedEntity("fast-inserter", { control_behavior: { circuit_set_filters: "yes", circuit_read_hand_contents: true, circuit_hand_read_mode: 9, input_networks: 5, stack_control_input_signal: { type: "nonsense", name: "x" }, circuit_enabled: 1, circuit_condition: [] } });
    expect(entity).toEqual({ kind: "entity", prototype: "fast-inserter", settings: { "read-hand": "pulse" } });
    expect(notes.sort()).toEqual([
      "invalid control_behavior.circuit_condition", "invalid control_behavior.circuit_enabled", "invalid control_behavior.circuit_hand_read_mode", "invalid control_behavior.circuit_set_filters", "invalid control_behavior.input_networks",
      "invalid control_behavior.stack_control_input_signal",
    ]);
    expect(importedEntity("fast-inserter", { control_behavior: "text" })).toEqual({ entity: { kind: "entity", prototype: "fast-inserter", settings: {} }, notes: ["invalid control_behavior"] });
  });
});

describe("generic entities: what is kept for the blueprint", () => {
  const record = {
    recipe: "iron-gear-wheel",
    recipe_quality: "rare",
    quality: "legendary",
    mirror: true,
    items: [{ id: { name: "speed-module-3", quality: "epic" }, items: { in_inventory: [{ inventory: 4, stack: 0 }, { inventory: 4, stack: 1, count: 2 }] } }],
    tags: { note: 'say "hi"\n\t\\ Grüße 日本語 𝒜', list: [1, -2.5, 1e21, true, null, { deep: [] }], __proto__key: 1 },
    player_description: "not a description here",
    control_behavior: { set_recipe: true, a_field_of_a_later_version: { x: [1, 2] }, read_working: true, working_signal: A },
  };
  const keptText = JSON.stringify({ ...record, control_behavior: { a_field_of_a_later_version: { x: [1, 2] } } });

  it("keeps every field the editor does not model as it stands, in its order, as the JSON text of an object like the entity", () => {
    const { entity, notes } = importedEntity("assembling-machine-2", record);
    expect(entity).toEqual({ kind: "entity", prototype: "assembling-machine-2", settings: { "set-recipe": true, "read-working": true, "working-signal": { kind: "virtual", name: "signal-A" } }, blueprintData: keptText });
    // Kept is not lost: nothing is reported.
    expect(notes).toEqual([]);
  });

  it("writes it back with the settings over it, and the blueprint is the one that came in", () => {
    const { circuit } = imported(blueprintOf([{ entity_number: 7, name: "assembling-machine-2", position: { x: 1.5, y: 1.5 }, ...record }]));
    const [out] = exported(circuit).blueprint.entities;
    expect(out).toEqual({ entity_number: 1, name: "assembling-machine-2", position: { x: 1.5, y: 1.5 }, ...record });
    // In the order it came: the kept fields keep their places, the control behaviour among them.
    expect(Object.keys(out!)).toEqual(["entity_number", "name", "position", "recipe", "recipe_quality", "quality", "mirror", "items", "tags", "player_description", "control_behavior"]);
    expect(Object.keys(out!.control_behavior!)).toEqual(["a_field_of_a_later_version", "set_recipe", "read_working", "working_signal"]);
    // And once more: the same entity, the same text, the same blueprint.
    const again = imported({ blueprint: { ...blueprintOf([]).blueprint, entities: [out] } }).circuit;
    expect(again.entities[0]).toMatchObject({ blueprintData: keptText });
    expect(JSON.stringify(exported(again).blueprint.entities)).toBe(JSON.stringify([out]));
  });

  it("goes through the source of the editor byte for byte", () => {
    const { circuit } = imported(blueprintOf([{ entity_number: 1, name: "assembling-machine-2", position: { x: 1.5, y: 1.5 }, ...record }]));
    const read = analyze(printCircuit(circuit));
    expect(read.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const [entity] = read.circuit!.entities;
    expect(entity?.kind === "entity" && entity.blueprintData).toBe(keptText);
    expect(JSON.stringify(exported(read.circuit!).blueprint)).toBe(JSON.stringify(exported(circuit).blueprint));
  });

  it("keeps a key like __proto__ as a key, leaves out what says nothing, and keeps no wiring of an older format", () => {
    const odd = JSON.parse('{"__proto__": {"x": 1}, "constructor": 2, "quality": "normal", "bar": null, "wires": [[1, 1, 2, 1]], "connections": {}, "neighbours": [2], "control_behavior": {"read_contents": true, "more": null}}') as Record<string, unknown>;
    const { entity, notes } = importedEntity("steel-chest", odd);
    expect(entity.blueprintData).toBe('{"__proto__":{"x":1},"constructor":2}');
    expect(entity.settings).toEqual({});
    expect(notes.sort()).toEqual(["ignored connections", "ignored neighbours", "ignored wires"]);
    const out = recordOf(generic("steel-chest", {}, { blueprintData: entity.blueprintData as string }));
    expect(JSON.stringify(out)).toBe('{"__proto__":{"x":1},"constructor":2}');
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("keeps what it does not model of a control behaviour: the messages of a display panel, the research conditions of a lab", () => {
    const parameters = [{ condition: { first_signal: A, constant: 1, comparator: "=" }, icon: IRON, text: "low" }];
    const panel = importedEntity("display-panel", { text: "hello", always_show: true, control_behavior: { parameters } });
    expect(panel).toEqual({ entity: { kind: "entity", prototype: "display-panel", settings: {}, blueprintData: JSON.stringify({ text: "hello", always_show: true, control_behavior: { parameters } }) }, notes: [] });
    const conditions = [{ name: "automation-2", count: 3, condition: { first_signal: A, constant: 0, comparator: ">" } }];
    const lab = importedEntity("lab", { control_behavior: { set_research: true, conditions } });
    expect(lab.entity).toEqual({ kind: "entity", prototype: "lab", settings: { "set-research": true }, blueprintData: JSON.stringify({ control_behavior: { conditions } }) });
    expect(recordOf(generic("lab", { "set-research": true, "read-fuel": true }, { blueprintData: lab.entity.blueprintData as string }))).toEqual({ control_behavior: { conditions, set_research: true, read_fuel: true } });
    // A rail signal has no blue signal; the field of the control behaviour it shares with the chain signal is kept.
    expect(importedEntity("rail-signal", { control_behavior: { blue_output_signal: B } }).entity.blueprintData).toBe('{"control_behavior":{"blue_output_signal":{"type":"virtual","name":"signal-B"}}}');
    expect(importedEntity("rail-chain-signal", { control_behavior: { blue_output_signal: B } }).entity).toEqual({ kind: "entity", prototype: "rail-chain-signal", settings: { "blue-signal": { kind: "virtual", name: "signal-B" } } });
  });

  it("lets the settings win over kept data that names a field of theirs, and never keeps number, name or position", () => {
    const blueprintData = JSON.stringify({ entity_number: 99, name: "wooden-chest", position: { x: 9, y: 9 }, wires: [], control_behavior: { read_contents: true, read_empty_slots: true, kept: 1 }, bar: 4 });
    expect(recordOf(generic("steel-chest", { "read-contents": false }, { blueprintData }))).toEqual({ control_behavior: { kept: 1, read_contents: false }, bar: 4 });
  });

  it("refuses to export kept data that is not the JSON text of an object, with a problem instead of an exception", () => {
    for (const blueprintData of ["", "{", "[]", "null", "7", '"text"', '{"a":1} x']) {
      const result = exportBlueprint(circuitOf(generic("steel-chest", {}, { blueprintData })));
      expect(result, blueprintData).toEqual({ ok: false, problems: [{ code: "invalid-blueprint-data", entities: ["n1"], message: "'n1' cannot be exported: its blueprint data ('blueprint-data') is not the JSON text of an object" }] });
    }
    expect(recordOf(generic("steel-chest", {}, { blueprintData: "{}" }))).toEqual({});
  });
});

describe("generic entities: directions", () => {
  const facing = (prototype: string, direction?: unknown) => {
    const { circuit, report } = imported(blueprintOf([{ entity_number: 1, name: prototype, position: { x: 0.5, y: 0.5 }, ...(direction !== undefined && { direction }) }]));
    const [entity] = circuit.entities;
    // On tiles that fit it as it faces now, for the export.
    const onGrid = { ...entity!, placement: { ...entity!.placement, tile: tileCenter(entity!, facingOf(entity!), { x: 0, y: 0 }) } };
    return { facing: entity!.placement?.direction ?? "(east)", kept: entity?.kind === "entity" ? entity.blueprintData : undefined, notes: report.settings.map((note) => `${note.kind} ${note.field}`), out: exported({ ...circuit, entities: [onGrid] }).blueprint.entities[0]!.direction };
  };
  const plain = (name: Direction | "(east)", out: number | undefined) => ({ facing: name, kept: undefined, notes: [], out });

  it("reads and writes the four quarter turns of an entity that turns in four directions; north is not written, east is not said", () => {
    expect([undefined, 0, 4, 8, 12].map((direction) => facing("fast-inserter", direction))).toEqual([plain("north", undefined), plain("north", undefined), plain("(east)", 4), plain("south", 8), plain("west", 12)]);
    expect(facing("boiler", 12)).toEqual(plain("west", 12));
  });

  it("gives an entity of two directions north or east: south is north and west is east (the storage tank)", () => {
    expect(PROTOTYPES["storage-tank"]).toMatchObject({ rotatable: true, twoWay: true });
    expect([undefined, 0, 4, 8, 12].map((direction) => facing("storage-tank", direction))).toEqual([plain("north", undefined), plain("north", undefined), plain("(east)", 4), plain("north", undefined), plain("(east)", 4)]);
    expect(recordOf(generic("storage-tank", {}, { direction: "south" }))).toEqual({});
    expect(recordOf(generic("storage-tank", {}, { direction: "west" }))).toEqual({ direction: 4 });
  });

  it("keeps a direction of eight or sixteen that is no quarter turn, faces the nearest one in the editor, and says so", () => {
    const kept = (direction: number, name: Direction | "(east)") => ({ facing: name, kept: `{"direction":${direction}}`, notes: ["changed direction"], out: direction });
    expect(PROTOTYPES["flamethrower-turret"]!.rotatable && PROTOTYPES["rail-signal"]!.rotatable).toBe(true);
    expect([4, 8].map((direction) => facing("flamethrower-turret", direction))).toEqual([plain("(east)", 4), plain("south", 8)]);
    expect([2, 6, 10, 14].map((direction) => facing("flamethrower-turret", direction))).toEqual([kept(2, "(east)"), kept(6, "south"), kept(10, "west"), kept(14, "north")]);
    expect([1, 3, 5, 7, 9, 13, 15].map((direction) => facing("rail-signal", direction))).toEqual([kept(1, "north"), kept(3, "(east)"), kept(5, "(east)"), kept(7, "south"), kept(9, "south"), kept(13, "west"), kept(15, "north")]);
    expect(facing("rail-chain-signal", 12)).toEqual(plain("west", 12));
  });

  it("writes the kept direction while the entity faces as it came, and the editor's once it was turned", () => {
    const blueprintData = '{"direction":5,"rail_layer":"elevated"}';
    expect(recordOf(generic("rail-signal", {}, { blueprintData, direction: "east" }))).toEqual({ direction: 5, rail_layer: "elevated" });
    expect(recordOf(generic("rail-signal", {}, { blueprintData, direction: "south" }))).toEqual({ direction: 8, rail_layer: "elevated" });
    expect(recordOf(generic("rail-signal", {}, { blueprintData, direction: "north" }))).toEqual({ rail_layer: "elevated" });
    // A kept direction that is none counts for nothing.
    expect(recordOf(generic("rail-signal", {}, { blueprintData: '{"direction":"up"}', direction: "south" }))).toEqual({ direction: 8 });
    expect(recordOf(generic("rail-signal", {}, { blueprintData: '{"direction":16}', direction: "east" }))).toEqual({ direction: 4 });
  });

  it("keeps the direction of an entity the entity table says cannot turn, without a word, and writes it back", () => {
    expect(PROTOTYPES["steel-chest"]!.rotatable).toBe(false);
    expect(facing("steel-chest", 4)).toEqual({ facing: "(east)", kept: '{"direction":4}', notes: [], out: 4 });
    expect(facing("steel-chest", 0)).toEqual(plain("(east)", undefined));
    expect(facing("radar", 6)).toEqual({ facing: "(east)", kept: '{"direction":6}', notes: [], out: 6 });
  });

  it("reports a direction that is none and faces north", () => {
    for (const direction of [-1, 16, 2.5, "east", true, [], {}]) expect(facing("fast-inserter", direction), String(direction)).toEqual({ facing: "north", kept: undefined, notes: ["invalid direction"], out: undefined });
  });
});

describe("generic entities: wires, places and the rest of a blueprint", () => {
  it("wires a generic entity at its one connector: 1 red, 2 green, in a blueprint and back", () => {
    const circuit = parse(`
      constant c tile (0.5, 0.5) { virtual:signal-A = 1 }
      entity chest tile (1.5, 0.5) { prototype = steel-chest }
      entity arm tile (2.5, 0.5) { prototype = fast-inserter }
      decider d tile (4, 1.5) { }
      wire red c.out <-> chest
      wire green chest <-> arm
      wire red arm <-> d.in
      wire green d.out <-> chest
      wire red chest <-> arm
    `);
    const { blueprint } = exported(circuit);
    expect(blueprint.wires).toEqual([[1, 1, 2, 1], [2, 1, 3, 1], [2, 2, 3, 2], [2, 2, 4, 4], [3, 1, 4, 1]]);
    const back = imported({ blueprint });
    expect(back.report.wires).toEqual({ imported: 5, copper: 0, toDropped: 0, invalid: 0 });
    expect(printCircuit(back.circuit).split("\n").filter((line) => line.includes("wire ")).map((line) => line.trim())).toEqual([
      "wire red constant1.out <-> steel_chest1", "wire red steel_chest1 <-> fast_inserter1", "wire green steel_chest1 <-> fast_inserter1", "wire green decider1.out <-> steel_chest1", "wire red fast_inserter1 <-> decider1.in",
    ]);
    // A generic entity has no output connector.
    const bad = imported(blueprintOf([{ entity_number: 1, name: "steel-chest", position: { x: 0.5, y: 0.5 } }, { entity_number: 2, name: "fast-inserter", position: { x: 1.5, y: 0.5 } }], [[1, 3, 2, 1], [1, 1, 2, 4], [1, 1, 2, 2]]));
    expect(bad.report.wires).toEqual({ imported: 0, copper: 0, toDropped: 0, invalid: 3 });
  });

  it("names the entities by what they are, each kind of thing counted for itself", () => {
    const names = ["fast-inserter", "assembling-machine-1", "fast-inserter", "assembling-machine-3", "stone-wall", "small-lamp", "crash-site-chest-2", "big-electric-pole"];
    const { circuit } = imported(blueprintOf(names.map((name, index) => ({ entity_number: index + 1, name, position: { x: index * 10 + 0.5, y: 0.5 } }))));
    expect(circuit.entities.map((entity) => entity.name)).toEqual(["fast_inserter1", "assembling_machine1", "fast_inserter2", "assembling_machine2", "stone_wall1", "lamp1", "crash_site_chest1", "pole1"]);
  });

  it("exports a land mine wherever it stands and an entity of every footprint on its tiles, and refuses two on one tile", () => {
    const mine = { ...generic("land-mine"), placement: { tile: { x: 0.3, y: -1.25 } } };
    expect(exported(circuitOf(mine)).blueprint.entities[0]).toEqual({ entity_number: 1, name: "land-mine", position: { x: 0.3, y: -1.25 } });
    expect(imported(exported(circuitOf(mine))).circuit.entities[0]!.placement).toEqual({ tile: { x: 0.3, y: -1.25 } });
    const silo = generic("rocket-silo");
    expect(silo.placement!.tile).toEqual({ x: 4.5, y: 4.5 });
    const chest = { ...generic("steel-chest"), placement: { tile: { x: 8.5, y: 8.5 } } };
    const result = exportBlueprint(circuitOf(silo, chest));
    expect(result.ok ? [] : result.problems.map((problem) => problem.code)).toEqual(["overlap"]);
    const offGrid = exportBlueprint(circuitOf({ ...silo, placement: { tile: { x: 4, y: 4.5 } } }));
    expect(offGrid.ok ? [] : offGrid.problems.map((problem) => problem.code)).toEqual(["off-grid"]);
  });

  it("refuses a custom signal in a setting, and warns that the game has no description there", () => {
    const custom = exportBlueprint(circuitOf(generic("steel-chest", { "empty-slots-signal": signal("custom", "mine") })));
    expect(custom.ok ? [] : custom.problems).toEqual([{ code: "custom-signal", entities: ["n1"], message: "'n1' uses the custom signal custom:mine, which the game does not have" }]);
    const described = exportBlueprint(circuitOf(generic("steel-chest", {}, { description: "the buffer" })));
    expect(described.ok && described.warnings.map((warning) => warning.code)).toEqual(["description-lost"]);
    expect(described.ok && described.data.blueprint.entities[0]).toEqual({ entity_number: 1, name: "steel-chest", position: { x: 0.5, y: 0.5 } });
  });

  it("gives the blueprint the item that builds an entity as its icon, and the entity where no item does", () => {
    const icons = (...prototypes: string[]) => exported(circuitOf(...prototypes.map((prototype, index) => ({ ...generic(prototype), placement: { tile: tileCenter({ kind: "entity", prototype }, "east", { x: index * 10, y: 0 }) } })))).blueprint.icons;
    expect(icons("stone-wall", "fast-inserter", "fast-inserter")).toEqual([{ signal: { name: "fast-inserter" }, index: 1 }, { signal: { name: "stone-wall" }, index: 2 }]);
    expect(entityTable().byName.get("red-chest")!.placedBy).toEqual([]);
    expect(icons("red-chest")).toEqual([{ signal: { type: "entity", name: "red-chest" }, index: 1 }]);
  });

  it("drops nothing among the entities a circuit wire connects to, and names what is outside of them", () => {
    const names = [...prototypesOf("entity"), "gate", "straight-rail", "curved-rail-a", "modded-inserter"];
    const { circuit, report } = imported(blueprintOf(names.map((name, index) => ({ entity_number: index + 1, name, position: { x: index * 10, y: 0 } }))));
    expect(circuit.entities.map((entity) => entity.kind === "entity" && entity.prototype)).toEqual(prototypesOf("entity"));
    expect(report.dropped.map((entry) => entry.name)).toEqual(["curved-rail-a", "gate", "modded-inserter", "straight-rail"]);
    expect(report.settings).toEqual([]);
  });
});

describe("generic entities: blueprint to editor to blueprint", () => {
  // As another tool or the game may write it: defaults spelled out, dormant conditions and modes, both spellings of a comparator.
  const foreign = blueprintOf(
    [
      { entity_number: 3, name: "constant-combinator", position: { x: 0.5, y: 0.5 }, control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, name: "iron-plate", quality: "normal", comparator: "=", count: 50 }] }] } } },
      { entity_number: 5, name: "steel-chest", position: { x: 2.5, y: 0.5 }, bar: 8, quality: "normal", control_behavior: { read_contents: true, read_empty_slots: false, empty_slots_signal: { type: "virtual", name: "signal-E" } } },
      {
        entity_number: 8, name: "fast-inserter", position: { x: 3.5, y: 0.5 }, direction: 12, use_filters: true, filters: [{ index: 1, name: "iron-plate" }],
        control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: { type: "item", name: "iron-plate" }, constant: 100, comparator: "<=" }, connect_to_logistic_network: false, logistic_condition: { comparator: "<", constant: 0 }, circuit_read_hand_contents: false, circuit_hand_read_mode: 1, circuit_set_filters: false },
      },
      { entity_number: 9, name: "transport-belt", position: { x: 4.5, y: 0.5 }, direction: 4, control_behavior: { circuit_enabled: false, circuit_read_hand_contents: true, circuit_contents_read_mode: 2 } },
      { entity_number: 12, name: "assembling-machine-2", position: { x: 6.5, y: 1.5 }, recipe: "iron-gear-wheel", recipe_quality: "normal", control_behavior: { read_working: true, input_networks: { red: true, green: true }, output_networks: { green: false } } },
      { entity_number: 13, name: "train-stop", position: { x: 9, y: 1 }, direction: 8, station: "Iron", manual_trains_limit: 2, control_behavior: { send_to_train: false, set_trains_limit: true, trains_limit_signal: { type: "virtual", name: "signal-L" }, train_stopped_signal: { type: "virtual", name: "signal-T" } } },
      { entity_number: 14, name: "gate", position: { x: 12.5, y: 0.5 } },
    ],
    [[5, 1, 3, 1], [8, 2, 5, 2], [9, 1, 8, 1], [12, 1, 9, 1], [13, 2, 12, 2], [14, 1, 13, 1]],
  );
  const canonical = [
    { entity_number: 1, name: "constant-combinator", position: { x: 0.5, y: 0.5 }, control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, name: "iron-plate", quality: "normal", comparator: "=", count: 50 }] }] } } },
    { entity_number: 2, name: "steel-chest", position: { x: 2.5, y: 0.5 }, bar: 8 },
    { entity_number: 3, name: "fast-inserter", position: { x: 3.5, y: 0.5 }, direction: 12, control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: { name: "iron-plate" }, constant: 100, comparator: "≤" } }, use_filters: true, filters: [{ index: 1, name: "iron-plate" }] },
    { entity_number: 4, name: "transport-belt", position: { x: 4.5, y: 0.5 }, direction: 4, control_behavior: { circuit_read_hand_contents: true, circuit_contents_read_mode: 2 } },
    { entity_number: 5, name: "assembling-machine-2", position: { x: 6.5, y: 1.5 }, control_behavior: { output_networks: { red: true, green: false }, read_working: true }, recipe: "iron-gear-wheel", recipe_quality: "normal" },
    { entity_number: 6, name: "train-stop", position: { x: 9, y: 1 }, direction: 8, control_behavior: { send_to_train: false, set_trains_limit: true }, station: "Iron", manual_trains_limit: 2 },
  ];

  it("keeps the entities, their settings, their kept fields and their wires; what differs is how a default is written", () => {
    const { circuit, report } = imported(foreign);
    expect(report).toMatchObject({ entities: 6, dropped: [{ name: "gate", count: 1, reason: "unknown" }], wires: { imported: 5, copper: 0, toDropped: 1, invalid: 0 }, settings: [] });
    expect(circuit.entities.map((entity) => entity.name)).toEqual(["constant1", "steel_chest1", "fast_inserter1", "transport_belt1", "assembling_machine1", "train_stop1"]);
    const result = exportBlueprint(circuit);
    expect(result.ok && result.data.blueprint.entities).toEqual(canonical);
    expect(result.ok && JSON.stringify(result.data.blueprint.entities)).toBe(JSON.stringify(canonical));
    expect(result.ok && result.data.blueprint.wires).toEqual([[1, 1, 2, 1], [2, 2, 3, 2], [3, 1, 4, 1], [4, 1, 5, 1], [5, 2, 6, 2]]);
  });

  it("is the same blueprint after every further trip, also through the source of the editor", () => {
    let data: unknown = foreign;
    for (let trip = 0; trip < 3; trip++) {
      const { circuit } = imported(data);
      const read = analyze(printCircuit(circuit));
      expect(read.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      const result = exportBlueprint(read.circuit!);
      expect(result.ok && JSON.stringify(result.data.blueprint.entities)).toBe(JSON.stringify(canonical));
      data = result.ok ? result.data : undefined;
    }
  });
});

describe("generic entities: the samples for the game probe", () => {
  it("have a prototype of every control behaviour of the settings table, and of every type whose behaviour is assumed", () => {
    expect(unsampledBehaviors()).toEqual([]);
    const sampled = GENERIC_SAMPLES.flatMap(([, prototypes]) => prototypes);
    expect(new Set(sampled).size).toBe(sampled.length);
    for (const prototype of sampled) expect(PROTOTYPES[prototype]?.kind, prototype).toBe("entity");
  });

  it("set every setting key and every field of the table at least once", () => {
    const sampled = GENERIC_SAMPLES.flatMap(([, prototypes]) => prototypes);
    const written = new Set(sampled.flatMap((prototype) => Object.keys((recordOf(generic(prototype, configuredSettings(prototype))).control_behavior ?? {}) as object).map((field) => `${ENTITY_SETTINGS[game(prototype).type]!.behavior}.${field}`)));
    const all = new Set(Object.values(ENTITY_SETTINGS).flatMap((row) => row.settings.flatMap(settingFields).map((field) => `${row.behavior}.${field}`)));
    expect([...all].filter((field) => !written.has(field))).toEqual([]);
  });
});

/** The type of a blueprint entity allows the fields a generic entity keeps. */
const _typed: BlueprintEntity = { entity_number: 1, name: "steel-chest", position: { x: 0.5, y: 0.5 }, bar: 3 };
void _typed;
