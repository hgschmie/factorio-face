// Compact circuit builders for tests. Signal shorthand: "A" means virtual:signal-A, anything containing ":" is a full signal key.

import {
  BOTH_NETWORKS,
  DEFAULT_ENTITY,
  parseSignalKey,
  signal,
  wildcardSignal,
  type ArithmeticCombinator,
  type ArithmeticOperation,
  type Circuit,
  type Comparator,
  type ConstantCombinator,
  type ConstantSection,
  type DeciderCombinator,
  type DeciderCondition,
  type DeciderOutput,
  type Entity,
  type Lamp,
  type NetworkSelection,
  type Operand,
  type SelectorCombinator,
  type SelectorMode,
  type SignalId,
  type TerminalRef,
  type Wire,
  type WireColor,
} from "@face/model";
import { compile, createSimulation, networkOf, type LampState, type SignalList, type Simulation, type SimulationEnvironment, type SimulationOptions } from "../src/index.ts";

export const EACH = wildcardSignal("each");
export const ANYTHING = wildcardSignal("anything");
export const EVERYTHING = wildcardSignal("everything");
export const RED: NetworkSelection = { red: true, green: false };
export const GREEN: NetworkSelection = { red: false, green: true };
export const BOTH = BOTH_NETWORKS;
export const INT_MAX = 2147483647;
export const INT_MIN = -2147483648;

export type SignalSpec = string | SignalId;
export type Values = Readonly<Record<string, number>>;

export function sig(spec: SignalSpec): SignalId {
  if (typeof spec !== "string") return spec;
  if (!spec.includes(":")) return signal("virtual", `signal-${spec}`);
  const parsed = parseSignalKey(spec);
  if (!parsed) throw new Error(`bad signal key ${spec}`);
  return parsed;
}

/** Expands shorthand keys: v({ A: 1 }) is { "virtual:signal-A": 1 }. */
export function v(values: Values): Record<string, number> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key.includes(":") ? key : `virtual:signal-${key}`, value]));
}

const base = (id: string) => ({ id, name: id, position: { x: 0, y: 0 } });

export function section(values: Values, extra: Partial<ConstantSection> = {}): ConstantSection {
  return { active: true, multiplier: 1, filters: Object.entries(values).map(([key, count]) => ({ signal: sig(key), count })), ...extra };
}

export function constant(id: string, values: Values | readonly ConstantSection[], enabled = true): ConstantCombinator {
  return { ...base(id), kind: "constant", enabled, sections: Array.isArray(values) ? values : [section(values as Values)] };
}

export function operand(value: number | SignalSpec, networks: NetworkSelection = BOTH): Operand {
  return typeof value === "number" ? { type: "constant", value } : { type: "signal", signal: sig(value), networks };
}

export function arithmetic(id: string, first: number | SignalSpec | Operand, operation: ArithmeticOperation, second: number | SignalSpec | Operand, output?: SignalSpec): ArithmeticCombinator {
  const toOperand = (o: number | SignalSpec | Operand): Operand => (typeof o === "object" && "type" in o ? o : operand(o));
  return { ...base(id), kind: "arithmetic", first: toOperand(first), operation, second: toOperand(second), ...(output !== undefined && { output: sig(output) }) };
}

export interface ConditionOptions {
  readonly join?: "and" | "or";
  readonly firstNetworks?: NetworkSelection;
  readonly secondNetworks?: NetworkSelection;
}

export function cond(first: SignalSpec | undefined, comparator: Comparator, second: number | SignalSpec, options: ConditionOptions = {}): DeciderCondition {
  return {
    join: options.join ?? "or",
    ...(first !== undefined && { first: sig(first) }),
    firstNetworks: options.firstNetworks ?? BOTH,
    comparator,
    second: operand(second, options.secondNetworks ?? BOTH),
  };
}

export const and = (first: SignalSpec | undefined, comparator: Comparator, second: number | SignalSpec, options: ConditionOptions = {}): DeciderCondition =>
  cond(first, comparator, second, { ...options, join: "and" });

/** Decider output: `value` "input" copies the input count, a number is the constant. */
export function out(target: SignalSpec, value: number | "input" = "input", networks: NetworkSelection = BOTH): DeciderOutput {
  return { signal: sig(target), copyCountFromInput: value === "input", constant: value === "input" ? 1 : value, networks };
}

export function decider(id: string, conditions: readonly DeciderCondition[], outputs: readonly DeciderOutput[], elseOutputs: readonly DeciderOutput[] = []): DeciderCombinator {
  return { ...base(id), kind: "decider", conditions, outputs, elseOutputs };
}

export function selector(id: string, mode: SelectorMode): SelectorCombinator {
  return { ...base(id), kind: "selector", mode };
}

export function lamp(id: string, props: Partial<Omit<Lamp, "id" | "name" | "kind" | "position">> = {}): Lamp {
  return { ...base(id), ...DEFAULT_ENTITY.lamp, ...props };
}

export function terminal(text: string): TerminalRef {
  const dot = text.lastIndexOf(".");
  return { entity: text.slice(0, dot), side: text.slice(dot + 1) as TerminalRef["side"] };
}

export function wire(color: WireColor, a: string, b: string): Wire {
  return { color, a: terminal(a), b: terminal(b) };
}

export function circuit(entities: readonly Entity[], wires: readonly Wire[] = []): Circuit {
  return { name: "test", entities, wires };
}

export function simulate(c: Circuit, ticks = 0, options: SimulationOptions = {}): Simulation {
  const simulation = createSimulation(compile(c, options.environment), options);
  simulation.step(ticks);
  return simulation;
}

export function record(list: SignalList | undefined): Record<string, number> {
  return Object.fromEntries((list ?? []).map((entry) => [entry.key, entry.value]));
}

export function outputOf(simulation: Simulation, id: string): Record<string, number> {
  return record(simulation.snapshot().entities[id]?.output);
}

export function networkAt(simulation: Simulation, terminalText: string, color: WireColor): Record<string, number> {
  const network = networkOf(simulation.compiled, terminal(terminalText), color);
  return record(simulation.snapshot().networks.find((n) => n.id === network?.id)?.signals);
}

export interface Feed {
  readonly red?: Values;
  readonly green?: Values;
  readonly environment?: SimulationEnvironment;
  readonly seed?: number;
}

/** Wires constant combinators with the given values to the entity's input, one per color. */
export function fed(entity: Entity, feed: Feed): Circuit {
  const entities: Entity[] = [entity];
  const wires: Wire[] = [];
  for (const color of ["red", "green"] as const) {
    const values = feed[color];
    if (!values) continue;
    entities.push(constant(`feed-${color}`, values));
    wires.push(wire(color, `feed-${color}.out`, `${entity.id}.in`));
  }
  return circuit(entities, wires);
}

/** Output of a combinator one tick after its input (given per wire color) appears. */
export function evaluate(entity: Exclude<Entity, Lamp | ConstantCombinator>, feed: Feed = {}): Record<string, number> {
  return outputOf(simulate(fed(entity, feed), 1, feed), entity.id);
}

/** State of a lamp for the given input; lamps evaluate from the current content, so no tick has to pass. */
export function lampState(entity: Lamp, feed: Feed = {}): LampState {
  return simulate(fed(entity, feed), 0, feed).snapshot().entities[entity.id]!.lamp!;
}
