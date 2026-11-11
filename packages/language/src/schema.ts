// One table of statement forms, properties and legal values per entity kind. Validation, the canonical printer and completion all read it.

import { ARITHMETIC_OPERATIONS, COMPARATORS, LAMP_COLOR_MODES, SELECTOR_OPERATIONS, WILDCARDS, type EntityKind, type SelectorOperation, type Wildcard } from "@face/model";

export type ValueSpec =
  | { readonly type: "bool" }
  | { readonly type: "int" }
  /** Integer or decimal, any sign. */
  | { readonly type: "number" }
  | { readonly type: "string" }
  | { readonly type: "color" }
  | { readonly type: "comparator" }
  /** A quality prototype name: a bare word or a quoted string. */
  | { readonly type: "quality" }
  | { readonly type: "signal"; readonly wildcards: readonly Wildcard[] }
  | { readonly type: "enum"; readonly values: readonly string[] };

export interface PropertySpec {
  readonly name: string;
  /** Alternatives, tried in order. */
  readonly values: readonly ValueSpec[];
  /** Selector only: the operations this property belongs to. Absent means always legal. */
  readonly operations?: readonly SelectorOperation[];
  readonly detail: string;
}

const BOOL: ValueSpec = { type: "bool" };
const INT: ValueSpec = { type: "int" };
const SIGNAL: ValueSpec = { type: "signal", wildcards: [] };
const COMPARATOR: ValueSpec = { type: "comparator" };
const QUALITY: ValueSpec = { type: "quality" };
const oneOf = (...values: string[]): ValueSpec => ({ type: "enum", values });

const DESCRIPTION: PropertySpec = { name: "description", values: [{ type: "string" }], detail: "In-game entity description" };

export const ENTITY_PROPERTIES: Readonly<Record<EntityKind, readonly PropertySpec[]>> = {
  constant: [DESCRIPTION, { name: "enabled", values: [BOOL], detail: "Whether the combinator outputs its signals (default true)" }],
  arithmetic: [DESCRIPTION],
  decider: [DESCRIPTION],
  selector: [
    DESCRIPTION,
    { name: "operation", values: [oneOf(...SELECTOR_OPERATIONS)], detail: "Selector mode (default select)" },
    { name: "order", values: [oneOf("max", "min")], operations: ["select"], detail: "Sort order (default max)" },
    { name: "index", values: [INT, SIGNAL], operations: ["select"], detail: "Index constant or signal (default 0)" },
    { name: "index-comparator", values: [COMPARATOR], operations: ["select"], detail: "Comparator applied to the index (default =)" },
    { name: "output", values: [SIGNAL], operations: ["count"], detail: "Signal that receives the count" },
    { name: "interval", values: [INT], operations: ["random"], detail: "Update interval in ticks (default 0)" },
    { name: "quality", values: [QUALITY], operations: ["quality-filter"], detail: "Quality to compare against (absent: any quality)" },
    { name: "comparator", values: [COMPARATOR], operations: ["quality-filter"], detail: "Quality comparator (default =)" },
    { name: "order", values: [oneOf("highest", "lowest")], operations: ["quality-select"], detail: "Which quality to select (default highest)" },
    { name: "source", values: [oneOf("signal"), QUALITY], operations: ["quality-transfer"], detail: "Quality name, or `signal` to take the quality from source-signal (default normal)" },
    { name: "source-signal", values: [SIGNAL], operations: ["quality-transfer"], detail: "Signal whose quality is transferred (requires source = signal)" },
    { name: "destination", values: [{ type: "signal", wildcards: ["each"] }], operations: ["quality-transfer"], detail: "Signal that receives the quality" },
    { name: "day-length", values: [SIGNAL], operations: ["time"], detail: "Signal for the surface day length" },
    { name: "day-tick", values: [SIGNAL], operations: ["time"], detail: "Signal for the tick within the day" },
    { name: "game-tick", values: [SIGNAL], operations: ["time"], detail: "Signal for the game tick" },
  ],
  lamp: [
    DESCRIPTION,
    { name: "networks", values: [oneOf("red", "green")], detail: "Input network selection (default both)" },
    { name: "always-on", values: [BOOL], detail: "Lit regardless of the time of day (default false)" },
    { name: "colors", values: [oneOf(...LAMP_COLOR_MODES)], detail: "Color mode; presence enables signal colors" },
    { name: "red", values: [SIGNAL], detail: "Red component signal" },
    { name: "green", values: [SIGNAL], detail: "Green component signal" },
    { name: "blue", values: [SIGNAL], detail: "Blue component signal" },
    { name: "rgb", values: [SIGNAL], detail: "Packed RGB signal" },
    { name: "color", values: [{ type: "color" }], detail: "Static color, #rrggbb" },
  ],
};

export const SECTION_PROPERTIES: readonly PropertySpec[] = [
  { name: "active", values: [BOOL], detail: "Whether the section is active (default true)" },
  { name: "multiplier", values: [{ type: "number" }], detail: "Multiplier applied to every filter; may be fractional or negative (default 1)" },
];

export type StatementForm = "property" | "assign" | "when" | "output" | "section";

/** Statement forms each entity kind accepts besides nothing at all. */
export const STATEMENT_FORMS: Readonly<Record<EntityKind, readonly StatementForm[]>> = {
  constant: ["property", "assign", "section"],
  arithmetic: ["property", "assign"],
  decider: ["property", "when", "output"],
  selector: ["property"],
  lamp: ["property", "when"],
};

/** Keywords that start a non-property statement, per entity kind. */
export const STATEMENT_KEYWORDS: Readonly<Record<EntityKind, readonly string[]>> = {
  constant: ["section"],
  arithmetic: [],
  decider: ["when", "output", "else"],
  selector: [],
  lamp: ["when"],
};

/** Signal slots outside property values and the wildcards each accepts. */
export const SIGNAL_SLOTS = {
  "constant.filter": [],
  "arithmetic.output": ["each"],
  "arithmetic.operand": ["each"],
  "decider.condition": WILDCARDS,
  "decider.operand": WILDCARDS,
  "decider.output": WILDCARDS,
  "lamp.condition": ["anything", "everything"],
  "lamp.operand": [],
} as const satisfies Record<string, readonly Wildcard[]>;
export type SignalSlot = keyof typeof SIGNAL_SLOTS;

export const ARITHMETIC_OPERATORS: readonly string[] = ARITHMETIC_OPERATIONS;
export const COMPARATOR_TOKENS: readonly string[] = COMPARATORS;

/** Properties legal in an entity of `kind`; for selectors narrowed to `operation` when given. */
export function propertiesFor(kind: EntityKind, operation?: SelectorOperation): readonly PropertySpec[] {
  const all = ENTITY_PROPERTIES[kind];
  return operation === undefined ? all : all.filter((p) => !p.operations || p.operations.includes(operation));
}

export type PropertyLookup = { readonly status: "ok"; readonly spec: PropertySpec } | { readonly status: "inapplicable"; readonly operations: readonly SelectorOperation[] } | { readonly status: "unknown" };

export function lookupProperty(kind: EntityKind, name: string, operation: SelectorOperation | undefined, inSection = false): PropertyLookup {
  if (inSection) {
    const spec = SECTION_PROPERTIES.find((p) => p.name === name);
    return spec ? { status: "ok", spec } : { status: "unknown" };
  }
  const named = ENTITY_PROPERTIES[kind].filter((p) => p.name === name);
  const spec = named.find((p) => !p.operations || operation === undefined || p.operations.includes(operation));
  if (spec) return { status: "ok", spec };
  return named.length ? { status: "inapplicable", operations: named.flatMap((p) => p.operations ?? []) } : { status: "unknown" };
}

export function propertyNames(kind: EntityKind, operation?: SelectorOperation, inSection = false): string[] {
  return [...new Set((inSection ? SECTION_PROPERTIES : propertiesFor(kind, operation)).map((p) => p.name))];
}

/** Enum words accepted by a property (including `true`/`false` for booleans). Empty when the property takes no fixed words. */
export function enumValues(kind: EntityKind, property: string, operation?: SelectorOperation, inSection = false): string[] {
  const lookup = lookupProperty(kind, property, operation, inSection);
  if (lookup.status !== "ok") return [];
  return lookup.spec.values.flatMap((v) => (v.type === "enum" ? v.values : v.type === "bool" ? ["true", "false"] : v.type === "comparator" ? COMPARATOR_TOKENS : []));
}
