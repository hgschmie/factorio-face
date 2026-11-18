// From a circuit of the editor to a blueprint of the game. Every entity is written as the game writes it itself, field for field
// and in its order: what it leaves out at a default and what it spells out is recorded in fixture F-01 (docs/factorio-audit.md 12).

import {
  canRotate, DEFAULT_WIRE_REACH, facingOf, findTileOverlaps, formatWireDistance, gamePrototype, isTileCenter, NORMAL_QUALITY, signalKey, TERMINALS, UNSET_CONDITION, wireSpan,
  type Circuit, type Condition, type DeciderCondition, type DeciderOutput, type Entity, type EntityOfKind, type NetworkSelection, type Operand, type Point, type SelectorMode, type SignalId, type SpeakerInstrument, type TerminalRef, type WireColor,
} from "@face/model";
import {
  COMPARATOR_SIGNS, CONNECTOR, DIRECTION_NUMBERS, EXPORT_VERSION, isBlankDecider, LAMP_COLOR_MODE_NUMBERS,
  type Blueprint, type BlueprintCondition, type BlueprintDeciderCondition, type BlueprintDeciderOutput, type BlueprintEntity, type BlueprintFile, type BlueprintNetworks, type BlueprintSection, type BlueprintSignal, type BlueprintWire,
  type SelectorControlBehavior,
} from "./schema.ts";
import { parseBlueprintData, writeGeneric } from "./generic.ts";
import { encodeBlueprintString } from "./string.ts";

export interface ExportOptions {
  /**
   * The instruments of the game's speaker with their notes, in the order of the prototype (`speakerInstrumentNames` of
   * `@face/catalog`): a blueprint stores positions in these lists. Needed as soon as a speaker names an instrument or a note.
   */
  readonly instruments?: readonly SpeakerInstrument[];
  /** The `version` field; default `EXPORT_VERSION`. */
  readonly version?: number;
}

export type ExportProblemCode = "empty" | "no-tile" | "off-grid" | "overlap" | "custom-signal" | "unknown-instrument" | "unknown-note" | "invalid-blueprint-data";

/** Why a circuit cannot become a blueprint. One per code and cause; `entities` are the names of all entities it is about. */
export interface ExportProblem {
  readonly code: ExportProblemCode;
  readonly entities: readonly string[];
  readonly message: string;
}

export type ExportWarningCode = "description-lost" | "wire-too-long" | "no-item";

/** Something the blueprint does not carry, or that the game may not take as it is. */
export interface ExportWarning {
  readonly code: ExportWarningCode;
  readonly entities: readonly string[];
  readonly message: string;
}

export type ExportResult =
  | { readonly ok: true; readonly data: BlueprintFile; readonly string: string; readonly warnings: readonly ExportWarning[] }
  | { readonly ok: false; readonly problems: readonly ExportProblem[] };

/** Names in a message: the first few, then how many more. */
function listNames(names: readonly string[], most = 5): string {
  const quoted = names.slice(0, most).map((name) => `'${name}'`);
  return names.length > most ? `${quoted.join(", ")} and ${names.length - most} more` : quoted.join(", ");
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

class Exporter {
  readonly problems: ExportProblem[] = [];
  /** Custom signals per entity name; a blueprint has no place for them. */
  private readonly custom = new Map<string, Set<string>>();
  private current = "";
  private readonly instruments: readonly SpeakerInstrument[] | undefined;

  constructor(instruments: readonly SpeakerInstrument[] | undefined) {
    this.instruments = instruments;
  }

  signal(id: SignalId): BlueprintSignal {
    if (id.kind === "custom") {
      const signals = this.custom.get(this.current) ?? new Set<string>();
      this.custom.set(this.current, signals.add(signalKey(id)));
      return { name: id.name };
    }
    return { ...(id.kind !== "item" && { type: id.kind }), name: id.name, ...(id.quality !== undefined && id.quality !== NORMAL_QUALITY && { quality: id.quality }) };
  }

  private optional(id: SignalId | undefined): BlueprintSignal | undefined {
    return id && this.signal(id);
  }

  /** The kept data of a generic entity; what is not the JSON of an object is a problem and counts as none. */
  private kept(entity: EntityOfKind<"entity">): Readonly<Record<string, unknown>> {
    const kept = parseBlueprintData(entity.blueprintData);
    if (!kept) this.problems.push({ code: "invalid-blueprint-data", entities: [entity.name], message: `'${entity.name}' cannot be exported: its blueprint data ('blueprint-data') is not the JSON text of an object` });
    return kept ?? {};
  }

  /** A circuit condition of anything but a decider combinator: the game writes a constant of 0 and the comparator `<` here. */
  private condition(condition: Condition): BlueprintCondition {
    const first = this.optional(condition.first);
    const second = condition.second.type === "signal" ? { second_signal: this.signal(condition.second.signal) } : { constant: condition.second.value };
    return { ...(first && { first_signal: first }), ...second, comparator: COMPARATOR_SIGNS[condition.comparator] };
  }

  /** One side of an arithmetic operation: a constant is written also when it is 0. The network selections come after everything else. */
  private operand(prefix: "first" | "second", operand: Operand): Record<string, unknown> {
    return operand.type === "signal" ? { [`${prefix}_signal`]: this.signal(operand.signal) } : { [`${prefix}_constant`]: operand.value };
  }

  private output(output: DeciderOutput): BlueprintDeciderOutput {
    const signal = this.signal(output.signal);
    if (output.copyCountFromInput) return { signal, ...networks("networks", output.networks) };
    return { signal, copy_count_from_input: false, ...(output.constant !== 1 && { constant: output.constant }) };
  }

  /** A condition of a decider combinator, where the game leaves out a constant of 0 and the comparator `<`. */
  private deciderCondition(condition: DeciderCondition, index: number): BlueprintDeciderCondition {
    const first = this.optional(condition.first);
    const { second } = condition;
    return {
      ...(first && { first_signal: first }),
      ...(second.type === "signal" ? { second_signal: this.signal(second.signal) } : second.value !== 0 && { constant: second.value }),
      ...(condition.comparator !== "<" && { comparator: COMPARATOR_SIGNS[condition.comparator] }),
      ...(first && networks("first_signal_networks", condition.firstNetworks)),
      ...(second.type === "signal" && networks("second_signal_networks", second.networks)),
      ...(index > 0 && condition.join === "and" && { compare_type: "and" as const }),
    };
  }

  private selector(mode: SelectorMode): SelectorControlBehavior {
    const { operation } = mode;
    const signals = (fields: Record<string, SignalId | undefined>): Record<string, BlueprintSignal> =>
      Object.fromEntries(Object.entries(fields).flatMap(([key, id]) => (id ? [[key, this.signal(id)]] : [])));
    switch (mode.operation) {
      case "select": {
        const index = mode.index.type === "signal" ? { index_signal: this.signal(mode.index.signal) } : { index_constant: mode.index.value };
        return { operation, select_max: mode.max, ...index, ...(mode.indexComparator !== "=" && { index_comparator: COMPARATOR_SIGNS[mode.indexComparator] }) };
      }
      case "count": return { operation, ...signals({ count_signal: mode.output }) };
      case "random": return { operation, ...(mode.interval !== 0 && { random_update_interval: mode.interval }) };
      case "stack-size":
      case "rocket-capacity": return { operation };
      case "quality-filter":
        // Any quality, which is what the mode starts with: no filter.
        if (mode.quality === undefined && (mode.comparator ?? "=") === "=") return { operation };
        return { operation, quality_filter: { ...(mode.quality !== undefined && { quality: mode.quality }), comparator: COMPARATOR_SIGNS[mode.comparator ?? "="] } };
      case "quality-select": return { operation, select_highest_quality: mode.highest };
      case "quality-transfer": {
        const destination = signals({ quality_destination_signal: mode.destination });
        if (mode.source.type === "quality") return { operation, ...(mode.source.quality !== NORMAL_QUALITY && { quality_source_static: { name: mode.source.quality } }), ...destination };
        // A SignalIDBase: the quality of the source signal is what is read, so the signal itself has none.
        const source = mode.source.signal && { quality_source_signal: this.signal({ kind: mode.source.signal.kind, name: mode.source.signal.name }) };
        return { operation, select_quality_from_signal: true, ...source, ...destination };
      }
      case "time": return { operation, ...signals({ game_tick_signal: mode.gameTick, day_tick_signal: mode.dayTick, day_length_signal: mode.dayLength }) };
    }
  }

  /** Instrument and note as positions in the lists of the game; absent names are the first of their list. */
  private sound(entity: EntityOfKind<"speaker">): { instrument_id: number; note_id: number } {
    const none = { instrument_id: 0, note_id: 0 };
    if (entity.instrument === undefined && entity.note === undefined) return none;
    const instrument = entity.instrument === undefined ? 0 : (this.instruments ?? []).findIndex((candidate) => candidate.name === entity.instrument);
    if (instrument < 0 || !this.instruments?.[instrument]) {
      const why = this.instruments?.length ? `the game has no instrument '${entity.instrument}'` : "the instruments of the game were not given to the export";
      this.problems.push({ code: "unknown-instrument", entities: [entity.name], message: `The speaker '${entity.name}' cannot be exported: ${why}` });
      return none;
    }
    const note = entity.note === undefined ? 0 : this.instruments[instrument]!.notes.indexOf(entity.note);
    if (note < 0) {
      this.problems.push({ code: "unknown-note", entities: [entity.name], message: `The speaker '${entity.name}' cannot be exported: the instrument '${this.instruments[instrument]!.name}' has no note '${entity.note}'` });
      return none;
    }
    return { instrument_id: instrument, note_id: note };
  }

  /** The fields of an entity that depend on its kind. */
  private settings(entity: Entity, kept: Readonly<Record<string, unknown>>): Omit<BlueprintEntity, "entity_number" | "name" | "position" | "direction"> {
    const behavior = (value: object): { control_behavior?: BlueprintEntity["control_behavior"] } => (Object.keys(value).length ? { control_behavior: value as BlueprintEntity["control_behavior"] } : {});
    switch (entity.kind) {
      case "constant": {
        const sections = entity.sections.map((section, index): BlueprintSection => ({
          index: index + 1,
          ...(section.filters.length > 0 && {
            filters: section.filters.map((filter, slot) => {
              const { type, name, quality } = this.signal(filter.signal);
              return { index: slot + 1, ...(type && { type }), name, quality: quality ?? NORMAL_QUALITY, comparator: "=" as const, count: filter.count };
            }),
          }),
          ...(section.group && { group: section.group }),
          ...(section.multiplier !== 1 && { multiplier: section.multiplier }),
          ...(!section.active && { active: false as const }),
        }));
        // A combinator without sections is the one the game places, which has one empty section.
        return { control_behavior: { sections: { sections: sections.length > 0 ? sections : [{ index: 1 }] }, ...(!entity.enabled && { is_on: false as const }) } };
      }
      case "arithmetic": {
        const output = this.optional(entity.output);
        const selection = (prefix: "first" | "second", side: Operand) => (side.type === "signal" ? networks(`${prefix}_signal_networks`, side.networks) : {});
        return {
          control_behavior: {
            arithmetic_conditions: {
              ...this.operand("first", entity.first),
              ...this.operand("second", entity.second),
              operation: entity.operation,
              ...(output && { output_signal: output }),
              ...selection("first", entity.first),
              ...selection("second", entity.second),
            },
          },
        };
      }
      case "decider": {
        const outputs = (list: readonly DeciderOutput[]) => list.map((output) => this.output(output));
        // The combinator the game places has one blank condition and one blank output; the lists are written also when they are empty.
        const conditions = entity.conditions.map((condition, index) => this.deciderCondition(condition, index));
        const lists = isBlankDecider(entity) ? { conditions: [{}], outputs: [{}], else_outputs: [] } : { conditions, outputs: outputs(entity.outputs), else_outputs: outputs(entity.elseOutputs) };
        return { control_behavior: { decider_conditions: lists } };
      }
      case "selector":
        return { control_behavior: this.selector(entity.mode) };
      case "lamp": {
        const signals = { red_signal: this.optional(entity.redSignal), green_signal: this.optional(entity.greenSignal), blue_signal: this.optional(entity.blueSignal), rgb_signal: this.optional(entity.rgbSignal) };
        const control = behavior({
          ...networks("input_networks", entity.inputNetworks),
          // The unset condition is the switch alone, as the game writes it.
          ...(entity.condition && { circuit_enabled: true, ...(entity.condition !== UNSET_CONDITION && { circuit_condition: this.condition(entity.condition) }) }),
          ...(entity.useColors && { use_colors: true }),
          ...Object.fromEntries(Object.entries(signals).filter(([, id]) => id)),
          ...(entity.colorMode !== "mapping" && { color_mode: LAMP_COLOR_MODE_NUMBERS[entity.colorMode] }),
        });
        const channel = (value: number) => Math.max(0, Math.min(255, value)) / 255;
        const color = entity.color && { r: channel(entity.color.r), g: channel(entity.color.g), b: channel(entity.color.b), a: 1 };
        return { ...control, ...(color && { color }), ...(entity.alwaysOn && { always_on: true as const }) };
      }
      case "pole":
        return {};
      case "entity":
        return writeGeneric(entity, kept, { signal: (id) => this.signal(id), condition: (condition) => this.condition(condition) });
      case "speaker": {
        const volumeSignal = this.optional(entity.volumeSignal);
        const icon = this.optional(entity.alertIcon);
        // With "signal value is pitch" the left side of the condition is the pitch signal; the rest of the condition is not used.
        const pitch: Condition | undefined = entity.pitchSignal && { first: entity.pitchSignal, comparator: "<", second: { type: "constant", value: 0 } };
        const condition = pitch ? this.condition(pitch) : entity.condition && this.condition(entity.condition);
        const circuit = { signal_value_is_pitch: entity.pitchSignal !== undefined, stop_playing_sounds: entity.stopPlayingSounds, ...this.sound(entity) };
        // A speaker that the circuit does not concern has no control behaviour; one that it does has its parameters in full.
        const idle = !condition && !circuit.signal_value_is_pitch && !circuit.stop_playing_sounds && circuit.instrument_id === 0 && circuit.note_id === 0;
        return {
          ...(!idle && { control_behavior: { ...(condition && { circuit_condition: condition }), circuit_parameters: circuit } }),
          parameters: {
            playback_volume: entity.volume / 100,
            playback_mode: entity.playbackMode,
            allow_polyphony: entity.allowPolyphony,
            volume_controlled_by_signal: volumeSignal !== undefined,
            ...(volumeSignal && { volume_signal_id: volumeSignal }),
          },
          alert_parameters: { show_alert: entity.showAlert, show_on_map: entity.showOnMap, ...(icon && { icon_signal_id: icon }), alert_message: entity.alertMessage },
        };
      }
    }
  }

  entity(entity: Entity, number: number, origin: Point): BlueprintEntity {
    this.current = entity.name;
    const facing = facingOf(entity);
    const tile = entity.placement?.tile ?? origin;
    // The game has the description on the four combinators only.
    const description = entity.description && isCombinator(entity) ? { player_description: entity.description } : {};
    const kept = entity.kind === "entity" ? this.kept(entity) : {};
    // A generic entity writes its direction with the fields it kept, where it kept one.
    const direction = entity.kind !== "entity" && canRotate(entity) && facing !== "north" ? DIRECTION_NUMBERS[facing] : undefined;
    return {
      entity_number: number,
      name: entity.prototype,
      position: { x: tile.x - origin.x, y: tile.y - origin.y },
      ...(direction !== undefined && { direction }),
      ...this.settings(entity, kept),
      ...description,
    };
  }

  finish(): void {
    for (const [name, signals] of this.custom) {
      const list = [...signals];
      this.problems.push({ code: "custom-signal", entities: [name], message: `'${name}' uses the custom ${plural(list.length, "signal", "signals")} ${list.join(", ")}, which the game does not have` });
    }
  }
}

function networks<K extends string>(key: K, selection: NetworkSelection): { [P in K]?: BlueprintNetworks } {
  return (selection.red && selection.green ? {} : { [key]: { red: selection.red, green: selection.green } }) as { [P in K]?: BlueprintNetworks };
}

function isCombinator(entity: Entity): boolean {
  return entity.kind === "constant" || entity.kind === "arithmetic" || entity.kind === "decider" || entity.kind === "selector";
}

/** The connector id of a wire end: an entity with an input and an output has 3 and 4 for the output, everything else 1 and 2. */
export function connectorId(entity: Pick<Entity, "kind">, end: Pick<TerminalRef, "side">, color: WireColor): number {
  const output = end.side === "out" && TERMINALS[entity.kind].length > 1;
  return color === "red" ? (output ? CONNECTOR.outputRed : CONNECTOR.red) : output ? CONNECTOR.outputGreen : CONNECTOR.green;
}

/** What stops the export before anything is written: entities without a place in the game, or with one the game cannot build. */
function placementProblems(circuit: Circuit): ExportProblem[] {
  const problems: ExportProblem[] = [];
  if (circuit.entities.length === 0) return [{ code: "empty", entities: [], message: "The circuit has no entities; a blueprint needs at least one" }];
  const unplaced = circuit.entities.filter((entity) => !entity.placement?.tile).map((entity) => entity.name);
  if (unplaced.length) {
    const subject = plural(unplaced.length, "entity has", "entities have");
    problems.push({ code: "no-tile", entities: unplaced, message: `${unplaced.length} ${subject} no place in the game (no 'tile'): ${listNames(unplaced)}. Place every entity on the blueprint board first` });
  }
  const offGrid = circuit.entities.filter((entity) => entity.placement?.tile && !isTileCenter(entity, facingOf(entity), entity.placement.tile)).map((entity) => entity.name);
  if (offGrid.length) problems.push({ code: "off-grid", entities: offGrid, message: `Not on the tile grid of the game: ${listNames(offGrid)}` });
  const names = new Map(circuit.entities.map((entity) => [entity.id, entity.name]));
  const sharing = new Set(findTileOverlaps(circuit.entities).flatMap((overlap) => overlap.entities));
  const overlapping = [...sharing].map((id) => names.get(id) ?? id);
  if (overlapping.length) problems.push({ code: "overlap", entities: overlapping, message: `These entities stand on a tile of another entity, which the game cannot build: ${listNames(overlapping)}` });
  return problems;
}

/** The prototype type of the hub of a space platform. */
const PLATFORM_HUB = "space-platform-hub";

/**
 * Where (0, 0) of the blueprint is. The game builds a blueprint that has the hub of a space platform with its positions as they
 * are, the hub being the one that stands at (0, 0) of every platform; so a circuit with a hub is written around its (first) hub.
 */
function platformOrigin(circuit: Circuit): Point {
  const hub = circuit.entities.find((entity) => entity.kind === "entity" && gamePrototype(entity).type === PLATFORM_HUB);
  return hub?.placement?.tile ?? { x: 0, y: 0 };
}

/**
 * Up to four icons: the items of the most frequent entities, as the game picks them for a new blueprint. The item is the one that
 * builds the entity (`placedBy` of the entity table); the few prototypes without one (chests of the game's editor) are shown as entities.
 */
function icons(entities: readonly Entity[]): Blueprint["icons"] {
  const counts = new Map<string, { signal: BlueprintSignal; count: number }>();
  for (const entity of entities) {
    const name = entity.prototype;
    const item = gamePrototype(entity).placedBy[0];
    const entry = counts.get(name) ?? { signal: item === undefined ? { type: "entity" as const, name } : { name: item }, count: 0 };
    counts.set(name, { ...entry, count: entry.count + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 4).map(({ signal }, index) => ({ signal, index: index + 1 }));
}

/**
 * The blueprint of a circuit, as an object and as the string the game imports. Every entity needs a `tile`, on the grid and on
 * tiles of its own; a circuit that cannot become a blueprint gives `ok: false` with everything that is in the way. Edit positions
 * (`at`) and entity names are not part of a blueprint.
 */
export function exportBlueprint(circuit: Circuit, options: ExportOptions = {}): ExportResult {
  const problems = placementProblems(circuit);
  const exporter = new Exporter(options.instruments);
  const origin = platformOrigin(circuit);
  const entities = circuit.entities.map((entity, index) => exporter.entity(entity, index + 1, origin));
  exporter.finish();
  problems.push(...exporter.problems);
  if (problems.length) return { ok: false, problems };

  const numbers = new Map(circuit.entities.map((entity, index) => [entity.id, { entity, number: index + 1 }]));
  const warnings: ExportWarning[] = [];
  const wires = new Map<string, BlueprintWire>();
  for (const wire of circuit.wires) {
    const [a, b] = [numbers.get(wire.a.entity), numbers.get(wire.b.entity)];
    if (!a || !b) continue;
    const ends: [number, number][] = [[a.number, connectorId(a.entity, wire.a, wire.color)], [b.number, connectorId(b.entity, wire.b, wire.color)]];
    // The game writes the end with the lower entity number first.
    ends.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const tuple: BlueprintWire = [ends[0]![0], ends[0]![1], ends[1]![0], ends[1]![1]];
    wires.set(tuple.join(","), tuple);
    const span = wireSpan(a.entity, b.entity, DEFAULT_WIRE_REACH);
    if (span.tooLong && span.distance !== undefined) {
      const apart = formatWireDistance(span.distance, span.reach);
      warnings.push({ code: "wire-too-long", entities: [a.entity.name, b.entity.name], message: `The wire between '${a.entity.name}' and '${b.entity.name}' spans ${apart} tiles; in the game it reaches ${span.reach} and may be missing there` });
    }
  }
  const noted = circuit.entities.filter((entity) => entity.description && !isCombinator(entity)).map((entity) => entity.name);
  if (noted.length) warnings.push({ code: "description-lost", entities: noted, message: `The game has a description on combinators only; the ${plural(noted.length, "description", "descriptions")} of ${listNames(noted)} ${plural(noted.length, "is", "are")} not in the blueprint` });

  // The order of the game: by the first end, entity then connector, then by the second.
  // The game drops an entity that no item builds from a blueprint it reads, and its wires with it.
  const unbuildable = circuit.entities.filter((entity) => gamePrototype(entity).placedBy.length === 0).map((entity) => entity.name);
  if (unbuildable.length) {
    const [them, their] = [plural(unbuildable.length, "it", "them"), plural(unbuildable.length, "its", "their")];
    warnings.push({ code: "no-item", entities: unbuildable, message: `No item builds ${listNames(unbuildable)}; the game leaves ${them} and ${their} wires out when it reads the blueprint` });
  }

  const sorted = [...wires.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3]);
  const blueprint: Blueprint = {
    icons: icons(circuit.entities),
    entities,
    ...(sorted.length > 0 && { wires: sorted }),
    item: "blueprint",
    ...(circuit.name && { label: circuit.name }),
    version: options.version ?? EXPORT_VERSION,
  };
  const data: BlueprintFile = { blueprint };
  return { ok: true, data, string: encodeBlueprintString(data), warnings };
}
