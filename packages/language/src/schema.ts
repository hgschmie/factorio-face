// One table of statement forms, properties and legal values per entity kind. Validation, the canonical printer and completion all read it.

import {
  ARITHMETIC_OPERATIONS, COMPARATORS, conditionRole, ENTITY_KINDS, ENTITY_SETTINGS, LAMP_COLOR_MODES, prototypesOf, SELECTOR_OPERATIONS, settingSpecsOf, SPEAKER_PLAYBACK_MODES, SPEAKER_VOLUME_RANGE, WILDCARDS, WIRE_COLORS,
  type EntityKind, type SelectorOperation, type SettingSpec, type Wildcard,
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

/** What a kind is called in a sentence: "an electric pole". */
export const KIND_LABEL: Readonly<Record<EntityKind, string>> = {
  constant: "constant combinator", arithmetic: "arithmetic combinator", decider: "decider combinator", selector: "selector combinator", lamp: "lamp", pole: "electric pole", speaker: "programmable speaker",
  entity: "entity",
};

const BOOL: ValueSpec = { type: "bool" };
const INT: ValueSpec = { type: "int" };
const SIGNAL: ValueSpec = { type: "signal", wildcards: [] };
const COMPARATOR: ValueSpec = { type: "comparator" };
const QUALITY: ValueSpec = { type: "quality" };
const oneOf = (...values: string[]): ValueSpec => ({ type: "enum", values });

/** Written where a network selection names a wire color (`[none]`, `networks = none`): the signal is read from neither network. */
export const NO_NETWORK = "none";

const DESCRIPTION: PropertySpec = { name: "description", values: [{ type: "string" }], detail: "In-game entity description" };

/** The property of a generic entity that holds what a blueprint says about it and the editor does not model, as JSON text. */
export const BLUEPRINT_DATA_PROPERTY = "blueprint-data";

const NETWORK_WORDS = oneOf(...WIRE_COLORS, NO_NETWORK);

/** What a setting of a generic entity is written as: `word = value`. A condition is a statement, not a property. */
function settingProperty(spec: SettingSpec): PropertySpec[] {
  switch (spec.type) {
    case "boolean": return [{ name: spec.key, values: [BOOL], detail: `${spec.label} (default ${spec.default})` }];
    case "enum": return [{ name: spec.key, values: [oneOf(...spec.values.map((value) => value.word))], detail: `${spec.label} (default ${spec.default})` }];
    case "signal": return [{ name: spec.key, values: [SIGNAL], detail: spec.prototypeDefault === undefined ? spec.label : `${spec.label} (default: the one of the prototype)` }];
    case "networks": return [{ name: spec.key, values: [NETWORK_WORDS], detail: `${spec.label}: one wire color or none (default both)` }];
    case "condition": return [];
  }
}

const BLUEPRINT_DATA: PropertySpec = { name: BLUEPRINT_DATA_PROPERTY, values: [{ type: "string" }], detail: "What a blueprint says about the entity beyond its circuit settings, as JSON text; kept for the export" };

/** Every setting word of every prototype type, a word once per form it has (`read-contents` is a switch for a chest and a mode for a belt). */
function allSettingProperties(): PropertySpec[] {
  const seen = new Set<string>();
  return Object.values(ENTITY_SETTINGS).flatMap((row) => row.settings.flatMap(settingProperty)).filter((property) => {
    const form = `${property.name} ${JSON.stringify(property.values)}`;
    return seen.has(form) ? false : seen.add(form);
  });
}

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
  // Every setting any generic entity has; `propertiesFor` narrows them to the ones of a prototype.
  entity: [...allSettingProperties(), BLUEPRINT_DATA],
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

export const ENTITY_PROPERTIES: Readonly<Record<EntityKind, readonly PropertySpec[]>> = Object.fromEntries(ENTITY_KINDS.map((kind) => [kind, [DESCRIPTION, ...OWN_PROPERTIES[kind]]])) as Record<EntityKind, PropertySpec[]>;

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
  entity: ["property", "when"],
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
  entity: ["when"],
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
  "entity.condition": ["anything", "everything"],
  "entity.operand": [],
} as const satisfies Record<string, readonly Wildcard[]>;
export type SignalSlot = keyof typeof SIGNAL_SLOTS;

export const ARITHMETIC_OPERATORS: readonly string[] = ARITHMETIC_OPERATIONS;
export const COMPARATOR_TOKENS: readonly string[] = COMPARATORS;

/** What narrows the properties of a kind: the `operation` of a selector, the prototype of a generic entity. Undefined: every property of the kind. */
export type PropertyVariant = SelectorOperation | string;

/** The properties of a generic entity of one prototype: its settings in the order of the table, between what every entity has. */
function genericProperties(prototype: string): readonly PropertySpec[] | undefined {
  const specs = settingSpecsOf(prototype);
  return prototypesOf("entity").includes(prototype) ? [DESCRIPTION, ...specs.flatMap(settingProperty), BLUEPRINT_DATA] : undefined;
}

/** Properties legal in an entity of `kind`; for a selector narrowed to its operation and for a generic entity to its prototype when given. */
export function propertiesFor(kind: EntityKind, variant?: PropertyVariant): readonly PropertySpec[] {
  const all = ENTITY_PROPERTIES[kind];
  if (variant === undefined) return all;
  if (kind === "entity") return genericProperties(variant) ?? all;
  return all.filter((p) => !p.operations || (p.operations as readonly string[]).includes(variant));
}

export type PropertyLookup = { readonly status: "ok"; readonly spec: PropertySpec } | { readonly status: "inapplicable"; readonly operations: readonly SelectorOperation[] } | { readonly status: "unknown" };

/** `inapplicable`: the kind has the property, but not for this variant; `operations` names the selector operations it belongs to (none for a generic entity). */
export function lookupProperty(kind: EntityKind, name: string, variant: PropertyVariant | undefined, inSection = false): PropertyLookup {
  if (inSection) {
    const spec = SECTION_PROPERTIES.find((p) => p.name === name);
    return spec ? { status: "ok", spec } : { status: "unknown" };
  }
  const named = ENTITY_PROPERTIES[kind].filter((p) => p.name === name);
  const spec = propertiesFor(kind, variant).find((p) => p.name === name);
  if (spec) return { status: "ok", spec };
  return named.length ? { status: "inapplicable", operations: named.flatMap((p) => p.operations ?? []) } : { status: "unknown" };
}

/** The names of the properties legal in an entity of `kind`, each once. */
export function propertyNames(kind: EntityKind, variant?: PropertyVariant, inSection = false): string[] {
  return [...new Set((inSection ? SECTION_PROPERTIES : propertiesFor(kind, variant)).map((p) => p.name))];
}

/** The words in front of `when` that a generic entity of this prototype takes: `logistic`, `harvest`. The enable condition has none. */
export function conditionRoles(prototype: string): string[] {
  return settingSpecsOf(prototype).flatMap((spec) => (spec.type === "condition" ? (conditionRole(spec.key) ?? []) : []));
}

/** Enum words accepted by a property (including `true`/`false` for booleans). Empty when the property takes no fixed words. */
export function enumValues(kind: EntityKind, property: string, variant?: PropertyVariant, inSection = false): string[] {
  const lookup = lookupProperty(kind, property, variant, inSection);
  if (lookup.status !== "ok") return [];
  return lookup.spec.values.flatMap((v) => (v.type === "enum" ? v.values : v.type === "bool" ? ["true", "false"] : v.type === "comparator" ? COMPARATOR_TOKENS : []));
}
