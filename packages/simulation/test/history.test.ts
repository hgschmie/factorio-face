import { describe, expect, it } from "vitest";
import { History, readSnapshot, signalValue } from "../src/index.ts";
import { arithmetic, circuit, constant, simulate, wire } from "./helpers.ts";

const A = "virtual:signal-A";
const counter = () => simulate(circuit([constant("one", { A: 1 }), arithmetic("n", "A", "+", 0, "A")], [wire("red", "one.out", "n.in"), wire("red", "n.out", "n.in"), wire("green", "n.out", "one.out")]));

function recorded(capacity: number, ticks: number) {
  const simulation = counter();
  const history = new History({ capacity });
  history.record(simulation.snapshot());
  for (let tick = 0; tick < ticks; tick++) {
    simulation.step();
    history.record(simulation.snapshot());
  }
  return { simulation, history };
}

describe("history", () => {
  it("keeps at most `capacity` snapshots and drops the oldest", () => {
    const { history } = recorded(10, 25);
    expect(history.capacity).toBe(10);
    expect(history.length).toBe(10);
    expect(history.oldest!.tick).toBe(16);
    expect(history.latest!.tick).toBe(25);
    expect(history.snapshots().map((s) => s.tick)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    expect(history.at(15)).toBeUndefined();
    expect(history.at(20)!.tick).toBe(20);
    expect(history.at(26)).toBeUndefined();
  });

  it("is not full before capacity is reached and defaults to 600 ticks", () => {
    const { history } = recorded(10, 3);
    expect(history.length).toBe(4);
    expect(history.oldest!.tick).toBe(0);
    expect(new History().capacity).toBe(600);
    expect(new History({ capacity: 0 }).capacity).toBe(1);
  });

  it("traces a signal on a network and on entity terminals", () => {
    const { history } = recorded(8, 5);
    const ticks = [0, 1, 2, 3, 4, 5];
    expect(history.trace({ type: "terminal", entity: "n", side: "out" }, A)).toEqual({ ticks, values: [0, 1, 2, 3, 4, 5] });
    expect(history.trace({ type: "network", id: "red:n.in" }, A)).toEqual({ ticks, values: [1, 2, 3, 4, 5, 6] });
    expect(history.trace({ type: "network", id: "green:n.out" }, A)).toEqual({ ticks, values: [1, 2, 3, 4, 5, 6] });
    expect(history.trace({ type: "terminal", entity: "n", side: "in", color: "red" }, A).values).toEqual([1, 2, 3, 4, 5, 6]);
    expect(history.trace({ type: "terminal", entity: "n", side: "in", color: "green" }, A).values).toEqual([0, 0, 0, 0, 0, 0]);
    expect(history.trace({ type: "terminal", entity: "n", side: "in" }, A).values).toEqual([1, 2, 3, 4, 5, 6]);
    expect(history.trace({ type: "terminal", entity: "one", side: "out" }, A).values).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("traces absent signals and unknown targets as 0", () => {
    const { history } = recorded(4, 2);
    expect(history.trace({ type: "network", id: "red:nope" }, A)).toEqual({ ticks: [0, 1, 2], values: [0, 0, 0] });
    expect(history.trace({ type: "terminal", entity: "nope", side: "in" }, A).values).toEqual([0, 0, 0]);
    expect(history.trace({ type: "terminal", entity: "n", side: "out" }, "virtual:signal-B").values).toEqual([0, 0, 0]);
    expect(history.trace({ type: "terminal", entity: "one", side: "in" }, A).values).toEqual([0, 0, 0]);
  });

  it("traces only the retained window", () => {
    const { history } = recorded(3, 10);
    expect(history.trace({ type: "terminal", entity: "n", side: "out" }, A)).toEqual({ ticks: [8, 9, 10], values: [8, 9, 10] });
  });

  it("replaces a snapshot of the latest tick, clears on an earlier tick (reset) and on clear()", () => {
    const { simulation, history } = recorded(10, 4);
    history.record(simulation.snapshot());
    expect(history.length).toBe(5);
    simulation.reset();
    history.record(simulation.snapshot());
    expect(history.snapshots().map((s) => s.tick)).toEqual([0]);
    simulation.step(3);
    history.record(simulation.snapshot());
    expect(history.snapshots().map((s) => s.tick)).toEqual([0, 3]);
    expect(history.at(3)!.tick).toBe(3);
    expect(history.at(2)).toBeUndefined();
    history.clear();
    expect(history.length).toBe(0);
    expect(history.latest).toBeUndefined();
    expect(history.trace({ type: "network", id: "red:n.in" }, A)).toEqual({ ticks: [], values: [] });
  });

  it("shares unchanged parts between retained snapshots (memory bound)", () => {
    const simulation = simulate(circuit([constant("c", { A: 5 }), arithmetic("a", "A", "+", 1, "A")], [wire("red", "c.out", "a.in")]));
    const history = new History({ capacity: 100 });
    for (let tick = 0; tick < 100; tick++) {
      history.record(simulation.snapshot());
      simulation.step();
    }
    const snapshots = history.snapshots();
    expect(new Set(snapshots.map((s) => s.networks)).size).toBe(1);
    expect(new Set(snapshots.map((s) => s.entities)).size).toBe(2);
    expect(new Set(snapshots.map((s) => s.entities.c)).size).toBe(1);
  });

  it("reads single values from a snapshot", () => {
    const { history } = recorded(4, 3);
    const snapshot = history.latest!;
    expect(readSnapshot(snapshot, { type: "network", id: "red:n.in" }, A)).toBe(4);
    expect(readSnapshot(snapshot, { type: "terminal", entity: "n", side: "out" }, A)).toBe(3);
    expect(signalValue(snapshot.entities.n!.output, A)).toBe(3);
    expect(signalValue(undefined, A)).toBe(0);
  });
});
