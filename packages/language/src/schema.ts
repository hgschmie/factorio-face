// One table of statement forms, properties and legal values per entity kind. Validation, the canonical printer and completion all read it.

import {
  ARITHMETIC_OPERATIONS, COMPARATORS, ENTITY_KINDS, LAMP_COLOR_MODES, prototypesOf, SELECTOR_OPERATIONS, SPEAKER_PLAYBACK_MODES, SPEAKER_VOLUME_RANGE, WILDCARDS, WIRE_COLORS,
  type EntityKind, type SelectorOperation, type Wildcard,
} from "@face/model";

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
  /** A name from the game data that the language does not know by itself: a bare word or a quoted string. */
  | { readonly type: "name"; readonly of: "instrument" | "note" }
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

/** Written where a network selection names a wire color (`[none]`, `networks = none`): the signal is read from neither network. */
export const NO_NETWORK = "none";

const DESCRIPTION: PropertySpec = { name: "description", values: [{ type: "string" }], detail: "In-game entity description" };

/** The property that says which game prototype an entity is. */
export const PROTOTYPE_PROPERTY = "prototype";

const OWN_PROPERTIES: Readonly<Record<EntityKind, readonly PropertySpec[]>> = {
  constant: [{ name: "enabled", values: [BOOL], detail: "Whether the combinator outputs its signals (default true)" }],
  arithmetic: [],
  decider: [],
  selector: [
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
    { name: "networks", values: [oneOf(...WIRE_COLORS, NO_NETWORK)], detail: "Input network selection: one wire color or none (default both)" },
    { name: "always-on", values: [BOOL], detail: "Lit regardless of the time of day (default false)" },
    { name: "colors", values: [oneOf(...LAMP_COLOR_MODES)], detail: "Color mode; presence enables signal colors" },
    { name: "red", values: [SIGNAL], detail: "Red component signal" },
    { name: "green", values: [SIGNAL], detail: "Green component signal" },
    { name: "blue", values: [SIGNAL], detail: "Blue component signal" },
    { name: "rgb", values: [SIGNAL], detail: "Packed RGB signal" },
    { name: "color", values: [{ type: "color" }], detail: "Static color, #rrggbb" },
  ],
  pole: [],
  speaker: [
    { name: "pitch", values: [SIGNAL], detail: "Signal value is pitch: the value of this signal picks the note, 1 being the first of the instrument; takes the place of 'when'" },
    { name: "instrument", values: [{ type: "name", of: "instrument" }], detail: "Instrument (sound category) by its name in the game data (default: the first)" },
    { name: "note", values: [{ type: "name", of: "note" }], detail: "Note (sound) of the instrument by its name in the game data (default: the first); not used with 'pitch'" },
    { name: "volume", values: [{ type: "number" }], detail: `Playback volume in percent, ${SPEAKER_VOLUME_RANGE.min} to ${SPEAKER_VOLUME_RANGE.max} (default 100)` },
    { name: "volume-signal", values: [SIGNAL], detail: "Signal value is volume: the value of this signal is the volume in percent, clamped to 0..100" },
    { name: "playback", values: [oneOf(...SPEAKER_PLAYBACK_MODES)], detail: "From where the sound is heard (default local; the game calls global 'Universe')" },
    { name: "polyphony", values: [BOOL], detail: "Allow several sounds at the same time (default false)" },
    { name: "stop-playing-sounds", values: [BOOL], detail: "A change of the input stops playing sounds instead of letting them finish (default false)" },
    { name: "show-alert", values: [BOOL], detail: "Show an alert with the icon and the message when a sound is played (default false)" },
    { name: "show-on-map", values: [BOOL], detail: "Show the alert icon on the map (default true)" },
    { name: "alert-icon", values: [SIGNAL], detail: "Icon of the alert" },
    { name: "alert-message", values: [{ type: "string" }], detail: "Text of the alert" },
  ],
};

/** A kind with several game prototypes takes `prototype = <name>`; the first of the kind is the default. */
function prototypeProperty(kind: EntityKind): PropertySpec[] {
  const names = prototypesOf(kind);
  return names.length > 1 ? [{ name: PROTOTYPE_PROPERTY, values: [oneOf(...names)], detail: `Which ${kind} of the game this is (default ${names[0]})` }] : [];
}

export const ENTITY_PROPERTIES: Readonly<Record<EntityKind, readonly PropertySpec[]>> = Object.fromEntries(
  ENTITY_KINDS.map((kind) => [kind, [DESCRIPTION, ...prototypeProperty(kind), ...OWN_PROPERTIES[kind]]]),
) as Record<EntityKind, PropertySpec[]>;

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
  pole: ["property"],
  speaker: ["property", "when"],
};

/** Keywords that start a non-property statement, per entity kind. */
export const STATEMENT_KEYWORDS: Readonly<Record<EntityKind, readonly string[]>> = {
  constant: ["section"],
  arithmetic: [],
  decider: ["when", "output", "else"],
  selector: [],
  lamp: ["when"],
  pole: [],
  speaker: ["when"],
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
  "speaker.condition": ["anything", "everything"],
  "speaker.operand": [],
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
