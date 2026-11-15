import { BOTH_NETWORKS, DEFAULT_ENTITY, ENTITY_KINDS, newEntity, PROTOTYPE_NAMES, prototypesOf, UNSET_CONDITION, wildcardSignal, type Circuit, type Entity, type SignalId } from "@face/model";
import { describe, expect, it } from "vitest";
import { analyze, checkEntity, printCircuit, printEntity, printName, printNumber, printSignal } from "../src/index.ts";
import { fixture, Generator, portable, valid } from "./helpers.ts";

const NONE = { red: false, green: false };

function expectRoundTrip(circuit: Circuit): string {
  const printed = printCircuit(circuit);
  const result = analyze(printed);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(portable(result.circuit!)).toEqual(portable(circuit));
  expect(printCircuit(result.circuit!)).toBe(printed);
  return printed;
}

describe("canonical printer", () => {
  it("prints the spec example in the documented form", () => {
    const source = fixture("example.face");
    expect(printCircuit(valid(source).circuit)).toBe(source.replace("// A counter that lights a lamp.\n", "").replace("      // feedback", ""));
  });

  it("prints an empty circuit and default entities", () => {
    expect(printCircuit({ name: 'a "b"', entities: [], wires: [] })).toBe('circuit "a \\"b\\"" {\n}\n');
    const entities = ENTITY_KINDS.map((kind, i) => ({ ...newEntity(prototypesOf(kind)[0]!), id: `i${i}`, name: `${kind}1`, position: { x: i * 240, y: 0 } }) as Entity);
    const printed = expectRoundTrip({ name: "defaults", entities, wires: [] });
    expect(printed).toContain("    constant-combinator constant1 at (0, 0) {\n    }\n");
    expect(printed).toContain("    selector-combinator selector1 at (720, 0) {\n        operation = select\n    }\n");
    expect(printed).toContain("    small-electric-pole pole1 at (1200, 0) {\n    }\n");
    expect(printed).toContain("    accumulator entity1 at (1680, 0) {\n    }\n");
  });

  it("writes the game's name of every prototype as the word of its declaration, and reads it back", () => {
    expect(PROTOTYPE_NAMES).toHaveLength(98);
    const entities = PROTOTYPE_NAMES.map((prototype, i) => ({ ...newEntity(prototype), id: `i${i}`, name: `e${i}`, position: { x: i * 20, y: 0 } }) as Entity);
    const printed = expectRoundTrip({ name: "every prototype", entities, wires: [] });
    // Every name of the game reads as one word: none is quoted, and none is said a second time in the block.
    PROTOTYPE_NAMES.forEach((prototype, i) => expect(printed).toContain(`\n    ${prototype} e${i} at (${i * 20}, 0) {\n`));
    expect(PROTOTYPE_NAMES.map(printName)).toEqual(PROTOTYPE_NAMES);
    expect(printed.slice(printed.indexOf("{"))).not.toMatch(/"|prototype/);
    for (const entity of entities) expect(checkEntity(entity), entity.prototype).toEqual({ ok: true });
    // In quotes each reads the same.
    const quoted = analyze(printed.replace(/^ {4}([a-z0-9-]+) (e\d+) at/gm, '    "$1" $2 at'));
    expect(quoted.circuit?.entities.map((entity) => entity.prototype)).toEqual(PROTOTYPE_NAMES);
  });

  it("prints a description of any content on one line, for every kind", () => {
    const descriptions = ["plain", "first line\nsecond line\n\nfourth, after an empty one", 'say "hi" \\ back\\\\slash', "tab\there, windows\r\nbreak", "Grüße, 日本語 → 𝒜", "// no comment /* at all */", "trailing break\n", " padded "];
    for (const description of descriptions) {
      const entities = ENTITY_KINDS.map((kind, i) => ({ ...newEntity(prototypesOf(kind)[0]!), id: `i${i}`, name: `${kind}1`, position: { x: i * 240, y: 0 }, description }) as Entity);
      const printed = expectRoundTrip({ name: "described", entities, wires: [] });
      const lines = printed.split("\n").filter((line) => line.includes("description = "));
      expect(lines).toHaveLength(ENTITY_KINDS.length);
      for (const line of lines) expect(line).toMatch(/^ {8}description = ".*"$/);
      expect(printed).not.toMatch(/[\r\t]/);
    }
    expect(printEntity({ ...DEFAULT_ENTITY.lamp, prototype: "small-lamp", id: "x", name: "l", position: { x: 0, y: 0 }, description: 'a\n"b"\tc' })).toBe('small-lamp l at (0, 0) {\n    description = "a\\n\\"b\\"\\tc"\n}');
  });

  it("prints one entity starting in column 0 with a configurable indent", () => {
    const lamp: Entity = { ...DEFAULT_ENTITY.lamp, prototype: "small-lamp", id: "x", name: "l", position: { x: 0, y: -20 }, placement: { tile: { x: 1.5, y: 2 }, direction: "south" }, alwaysOn: true };
    expect(printEntity(lamp)).toBe("small-lamp l at (0, -20) tile (1.5, 2) facing south {\n    always-on = true\n}");
    expect(printEntity(lamp, { unit: "\t" })).toBe("small-lamp l at (0, -20) tile (1.5, 2) facing south {\n\talways-on = true\n}");
  });

  it("prints signals canonically", () => {
    expect(printSignal({ kind: "item", name: "iron-plate" })).toBe("item:iron-plate");
    expect(printSignal({ kind: "item", name: "iron-plate", quality: "normal" })).toBe("item:iron-plate");
    expect(printSignal({ kind: "item", name: "iron-plate", quality: "rare" })).toBe("item:iron-plate@rare");
    expect(printSignal({ kind: "item", name: "odd name", quality: 'q"x' })).toBe('item:"odd name"@"q\\"x"');
    expect(printSignal(wildcardSignal("each"))).toBe("each");
    expect(printSignal({ kind: "virtual", name: "signal-anything" })).toBe("anything");
  });

  it("prints a selection of neither network as none and omits the default of both", () => {
    const a: SignalId = { kind: "item", name: "a" };
    const decider: Entity = {
      ...DEFAULT_ENTITY.decider, prototype: "decider-combinator",
      id: "d",
      name: "d",
      position: { x: 0, y: 0 },
      conditions: [{ join: "or", first: a, firstNetworks: NONE, comparator: ">", second: { type: "signal", signal: a, networks: BOTH_NETWORKS } }],
      outputs: [{ signal: a, copyCountFromInput: true, constant: 1, networks: NONE }, { signal: a, copyCountFromInput: true, constant: 1, networks: BOTH_NETWORKS }],
    };
    const arithmetic: Entity = { ...DEFAULT_ENTITY.arithmetic, prototype: "arithmetic-combinator", id: "a", name: "a", position: { x: 0, y: 0 }, first: { type: "signal", signal: a, networks: NONE }, second: { type: "signal", signal: a, networks: { red: false, green: true } }, output: a };
    const lamp: Entity = { ...DEFAULT_ENTITY.lamp, prototype: "small-lamp", id: "l", name: "l", position: { x: 0, y: 0 }, inputNetworks: NONE };
    expect(printEntity(decider)).toBe("decider-combinator d at (0, 0) {\n    when item:a[none] > item:a\n    output item:a = input[none]\n    output item:a = input\n}");
    expect(printEntity(arithmetic)).toBe("arithmetic-combinator a at (0, 0) {\n    item:a = item:a[none] * item:a[green]\n}");
    expect(printEntity(lamp)).toBe("small-lamp l at (0, 0) {\n    networks = none\n}");
    expectRoundTrip({ name: "none", entities: [decider, arithmetic, lamp], wires: [] });
    for (const entity of [decider, arithmetic, lamp]) expect(checkEntity(entity)).toEqual({ ok: true });
  });

  it("writes a condition in use without a signal as 'when unset', for a lamp as for an entity", () => {
    const lamp: Entity = { ...DEFAULT_ENTITY.lamp, prototype: "small-lamp", id: "l", name: "l", position: { x: 0, y: 0 }, condition: UNSET_CONDITION, alwaysOn: true };
    const belt: Entity = { kind: "entity", prototype: "express-transport-belt", id: "b", name: "belt1", position: { x: 0, y: 0 }, settings: { when: UNSET_CONDITION, "logistic-when": UNSET_CONDITION } };
    expect(printEntity(lamp)).toBe("small-lamp l at (0, 0) {\n    when unset\n    always-on = true\n}");
    expect(printEntity(belt)).toBe("express-transport-belt belt1 at (0, 0) {\n    when unset\n    logistic when unset\n}");
    expectRoundTrip({ name: "unset", entities: [lamp, belt], wires: [] });
    for (const entity of [lamp, belt]) expect(checkEntity(entity)).toEqual({ ok: true });
    // A speaker has no switch: its condition is a comparison or none, and the word is not one of its statements.
    const circuits = Array.from({ length: 150 }, (_, index) => new Generator(index + 1).circuit(6));
    const unset = circuits.flatMap((circuit) => circuit.entities).filter((entity) => (entity.kind === "lamp" && entity.condition === UNSET_CONDITION) || (entity.kind === "entity" && Object.values(entity.settings).includes(UNSET_CONDITION)));
    expect(new Set(unset.map((entity) => entity.kind))).toEqual(new Set(["lamp", "entity"]));
    expect(circuits.every((circuit) => !printCircuit({ ...circuit, entities: circuit.entities.filter((entity) => entity.kind === "speaker" || entity.kind === "decider") }).includes("unset"))).toBe(true);
  });

  it("prints numbers without exponent or trailing decimal point", () => {
    expect([1, -0.5, 0, -0, 2.25, 1e21, 1e-7].map(printNumber)).toEqual(["1", "-0.5", "0", "0", "2.25", "1000000000000000000000", "0.0000001"]);
  });

  it("writes wires output first and sections in canonical order", () => {
    const circuit: Circuit = {
      name: "w",
      entities: [
        { ...DEFAULT_ENTITY.constant, prototype: "constant-combinator", id: "c", name: "c", position: { x: 0, y: 0 }, sections: [{ group: "G", active: false, multiplier: -0.5, filters: [{ signal: { kind: "item", name: "a" }, count: 1 }] }] },
        { ...DEFAULT_ENTITY.decider, prototype: "decider-combinator", id: "d", name: "d", position: { x: 240, y: 0 } },
      ],
      wires: [{ color: "green", a: { entity: "d", side: "in" }, b: { entity: "d", side: "out" } }, { color: "red", a: { entity: "c", side: "out" }, b: { entity: "d", side: "in" } }],
    };
    expect(expectRoundTrip(circuit)).toBe(
      'circuit "w" {\n    constant-combinator c at (0, 0) {\n        section "G" {\n            active = false\n            multiplier = -0.5\n            item:a = 1\n        }\n    }\n\n    decider-combinator d at (240, 0) {\n    }\n\n    wire green d.out <-> d.in\n    wire red c.out <-> d.in\n}\n',
    );
  });

  it("round-trips the all-kinds fixture through the model", () => {
    const parsed = valid(fixture("all-kinds.face"));
    expectRoundTrip(parsed.circuit);
  });

  it("round-trips randomized circuits", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const generator = new Generator(seed);
      expectRoundTrip(generator.circuit(generator.int(0, 8)));
    }
  });

  it("accepts every randomized entity as expressible", () => {
    const generator = new Generator(99);
    for (let i = 0; i < 300; i++) expect(checkEntity(generator.entity(generator.pick(ENTITY_KINDS), "e"))).toEqual({ ok: true });
  });
});

describe("checkEntity", () => {
  const base = { id: "x", name: "a", position: { x: 0, y: 0 } };

  it("flags configurations the language cannot express", () => {
    const cases: Entity[] = [
      { ...base, ...DEFAULT_ENTITY.arithmetic, prototype: "arithmetic-combinator", first: { type: "constant", value: 5 } },
      { ...base, ...DEFAULT_ENTITY.lamp, prototype: "small-lamp", useColors: false, colorMode: "components" },
      { ...base, ...DEFAULT_ENTITY.lamp, prototype: "small-lamp", condition: { comparator: ">", second: { type: "constant", value: 1 } } },
      { ...base, ...DEFAULT_ENTITY.decider, prototype: "decider-combinator", conditions: [{ join: "or", firstNetworks: BOTH_NETWORKS, comparator: ">", second: { type: "constant", value: 1 } }] },
      { ...base, ...DEFAULT_ENTITY.decider, prototype: "decider-combinator", outputs: [{ signal: { kind: "item", name: "a" }, copyCountFromInput: true, constant: 5, networks: BOTH_NETWORKS }] },
      { ...base, ...DEFAULT_ENTITY.decider, prototype: "decider-combinator", outputs: [{ signal: { kind: "item", name: "a" }, copyCountFromInput: false, constant: 5, networks: { red: true, green: false } }] },
      { ...base, ...DEFAULT_ENTITY.decider, prototype: "decider-combinator", outputs: [{ signal: { kind: "item", name: "a" }, copyCountFromInput: false, constant: 5, networks: NONE }] },
      { ...base, ...DEFAULT_ENTITY.selector, prototype: "selector-combinator", mode: { operation: "select", max: true, index: { type: "signal", signal: { kind: "item", name: "a" }, networks: NONE }, indexComparator: "=" } },
      { ...base, ...DEFAULT_ENTITY.lamp, prototype: "small-lamp", position: { x: 0.5, y: 0 } },
    ];
    for (const entity of cases) expect(checkEntity(entity)).toMatchObject({ ok: false, code: "unrepresentable" });
  });

  it("flags invalid entities", () => {
    expect(checkEntity({ ...base, name: "wire", ...DEFAULT_ENTITY.lamp, prototype: "small-lamp" })).toMatchObject({ ok: false, code: "invalid-entity" });
    expect(checkEntity({ ...base, ...DEFAULT_ENTITY.constant, prototype: "constant-combinator", sections: [{ active: true, multiplier: 1, filters: [{ signal: wildcardSignal("each"), count: 1 }] }] })).toMatchObject({ ok: false, code: "invalid-entity" });
    expect(checkEntity({ ...base, ...DEFAULT_ENTITY.constant, prototype: "constant-combinator", sections: [{ active: true, multiplier: 1, filters: [{ signal: { kind: "item", name: "a" }, count: 2 ** 40 }] }] })).toMatchObject({ ok: false, code: "invalid-entity" });
  });
});
