// The parts of the blueprint probe that run without the game: what it sends, the scenario it composes and the fixture it
// builds from a recording. The libraries are plain .mjs, loaded as in tools/catalog.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENTITY_SETTINGS, PROTOTYPE_NAMES, PROTOTYPES, settingFields, STANDARD_ENTITY_TABLE } from "@face/model";
import { describe, expect, it } from "vitest";
import { encodeBlueprintString } from "../../../packages/blueprints/src/index.ts";
import { defineGroup, enumSettings } from "../../../packages/blueprints/test/gameNames.ts";
import { GENERIC_SAMPLES, NOT_HELD, SAMPLES } from "../../../packages/blueprints/test/samples.ts";
import { probeCases, probePrototypes, probeRequest, type ProbeRequest } from "./blueprintCases.ts";

interface Exported { string: string; blueprint: unknown }
interface FixtureCase { label: string; importResult?: number; ghosts?: number; revived?: number; standing?: number; unbuilt?: string[]; helpers?: string[]; errors: string[]; sent: Exported; reexported?: Exported; rebuilt?: Exported; native?: Exported }
interface Fixture {
  id: string; covers: string[]; gameVersion: string; activeMods: string[]; errors: string[]; defines: Record<string, Record<string, number>>; fresh: Record<string, Exported | { error: string }>;
  states: Record<string, Exported | { error: string }>; defaults: Record<string, Record<string, unknown>>; directions: Record<string, Record<string, unknown>>; cases: FixtureCase[];
}

const { buildFixture, decodeString, fixtureErrors, serialiseFixture } = (await import(/* @vite-ignore */ new URL("./blueprintFixture.mjs", import.meta.url).href)) as {
  buildFixture(recording: unknown, source: string): Fixture;
  decodeString(text: string): unknown;
  fixtureErrors(fixture: Fixture): string[];
  serialiseFixture(fixture: Fixture): string;
};
const { composeScenario, loadRequest } = (await import(/* @vite-ignore */ new URL("./blueprintScenario.mjs", import.meta.url).href)) as {
  composeScenario(request: unknown): string;
  loadRequest(workDir: string): Promise<ProbeRequest>;
};

const lamp = { blueprint: { entities: [{ entity_number: 1, name: "small-lamp", position: { x: 0.5, y: 0.5 } }], item: "blueprint", version: 562954250027008 } };
const pole = { blueprint: { entities: [{ entity_number: 1, name: "substation", position: { x: 1, y: 1 } }], item: "blueprint", version: 562954250027008 } };
const [lampString, poleString] = [encodeBlueprintString(lamp), encodeBlueprintString(pole)];

/** What blueprints.lua writes, as the game's JSON has it: an empty list is an object. */
const recording = {
  game_version: "2.1.25",
  active_mods: { "space-age": "2.1.25", base: "2.1.25" },
  defines: { wire_connector_id: { circuit_green: 2, pole_copper: 5, circuit_red: 1, combinator_input_red: 1 }, direction: { south: 8, north: 0 } },
  fresh: { placed: { string: lampString }, with_control_behavior: { error: "cannot place small-lamp" }, placed_on_platform: { string: poleString } },
  states: { constant_without_sections: { string: lampString } },
  defaults: { pump: { values: { set_filter: false, circuit_enable_disable: false }, errors: {} }, accumulator: { values: {}, errors: { read_charge: "no such attribute" } } },
  directions: { "small-lamp": { supports_direction: false, blueprint: [0, 0], built: [0, 0], exported: [0, 0], created: [0, -1] } },
  errors: {},
  cases: [
    { label: "lamps", sent: lampString, import_result: 0, reexported: lampString, ghosts: 1, revived: 1, standing: 0, unbuilt: {}, rebuilt: lampString, helpers: ["gate"], native: poleString, errors: {} },
    { label: "poles", sent: poleString, import_result: 0, reexported: poleString, errors: ["build: boom", "native: entity 1 (substation): bang"] },
  ],
};

describe("blueprint probe: the fixture", () => {
  it("decodes a blueprint string without the package it is meant to test", () => {
    expect(decodeString(lampString)).toEqual(lamp);
    expect(() => decodeString("1abc")).toThrow("not a blueprint string");
  });

  it("holds every blueprint as its string and its JSON, and keeps what the game could not do", () => {
    const fixture = buildFixture(recording, "test");
    expect(fixture).toMatchObject({ id: "F-01-blueprints", covers: ["F-01", "F-02", "F-23"], gameVersion: "2.1.25", activeMods: ["base", "space-age"], source: "test" });
    expect(fixture.fresh).toEqual({
      placed: { string: lampString, blueprint: lamp }, withControlBehavior: { error: "cannot place small-lamp" }, placedOnPlatform: { string: poleString, blueprint: pole }, withControlBehaviorOnPlatform: { error: "not recorded" },
    });
    expect(fixture.states).toEqual({ constantWithoutSections: { string: lampString, blueprint: lamp } });
    expect(fixture.cases[0]).toEqual({
      label: "lamps", importResult: 0, ghosts: 1, revived: 1, standing: 0, unbuilt: [], helpers: ["gate"], errors: [], sent: { string: lampString, blueprint: lamp }, reexported: { string: lampString, blueprint: lamp }, rebuilt: { string: lampString, blueprint: lamp }, native: { string: poleString, blueprint: pole },
    });
    expect(fixture.cases[1]).toEqual({ label: "poles", importResult: 0, errors: ["build: boom", "native: entity 1 (substation): bang"], sent: { string: poleString, blueprint: pole }, reexported: { string: poleString, blueprint: pole } });
    expect(fixtureErrors(fixture)).toEqual([
      "defaults of accumulator: read_charge: no such attribute", "fresh withControlBehavior: cannot place small-lamp", "fresh withControlBehaviorOnPlatform: not recorded", "poles: build: boom", "poles: native: entity 1 (substation): bang",
    ]);
  });

  it("holds the defaults and the directions per prototype, in the order of the names", () => {
    const fixture = buildFixture(recording, "test");
    expect(Object.entries(fixture.defaults)).toEqual([["accumulator", {}], ["pump", { circuit_enable_disable: false, set_filter: false }]]);
    expect(Object.keys(fixture.defaults.pump!)).toEqual(["circuit_enable_disable", "set_filter"]);
    expect(fixture.directions).toEqual({ "small-lamp": { supportsDirection: false, blueprint: [0, 0], built: [0, 0], exported: [0, 0], created: [0, -1] } });
    expect(buildFixture({ ...recording, errors: ["space platform (build): no"] }, "test").errors).toEqual(["space platform (build): no", "defaults of accumulator: read_charge: no such attribute"]);
  });

  it("puts the defines in the order of their numbers", () => {
    const { defines } = buildFixture(recording, "test");
    expect(Object.keys(defines)).toEqual(["direction", "wire_connector_id"]);
    expect(Object.entries(defines.wire_connector_id!)).toEqual([["circuit_red", 1], ["combinator_input_red", 1], ["circuit_green", 2], ["pole_copper", 5]]);
  });

  it("refuses a recording without cases or with a string that is none", () => {
    expect(() => buildFixture({ ...recording, cases: [] }, "test")).toThrow("no cases");
    expect(() => buildFixture({ ...recording, cases: {} }, "test")).toThrow("no cases");
    expect(() => buildFixture({ ...recording, cases: [{ label: "x", sent: "nonsense" }] }, "test")).toThrow("not a blueprint string");
    expect(() => buildFixture({ ...recording, cases: [{ label: "x" }] }, "test")).toThrow("without label or string");
  });

  it("writes one blueprint per line, as valid JSON, the same for the same recording", () => {
    const fixture = buildFixture(recording, "test");
    const text = serialiseFixture(fixture);
    expect(JSON.parse(text)).toEqual(fixture);
    expect(serialiseFixture(buildFixture(JSON.parse(JSON.stringify(recording)), "test"))).toBe(text);
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.split("\n");
    expect(lines.filter((line) => line.startsWith('      "sent": '))).toHaveLength(2);
    expect(lines.find((line) => line.startsWith('      "native": '))).toBe(`      "native": ${JSON.stringify({ string: poleString, blueprint: pole })}`);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThan(2000);
  });
});

describe("blueprint probe: what the game is sent", () => {
  const cases = probeCases();

  it("has one case per sample: the string this project exports and the same circuit for the runtime API", () => {
    expect(cases.map((entry) => entry.label)).toEqual(SAMPLES.map((sample) => sample.label));
    for (const entry of cases) {
      const sent = decodeString(entry.string) as { blueprint: { entities: { name: string; position: object }[]; wires?: number[][] } };
      expect(entry.entities.map((entity) => [entity.name, entity.position])).toEqual(sent.blueprint.entities.map((entity) => [entity.name, entity.position]));
      expect(entry.wires.map(([from, , to]) => [from, to])).toEqual((sent.blueprint.wires ?? []).map(([from, , to]) => [from, to]));
    }
  });

  it("names directions and connectors by the game's defines, not by number", () => {
    const wires = cases.find((entry) => entry.label.startsWith("wires"))!;
    expect(wires.entities.map((entity) => entity.direction)).toEqual(["east", "south", "east", "north", undefined, undefined, undefined, undefined]);
    expect(new Set(wires.wires.flatMap(([, from, , to]) => [from, to]))).toEqual(new Set(["circuit_red", "circuit_green", "combinator_input_red", "combinator_input_green", "combinator_output_red", "combinator_output_green"]));
    // A constant combinator has one connection point although it is an output.
    expect(wires.wires[0]).toEqual([1, "circuit_red", 2, "circuit_red"]);
    expect(wires.wires).toContainEqual([3, "combinator_input_red", 3, "combinator_output_red"]);
  });

  it("gives every kind of entity its settings in the form the runtime API takes", () => {
    const entity = (label: string, index: number) => cases.find((entry) => entry.label === label)!.entities[index]!;
    expect(entity("constant combinators", 1)).toEqual({
      name: "constant-combinator", position: { x: 2.5, y: 0.5 }, direction: "north", description: "line one\nline two",
      constant: { enabled: false, sections: [{ active: true, multiplier: 1, filters: [{ value: { type: "virtual", name: "signal-B", quality: "normal", comparator: "=" }, min: 1 }] }] },
    });
    expect(entity("constant combinators", 0).constant!.sections[0]!.filters[0]).toEqual({ value: { type: "item", name: "iron-plate", quality: "normal", comparator: "=" }, min: 5 });
    // One without sections in the editor is the combinator the game places, with its one empty section.
    expect(entity("constant combinators", 4).constant).toEqual({ enabled: true, sections: [{ active: true, multiplier: 1, filters: [] }] });
    expect(entity("arithmetic combinators, first half of the operations", 0).parameters).toEqual({ first_signal: { type: "virtual", name: "signal-B" }, second_constant: 2, operation: "*", output_signal: { type: "virtual", name: "signal-A" } });
    expect(entity("arithmetic combinators, first half of the operations", 8)).toEqual({ name: "arithmetic-combinator", position: { x: 1, y: 4.5 }, direction: "east", parameters: { first_constant: 0, second_constant: 0, operation: "*" } });
    expect(entity("decider combinators", 9).parameters).toEqual({ conditions: [{}], outputs: [{}], else_outputs: [] });
    expect(entity("decider combinators", 4).parameters).toEqual({
      conditions: [{ first_signal: { type: "virtual", name: "signal-A" }, constant: 1, comparator: "=" }], outputs: [{ signal: { type: "virtual", name: "signal-A" }, copy_count_from_input: false }], else_outputs: [],
    });
    expect(entity("selector combinators, select count random", 6).parameters).toEqual({ operation: "random", random_update_interval: 60 });
    expect(entity("lamps", 0)).toEqual({ name: "small-lamp", position: { x: 0.5, y: 0.5 }, lamp: { always_on: false } });
    expect(entity("lamps", 5).lamp!.behavior).toMatchObject({ use_colors: true, color_mode: "components" });
    expect(entity("electric poles", 2)).toEqual({ name: "big-electric-pole", position: { x: 5, y: 1 } });
    expect(entity("programmable speakers", 1).speaker).toMatchObject({ parameters: { playback_volume: 0.625, playback_mode: "global" }, alert_parameters: { show_alert: true }, behavior: { circuit_parameters: { instrument_id: 0, note_id: 6 } } });
  });

  it("gives a generic entity its settings as assignments to the control behaviour of the runtime API, a flag before what it switches on", () => {
    const belts = cases.find((entry) => entry.label === "generic entities: belts and inserters")!;
    expect(belts.entities.map((entity) => entity.name)).toEqual(["constant-combinator", "fast-inserter", "transport-belt", "splitter", "loader"]);
    expect(belts.wires).toEqual([[1, "circuit_red", 2, "circuit_red"], [1, "circuit_red", 5, "circuit_red"], [2, "circuit_green", 3, "circuit_green"], [3, "circuit_red", 4, "circuit_red"]]);
    const [, inserter, belt, splitter] = belts.entities;
    expect(inserter).toMatchObject({ name: "fast-inserter", position: { x: 2.5, y: 0.5 }, direction: "east" });
    expect(inserter!.behavior!.map((assignment) => assignment.attribute)).toEqual([
      "circuit_enable_disable", "circuit_condition", "connect_to_logistic_network", "logistic_condition", "input_networks", "output_networks", "circuit_set_filters", "circuit_read_hand_contents", "circuit_hand_read_mode",
      "circuit_set_stack_size", "circuit_stack_control_signal",
    ]);
    expect(inserter!.behavior).toContainEqual({ attribute: "circuit_condition", value: { first_signal: { type: "virtual", name: "signal-A" }, constant: 5, comparator: ">" } });
    // A mode goes by the name of its define: its number is what the game is asked for.
    expect(inserter!.behavior).toContainEqual({ attribute: "circuit_hand_read_mode", define: ["inserter", "hand_read_mode", "hold"] });
    expect(belt!.behavior!.slice(-2)).toEqual([{ attribute: "read_contents", value: true }, { attribute: "read_contents_mode", define: ["transport_belt", "content_read_mode", "entire_belt_hold"] }]);
    // The two conditions of a side share their flag, which is set once.
    expect(splitter!.behavior!.map((assignment) => assignment.attribute)).toEqual(["set_input_side", "input_left_condition", "input_right_condition", "set_output_side", "output_left_condition", "output_right_condition", "input_networks", "set_filter"]);
    // An entity without settings has nothing to assign.
    const panel = cases.flatMap((entry) => entry.entities).find((entity) => entity.name === "display-panel")!;
    expect(panel).toEqual({ name: "display-panel", position: panel.position, direction: "east" });
  });

  it("sends every generic sample with every setting of its prototype, every mode by its define", () => {
    const labels = GENERIC_SAMPLES.map(([label]) => label);
    const generic = cases.filter((entry) => labels.includes(entry.label));
    expect(generic.map((entry) => entry.label)).toEqual(labels);
    const modes = new Set(enumSettings().map(({ spec }) => spec.field));
    for (const entity of generic.flatMap((entry) => entry.entities)) {
      if (PROTOTYPES[entity.name]?.kind !== "entity") continue;
      const { settings } = ENTITY_SETTINGS[STANDARD_ENTITY_TABLE.byName.get(entity.name)!.type]!;
      expect((entity.behavior ?? []).length, entity.name).toBeGreaterThanOrEqual(settings.length - (NOT_HELD[entity.name]?.length ?? 0));
      for (const assignment of entity.behavior ?? []) {
        expect(assignment.attribute, entity.name).toMatch(/^[a-z_]+$/);
        expect(assignment.define === undefined ? assignment.value !== undefined : assignment.define.length === 3, `${entity.name} ${assignment.attribute}`).toBe(true);
      }
    }
    const defined = generic.flatMap((entry) => entry.entities).flatMap((entity) => (entity.behavior ?? []).filter((assignment) => assignment.define).map((assignment) => assignment.define!.slice(0, 2).join("_")));
    expect(new Set(defined)).toEqual(new Set(enumSettings().map(({ define }) => defineGroup(define!))));
    expect(modes.size).toBeGreaterThan(0);
  });

  it("asks the game for every prototype of the editor as it is placed, with the attribute of every field of its settings, and for the numbers of every mode", () => {
    const prototypes = probePrototypes();
    expect(prototypes.map((prototype) => prototype.name)).toEqual(PROTOTYPE_NAMES);
    expect(prototypes).toHaveLength(98);
    for (const { name, attributes } of prototypes) {
      const row = PROTOTYPES[name]!.kind === "entity" ? ENTITY_SETTINGS[STANDARD_ENTITY_TABLE.byName.get(name)!.type]! : undefined;
      expect(attributes.map((entry) => entry.field).sort(), name).toEqual([...new Set((row?.settings ?? []).flatMap(settingFields))].sort());
    }
    expect(prototypes.find((prototype) => prototype.name === "transport-belt")!.attributes).toContainEqual({ field: "circuit_contents_read_mode", attribute: "read_contents_mode" });
    expect(prototypes.find((prototype) => prototype.name === "small-lamp")!.attributes).toEqual([]);
    const scenario = readFileSync(new URL("../blueprints.lua", import.meta.url), "utf8");
    for (const { key, define } of enumSettings()) {
      expect(define, key).toBeDefined();
      expect(scenario, key).toContain(`${defineGroup(define!)} = { "${define!.path[0]}", "${define!.path[1]}" }`);
    }
  });

  it("builds a case with the hub of a space platform on a platform, the only place the hub stands", () => {
    expect(cases.filter((entry) => entry.surface === "platform").map((entry) => entry.label)).toEqual(["generic entities: space platform hub"]);
    const hub = cases.find((entry) => entry.surface === "platform")!.entities.find((entity) => entity.name === "space-platform-hub")!;
    // The blueprint is written around the hub, as the game builds it.
    expect(hub.position).toEqual({ x: 0, y: 0 });
  });

  it("composes the scenario: the cases as one line of ASCII in front of blueprints.lua", () => {
    const lua = composeScenario({ prototypes: [], cases: [{ label: "café ≥", string: "0eN" }] });
    const [first, second] = lua.split("\n");
    expect(first).toBe('local CASES_JSON = [==[{"prototypes":[],"cases":[{"label":"caf\\u00e9 \\u2265","string":"0eN"}]}]==]');
    expect(second).toBe(readFileSync(new URL("../blueprints.lua", import.meta.url), "utf8").split("\n")[0]);
    expect(lua).toContain("helpers.json_to_table(CASES_JSON)");
    expect(/^[\x00-\x7f]*$/.test(composeScenario(probeRequest()))).toBe(true);
    expect(() => composeScenario([{ label: "]==]" }])).toThrow("ends the Lua string");
  });

  it("bundles the request for Node as the tool does, with the same result", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "face-blueprint-cases-"));
    try {
      expect(await loadRequest(workDir)).toEqual(probeRequest());
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
