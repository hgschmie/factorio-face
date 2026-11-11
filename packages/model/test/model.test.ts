import { describe, expect, it } from "vitest";
import { DEFAULT_ENTITY, ENTITY_KINDS, TERMINALS, hasTerminal, isInt32, normalizeWire, parseSignalKey, sameSignal, signal, signalKey, wildcardOf, wildcardSignal, wireKey, type Wire } from "../src/index.ts";

describe("signal identity", () => {
  it("round-trips canonical keys and never stores normal quality", () => {
    expect(signalKey(signal("item", "iron-plate"))).toBe("item:iron-plate");
    expect(signalKey(signal("item", "iron-plate", "normal"))).toBe("item:iron-plate");
    expect(signal("item", "iron-plate", "normal")).toEqual({ kind: "item", name: "iron-plate" });
    expect(parseSignalKey("item:iron-plate@rare")).toEqual({ kind: "item", name: "iron-plate", quality: "rare" });
    expect(parseSignalKey("space-location:nauvis")).toEqual({ kind: "space-location", name: "nauvis" });
    expect(parseSignalKey("bogus:thing")).toBeUndefined();
    expect(parseSignalKey("item:")).toBeUndefined();
  });

  it("treats absent and normal quality as the same signal", () => {
    expect(sameSignal({ kind: "item", name: "a" }, { kind: "item", name: "a", quality: "normal" })).toBe(true);
    expect(sameSignal({ kind: "item", name: "a" }, { kind: "fluid", name: "a" })).toBe(false);
  });

  it("maps wildcards to their virtual signals and back", () => {
    expect(wildcardSignal("each")).toEqual({ kind: "virtual", name: "signal-each" });
    expect(wildcardOf({ kind: "virtual", name: "signal-anything" })).toBe("anything");
    expect(wildcardOf({ kind: "virtual", name: "signal-A" })).toBeUndefined();
    expect(wildcardOf({ kind: "item", name: "signal-each" })).toBeUndefined();
  });
});

describe("wires", () => {
  const wire: Wire = { color: "red", a: { entity: "e2", side: "in" }, b: { entity: "e1", side: "out" } };

  it("gives reversed declarations the same identity", () => {
    expect(wireKey(wire)).toBe(wireKey({ color: "red", a: wire.b, b: wire.a }));
    expect(normalizeWire(wire).a.entity).toBe("e1");
  });

  it("separates colors and terminals", () => {
    expect(wireKey(wire)).not.toBe(wireKey({ ...wire, color: "green" }));
    expect(wireKey(wire)).not.toBe(wireKey({ ...wire, a: { entity: "e2", side: "out" } }));
  });
});

describe("entity kinds", () => {
  it("defines terminals and defaults for every kind", () => {
    for (const kind of ENTITY_KINDS) {
      expect(TERMINALS[kind].length).toBeGreaterThan(0);
      expect(DEFAULT_ENTITY[kind].kind).toBe(kind);
    }
    expect(hasTerminal("constant", "in")).toBe(false);
    expect(hasTerminal("lamp", "out")).toBe(false);
    expect(hasTerminal("selector", "out")).toBe(true);
  });

  it("checks the int32 range", () => {
    expect(isInt32(2147483647)).toBe(true);
    expect(isInt32(2147483648)).toBe(false);
    expect(isInt32(-2147483648)).toBe(true);
    expect(isInt32(1.5)).toBe(false);
  });
});
