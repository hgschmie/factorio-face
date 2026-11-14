// From a circuit of the editor to a blueprint of the game. What is written at a default and what is left out follows
// docs/factorio-audit.md 3; the shapes the game has not confirmed yet are listed in the README of this package (fixture F-01).

import {
  canRotate, DEFAULT_WIRE_REACH, facingOf, findTileOverlaps, formatWireDistance, isTileCenter, NORMAL_QUALITY, prototypeOf, signalKey, TERMINALS, wireSpan,
  type Circuit, type Condition, type DeciderOutput, type Entity, type EntityOfKind, type NetworkSelection, type Operand, type SelectorMode, type SignalId, type SpeakerInstrument, type TerminalRef, type WireColor,
} from "@face/model";
import {
  COMPARATOR_SIGNS, CONNECTOR, DIRECTION_NUMBERS, EXPORT_VERSION, LAMP_COLOR_MODE_NUMBERS,
  type Blueprint, type BlueprintCondition, type BlueprintDeciderOutput, type BlueprintEntity, type BlueprintFile, type BlueprintNetworks, type BlueprintSection, type BlueprintSignal, type BlueprintWire,
  type SelectorControlBehavior,
} from "./schema.ts";
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

export type ExportProblemCode = "empty" | "no-tile" | "off-grid" | "overlap" | "custom-signal" | "unknown-instrument" | "unknown-note";

/** Why a circuit cannot become a blueprint. One per code and cause; `entities` are the names of all entities it is about. */
export interface ExportProblem {
  readonly code: ExportProblemCode;
  readonly entities: readonly string[];
  readonly message: string;
}

export type ExportWarningCode = "description-lost" | "wire-too-long";

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

  private condition(condition: Condition | undefined): BlueprintCondition {
    const first = this.optional(condition?.first);
    const second = condition?.second.type === "signal" ? { second_signal: this.signal(condition.second.signal) } : { constant: condition?.second.value ?? 0 };
    return { ...(first && { first_signal: first }), ...second, comparator: COMPARATOR_SIGNS[condition?.comparator ?? "<"] };
  }

  private operand(prefix: "first" | "second", operand: Operand): Record<string, unknown> {
    if (operand.type === "constant") return { [`${prefix}_constant`]: operand.value };
    return { [`${prefix}_signal`]: this.signal(operand.signal), ...networks(`${prefix}_signal_networks`, operand.networks) };
  }

  private output(output: DeciderOutput): BlueprintDeciderOutput {
    const signal = this.signal(output.signal);
    if (output.copyCountFromInput) return { signal, ...networks("networks", output.networks) };
    return { signal, copy_count_from_input: false, ...(output.constant !== 1 && { constant: output.constant }) };
  }

  private selector(mode: SelectorMode): SelectorControlBehavior | undefined {
    const { operation } = mode;
    const signals = (fields: Record<string, SignalId | undefined>): Record<string, BlueprintSignal> =>
      Object.fromEntries(Object.entries(fields).flatMap(([key, id]) => (id ? [[key, this.signal(id)]] : [])));
    switch (mode.operation) {
      case "select": {
        // A selector as it is placed: nothing to say.
        if (mode.max && mode.index.type === "constant" && mode.index.value === 0 && mode.indexComparator === "=") return undefined;
        const index = mode.index.type === "signal" ? { index_signal: this.signal(mode.index.signal) } : { index_constant: mode.index.value };
        return { operation, select_max: mode.max, ...index, ...(mode.indexComparator !== "=" && { index_comparator: COMPARATOR_SIGNS[mode.indexComparator] }) };
      }
      case "count": return { operation, ...signals({ count_signal: mode.output }) };
      case "random": return { operation, random_update_interval: mode.interval };
      case "stack-size":
      case "rocket-capacity": return { operation };
      case "quality-filter":
        // Any quality, which is what the mode starts with: no filter.
        if (mode.quality === undefined && (mode.comparator ?? "=") === "=") return { operation };
        return { operation, quality_filter: { ...(mode.quality !== undefined && { quality: mode.quality }), comparator: COMPARATOR_SIGNS[mode.comparator ?? "="] } };
      case "quality-select": return { operation, ...(!mode.highest && { select_highest_quality: false as const }) };
      case "quality-transfer": {
        const destination = signals({ quality_destination_signal: mode.destination });
        if (mode.source.type === "quality") return { operation, quality_source_static: { name: mode.source.quality }, ...destination };
        // A SignalIDBase: the quality of the source signal is what is read, so the signal itself has none.
        const source = mode.source.signal && { quality_source_signal: this.signal({ kind: mode.source.signal.kind, name: mode.source.signal.name }) };
        return { operation, select_quality_from_signal: true, ...source, ...destination };
      }
      case "time": return { operation, ...signals({ day_length_signal: mode.dayLength, day_tick_signal: mode.dayTick, game_tick_signal: mode.gameTick }) };
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
  private settings(entity: Entity): Omit<BlueprintEntity, "entity_number" | "name" | "position" | "direction"> {
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
        return behavior({ ...(!entity.enabled && { is_on: false }), ...(sections.length > 0 && { sections: { sections } }) });
      }
      case "arithmetic": {
        const isZero = (operand: Operand) => operand.type === "constant" && operand.value === 0;
        if (!entity.output && entity.operation === "*" && isZero(entity.first) && isZero(entity.second)) return {};
        const output = this.optional(entity.output);
        return behavior({ arithmetic_conditions: { ...this.operand("first", entity.first), ...this.operand("second", entity.second), operation: entity.operation, ...(output && { output_signal: output }) } });
      }
      case "decider": {
        const conditions = entity.conditions.map((condition, index) => {
          const first = this.optional(condition.first);
          const second = condition.second.type === "signal"
            ? { second_signal: this.signal(condition.second.signal), ...networks("second_signal_networks", condition.second.networks) }
            : { constant: condition.second.value };
          return {
            ...(first && { first_signal: first, ...networks("first_signal_networks", condition.firstNetworks) }),
            ...second,
            comparator: COMPARATOR_SIGNS[condition.comparator],
            ...(index > 0 && condition.join === "and" && { compare_type: "and" as const }),
          };
        });
        const lists = { conditions, outputs: entity.outputs.map((output) => this.output(output)), else_outputs: entity.elseOutputs.map((output) => this.output(output)) };
        const filled = Object.fromEntries(Object.entries(lists).filter(([, list]) => list.length > 0));
        return behavior(Object.keys(filled).length ? { decider_conditions: filled } : {});
      }
      case "selector":
        return behavior(this.selector(entity.mode) ?? {});
      case "lamp": {
        const signals = { red_signal: this.optional(entity.redSignal), green_signal: this.optional(entity.greenSignal), blue_signal: this.optional(entity.blueSignal), rgb_signal: this.optional(entity.rgbSignal) };
        const control = behavior({
          ...networks("input_networks", entity.inputNetworks),
          ...(entity.condition && { circuit_enabled: true, circuit_condition: this.condition(entity.condition) }),
          ...(entity.useColors && { use_colors: true }),
          ...(entity.colorMode !== "mapping" && { color_mode: LAMP_COLOR_MODE_NUMBERS[entity.colorMode] }),
          ...Object.fromEntries(Object.entries(signals).filter(([, id]) => id)),
        });
        const channel = (value: number) => Math.max(0, Math.min(255, value)) / 255;
        return { ...control, ...(entity.alwaysOn && { always_on: true as const }), ...(entity.color && { color: { r: channel(entity.color.r), g: channel(entity.color.g), b: channel(entity.color.b), a: 1 } }) };
      }
      case "pole":
        return {};
      case "speaker": {
        const volumeSignal = this.optional(entity.volumeSignal);
        const icon = this.optional(entity.alertIcon);
        // With "signal value is pitch" the left side of the condition is the pitch signal; the rest of the condition is not used.
        const condition = entity.pitchSignal ? this.condition({ first: entity.pitchSignal, comparator: "<", second: { type: "constant", value: 0 } }) : this.condition(entity.condition);
        return {
          parameters: {
            playback_volume: entity.volume / 100,
            playback_mode: entity.playbackMode,
            allow_polyphony: entity.allowPolyphony,
            volume_controlled_by_signal: volumeSignal !== undefined,
            ...(volumeSignal && { volume_signal_id: volumeSignal }),
          },
          alert_parameters: { show_alert: entity.showAlert, show_on_map: entity.showOnMap, ...(icon && { icon_signal_id: icon }), alert_message: entity.alertMessage },
          control_behavior: {
            circuit_condition: condition,
            circuit_parameters: { signal_value_is_pitch: entity.pitchSignal !== undefined, stop_playing_sounds: entity.stopPlayingSounds, ...this.sound(entity) },
          },
        };
      }
    }
  }

  entity(entity: Entity, number: number): BlueprintEntity {
    this.current = entity.name;
    const facing = facingOf(entity);
    const tile = entity.placement?.tile ?? { x: 0, y: 0 };
    // The game has the description on the four combinators only.
    const description = entity.description && isCombinator(entity) ? { player_description: entity.description } : {};
    return {
      entity_number: number,
      name: prototypeOf(entity),
      position: { x: tile.x, y: tile.y },
      ...(canRotate(entity) && facing !== "north" && { direction: DIRECTION_NUMBERS[facing] }),
      ...this.settings(entity),
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

/** Up to four icons: the items of the most frequent entities, as the game picks them for a new blueprint. Every entity of the editor has an item of its own name. */
function icons(entities: readonly Entity[]): Blueprint["icons"] {
  const counts = new Map<string, number>();
  for (const entity of entities) counts.set(prototypeOf(entity), (counts.get(prototypeOf(entity)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name], index) => ({ signal: { name }, index: index + 1 }));
}

/**
 * The blueprint of a circuit, as an object and as the string the game imports. Every entity needs a `tile`, on the grid and on
 * tiles of its own; a circuit that cannot become a blueprint gives `ok: false` with everything that is in the way. Edit positions
 * (`at`) and entity names are not part of a blueprint.
 */
export function exportBlueprint(circuit: Circuit, options: ExportOptions = {}): ExportResult {
  const problems = placementProblems(circuit);
  const exporter = new Exporter(options.instruments);
  const entities = circuit.entities.map((entity, index) => exporter.entity(entity, index + 1));
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

  const sorted = [...wires.values()].sort((x, y) => x[0] - y[0] || x[2] - y[2] || x[1] - y[1] || x[3] - y[3]);
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
