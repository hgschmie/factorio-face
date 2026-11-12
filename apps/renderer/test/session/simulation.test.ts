// The simulation runs on the real engine, follows the circuit and never touches the document.
import { describe, expect, it } from "vitest";
import { HISTORY_TICKS } from "../../src/session/simulationRunner.ts";
import type { SignalTrace } from "../../src/workbench/controller.ts";
import { createSession, entityNamed, idOf, IRREGULAR, replaceText, type } from "./helpers.ts";

function trace(traces: readonly SignalTrace[], label: string): SignalTrace {
  const found = traces.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`No trace "${label}" among ${traces.map((candidate) => candidate.label).join(", ")}`);
  return found;
}

describe("simulation of the example circuit", () => {
  it("shows the expected values tick by tick in traces and card statuses", () => {
    const { session } = createSession();
    const { source, gate, twice, light } = Object.fromEntries(session.state.circuit.entities.map((entity) => [entity.name, entity.id]));
    const status = (id: string | undefined): string | undefined => session.state.simulation.entityStatus.get(id!)?.label;
    session.commands.select([gate!, twice!, light!]);

    // Tick 0: only the constant emits.
    expect(session.state.simulation).toMatchObject({ available: true, running: false, tick: 0, historyLength: HISTORY_TICKS });
    expect([status(source), status(gate), status(twice), status(light)]).toEqual(["A 1", "no output", "no output", "off"]);
    expect(session.state.simulation.traces.map((row) => [row.label, row.current])).toEqual([["gate", "no output"], ["twice", "no output"], ["light light", "off"]]);

    // The gate passes its input (1 from the constant plus its own output) while it is below 10: it counts 1..9, then the
    // condition fails once, the output clears and the count starts again. `twice` follows one tick later with double the value.
    const gateValues: string[] = [];
    const twiceValues: string[] = [];
    const lamp: string[] = [];
    for (let tick = 1; tick <= 12; tick++) {
      session.commands.step();
      expect(session.state.simulation.tick).toBe(tick);
      gateValues.push(status(gate)!);
      twiceValues.push(status(twice)!);
      lamp.push(status(light)!);
    }
    expect(gateValues).toEqual(["A 1", "A 2", "A 3", "A 4", "A 5", "A 6", "A 7", "A 8", "A 9", "no output", "A 1", "A 2"]);
    expect(twiceValues).toEqual(["no output", "B 2", "B 4", "B 6", "B 8", "B 10", "B 12", "B 14", "B 16", "B 18", "no output", "B 2"]);
    // The lamp reads B > 8 from the current tick's network.
    expect(lamp).toEqual(["off", "off", "off", "off", "off", "lit", "lit", "lit", "lit", "lit", "off", "off"]);

    const traces = session.state.simulation.traces;
    expect(trace(traces, "gate A")).toMatchObject({ values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2], current: "2", signal: { kind: "virtual", name: "signal-A" } });
    expect(trace(traces, "twice B")).toMatchObject({ values: [0, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 0, 2], current: "2" });
    expect(trace(traces, "light light")).toMatchObject({ values: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0], current: "off", lamp: { lit: false } });
    // What an entity reads is available per wire color.
    expect(trace(traces, "gate A").inputs).toBe("Input red: A 1\nInput green: A 2\nInput sum: A 3");
    expect(trace(traces, "twice B").inputs).toBe("Input red: A 2\nInput green: nothing\nInput sum: A 2");
    expect(session.state.simulation.entityStatus.get(gate!)).toMatchObject({ active: false, signals: [{ signal: { kind: "virtual", name: "signal-A" }, value: 2 }] });

    // Lit lamps are active; reset returns to tick 0.
    for (let tick = 13; tick <= 17; tick++) session.commands.step();
    expect(session.state.simulation.entityStatus.get(light!)).toEqual({ label: "lit", active: true, color: undefined });
    session.commands.resetSimulation();
    expect(session.state.simulation).toMatchObject({ tick: 0, running: false });
    expect(status(gate)).toBe("no output");
    expect(trace(session.state.simulation.traces, "gate").values).toEqual([]);
  });

  it("traces the first entities when nothing is selected and follows the selection", () => {
    const { session } = createSession();
    session.commands.step();
    expect(session.state.simulation.traces.map((row) => row.label)).toEqual(["source A", "gate A", "twice"]);
    session.commands.select([idOf(session, "light")]);
    expect(session.state.simulation.traces.map((row) => row.label)).toEqual(["light light"]);
    expect(session.state.simulation.traces[0]!.inputs).toBe("Input red: nothing\nInput green: nothing\nInput sum: nothing");
    session.commands.select([]);
    expect(session.state.simulation.traces).toHaveLength(3);
  });

  it("reports the color of a lamp that is lit with a color", () => {
    const { session } = createSession('circuit "c" {\n  constant c at (0, 0) { virtual:signal-A = 5 }\n  lamp l at (300, 0) { when virtual:signal-A > 1  color = #ff8000 }\n  wire red c.out <-> l.in\n}\n');
    expect(session.state.simulation.entityStatus.get(idOf(session, "l"))).toEqual({ label: "lit #ff8000", active: true, color: "#ff8000" });
    session.commands.select([idOf(session, "l")]);
    expect(session.state.simulation.traces[0]).toMatchObject({ current: "lit #ff8000", lamp: { lit: true, color: "#ff8000" }, values: [1] });
  });

  it("keeps a bounded history", () => {
    const { session } = createSession();
    session.commands.select([idOf(session, "source")]);
    for (let tick = 0; tick < HISTORY_TICKS + 50; tick++) session.commands.step();
    const row = session.state.simulation.traces[0]!;
    expect(session.state.simulation.tick).toBe(HISTORY_TICKS + 50);
    expect(row.values).toHaveLength(HISTORY_TICKS);
  });
});

describe("simulation and the document", () => {
  it("stepping, running and resetting create no transaction and no undo entry", () => {
    const { session, scheduler } = createSession(IRREGULAR);
    const document = session.document.state;
    const version = session.document.version;
    session.commands.step();
    session.commands.run();
    scheduler.fire(25);
    session.commands.setSpeed(60);
    scheduler.fire(5);
    session.commands.pause();
    session.commands.step();
    expect(session.state.simulation.tick).toBe(32);
    session.commands.resetSimulation();
    session.commands.step();
    expect(session.document.state).toBe(document);
    expect(session.document.version).toBe(version);
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, canRedo: false });
    expect(session.state.project.dirty).toBe(false);
  });

  it("runs on a timer at the selected speed and stops when paused", () => {
    const { session, scheduler } = createSession();
    expect(session.state.simulation).toMatchObject({ speed: 2, speedOptions: [1, 2, 5, 10, 30, 60] });
    session.commands.run();
    session.commands.run();
    expect(scheduler.timers.map((timer) => timer.milliseconds)).toEqual([500]);
    expect(session.state.simulation.running).toBe(true);
    scheduler.fire(3);
    expect(session.state.simulation.tick).toBe(3);
    session.commands.setSpeed(10);
    session.commands.setSpeed(7);
    expect(scheduler.timers.map((timer) => timer.milliseconds)).toEqual([100]);
    session.commands.pause();
    expect(scheduler.timers).toEqual([]);
    expect(session.state.simulation).toMatchObject({ running: false, tick: 3, speed: 10 });
    session.dispose();
  });

  it("a move, a rename and a comment do not reset the tick; a semantic edit does", () => {
    const { session } = createSession(IRREGULAR);
    const gate = idOf(session, "gate");
    for (let tick = 0; tick < 4; tick++) session.commands.step();
    const statusBefore = session.state.simulation.entityStatus.get(gate);
    expect(statusBefore?.label).toBe("A 4");

    session.commands.moveEntities([{ id: gate, position: { x: 500, y: 300 } }]);
    expect(session.state.simulation.tick).toBe(4);
    session.commands.renameEntity(gate, "counter");
    expect(session.state.simulation.tick).toBe(4);
    type(session, 0, "/* layout and names are not behaviour */\n");
    replaceText(session, "// limit", "// a different comment");
    expect(session.state.simulation.tick).toBe(4);
    expect(session.state.simulation.entityStatus.get(gate)).toBe(statusBefore);
    // Traces use the new name and keep their history.
    session.commands.select([gate]);
    expect(session.state.simulation.traces[0]).toMatchObject({ label: "counter A", values: [0, 1, 2, 3, 4] });
    session.commands.step();
    expect(session.state.simulation.entityStatus.get(gate)?.label).toBe("A 5");

    // Changing a constant changes behaviour: the simulation starts over.
    const src = entityNamed(session, "src");
    if (src.kind !== "constant") throw new Error("src is a constant");
    session.commands.updateEntity({ ...src, sections: [{ ...src.sections[0]!, filters: [{ ...src.sections[0]!.filters[0]!, count: 3 }] }] });
    expect(session.state.simulation.tick).toBe(0);
    expect(session.state.simulation.traces[0]!.values).toEqual([]);
    session.commands.step();
    expect(session.state.simulation.entityStatus.get(gate)?.label).toBe("A 3");

    // So do a new wire and a typed change of a condition.
    session.commands.step();
    session.commands.addWire({ color: "red", a: { entity: gate, side: "out" }, b: { entity: idOf(session, "light"), side: "in" } });
    expect(session.state.simulation.tick).toBe(0);
    session.commands.step();
    replaceText(session, "< 10", "< 20");
    expect(session.state.simulation.tick).toBe(0);
    // Undo of a move keeps the state as well.
    session.commands.step();
    session.commands.moveEntities([{ id: gate, position: { x: 0, y: 0 } }]);
    session.commands.undo();
    expect(session.state.simulation.tick).toBe(1);
  });

  it("keeps running across a layout edit and restarts from tick 0 on a semantic edit", () => {
    const { session, scheduler } = createSession(IRREGULAR);
    session.commands.run();
    scheduler.fire(3);
    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 0, y: 0 } }]);
    expect(session.state.simulation).toMatchObject({ running: true, tick: 3 });
    replaceText(session, "< 10", "< 5");
    expect(session.state.simulation).toMatchObject({ running: true, tick: 0 });
    scheduler.fire(2);
    expect(session.state.simulation.tick).toBe(2);
  });

  it("only republishes cards whose state changed", () => {
    const { session } = createSession();
    session.commands.step();
    const before = session.state.simulation.entityStatus;
    session.commands.step();
    const after = session.state.simulation.entityStatus;
    expect(after).not.toBe(before);
    // The constant never changes; the gate does.
    expect(after.get(idOf(session, "source"))).toBe(before.get(idOf(session, "source")));
    expect(after.get(idOf(session, "gate"))).not.toBe(before.get(idOf(session, "gate")));
  });
});
