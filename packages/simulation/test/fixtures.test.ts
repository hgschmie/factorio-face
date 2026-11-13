import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURE_PROVENANCES, runFixture, validateFixture, type ConformanceFixture } from "../src/index.ts";
import { arithmetic, circuit, constant, lamp, v, wire } from "./helpers.ts";

// Every *.json in tests/fixtures/conformance is run; game-recorded fixtures can be dropped in without touching this file.
const directory = new URL("../../../tests/fixtures/conformance/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
const load = (name: string): unknown => JSON.parse(readFileSync(new URL(name, directory), "utf8"));

describe("conformance fixtures", () => {
  it("finds the authored fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(23);
  });

  for (const name of files) {
    const raw = load(name);
    const provenance = (raw as { provenance?: string }).provenance ?? "invalid";
    it(`${name.replace(/\.json$/, "")} [${provenance}]`, () => {
      expect(validateFixture(raw)).toEqual([]);
      const fixture = raw as ConformanceFixture;
      expect(`${fixture.id}.json`).toBe(name);
      expect(fixture.expect.length).toBeGreaterThan(0);
      expect(runFixture(fixture)).toEqual([]);
    });
  }

  it("marks every fixture with a known provenance and names the audit fixtures it covers", () => {
    const fixtures = files.map((name) => load(name) as ConformanceFixture);
    for (const fixture of fixtures) {
      expect(FIXTURE_PROVENANCES).toContain(fixture.provenance);
      expect(fixture.covers.every((id) => /^F-\d\d$/.test(id))).toBe(true);
    }
    const covered = new Set(fixtures.flatMap((f) => f.covers));
    for (const id of ["F-03", "F-05", "F-06", "F-07", "F-10", "F-11", "F-12", "F-13", "F-16", "F-17", "F-18", "F-19", "F-20", "F-21", "F-22", "F-25", "F-26"]) expect(covered, id).toContain(id);
  });
});

describe("fixture runner", () => {
  const fixture: ConformanceFixture = {
    format: 1,
    id: "inline",
    covers: ["F-03"],
    title: "inline",
    provenance: "assumed",
    circuit: circuit([constant("c", { A: 5, B: 1 }), arithmetic("a", "A", "+", 1, "A"), lamp("l", { alwaysOn: true, color: { r: 1, g: 2, b: 3 } })], [wire("red", "c.out", "a.in"), wire("green", "a.out", "l.in")]),
    ticks: 3,
    expect: [
      { tick: 0, outputs: { a: {}, c: v({ A: 5, B: 1 }) } },
      { tick: 1, through: 3, outputs: { a: v({ A: 6 }) }, networks: [{ terminal: { entity: "l", side: "in" }, color: "green", signals: v({ A: 6 }) }], lamps: { l: { lit: true, color: { r: 1, g: 2, b: 3 } } } },
    ],
  };

  it("passes a correct fixture", () => {
    expect(validateFixture(fixture)).toEqual([]);
    expect(runFixture(fixture)).toEqual([]);
  });

  it("reports wrong values, unexpected signals, missing targets and lamp mismatches per tick", () => {
    const wrong: ConformanceFixture = {
      ...fixture,
      expect: [
        { tick: 1, outputs: { a: v({ A: 7 }), c: v({ A: 5 }), ghost: {} } },
        { tick: 2, through: 3, networks: [{ terminal: { entity: "c", side: "out" }, color: "green", signals: {} }], lamps: { l: { lit: false }, a: { lit: true } } },
        { tick: 3, lamps: { l: { lit: true, color: null } } },
      ],
    };
    const failures = runFixture(wrong);
    expect(failures.map((f) => `${f.tick} ${f.target}`)).toEqual([
      "1 output a",
      "1 output c",
      "1 output ghost",
      "2 network green c.out",
      "2 lamp l",
      "2 lamp a",
      "3 network green c.out",
      "3 lamp l",
      "3 lamp a",
      "3 lamp l",
    ]);
    expect(failures[0]!.message).toBe("virtual:signal-A: expected 7, got 6");
    expect(failures[1]!.message).toBe("virtual:signal-B: unexpected 1");
    expect(failures[9]!.message).toContain("expected color null");
  });

  it("in listed mode checks only the listed signals, 0 meaning absent", () => {
    const listed: ConformanceFixture = { ...fixture, match: "listed", expect: [{ tick: 2, outputs: { c: v({ A: 5, Z: 0 }) } }] };
    expect(runFixture(listed)).toEqual([]);
    expect(runFixture({ ...listed, expect: [{ tick: 2, outputs: { c: v({ B: 0 }) } }] })).toHaveLength(1);
  });

  it("rejects malformed fixtures with readable problems", () => {
    expect(validateFixture(null)).toEqual(["fixture is not an object"]);
    expect(validateFixture({})).toEqual(expect.arrayContaining(["format must be 1", "provenance must be one of assumed, documented, game", "circuit must have entities and wires", "expect must be an array"]));
    expect(validateFixture({ ...fixture, provenance: "verified" })).toEqual(["provenance must be one of assumed, documented, game"]);
    expect(validateFixture({ ...fixture, expect: [{ tick: 9 }] })).toEqual(["expect[0] lies beyond ticks"]);
    expect(validateFixture({ ...fixture, expect: [{ tick: 2, through: 1 }] })).toEqual(["expect[0] needs a tick and, if given, a through >= tick"]);
    expect(validateFixture({ ...fixture, circuit: { entities: [{ id: "x", kind: "pump" }], wires: [{ color: "blue" }] } })).toHaveLength(2);
  });
});
