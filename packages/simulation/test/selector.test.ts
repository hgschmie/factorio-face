import { describe, expect, it } from "vitest";
import type { Comparator, SelectorMode } from "@face/model";
import { createEnvironment } from "../src/index.ts";
import { createRandom, entitySeed } from "../src/selector.ts";
import { EACH, arithmetic, circuit, constant, evaluate, operand, outputOf, selector, sig, simulate, v, wire, type Values } from "./helpers.ts";

const select = (max: boolean, index: number | string, indexComparator: Comparator = "="): SelectorMode => ({ operation: "select", max, index: operand(index), indexComparator });
const run = (mode: SelectorMode, red: Values, green?: Values, environment = createEnvironment()) => evaluate(selector("s", mode), { red, green, environment });

describe("selector: select", () => {
  const input = { A: 5, B: 9, C: -3, D: 7 };

  it("documented: descending index 0 is the highest value, ascending index 0 the lowest", () => {
    expect(run(select(true, 0), input)).toEqual(v({ B: 9 }));
    expect(run(select(true, 1), input)).toEqual(v({ D: 7 }));
    expect(run(select(false, 1), input)).toEqual(v({ A: 5 }));
  });

  it("F-16 assumption: negative values sort as signed numbers", () => {
    expect(run(select(false, 0), input)).toEqual(v({ C: -3 }));
    expect(run(select(true, 3), input)).toEqual(v({ C: -3 }));
  });

  it("documented: with several inputs an out-of-range index selects nothing", () => {
    expect(run(select(true, 4), input)).toEqual({});
    expect(run(select(true, 1000), input)).toEqual({});
  });

  it("F-16 assumption: a negative index selects nothing", () => {
    expect(run(select(true, -1), input)).toEqual({});
  });

  it("documented: a single input signal always passes, even with the index out of range", () => {
    expect(run(select(true, 5), { A: 4 })).toEqual(v({ A: 4 }));
    expect(run(select(false, -2), { A: 4 })).toEqual(v({ A: 4 }));
  });

  it("F-16 assumption: equal values keep signal order in both sort directions", () => {
    const ties = { C: 5, A: 5, B: 5, D: 1 };
    expect([0, 1, 2].map((i) => Object.keys(run(select(true, i), ties))[0])).toEqual(["virtual:signal-A", "virtual:signal-B", "virtual:signal-C"]);
    expect([1, 2, 3].map((i) => Object.keys(run(select(false, i), ties))[0])).toEqual(["virtual:signal-A", "virtual:signal-B", "virtual:signal-C"]);
    const order = createEnvironment({ signalOrder: ["virtual:signal-C", "virtual:signal-B"] });
    expect(run(select(true, 0), ties, undefined, order)).toEqual(v({ C: 5 }));
  });

  it("F-16 assumption: quality variants are separate signals, ordered by level on ties", () => {
    const variants = { "item:iron-plate": 5, "item:iron-plate@legendary": 5, "item:iron-plate@rare": 8 };
    expect(run(select(true, 0), variants)).toEqual(v({ "item:iron-plate@rare": 8 }));
    expect(run(select(true, 1), variants)).toEqual(v({ "item:iron-plate": 5 }));
    expect(run(select(true, 2), variants)).toEqual(v({ "item:iron-plate@legendary": 5 }));
  });

  it("F-16 assumption: the index signal supplies the index and takes part in the sort", () => {
    expect(run(select(true, "I"), { ...input, I: 1 })).toEqual(v({ D: 7 }));
    expect(run(select(true, "I"), { ...input, I: 4 })).toEqual(v({ C: -3 }));
    expect(run(select(false, "I"), { ...input, I: 1 })).toEqual(v({ I: 1 }));
    expect(run(select(true, "I"), input)).toEqual(v({ B: 9 }));
  });

  it("F-16 assumption: an index comparator selects every sorted position p with p <comparator> index", () => {
    expect(run(select(true, 2, "<"), input)).toEqual(v({ B: 9, D: 7 }));
    expect(run(select(true, 2, "<="), input)).toEqual(v({ B: 9, D: 7, A: 5 }));
    expect(run(select(true, 2, ">"), input)).toEqual(v({ C: -3 }));
    expect(run(select(true, 2, ">="), input)).toEqual(v({ A: 5, C: -3 }));
    expect(run(select(true, 2, "!="), input)).toEqual(v({ B: 9, D: 7, C: -3 }));
    expect(run(select(false, 2, "<"), input)).toEqual(v({ C: -3, A: 5 }));
    expect(run(select(true, 0, "<"), input)).toEqual({});
    expect(run(select(true, 9, ">"), { A: 4 })).toEqual({});
  });

  it("documented: reads the sum of red and green", () => {
    expect(run(select(true, 0), { A: 5, B: 4 }, { B: 3 })).toEqual(v({ B: 7 }));
  });

  it("F-07 assumption: signals that cancel between red and green are not selected or counted", () => {
    expect(run(select(false, 0), { A: 3, B: 4 }, { A: -3 })).toEqual(v({ B: 4 }));
    expect(run({ operation: "count", output: sig("N") }, { A: 3, B: 4 }, { A: -3 })).toEqual(v({ N: 1 }));
  });

  it("emits nothing without input", () => {
    expect(run(select(true, 0), {})).toEqual({});
  });
});

describe("selector: count", () => {
  it("documented: emits the number of distinct input signals, ignoring values", () => {
    expect(run({ operation: "count", output: sig("N") }, { A: 5, B: -9, "fluid:water": 1 })).toEqual(v({ N: 3 }));
    expect(run({ operation: "count", output: sig("N") }, {})).toEqual({});
    expect(run({ operation: "count" }, { A: 5 })).toEqual({});
  });

  it("F-17 assumption: quality variants of one prototype count separately", () => {
    expect(run({ operation: "count", output: sig("N") }, { "item:iron-plate": 1, "item:iron-plate@rare": 1, "item:iron-plate@epic": 1 })).toEqual(v({ N: 3 }));
  });
});

describe("selector: stack size and rocket capacity", () => {
  const environment = createEnvironment({
    stackSizes: { "item:iron-plate": 100, "item:pistol": 5 },
    rocketCapacities: { "item:iron-plate": 1000, "item:pistol": 100, "item:atomic-bomb": 0 },
  });
  const input = { "item:iron-plate": 7, "item:iron-plate@rare": -1, "item:pistol": 1, "fluid:water": 50, A: 3 };

  it("F-17 assumption: stack-size emits the stack size on each item signal, keeps quality, ignores values and drops other kinds", () => {
    expect(run({ operation: "stack-size" }, input, undefined, environment)).toEqual(v({ "item:iron-plate": 100, "item:iron-plate@rare": 100, "item:pistol": 5 }));
  });

  it("F-17 assumption: rocket-capacity emits the environment's capacity per item signal; capacity 0 emits nothing", () => {
    expect(run({ operation: "rocket-capacity" }, { ...input, "item:atomic-bomb": 1 }, undefined, environment)).toEqual(v({ "item:iron-plate": 1000, "item:iron-plate@rare": 1000, "item:pistol": 100 }));
  });

  it("reports a runtime note once per signal without a value and emits nothing for it: warning for items, info for other kinds", () => {
    const c = circuit([constant("c", { "item:iron-plate": 1, "item:mystery": 2, "fluid:water": 3 }), selector("s", { operation: "rocket-capacity" }), selector("z", { operation: "stack-size" })], [wire("red", "c.out", "s.in"), wire("red", "c.out", "z.in")]);
    const simulation = simulate(c, 0, { environment });
    expect(simulation.runtimeNotes()).toEqual([]);
    simulation.step(5);
    expect(outputOf(simulation, "s")).toEqual(v({ "item:iron-plate": 1000 }));
    const notes = simulation.runtimeNotes().map((n) => `${n.severity} ${n.code} ${n.entity} ${n.signal}`).sort();
    expect(notes).toEqual([
      "info missing-rocket-capacity s fluid:water",
      "info missing-stack-size z fluid:water",
      "warning missing-rocket-capacity s item:mystery",
      "warning missing-stack-size z item:mystery",
    ]);
    simulation.reset();
    expect(simulation.runtimeNotes()).toEqual([]);
    simulation.step();
    expect(simulation.runtimeNotes()).toHaveLength(4);
  });

  it("the default environment knows no stack sizes", () => {
    expect(run({ operation: "stack-size" }, input)).toEqual({});
  });
});

describe("selector: quality modes", () => {
  const input = { "item:iron-plate": 1, "item:iron-plate@uncommon": 2, "item:iron-plate@rare": 3, "item:iron-plate@epic": 4, "item:iron-plate@legendary": 5, "fluid:water": 6, "item:gear@rare": 7 };

  it("F-18 assumption: quality-filter compares quality levels with every comparator", () => {
    const filter = (comparator: Comparator, quality: string) => Object.values(run({ operation: "quality-filter", comparator, quality }, input)).sort();
    expect(filter("=", "rare")).toEqual([3, 7]);
    expect(filter("!=", "rare")).toEqual([1, 2, 4, 5, 6]);
    expect(filter(">", "rare")).toEqual([4, 5]);
    expect(filter(">=", "rare")).toEqual([3, 4, 5, 7]);
    expect(filter("<", "rare")).toEqual([1, 2, 6]);
    expect(filter("<=", "uncommon")).toEqual([1, 2, 6]);
    expect(filter("=", "normal")).toEqual([1, 6]);
  });

  it("F-18 assumption: legendary is level 5, so it is greater than epic and there is no level 4", () => {
    const environment = createEnvironment();
    expect(environment.qualities.map((q) => q.level)).toEqual([0, 1, 2, 3, 5]);
    expect(run({ operation: "quality-filter", comparator: ">", quality: "epic" }, input)).toEqual(v({ "item:iron-plate@legendary": 5 }));
  });

  it("F-18 assumption: quality-filter without a quality passes everything; the comparator defaults to =", () => {
    expect(run({ operation: "quality-filter" }, input)).toEqual(v(input));
    expect(run({ operation: "quality-filter", quality: "epic" }, input)).toEqual(v({ "item:iron-plate@epic": 4 }));
  });

  it("F-18 assumption: signals of a quality unknown to the environment are dropped with a runtime note", () => {
    const c = circuit([constant("c", { "item:gear@mythic": 1, "item:gear": 2 }), selector("s", { operation: "quality-filter", comparator: ">=", quality: "normal" })], [wire("red", "c.out", "s.in")]);
    const simulation = simulate(c, 2);
    expect(outputOf(simulation, "s")).toEqual(v({ "item:gear": 2 }));
    expect(simulation.runtimeNotes()).toMatchObject([{ code: "unknown-quality", entity: "s", signal: "item:gear@mythic" }]);
  });

  it("F-18 assumption: quality-select passes the highest or lowest quality per prototype with its value", () => {
    expect(run({ operation: "quality-select", highest: true }, input)).toEqual(v({ "item:iron-plate@legendary": 5, "fluid:water": 6, "item:gear@rare": 7 }));
    expect(run({ operation: "quality-select", highest: false }, input)).toEqual(v({ "item:iron-plate": 1, "fluid:water": 6, "item:gear@rare": 7 }));
    expect(run({ operation: "quality-select", highest: false }, { "item:a@rare": -1, "item:a@epic": 9, "fluid:a@epic": 2 })).toEqual(v({ "item:a@rare": -1, "fluid:a@epic": 2 }));
  });

  it("F-18 assumption: quality-transfer with a fixed quality re-labels the target signal, keeping its value", () => {
    const mode = (quality: string, destination = sig("item:gear")): SelectorMode => ({ operation: "quality-transfer", source: { type: "quality", quality }, destination });
    expect(run(mode("epic"), { "item:gear": 7, "item:gear@rare": 100, A: 1 })).toEqual(v({ "item:gear@epic": 7 }));
    expect(run(mode("normal", sig("item:gear@rare")), { "item:gear": 7, "item:gear@rare": 100 })).toEqual(v({ "item:gear": 100 }));
    expect(run(mode("epic"), { "item:gear@rare": 100, A: 1 })).toEqual({});
    expect(run(mode("epic", sig("A")), { A: 3 })).toEqual(v({ "virtual:signal-A@epic": 3 }));
  });

  it("F-18 assumption: quality-transfer from a signal takes the highest quality at which the source prototype is present", () => {
    const mode: SelectorMode = { operation: "quality-transfer", source: { type: "signal", signal: sig("item:iron-plate") }, destination: sig("A") };
    expect(run(mode, { A: 9, "item:iron-plate@uncommon": 1, "item:iron-plate@epic": -1, "item:gear@legendary": 1 })).toEqual(v({ "virtual:signal-A@epic": 9 }));
    expect(run(mode, { A: 9, "item:iron-plate": 1 })).toEqual(v({ A: 9 }));
    expect(run(mode, { A: 9, "item:gear@legendary": 1 })).toEqual({});
    expect(run(mode, { "item:iron-plate@rare": 1 })).toEqual({});
    expect(run({ ...mode, source: { type: "signal", signal: sig("item:iron-plate@legendary") } }, { A: 9, "item:iron-plate@rare": 1 })).toEqual(v({ "virtual:signal-A@rare": 9 }));
  });

  it("F-18 assumption: an each target re-labels every input signal; collapsing signals add up", () => {
    const mode: SelectorMode = { operation: "quality-transfer", source: { type: "quality", quality: "rare" }, destination: EACH };
    expect(run(mode, { "item:gear": 1, "item:gear@rare": 2, "item:gear@epic": 4, "fluid:water": 8 })).toEqual(v({ "item:gear@rare": 7, "fluid:water@rare": 8 }));
    expect(run(mode, { "item:gear": 1, "item:gear@rare": -1 })).toEqual({});
    const fromSignal: SelectorMode = { operation: "quality-transfer", source: { type: "signal", signal: sig("Q") }, destination: EACH };
    expect(run(fromSignal, { "virtual:signal-Q@uncommon": 1, "item:gear": 5 })).toEqual(v({ "virtual:signal-Q@uncommon": 1, "item:gear@uncommon": 5 }));
  });

  it("emits nothing while the transfer is unconfigured", () => {
    expect(run({ operation: "quality-transfer", source: { type: "quality", quality: "rare" } }, { A: 1 })).toEqual({});
    expect(run({ operation: "quality-transfer", source: { type: "signal" }, destination: sig("A") }, { A: 1 })).toEqual({});
  });
});

describe("selector: time", () => {
  const T = sig("T");
  const D = sig("D");
  const L = sig("L");
  const clock = (environment = createEnvironment(), mode: SelectorMode = { operation: "time", gameTick: T, dayTick: D, dayLength: L }) => simulate(circuit([selector("s", mode)]), 0, { environment });

  it("F-19 assumption: emits the game tick of the evaluating tick one tick later; day length defaults to 25000", () => {
    const simulation = clock();
    expect(outputOf(simulation, "s")).toEqual({});
    simulation.step();
    expect(outputOf(simulation, "s")).toEqual(v({ L: 25000 }));
    simulation.step();
    expect(outputOf(simulation, "s")).toEqual(v({ T: 1, D: 1, L: 25000 }));
    simulation.step(98);
    expect(outputOf(simulation, "s")).toEqual(v({ T: 99, D: 99, L: 25000 }));
  });

  it("F-19 assumption: the day tick restarts at the day length; the clock origin shifts the game tick", () => {
    const simulation = clock(createEnvironment({ time: { dayLength: 100, startTick: 250 } }));
    const samples = [1, 50, 51, 52].map((tick) => (simulation.step(tick - simulation.tick), outputOf(simulation, "s")));
    expect(samples).toEqual([v({ T: 250, D: 50, L: 100 }), v({ T: 299, D: 99, L: 100 }), v({ T: 300, L: 100 }), v({ T: 301, D: 1, L: 100 })]);
  });

  it("F-19 assumption: the game tick wraps to int32 while the day tick continues", () => {
    const simulation = clock(createEnvironment({ time: { startTick: 2147483647 } }));
    simulation.step();
    expect(outputOf(simulation, "s")).toEqual(v({ T: 2147483647, D: 2147483647 % 25000, L: 25000 }));
    simulation.step();
    expect(outputOf(simulation, "s")).toEqual(v({ T: -2147483648, D: 2147483648 % 25000, L: 25000 }));
  });

  it("F-19 assumption: unset slots emit nothing and slots sharing a signal add up", () => {
    const only = clock(undefined, { operation: "time", dayLength: L });
    only.step(3);
    expect(outputOf(only, "s")).toEqual(v({ L: 25000 }));
    const shared = clock(undefined, { operation: "time", gameTick: T, dayTick: T });
    shared.step(11);
    expect(outputOf(shared, "s")).toEqual(v({ T: 20 }));
  });
});

describe("selector: random", () => {
  const input = { A: 1, B: 2, C: 3, D: 4, E: 5 };
  const build = (interval: number, values: Values = input) => circuit([constant("c", values), selector("r", { operation: "random", interval })], [wire("red", "c.out", "r.in")]);
  const sequence = (interval: number, ticks: number, seed = 1, values: Values = input): string[] => {
    const simulation = simulate(build(interval, values), 0, { seed });
    return Array.from({ length: ticks }, () => (simulation.step(), JSON.stringify(outputOf(simulation, "r"))));
  };

  it("F-19 assumption: passes exactly one input signal with its value", () => {
    for (const entry of sequence(1, 50)) {
      const [key, value] = Object.entries(JSON.parse(entry) as Record<string, number>)[0]!;
      expect(v(input)[key]).toBe(value);
    }
    expect(new Set(sequence(1, 200)).size).toBe(5);
  });

  it("F-19 assumption: draws at every tick divisible by the interval and holds the choice in between", () => {
    const values = sequence(10, 60);
    for (let start = 0; start < 60; start += 10) expect(new Set(values.slice(start, start + 10)).size).toBe(1);
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it("F-19 assumption: intervals 0 and 1 both draw every tick", () => {
    expect(sequence(0, 40)).toEqual(sequence(1, 40));
  });

  it("F-19 assumption: a single input signal is always the one passed", () => {
    expect(new Set(sequence(7, 30, 1, { A: 4 }))).toEqual(new Set([JSON.stringify(v({ A: 4 }))]));
  });

  it("is deterministic per seed and entity, and independent between entities", () => {
    expect(sequence(1, 100, 5)).toEqual(sequence(1, 100, 5));
    expect(sequence(1, 100, 5)).not.toEqual(sequence(1, 100, 6));
    expect(entitySeed(1, "a")).not.toBe(entitySeed(1, "b"));
    const random = createRandom(42);
    const first = [random.next(), random.next(), random.next()];
    random.reset();
    expect([random.next(), random.next(), random.next()]).toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("F-19 assumption: the held signal passes with its current value and nothing passes while it is absent", () => {
    const random = selector("r", { operation: "random", interval: 1000 });
    // A self-wired counter on the input: the signal drawn at tick 0 keeps passing with its changing value.
    const counting = circuit([constant("one", { A: 1 }), arithmetic("n", "A", "+", 0, "A"), random], [wire("red", "one.out", "n.in"), wire("red", "n.out", "n.in"), wire("red", "n.out", "r.in")]);
    const simulation = simulate(counting, 2);
    expect(outputOf(simulation, "r")).toEqual(v({ A: 2 }));
    simulation.step(3);
    expect(outputOf(simulation, "r")).toEqual(v({ A: 5 }));
    // The input arrives one tick after the draw at tick 0, so nothing passes until the next draw at tick 1000.
    const late = circuit([constant("one", { A: 1 }), arithmetic("delay", "A", "+", 0, "A"), random], [wire("red", "one.out", "delay.in"), wire("red", "delay.out", "r.in")]);
    const waiting = simulate(late, 1000);
    expect(outputOf(waiting, "r")).toEqual({});
    waiting.step();
    expect(outputOf(waiting, "r")).toEqual(v({ A: 1 }));
  });
});
