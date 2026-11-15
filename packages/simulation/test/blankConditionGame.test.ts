// Fixture F-29: what the game itself does with a condition that has no first signal (tests/fixtures/game/F-29-blank-condition.json,
// recorded by tools/game-probe/blank-condition.mjs). The rules of the engine that rest on it are held against the recording:
// L-BLANK, SP-BLANK and the conditions of the generic entities (false while wired), L-UNWIRED (no effect without a wire),
// D-EMPTY, and D-BLANK, which the game bears out only for a comparison that 0 does not pass. The second part runs the engine on
// the circuit of every reading, with the unset condition (`when unset`) where the game has the blank one, and holds the result
// against what the game did.
import { readFileSync } from "node:fs";
import { isPrototypeName, PROTOTYPES, UNSET_CONDITION, type ConditionValue } from "@face/model";
import { describe, expect, it } from "vitest";
import { compile, RULES } from "../src/index.ts";
import { circuit, constant, entity, lamp, simulate, speaker, when, wire } from "./helpers.ts";

type Json = Record<string, unknown>;
interface Reading {
  readonly state: string;
  readonly built: readonly string[];
  readonly error?: string;
  readonly wires?: number;
  readonly flag?: boolean;
  readonly condition?: Json;
  readonly fulfilled?: boolean;
  readonly disabled?: boolean;
  readonly status?: string;
  readonly itemTo?: number;
  readonly switchOn?: boolean;
  readonly gateOpened?: boolean;
  readonly signalState?: string;
  readonly exported?: Json | null;
}
interface Case { readonly name: string; readonly type: string; readonly kind: "onoff" | "wall" | "signal" | "speaker"; readonly flag?: string; readonly readings: readonly Reading[] }
interface Decider { readonly state: string; readonly error?: string; readonly output: Readonly<Record<string, number>> }
interface Fixture { readonly gameVersion: string; readonly provenance: string; readonly signal: string; readonly cases: readonly Case[]; readonly deciders: readonly Decider[] }

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/game/F-29-blank-condition.json", import.meta.url), "utf8")) as Fixture;
const read = (probed: Case, state: string): Reading[] => probed.readings.filter((one) => one.state === state && one.error === undefined);
const every = (state: string): [string, Reading][] => fixture.cases.flatMap((probed) => read(probed, state).map((one): [string, Reading] => [probed.name, one]));
const onOff = fixture.cases.filter((probed) => probed.kind === "onoff");
const named = (name: string): Case => fixture.cases.find((probed) => probed.name === name)!;
const holds = (state: string): boolean => fixture.deciders.find((one) => one.state === state)!.output["signal-B"] === 1;

describe("F-29: a blank condition in the game", () => {
  it("is a recording of the game with the entities the question came from", () => {
    expect(fixture.provenance).toBe("game");
    expect(fixture.gameVersion).toMatch(/^2\.\d+\.\d+$/);
    for (const name of ["express-transport-belt", "inserter", "small-lamp", "pump", "offshore-pump", "electric-mining-drill", "train-stop", "power-switch", "assembling-machine-2", "programmable-speaker", "stone-wall"]) {
      const probed = named(name);
      expect(probed, name).toBeDefined();
      // Every state was read, on an entity built from a blueprint and on one set through the runtime API.
      const states = ["blank", "blank-unwired", "true", "false", "false-unwired", "blank-equals-zero"];
      // A speaker has no switch to turn off.
      for (const state of probed.kind === "speaker" ? states : [...states, "off"]) expect(read(probed, state).flatMap((one) => one.built).sort(), `${name} ${state}`).toEqual(["api", "blueprint"]);
    }
  });

  it("reads the controls as it must: a condition that holds is fulfilled and switches, one that does not is neither", () => {
    for (const probed of fixture.cases) {
      expect(read(probed, "true").length, probed.name).toBeGreaterThan(0);
      expect(read(probed, "false").length, probed.name).toBeGreaterThan(0);
    }
    for (const [name, one] of every("true")) expect([name, one.wires, one.fulfilled], name).toEqual([name, 1, true]);
    for (const [name, one] of every("false")) expect([name, one.wires, one.fulfilled], name).toEqual([name, 1, false]);
    for (const probed of onOff) {
      expect(read(probed, "true").map((one) => one.disabled), probed.name).toEqual([false]);
      expect(read(probed, "false").map((one) => [one.disabled, one.status]), probed.name).toEqual([[true, probed.name === "land-mine" ? "working" : "disabled_by_control_behavior"]]);
      // The switch off: the condition, which does not hold, has no say.
      expect(read(probed, "off").map((one) => [one.flag, one.disabled]), probed.name).toEqual([[false, false]]);
    }
    expect(["true", "false", "off"].map((state) => read(named("stone-wall"), state).map((one) => one.gateOpened))).toEqual([[true], [false], [false]]);
    expect(["true", "false", "off"].map((state) => read(named("rail-signal"), state).map((one) => one.signalState))).toEqual([["reserved_by_circuit_network"], ["open"], ["open"]]);
    expect(["true", "false"].map((state) => read(named("power-switch"), state).map((one) => one.switchOn))).toEqual([[true], [false]]);
  });

  it("L-BLANK, SP-BLANK, generic entities: a wired entity whose condition is in use and blank is switched as by a condition that does not hold", () => {
    expect(RULES.blankFirstSignalResult).toBe(false);
    for (const state of ["blank", "blank-equals-zero"]) {
      const readings = every(state);
      expect(readings.length).toBeGreaterThanOrEqual(fixture.cases.length);
      for (const [name, one] of readings) {
        expect([name, one.wires, one.fulfilled], `${name} ${state}`).toEqual([name, 1, RULES.blankFirstSignalResult]);
        expect(one.condition?.first_signal, `${name} ${state}`).toBeUndefined();
        if (one.flag !== undefined) expect(one.flag, `${name} ${state}`).toBe(true);
      }
      for (const probed of onOff) expect(read(probed, state).map((one) => one.disabled), `${probed.name} ${state}`).toEqual([true]);
      expect(read(named("stone-wall"), state).map((one) => [one.gateOpened, one.status])).toEqual([[false, "closed_by_circuit_network"]]);
      expect(read(named("rail-signal"), state).map((one) => one.signalState)).toEqual(["open"]);
      expect(read(named("power-switch"), state).map((one) => one.switchOn)).toEqual([false]);
    }
    // The belt of the question: with the blank condition it carries its item as far as with one that does not hold, and not to the end.
    for (const name of ["express-transport-belt", "transport-belt"]) {
      const to = (state: string): (number | undefined)[] => read(named(name), state).map((one) => one.itemTo);
      expect(to("blank"), name).toEqual(to("false"));
      expect(to("blank")[0], name).toBeGreaterThan(0);
      expect([to("true"), to("off"), to("blank-unwired")], name).toEqual([[0], [0], [0]]);
    }
  });

  it("L-UNWIRED: without a wire a condition that does not hold, blank or not, disables nothing, built from a blueprint or set through the runtime API", () => {
    expect(RULES.lampConditionNeedsWire).toBe(true);
    for (const probed of onOff) {
      for (const state of ["blank-unwired", "false-unwired"]) {
        const unwired = read(probed, state);
        expect(unwired.map((one) => [one.wires, one.flag, one.fulfilled, one.disabled]), `${probed.name} ${state}`).toEqual([[0, true, false, false]]);
        expect(unwired[0]!.status, `${probed.name} ${state}`).not.toBe("disabled_by_control_behavior");
      }
    }
    // The wall is not "closed by circuit network" as it is with a wire: its status is that of a wall nothing controls.
    expect(read(named("stone-wall"), "blank-unwired").map((one) => [one.status, one.gateOpened])).toEqual([["working", false], ["working", false]]);
    expect(read(named("stone-wall"), "false-unwired").map((one) => [one.status, one.gateOpened])).toEqual([["working", false]]);
  });

  it("is written into a blueprint as the switch without a condition, and that blueprint builds the same entity as the runtime API", () => {
    for (const probed of fixture.cases.filter((one) => one.flag !== undefined)) {
      for (const one of read(probed, "blank")) {
        expect(one.exported?.[probed.flag!], probed.name).toBe(true);
        expect(one.exported?.circuit_condition, probed.name).toBeUndefined();
      }
      // A comparator of its own is written, still without a first signal.
      for (const one of read(probed, "blank-equals-zero")) expect(one.exported?.circuit_condition, probed.name).toEqual({ comparator: "=", constant: 0 });
      // An entity that is not wired keeps the switch in its blueprint, but for the wall, which has no control behaviour without a wire.
      for (const one of read(probed, "blank-unwired")) expect(one.exported, probed.name).toEqual(probed.kind === "wall" ? null : expect.objectContaining({ [probed.flag!]: true }));
    }
    expect(read(named("programmable-speaker"), "blank").map((one) => one.exported?.circuit_condition)).toEqual([undefined]);
    // One reading per state: the two ways of building say the same. The asteroid collector is not built from a blueprint on the
    // ground, and an unwired wall or speaker built from a blueprint that says nothing but the default has no control behaviour.
    for (const probed of fixture.cases) {
      for (const state of ["blank", "true", "false", "false-unwired", "off", "blank-equals-zero"]) {
        if (probed.name !== "asteroid-collector" && !(probed.kind === "speaker" && state === "off")) expect(probed.readings.filter((one) => one.state === state).map((one) => one.built), `${probed.name} ${state}`).toEqual([["blueprint", "api"]]);
      }
    }
    expect(fixture.cases.filter((probed) => read(probed, "blank-unwired").length !== 1).map((probed) => probed.name)).toEqual(["programmable-speaker", "stone-wall"]);
  });

  it("D-EMPTY and D-BLANK: a decider combinator without a condition, and with a blank one that compares below 0, sends its else output", () => {
    expect(fixture.deciders.filter((one) => one.error !== undefined)).toEqual([]);
    expect([holds("true"), holds("false")]).toEqual([true, false]);
    expect(holds("empty")).toBe(RULES.emptyConditionListResult);
    expect([holds("blank"), holds("blank-unwired")]).toEqual([RULES.blankFirstSignalResult, RULES.blankFirstSignalResult]);
    for (const one of fixture.deciders) expect(Object.keys(one.output), one.state).toEqual([holds(one.state) ? "signal-B" : "signal-C"]);
  });

  it("in a decider combinator a blank first signal reads as 0, unlike in the condition of an entity", () => {
    // The engine has D-BLANK false for every comparator (`decider.ts`); the game compares. Open until the engine follows.
    expect([holds("blank-equals-zero"), holds("blank-above-minus-one"), holds("blank-below-signal")]).toEqual([true, true, true]);
    expect(every("blank-equals-zero").every(([, one]) => one.fulfilled === false)).toBe(true);
  });
});

/** The signal the probe's constant combinator sends, by its key. */
const SIGNAL = `virtual:${fixture.signal}`;
/** The setting that holds the condition the probe set, per kind of case; a lamp and a speaker hold it as `condition`. */
const CONDITION_KEY = { onoff: "when", wall: "open-gate-when", signal: "close-when" } as const;

interface Simulated {
  /** Whether the condition holds, as far as the snapshot says: the game's `fulfilled` of a wired entity. A lamp says it by being lit. */
  readonly fulfilled: boolean | undefined;
  /** The entity is switched off by its enable condition: the game's `disabled`. */
  readonly disabled: boolean;
  readonly notes: readonly string[];
}

/**
 * The circuit of one reading in the engine: the prototype next to a constant combinator that sends the fixture's signal = 1, with
 * a red wire or without one. The lamp is always-on, so that it is dark only when its condition switches it off.
 */
function simulated(probed: Case, condition: ConditionValue | undefined, wired: boolean): Simulated {
  expect(isPrototypeName(probed.name), probed.name).toBe(true);
  const { kind } = PROTOTYPES[probed.name]!;
  const target =
    kind === "lamp" ? lamp("e", { alwaysOn: true, ...(condition && { condition }) })
    : kind === "speaker" ? speaker("e", condition && condition !== UNSET_CONDITION ? { condition } : {})
    : entity("e", probed.name, condition ? { [CONDITION_KEY[probed.kind as keyof typeof CONDITION_KEY]]: condition } : {});
  expect(target.kind === "entity" ? probed.kind !== "speaker" : probed.type === (kind === "lamp" ? "lamp" : "programmable-speaker"), probed.name).toBe(true);
  const built = circuit([constant("c", { [SIGNAL]: 1 }), target], wired ? [wire("red", "c.out", target.kind === "entity" ? "e" : "e.in")] : []);
  const notes = compile(built).notes.filter((note) => note.severity !== "info").map((note) => note.message);
  const snapshot = simulate(built, 2).snapshot();
  const state = snapshot.entities.e!;
  const fulfilled = state.lamp ? (wired && condition ? state.lamp.lit : undefined) : state.speaker ? state.speaker.playing : state.conditions?.[CONDITION_KEY[probed.kind as keyof typeof CONDITION_KEY]];
  return { fulfilled, disabled: state.lamp ? !state.lamp.lit : snapshot.totals.entitiesDisabled === 1, notes };
}

describe("F-29: the engine on the circuits of the recording", () => {
  const GREATER = when(SIGNAL, ">", 0);
  const LESS = when(SIGNAL, "<", 0);
  /** What the editor holds for each state of the probe: the blank condition, whatever its comparator, is the unset one. */
  const STATES: Readonly<Record<string, { readonly condition: ConditionValue | undefined; readonly wired: boolean }>> = {
    blank: { condition: UNSET_CONDITION, wired: true },
    "blank-equals-zero": { condition: UNSET_CONDITION, wired: true },
    "blank-unwired": { condition: UNSET_CONDITION, wired: false },
    true: { condition: GREATER, wired: true },
    false: { condition: LESS, wired: true },
    "false-unwired": { condition: LESS, wired: false },
    off: { condition: undefined, wired: true },
  };

  it("has every prototype of the recording, the belt of the question and the lamp among them", () => {
    expect(fixture.signal).toBe("signal-A");
    expect(fixture.cases.filter((probed) => !isPrototypeName(probed.name))).toEqual([]);
    expect(fixture.cases.map((probed) => PROTOTYPES[probed.name]!.kind).sort().filter((kind, index, all) => kind !== all[index - 1])).toEqual(["entity", "lamp", "speaker"]);
    expect(["express-transport-belt", "small-lamp", "inserter", "stone-wall", "rail-signal"].map((name) => named(name).kind)).toEqual(["onoff", "onoff", "onoff", "wall", "signal"]);
  });

  it("L-BLANK, G-CONDITION: an unset condition never holds, and with a wire it disables as one that is false does", () => {
    let compared = 0;
    for (const probed of fixture.cases) {
      for (const state of ["blank", "blank-equals-zero", "true", "false"]) {
        for (const reading of read(probed, state)) {
          const { fulfilled, disabled, notes } = simulated(probed, STATES[state]!.condition, true);
          expect(notes, `${probed.name} ${state}`).toEqual([]);
          expect([reading.wires, fulfilled], `${probed.name} ${state}`).toEqual([1, reading.fulfilled]);
          // Only the enable condition disables (G-DISABLED): the gate of a wall and a rail signal are not switched off, they stay shut and open.
          if (probed.kind === "onoff") expect(disabled, `${probed.name} ${state}`).toBe(reading.disabled);
          else if (probed.kind !== "speaker") expect(disabled, `${probed.name} ${state}`).toBe(false);
          compared++;
        }
      }
      // Unset is to the engine what a condition that does not hold is.
      if (probed.kind !== "speaker") expect(simulated(probed, UNSET_CONDITION, true), probed.name).toEqual(simulated(probed, LESS, true));
    }
    expect(compared).toBeGreaterThanOrEqual(4 * fixture.cases.length);
    expect(simulated(named("express-transport-belt"), UNSET_CONDITION, true)).toEqual({ fulfilled: false, disabled: true, notes: [] });
    expect(simulated(named("small-lamp"), UNSET_CONDITION, true)).toEqual({ fulfilled: false, disabled: true, notes: [] });
    expect(simulated(named("stone-wall"), UNSET_CONDITION, true)).toEqual({ fulfilled: false, disabled: false, notes: [] });
  });

  it("L-UNWIRED, G-UNWIRED: without a wire an unset condition disables nothing, like one that is false", () => {
    let compared = 0;
    for (const probed of fixture.cases.filter((one) => one.kind !== "speaker")) {
      for (const state of ["blank-unwired", "false-unwired"]) {
        for (const reading of read(probed, state)) {
          const { fulfilled, disabled } = simulated(probed, STATES[state]!.condition, false);
          expect(reading.wires, `${probed.name} ${state}`).toBe(0);
          // The snapshot reports no condition of an entity without a wire; the game's `fulfilled` is false there and switches nothing.
          expect(fulfilled, `${probed.name} ${state}`).toBeUndefined();
          expect(disabled, `${probed.name} ${state}`).toBe(probed.kind === "onoff" ? reading.disabled : false);
          expect(disabled, `${probed.name} ${state}`).toBe(false);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(2 * onOff.length);
    expect(simulated(named("express-transport-belt"), UNSET_CONDITION, false)).toEqual({ fulfilled: undefined, disabled: false, notes: [] });
    expect(simulated(named("small-lamp"), UNSET_CONDITION, false)).toEqual({ fulfilled: undefined, disabled: false, notes: [] });
  });

  it("the switch off: no condition, and nothing is disabled with a wire either", () => {
    for (const probed of onOff) {
      for (const reading of read(probed, "off")) expect([simulated(probed, undefined, true).disabled, reading.flag], probed.name).toEqual([reading.disabled, false]);
    }
  });

  it("G-LOGISTIC: an unset logistic condition is kept and not evaluated", () => {
    const belt = entity("e", "express-transport-belt", { "logistic-when": UNSET_CONDITION });
    const snapshot = simulate(circuit([constant("c", { [SIGNAL]: 1 }), belt], [wire("red", "c.out", "e")]), 1).snapshot();
    expect([snapshot.entities.e!.conditions, snapshot.totals.entitiesDisabled]).toEqual([undefined, 0]);
    const both = simulate(circuit([constant("c", { [SIGNAL]: 1 }), { ...belt, settings: { when: GREATER, "logistic-when": UNSET_CONDITION } }], [wire("red", "c.out", "e")]), 1).snapshot();
    expect([both.entities.e!.conditions, both.totals.entitiesDisabled]).toEqual([{ when: true }, 0]);
  });
});
