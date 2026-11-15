// From a blueprint of the game to a circuit of the editor. Entities the editor does not know are dropped with their wires, and so
// is everything that is not a circuit; the report says what went and which settings of the known entities were not understood.

import { analyze, checkEntity, printCircuit } from "@face/language";
import {
  ARITHMETIC_OPERATIONS, BOTH_NETWORKS, canRotate, DEFAULT_ENTITY, DIRECTIONS, entityNameBase, facingOf, isPrototypeName, LAMP_COLOR_MODES, newEntity, NORMAL_QUALITY, normalizeWire, PROTOTYPES, SELECTOR_OPERATIONS, signal, signalKey,
  SPEAKER_PLAYBACK_MODES, SPEAKER_VOLUME_RANGE, TERMINALS, tileOrigin, wildcardOf, wireKey,
  type Circuit, type ConstantFilter, type ConstantSection, type DeciderCondition, type DeciderOutput, type Direction, type Entity, type EntityConfig, type EntityKind, type Operand, type Point,
  type PrototypeName, type RgbColor, type SelectorMode, type SpeakerInstrument, type TerminalSide, type Wire, type WireColor,
} from "@face/model";
import { readGeneric } from "./generic.ts";
import { circuitCondition, Fields, float32, isObject, type Json, type NoteKind, type NoteSink } from "./reader.ts";
import { CONNECTOR, formatVersion, unpackVersion } from "./schema.ts";
import { decodeBlueprintString, DEFAULT_LIMITS, type BlueprintLimits, type DecodeErrorCode } from "./string.ts";

/** Canvas units of the edit layout per tile: half the width of an entity card, the scale at which the editor derives a tile from an edit position. */
export const DEFAULT_UNITS_PER_TILE = 92;
/** The grid of the edit canvas (`docs/dsl.md`, `at`). */
export const DEFAULT_EDIT_GRID = 20;
/** The game's map ends there; a position beyond it is not one. */
const MAX_COORDINATE = 1_000_000;
/** Entity names listed with one note. */
const MAX_NOTE_ENTITIES = 5;

export interface ImportOptions {
  /**
   * The instruments of the game's speaker with their notes, in the order of the prototype (`speakerInstrumentNames` of
   * `@face/catalog`). A blueprint stores positions in these lists; without them a speaker keeps the first instrument and note.
   */
  readonly instruments?: readonly SpeakerInstrument[];
  /** Canvas units between two neighbouring tiles in the edit positions that are derived from the tiles. Default `DEFAULT_UNITS_PER_TILE`. */
  readonly unitsPerTile?: number;
  /** Edit positions are multiples of it. Default `DEFAULT_EDIT_GRID`; 1 for none. */
  readonly grid?: number;
  /** Which blueprint of a book: the `path` of its entry in the listing. */
  readonly select?: readonly number[];
  readonly limits?: Partial<BlueprintLimits>;
}

export type BlueprintItemKind = "blueprint" | "book" | "deconstruction-planner" | "upgrade-planner" | "unknown";

/** One item of a blueprint book. A book inside a book is an entry itself and is followed by its own entries. */
export interface BookEntry {
  /** Positions in the nested `blueprints` lists that lead to the item; what `ImportOptions.select` takes. */
  readonly path: readonly number[];
  readonly kind: BlueprintItemKind;
  readonly label: string;
  /** For a blueprint: its entities, and how many of them the editor knows. 0 for everything else. */
  readonly entities: number;
  readonly known: number;
}

export type BlueprintInspection =
  | { readonly kind: "blueprint"; readonly label: string; readonly entities: number; readonly known: number; readonly version?: string }
  | { readonly kind: "book"; readonly label: string; readonly entries: readonly BookEntry[] }
  | { readonly kind: "deconstruction-planner" | "upgrade-planner" | "unknown"; readonly label: string };

export type DropReason = "unknown" | "invalid";

/** Entities that are not in the circuit: of a prototype the editor does not know, or without a usable number or position. */
export interface DroppedEntities {
  readonly name: string;
  readonly count: number;
  readonly reason: DropReason;
}

/** A setting of known entities that did not arrive as it was, summed up over the entities of one prototype. */
export interface ImportNote {
  readonly prototype: PrototypeName;
  /** Where in the entity record, list positions left out: `control_behavior.sections.sections[].filters[].comparator`. */
  readonly field: string;
  readonly kind: NoteKind;
  readonly message: string;
  readonly count: number;
  /** Names of the first few entities in the circuit. */
  readonly entities: readonly string[];
}

export interface ImportReport {
  /** The game version the blueprint says it is from, "2.1.24.0". */
  readonly version?: string;
  readonly entities: number;
  /** Most frequent first. */
  readonly dropped: readonly DroppedEntities[];
  /** `copper`: power wires. `toDropped`: an end is a dropped entity. `invalid`: not a wire between two connectors that exist. */
  readonly wires: { readonly imported: number; readonly copper: number; readonly toDropped: number; readonly invalid: number };
  readonly settings: readonly ImportNote[];
  /** Fields of the blueprint itself that the editor does not keep: `description`, `icons`, `tiles`, ... */
  readonly ignored: readonly string[];
  readonly warnings: readonly string[];
}

export type ImportErrorCode = DecodeErrorCode | "not-a-blueprint" | "book" | "unsupported-item" | "unsupported-version" | "invalid-selection" | "too-many-entities";

export type ImportResult =
  | { readonly ok: true; readonly circuit: Circuit; readonly report: ImportReport }
  /** `book`: for the code "book", the blueprints to choose from. */
  | { readonly ok: false; readonly code: ImportErrorCode; readonly message: string; readonly book?: readonly BookEntry[] };

// Items and books

const ROOT_KEYS: readonly (readonly [string, BlueprintItemKind])[] = [
  ["blueprint", "blueprint"],
  ["blueprint_book", "book"],
  ["blueprint-book", "book"],
  ["deconstruction_planner", "deconstruction-planner"],
  ["deconstruction-planner", "deconstruction-planner"],
  ["upgrade_planner", "upgrade-planner"],
  ["upgrade-planner", "upgrade-planner"],
];

const ITEM_WORDS: Readonly<Record<BlueprintItemKind, string>> = {
  blueprint: "a blueprint",
  book: "a blueprint book",
  "deconstruction-planner": "a deconstruction planner",
  "upgrade-planner": "an upgrade planner",
  unknown: "an item the editor does not know",
};

interface Item {
  readonly kind: BlueprintItemKind;
  readonly body: Json;
}

function itemOf(node: unknown): Item {
  if (isObject(node)) {
    for (const [key, kind] of ROOT_KEYS) {
      const body = node[key];
      if (isObject(body)) return { kind, body };
    }
  }
  return { kind: "unknown", body: {} };
}

const labelOf = (body: Json): string => (typeof body.label === "string" ? body.label : "");
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

function countEntities(body: Json): { entities: number; known: number } {
  const entities = listOf(body.entities);
  return { entities: entities.length, known: entities.filter((entity) => isObject(entity) && typeof entity.name === "string" && isPrototypeName(entity.name)).length };
}

function bookEntries(book: Json, path: readonly number[]): BookEntry[] {
  return listOf(book.blueprints).flatMap((element, index) => {
    const { kind, body } = itemOf(element);
    const own = [...path, index];
    const counts = kind === "blueprint" ? countEntities(body) : { entities: 0, known: 0 };
    return [{ path: own, kind, label: labelOf(body), ...counts }, ...(kind === "book" ? bookEntries(body, own) : [])];
  });
}

function versionOf(body: Json): string | undefined {
  return typeof body.version === "number" && Number.isFinite(body.version) && body.version >= 0 ? formatVersion(body.version) : undefined;
}

/** What a decoded blueprint string holds, without importing it: one blueprint, or the items of a book for a caller to choose from. */
export function inspectBlueprint(data: unknown): BlueprintInspection {
  const { kind, body } = itemOf(data);
  const label = labelOf(body);
  if (kind === "blueprint") {
    const version = versionOf(body);
    return { kind, label, ...countEntities(body), ...(version !== undefined && { version }) };
  }
  return kind === "book" ? { kind, label, entries: bookEntries(body, []) } : { kind, label };
}

// Notes

class Notes {
  private readonly byKey = new Map<string, { prototype: PrototypeName; field: string; kind: NoteKind; message: string; count: number; entities: string[]; last: string }>();

  /** The sink for one entity. A setting counts once per entity, however many list elements have it. */
  for(prototype: PrototypeName, entity: string): NoteSink {
    return (kind, path, message) => {
      const field = path.replace(/\[\d+\]/g, "[]");
      const key = `${prototype}\n${field}\n${kind}\n${message}`;
      const note = this.byKey.get(key) ?? { prototype, field, kind, message, count: 0, entities: [], last: "" };
      this.byKey.set(key, note);
      if (note.last === entity) return;
      note.last = entity;
      note.count++;
      if (note.entities.length < MAX_NOTE_ENTITIES) note.entities.push(entity);
    };
  }

  list(): ImportNote[] {
    return [...this.byKey.values()].map(({ last: _last, ...note }) => note);
  }
}

// Settings per kind

/** What a kind has of its own; distributes over a union of kinds. */
type Settings<K extends EntityKind> = K extends EntityKind ? Omit<EntityConfig<K>, "placement" | "description"> : never;

const SELECTOR_FIELDS = [
  "select_max", "index_signal", "index_constant", "index_comparator", "count_signal", "random_update_interval", "quality_filter", "select_highest_quality", "select_quality_from_signal", "quality_source_static",
  "quality_source_signal", "quality_destination_signal", "day_length_signal", "day_tick_signal", "game_tick_signal",
] as const;

function readConstant(entity: Fields): Settings<"constant"> {
  const behavior = entity.fields("control_behavior");
  const wrapper = behavior?.fields("sections");
  wrapper?.unsupported("trash_not_requested", false);
  const sections = (wrapper?.list("sections") ?? [])
    .map((section, position) => ({ section, index: section.number("index", position + 1) }))
    .sort((a, b) => a.index - b.index)
    .map(({ section }): ConstantSection => {
      const filters = new Map<string, ConstantFilter>();
      const slots = section.list("filters").map((filter, position) => ({ filter, index: filter.number("index", position + 1) })).sort((a, b) => a.index - b.index);
      for (const { filter } of slots) {
        // What a logistic request has, when the section is a group shared with one. A combinator sends the same signals with or without them.
        filter.skip("max_count", "minimum_delivery_count", "import_from");
        const id = filter.ownSignal();
        const count = filter.int32("count", 0);
        // A constant combinator sends a signal of one quality; the comparator belongs to a logistic request.
        if (filter.comparator("comparator", "=") !== "=") filter.changed("comparator", "is a quality comparison, which a constant combinator does not have; taken as '='");
        if (!id) continue;
        if (wildcardOf(id)) {
          filter.changed("name", "is a wildcard signal, which a constant combinator cannot send; the filter is dropped");
          continue;
        }
        const key = signalKey(id);
        const earlier = filters.get(key);
        if (earlier) filter.changed("name", "is in its section twice; the editor has a signal once per section and adds the counts");
        filters.set(key, { signal: id, count: earlier ? (earlier.count + count) | 0 : count });
      }
      const group = section.string("group");
      return { ...(group && { group }), active: section.boolean("active", true), multiplier: float32(section.number("multiplier", 1)), filters: [...filters.values()] };
    });
  // The one empty section of a combinator as the game places it is what the editor calls no section.
  const [only] = sections;
  const untouched = sections.length === 1 && only !== undefined && only.group === undefined && only.active && only.multiplier === 1 && only.filters.length === 0;
  return { kind: "constant", enabled: behavior?.boolean("is_on", true) ?? true, sections: untouched ? [] : sections };
}

function readArithmetic(entity: Fields): Settings<"arithmetic"> {
  const parameters = entity.fields("control_behavior")?.fields("arithmetic_conditions");
  const fresh = DEFAULT_ENTITY.arithmetic;
  if (!parameters) return fresh;
  const operand = (prefix: "first" | "second"): Operand => {
    const id = parameters.signal(`${prefix}_signal`);
    const networks = parameters.networks(`${prefix}_signal_networks`);
    const value = parameters.int32(`${prefix}_constant`, 0);
    return id ? { type: "signal", signal: id, networks } : { type: "constant", value };
  };
  const [first, second] = [operand("first"), operand("second")];
  const operation = parameters.oneOf("operation", ARITHMETIC_OPERATIONS, fresh.operation);
  const output = parameters.signal("output_signal");
  if (output) return { kind: "arithmetic", first, operation, second, output };
  const isFresh = operation === fresh.operation && [first, second].every((side) => side.type === "constant" && side.value === 0);
  if (!isFresh) parameters.changed("output_signal", "is missing: the editor has an arithmetic combinator with an output signal or not configured at all; the operands are dropped");
  return fresh;
}

function readDecider(entity: Fields): Settings<"decider"> {
  const parameters = entity.fields("control_behavior")?.fields("decider_conditions");
  if (!parameters) return DEFAULT_ENTITY.decider;
  const conditions: DeciderCondition[] = [];
  const blank: Fields[] = [];
  for (const condition of parameters.list("conditions")) {
    const first = condition.signal("first_signal");
    const firstNetworks = condition.networks("first_signal_networks");
    const comparator = condition.comparator("comparator", "<");
    const signalSecond = condition.signal("second_signal");
    const secondNetworks = condition.networks("second_signal_networks");
    const constant = condition.int32("constant", 0);
    const join = condition.oneOf("compare_type", ["and", "or"] as const, "or");
    // The first condition has nothing before it to combine with.
    if (first) conditions.push({ join: conditions.length === 0 ? "or" : join, first, firstNetworks, comparator, second: signalSecond ? { type: "signal", signal: signalSecond, networks: secondNetworks } : { type: "constant", value: constant } });
    else blank.push(condition);
  }
  const outputs = (key: string): DeciderOutput[] =>
    parameters.list(key).flatMap((output): DeciderOutput[] => {
      const id = output.signal("signal");
      const copy = output.boolean("copy_count_from_input", true);
      const constant = output.int32("constant", 1);
      const networks = output.networks("networks");
      if (!id) return [];
      // Of the constant and the network selection only the one the mode uses is kept.
      return [copy ? { signal: id, copyCountFromInput: true, constant: 1, networks } : { signal: id, copyCountFromInput: false, constant, networks: BOTH_NETWORKS }];
    });
  const decider: Settings<"decider"> = { kind: "decider", conditions, outputs: outputs("outputs"), elseOutputs: outputs("else_outputs") };
  // The empty rows of a combinator that is not configured are nothing to report; a blank condition among others is.
  if (conditions.length + decider.outputs.length + decider.elseOutputs.length > 0) {
    for (const condition of blank) condition.changed("first_signal", "is blank; the editor has no condition without a left side and drops it, which can change what the combinator decides");
  }
  return decider;
}

function readSelector(entity: Fields): Settings<"selector"> {
  const behavior = entity.fields("control_behavior");
  // Strings of the pre-release of 2.0 have a wrapper, as the arithmetic and the decider combinator do.
  const parameters = behavior?.fields("selector_conditions") ?? behavior;
  if (!parameters) return DEFAULT_ENTITY.selector;
  const operation = parameters.oneOf("operation", SELECTOR_OPERATIONS, "select");
  const mode = ((): SelectorMode => {
    switch (operation) {
      case "select": {
        const index = parameters.signal("index_signal");
        const constant = parameters.int32("index_constant", 0);
        return { operation, max: parameters.boolean("select_max", true), index: index ? { type: "signal", signal: index, networks: BOTH_NETWORKS } : { type: "constant", value: constant }, indexComparator: parameters.comparator("index_comparator", "=") };
      }
      case "count": {
        const output = parameters.signal("count_signal");
        return { operation, ...(output && { output }) };
      }
      case "random": return { operation, interval: parameters.count("random_update_interval", 0) };
      case "stack-size":
      case "rocket-capacity": return { operation };
      case "quality-filter": {
        // A QualityCondition is a quality name or an object; without a quality it stands for any quality.
        const named = parameters.raw("quality_filter");
        if (typeof named === "string") return { operation, comparator: "=", ...(named && { quality: named }) };
        const filter = parameters.fields("quality_filter");
        const quality = filter?.string("quality");
        return { operation, comparator: filter?.comparator("comparator", "=") ?? "=", ...(quality && { quality }) };
      }
      case "quality-select": return { operation, highest: parameters.boolean("select_highest_quality", true) };
      case "quality-transfer": {
        const fromSignal = parameters.boolean("select_quality_from_signal", false);
        const sourceSignal = parameters.signal("quality_source_signal");
        const quality = parameters.fields("quality_source_static")?.string("name");
        const destination = parameters.signal("quality_destination_signal");
        // The source signal is a SignalIDBase: it has no quality of its own.
        const source = fromSignal ? { type: "signal" as const, ...(sourceSignal && { signal: signal(sourceSignal.kind, sourceSignal.name) }) } : { type: "quality" as const, quality: quality || NORMAL_QUALITY };
        return { operation, source, ...(destination && { destination }) };
      }
      case "time": {
        const [dayLength, dayTick, gameTick] = [parameters.signal("day_length_signal"), parameters.signal("day_tick_signal"), parameters.signal("game_tick_signal")];
        return { operation, ...(dayLength && { dayLength }), ...(dayTick && { dayTick }), ...(gameTick && { gameTick }) };
      }
    }
  })();
  // The game keeps the fields of the modes that are not selected; they mean nothing until the mode changes.
  parameters.skip(...SELECTOR_FIELDS);
  return { kind: "selector", mode };
}

/** A Color: 0 to 1 per channel, or 0 to 255 when a value is above 1; as an object or as a list. */
function readColor(entity: Fields): RgbColor | undefined {
  const raw = entity.raw("color");
  if (raw === undefined) return undefined;
  const record = Array.isArray(raw) ? { r: raw[0] as unknown, g: raw[1] as unknown, b: raw[2] as unknown, a: raw[3] as unknown } : isObject(raw) ? raw : undefined;
  const channels = record && [record.r ?? 0, record.g ?? 0, record.b ?? 0, record.a ?? 1];
  if (!channels || !channels.every((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    entity.changed("color", "is not a color; the lamp has none");
    return undefined;
  }
  const scale = channels.some((value) => value > 1) ? 1 : 255;
  const [r, g, b] = channels.map((value) => Math.min(255, Math.round(value * scale))) as [number, number, number, number];
  return { r, g, b };
}

function readLamp(entity: Fields): Settings<"lamp"> {
  const behavior = entity.fields("control_behavior");
  const condition = circuitCondition(behavior?.fields("circuit_condition"));
  const enabled = behavior?.boolean("circuit_enabled", false) ?? false;
  if (enabled && !condition) behavior?.changed("circuit_enabled", "is on with a blank condition; the editor has no blank condition and takes the lamp as not controlled by the circuit");
  if (!enabled && condition) behavior?.changed("circuit_condition", "is set while the lamp is not controlled by the circuit; the editor keeps a condition only when it is in use");
  const useColors = behavior?.boolean("use_colors", false) ?? false;
  const mode = behavior?.number("color_mode", 0) ?? 0;
  if (LAMP_COLOR_MODES[mode] === undefined) behavior?.changed("color_mode", "is not a color mode the editor knows; color mapping is used");
  else if (!useColors && mode !== 0) behavior?.changed("color_mode", "is set while colors are off; the editor keeps the mode only with colors on");
  if (behavior?.boolean("connect_to_logistic_network", false)) behavior.changed("connect_to_logistic_network", "is on; the editor has no logistic network");
  behavior?.skip("logistic_condition");
  const [red, green, blue, rgb] = ["red_signal", "green_signal", "blue_signal", "rgb_signal"].map((key) => behavior?.signal(key));
  const color = readColor(entity);
  return {
    kind: "lamp",
    ...(enabled && condition && { condition }),
    inputNetworks: behavior?.networks("input_networks") ?? BOTH_NETWORKS,
    alwaysOn: entity.boolean("always_on", false),
    useColors,
    colorMode: useColors ? (LAMP_COLOR_MODES[mode] ?? "mapping") : "mapping",
    ...(red && { redSignal: red }),
    ...(green && { greenSignal: green }),
    ...(blue && { blueSignal: blue }),
    ...(rgb && { rgbSignal: rgb }),
    ...(color && { color }),
  };
}

function readSpeaker(entity: Fields, instruments: readonly SpeakerInstrument[] | undefined): Settings<"speaker"> {
  const fresh = DEFAULT_ENTITY.speaker;
  const parameters = entity.fields("parameters");
  const alert = entity.fields("alert_parameters");
  const behavior = entity.fields("control_behavior");
  const circuit = behavior?.fields("circuit_parameters");

  // The game stores 0 to 1 in a float; the editor has percent.
  const stored = parameters?.number("playback_volume", 1) ?? 1;
  const percent = Number((Math.fround(stored) * 100).toPrecision(7));
  const volume = Math.min(SPEAKER_VOLUME_RANGE.max, Math.max(SPEAKER_VOLUME_RANGE.min, percent));
  if (volume !== percent) parameters?.changed("playback_volume", "is outside 0 to 1; the nearest end is used");
  // Before 2.0 the mode was a switch between local and global.
  const globally = parameters?.has("playback_mode") === false && parameters.boolean("playback_globally", false);
  parameters?.skip("playback_globally");
  const playbackMode = globally ? "global" : (parameters?.oneOf("playback_mode", SPEAKER_PLAYBACK_MODES, fresh.playbackMode) ?? fresh.playbackMode);
  const bySignal = parameters?.boolean("volume_controlled_by_signal", false) ?? false;
  const volumeSignal = parameters?.signal("volume_signal_id");
  if (bySignal && !volumeSignal) parameters?.changed("volume_controlled_by_signal", "is on without a signal; the editor takes the volume from the slider");
  if (!bySignal && volumeSignal) parameters?.changed("volume_signal_id", "is set while the volume is not taken from a signal; the editor keeps the signal only when it is in use");

  const pitch = circuit?.boolean("signal_value_is_pitch", false) ?? false;
  const conditionFields = behavior?.fields("circuit_condition");
  const first = conditionFields?.signal("first_signal");
  const condition = pitch ? undefined : circuitCondition(conditionFields);
  if (pitch) {
    // With "signal value is pitch" only the left side of the condition is used.
    const idle = conditionFields?.comparator("comparator", "<") === "<" && !conditionFields.signal("second_signal") && conditionFields.int32("constant", 0) === 0;
    if (!first) circuit?.changed("signal_value_is_pitch", "is on without a signal; the editor takes the speaker as not configured");
    else if (!idle) conditionFields?.changed("comparator", "and the right side stand next to 'signal value is pitch', which does not use them; they are dropped");
    conditionFields?.skip("comparator", "second_signal", "constant");
  }

  const [instrumentId, noteId] = [circuit?.count("instrument_id", 0) ?? 0, circuit?.count("note_id", 0) ?? 0];
  const sound: { instrument?: string; note?: string } = {};
  if (instrumentId !== 0 || noteId !== 0) {
    const instrument = instruments?.[instrumentId];
    const note = instrument?.notes[noteId];
    if (!instruments) circuit?.changed("instrument_id", "and the note are positions in lists of the game, which were not given to the import; the first instrument and note are used");
    else if (!instrument) circuit?.changed("instrument_id", "is not an instrument the editor knows; the first instrument and note are used");
    else if (note === undefined) circuit?.changed("note_id", "is not a note of the instrument; its first note is used");
    if (instrument && instrumentId !== 0) sound.instrument = instrument.name;
    if (note !== undefined && noteId !== 0) sound.note = note;
  }
  const alertIcon = alert?.signal("icon_signal_id");
  return {
    kind: "speaker",
    ...(condition && { condition }),
    ...(pitch && first && { pitchSignal: first }),
    ...sound,
    volume,
    ...(bySignal && volumeSignal && { volumeSignal }),
    playbackMode,
    allowPolyphony: parameters?.boolean("allow_polyphony", fresh.allowPolyphony) ?? fresh.allowPolyphony,
    stopPlayingSounds: circuit?.boolean("stop_playing_sounds", fresh.stopPlayingSounds) ?? fresh.stopPlayingSounds,
    showAlert: alert?.boolean("show_alert", fresh.showAlert) ?? fresh.showAlert,
    showOnMap: alert?.boolean("show_on_map", fresh.showOnMap) ?? fresh.showOnMap,
    ...(alertIcon && { alertIcon }),
    alertMessage: alert?.string("alert_message") ?? fresh.alertMessage,
  };
}

/** The settings of a prototype with a kind of its own. */
function readSettings(kind: Exclude<EntityKind, "entity">, entity: Fields, instruments: readonly SpeakerInstrument[] | undefined): Settings<EntityKind> {
  switch (kind) {
    case "constant": return readConstant(entity);
    case "arithmetic": return readArithmetic(entity);
    case "decider": return readDecider(entity);
    case "selector": return readSelector(entity);
    case "lamp": return readLamp(entity);
    case "pole": return { kind: "pole" };
    case "speaker": return readSpeaker(entity, instruments);
  }
}

// Entities

/** `defines.direction` has sixteen steps; an entity of the editor faces one of four. */
function readDirection(entity: Fields, rotatable: boolean): Direction {
  if (!rotatable) {
    entity.skip("direction");
    return "north";
  }
  const value = entity.number("direction", 0);
  const valid = Number.isInteger(value) && value >= 0 && value <= 15;
  // The game builds a direction between two of the four as the one before it.
  if (!valid || value % 4 !== 0) entity.changed("direction", "is not one of the four directions the entity is built in; the one before it is used, as in the game");
  return valid ? DIRECTIONS[Math.floor(value / 4)]! : "north";
}

function readPosition(record: Json): Point | undefined {
  const position = record.position;
  if (!isObject(position)) return undefined;
  const { x, y } = position;
  const usable = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
  return usable(x) && usable(y) ? { x: x || 0, y: y || 0 } : undefined;
}

interface Imported {
  readonly number: number;
  readonly entity: Entity;
}

/**
 * The entity the editor can hold in its language for what was read. An entity the language cannot say as it is (a wildcard where
 * the game does not take one, for example) goes back to the defaults of its kind and keeps its place.
 */
function expressible(entity: Entity, note: NoteSink): Entity {
  const check = checkEntity(entity);
  if (check.ok) return entity;
  note("reset", "control_behavior", `cannot be kept by the editor (${check.message}); the entity has the settings of a new one`);
  const { id, name, position, placement } = entity;
  // A generic entity keeps what the blueprint said beyond its settings; that is data, not something the language has to express.
  const kept = entity.kind === "entity" && entity.blueprintData !== undefined ? { blueprintData: entity.blueprintData } : {};
  return { ...newEntity(entity.prototype), ...kept, id, name, position, ...(placement && { placement }) } as Entity;
}

/** Id-free form of an entity for comparing what was built with what the language reads back. */
function comparable(value: unknown, top = true): unknown {
  if (Array.isArray(value)) return value.map((element) => comparable(element, false));
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined && !(top && key === "id") && !(key === "quality" && value[key] === NORMAL_QUALITY))
      .map((key) => [key, comparable(value[key], false)]),
  );
}

/** True when the canonical source of the circuit reads back as the same entities, so that nothing is lost when the editor prints it. */
function printsExactly(circuit: Circuit): boolean {
  const parsed = analyze(printCircuit(circuit));
  if (parsed.hasErrors || !parsed.circuit) return false;
  const form = (entities: readonly Entity[]): string => JSON.stringify(entities.map((entity) => comparable(entity)));
  return form(parsed.circuit.entities) === form(circuit.entities);
}

// Wires

const WIRE_ENDS: Readonly<Record<number, { color: WireColor; output: boolean }>> = {
  [CONNECTOR.red]: { color: "red", output: false },
  [CONNECTOR.green]: { color: "green", output: false },
  [CONNECTOR.outputRed]: { color: "red", output: true },
  [CONNECTOR.outputGreen]: { color: "green", output: true },
};

function terminalOf(kind: EntityKind, output: boolean): TerminalSide | undefined {
  const sides = TERMINALS[kind];
  if (sides.length > 1) return output ? "out" : "in";
  return output ? undefined : sides[0];
}

// Import

const fail = (code: ImportErrorCode, message: string, book?: readonly BookEntry[]): ImportResult => ({ ok: false, code, message, ...(book && { book }) });

/** The blueprint to import: the root itself, or the one `select` names in a book. */
function locate(data: unknown, select: readonly number[] | undefined): { readonly blueprint: Json } | ImportResult {
  let item = itemOf(data);
  if (item.kind === "unknown") return fail("not-a-blueprint", "This is not a blueprint: the data holds neither a blueprint nor a blueprint book");
  const path: number[] = [];
  for (const index of select ?? []) {
    const next = item.kind === "book" ? listOf(item.body.blueprints)[index] : undefined;
    if (next === undefined || !Number.isInteger(index)) return fail("invalid-selection", "The blueprint book has no such blueprint");
    item = itemOf(next);
    path.push(index);
  }
  if (item.kind === "blueprint") return { blueprint: item.body };
  if (item.kind === "book") {
    const entries = bookEntries(item.body, path);
    const blueprints = entries.filter((entry) => entry.kind === "blueprint").length;
    const name = labelOf(item.body) ? ` '${labelOf(item.body)}'` : "";
    return fail("book", blueprints ? `This is a blueprint book${name} with ${blueprints} ${blueprints === 1 ? "blueprint" : "blueprints"}; choose one of them` : `The blueprint book${name} has no blueprints`, entries);
  }
  return fail("unsupported-item", `This is ${ITEM_WORDS[item.kind]}, not a blueprint; the editor imports blueprints only`);
}

const KEPT_BLUEPRINT_FIELDS: ReadonlySet<string> = new Set(["item", "label", "entities", "wires", "version"]);

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "" || value === false || (Array.isArray(value) && value.length === 0);
}

/**
 * The circuit of a blueprint (the decoded object of a blueprint string). A book is not imported: the result then lists its
 * blueprints, and `select` takes the path of one of them. Planners are refused. Never throws for any input.
 */
export function importBlueprint(data: unknown, options: ImportOptions = {}): ImportResult {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const located = locate(data, options.select);
  if (!("blueprint" in located)) return located;
  const { blueprint } = located;

  const warnings: string[] = [];
  const version = versionOf(blueprint);
  if (typeof blueprint.version === "number" && version !== undefined) {
    const { major, minor } = unpackVersion(blueprint.version);
    // 1.2 is the pre-release of 2.0 and has its layout; everything before has other wires and other settings.
    if (major < 1 || (major === 1 && minor < 2)) return fail("unsupported-version", `This blueprint is from Factorio ${major}.${minor}, which stored circuits differently. Import it into Factorio 2 and export it again`);
    if (major === 1) warnings.push(`The blueprint is from a pre-release of Factorio 2.0 (${version})`);
    if (major > 2 || (major === 2 && minor > 1)) warnings.push(`The blueprint is from Factorio ${major}.${minor}, which is newer than the editor knows`);
  }

  const notes = new Notes();
  const dropped = new Map<string, DroppedEntities>();
  const drop = (name: string, reason: DropReason): void => {
    const key = `${reason}\n${name}`;
    dropped.set(key, { name, reason, count: (dropped.get(key)?.count ?? 0) + 1 });
  };
  /** Every entity number of the blueprint, also of the entities that are dropped. */
  const numbers = new Set<number>();
  const imported: Imported[] = [];
  const byNumber = new Map<number, Entity>();
  const counters = new Map<string, number>();

  for (const raw of listOf(blueprint.entities)) {
    const record = isObject(raw) ? raw : {};
    const number = record.entity_number;
    const prototype = typeof record.name === "string" ? record.name : "";
    const hasNumber = typeof number === "number" && Number.isInteger(number);
    if (hasNumber) numbers.add(number);
    const kind = isPrototypeName(prototype) ? PROTOTYPES[prototype]!.kind : undefined;
    if (!kind) {
      drop(prototype || "(no name)", prototype ? "unknown" : "invalid");
      continue;
    }
    const tile = readPosition(record);
    if (!hasNumber || byNumber.has(number) || !tile) {
      drop(prototype, "invalid");
      continue;
    }
    if (imported.length >= limits.maxEntities) return fail("too-many-entities", `The blueprint has more than ${limits.maxEntities} entities that the editor knows`);
    const shape = { prototype };
    // The naming rule of the editor for a new entity: what it is (`entityNameBase`) and the first free number.
    const base = entityNameBase(shape);
    const count = (counters.get(base) ?? 0) + 1;
    counters.set(base, count);
    const name = `${base}${count}`;
    const note = notes.for(prototype, name);
    let settings: Settings<EntityKind>;
    let direction: Direction;
    let description: string | undefined;
    if (kind === "entity") {
      ({ settings, direction } = readGeneric(prototype, record, note));
    } else {
      const fields = new Fields(record, "", note);
      fields.skip("entity_number", "name", "position");
      direction = readDirection(fields, canRotate(shape));
      if (fields.boolean("mirror", false)) fields.changed("mirror", "is on; the editor does not mirror entities");
      fields.unsupported("quality", NORMAL_QUALITY);
      settings = readSettings(kind, fields, options.instruments);
      // The game has the description on the four combinators; anywhere else the field is not one of the entity.
      description = kind === "lamp" || kind === "pole" || kind === "speaker" ? undefined : fields.string("player_description");
      fields.done();
    }
    // East is what an entity faces without saying so; an entity of two directions faces north or east (`facingOf`).
    const facing = facingOf({ ...shape, placement: { direction } });
    const placement = { tile, ...(canRotate(shape) && facing !== "east" && { direction: facing }) };
    const entity = { ...settings, prototype, id: `e${imported.length + 1}`, name, position: { x: 0, y: 0 }, placement, ...(description && { description }) } as Entity;
    imported.push({ number, entity });
    byNumber.set(number, entity);
  }

  // Edit positions: the arrangement of the tiles, with the top-left corner of the whole at the origin.
  const unitsPerTile = options.unitsPerTile !== undefined && options.unitsPerTile > 0 && Number.isFinite(options.unitsPerTile) ? options.unitsPerTile : DEFAULT_UNITS_PER_TILE;
  const grid = options.grid !== undefined && options.grid >= 1 && Number.isFinite(options.grid) ? Math.round(options.grid) : DEFAULT_EDIT_GRID;
  const origins = imported.map(({ entity }) => tileOrigin(entity, facingOf(entity), entity.placement!.tile!));
  const corner = { x: Math.min(...origins.map((origin) => origin.x)), y: Math.min(...origins.map((origin) => origin.y)) };
  // `|| 0`: no -0.
  const edit = (tiles: number): number => Math.round((tiles * unitsPerTile) / grid) * grid || 0;
  let entities = imported.map(({ entity }, index): Entity => ({ ...entity, position: { x: edit(origins[index]!.x - corner.x), y: edit(origins[index]!.y - corner.y) } }));

  const name = labelOf(blueprint);
  if (!printsExactly({ name, entities, wires: [] })) {
    entities = entities.map((entity) => expressible(entity, notes.for(entity.prototype, entity.name)));
  }

  const counts = { imported: 0, copper: 0, toDropped: 0, invalid: 0 };
  const wires = new Map<string, Wire>();
  const kinds = new Map(entities.map((entity) => [entity.id, entity.kind]));
  for (const raw of listOf(blueprint.wires)) {
    const tuple = Array.isArray(raw) && raw.length === 4 && raw.every((part) => typeof part === "number" && Number.isInteger(part)) ? (raw as number[]) : undefined;
    if (!tuple) {
      counts.invalid++;
      continue;
    }
    const [fromNumber, fromConnector, toNumber, toConnector] = tuple as [number, number, number, number];
    const [from, to] = [byNumber.get(fromNumber), byNumber.get(toNumber)];
    if (!from || !to) {
      if (numbers.has(fromNumber) && numbers.has(toNumber)) counts.toDropped++;
      else counts.invalid++;
      continue;
    }
    const isCopper = (connector: number) => connector === CONNECTOR.poleCopper || connector === CONNECTOR.switchRightCopper;
    if (isCopper(fromConnector) && isCopper(toConnector)) {
      counts.copper++;
      continue;
    }
    const [a, b] = [WIRE_ENDS[fromConnector], WIRE_ENDS[toConnector]];
    const [aSide, bSide] = [a && terminalOf(kinds.get(from.id)!, a.output), b && terminalOf(kinds.get(to.id)!, b.output)];
    if (!a || !b || !aSide || !bSide || a.color !== b.color || (from.id === to.id && aSide === bSide)) {
      counts.invalid++;
      continue;
    }
    const wire = normalizeWire({ color: a.color, a: { entity: from.id, side: aSide }, b: { entity: to.id, side: bSide } });
    wires.set(wireKey(wire), wire);
  }
  counts.imported = wires.size;

  const ignored = Object.keys(blueprint).filter((key) => !KEPT_BLUEPRINT_FIELDS.has(key) && !isEmptyValue(blueprint[key]));
  const report: ImportReport = {
    ...(version !== undefined && { version }),
    entities: entities.length,
    dropped: [...dropped.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    wires: counts,
    settings: notes.list(),
    ignored,
    warnings,
  };
  return { ok: true, circuit: { name, entities, wires: [...wires.values()] }, report };
}

/** Decodes a blueprint string (or the plain JSON of one) and imports it. */
export function importBlueprintString(text: string, options: ImportOptions = {}): ImportResult {
  const decoded = decodeBlueprintString(text, options.limits);
  return decoded.ok ? importBlueprint(decoded.data, options) : fail(decoded.code, decoded.message);
}
