// The pure part of the wire reach probe: the fixture built from a recording. The library is plain .mjs, loaded as in tools/catalog.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Probed { name: string; width: number; height: number; facing?: string; connector?: string; reach: number }
interface Recording { game_version: string; range: number; cases: { label: string; a: Probed; b: Probed; rows: string[] }[] }
interface Fixture { id: string; source: string; gameVersion: string; range: number; cases: { label: string; a: Probed; b: Probed; reach: number; rows: string[] }[] }

const { buildFixture, serialiseFixture } = (await import(/* @vite-ignore */ new URL("./fixture.mjs", import.meta.url).href)) as {
  buildFixture(recording: Recording, source: string): Fixture;
  serialiseFixture(fixture: Fixture): string;
};

const constant: Probed = { name: "constant-combinator", width: 1, height: 1, reach: 9 };
const pole: Probed = { name: "small-electric-pole", width: 1, height: 1, reach: 7.5 };
const gate: Probed = { connector: "in", reach: 9, facing: "north", height: 2, width: 1, name: "decider-combinator" };
const recording = (cases: Recording["cases"]): Recording => ({ game_version: "2.1.24", range: 1, cases });

describe("wire reach fixture", () => {
  it("takes the smaller reach of the two entities and keeps the fields in one order", () => {
    const fixture = buildFixture(recording([{ label: "constant - small pole", a: constant, b: pole, rows: ["111", "111", "110"] }, { label: "gate - constant", a: gate, b: constant, rows: ["000", "010", "000"] }]), "test");
    expect(fixture).toMatchObject({ id: "F-24-wire-reach", source: "test", gameVersion: "2.1.24", range: 1 });
    expect(fixture.cases.map((probed) => probed.reach)).toEqual([7.5, 9]);
    expect(Object.keys(fixture.cases[1]!.a)).toEqual(["name", "width", "height", "facing", "connector", "reach"]);
    expect(Object.keys(fixture.cases[0]!.a)).toEqual(["name", "width", "height", "reach"]);
  });

  it("writes one row per line, as valid JSON, the same for the same recording", () => {
    const fixture = buildFixture(recording([{ label: "constant - constant", a: constant, b: constant, rows: ["010", "111", "010"] }]), "test");
    const text = serialiseFixture(fixture);
    expect(JSON.parse(text)).toEqual(fixture);
    expect(text).toContain('      "rows": [\n        "010",\n        "111",\n        "010"\n      ]');
    expect(text.endsWith("}\n")).toBe(true);
    expect(serialiseFixture(buildFixture(recording([{ label: "constant - constant", a: { ...constant }, b: { ...constant }, rows: ["010", "111", "010"] }]), "test"))).toBe(text);
  });

  it("refuses a recording that is not a full grid of answers or has no reach", () => {
    const one = (rows: string[], b = constant): Recording => recording([{ label: "bad", a: constant, b, rows }]);
    expect(() => buildFixture(one(["111", "111"]), "test")).toThrow("bad: not a 3 x 3 grid");
    expect(() => buildFixture(one(["111", "1?1", "111"]), "test")).toThrow("not a 3 x 3 grid");
    expect(() => buildFixture(one(["111", "1111", "111"]), "test")).toThrow("not a 3 x 3 grid");
    expect(() => buildFixture(one(["111", "111", "111"], { ...constant, reach: 0 }), "test")).toThrow("constant-combinator: no wire reach (0)");
  });

  it("is what the committed fixture is written with", () => {
    const text = readFileSync(new URL("../../../tests/fixtures/game/F-24-wire-reach.json", import.meta.url), "utf8");
    expect(serialiseFixture(JSON.parse(text) as Fixture)).toBe(text);
  });
});
