// The condition that is in use and names no signal (`when unset`), from a blueprint of the game through the editor and back.
// What the game writes for it and what it does with it is fixture F-29 (tests/fixtures/game/F-29-blank-condition.json).
import { readFileSync } from "node:fs";
import { analyze, printCircuit } from "@face/language";
import { PROTOTYPES, signal, tileCenter, UNSET_CONDITION, type Circuit, type Condition, type Entity } from "@face/model";
import { compile, createSimulation, type TickSnapshot } from "@face/simulation";
import { describe, expect, it } from "vitest";
import { A, blueprintOf, exported, imported, parse } from "./helpers.ts";
import { placed } from "./samples.ts";

interface Reading { readonly state: string; readonly error?: string; readonly fulfilled?: boolean; readonly disabled?: boolean; readonly exported?: Record<string, unknown> | null }
interface Case { readonly name: string; readonly kind: "onoff" | "wall" | "signal" | "speaker"; readonly flag?: string; readonly readings: readonly Reading[] }
const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/game/F-29-blank-condition.json", import.meta.url), "utf8")) as { readonly cases: readonly Case[] };
const reading = (probed: Case, state: string): Reading => probed.readings.find((one) => one.state === state && one.error === undefined)!;
/** The cases whose condition has a switch, with what the game wrote into a blueprint of the entity in a state. */
const switched = (state: string): (readonly [Case, Record<string, unknown>])[] => fixture.cases.flatMap((probed) => (probed.flag !== undefined && reading(probed, state)?.exported ? [[probed, reading(probed, state).exported!] as const] : []));

/** An entity with its top-left tile at (0, 0) below a constant combinator that sends signal-A = 1, with a red wire between them or none. */
function beside(name: string, control_behavior: Record<string, unknown>, wired = true): { blueprint: Record<string, unknown> } {
  const combinator = { entity_number: 2, name: "constant-combinator", position: { x: 0.5, y: -0.5 }, control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, ...A, quality: "normal", comparator: "=", count: 1 }] }] } } };
  return blueprintOf([{ entity_number: 1, name, position: tileCenter({ prototype: name }, "north", { x: 0, y: 0 }), control_behavior }, combinator], wired ? [[1, 1, 2, 1]] : []);
}

const behaviorOf = (circuit: Circuit): unknown => exported(circuit).blueprint.entities[0]!.control_behavior;
const conditionOf = (entity: Entity): unknown => (entity.kind === "lamp" ? entity.condition : entity.kind === "entity" ? Object.values(entity.settings).filter((value) => value === UNSET_CONDITION || typeof value === "object")[0] : undefined);

function simulated(circuit: Circuit): TickSnapshot {
  const simulation = createSimulation(compile(circuit));
  simulation.step(2);
  return simulation.snapshot();
}

describe("the unset condition: the belt of the question", () => {
  const pasted = beside("express-transport-belt", { circuit_enabled: true });

  it("imports without a note about its settings, as a belt whose condition is in use and unset", () => {
    const { circuit, report } = imported(pasted);
    expect(report.settings).toEqual([]);
    expect(report.dropped).toEqual([]);
    expect(circuit.entities[0]).toMatchObject({ kind: "entity", prototype: "express-transport-belt", settings: { when: UNSET_CONDITION } });
  });

  it("is printed as 'when unset', and the source reads back as the same circuit", () => {
    const { circuit } = imported(pasted);
    const source = printCircuit(circuit);
    expect(source).toMatch(/^    express-transport-belt express_transport_belt1 at \(\d+, \d+\) tile \(0\.5, 0\.5\) facing north \{\n        when unset\n    \}\n/m);
    const read = analyze(source);
    expect(read.diagnostics).toEqual([]);
    expect(read.circuit!.entities[0]).toMatchObject({ settings: { when: UNSET_CONDITION } });
    expect(exported(read.circuit!)).toEqual(exported(circuit));
  });

  it("is disabled in the simulation while the wire is on it, as in the game, and not without the wire", () => {
    const belt = fixture.cases.find((probed) => probed.name === "express-transport-belt")!;
    const wired = simulated(imported(pasted).circuit);
    const id = imported(pasted).circuit.entities[0]!.id;
    expect([wired.entities[id]!.conditions, wired.totals.entitiesDisabled]).toEqual([{ when: false }, 1]);
    expect([reading(belt, "blank").fulfilled, reading(belt, "blank").disabled]).toEqual([false, true]);
    const unwired = simulated(imported(beside("express-transport-belt", { circuit_enabled: true }, false)).circuit);
    expect([unwired.entities[id]!.conditions, unwired.totals.entitiesDisabled]).toEqual([undefined, 0]);
    expect(reading(belt, "blank-unwired").disabled).toBe(false);
  });

  it("exports the control behaviour it came with, and the blueprint is the same after every further trip", () => {
    const first = exported(imported(pasted).circuit);
    expect(first.blueprint.entities[0]).toEqual({ entity_number: 1, name: "express-transport-belt", position: { x: 0.5, y: 0.5 }, control_behavior: { circuit_enabled: true } });
    expect(first.blueprint.wires).toEqual([[1, 1, 2, 1]]);
    let data: unknown = first;
    for (let trip = 0; trip < 3; trip++) {
      const next = imported(data);
      expect(next.report.settings).toEqual([]);
      data = exported(next.circuit);
      expect(data).toEqual(first);
    }
  });
});

describe("the unset condition: what the game writes (fixture F-29)", () => {
  it("is in the recording for the 22 prototypes with a switch, the lamp, the wall and the rail signal among them", () => {
    const names = switched("blank").map(([probed]) => probed.name);
    expect(names).toEqual(fixture.cases.filter((probed) => probed.flag !== undefined).map((probed) => probed.name));
    expect(names).toHaveLength(22);
    expect(names).toEqual(expect.arrayContaining(["express-transport-belt", "small-lamp", "inserter", "stone-wall", "rail-signal"]));
  });

  it("reads the switch without a condition as unset, with nothing to report, and writes the switch without a condition", () => {
    for (const [probed, written] of switched("blank")) {
      expect([written[probed.flag!], written.circuit_condition], probed.name).toEqual([true, undefined]);
      const { circuit, report } = imported(beside(probed.name, written));
      expect(report.settings, probed.name).toEqual([]);
      expect(conditionOf(circuit.entities[0]!), probed.name).toBe(UNSET_CONDITION);
      const ours = behaviorOf(circuit) as Record<string, unknown>;
      expect([ours[probed.flag!], ours.circuit_condition], probed.name).toEqual([true, undefined]);
      // Every field of ours is one the game wrote, with its value: the game spells out defaults that this package leaves out.
      expect(written, probed.name).toMatchObject(ours);
      // From the first export on the blueprint stays as it is.
      expect(exported(imported(exported(circuit)).circuit), probed.name).toEqual(exported(circuit));
      expect(printCircuit(circuit), probed.name).toContain(`${probed.kind === "wall" ? "open-gate " : probed.kind === "signal" ? "close " : ""}when unset\n`);
    }
  });

  it("reads a blank condition with a comparator of its own as the same unset condition", () => {
    for (const [probed, written] of switched("blank-equals-zero")) {
      expect(written.circuit_condition, probed.name).toEqual({ comparator: "=", constant: 0 });
      const { circuit, report } = imported(beside(probed.name, written));
      expect(report.settings, probed.name).toEqual([]);
      expect(conditionOf(circuit.entities[0]!), probed.name).toBe(UNSET_CONDITION);
      expect(behaviorOf(circuit), probed.name).toEqual(behaviorOf(imported(beside(probed.name, reading(probed, "blank").exported!)).circuit));
    }
  });

  it("simulates what the game did with it: not fulfilled, and disabled where the condition enables", () => {
    for (const state of ["blank", "blank-equals-zero", "blank-unwired"]) {
      for (const [probed, written] of switched(state)) {
        const wired = state !== "blank-unwired";
        const { circuit } = imported(beside(probed.name, written, wired));
        const snapshot = simulated(circuit);
        const entity = snapshot.entities[circuit.entities[0]!.id]!;
        const game = reading(probed, state);
        if (PROTOTYPES[probed.name]!.kind === "lamp") expect(entity.lamp!.lit, `${probed.name} ${state}`).toBe(false);
        else {
          expect(Object.values(entity.conditions ?? {}), `${probed.name} ${state}`).toEqual(wired ? [game.fulfilled] : []);
          if (probed.kind === "onoff") expect(snapshot.totals.entitiesDisabled === 1, `${probed.name} ${state}`).toBe(game.disabled);
        }
      }
    }
  });
});

describe("the unset condition: editor to blueprint to editor", () => {
  const SOURCE = `
    constant-combinator source { virtual:signal-A = 1 }
    small-lamp lamp { when unset  always-on = true }
    express-transport-belt belt { when unset  logistic when unset }
    fast-inserter feeder { when virtual:signal-A > 0  logistic when unset  read-hand = hold }
    requester-chest chest { when unset }
    stone-wall wall { open-gate when unset  read-sensor = true }
    rail-signal signal { close when unset }
    agricultural-tower tower { harvest when unset  plant when virtual:signal-A > 0 }
    gun-turret turret { when unset  ignore-unlisted when unset }
    splitter sides { input-left when unset  output-left when unset  output-right when unset }
    wire red source.out <-> lamp.in
    wire red source.out <-> belt
    wire green belt <-> feeder
    wire green feeder <-> wall
  `;

  it("writes every one of them as its flag, and a condition without a left side only where a missing one means the game's own", () => {
    const behaviors = Object.fromEntries(exported(placed(parse(SOURCE))).blueprint.entities.map((entity) => [entity.name, entity.control_behavior]));
    expect({ ...behaviors, "constant-combinator": undefined }).toEqual({
      "constant-combinator": undefined,
      "small-lamp": { circuit_enabled: true },
      "express-transport-belt": { circuit_enabled: true, connect_to_logistic_network: true },
      "fast-inserter": { circuit_enabled: true, circuit_condition: { first_signal: A, constant: 0, comparator: ">" }, connect_to_logistic_network: true, circuit_read_hand_contents: true, circuit_hand_read_mode: 1 },
      "requester-chest": { circuit_condition_enabled: true },
      "stone-wall": { circuit_open_gate: true, circuit_read_sensor: true },
      "rail-signal": { circuit_close_signal: true },
      "agricultural-tower": { enable_harvesting_condition: true, enable_planting_condition: true, planting_condition: { first_signal: A, constant: 0, comparator: ">" } },
      "gun-turret": { circuit_enabled: true, set_ignore_unlisted_targets: true },
      splitter: { set_input_side: true, input_left_condition: { constant: 0, comparator: "<" }, set_output_side: true, output_left_condition: { constant: 0, comparator: "<" }, output_right_condition: { constant: 0, comparator: "<" } },
    });
  });

  it("comes back as the circuit it was, without a note, and the source of what came back says the same", () => {
    const circuit = placed(parse(SOURCE));
    const first = exported(circuit);
    const back = imported(first);
    expect(back.report.settings).toEqual([]);
    const settings = (entities: readonly Entity[]): unknown => entities.map((entity) => (entity.kind === "entity" ? [entity.prototype, entity.settings] : entity.kind === "lamp" ? [entity.prototype, entity.condition] : [entity.prototype]));
    // The side of the splitter the source does not name comes back as the one the game has for it.
    const right: Condition = { first: signal("virtual", "signal-I"), comparator: ">", second: { type: "constant", value: 0 } };
    expect(settings(back.circuit.entities)).toEqual(settings(circuit.entities.map((entity) => (entity.prototype === "splitter" && entity.kind === "entity" ? { ...entity, settings: { ...entity.settings, "input-right-when": right } } : entity))));
    const printed = analyze(printCircuit(back.circuit));
    expect(printed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(exported(printed.circuit!)).toEqual(first);
    expect(exported(back.circuit)).toEqual(first);
    expect((printCircuit(back.circuit).match(/when unset\n/g) ?? []).length).toBe(13);
  });
});
