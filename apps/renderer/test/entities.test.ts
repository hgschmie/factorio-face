import { analyze } from "@face/language";
import { BOTH_NETWORKS, DEFAULT_ENTITY, signal, wildcardSignal, type Circuit, type Entity } from "@face/model";
import { describe, expect, it } from "vitest";
import { formatSignal, parseSignalText, shortSignal } from "../src/entities/signalText.ts";
import { entitySummary, truncate } from "../src/entities/summary.ts";
import { entityNameError, parseInt32, parseSignalField } from "../src/inspector/validation.ts";
import { STARTER_SOURCE } from "../src/session/starter.ts";

/** The example circuit of a new project, extended with a selector so that every kind is covered. */
function exampleCircuit(): Circuit {
  const result = analyze(STARTER_SOURCE.replace("    wire red source.out", "    selector pick at (560, 240) { operation = select  order = min  index = virtual:signal-I }\n\n    wire red source.out"));
  if (!result.circuit) throw new Error(JSON.stringify(result.diagnostics));
  return result.circuit;
}

const base = { id: "x", name: "x", position: { x: 0, y: 0 } };
const A = signal("virtual", "signal-A");

describe("signal text", () => {
  it("prints canonical keys and wildcard keywords", () => {
    expect(formatSignal(A)).toBe("virtual:signal-A");
    expect(formatSignal(signal("item", "iron-plate", "rare"))).toBe("item:iron-plate@rare");
    expect(formatSignal(wildcardSignal("each"))).toBe("each");
  });

  it("parses keys, wildcard keywords and rejects everything else", () => {
    expect(parseSignalText(" item:iron-plate@rare ")).toEqual({ kind: "item", name: "iron-plate", quality: "rare" });
    expect(parseSignalText("anything")).toEqual(wildcardSignal("anything"));
    expect(parseSignalText("iron-plate")).toBeUndefined();
    expect(parseSignalText("thing:iron-plate")).toBeUndefined();
  });

  it("shortens virtual letter signals for cards", () => {
    expect(shortSignal(A)).toBe("A");
    expect(shortSignal(signal("item", "iron-plate", "rare"))).toBe("iron-plate@rare");
    expect(shortSignal(wildcardSignal("everything"))).toBe("everything");
  });
});

describe("card summaries", () => {
  const byName = new Map(exampleCircuit().entities.map((entity) => [entity.name, entity]));

  it("summarizes the example circuit", () => {
    expect(entitySummary(byName.get("source")!)).toBe("A = 1");
    expect(entitySummary(byName.get("gate")!)).toBe("A < 10 → A");
    expect(entitySummary(byName.get("twice")!)).toBe("A × 2 → B");
    expect(entitySummary(byName.get("pick")!)).toBe("min #I");
    expect(entitySummary(byName.get("light")!)).toBe("B > 8");
  });

  it("describes freshly placed entities", () => {
    const fresh = (kind: Entity["kind"]): Entity => ({ ...base, ...DEFAULT_ENTITY[kind] }) as Entity;
    expect(entitySummary(fresh("constant"))).toBe("no signals");
    expect(entitySummary(fresh("arithmetic"))).toBe("0 × 0 → ?");
    expect(entitySummary(fresh("decider"))).toBe("no condition");
    expect(entitySummary(fresh("selector"))).toBe("max #0");
    expect(entitySummary(fresh("lamp"))).toBe("no condition");
  });

  it("covers constants with several signals, disabled constants and the selector modes", () => {
    const filters = [{ signal: A, count: 2 }, { signal: signal("item", "coal"), count: 1 }];
    expect(entitySummary({ ...base, kind: "constant", enabled: true, sections: [{ active: true, multiplier: 3, filters }] })).toBe("A = 6 +1");
    expect(entitySummary({ ...base, kind: "constant", enabled: false, sections: [] })).toBe("switched off");
    expect(entitySummary({ ...base, kind: "selector", mode: { operation: "count", output: A } })).toBe("count → A");
    expect(entitySummary({ ...base, kind: "selector", mode: { operation: "random", interval: 60 } })).toBe("random / 60 ticks");
    expect(entitySummary({ ...base, kind: "selector", mode: { operation: "quality-filter", comparator: ">=", quality: "rare" } })).toBe("quality ≥ rare");
    expect(entitySummary({ ...base, ...DEFAULT_ENTITY.lamp, alwaysOn: true })).toBe("always on");
    // A lamp controlled by the circuit network shows its condition, always on or not.
    const condition = { first: A, comparator: ">", second: { type: "constant", value: 8 } } as const;
    for (const alwaysOn of [true, false]) expect(entitySummary({ ...base, ...DEFAULT_ENTITY.lamp, alwaysOn, condition })).toBe("A > 8");
    expect(entitySummary({ ...base, kind: "decider", conditions: [{ join: "and", firstNetworks: BOTH_NETWORKS, comparator: "!=", second: { type: "signal", signal: A, networks: BOTH_NETWORKS } }], outputs: [], elseOutputs: [] })).toBe("? ≠ A → ?");
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("a-very-long-entity-name", 10)).toBe("a-very-lo…");
  });
});

describe("inspector validation", () => {
  it("accepts int32 values only", () => {
    expect(parseInt32(" -42 ")).toEqual({ ok: true, value: -42 });
    expect(parseInt32("2147483647")).toEqual({ ok: true, value: 2147483647 });
    expect(parseInt32("2147483648").ok).toBe(false);
    expect(parseInt32("1.5").ok).toBe(false);
    expect(parseInt32("").ok).toBe(false);
    expect(parseInt32("abc").ok).toBe(false);
  });

  it("validates signal fields", () => {
    expect(parseSignalField("virtual:signal-A", true, ["each"])).toEqual({ ok: true, value: A });
    expect(parseSignalField("", false, [])).toEqual({ ok: true, value: undefined });
    expect(parseSignalField("  ", true, []).ok).toBe(false);
    expect(parseSignalField("signal-A", true, []).ok).toBe(false);
    expect(parseSignalField("each", true, ["each"])).toEqual({ ok: true, value: wildcardSignal("each") });
    expect(parseSignalField("each", true, []).ok).toBe(false);
    expect(parseSignalField("virtual:signal-each", true, []).ok).toBe(false);
    // A wildcard is only accepted where the slot allows that particular one.
    expect(parseSignalField("anything", true, ["each"])).toEqual({ ok: false, message: "'anything' is not allowed here; use 'each'" });
    expect(parseSignalField("everything", true, ["anything", "everything"]).ok).toBe(true);
  });

  it("validates entity names", () => {
    const circuit = exampleCircuit();
    expect(entityNameError("counter_2", "e2", circuit)).toBeNull();
    expect(entityNameError("gate", "e2", circuit)).toBeNull();
    expect(entityNameError("source", "e2", circuit)).toContain("already used");
    expect(entityNameError("2fast", "e2", circuit)).not.toBeNull();
    expect(entityNameError("has space", "e2", circuit)).not.toBeNull();
    expect(entityNameError("", "e2", circuit)).not.toBeNull();
    expect(entityNameError("lamp", "e2", circuit)).toContain("reserved");
  });
});
