// The parts of the blueprint probe that run without the game: the cases it sends, the scenario it composes and the fixture it
// builds from a recording. The libraries are plain .mjs, loaded as in tools/catalog.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeBlueprintString } from "../../../packages/blueprints/src/index.ts";
import { SAMPLES } from "../../../packages/blueprints/test/samples.ts";
import { probeCases, type ProbeCase } from "./blueprintCases.ts";

interface Exported { string: string; blueprint: unknown }
interface FixtureCase { label: string; importResult?: number; ghosts?: number; revived?: number; errors: string[]; sent: Exported; reexported?: Exported; rebuilt?: Exported; native?: Exported }
interface Fixture { id: string; covers: string[]; gameVersion: string; activeMods: string[]; defines: Record<string, Record<string, number>>; fresh: Record<string, Exported | { error: string }>; cases: FixtureCase[] }

const { buildFixture, decodeString, fixtureErrors, serialiseFixture } = (await import(/* @vite-ignore */ new URL("./blueprintFixture.mjs", import.meta.url).href)) as {
  buildFixture(recording: unknown, source: string): Fixture;
  decodeString(text: string): unknown;
  fixtureErrors(fixture: Fixture): string[];
  serialiseFixture(fixture: Fixture): string;
};
const { composeScenario, loadCases } = (await import(/* @vite-ignore */ new URL("./blueprintScenario.mjs", import.meta.url).href)) as {
  composeScenario(cases: unknown): string;
  loadCases(workDir: string): Promise<ProbeCase[]>;
};

const lamp = { blueprint: { entities: [{ entity_number: 1, name: "small-lamp", position: { x: 0.5, y: 0.5 } }], item: "blueprint", version: 562954249961472 } };
const pole = { blueprint: { entities: [{ entity_number: 1, name: "substation", position: { x: 1, y: 1 } }], item: "blueprint", version: 562954249961472 } };
const [lampString, poleString] = [encodeBlueprintString(lamp), encodeBlueprintString(pole)];

/** What blueprints.lua writes, as the game's JSON has it: an empty list is an object. */
const recording = {
  game_version: "2.1.24",
  active_mods: { "space-age": "2.1.24", base: "2.1.24" },
  defines: { wire_connector_id: { circuit_green: 2, pole_copper: 5, circuit_red: 1, combinator_input_red: 1 }, direction: { south: 8, north: 0 } },
  fresh: { placed: { string: lampString }, with_control_behavior: { error: "cannot place small-lamp" } },
  cases: [
    { label: "lamps", sent: lampString, import_result: 0, reexported: lampString, ghosts: 1, revived: 1, rebuilt: lampString, native: poleString, errors: {} },
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
    expect(fixture).toMatchObject({ id: "F-01-blueprints", covers: ["F-01", "F-02", "F-23"], gameVersion: "2.1.24", activeMods: ["base", "space-age"], source: "test" });
    expect(fixture.fresh).toEqual({ placed: { string: lampString, blueprint: lamp }, withControlBehavior: { error: "cannot place small-lamp" } });
    expect(fixture.cases[0]).toEqual({
      label: "lamps", importResult: 0, ghosts: 1, revived: 1, errors: [], sent: { string: lampString, blueprint: lamp }, reexported: { string: lampString, blueprint: lamp }, rebuilt: { string: lampString, blueprint: lamp }, native: { string: poleString, blueprint: pole },
    });
    expect(fixture.cases[1]).toEqual({ label: "poles", importResult: 0, errors: ["build: boom", "native: entity 1 (substation): bang"], sent: { string: poleString, blueprint: pole }, reexported: { string: poleString, blueprint: pole } });
    expect(fixtureErrors(fixture)).toEqual(["fresh withControlBehavior: cannot place small-lamp", "poles: build: boom", "poles: native: entity 1 (substation): bang"]);
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
    expect(entity("constant combinators", 4).constant).toEqual({ enabled: true, sections: [] });
    expect(entity("arithmetic combinators, first half of the operations", 0).parameters).toEqual({ first_signal: { type: "virtual", name: "signal-B" }, second_constant: 2, operation: "*", output_signal: { type: "virtual", name: "signal-A" } });
    expect(entity("arithmetic combinators, first half of the operations", 6)).toEqual({ name: "arithmetic-combinator", position: { x: 5, y: 2.5 }, direction: "east" });
    expect(entity("decider combinators", 4).parameters).toEqual({
      conditions: [{ first_signal: { type: "virtual", name: "signal-A" }, constant: 1, comparator: "=" }], outputs: [{ signal: { type: "virtual", name: "signal-A" }, copy_count_from_input: false }], else_outputs: [],
    });
    expect(entity("selector combinators, select count random", 6).parameters).toEqual({ operation: "random", random_update_interval: 60 });
    expect(entity("lamps", 0)).toEqual({ name: "small-lamp", position: { x: 0.5, y: 0.5 }, lamp: { always_on: false } });
    expect(entity("lamps", 5).lamp!.behavior).toMatchObject({ use_colors: true, color_mode: "components" });
    expect(entity("electric poles", 2)).toEqual({ name: "big-electric-pole", position: { x: 5, y: 1 } });
    expect(entity("programmable speakers", 1).speaker).toMatchObject({ parameters: { playback_volume: 0.625, playback_mode: "global" }, alert_parameters: { show_alert: true }, behavior: { circuit_parameters: { instrument_id: 0, note_id: 6 } } });
  });

  it("composes the scenario: the cases as one line of ASCII in front of blueprints.lua", () => {
    const lua = composeScenario([{ label: "café ≥", string: "0eN" }]);
    const [first, second] = lua.split("\n");
    expect(first).toBe('local CASES_JSON = [==[[{"label":"caf\\u00e9 \\u2265","string":"0eN"}]]==]');
    expect(second).toBe(readFileSync(new URL("../blueprints.lua", import.meta.url), "utf8").split("\n")[0]);
    expect(lua).toContain("helpers.json_to_table(CASES_JSON)");
    expect(/^[\x00-\x7f]*$/.test(composeScenario(cases))).toBe(true);
    expect(() => composeScenario([{ label: "]==]" }])).toThrow("ends the Lua string");
  });

  it("bundles the cases for Node as the tool does, with the same result", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "face-blueprint-cases-"));
    try {
      expect(await loadCases(workDir)).toEqual(cases);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
