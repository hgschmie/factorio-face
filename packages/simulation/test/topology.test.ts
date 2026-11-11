import { describe, expect, it } from "vitest";
import { compile, networkOf } from "../src/index.ts";
import { ANYTHING, EACH, arithmetic, circuit, constant, decider, cond, lamp, out, outputOf, selector, simulate, terminal, wire } from "./helpers.ts";

describe("topology", () => {
  it("joins same-colored wires into one network with union-find and keeps colors apart", () => {
    const c = circuit(
      [constant("c"  , { A: 1 }), arithmetic("a", "A", "+", 0, "A"), arithmetic("b", "A", "+", 0, "A"), lamp("l"), lamp("m")],
      [wire("red", "c.out", "a.in"), wire("red", "a.in", "b.in"), wire("red", "l.in", "b.in"), wire("green", "a.out", "l.in"), wire("green", "b.out", "m.in")],
    );
    const compiled = compile(c);
    expect(compiled.networks.map((n) => n.id)).toEqual(["green:a.out", "green:b.out", "red:a.in"]);
    const red = compiled.networks[2]!;
    expect(red.color).toBe("red");
    expect(red.terminals).toEqual([terminal("a.in"), terminal("b.in"), terminal("c.out"), terminal("l.in")]);
    expect(red.emitters).toEqual(["c"]);
    expect(red.readers).toEqual(["a", "b", "l"]);
    expect(compiled.terminals["l.in"]).toEqual({ red: "red:a.in", green: "green:a.out" });
    expect(compiled.terminals["m.in"]).toEqual({ green: "green:b.out" });
    expect(networkOf(compiled, terminal("c.out"), "red")).toBe(red);
    expect(networkOf(compiled, terminal("c.out"), "green")).toBeUndefined();
    expect(compiled.notes).toEqual([]);
  });

  it("gives terminals without wires no network", () => {
    const compiled = compile(circuit([constant("c", { A: 1 }), lamp("l")]));
    expect(compiled.networks).toEqual([]);
    expect(compiled.terminals).toEqual({});
  });

  it("produces network ids that do not depend on entity or wire order", () => {
    const entities = [constant("c", { A: 1 }), arithmetic("a", "A", "+", 0, "A"), lamp("l")];
    const wires = [wire("red", "c.out", "a.in"), wire("green", "a.out", "l.in"), wire("red", "l.in", "a.in")];
    const forward = compile(circuit(entities, wires));
    const backward = compile(circuit([...entities].reverse(), [...wires].reverse().map((w) => ({ color: w.color, a: w.b, b: w.a }))));
    expect(backward).toEqual(forward);
  });

  it("accepts duplicate wires, loops and a combinator's own output wired to its own input", () => {
    const c = circuit(
      [arithmetic("a", "A", "+", 1, "A"), arithmetic("b", "A", "+", 0, "B")],
      [wire("red", "a.out", "a.in"), wire("red", "a.in", "a.out"), wire("red", "a.out", "b.in"), wire("red", "b.in", "a.in")],
    );
    const compiled = compile(c);
    expect(compiled.notes).toEqual([]);
    expect(compiled.networks).toHaveLength(1);
    expect(compiled.networks[0]).toMatchObject({ id: "red:a.in", emitters: ["a"], readers: ["a", "b"] });
  });

  it("drops invalid wires with a note and never throws", () => {
    const c = circuit(
      [constant("c", { A: 1 }), lamp("l")],
      [wire("red", "c.out", "ghost.in"), wire("red", "c.in", "l.in"), wire("green", "l.out", "c.out"), wire("red", "l.in", "l.in"), wire("red", "c.out", "l.in")],
    );
    const compiled = compile(c);
    expect(compiled.notes.map((n) => [n.severity, n.code])).toEqual(Array(4).fill(["warning", "invalid-wire"]));
    expect(compiled.networks.map((n) => n.id)).toEqual(["red:c.out"]);
  });

  it("reports duplicate entity ids and keeps the first entity", () => {
    const compiled = compile(circuit([constant("x", { A: 1 }), constant("x", { A: 2 })]));
    expect(compiled.entities).toHaveLength(1);
    expect(compiled.notes).toMatchObject([{ severity: "error", code: "duplicate-entity", entity: "x" }]);
  });
});

describe("static notes", () => {
  const codes = (...entities: Parameters<typeof circuit>[0]): string[] => compile(circuit(entities)).notes.map((n) => `${n.severity}:${n.code}`);

  it("marks unconfigured entities as info", () => {
    expect(codes(arithmetic("a", "A", "+", 1))).toEqual(["info:unconfigured"]);
    expect(codes(decider("d", [], []))).toEqual(["info:unconfigured", "info:unconfigured"]);
    expect(codes(selector("s", { operation: "count" }))).toEqual(["info:unconfigured"]);
    expect(codes(selector("s", { operation: "time" }))).toEqual(["info:unconfigured"]);
    expect(codes(selector("s", { operation: "quality-transfer", source: { type: "signal" } }))).toEqual(["info:unconfigured", "info:unconfigured"]);
  });

  it("marks invalid wildcard use as error", () => {
    expect(codes(arithmetic("a", "A", "+", 1, EACH))).toEqual(["error:invalid-wildcard"]);
    expect(codes(arithmetic("a", ANYTHING, "+", 1, "A"))).toEqual(["error:invalid-wildcard"]);
    expect(codes(arithmetic("a", EACH, "+", 1, "everything"))).toEqual(["error:invalid-wildcard"]);
    expect(codes(decider("d", [cond("A", ">", "anything")], [out("A")]))).toEqual(["error:invalid-wildcard"]);
    expect(codes(decider("d", [cond("A", ">", 0)], [out(EACH)]))).toEqual(["error:invalid-wildcard"]);
    expect(codes(decider("d", [cond(EACH, ">", 0)], [], [out("everything")]))).toEqual(["error:invalid-wildcard"]);
    expect(codes(selector("s", { operation: "count", output: EACH }))).toEqual(["error:invalid-wildcard"]);
    expect(codes(selector("s", { operation: "quality-transfer", source: { type: "quality", quality: "rare" }, destination: ANYTHING }))).toEqual(["error:invalid-wildcard"]);
    expect(codes(lamp("l", { condition: { first: EACH, comparator: ">", second: { type: "constant", value: 0 } } }))).toEqual(["error:invalid-wildcard"]);
    expect(codes(constant("c", { each: 1, A: 1 }))).toEqual(["warning:invalid-filter"]);
  });

  it("flags modes that cannot match the game exactly or depend on the environment", () => {
    expect(codes(selector("s", { operation: "random", interval: 5 }))).toEqual(["info:random-not-reproducible"]);
    expect(codes(selector("s", { operation: "rocket-capacity" }))).toEqual([]);
    expect(codes(selector("s", { operation: "quality-filter", comparator: ">", quality: "mythic" }))).toEqual(["error:unknown-quality"]);
  });

  it("silences invalid entities instead of throwing", () => {
    const c = circuit(
      [
        constant("c", { A: 5, B: 2 }),
        arithmetic("bad1", "A", "+", 1, EACH),
        arithmetic("bad2", "everything", "+", 1, "A"),
        decider("bad3", [cond("A", ">", 0)], [out(EACH)], [out("A", 1)]),
        selector("bad4", { operation: "quality-filter", comparator: "=", quality: "mythic" }),
        arithmetic("good", "A", "+", 1, "A"),
      ],
      ["bad1", "bad2", "bad3", "bad4", "good"].map((id) => wire("red", "c.out", `${id}.in`)),
    );
    const simulation = simulate(c, 3);
    for (const id of ["bad1", "bad2", "bad3", "bad4"]) expect(outputOf(simulation, id)).toEqual({});
    expect(outputOf(simulation, "good")).toEqual({ "virtual:signal-A": 6 });
  });
});
