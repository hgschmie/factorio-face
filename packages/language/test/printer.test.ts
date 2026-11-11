import { BOTH_NETWORKS, DEFAULT_ENTITY, ENTITY_KINDS, wildcardSignal, type Circuit, type Entity } from "@face/model";
import { describe, expect, it } from "vitest";
import { analyze, checkEntity, printCircuit, printEntity, printNumber, printSignal } from "../src/index.ts";
import { fixture, Generator, portable, valid } from "./helpers.ts";

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
    const entities = ENTITY_KINDS.map((kind, i) => ({ ...DEFAULT_ENTITY[kind], id: `i${i}`, name: `${kind}1`, position: { x: i * 240, y: 0 } }) as Entity);
    const printed = expectRoundTrip({ name: "defaults", entities, wires: [] });
    expect(printed).toContain("    constant constant1 at (0, 0) {\n    }\n");
    expect(printed).toContain("    selector selector1 at (720, 0) {\n        operation = select\n    }\n");
  });

  it("prints one entity starting in column 0 with a configurable indent", () => {
    const lamp: Entity = { ...DEFAULT_ENTITY.lamp, id: "x", name: "l", position: { x: 0, y: -20 }, placement: { tile: { x: 1.5, y: 2 }, direction: "south" }, alwaysOn: true };
    expect(printEntity(lamp)).toBe("lamp l at (0, -20) tile (1.5, 2) facing south {\n    always-on = true\n}");
    expect(printEntity(lamp, { unit: "\t" })).toBe("lamp l at (0, -20) tile (1.5, 2) facing south {\n\talways-on = true\n}");
  });

  it("prints signals canonically", () => {
    expect(printSignal({ kind: "item", name: "iron-plate" })).toBe("item:iron-plate");
    expect(printSignal({ kind: "item", name: "iron-plate", quality: "normal" })).toBe("item:iron-plate");
    expect(printSignal({ kind: "item", name: "iron-plate", quality: "rare" })).toBe("item:iron-plate@rare");
    expect(printSignal({ kind: "item", name: "odd name", quality: 'q"x' })).toBe('item:"odd name"@"q\\"x"');
    expect(printSignal(wildcardSignal("each"))).toBe("each");
    expect(printSignal({ kind: "virtual", name: "signal-anything" })).toBe("anything");
  });

  it("prints numbers without exponent or trailing decimal point", () => {
    expect([1, -0.5, 0, -0, 2.25, 1e21, 1e-7].map(printNumber)).toEqual(["1", "-0.5", "0", "0", "2.25", "1000000000000000000000", "0.0000001"]);
  });

  it("writes wires output first and sections in canonical order", () => {
    const circuit: Circuit = {
      name: "w",
      entities: [
        { ...DEFAULT_ENTITY.constant, id: "c", name: "c", position: { x: 0, y: 0 }, sections: [{ group: "G", active: false, multiplier: -0.5, filters: [{ signal: { kind: "item", name: "a" }, count: 1 }] }] },
        { ...DEFAULT_ENTITY.decider, id: "d", name: "d", position: { x: 240, y: 0 } },
      ],
      wires: [{ color: "green", a: { entity: "d", side: "in" }, b: { entity: "d", side: "out" } }, { color: "red", a: { entity: "c", side: "out" }, b: { entity: "d", side: "in" } }],
    };
    expect(expectRoundTrip(circuit)).toBe(
      'circuit "w" {\n    constant c at (0, 0) {\n        section "G" {\n            active = false\n            multiplier = -0.5\n            item:a = 1\n        }\n    }\n\n    decider d at (240, 0) {\n    }\n\n    wire green d.out <-> d.in\n    wire red c.out <-> d.in\n}\n',
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
      { ...base, ...DEFAULT_ENTITY.arithmetic, first: { type: "constant", value: 5 } },
      { ...base, ...DEFAULT_ENTITY.lamp, useColors: false, colorMode: "components" },
      { ...base, ...DEFAULT_ENTITY.lamp, inputNetworks: { red: false, green: false } },
      { ...base, ...DEFAULT_ENTITY.lamp, condition: { comparator: ">", second: { type: "constant", value: 1 } } },
      { ...base, ...DEFAULT_ENTITY.decider, conditions: [{ join: "or", firstNetworks: BOTH_NETWORKS, comparator: ">", second: { type: "constant", value: 1 } }] },
      { ...base, ...DEFAULT_ENTITY.decider, outputs: [{ signal: { kind: "item", name: "a" }, copyCountFromInput: true, constant: 5, networks: BOTH_NETWORKS }] },
      { ...base, ...DEFAULT_ENTITY.decider, outputs: [{ signal: { kind: "item", name: "a" }, copyCountFromInput: false, constant: 5, networks: { red: true, green: false } }] },
      { ...base, ...DEFAULT_ENTITY.lamp, position: { x: 0.5, y: 0 } },
    ];
    for (const entity of cases) expect(checkEntity(entity)).toMatchObject({ ok: false, code: "unrepresentable" });
  });

  it("flags invalid entities", () => {
    expect(checkEntity({ ...base, name: "wire", ...DEFAULT_ENTITY.lamp })).toMatchObject({ ok: false, code: "invalid-entity" });
    expect(checkEntity({ ...base, ...DEFAULT_ENTITY.constant, sections: [{ active: true, multiplier: 1, filters: [{ signal: wildcardSignal("each"), count: 1 }] }] })).toMatchObject({ ok: false, code: "invalid-entity" });
    expect(checkEntity({ ...base, ...DEFAULT_ENTITY.constant, sections: [{ active: true, multiplier: 1, filters: [{ signal: { kind: "item", name: "a" }, count: 2 ** 40 }] }] })).toMatchObject({ ok: false, code: "invalid-entity" });
  });
});
