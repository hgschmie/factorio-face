import { BOTH_NETWORKS, DEFAULT_ENTITY, SELECTOR_OPERATIONS, wildcardSignal, wireKey, type Entity, type SelectorCombinator, type SignalId } from "@face/model";
import { describe, expect, it } from "vitest";
import { analyze, analyzeFragment, DIAGNOSTIC_SEVERITY, type DiagnosticCode, type SignalResolver } from "../src/index.ts";
import { circuit, codes, fixture, idOf, valid } from "./helpers.ts";

const RED = { red: true, green: false };
const GREEN = { red: false, green: true };
const NONE = { red: false, green: false };
const A: SignalId = { kind: "virtual", name: "signal-A" };
const B: SignalId = { kind: "virtual", name: "signal-B" };

function entity<K extends Entity["kind"]>(declaration: string, kind: K): Extract<Entity, { kind: K }> {
  const result = valid(circuit(declaration));
  const found = result.circuit.entities[0]!;
  expect(found.kind).toBe(kind);
  return found as Extract<Entity, { kind: K }>;
}

function report(source: string): [DiagnosticCode, string][] {
  return analyze(source).diagnostics.map((d) => [d.code, source.slice(d.from, d.to)]);
}

describe("spec example", () => {
  const source = fixture("example.face");
  const result = valid(source);

  it("produces the documented circuit", () => {
    expect(result.diagnostics).toEqual([]);
    expect(result.source).toBe(source);
    expect(result.circuit.name).toBe("Feedback example");
    expect(result.circuit.entities.map((e) => [e.id, e.kind, e.name, e.position])).toEqual([
      ["e1", "constant", "source", { x: 40, y: 80 }],
      ["e2", "decider", "gate", { x: 300, y: 80 }],
      ["e3", "arithmetic", "twice", { x: 300, y: 240 }],
      ["e4", "lamp", "light", { x: 560, y: 80 }],
    ]);
    expect(result.circuit.wires).toEqual([
      { color: "red", a: { entity: "e1", side: "out" }, b: { entity: "e2", side: "in" } },
      { color: "green", a: { entity: "e2", side: "in" }, b: { entity: "e2", side: "out" } },
      { color: "red", a: { entity: "e2", side: "out" }, b: { entity: "e3", side: "in" } },
      { color: "green", a: { entity: "e3", side: "out" }, b: { entity: "e4", side: "in" } },
    ]);
  });

  it("copies the version option", () => {
    expect(analyze(source, undefined, { version: 7 }).version).toBe(7);
    expect("version" in result).toBe(false);
  });
});

describe("constant combinator", () => {
  it("collects bare filters into one anonymous section", () => {
    const c = entity('constant c { item:iron-plate = 5 fluid:water = -3 item:"odd name"@"odd quality" = 0x10 virtual:signal-A@normal = 0 }', "constant");
    expect(c.enabled).toBe(true);
    expect(c.sections).toEqual([
      {
        active: true,
        multiplier: 1,
        filters: [
          { signal: { kind: "item", name: "iron-plate" }, count: 5 },
          { signal: { kind: "fluid", name: "water" }, count: -3 },
          { signal: { kind: "item", name: "odd name", quality: "odd quality" }, count: 16 },
          { signal: A, count: 0 },
        ],
      },
    ]);
  });

  it("reads enabled, description and an empty body", () => {
    expect(entity('constant c { enabled = false description = "a\\nb \\"q\\"" }', "constant")).toMatchObject({ enabled: false, description: 'a\nb "q"', sections: [] });
    expect(entity("constant c { }", "constant").sections).toEqual([]);
  });

  it("reads sections with group, active and decimal multiplier", () => {
    const c = entity('constant c { section "Ore" { active = false multiplier = -0.5 item:a = 1 } section { item:a = 2 multiplier = 3 } section "" { } }', "constant");
    expect(c.sections).toEqual([
      { group: "Ore", active: false, multiplier: -0.5, filters: [{ signal: { kind: "item", name: "a" }, count: 1 }] },
      { active: true, multiplier: 3, filters: [{ signal: { kind: "item", name: "a" }, count: 2 }] },
      { group: "", active: true, multiplier: 1, filters: [] },
    ]);
  });

  it("accepts every signal kind", () => {
    const c = entity("constant c { item:a = 1 fluid:a = 1 virtual:a = 1 entity:a = 1 recipe:a = 1 space-location:a = 1 asteroid-chunk:a = 1 quality:a = 1 custom:a = 1 }", "constant");
    expect(c.sections[0]!.filters.map((f) => f.signal.kind)).toEqual(["item", "fluid", "virtual", "entity", "recipe", "space-location", "asteroid-chunk", "quality", "custom"]);
  });
});

describe("arithmetic combinator", () => {
  it.each(["*", "/", "+", "-", "%", "^", "<<", ">>", "AND", "OR", "XOR"] as const)("parses operation %s", (operation) => {
    const a = entity(`arithmetic a { virtual:signal-B = virtual:signal-A[red] ${operation} -2 }`, "arithmetic");
    expect(a).toMatchObject({ output: B, first: { type: "signal", signal: A, networks: RED }, operation, second: { type: "constant", value: -2 } });
  });

  it("supports each on both sides and network selections", () => {
    const a = entity("arithmetic a { each = each[red] * each[green] }", "arithmetic");
    expect(a).toMatchObject({ output: wildcardSignal("each"), first: { signal: wildcardSignal("each"), networks: RED }, second: { signal: wildcardSignal("each"), networks: GREEN } });
    expect(entity("arithmetic a { virtual:signal-B = 7 - each }", "arithmetic").second).toEqual({ type: "signal", signal: wildcardSignal("each"), networks: BOTH_NETWORKS });
    expect(entity("arithmetic a { virtual:signal-B = virtual:signal-A[none] + each[none] }", "arithmetic")).toMatchObject({ first: { signal: A, networks: NONE }, second: { signal: wildcardSignal("each"), networks: NONE } });
  });

  it("uses model defaults when unconfigured", () => {
    expect(entity("arithmetic a { }", "arithmetic")).toEqual({ id: "e1", name: "a", position: { x: 40, y: 40 }, ...DEFAULT_ENTITY.arithmetic });
  });

  it("normalizes the literal wildcard form", () => {
    expect(entity("arithmetic a { virtual:signal-each = virtual:signal-each + 1 }", "arithmetic").output).toEqual(wildcardSignal("each"));
  });
});

describe("decider combinator", () => {
  it("parses conditions, joins, networks, outputs and else outputs in order", () => {
    const d = entity(
      `decider d {
        when each > 5 and virtual:signal-A[red] != virtual:signal-B[green] or anything <= -1 or everything = 0
        output each = input[red]
        output virtual:signal-A = 7
        else output virtual:signal-B = input
        output everything = input[green]
        else output anything = 1
      }`,
      "decider",
    );
    expect(d.conditions).toEqual([
      { join: "or", first: wildcardSignal("each"), firstNetworks: BOTH_NETWORKS, comparator: ">", second: { type: "constant", value: 5 } },
      { join: "and", first: A, firstNetworks: RED, comparator: "!=", second: { type: "signal", signal: B, networks: GREEN } },
      { join: "or", first: wildcardSignal("anything"), firstNetworks: BOTH_NETWORKS, comparator: "<=", second: { type: "constant", value: -1 } },
      { join: "or", first: wildcardSignal("everything"), firstNetworks: BOTH_NETWORKS, comparator: "=", second: { type: "constant", value: 0 } },
    ]);
    expect(d.outputs).toEqual([
      { signal: wildcardSignal("each"), copyCountFromInput: true, constant: 1, networks: RED },
      { signal: A, copyCountFromInput: false, constant: 7, networks: BOTH_NETWORKS },
      { signal: wildcardSignal("everything"), copyCountFromInput: true, constant: 1, networks: GREEN },
    ]);
    expect(d.elseOutputs).toEqual([
      { signal: B, copyCountFromInput: true, constant: 1, networks: BOTH_NETWORKS },
      { signal: wildcardSignal("anything"), copyCountFromInput: false, constant: 1, networks: BOTH_NETWORKS },
    ]);
  });

  it("reads [none] as a signal taken from neither network", () => {
    const d = entity("decider d { when virtual:signal-A[none] > virtual:signal-B[none] and each[none] = 0 output each = input[none] else output virtual:signal-B = input[none] }", "decider");
    expect(d.conditions).toEqual([
      { join: "or", first: A, firstNetworks: NONE, comparator: ">", second: { type: "signal", signal: B, networks: NONE } },
      { join: "and", first: wildcardSignal("each"), firstNetworks: NONE, comparator: "=", second: { type: "constant", value: 0 } },
    ]);
    expect(d.outputs).toEqual([{ signal: wildcardSignal("each"), copyCountFromInput: true, constant: 1, networks: NONE }]);
    expect(d.elseOutputs).toEqual([{ signal: B, copyCountFromInput: true, constant: 1, networks: NONE }]);
  });

  it.each(["<", ">", "=", "!=", "<=", ">="] as const)("parses comparator %s", (comparator) => {
    expect(entity(`decider d { when virtual:signal-A ${comparator} 1 output virtual:signal-A = 1 }`, "decider").conditions[0]!.comparator).toBe(comparator);
  });
});

describe("selector combinator", () => {
  const mode = (body: string) => entity(`selector s { ${body} }`, "selector").mode;

  it("defaults to select", () => {
    expect(mode("")).toEqual(DEFAULT_ENTITY.selector.mode);
    expect(mode("operation = select")).toEqual({ operation: "select", max: true, index: { type: "constant", value: 0 }, indexComparator: "=" });
  });

  it("parses every operation with its properties", () => {
    expect(mode("operation = select order = min index = virtual:signal-A index-comparator = >=")).toEqual({ operation: "select", max: false, index: { type: "signal", signal: A, networks: BOTH_NETWORKS }, indexComparator: ">=" });
    expect(mode("index = -3 operation = select order = max index-comparator = =")).toEqual({ operation: "select", max: true, index: { type: "constant", value: -3 }, indexComparator: "=" });
    expect(mode("operation = count")).toEqual({ operation: "count" });
    expect(mode("operation = count output = virtual:signal-A")).toEqual({ operation: "count", output: A });
    expect(mode("operation = random")).toEqual({ operation: "random", interval: 0 });
    expect(mode("interval = 60 operation = random")).toEqual({ operation: "random", interval: 60 });
    expect(mode("operation = stack-size")).toEqual({ operation: "stack-size" });
    expect(mode("operation = rocket-capacity")).toEqual({ operation: "rocket-capacity" });
    expect(mode("operation = quality-filter")).toEqual({ operation: "quality-filter", comparator: "=" });
    expect(mode('operation = quality-filter quality = rare comparator = !=')).toEqual({ operation: "quality-filter", comparator: "!=", quality: "rare" });
    expect(mode('operation = quality-filter quality = "odd quality"')).toEqual({ operation: "quality-filter", comparator: "=", quality: "odd quality" });
    expect(mode("operation = quality-select")).toEqual({ operation: "quality-select", highest: true });
    expect(mode("operation = quality-select order = lowest")).toEqual({ operation: "quality-select", highest: false });
    expect(mode("operation = quality-transfer")).toEqual({ operation: "quality-transfer", source: { type: "quality", quality: "normal" } });
    expect(mode("operation = quality-transfer source = legendary destination = each")).toEqual({ operation: "quality-transfer", source: { type: "quality", quality: "legendary" }, destination: wildcardSignal("each") });
    expect(mode('operation = quality-transfer source = "signal"')).toEqual({ operation: "quality-transfer", source: { type: "quality", quality: "signal" } });
    expect(mode("operation = quality-transfer source = signal")).toEqual({ operation: "quality-transfer", source: { type: "signal" } });
    expect(mode("operation = quality-transfer source = signal source-signal = virtual:signal-A destination = virtual:signal-B")).toEqual({ operation: "quality-transfer", source: { type: "signal", signal: A }, destination: B });
    expect(mode("operation = time")).toEqual({ operation: "time" });
    expect(mode("operation = time day-length = virtual:signal-A day-tick = virtual:signal-B game-tick = virtual:signal-A")).toEqual({ operation: "time", dayLength: A, dayTick: B, gameTick: A });
  });

  it("covers all operations of the model", () => {
    const parsed = valid(fixture("all-kinds.face")).circuit.entities.filter((e): e is SelectorCombinator => e.kind === "selector").map((e) => e.mode.operation);
    expect([...new Set(parsed)].sort()).toEqual([...SELECTOR_OPERATIONS].sort());
  });
});

describe("lamp", () => {
  it("uses defaults for an empty lamp", () => {
    expect(entity("lamp l { }", "lamp")).toEqual({ id: "e1", name: "l", position: { x: 40, y: 40 }, ...DEFAULT_ENTITY.lamp });
  });

  it("parses the condition and every property", () => {
    const l = entity(
      "lamp l { when anything > virtual:signal-A networks = green always-on = true colors = packed-rgb red = virtual:signal-A green = virtual:signal-B blue = item:x rgb = item:y@rare color = #FF8000 }",
      "lamp",
    );
    expect(l).toMatchObject({
      condition: { first: wildcardSignal("anything"), comparator: ">", second: { type: "signal", signal: A } },
      inputNetworks: GREEN,
      alwaysOn: true,
      useColors: true,
      colorMode: "packed-rgb",
      redSignal: A,
      greenSignal: B,
      blueSignal: { kind: "item", name: "x" },
      rgbSignal: { kind: "item", name: "y", quality: "rare" },
      color: { r: 255, g: 128, b: 0 },
    });
    expect(entity("lamp l { when everything <= -5 networks = red colors = mapping }", "lamp")).toMatchObject({ condition: { second: { type: "constant", value: -5 } }, inputNetworks: RED, useColors: true, colorMode: "mapping" });
  });

  it("reads no input network from networks = none", () => {
    expect(entity("lamp l { networks = none }", "lamp").inputNetworks).toEqual(NONE);
    // The word has this meaning only as the value of `networks`; a lamp may still be called none.
    expect(entity("lamp none { networks = none always-on = true }", "lamp")).toMatchObject({ name: "none", inputNetworks: NONE, alwaysOn: true });
  });
});

describe("header clauses and placement", () => {
  it("reads at, tile and facing", () => {
    expect(entity("lamp l at (-40, 60) tile (1.5, -2) facing west { }", "lamp")).toMatchObject({ position: { x: -40, y: 60 }, placement: { tile: { x: 1.5, y: -2 }, direction: "west" } });
    expect(entity("lamp l facing north { }", "lamp").placement).toEqual({ direction: "north" });
    expect("placement" in entity("lamp l { }", "lamp")).toBe(false);
  });

  it("auto-places entities without a position on free grid slots", () => {
    const result = valid(circuit("lamp a { }\nlamp fixed at (40, 40) { }\nlamp b { }\nlamp c at (300, 100) { }\nlamp d { }\n" + Array.from({ length: 20 }, (_, i) => `lamp x${i} { }`).join("\n")));
    const positions = result.circuit.entities.map((e) => e.position);
    expect(positions.slice(0, 5)).toEqual([{ x: 520, y: 40 }, { x: 40, y: 40 }, { x: 760, y: 40 }, { x: 300, y: 100 }, { x: 1000, y: 40 }]);
    for (const p of positions) expect([p.x % 20, p.y % 20]).toEqual([0, 0]);
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) expect(Math.abs(positions[i]!.x - positions[j]!.x) >= 200 || Math.abs(positions[i]!.y - positions[j]!.y) >= 120).toBe(true);
    }
    expect(valid(result.source).circuit.entities.map((e) => e.position)).toEqual(positions);
  });
});

describe("wires", () => {
  it("resolves forward references and normalizes direction", () => {
    const result = valid(circuit("wire red b.in <-> a.out\nconstant a { item:x = 1 }\nlamp b { }"));
    expect(result.circuit.wires).toEqual([{ color: "red", a: { entity: "e1", side: "out" }, b: { entity: "e2", side: "in" } }]);
  });

  it("collapses duplicate and reversed declarations into one wire and keeps all declarations in the source map", () => {
    const source = circuit("arithmetic a { }\nlamp b { }\nwire green a.out <-> b.in\nwire green a.out <-> b.in // duplicate\nwire green b.in <-> a.out // reversed\nwire red a.out <-> b.in\nwire green a.in <-> b.in");
    const result = analyze(source);
    expect(result.hasErrors).toBe(false);
    expect(result.circuit!.wires).toHaveLength(3);
    const key = wireKey({ color: "green", a: { entity: "e1", side: "out" }, b: { entity: "e2", side: "in" } });
    const declarations = result.sourceMap.wires.get(key)!.declarations;
    expect(declarations.map((d) => source.slice(d.range.from, d.range.to))).toEqual(["wire green a.out <-> b.in", "wire green a.out <-> b.in", "wire green b.in <-> a.out"]);
    expect(declarations[2]!.a).toMatchObject({ entity: "e2", side: "in" });
    expect(source.slice(declarations[2]!.b.nameRange.from, declarations[2]!.b.nameRange.to)).toBe("a");
    expect(result.diagnostics.filter((d) => d.code === "duplicate-wire").map((d) => [d.severity, d.message.split(" ")[0]])).toEqual([["warning", "Duplicate"], ["warning", "Reversed"]]);
    expect([...result.sourceMap.wires.keys()]).toEqual(result.circuit!.wires.map(wireKey));
  });

  it("allows feedback between different terminals of one entity", () => {
    expect(valid(circuit("decider d { }\nwire red d.out <-> d.in")).circuit.wires).toHaveLength(1);
  });
});

describe("diagnostics", () => {
  const seen = new Set<string>();
  const expectCodes = (source: string, expected: DiagnosticCode[]) => {
    const result = analyze(source);
    expect(result.diagnostics.map((d) => d.code)).toEqual(expected);
    for (const d of result.diagnostics) {
      expect(d.severity).toBe(DIAGNOSTIC_SEVERITY[d.code]);
      expect(d.message.length).toBeGreaterThan(5);
      expect(d.from <= d.to).toBe(true);
      seen.add(d.code);
    }
    expect(result.hasErrors).toBe(expected.some((code) => DIAGNOSTIC_SEVERITY[code] === "error"));
    expect(result.circuit === undefined).toBe(result.hasErrors);
  };

  it("syntax-error", () => {
    expectCodes('circuit "x" { lamp }', ["syntax-error"]);
    expectCodes(circuit("lamp a { when virtual:signal-A[red] > 1 }"), ["syntax-error"]);
    expectCodes(circuit("lamp a { when virtual:signal-A[none] > 1 }"), ["syntax-error"]);
    expectCodes(circuit("decider a { when each[both] > 1 output each = 1 }"), ["syntax-error"]);
    expectCodes(circuit("decider a { when each > 1 output each = 1[none] }"), ["syntax-error"]);
    expectCodes(circuit("lamp a { when virtual:signal-A > 1 and virtual:signal-B > 2 }"), ["syntax-error"]);
    expectCodes(circuit("arithmetic a { virtual:signal-A[red] = 1 + 1 }"), ["syntax-error"]);
    expectCodes(circuit("decider a { when each > 1 output each[red] = 1 }"), ["syntax-error"]);
    expectCodes(circuit("constant a { item:x[red] = 1 }"), ["syntax-error"]);
  });

  it("unsupported-feature", () => {
    expectCodes('import "x"\ncircuit "x" { }', ["unsupported-feature"]);
    expectCodes(circuit("component c { }"), ["unsupported-feature"]);
    expectCodes(circuit("port p"), ["unsupported-feature"]);
  });

  it("duplicate-entity", () => {
    const source = circuit("lamp a { }\nconstant a { item:x = 1 }");
    expectCodes(source, ["duplicate-entity"]);
    expect(report(source)).toEqual([["duplicate-entity", "a"]]);
    expect(analyze(source).diagnostics[0]!.from).toBe(source.lastIndexOf(" a ") + 1);
  });

  it("unknown-entity, unknown-terminal, invalid-terminal, self-wire", () => {
    expect(report(circuit("lamp a { }\nwire red nope.out <-> a.in"))).toEqual([["unknown-entity", "nope"]]);
    expect(report(circuit("lamp a { }\ndecider d { when each > 1 output each = 1 }\nwire red d.middle <-> a.in"))).toEqual([["unknown-terminal", "middle"]]);
    expect(report(circuit("lamp a { }\nconstant c { item:x = 1 }\nwire red c.in <-> a.out"))).toEqual([["invalid-terminal", "c.in"], ["invalid-terminal", "a.out"]]);
    expect(report(circuit("lamp a { }\nwire red a.in <-> a.in"))).toEqual([["self-wire", "wire red a.in <-> a.in"]]);
    expectCodes(circuit("lamp a { }\nwire red nope.out <-> a.in"), ["unknown-entity"]);
    expectCodes(circuit("lamp a { }\nwire red a.side <-> a.in"), ["unknown-terminal"]);
    expectCodes(circuit("lamp a { }\nwire red a.out <-> a.in"), ["invalid-terminal"]);
    expectCodes(circuit("lamp a { }\nwire red a.in <-> a.in"), ["self-wire"]);
  });

  it("integer-range", () => {
    expectCodes(circuit("constant c { item:x = 2147483648 }"), ["integer-range"]);
    expectCodes(circuit("constant c { item:x = -2147483649 }"), ["integer-range"]);
    expectCodes(circuit("constant c { item:x = 0x80000000 }"), ["integer-range"]);
    expectCodes(circuit("constant c { item:x = 99999999999999999999999999 }"), ["integer-range"]);
    expectCodes(circuit("lamp l at (3000000000, 0) { }"), ["integer-range"]);
    expectCodes(circuit("selector s { operation = random interval = 4294967296 }"), ["integer-range"]);
    expectCodes(circuit("constant c { item:x = 2147483647 item:y = -2147483648 item:z = 0x7fffffff }"), []);
  });

  it("illegal-wildcard", () => {
    expectCodes(circuit("constant c { each = 1 }"), ["illegal-wildcard"]);
    expectCodes(circuit("constant c { virtual:signal-everything = 1 }"), ["illegal-wildcard"]);
    expectCodes(circuit("arithmetic a { each = virtual:signal-A + 1 }"), ["illegal-wildcard"]);
    expectCodes(circuit("arithmetic a { virtual:signal-A = anything + 1 }"), ["illegal-wildcard"]);
    expectCodes(circuit("arithmetic a { everything = each + 1 }"), ["illegal-wildcard"]);
    expectCodes(circuit("decider d { when virtual:signal-A > 1 output each = 1 }"), ["illegal-wildcard"]);
    expectCodes(circuit("decider d { when virtual:signal-A > 1 else output each = input }"), ["illegal-wildcard"]);
    expectCodes(circuit("lamp l { when each > 1 }"), ["illegal-wildcard"]);
    expectCodes(circuit("lamp l { when virtual:signal-A > anything }"), ["illegal-wildcard"]);
    expectCodes(circuit("lamp l { red = each }"), ["illegal-wildcard"]);
    expectCodes(circuit("selector s { index = each }"), ["illegal-wildcard"]);
    expectCodes(circuit("selector s { operation = quality-transfer destination = anything }"), ["illegal-wildcard"]);
  });

  it("duplicate-statement", () => {
    expectCodes(circuit("decider d { when each > 1 when each < 5 output each = 1 }"), ["duplicate-statement"]);
    expectCodes(circuit("arithmetic a { virtual:signal-A = 1 + 1 virtual:signal-B = 2 + 2 }"), ["duplicate-statement"]);
    expectCodes(circuit("constant c { enabled = true enabled = false item:x = 1 }"), ["duplicate-statement"]);
    expectCodes(circuit("constant c { section { active = true active = true } }"), ["duplicate-statement"]);
    expectCodes(circuit("lamp l { when virtual:signal-A > 1 when virtual:signal-A > 2 }"), ["duplicate-statement"]);
  });

  it("duplicate-signal", () => {
    expect(report(circuit("constant c { item:x = 1 item:y = 2 item:x = 3 }"))).toEqual([["duplicate-signal", "item:x"]]);
    expectCodes(circuit("constant c { item:x = 1 item:x@normal = 3 }"), ["duplicate-signal"]);
    expectCodes(circuit("constant c { section { item:x = 1 item:x = 3 } }"), ["duplicate-signal"]);
    expectCodes(circuit("constant c { section { item:x = 1 item:x@rare = 3 } section { item:x = 3 } }"), []);
  });

  it("contradictory-statement", () => {
    expectCodes(circuit("constant c { item:x = 1 section { item:y = 1 } }"), ["contradictory-statement"]);
    expectCodes(circuit("selector s { operation = count interval = 5 }"), ["contradictory-statement"]);
    expectCodes(circuit("selector s { order = highest }"), ["invalid-value"]);
    expectCodes(circuit("selector s { interval = 5 }"), ["contradictory-statement"]);
    expectCodes(circuit("selector s { operation = quality-transfer source = rare source-signal = item:x }"), ["contradictory-statement"]);
  });

  it("invalid-statement", () => {
    expectCodes(circuit("constant c { when virtual:signal-A > 1 item:x = 1 }"), ["invalid-statement"]);
    expectCodes(circuit("constant c { output virtual:signal-A = 1 item:x = 1 }"), ["invalid-statement"]);
    expectCodes(circuit("arithmetic a { section { } virtual:signal-A = 1 + 1 }"), ["invalid-statement"]);
    expectCodes(circuit("selector s { item:x = 1 }"), ["invalid-statement"]);
    expectCodes(circuit("lamp l { output virtual:signal-A = 1 }"), ["invalid-statement"]);
    expectCodes(circuit("lamp l { virtual:signal-A = 1 }"), ["invalid-statement"]);
    expectCodes(circuit("decider d { virtual:signal-A = 1 when each > 1 output each = 1 }"), ["invalid-statement"]);
  });

  it("unknown-property", () => {
    expect(report(circuit("lamp l { brightness = 5 }"))).toEqual([["unknown-property", "brightness"]]);
    expectCodes(circuit("constant c { item:x = 1 always-on = true }"), ["unknown-property"]);
    expectCodes(circuit("constant c { section { enabled = true } }"), ["unknown-property"]);
    expectCodes(circuit("constant c { item:x = 1 active = true }"), ["unknown-property"]);
    expectCodes(circuit("decider d { output = virtual:signal-A when each > 1 output each = 1 }"), ["unknown-property"]);
  });

  it("invalid-value", () => {
    expectCodes(circuit("selector s { operation = bogus }"), ["invalid-value"]);
    expectCodes(circuit("lamp l { colors = rainbow }"), ["invalid-value"]);
    expectCodes(circuit("lamp l { always-on = 1 }"), ["invalid-value"]);
    expectCodes(circuit("lamp l { color = #12 }"), ["invalid-value"]);
    expectCodes(circuit("lamp l { color = red }"), ["invalid-value"]);
    expectCodes(circuit("lamp l { description = plain }"), ["invalid-value"]);
    expectCodes(circuit("lamp l { networks = both }"), ["invalid-value"]);
    expectCodes(circuit("lamp l at (1.5, 2) { }"), ["invalid-value"]);
    expectCodes(circuit("constant c { item:x = item:y }"), ["invalid-value"]);
    expectCodes(circuit("constant c { item:x = 1 + 2 }"), ["invalid-value"]);
    expectCodes(circuit("selector s { operation = random interval = 1.5 }"), ["invalid-value"]);
    expectCodes(circuit("selector s { index-comparator = max }"), ["invalid-value"]);
    expectCodes(circuit('selector s { operation = quality-filter quality = "" }'), ["invalid-value"]);
    expectCodes(circuit("constant c { section { multiplier = true } }"), ["invalid-value"]);
  });

  it("invalid-signal", () => {
    expect(report(circuit("constant c { bogus:thing = 1 }"))).toEqual([["invalid-signal", "bogus:thing"]]);
    expectCodes(circuit("constant c { item: = 1 }"), ["invalid-signal"]);
    expectCodes(circuit("constant c { item:x@ = 1 }"), ["invalid-signal"]);
    expectCodes(circuit('constant c { item:"" = 1 }'), ["invalid-signal"]);
    expectCodes(circuit("lamp l { red = nope:x }"), ["invalid-signal"]);
  });

  it("duplicate-wire", () => {
    expectCodes(circuit("decider a { when each > 1 output each = 1 }\nwire red a.out <-> a.in\nwire red a.in <-> a.out"), ["duplicate-wire"]);
  });

  it("unknown-signal and disabled-signal come from the injected resolver only", () => {
    const signals: SignalResolver = { status: (id) => (id.name === "missing" ? "unknown" : id.name === "off" || id.name === "epic" ? "disabled" : "known") };
    const source = circuit("constant c { item:ok = 1 item:missing = 2 item:off@rare = 3 }\narithmetic a { each = each + fluid:missing }\nselector s { operation = quality-filter quality = epic }");
    expect(analyze(source).diagnostics).toEqual([]);
    const result = analyze(source, undefined, { signals });
    expect(result.diagnostics.map((d) => [d.code, d.severity, source.slice(d.from, d.to)])).toEqual([
      ["unknown-signal", "warning", "item:missing"],
      ["disabled-signal", "warning", "item:off@rare"],
      ["unknown-signal", "warning", "fluid:missing"],
      ["disabled-signal", "warning", "epic"],
    ]);
    expect(result.circuit).toBeDefined();
    for (const d of result.diagnostics) seen.add(d.code);
  });

  it("unconfigured", () => {
    expect(report(circuit("arithmetic a { }\ndecider d { }\nconstant c { }\ndecider e { when each > 1 }"))).toEqual([["unconfigured", "a"], ["unconfigured", "d"], ["unconfigured", "c"], ["unconfigured", "e"]]);
    expectCodes(circuit("arithmetic a { }"), ["unconfigured"]);
    expectCodes(circuit("lamp l { }\nselector s { }\nconstant c { section { } }"), []);
  });

  it("unused-else-output", () => {
    expectCodes(circuit("decider d { else output virtual:signal-A = 1 }"), ["unconfigured", "unused-else-output"]);
    expect(codes(circuit("decider d { when each > 1 else output virtual:signal-A = 1 }"))).toEqual([]);
  });

  it("tile-off-grid", () => {
    // 1x1: both coordinates end in .5, whatever the direction.
    expectCodes(circuit("constant c tile (0.5, -1.5) { item:a = 1 }\nconstant d tile (2.5, 0.5) facing north { item:a = 1 }\nlamp l tile (-3.5, 7.5) { }"), []);
    expect(report(circuit("lamp l tile (1, 2.5) { }\nconstant c tile (4.5, 0.25) facing south { item:a = 1 }"))).toEqual([["tile-off-grid", "tile (1, 2.5)"], ["tile-off-grid", "tile (4.5, 0.25)"]]);
    // 2x1: the half moves to the other axis with the direction; without a clause the entity faces east.
    const long = (header: string) => circuit(`decider d ${header} { when each > 1 output each = 1 }`);
    for (const header of ["tile (1, 0.5)", "tile (1, 0.5) facing east", "tile (-3, 0.5) facing west", "tile (0.5, 1) facing north", "tile (6.5, -21) facing south"]) expectCodes(long(header), []);
    for (const header of ["tile (0.5, 1)", "tile (0.5, 0.5) facing east", "tile (1, 0.5) facing north", "tile (1, 1) facing south", "tile (1.5, 0.5) facing west"]) expectCodes(long(header), ["tile-off-grid"]);
    for (const kind of ["arithmetic", "selector"]) expect(codes(circuit(`${kind} x tile (0.5, 0.5) { }`))).toContain("tile-off-grid");
    // The message says what the kind and direction need and where the nearest place is.
    const message = (source: string) => analyze(source).diagnostics.find((d) => d.code === "tile-off-grid")!.message;
    expect(message(long("tile (0.5, 1)"))).toBe("Not on the tile grid: facing east, the center of this decider combinator needs a whole x and a y ending in .5; the nearest is (1, 1.5)");
    expect(message(long("tile (1, 0.5) facing north"))).toBe("Not on the tile grid: facing north, the center of this decider combinator needs an x ending in .5 and a whole y; the nearest is (1.5, 1)");
    expect(message(circuit("lamp l tile (1, 2.25) { }"))).toBe("Not on the tile grid: the center of this lamp needs x and y ending in .5; the nearest is (1.5, 2.5)");
    for (const name of ["example.face", "comments.face", "all-kinds.face"]) expect(codes(fixture(name)).filter((code) => code.startsWith("tile-"))).toEqual([]);
    // A warning: the circuit is there and the tile is kept as written.
    expect(valid(long("tile (0.5, 1)")).circuit.entities[0]!.placement).toEqual({ tile: { x: 0.5, y: 1 } });
  });

  it("tile-overlap", () => {
    const two = circuit("lamp a tile (0.5, 0.5) { }\ndecider gate tile (1, 0.5) { when each > 1 output each = 1 }\nlamp free tile (2.5, 0.5) { }\nlamp none { }");
    expect(report(two)).toEqual([["tile-overlap", "tile (0.5, 0.5)"], ["tile-overlap", "tile (1, 0.5)"]]);
    expect(analyze(two).diagnostics.map((d) => d.message)).toEqual([
      "Stands on a tile that 'gate' stands on as well; in the game two entities cannot share a tile",
      "Stands on a tile that 'a' stands on as well; in the game two entities cannot share a tile",
    ]);
    expectCodes(two, ["tile-overlap", "tile-overlap"]);
    // Next to each other, and a 2x1 entity turned away, is no overlap.
    expectCodes(circuit("lamp a tile (0.5, 0.5) { }\nlamp b tile (1.5, 0.5) { }\nselector s tile (0.5, 2) facing south { }\nselector t tile (1.5, 2) facing north { }"), []);
    // One warning per entity, also when it shares both of its tiles or shares with several.
    const several = circuit("selector s tile (1, 0.5) { }\nselector t tile (1, 0.5) facing west { }\nlamp l tile (1.5, 0.5) { }");
    expect(analyze(several).diagnostics.map((d) => d.message.replace(/ as well.*/, ""))).toEqual(["Stands on a tile that 't' and 'l' stand on", "Stands on a tile that 's' and 'l' stand on", "Stands on a tile that 's' and 't' stand on"]);
    // A tile off the grid counts where its nearest footprint is.
    expect(codes(circuit("lamp a tile (0.5, 0.5) { }\nlamp b tile (0.4, 0.4) { }"))).toEqual(["tile-overlap", "tile-off-grid", "tile-overlap"]);
  });

  it("names a few entities of a pile on one tile and stays fast", () => {
    const pile = circuit(Array.from({ length: 3000 }, (_, i) => `lamp l${i} tile (0.5, 0.5) { }`).join("\n"));
    const started = performance.now();
    const result = analyze(pile);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.diagnostics).toHaveLength(3000);
    expect(result.diagnostics[0]!.message).toContain("that 'l1', 'l2', 'l3' and others stand on");
    expect(result.diagnostics[2999]!.message).toContain("that 'l0', 'l1', 'l2' and others stand on");
  });

  it("unused-facing", () => {
    expect(report(circuit("lamp l facing south { }\nlamp m at (0, 0) tile (0.5, 0.5) facing east { }\nlamp n { }"))).toEqual([["unused-facing", "facing south"], ["unused-facing", "facing east"]]);
    expectCodes(circuit("lamp l facing north { }"), ["unused-facing"]);
    expect(analyze(circuit("lamp l facing north { }")).diagnostics[0]!.message).toBe("A lamp cannot be rotated; 'facing' is ignored");
    // The clause is kept in the model, so that the text round-trips; every combinator may have one.
    expect(valid(circuit("lamp l facing north { }")).circuit.entities[0]!.placement).toEqual({ direction: "north" });
    expectCodes(circuit("constant c facing north { item:a = 1 }\nselector s facing west { }"), []);
  });

  it("wire-too-long", () => {
    const wired = (tiles: string, wires = "wire red c.out <-> l.in") => circuit(`constant c tile (0.5, 0.5) { item:a = 1 }\nlamp l ${tiles} { }\n${wires}`);
    // The default reach is 9 tiles between the centers; exactly 9 is fine.
    expectCodes(wired("tile (9.5, 0.5)"), []);
    expectCodes(wired("tile (10.5, 0.5)"), ["wire-too-long"]);
    expect(report(wired("tile (10.5, 0.5)"))).toEqual([["wire-too-long", "wire red c.out <-> l.in"]]);
    const messages = (source: string, wireReach?: number) => analyze(source, undefined, { wireReach }).diagnostics.map((d) => d.message);
    expect(messages(wired("tile (10.5, 0.5)"))).toEqual(["Wire from 'c.out' to 'l.in' is 10.0 tiles long; the wire reach of the project is 9"]);
    expect(messages(wired("tile (3.5, 12.5)", "wire green l.in <-> c.out"))).toEqual(["Wire from 'l.in' to 'c.out' is 12.4 tiles long; the wire reach of the project is 9"]);
    // The reach of the project decides.
    expect(messages(wired("tile (10.5, 0.5)"), 10)).toEqual([]);
    expect(messages(wired("tile (9.5, 0.5)"), 8.5)).toEqual(["Wire from 'c.out' to 'l.in' is 9.0 tiles long; the wire reach of the project is 8.5"]);
    expect(messages(wired("tile (3.5, 0.5)"), 2.5)).toHaveLength(1);
    // A length that rounds to the reach is shown with the digits that tell them apart.
    const upright = circuit("constant c tile (0.5, 0.5) { item:a = 1 }\nselector s tile (9.5, 1) facing north { }\nwire red c.out <-> s.in");
    expect(messages(upright)).toEqual(["Wire from 'c.out' to 's.in' is 9.01 tiles long; the wire reach of the project is 9"]);
    // Every wire that is too long gets its warning; a second declaration of one is a duplicate only.
    expect(codes(wired("tile (20.5, 0.5)", "wire red c.out <-> l.in\nwire green c.out <-> l.in\nwire red l.in <-> c.out"))).toEqual(["wire-too-long", "wire-too-long", "duplicate-wire"]);
    // A wire has a length only between two entities with a tile, and a wire of an entity to itself is never too long.
    expectCodes(wired(""), []);
    expectCodes(wired("at (4000, 0)"), []);
    expect(messages(circuit("selector s tile (1, 0.5) { }\nwire red s.out <-> s.in"), 1)).toEqual([]);
    for (const name of ["example.face", "comments.face", "all-kinds.face"]) expect(codes(fixture(name))).not.toContain("wire-too-long");
    // A warning: the circuit is there with the wire.
    expect(valid(wired("tile (10.5, 0.5)")).circuit.wires).toHaveLength(1);
  });

  it("checks the placement of a circuit only: a fragment loses its tiles when it is pasted", () => {
    expect(analyzeFragment("lamp a tile (0, 0) facing north { }\nlamp b tile (0, 0) { }").diagnostics).toEqual([]);
    expect(analyzeFragment("constant c tile (0.5, 0.5) { item:a = 1 }\nlamp l tile (40.5, 0.5) { }\nwire red c.out <-> l.in").diagnostics).toEqual([]);
  });

  it("has a test for every diagnostic code", () => {
    expect([...seen].sort()).toEqual(Object.keys(DIAGNOSTIC_SEVERITY).sort());
  });

  it("sorts diagnostics by position", () => {
    const result = analyze(circuit("wire red x.out <-> y.in\nlamp a { nope = 1 }\nlamp a { }"));
    expect(result.diagnostics.map((d) => d.from)).toEqual([...result.diagnostics.map((d) => d.from)].sort((a, b) => a - b));
    expect(result.diagnostics).toHaveLength(4);
  });
});

describe("source map", () => {
  const source = fixture("comments.face");
  const result = valid(source);
  const text = (range: { from: number; to: number } | undefined) => (range ? source.slice(range.from, range.to) : undefined);

  it("maps entities to declaration, name, position, body and statements", () => {
    const twice = result.sourceMap.entities.get(idOf(result, "twice"))!;
    expect(text(twice.range)).toMatch(/^arithmetic twice at \(300, 80\) \{[^]*\}$/);
    expect(text(twice.nameRange)).toBe("twice");
    expect([text(twice.at!.range), text(twice.at!.x), text(twice.at!.y)]).toEqual(["at (300, 80)", "300", "80"]);
    expect(twice.atInsert).toBe(twice.nameRange.to);
    expect(text(twice.bodyRange)).toMatch(/^\{[^]*\}$/);
    expect(twice.statements.map((s) => [s.key, text(s)])).toEqual([["expression", "virtual:signal-B = virtual:signal-A * 2"], ["description", 'description = "doubles A"']]);
    expect(result.sourceMap.entities.get(idOf(result, "source"))!.statements.map((s) => s.key)).toEqual(["filter", "enabled"]);
    expect(result.sourceMap.entities.get(idOf(result, "light"))!.statements.map((s) => s.key)).toEqual(["when", "always-on"]);
  });

  it("gives an insertion point when the at clause is absent", () => {
    const other = valid(circuit("lamp a tile (1, 2) { }"));
    const a = other.sourceMap.entities.get("e1")!;
    expect(a.at).toBeUndefined();
    expect(other.source.slice(0, a.atInsert)).toMatch(/lamp a$/);
  });

  it("finds entities and wires by offset", () => {
    const twice = idOf(result, "twice");
    expect(result.sourceMap.entityAt(source.indexOf("arithmetic twice"))).toBe(twice);
    expect(result.sourceMap.entityAt(source.indexOf("doubles A"))).toBe(twice);
    expect(result.sourceMap.entityAt(source.indexOf("}", source.indexOf("doubles A")) + 1)).toBe(twice);
    expect(result.sourceMap.entityAt(source.indexOf("// A wire between"))).toBeUndefined();
    expect(result.sourceMap.entityAt(0)).toBeUndefined();
    expect(result.sourceMap.entityAt(source.length)).toBeUndefined();
    expect(result.sourceMap.entityAt(source.indexOf("wire red"))).toBeUndefined();
    const key = result.sourceMap.wireAt(source.indexOf("wire red") + 3)!;
    expect(result.sourceMap.wires.get(key)!.wire).toEqual({ color: "red", a: { entity: idOf(result, "source"), side: "out" }, b: { entity: twice, side: "in" } });
    expect(result.sourceMap.wireAt(source.indexOf("light.in") + 8)).toBe(wireKey({ color: "green", a: { entity: twice, side: "out" }, b: { entity: idOf(result, "light"), side: "in" } }));
    expect(result.sourceMap.wireAt(source.indexOf("// keep this"))).toBeUndefined();
    expect(result.sourceMap.wireAt(source.indexOf("arithmetic twice"))).toBeUndefined();
  });

  it("is available for documents with errors", () => {
    const broken = analyze(circuit("lamp a { nope = 1 }\nlamp b {"));
    expect(broken.circuit).toBeUndefined();
    expect([...broken.sourceMap.entities.values()].map((e) => e.name)).toEqual(["a", "b"]);
    expect(broken.sourceMap.entityAt(broken.source.indexOf("nope"))).toBe("e1");
  });
});

describe("identity", () => {
  const ids = (result: ReturnType<typeof analyze>) => Object.fromEntries([...result.sourceMap.entities.values()].map((e) => [e.name, e.id]));
  const base = circuit("constant a { item:x = 1 }\nlamp b { }\nlamp c { }\nwire red a.out <-> b.in");

  it("assigns deterministic ids from a counter", () => {
    expect(ids(analyze(base))).toEqual({ a: "e1", b: "e2", c: "e3" });
    expect(analyze(base).identity.nextId).toBe(4);
    expect(ids(analyze(base))).toEqual(ids(analyze(base)));
  });

  it("keeps ids when unrelated text changes", () => {
    const first = analyze(base);
    expect(ids(analyze(base.replace("item:x = 1", "item:x = 2 // changed"), first))).toEqual(ids(first));
  });

  it("keeps the id through rename by typing, one character at a time", () => {
    let result = analyze(base);
    let source = base;
    for (const name of ["", "l", "la", "lam", "lamp", "lamp_", "lamp_2"]) {
      source = base.replace("lamp b", `lamp ${name}`);
      result = analyze(source, result);
      expect([...result.sourceMap.entities.values()].map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    }
    expect(ids(result)).toEqual({ a: "e1", lamp_2: "e2", c: "e3" });
    expect(result.identity.nextId).toBe(4);
    const fixed = analyze(source.replace("b.in", "lamp_2.in"), result);
    expect(fixed.circuit!.wires[0]).toEqual({ color: "red", a: { entity: "e1", side: "out" }, b: { entity: "e2", side: "in" } });
  });

  it("keeps ids when declarations are reordered", () => {
    const first = analyze(base);
    const reordered = analyze(circuit("lamp c { }\nwire red a.out <-> b.in\nlamp b { }\nconstant a { item:x = 1 }"), first);
    expect(ids(reordered)).toEqual({ a: "e1", b: "e2", c: "e3" });
    expect(reordered.circuit!.entities.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  });

  it("gives new entities fresh ids and never reuses deleted ones", () => {
    const first = analyze(base);
    const added = analyze(base.replace("lamp c { }", "lamp c { }\nlamp d { }\ndecider e { when each > 1 output each = 1 }"), first);
    expect(ids(added)).toEqual({ a: "e1", b: "e2", c: "e3", d: "e4", e: "e5" });
    const removed = analyze(circuit("constant a { item:x = 1 }\nlamp c { }\nlamp d { }"), added);
    expect(ids(removed)).toEqual({ a: "e1", c: "e3", d: "e4" });
    const again = analyze(circuit("constant a { item:x = 1 }\nlamp c { }\nlamp d { }\nlamp z { }"), removed);
    expect(ids(again)).toEqual({ a: "e1", c: "e3", d: "e4", z: "e6" });
  });

  it("does not hand a renamed id to an entity of another kind or position", () => {
    const first = analyze(base);
    const replaced = analyze(circuit("constant a { item:x = 1 }\ndecider q { }\nlamp c { }"), first);
    expect(ids(replaced)).toEqual({ a: "e1", q: "e4", c: "e3" });
    const moved = analyze(circuit("lamp q { }\nconstant a { item:x = 1 }\nlamp c { }"), first);
    expect(ids(moved)).toEqual({ q: "e4", a: "e1", c: "e3" });
  });

  it("matches by name before position when a new entity is inserted in front", () => {
    const first = analyze(base);
    const inserted = analyze(base.replace("lamp b { }", "lamp fresh { }\nlamp b { }"), first);
    expect(ids(inserted)).toEqual({ a: "e1", fresh: "e4", b: "e2", c: "e3" });
  });

  it("restores ids of entities that vanished only while the document had errors", () => {
    const first = analyze(base);
    const commented = analyze(base.replace("lamp b", "/* lamp b"), first);
    expect(commented.hasErrors).toBe(true);
    expect(ids(commented)).toEqual({ a: "e1" });
    const typing = analyze(base.replace("lamp b", "/* x lamp b"), commented);
    const restored = analyze(base, typing);
    expect(ids(restored)).toEqual({ a: "e1", b: "e2", c: "e3" });
    expect(restored.identity.lost).toEqual([]);
  });

  it("keeps the first id for duplicate names", () => {
    const first = analyze(base);
    const duplicated = analyze(base.replace("lamp c", "lamp b"), first);
    expect([...duplicated.sourceMap.entities.values()].map((e) => [e.name, e.id])).toEqual([["a", "e1"], ["b", "e2"], ["b", "e3"]]);
  });
});
