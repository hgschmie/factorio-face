// The pure part of the blank condition probe: the fixture built from a recording, and what a case comes to. The library is plain .mjs, loaded as in tools/catalog.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Json = Record<string, unknown>;
interface Recorded extends Json { state: string; built: string }
interface Recording { game_version: string; ticks: number; signal: string; cases: { name: string; type?: string; kind: string; flag?: string; readings: Recorded[] }[]; deciders?: Json[] | Json }
interface Reading extends Json { state: string; built: string[]; error?: string; fulfilled?: boolean; disabled?: boolean; gateOpened?: boolean; signalState?: string }
interface Case { name: string; type?: string; kind: string; flag?: string; readings: Reading[] }
interface Fixture { id: string; source: string; gameVersion: string; ticks: number; signal: string; cases: Case[]; deciders: { state: string; error?: string; conditions?: Json[]; output?: Record<string, number> }[] }
type Verdict = { fulfilled: boolean | "mixed" | undefined; switched: boolean | "mixed" | undefined };
interface Summary { name: string; kind: string; built: string[]; trusted: boolean; agree: boolean | undefined; blank: Verdict; blankEqualsZero: Verdict; unwired: Verdict; falseUnwired: Verdict; off: Verdict }

const { buildFixture, describeCase, fixtureErrors, serialiseFixture, sortKeys, summarise, switched } = (await import(/* @vite-ignore */ new URL("./blankConditionFixture.mjs", import.meta.url).href)) as {
  buildFixture(recording: Recording, source: string): Fixture;
  describeCase(summary: Summary): string;
  fixtureErrors(fixture: Fixture): string[];
  serialiseFixture(fixture: Fixture): string;
  sortKeys(value: unknown): unknown;
  summarise(probed: Case): Summary;
  switched(kind: string, reading: Json): boolean | undefined;
};

const A = { type: "virtual", name: "signal-A" };
// A reading as the scenario writes it: snake case, the condition with its `fulfilled`, an empty list as an object.
const recorded = (state: string, built: string, fulfilled: boolean, disabled: boolean, condition: Json = { constant: 0, comparator: "<" }): Recorded => ({
  state, built, import_result: built === "blueprint" ? 0 : undefined, unavailable: {}, control_behavior: true, wires: 1, signal: 1, flag: true,
  condition: { ...condition, fulfilled }, disabled, status: disabled ? "disabled_by_control_behavior" : "working", exported: { circuit_enabled: true, circuit_condition: condition },
});
const both = (state: string, fulfilled: boolean, disabled: boolean, condition?: Json): Recorded[] => [recorded(state, "blueprint", fulfilled, disabled, condition), recorded(state, "api", fulfilled, disabled, condition)];
const belt = (readings: Recorded[]): Recording["cases"][number] => ({ name: "transport-belt", type: "transport-belt", kind: "onoff", flag: "circuit_enabled", readings });
const recording = (cases: Recording["cases"], deciders: Recording["deciders"] = {}): Recording => ({ game_version: "2.1.25", ticks: 60, signal: "signal-A", cases, deciders });
const controls = [...both("true", true, false, { first_signal: A, constant: 0, comparator: ">" }), ...both("false", false, true, { first_signal: A, constant: 0, comparator: "<" })];

describe("blank condition fixture", () => {
  it("folds the two ways of building into one reading where they say the same, in one order of fields and keys", () => {
    const fixture = buildFixture(recording([belt([...both("blank", false, true), ...controls])]), "test");
    expect(fixture).toMatchObject({ id: "F-29-blank-condition", source: "test", gameVersion: "2.1.25", ticks: 60, signal: "signal-A" });
    const [blank, yes] = fixture.cases[0]!.readings;
    expect(fixture.cases[0]!.readings.map((one) => [one.state, one.built])).toEqual([["blank", ["blueprint", "api"]], ["true", ["blueprint", "api"]], ["false", ["blueprint", "api"]]]);
    expect(Object.keys(blank!)).toEqual(["state", "built", "wires", "signal", "controlBehavior", "flag", "condition", "fulfilled", "disabled", "status", "exported"]);
    expect(blank).toMatchObject({ condition: { comparator: "<", constant: 0 }, fulfilled: false, disabled: true });
    expect(JSON.stringify(yes!.exported)).toBe('{"circuit_condition":{"comparator":">","constant":0,"first_signal":{"name":"signal-A","type":"virtual"}},"circuit_enabled":true}');
  });

  it("keeps two readings where the blueprint and the runtime API differ, and what the game refused", () => {
    const bare: Recorded = { state: "blank-unwired", built: "blueprint", import_result: 0, unavailable: {}, control_behavior: false, wires: 0, signal: 0, status: "working", exported: "none" };
    const own: Recorded = { ...recorded("blank-unwired", "api", false, false), unavailable: ["status", "disabled"], exported: "none" };
    const refused: Recorded = { state: "blank", built: "blueprint", error: "the game did not build it" };
    const fixture = buildFixture(recording([belt([refused, recorded("blank", "api", false, true), bare, own])]), "test");
    expect(fixture.cases[0]!.readings.map((one) => [one.state, one.built])).toEqual([["blank", ["blueprint"]], ["blank", ["api"]], ["blank-unwired", ["blueprint"]], ["blank-unwired", ["api"]]]);
    expect(fixture.cases[0]!.readings[0]).toEqual({ state: "blank", built: ["blueprint"], error: "the game did not build it" });
    expect(fixture.cases[0]!.readings[2]).toEqual({ state: "blank-unwired", built: ["blueprint"], wires: 0, signal: 0, controlBehavior: false, status: "working", exported: null });
    expect(fixture.cases[0]!.readings[3]).toMatchObject({ unavailable: ["disabled", "status"], exported: null });
    expect(fixtureErrors(fixture)).toEqual(["transport-belt, blank (blueprint): the game did not build it"]);
    // A blueprint string the game found fault with is not the reading of one it took.
    const faulty = buildFixture(recording([belt([{ ...recorded("blank", "blueprint", false, true), import_result: 1 }, recorded("blank", "api", false, true)])]), "test");
    expect(faulty.cases[0]!.readings.map((one) => [one.built, one.importResult])).toEqual([[["blueprint"], 1], [["api"], undefined]]);
  });

  it("takes the decider combinators with their conditions and what they sent", () => {
    const blank = { constant: 0, comparator: "<", compare_type: "or" };
    const fixture = buildFixture(recording([belt(controls)], [{ state: "blank", signal: 1, conditions: [blank], output: { "signal-C": 1 } }, { state: "empty", signal: 1, conditions: {}, output: {} }, { state: "true", error: "no wire" }]), "test");
    expect(fixture.deciders).toEqual([
      { state: "blank", signal: 1, conditions: [{ comparator: "<", compare_type: "or", constant: 0 }], output: { "signal-C": 1 } },
      { state: "empty", signal: 1, conditions: [], output: {} },
      { state: "true", error: "no wire" },
    ]);
    expect(fixtureErrors(fixture)).toEqual(["decider-combinator, true: no wire"]);
    expect(buildFixture(recording([belt(controls)]), "test").deciders).toEqual([]);
  });

  it("writes one reading per line, as valid JSON, the same for the same recording", () => {
    const cases = (): Recording => recording([belt([...both("blank", false, true), ...controls])], [{ state: "blank", signal: 1, conditions: [{}], output: { "signal-C": 1 } }]);
    const fixture = buildFixture(cases(), "test");
    const text = serialiseFixture(fixture);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(fixture)));
    expect(text).toContain('      "flag": "circuit_enabled",\n      "readings": [\n        {"state":"blank","built":["blueprint","api"],"wires":1,');
    expect(text).toContain('  "deciders": [\n    {"state":"blank","signal":1,"conditions":[{}],"output":{"signal-C":1}}\n  ]\n}\n');
    expect(serialiseFixture(buildFixture(cases(), "test"))).toBe(text);
  });

  it("refuses a recording without version, ticks, cases, readings, state or way of building", () => {
    expect(() => buildFixture(recording([]), "test")).toThrow("no game version, no ticks or no cases");
    expect(() => buildFixture({ ...recording([belt(controls)]), ticks: 0 }, "test")).toThrow("no game version, no ticks or no cases");
    expect(() => buildFixture(recording([belt([])]), "test")).toThrow('a case without name, kind or readings: "transport-belt"');
    expect(() => buildFixture(recording([belt([{ state: "blank" } as unknown as Recorded])]), "test")).toThrow("transport-belt: a reading without state or way of building");
    expect(() => buildFixture(recording([belt(controls)], [{ signal: 1 }]), "test")).toThrow("a decider combinator without state");
  });

  it("sorts the keys of every object and leaves lists in their order", () => {
    expect(JSON.stringify(sortKeys({ b: [{ d: 1, c: 2 }, 3], a: null, 0: "x" }))).toBe('{"0":"x","a":null,"b":[{"c":2,"d":1},3]}');
  });

  it("is what the committed fixture is written with", () => {
    const text = readFileSync(new URL("../../../tests/fixtures/game/F-29-blank-condition.json", import.meta.url), "utf8");
    expect(serialiseFixture(JSON.parse(text) as Fixture)).toBe(text);
  });
});

describe("what a case comes to", () => {
  it("reads what a condition switches by the kind of the entity", () => {
    expect([switched("onoff", { disabled: true }), switched("onoff", { disabled: false }), switched("onoff", {})]).toEqual([false, true, undefined]);
    expect([switched("wall", { gateOpened: true }), switched("wall", { gateOpened: false }), switched("wall", {})]).toEqual([true, false, undefined]);
    expect([switched("signal", { signalState: "reserved_by_circuit_network" }), switched("signal", { signalState: "open" }), switched("signal", {})]).toEqual([true, false, undefined]);
    expect(switched("speaker", { disabled: true })).toBeUndefined();
  });

  it("trusts a case whose controls read as they must and says what the blank condition does", () => {
    const [probed] = buildFixture(recording([belt([...both("blank", false, true), ...both("blank-unwired", false, false), ...controls, ...both("blank-equals-zero", false, true, { constant: 0, comparator: "=" })])]), "test").cases;
    const summary = summarise(probed!);
    expect(summary).toEqual({
      name: "transport-belt", kind: "onoff", built: ["blueprint", "api"], trusted: true, agree: true,
      blank: { fulfilled: false, switched: false }, blankEqualsZero: { fulfilled: false, switched: false }, unwired: { fulfilled: false, switched: true },
      falseUnwired: { fulfilled: undefined, switched: undefined }, off: { fulfilled: undefined, switched: undefined },
    });
    expect(describeCase(summary)).toBe(
      "transport-belt: wired, blank: not fulfilled, disabled; wired, blank = 0: not fulfilled, disabled; unwired, blank: not fulfilled, enabled; unwired, false: nothing to read; controls as expected; blueprint and API agree",
    );
  });

  it("does not trust a case whose controls read wrong or are missing", () => {
    const of = (readings: Recorded[]): Summary => summarise(buildFixture(recording([belt(readings)]), "test").cases[0]!);
    expect(of([...both("blank", false, true)]).trusted).toBe(false);
    expect(of([...both("true", true, true), ...both("false", false, true)]).trusted).toBe(false);
    expect(of([...both("true", false, false), ...both("false", false, true)]).trusted).toBe(false);
    expect(of([...both("true", true, false), recorded("false", "blueprint", false, true), recorded("false", "api", true, false)])).toMatchObject({ trusted: false, agree: false });
    expect(describeCase(of([...both("blank", true, false)]))).toContain("wired, blank: fulfilled, enabled; wired, blank = 0: nothing to read; unwired, blank: nothing to read; unwired, false: nothing to read; controls NOT as expected");
  });

  it("says where the blueprint and the runtime API differ and where only one of them was built", () => {
    const refused: Recorded[] = ["true", "false"].map((state) => ({ state, built: "blueprint", error: "not built" }));
    const single = summarise(buildFixture(recording([belt([...refused, recorded("true", "api", true, false), recorded("false", "api", false, true)])]), "test").cases[0]!);
    expect(single).toMatchObject({ built: ["api"], trusted: true, agree: undefined });
    expect(describeCase(single)).toContain("; api only");
    const differing = summarise(buildFixture(recording([belt([...controls, recorded("blank", "blueprint", false, true), recorded("blank", "api", true, false)])]), "test").cases[0]!);
    expect(differing).toMatchObject({ agree: false, blank: { fulfilled: "mixed", switched: "mixed" } });
    expect(describeCase(differing)).toContain("wired, blank: fulfilled differs, effect differs;");
    expect(describeCase(differing)).toContain("blueprint and API differ");
    // A speaker shows no effect: its controls are trusted by `fulfilled` alone.
    const speaker = summarise({ name: "programmable-speaker", kind: "speaker", readings: [{ state: "true", built: ["api"], fulfilled: true }, { state: "false", built: ["api"], fulfilled: false }, { state: "blank", built: ["api"], fulfilled: false }] });
    expect(speaker).toMatchObject({ trusted: true, blank: { fulfilled: false, switched: undefined } });
    expect(describeCase(speaker)).toContain("programmable-speaker: wired, blank: not fulfilled; wired, blank = 0: nothing to read;");
  });
});
