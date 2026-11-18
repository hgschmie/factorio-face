// A condition of a decider combinator without a first signal (`when 0 < S`), from the game through the editor and back. What the
// game does with it is fixture F-29 (tests/fixtures/game/F-29-blank-condition.json, `deciders`): it reads the empty slot as 0.
import { readFileSync } from "node:fs";
import { analyze, printCircuit } from "@face/language";
import { BOTH_NETWORKS, tileCenter, type Circuit, type DeciderCombinator } from "@face/model";
import { compile, createSimulation } from "@face/simulation";
import { describe, expect, it } from "vitest";
import { A, B, blueprintOf, exported, imported, importedEntity, settingsOf } from "./helpers.ts";

type GameCondition = Readonly<Record<string, unknown>>;
/** `conditions` as the runtime API gives them back, `signal` the value of signal-A on the red input, `output` what the combinator sent. */
interface Decider { readonly state: string; readonly signal: number; readonly conditions: readonly GameCondition[]; readonly output: Readonly<Record<string, number>> }
const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/game/F-29-blank-condition.json", import.meta.url), "utf8")) as { readonly deciders: readonly Decider[] };
const C = { type: "virtual", name: "signal-C" } as const;
const OUTPUTS = { outputs: [{ signal: B, copy_count_from_input: false }], else_outputs: [{ signal: C, copy_count_from_input: false }] };

/** The combinator of the probe: signal-B = 1 when its conditions hold, signal-C = 1 when not, below a constant combinator that sends signal-A = 1. */
function beside(conditions: readonly GameCondition[], wired: boolean): { blueprint: Record<string, unknown> } {
  const sections = { sections: [{ index: 1, filters: [{ index: 1, ...A, quality: "normal", comparator: "=", count: 1 }] }] };
  const combinator = { entity_number: 2, name: "constant-combinator", position: { x: 0.5, y: -0.5 }, control_behavior: { sections } };
  const position = tileCenter({ prototype: "decider-combinator" }, "north", { x: 0, y: 0 });
  const decider = { entity_number: 1, name: "decider-combinator", position, control_behavior: { decider_conditions: { conditions, ...OUTPUTS } } };
  return blueprintOf([decider, combinator], wired ? [[1, 1, 2, 1]] : []);
}

/** A condition the runtime API gave back in the form of a blueprint, which leaves out what is the default. */
function written({ first_signal_networks: first, second_signal_networks: second, compare_type: join, constant, comparator, ...rest }: GameCondition): GameCondition {
  const both = (networks: unknown): boolean => JSON.stringify(networks) === JSON.stringify({ green: true, red: true });
  return {
    ...rest,
    ...(constant !== 0 && constant !== undefined && { constant }),
    ...(comparator !== "<" && { comparator }),
    ...(rest.first_signal !== undefined && !both(first) && { first_signal_networks: first }),
    ...(rest.second_signal !== undefined && !both(second) && { second_signal_networks: second }),
    ...(join === "and" && { compare_type: join }),
  };
}

const deciderOf = (circuit: Circuit): DeciderCombinator => circuit.entities.find((entity): entity is DeciderCombinator => entity.kind === "decider")!;
type Written = { readonly decider_conditions: { readonly conditions: unknown } };
const conditionsOf = (circuit: Circuit): unknown => {
  const decider = exported(circuit).blueprint.entities.find((entity) => entity.name === "decider-combinator")!;
  return (decider.control_behavior as Written).decider_conditions.conditions;
};

function sent(circuit: Circuit): Record<string, number> {
  const simulation = createSimulation(compile(circuit));
  simulation.step(2);
  return Object.fromEntries((simulation.snapshot().entities[deciderOf(circuit).id]!.output ?? []).map((entry) => [entry.key.replace("virtual:", ""), entry.value]));
}

describe("a decider condition without a first signal: the combinators of fixture F-29", () => {
  const blank = fixture.deciders.filter((one) => one.conditions.some((condition) => condition.first_signal === undefined));

  it("has the five of them, and the three whose condition holds because the empty slot reads as 0", () => {
    expect(fixture.deciders.map((one) => one.state)).toEqual(["blank", "blank-unwired", "true", "false", "empty", "blank-equals-zero", "blank-above-minus-one", "blank-below-signal"]);
    expect(blank.map((one) => [one.state, Object.keys(one.output)[0]])).toEqual([
      ["blank", "signal-C"], ["blank-unwired", "signal-C"], ["blank-equals-zero", "signal-B"], ["blank-above-minus-one", "signal-B"], ["blank-below-signal", "signal-B"],
    ]);
  });

  it("imports every one without a note, the condition kept without a first signal", () => {
    for (const one of fixture.deciders) {
      const { circuit, report } = imported(beside(one.conditions, one.signal === 1));
      expect([report.settings, report.dropped, report.warnings], one.state).toEqual([[], [], []]);
      expect(deciderOf(circuit).conditions.map((condition) => condition.first !== undefined), one.state).toEqual(one.conditions.map((condition) => condition.first_signal !== undefined));
      for (const condition of deciderOf(circuit).conditions) if (!condition.first) expect(condition.firstNetworks, one.state).toEqual(BOTH_NETWORKS);
    }
  });

  it("is printed with 0 on the left side, and the source reads back as the same circuit", () => {
    const whens = blank.map((one) => /^ +(when .*)$/m.exec(printCircuit(imported(beside(one.conditions, true)).circuit))?.[1]);
    expect(whens).toEqual(["when 0 < 0", "when 0 < 0", "when 0 = 0", "when 0 > -1", "when 0 < virtual:signal-A"]);
    for (const one of blank) {
      const { circuit } = imported(beside(one.conditions, one.signal === 1));
      const read = analyze(printCircuit(circuit));
      expect(read.diagnostics, one.state).toEqual([]);
      expect(deciderOf(read.circuit!).conditions, one.state).toEqual(deciderOf(circuit).conditions);
      expect(exported(read.circuit!), one.state).toEqual(exported(circuit));
    }
  });

  it("is written back as the game writes it: without first_signal and its networks, and read again as the same", () => {
    for (const one of fixture.deciders) {
      const { circuit } = imported(beside(one.conditions, one.signal === 1));
      expect(conditionsOf(circuit), one.state).toEqual(one.conditions.map(written));
      expect(imported(exported(circuit)).circuit.entities.map(({ id: _id, ...rest }) => rest), one.state).toEqual(circuit.entities.map(({ id: _id, ...rest }) => rest));
    }
    expect(conditionsOf(imported(beside(blank[0]!.conditions, true)).circuit)).toEqual([{}]);
  });

  it("sends in the simulation what the combinator of the game sent", () => {
    for (const one of fixture.deciders) expect(sent(imported(beside(one.conditions, one.signal === 1)).circuit), one.state).toEqual(one.output);
  });
});

describe("a decider condition without a first signal: export", () => {
  const conditions = (body: string) => (settingsOf(body).control_behavior as Written).decider_conditions.conditions;

  it("writes it without first_signal, with what stands behind it and how it joins", () => {
    expect(conditions("decider-combinator d { when 0 < virtual:signal-A[red] and virtual:signal-B > 5 or 0 = 0 and 0 >= 7 output virtual:signal-A = 1 }")).toEqual([
      { second_signal: A, second_signal_networks: { red: true, green: false } },
      { first_signal: B, constant: 5, comparator: ">", compare_type: "and" },
      { comparator: "=" },
      { constant: 7, comparator: "≥", compare_type: "and" },
    ]);
  });

  it("tells the one empty row from the combinator that is not configured by what stands next to it", () => {
    // Alone it is the combinator that is not configured: written as the game places it, and read as one without conditions.
    const fresh = { decider_conditions: { conditions: [{}], outputs: [{}], else_outputs: [] } };
    const bodies = ["decider-combinator d { }", "decider-combinator d { when 0 < 0 }", "decider-combinator d { when 0 < 0 or 0 < 0 }"];
    for (const body of bodies) expect(settingsOf(body).control_behavior, body).toEqual(fresh);
    for (const lists of [fresh.decider_conditions, { conditions: [{}], outputs: [], else_outputs: [] }, { conditions: [{}, { compare_type: "and" }], outputs: [{}] }]) {
      expect(importedEntity("decider-combinator", { control_behavior: { decider_conditions: lists } })).toMatchObject({ entity: { conditions: [], outputs: [], elseOutputs: [] }, notes: [] });
    }
    // A row that says something else is a condition without an output as well.
    expect(settingsOf("decider-combinator d { when 0 = 0 }").control_behavior).toEqual({ decider_conditions: { conditions: [{ comparator: "=" }], outputs: [], else_outputs: [] } });
    // Next to an output it is a condition that never holds, both ways.
    const kept = settingsOf("decider-combinator d { when 0 < 0 else output virtual:signal-A = 1 }").control_behavior;
    expect(kept).toEqual({ decider_conditions: { conditions: [{}], outputs: [], else_outputs: [{ signal: A, copy_count_from_input: false }] } });
    const row = { join: "or", firstNetworks: BOTH_NETWORKS, comparator: "<", second: { type: "constant", value: 0 } };
    expect(importedEntity("decider-combinator", { control_behavior: kept }).entity).toMatchObject({ conditions: [row] });
  });
});
