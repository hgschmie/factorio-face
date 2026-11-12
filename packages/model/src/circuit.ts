// Semantic circuit model. Independent of source text, UI and simulation state.
// Field names follow the editor's vocabulary; packages/blueprints maps them to Factorio's blueprint schema.

import type { SignalId } from "./signal.ts";

export type EntityId = string;

export const WIRE_COLORS = ["red", "green"] as const;
export type WireColor = (typeof WIRE_COLORS)[number];

export const TERMINAL_SIDES = ["in", "out"] as const;
export type TerminalSide = (typeof TERMINAL_SIDES)[number];

export const ENTITY_KINDS = ["constant", "arithmetic", "decider", "selector", "lamp"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Terminals per entity kind. A constant combinator only has an output, a lamp only an input. */
export const TERMINALS: Readonly<Record<EntityKind, readonly TerminalSide[]>> = {
  constant: ["out"],
  arithmetic: ["in", "out"],
  decider: ["in", "out"],
  selector: ["in", "out"],
  lamp: ["in"],
};

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const DIRECTIONS = ["north", "east", "south", "west"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * In-game placement: `tile` is the game's center position (see `footprint.ts`), `direction` the way the output points (absent: east,
 * `facingOf`). The direction also turns the entity on the editor canvas; the schematic position (`position`) is independent of both.
 */
export interface Placement {
  readonly tile?: Point;
  readonly direction?: Direction;
}

/** Which input networks a signal is read from. Both is the game default. */
export interface NetworkSelection {
  readonly red: boolean;
  readonly green: boolean;
}
export const BOTH_NETWORKS: NetworkSelection = { red: true, green: true };

export const COMPARATORS = ["<", ">", "=", "!=", "<=", ">="] as const;
export type Comparator = (typeof COMPARATORS)[number];

export const ARITHMETIC_OPERATIONS = ["*", "/", "+", "-", "%", "^", "<<", ">>", "AND", "OR", "XOR"] as const;
export type ArithmeticOperation = (typeof ARITHMETIC_OPERATIONS)[number];

export interface ConstantOperand {
  readonly type: "constant";
  readonly value: number;
}
export interface SignalOperand {
  readonly type: "signal";
  readonly signal: SignalId;
  readonly networks: NetworkSelection;
}
export type Operand = ConstantOperand | SignalOperand;

interface EntityBase {
  /** Stable identity assigned by the language session; survives renames. Not written to source. */
  readonly id: EntityId;
  /** User-visible identifier, unique within a circuit; this is what source text and wires reference. */
  readonly name: string;
  readonly position: Point;
  readonly placement?: Placement;
  readonly description?: string;
}

// Constant combinator

export interface ConstantFilter {
  readonly signal: SignalId;
  readonly count: number;
}
export interface ConstantSection {
  /** Logistic group name; absent for an anonymous section. */
  readonly group?: string;
  readonly active: boolean;
  readonly multiplier: number;
  readonly filters: readonly ConstantFilter[];
}
export interface ConstantCombinator extends EntityBase {
  readonly kind: "constant";
  readonly enabled: boolean;
  readonly sections: readonly ConstantSection[];
}

// Arithmetic combinator

export interface ArithmeticCombinator extends EntityBase {
  readonly kind: "arithmetic";
  readonly first: Operand;
  readonly operation: ArithmeticOperation;
  readonly second: Operand;
  /** Absent while unconfigured; the combinator then outputs nothing. */
  readonly output?: SignalId;
}

// Decider combinator

export interface DeciderCondition {
  /** How this condition combines with the preceding ones. Ignored for the first condition. "and" binds tighter than "or". */
  readonly join: "and" | "or";
  readonly first?: SignalId;
  readonly firstNetworks: NetworkSelection;
  readonly comparator: Comparator;
  readonly second: Operand;
}
export interface DeciderOutput {
  readonly signal: SignalId;
  /** true: copy the input count of `signal` (read from `networks`); false: emit `constant`. */
  readonly copyCountFromInput: boolean;
  readonly constant: number;
  readonly networks: NetworkSelection;
}
export interface DeciderCombinator extends EntityBase {
  readonly kind: "decider";
  readonly conditions: readonly DeciderCondition[];
  readonly outputs: readonly DeciderOutput[];
  readonly elseOutputs: readonly DeciderOutput[];
}

// Selector combinator

export const SELECTOR_OPERATIONS = ["select", "count", "random", "stack-size", "rocket-capacity", "quality-filter", "quality-select", "quality-transfer", "time"] as const;
export type SelectorOperation = (typeof SELECTOR_OPERATIONS)[number];

export type SelectorMode =
  | { readonly operation: "select"; readonly max: boolean; readonly index: Operand; readonly indexComparator: Comparator }
  | { readonly operation: "count"; readonly output?: SignalId }
  | { readonly operation: "random"; readonly interval: number }
  | { readonly operation: "stack-size" }
  | { readonly operation: "rocket-capacity" }
  | { readonly operation: "quality-filter"; readonly comparator?: Comparator; readonly quality?: string }
  | { readonly operation: "quality-select"; readonly highest: boolean }
  | { readonly operation: "quality-transfer"; readonly source: { readonly type: "quality"; readonly quality: string } | { readonly type: "signal"; readonly signal?: SignalId }; readonly destination?: SignalId }
  | { readonly operation: "time"; readonly dayLength?: SignalId; readonly dayTick?: SignalId; readonly gameTick?: SignalId };

export interface SelectorCombinator extends EntityBase {
  readonly kind: "selector";
  readonly mode: SelectorMode;
}

// Lamp

export interface Condition {
  readonly first?: SignalId;
  readonly comparator: Comparator;
  readonly second: { readonly type: "constant"; readonly value: number } | { readonly type: "signal"; readonly signal: SignalId };
}

export const LAMP_COLOR_MODES = ["mapping", "components", "packed-rgb"] as const;
export type LampColorMode = (typeof LAMP_COLOR_MODES)[number];

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Lamp extends EntityBase {
  readonly kind: "lamp";
  /** Enable condition; absent means the lamp is not circuit controlled. */
  readonly condition?: Condition;
  readonly inputNetworks: NetworkSelection;
  readonly alwaysOn: boolean;
  readonly useColors: boolean;
  readonly colorMode: LampColorMode;
  readonly redSignal?: SignalId;
  readonly greenSignal?: SignalId;
  readonly blueSignal?: SignalId;
  readonly rgbSignal?: SignalId;
  /** Static lamp color, 0..255 per channel. */
  readonly color?: RgbColor;
}

export type Entity = ConstantCombinator | ArithmeticCombinator | DeciderCombinator | SelectorCombinator | Lamp;
export type EntityOfKind<K extends EntityKind> = Extract<Entity, { kind: K }>;

// Wires

export interface TerminalRef {
  readonly entity: EntityId;
  readonly side: TerminalSide;
}
export interface Wire {
  readonly color: WireColor;
  readonly a: TerminalRef;
  readonly b: TerminalRef;
}

export function terminalKey(t: TerminalRef): string {
  return `${t.entity}.${t.side}`;
}

/** Orders the two ends canonically so that reversed declarations of the same connection are equal. */
export function normalizeWire(wire: Wire): Wire {
  return terminalKey(wire.a) <= terminalKey(wire.b) ? wire : { color: wire.color, a: wire.b, b: wire.a };
}

/** Identity of a connection: color plus both terminals, independent of declaration direction. */
export function wireKey(wire: Wire): string {
  const n = normalizeWire(wire);
  return `${n.color}|${terminalKey(n.a)}|${terminalKey(n.b)}`;
}

export function hasTerminal(kind: EntityKind, side: TerminalSide): boolean {
  return TERMINALS[kind].includes(side);
}

export interface Circuit {
  readonly name: string;
  readonly entities: readonly Entity[];
  /** Deduplicated by wireKey and normalized. */
  readonly wires: readonly Wire[];
}

export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;

export function isInt32(value: number): boolean {
  return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX;
}

// Defaults mirror a freshly placed entity in the game.

type NewEntity<K extends EntityKind> = Omit<EntityOfKind<K>, "id" | "name" | "position">;

export const DEFAULT_ENTITY: { readonly [K in EntityKind]: NewEntity<K> } = {
  constant: { kind: "constant", enabled: true, sections: [] },
  arithmetic: { kind: "arithmetic", first: { type: "constant", value: 0 }, operation: "*", second: { type: "constant", value: 0 } },
  decider: { kind: "decider", conditions: [], outputs: [], elseOutputs: [] },
  selector: { kind: "selector", mode: { operation: "select", max: true, index: { type: "constant", value: 0 }, indexComparator: "=" } },
  lamp: { kind: "lamp", inputNetworks: BOTH_NETWORKS, alwaysOn: false, useColors: false, colorMode: "mapping" },
};
