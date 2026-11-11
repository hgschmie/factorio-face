import { describe, expect, it } from "vitest";
import type { ArithmeticOperation, Circuit, Entity, Wire } from "@face/model";
import { History, compile, createSimulation } from "../src/index.ts";
import { GREEN, RED, arithmetic, circuit, constant, operand, wire } from "./helpers.ts";

const SIZE = 1000;
const TICKS = 1000;
/** Generous ceiling so the test does not flake on a loaded machine; the measured figures are printed. */
const LIMIT_MS = 10000;

/**
 * `driver` -> 1,000 arithmetic stages. With a constant driver stage i keeps changing until about tick i and the chain is settled
 * after 1,000 ticks; with a counter as driver every stage changes every tick.
 */
function chain(counter: boolean): Circuit {
  const entities: Entity[] = [constant("seed", { A: 1 }), arithmetic("driver", "A", "+", 0, "A")];
  const wires: Wire[] = [wire("red", "seed.out", "driver.in"), ...(counter ? [wire("red", "driver.out", "driver.in")] : [])];
  for (let i = 0; i < SIZE; i++) {
    entities.push(arithmetic(`s${i}`, "A", "+", 1, "A"));
    wires.push(wire("green", i === 0 ? "driver.out" : `s${i - 1}.out`, `s${i}.in`));
  }
  return circuit(entities, wires);
}

/** 1,000 combinators in a ring (red) with a second, scrambled feedback path (green) and a constant on every tenth node. */
function mesh(): Circuit {
  const operations: ArithmeticOperation[] = ["+", "XOR", "-", "+"];
  const entities: Entity[] = [];
  const wires: Wire[] = [];
  for (let i = 0; i < SIZE; i++) {
    entities.push(arithmetic(`m${i}`, operand("A", RED), operations[i % 4]!, operand("A", GREEN), "A"));
    wires.push(wire("red", `m${i}.out`, `m${(i + 1) % SIZE}.in`), wire("green", `m${(i * 7 + 3) % SIZE}.out`, `m${i}.in`));
    if (i % 10 === 0) {
      entities.push(constant(`k${i}`, { A: i + 1 }));
      wires.push(wire("red", `k${i}.out`, `m${i}.in`));
    }
  }
  return circuit(entities, wires);
}

function measure(label: string, c: Circuit, withHistory = false, warmup = 0): number {
  const compileStart = performance.now();
  const simulation = createSimulation(compile(c));
  const setup = performance.now() - compileStart;
  simulation.step(warmup);
  const history = withHistory ? new History({ capacity: 600 }) : undefined;
  const start = performance.now();
  for (let tick = 0; tick < TICKS; tick++) {
    simulation.step();
    history?.record(simulation.snapshot());
  }
  const elapsed = performance.now() - start;
  const totals = simulation.snapshot().totals;
  console.log(`[perf] ${label}: compile+create ${setup.toFixed(1)} ms, ${TICKS} ticks ${elapsed.toFixed(1)} ms (${((elapsed * 1000) / TICKS).toFixed(1)} us/tick), ${totals.emitting} emitting, ${totals.networks} networks`);
  return elapsed;
}

describe("performance", () => {
  it("runs 1,000 combinators in a chain for 1,000 ticks", () => {
    expect(measure("chain, constant input (settling)", chain(false))).toBeLessThan(LIMIT_MS);
    expect(measure("chain, constant input, after settling (idle)", chain(false), false, 1100)).toBeLessThan(LIMIT_MS);
    expect(measure("chain, constant input, idle, snapshot + history each tick", chain(false), true, 1100)).toBeLessThan(LIMIT_MS);
    expect(measure("chain, counter input (every stage changes)", chain(true))).toBeLessThan(LIMIT_MS);
    expect(measure("chain, counter input, snapshot + history each tick", chain(true), true)).toBeLessThan(LIMIT_MS);
  });

  it("runs 1,000 combinators in a feedback mesh for 1,000 ticks", () => {
    expect(measure("feedback mesh (all active)", mesh())).toBeLessThan(LIMIT_MS);
    expect(measure("feedback mesh, snapshot + history each tick", mesh(), true)).toBeLessThan(LIMIT_MS);
  });

  it("keeps the mesh active: values keep changing, so the measurement is not of an idle circuit", () => {
    const simulation = createSimulation(compile(mesh()));
    simulation.step(500);
    const before = JSON.stringify(simulation.snapshot().networks);
    simulation.step();
    const after = simulation.snapshot();
    expect(JSON.stringify(after.networks)).not.toBe(before);
    expect(after.totals.emitting).toBeGreaterThan(900);
  });
});
