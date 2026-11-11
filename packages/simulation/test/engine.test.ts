import { describe, expect, it } from "vitest";
import type { Circuit } from "@face/model";
import { compile, createSimulation } from "../src/index.ts";
import { GREEN, INT_MAX, RED, arithmetic, circuit, cond, constant, decider, lamp, networkAt, operand, out, outputOf, selector, simulate, v, wire } from "./helpers.ts";

const chain = (): Circuit =>
  circuit(
    [constant("c", { A: 5 }), arithmetic("a1", "A", "+", 1, "A"), arithmetic("a2", "A", "*", 2, "A"), decider("d", [cond("A", ">", 0)], [out("A")])],
    [wire("red", "c.out", "a1.in"), wire("red", "a1.out", "a2.in"), wire("green", "a2.out", "d.in")],
  );

describe("tick model", () => {
  it("F-03/F-04 assumption: at tick 0 only constant combinators emit, without delay; every combinator output is empty", () => {
    const simulation = simulate(chain());
    expect(simulation.tick).toBe(0);
    expect(networkAt(simulation, "c.out", "red")).toEqual(v({ A: 5 }));
    expect(outputOf(simulation, "c")).toEqual(v({ A: 5 }));
    for (const id of ["a1", "a2", "d"]) expect(outputOf(simulation, id)).toEqual({});
  });

  it("F-03 assumption: each arithmetic and decider stage adds exactly one tick of latency", () => {
    const simulation = simulate(chain());
    const timeline = [0, 1, 2, 3, 4].map((tick) => {
      if (tick > 0) simulation.step();
      return [outputOf(simulation, "a1"), outputOf(simulation, "a2"), outputOf(simulation, "d")];
    });
    expect(timeline).toEqual([
      [{}, {}, {}],
      [v({ A: 6 }), {}, {}],
      [v({ A: 6 }), v({ A: 12 }), {}],
      [v({ A: 6 }), v({ A: 12 }), v({ A: 12 })],
      [v({ A: 6 }), v({ A: 12 }), v({ A: 12 })],
    ]);
  });

  it("F-03 assumption: a selector stage has the same one-tick latency", () => {
    const c = circuit([constant("c", { A: 5, B: 9 }), selector("s", { operation: "select", max: true, index: operand(0), indexComparator: "=" })], [wire("red", "c.out", "s.in")]);
    const simulation = simulate(c);
    expect(outputOf(simulation, "s")).toEqual({});
    simulation.step();
    expect(outputOf(simulation, "s")).toEqual(v({ B: 9 }));
  });

  it("F-03 assumption: updates are simultaneous; two cross-wired combinators swap values instead of racing", () => {
    // x computes B + 1 -> A, y computes A + 1 -> B; each reads the other's previous output.
    const c = circuit([arithmetic("x", "B", "+", 1, "A"), arithmetic("y", "A", "+", 1, "B")], [wire("red", "x.out", "y.in"), wire("green", "y.out", "x.in")]);
    const simulation = simulate(c);
    const timeline = [1, 2, 3].map(() => (simulation.step(), [outputOf(simulation, "x"), outputOf(simulation, "y")]));
    expect(timeline).toEqual([
      [v({ A: 1 }), v({ B: 1 })],
      [v({ A: 2 }), v({ B: 2 })],
      [v({ A: 3 }), v({ B: 3 })],
    ]);
  });

  it("step returns the new tick and accepts a count", () => {
    const simulation = simulate(chain());
    expect(simulation.step()).toBe(1);
    expect(simulation.step(9)).toBe(10);
    expect(simulation.step(0)).toBe(10);
    expect(simulation.tick).toBe(10);
  });
});

describe("feedback", () => {
  it("F-05 assumption: a self-wired A + 1 -> A counts 1, 2, 3 from the first tick", () => {
    const simulation = simulate(circuit([arithmetic("n", "A", "+", 1, "A")], [wire("red", "n.out", "n.in")]));
    expect(outputOf(simulation, "n")).toEqual({});
    for (let tick = 1; tick <= 5; tick++) {
      simulation.step();
      expect(outputOf(simulation, "n")).toEqual(v({ A: tick }));
    }
    simulation.step(995);
    expect(simulation.probe({ type: "terminal", entity: "n", side: "out" }, "virtual:signal-A")).toBe(1000);
  });

  it("F-05 assumption: a counter wraps from 2147483647 to -2147483648", () => {
    const simulation = simulate(circuit([arithmetic("n", "A", "+", INT_MAX, "A")], [wire("red", "n.out", "n.in")]), 1);
    expect(outputOf(simulation, "n")).toEqual(v({ A: INT_MAX }));
    simulation.step();
    expect(outputOf(simulation, "n")).toEqual(v({ A: -2 }));
    simulation.step();
    expect(outputOf(simulation, "n")).toEqual(v({ A: INT_MAX - 2 }));
  });

  it("F-05 assumption: a self-wired decider clock with a constant 1 has period 5", () => {
    const c = circuit([constant("one", { A: 1 }), decider("clock", [cond("A", "<", 5)], [out("A")])], [wire("red", "one.out", "clock.in"), wire("red", "clock.out", "clock.in")]);
    const simulation = simulate(c);
    const values = Array.from({ length: 11 }, () => (simulation.step(), outputOf(simulation, "clock")["virtual:signal-A"] ?? 0));
    expect(values).toEqual([1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1]);
  });

  it("documented: a combinator reads its own previous output when its output is wired to its input", () => {
    const c = circuit([constant("c", { A: 3 }), arithmetic("acc", "each", "+", 0, "each")], [wire("red", "c.out", "acc.in"), wire("green", "acc.out", "acc.in")]);
    const simulation = simulate(c);
    const values = [1, 2, 3, 4].map(() => (simulation.step(), outputOf(simulation, "acc")["virtual:signal-A"]));
    expect(values).toEqual([3, 6, 9, 12]);
  });
});

describe("red and green networks", () => {
  it("documented: red and green are separate networks and an input sums both", () => {
    const c = circuit(
      [constant("r", { A: 3, B: 1 }), constant("g", { A: 4, C: 2 }), arithmetic("sum", "each", "+", 0, "each"), arithmetic("red", operand("each", RED), "+", 0, "each"), arithmetic("green", operand("each", GREEN), "+", 0, "each")],
      [wire("red", "r.out", "sum.in"), wire("green", "g.out", "sum.in"), wire("red", "r.out", "red.in"), wire("green", "g.out", "red.in"), wire("red", "r.out", "green.in"), wire("green", "g.out", "green.in")],
    );
    const simulation = simulate(c, 1);
    expect(outputOf(simulation, "sum")).toEqual(v({ A: 7, B: 1, C: 2 }));
    expect(outputOf(simulation, "red")).toEqual(v({ A: 3, B: 1 }));
    expect(outputOf(simulation, "green")).toEqual(v({ A: 4, C: 2 }));
    const input = simulation.snapshot().entities.sum!.input!;
    expect(input.red.map((e) => [e.key, e.value])).toEqual(Object.entries(v({ A: 3, B: 1 })));
    expect(input.green.map((e) => [e.key, e.value])).toEqual(Object.entries(v({ A: 4, C: 2 })));
    expect(input.combined.map((e) => [e.key, e.value])).toEqual(Object.entries(v({ A: 7, B: 1, C: 2 })));
  });

  it("documented: emitters on one network are summed per signal", () => {
    const c = circuit([constant("x", { A: 1, B: 5 }), constant("y", { A: 2 }), constant("z", { A: -3, B: 1 }), lamp("l")], [wire("red", "x.out", "y.out"), wire("red", "y.out", "z.out"), wire("red", "z.out", "l.in")]);
    expect(networkAt(simulate(c), "l.in", "red")).toEqual(v({ B: 6 }));
  });

  it("F-07 assumption: the sum of a network wraps to int32", () => {
    const c = circuit([constant("x", { A: INT_MAX }), constant("y", { A: 10 }), lamp("l")], [wire("green", "x.out", "l.in"), wire("green", "y.out", "l.in")]);
    expect(networkAt(simulate(c), "l.in", "green")).toEqual(v({ A: -2147483639 }));
  });

  it("F-07 assumption: red + green of one input wraps, and a zero sum removes the signal", () => {
    const c = circuit([constant("r", { A: INT_MAX, B: 3 }), constant("g", { A: 1, B: -3 }), arithmetic("a", "each", "+", 0, "each")], [wire("red", "r.out", "a.in"), wire("green", "g.out", "a.in")]);
    const simulation = simulate(c, 1);
    expect(outputOf(simulation, "a")).toEqual(v({ A: -2147483648 }));
    expect(simulation.snapshot().entities.a!.input!.combined.map((e) => e.key)).toEqual(["virtual:signal-A"]);
  });

  it("documented: a combinator sends its output to both colors; assumption (no fixture id): wiring both into one input doubles the value", () => {
    const c = circuit([constant("c", { A: 5 }), arithmetic("a", "A", "+", 0, "A"), arithmetic("b", "A", "+", 0, "A")], [wire("red", "c.out", "a.in"), wire("red", "a.out", "b.in"), wire("green", "a.out", "b.in")]);
    const simulation = simulate(c, 2);
    expect(networkAt(simulation, "a.out", "red")).toEqual(v({ A: 5 }));
    expect(networkAt(simulation, "a.out", "green")).toEqual(v({ A: 5 }));
    expect(outputOf(simulation, "b")).toEqual(v({ A: 10 }));
  });

  it("a wire of one color does not carry signals to the other color", () => {
    const c = circuit([constant("c", { A: 5 }), arithmetic("a", operand("A", GREEN), "+", 0, "A")], [wire("red", "c.out", "a.in")]);
    expect(outputOf(simulate(c, 2), "a")).toEqual({});
  });
});

describe("determinism", () => {
  const mesh = (): Circuit =>
    circuit(
      [
        constant("c", { A: 3, B: -7, "item:iron-plate": 11, "item:iron-plate@rare": 2 }),
        arithmetic("n", "A", "+", 1, "A"),
        arithmetic("m", "each", "*", "A", "each"),
        decider("d", [cond("each", ">", "B"), cond("A", "<", 50, { join: "and" })], [out("each"), out("C", 1)], [out("anything", 2)]),
        selector("r", { operation: "random", interval: 3 }),
        selector("s", { operation: "select", max: false, index: operand(1), indexComparator: "<=" }),
        selector("t", { operation: "time", gameTick: { kind: "virtual", name: "signal-T" } }),
        lamp("l", { condition: { first: { kind: "virtual", name: "signal-anything" }, comparator: ">", second: { type: "constant", value: 20 } }, useColors: true, colorMode: "packed-rgb", rgbSignal: { kind: "virtual", name: "signal-A" } }),
      ],
      [
        wire("red", "c.out", "n.in"),
        wire("red", "n.out", "n.in"),
        wire("green", "n.out", "m.in"),
        wire("green", "c.out", "m.in"),
        wire("red", "m.out", "d.in"),
        wire("green", "t.out", "d.in"),
        wire("red", "d.out", "r.in"),
        wire("green", "c.out", "r.in"),
        wire("red", "r.out", "s.in"),
        wire("green", "m.out", "s.in"),
        wire("red", "s.out", "l.in"),
        wire("green", "d.out", "l.in"),
      ],
    );

  const timeline = (c: Circuit, ticks: number, seed = 1): string[] => {
    const simulation = createSimulation(compile(c), { seed });
    return Array.from({ length: ticks + 1 }, (_, tick) => (tick > 0 && simulation.step(), JSON.stringify(simulation.snapshot())));
  };

  it("is independent of entity and wire order: shuffled circuits yield identical snapshots", () => {
    const original = mesh();
    const reference = timeline(original, 40);
    let state = 12345;
    const random = (): number => ((state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff), state / 0x80000000);
    const shuffle = <T>(list: readonly T[]): T[] => {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    };
    for (let round = 0; round < 5; round++) {
      const shuffled: Circuit = { name: original.name, entities: shuffle(original.entities), wires: shuffle(original.wires).map((w, i) => (i % 2 ? { color: w.color, a: w.b, b: w.a } : w)) };
      expect(timeline(shuffled, 40)).toEqual(reference);
    }
    expect(new Set(reference).size).toBeGreaterThan(30);
  });

  it("produces the same result for the same seed and a different random sequence for another seed", () => {
    expect(timeline(mesh(), 60, 7)).toEqual(timeline(mesh(), 60, 7));
    expect(timeline(mesh(), 60, 7)).not.toEqual(timeline(mesh(), 60, 8));
  });

  it("reset reproduces the run from tick 0", () => {
    const simulation = createSimulation(compile(mesh()), { seed: 3 });
    const run = (): string[] => Array.from({ length: 50 }, () => (simulation.step(), JSON.stringify(simulation.snapshot())));
    const initial = JSON.stringify(simulation.snapshot());
    const first = run();
    simulation.reset();
    expect(simulation.tick).toBe(0);
    expect(JSON.stringify(simulation.snapshot())).toBe(initial);
    expect(run()).toEqual(first);
  });

  it("matches a from-scratch run when stepping in batches (change-driven scheduling is exact)", () => {
    const batched = createSimulation(compile(mesh()), { seed: 1 });
    batched.step(17);
    batched.step(20);
    batched.step(3);
    expect(JSON.stringify(batched.snapshot())).toBe(timeline(mesh(), 40)[40]);
  });
});

describe("snapshots", () => {
  it("are frozen plain data and survive a structured clone unchanged", () => {
    const simulation = simulate(chain(), 3);
    const snapshot = simulation.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.networks)).toBe(true);
    expect(Object.isFrozen(snapshot.networks[0]!.signals)).toBe(true);
    expect(Object.isFrozen(snapshot.networks[0]!.signals[0])).toBe(true);
    expect(Object.isFrozen(snapshot.entities.a1)).toBe(true);
    expect(structuredClone(snapshot)).toEqual(snapshot);
    expect(structuredClone(simulation.compiled)).toEqual(simulation.compiled);
  });

  it("return the same object within a tick and share unchanged parts between ticks", () => {
    const simulation = simulate(chain(), 1);
    const before = simulation.snapshot();
    expect(simulation.snapshot()).toBe(before);
    simulation.step();
    const after = simulation.snapshot();
    expect(after).not.toBe(before);
    expect(after.tick).toBe(2);
    expect(after.entities.c).toBe(before.entities.c);
    expect(after.entities.a1!.output).toBe(before.entities.a1!.output);
    expect(after.entities.a2).not.toBe(before.entities.a2);
    simulation.step(10);
    const settled = simulation.snapshot();
    simulation.step();
    expect(simulation.snapshot().networks).toBe(settled.networks);
    expect(simulation.snapshot().entities).toBe(settled.entities);
  });

  it("list signals in the environment's signal order, without zero values", () => {
    const c = circuit([constant("c", { Z: 1, A: 2, "item:iron-plate": 3, "item:iron-plate@rare": 4, "item:iron-plate@legendary": 5, "fluid:water": 6, B: 0 }), lamp("l")], [wire("red", "c.out", "l.in")]);
    const signals = simulate(c).snapshot().networks[0]!.signals;
    expect(signals.map((e) => e.key)).toEqual(["fluid:water", "item:iron-plate", "item:iron-plate@rare", "item:iron-plate@legendary", "virtual:signal-A", "virtual:signal-Z"]);
    expect(signals[2]).toEqual({ signal: { kind: "item", name: "iron-plate", quality: "rare" }, key: "item:iron-plate@rare", value: 4 });
  });

  it("report totals", () => {
    const c = circuit([constant("c", { A: 1, B: 2 }), arithmetic("a", "A", "+", 0, "A"), lamp("on", { alwaysOn: true }), lamp("off")], [wire("red", "c.out", "a.in"), wire("green", "a.out", "on.in")]);
    expect(simulate(c, 1).snapshot().totals).toEqual({ entities: 4, networks: 2, signals: 3, emitting: 2, lampsLit: 1 });
  });

  it("probe reads networks and terminals without a snapshot", () => {
    const c = circuit([constant("r", { A: 3 }), constant("g", { A: 4 }), arithmetic("a", "A", "*", 2, "B")], [wire("red", "r.out", "a.in"), wire("green", "g.out", "a.in")]);
    const simulation = simulate(c, 1);
    const key = "virtual:signal-A";
    expect(simulation.probe({ type: "network", id: "red:a.in" }, key)).toBe(3);
    expect(simulation.probe({ type: "network", id: "green:a.in" }, key)).toBe(4);
    expect(simulation.probe({ type: "terminal", entity: "a", side: "in", color: "red" }, key)).toBe(3);
    expect(simulation.probe({ type: "terminal", entity: "a", side: "in", color: "green" }, key)).toBe(4);
    expect(simulation.probe({ type: "terminal", entity: "a", side: "in" }, key)).toBe(7);
    expect(simulation.probe({ type: "terminal", entity: "a", side: "out" }, "virtual:signal-B")).toBe(14);
    expect(simulation.probe({ type: "terminal", entity: "r", side: "out" }, key)).toBe(3);
    expect(simulation.probe({ type: "terminal", entity: "nope", side: "out" }, key)).toBe(0);
    expect(simulation.probe({ type: "network", id: "red:nope" }, key)).toBe(0);
    expect(simulation.probe({ type: "terminal", entity: "a", side: "in" }, "virtual:signal-unseen")).toBe(0);
  });
});
