// The pure part of the wire reach probe: the fixture built from a recording. The library is plain .mjs, loaded as in tools/catalog.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Probed { name: string; type: string; width: number; height: number; facing?: string; asked?: string; connector?: string; reach: number; selectionBox?: number[] }
interface RecordedCase { label: string; a?: Probed; b?: Probed; range?: number; rows?: string[]; error?: string }
interface Recording { game_version: string; range: number; cases: RecordedCase[] }
interface Fixture { id: string; source: string; gameVersion: string; range: number; cases: { label: string; a: Probed; b: Probed; reach: number; range?: number; rows: string[] }[] }

const { buildFixture, failedCases, serialiseFixture } = (await import(/* @vite-ignore */ new URL("./fixture.mjs", import.meta.url).href)) as {
  buildFixture(recording: Recording, source: string): Fixture;
  failedCases(recording: Recording): RecordedCase[];
  serialiseFixture(fixture: Fixture): string;
};

const constant: Probed = { name: "constant-combinator", type: "constant-combinator", width: 1, height: 1, reach: 9, selectionBox: [-0.5, -0.5, 0.5, 0.5] };
const pole: Probed = { name: "small-electric-pole", type: "electric-pole", width: 1, height: 1, reach: 7.5, selectionBox: [-0.3984375, -0.3984375, 0.3984375, 0.3984375] };
const gate: Probed = { selectionBox: [-0.5, -1, 0.5, 1], connector: "in", reach: 9, facing: "north", height: 2, width: 1, type: "decider-combinator", name: "decider-combinator" };
// The game gave it another direction than the scenario asked for.
const furnace: Probed = { name: "stone-furnace", type: "furnace", width: 2, height: 2, facing: "north", asked: "east", reach: 9, selectionBox: [-0.796875, -1, 0.796875, 1] };
const recording = (cases: Recording["cases"]): Recording => ({ game_version: "2.1.24", range: 1, cases });

describe("wire reach fixture", () => {
  it("takes the smaller reach of the two entities and keeps the fields in one order", () => {
    const fixture = buildFixture(recording([{ label: "constant - small pole", a: constant, b: pole, rows: ["111", "111", "110"] }, { label: "gate - constant", a: gate, b: constant, rows: ["000", "010", "000"] }]), "test");
    expect(fixture).toMatchObject({ id: "F-24-wire-reach", source: "test", gameVersion: "2.1.24", range: 1 });
    expect(fixture.cases.map((probed) => probed.reach)).toEqual([7.5, 9]);
    expect(Object.keys(fixture.cases[1]!.a)).toEqual(["name", "type", "width", "height", "facing", "connector", "reach", "selectionBox"]);
    expect(Object.keys(fixture.cases[0]!.a)).toEqual(["name", "type", "width", "height", "reach", "selectionBox"]);
    expect(buildFixture(recording([{ label: "furnace - constant", a: furnace, b: constant, rows: ["111", "111", "111"] }]), "test").cases[0]!.a).toEqual(furnace);
    expect(Object.keys(buildFixture(recording([{ label: "furnace - constant", a: furnace, b: constant, rows: ["111", "111", "111"] }]), "test").cases[0]!.a)).toEqual(["name", "type", "width", "height", "facing", "asked", "reach", "selectionBox"]);
  });

  it("writes one row per line, as valid JSON, the same for the same recording", () => {
    const fixture = buildFixture(recording([{ label: "constant - constant", a: constant, b: constant, rows: ["010", "111", "010"] }]), "test");
    const text = serialiseFixture(fixture);
    expect(JSON.parse(text)).toEqual(fixture);
    expect(text).toContain('      "rows": [\n        "010",\n        "111",\n        "010"\n      ]');
    expect(text.endsWith("}\n")).toBe(true);
    expect(serialiseFixture(buildFixture(recording([{ label: "constant - constant", a: { ...constant }, b: { ...constant }, rows: ["010", "111", "010"] }]), "test"))).toBe(text);
  });

  it("lets a case have a range of its own and says so only where it differs", () => {
    const wide = ["00100", "01110", "11111", "01110", "00100"];
    const fixture = buildFixture(recording([{ label: "near", a: constant, b: constant, range: 1, rows: ["010", "111", "010"] }, { label: "far", a: pole, b: pole, range: 2, rows: wide }]), "test");
    expect(fixture.cases.map((probed) => probed.range)).toEqual([undefined, 2]);
    expect(Object.keys(fixture.cases[1]!)).toEqual(["label", "a", "b", "reach", "range", "rows"]);
    const text = serialiseFixture(fixture);
    expect(JSON.parse(text)).toEqual(fixture);
    expect(text).toContain('      "reach": 7.5,\n      "range": 2,\n      "rows": [\n        "00100",');
    expect(() => buildFixture(recording([{ label: "far", a: pole, b: pole, range: 2, rows: ["010", "111", "010"] }]), "test")).toThrow("far: not a 5 x 5 grid");
  });

  it("leaves out the cases the game could not set up and names them", () => {
    const recorded = recording([{ label: "tower - tower", error: "no prototype agricultural-tower with the enabled modules" }, { label: "constant - constant", a: constant, b: constant, rows: ["010", "111", "010"] }]);
    expect(buildFixture(recorded, "test").cases.map((probed) => probed.label)).toEqual(["constant - constant"]);
    expect(failedCases(recorded)).toEqual([{ label: "tower - tower", error: "no prototype agricultural-tower with the enabled modules" }]);
    expect(failedCases(recording([]))).toEqual([]);
  });

  it("refuses a recording that is not a full grid of answers or has no reach", () => {
    const one = (rows: string[], b = constant): Recording => recording([{ label: "bad", a: constant, b, rows }]);
    expect(() => buildFixture(one(["111", "111"]), "test")).toThrow("bad: not a 3 x 3 grid");
    expect(() => buildFixture(one(["111", "1?1", "111"]), "test")).toThrow("not a 3 x 3 grid");
    expect(() => buildFixture(one(["111", "1111", "111"]), "test")).toThrow("not a 3 x 3 grid");
    expect(() => buildFixture(one(["111", "111", "111"], { ...constant, reach: 0 }), "test")).toThrow("constant-combinator: no wire reach (0)");
    expect(() => buildFixture(one(["111", "111", "111"], { ...constant, selectionBox: undefined }), "test")).toThrow("constant-combinator: no selection box (undefined)");
    expect(() => buildFixture(one(["111", "111", "111"], { ...constant, selectionBox: [-0.5, -0.5, 0.5] }), "test")).toThrow("constant-combinator: no selection box ([-0.5,-0.5,0.5])");
  });

  it("is what the committed fixture is written with", () => {
    const text = readFileSync(new URL("../../../tests/fixtures/game/F-24-wire-reach.json", import.meta.url), "utf8");
    expect(serialiseFixture(JSON.parse(text) as Fixture)).toBe(text);
  });

  it("asks the game about every prototype the editor has a kind of its own for", async () => {
    const { PROTOTYPE_NAMES, PROTOTYPES } = await import("@face/model");
    const scenario = readFileSync(new URL("../wire-reach.lua", import.meta.url), "utf8");
    // Of the generic entities it asks about those whose footprint or reach is not the usual one: the next test.
    const own = PROTOTYPE_NAMES.filter((name) => PROTOTYPES[name]!.kind !== "entity");
    expect(own).toHaveLength(10);
    for (const name of own) expect(scenario, name).toContain(`"${name}"`);
  });

  it("asks the game about the footprints, selection boxes and reaches of the entity table that the editor's prototypes do not have", async () => {
    const { STANDARD_ENTITY_TABLE: table, STANDARD_WIRE_REACH } = await import("@face/model");
    const scenario = readFileSync(new URL("../wire-reach.lua", import.meta.url), "utf8");
    const asked = table.entities.filter((entity) => scenario.includes(`"${entity.name}"`));
    // Every reach that is not the standard one, and every selection box that is not the tiles of its prototype, by one prototype that has it.
    for (const entity of table.entities.filter((candidate) => candidate.wireReach !== STANDARD_WIRE_REACH)) expect(asked, entity.name).toContain(entity);
    const boxes = new Set(asked.map((entity) => `${entity.type} ${entity.selectionBox?.join(" ")}`));
    for (const entity of table.entities.filter((candidate) => candidate.selectionBox)) expect([...boxes], entity.name).toContain(`${entity.type} ${entity.selectionBox!.join(" ")}`);
    const footprints = new Set(asked.map((entity) => `${entity.width}x${entity.height}`));
    expect([...footprints]).toEqual(expect.arrayContaining(["1x1", "1x2", "2x1", "2x2", "2x4", "3x2", "3x3", "3x5", "5x5", "9x9"]));
    expect(asked.some((entity) => entity.directions === 16)).toBe(true);
  });
});
