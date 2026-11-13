// Electric poles: one connection point that is a network member in its own right. A pole has no behaviour (P-RELAY).
import { describe, expect, it } from "vitest";
import { compile, POINT_ROLES, readSnapshot, runFixture, type ConformanceFixture } from "../src/index.ts";
import { ENTITY_KINDS, TERMINALS } from "@face/model";
import { arithmetic, circuit, constant, lamp, networkAt, outputOf, pole, record, simulate, speaker, terminal, v, wire } from "./helpers.ts";

const lit = { condition: { first: { kind: "virtual" as const, name: "signal-A" }, comparator: ">" as const, second: { type: "constant" as const, value: 0 } } };

describe("connection points", () => {
  it("says for every kind where it reads and where it writes, on points the kind has", () => {
    for (const kind of ENTITY_KINDS) for (const side of Object.values(POINT_ROLES[kind])) expect(TERMINALS[kind], kind).toContain(side);
    expect(POINT_ROLES.pole).toEqual({ reads: "io" });
    expect(POINT_ROLES.speaker).toEqual({ reads: "in" });
    expect(ENTITY_KINDS.filter((kind) => POINT_ROLES[kind].reads && POINT_ROLES[kind].writes)).toEqual(["arithmetic", "decider", "selector"]);
  });
});

describe("pole", () => {
  it("P-RELAY: joins every wire of one color on it into one network", () => {
    const c = circuit(
      [constant("c", { A: 1 }), pole("p1"), pole("p2", "big-electric-pole"), lamp("l", lit), lamp("m", lit)],
      [wire("red", "c.out", "p1"), wire("red", "p1", "p2"), wire("red", "p2", "l.in"), wire("red", "m.in", "p1")],
    );
    const compiled = compile(c);
    expect(compiled.notes).toEqual([]);
    expect(compiled.networks).toHaveLength(1);
    const [red] = compiled.networks;
    expect(red!.id).toBe("red:c.out");
    expect(red!.terminals).toEqual([terminal("c.out"), terminal("l.in"), terminal("m.in"), terminal("p1"), terminal("p2")]);
    expect(red!.emitters).toEqual(["c"]);
    expect(red!.readers).toEqual(["l", "m", "p1", "p2"]);
    expect(compiled.terminals["p1.io"]).toEqual({ red: "red:c.out" });
    const snapshot = simulate(c).snapshot();
    // No combinator is in the way: the lamps are lit at tick 0.
    expect([snapshot.entities.l!.lamp, snapshot.entities.m!.lamp]).toEqual([{ lit: true }, { lit: true }]);
    expect(snapshot.totals).toMatchObject({ networks: 1, lampsLit: 2, emitting: 1 });
  });

  it("P-RELAY: keeps red and green apart", () => {
    const c = circuit(
      [constant("r", { A: 3 }), constant("g", { A: 4, B: 1 }), pole("p"), arithmetic("a", "A", "*", 1, "A")],
      [wire("red", "r.out", "p"), wire("green", "g.out", "p"), wire("red", "p", "a.in")],
    );
    const simulation = simulate(c, 1);
    expect(networkAt(simulation, "p", "red")).toEqual(v({ A: 3 }));
    expect(networkAt(simulation, "p", "green")).toEqual(v({ A: 4, B: 1 }));
    // The combinator behind the pole is wired with red only.
    expect(outputOf(simulation, "a")).toEqual(v({ A: 3 }));
  });

  it("shows what is on its two networks and emits nothing", () => {
    const c = circuit([constant("r", { A: 3 }), constant("g", { A: 4, B: 1 }), pole("p")], [wire("red", "r.out", "p"), wire("green", "g.out", "p")]);
    const simulation = simulate(c);
    const snapshot = simulation.snapshot();
    const state = snapshot.entities.p!;
    expect(Object.keys(state).sort()).toEqual(["input", "kind"]);
    expect([record(state.input!.red), record(state.input!.green), record(state.input!.combined)]).toEqual([v({ A: 3 }), v({ A: 4, B: 1 }), v({ A: 7, B: 1 })]);
    expect(simulation.probe({ type: "terminal", entity: "p", side: "io", color: "green" }, "virtual:signal-A")).toBe(4);
    expect(simulation.probe({ type: "terminal", entity: "p", side: "io" }, "virtual:signal-A")).toBe(7);
    expect(readSnapshot(snapshot, { type: "terminal", entity: "p", side: "io", color: "red" }, "virtual:signal-A")).toBe(3);
    expect(snapshot.totals.emitting).toBe(2);
  });

  it("has no network without a wire, and an unwired pole between two does not join them", () => {
    const c = circuit([constant("c", { A: 1 }), pole("p"), pole("alone"), lamp("l", lit)], [wire("red", "c.out", "p")]);
    const compiled = compile(c);
    expect(compiled.networks.map((n) => n.id)).toEqual(["red:c.out"]);
    expect(compiled.terminals["alone.io"]).toBeUndefined();
    const snapshot = simulate(c).snapshot();
    expect(snapshot.entities.alone!.input).toEqual({ red: [], green: [], combined: [] });
    expect(snapshot.entities.l!.lamp).toEqual({ lit: false });
  });

  it("carries a signal with the delay of the combinators only: a pole adds no tick", () => {
    const direct = circuit([constant("c", { A: 1 }), arithmetic("a", "A", "+", 1, "A"), lamp("l", lit)], [wire("red", "c.out", "a.in"), wire("green", "a.out", "l.in")]);
    const relayed = circuit(
      [constant("c", { A: 1 }), pole("p1"), arithmetic("a", "A", "+", 1, "A"), pole("p2"), pole("p3", "substation"), lamp("l", lit)],
      [wire("red", "c.out", "p1"), wire("red", "p1", "a.in"), wire("green", "a.out", "p2"), wire("green", "p2", "p3"), wire("green", "p3", "l.in")],
    );
    for (const tick of [0, 1, 2]) {
      expect(simulate(relayed, tick).snapshot().entities.l!.lamp).toEqual(simulate(direct, tick).snapshot().entities.l!.lamp);
      expect(outputOf(simulate(relayed, tick), "a")).toEqual(outputOf(simulate(direct, tick), "a"));
    }
    expect(simulate(relayed, 1).snapshot().entities.l!.lamp).toEqual({ lit: true });
  });

  it("drops a wire to a terminal a pole does not have, and a bare wire to an entity without such a point", () => {
    const c = circuit(
      [constant("c", { A: 1 }), pole("p"), lamp("l"), speaker("s")],
      [wire("red", "c.out", "p.in"), wire("red", "p.out", "l.in"), wire("red", "c", "p"), wire("green", "p", "p"), wire("green", "s", "p"), wire("green", "s.in", "p")],
    );
    const compiled = compile(c);
    expect(compiled.notes.map((n) => n.code).filter((code) => code === "invalid-wire")).toHaveLength(5);
    expect(compiled.networks.map((n) => n.id)).toEqual(["green:p.io"]);
  });

  it("runs as a fixture: a network is addressed through the point of a pole", () => {
    const fixture: ConformanceFixture = {
      format: 1, id: "inline", covers: ["F-26"], title: "inline", provenance: "documented", ticks: 1,
      circuit: circuit([constant("c", { A: 2 }), pole("p"), lamp("l", lit)], [wire("green", "c.out", "p"), wire("green", "p", "l.in")]),
      expect: [{ tick: 0, through: 1, networks: [{ terminal: { entity: "p", side: "io" }, color: "green", signals: v({ A: 2 }) }], lamps: { l: { lit: true } } }],
    };
    expect(runFixture(fixture)).toEqual([]);
    expect(runFixture({ ...fixture, expect: [{ tick: 0, networks: [{ terminal: { entity: "p", side: "io" }, color: "red", signals: {} }] }] })).toMatchObject([{ target: "network red p.io", message: "the terminal has no network of that color" }]);
  });
});
