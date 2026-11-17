// The blueprint JSON as this package writes it (docs/factorio-audit.md 3 to 5). The importer reads more than this: every field is
// optional there, older spellings are accepted, and what it does not know it reports.

import type { ArithmeticOperation, Comparator, Direction, SelectorOperation, SpeakerPlaybackMode, StandardSignalKind } from "@face/model";

/** `major << 48 | minor << 32 | patch << 16 | build`; too large for bit operators. */
export function packVersion(major: number, minor: number, patch: number, build = 0): number {
  return ((major * 65536 + minor) * 65536 + patch) * 65536 + build;
}

export interface GameVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly build: number;
}

export function unpackVersion(version: number): GameVersion {
  const part = (shift: number) => Math.floor(version / 65536 ** shift) % 65536;
  return { major: part(3), minor: part(2), patch: part(1), build: part(0) };
}

export function formatVersion(version: number): string {
  const { major, minor, patch, build } = unpackVersion(version);
  return `${major}.${minor}.${patch}.${build}`;
}

/** The version an exported blueprint says it is from: Factorio 2.1.25, the version of the audit and the catalog. */
export const EXPORT_VERSION = packVersion(2, 1, 25);

/** `defines.direction` of the four directions an entity of the editor can face. North is the default and is not written. */
export const DIRECTION_NUMBERS: Readonly<Record<Direction, number>> = { north: 0, east: 4, south: 8, west: 12 };

/**
 * `defines.wire_connector_id` as far as circuits go (audit 4.2). An entity with one connection point has `circuit_red` and
 * `circuit_green`, which have the numbers of a combinator's input. 5 and 6 are copper wires.
 */
export const CONNECTOR = { red: 1, green: 2, outputRed: 3, outputGreen: 4, poleCopper: 5, switchRightCopper: 6 } as const;

/** `defines.control_behavior.lamp.color_mode`, as the game numbers it (fixture F-01). */
export const LAMP_COLOR_MODE_NUMBERS = { mapping: 0, components: 1, "packed-rgb": 2 } as const;

/** The game writes the three comparators that have a sign of their own with it; it reads both spellings. */
export const COMPARATOR_SIGNS: Readonly<Record<Comparator, string>> = { "<": "<", ">": ">", "=": "=", "!=": "≠", "<=": "≤", ">=": "≥" };

export interface BlueprintPosition {
  readonly x: number;
  readonly y: number;
}

/** `type` is left out for an item, `quality` for normal quality. */
export interface BlueprintSignal {
  readonly type?: Exclude<StandardSignalKind, "item">;
  readonly name: string;
  readonly quality?: string;
}

export interface BlueprintNetworks {
  readonly red: boolean;
  readonly green: boolean;
}

/** `constant` is written when there is no `second_signal`, also when it is 0. */
export interface BlueprintCondition {
  readonly first_signal?: BlueprintSignal;
  readonly second_signal?: BlueprintSignal;
  readonly constant?: number;
  readonly comparator: string;
}

export interface BlueprintFilter {
  readonly index: number;
  readonly type?: BlueprintSignal["type"];
  readonly name: string;
  readonly quality: string;
  readonly comparator: "=";
  readonly count: number;
}

export interface BlueprintSection {
  readonly index: number;
  readonly filters?: readonly BlueprintFilter[];
  readonly group?: string;
  readonly multiplier?: number;
  readonly active?: false;
}

/** The game writes the sections always: a new combinator has one that is empty (`{ index: 1 }`). */
export interface ConstantControlBehavior {
  readonly sections: { readonly sections: readonly BlueprintSection[] };
  readonly is_on?: false;
}

/** A new combinator is `{ second_constant: 0, operation: "*" }`: a first constant of 0 is left out, a second one is not. */
export interface ArithmeticControlBehavior {
  readonly arithmetic_conditions: {
    readonly first_signal?: BlueprintSignal;
    readonly first_constant?: number;
    readonly second_signal?: BlueprintSignal;
    readonly second_constant?: number;
    readonly operation: ArithmeticOperation;
    readonly output_signal?: BlueprintSignal;
    readonly first_signal_networks?: BlueprintNetworks;
    readonly second_signal_networks?: BlueprintNetworks;
  };
}

/** Unlike `BlueprintCondition`: a `constant` of 0 and the `comparator` `<` are left out. A blank row is `{}`. */
export interface BlueprintDeciderCondition {
  readonly first_signal?: BlueprintSignal;
  readonly second_signal?: BlueprintSignal;
  readonly constant?: number;
  readonly comparator?: string;
  readonly first_signal_networks?: BlueprintNetworks;
  readonly second_signal_networks?: BlueprintNetworks;
  readonly compare_type?: "and";
}

export interface BlueprintDeciderOutput {
  readonly signal: BlueprintSignal;
  readonly copy_count_from_input?: false;
  readonly constant?: number;
  readonly networks?: BlueprintNetworks;
}

/** All three lists always. A new combinator has one blank condition and one blank output: `[{}]`, `[{}]`, `[]`. */
export interface DeciderControlBehavior {
  readonly decider_conditions: {
    readonly conditions: readonly BlueprintDeciderCondition[];
    readonly outputs: readonly (BlueprintDeciderOutput | Record<string, never>)[];
    readonly else_outputs: readonly BlueprintDeciderOutput[];
  };
}

/** The parameters stand in `control_behavior` itself, without the wrapper the arithmetic and the decider combinator have. Always written. */
export interface SelectorControlBehavior {
  readonly operation: SelectorOperation;
  readonly select_max?: boolean;
  readonly index_signal?: BlueprintSignal;
  readonly index_constant?: number;
  readonly index_comparator?: string;
  readonly count_signal?: BlueprintSignal;
  readonly random_update_interval?: number;
  readonly quality_filter?: { readonly quality?: string; readonly comparator: string };
  readonly select_highest_quality?: boolean;
  readonly select_quality_from_signal?: true;
  readonly quality_source_static?: { readonly name: string };
  readonly quality_source_signal?: BlueprintSignal;
  readonly quality_destination_signal?: BlueprintSignal;
  readonly game_tick_signal?: BlueprintSignal;
  readonly day_tick_signal?: BlueprintSignal;
  readonly day_length_signal?: BlueprintSignal;
}

export interface LampControlBehavior {
  readonly input_networks?: BlueprintNetworks;
  readonly circuit_enabled?: true;
  readonly circuit_condition?: BlueprintCondition;
  readonly use_colors?: true;
  readonly red_signal?: BlueprintSignal;
  readonly green_signal?: BlueprintSignal;
  readonly blue_signal?: BlueprintSignal;
  readonly rgb_signal?: BlueprintSignal;
  readonly color_mode?: number;
}

/** Not written for a speaker the circuit does not concern (no condition, no pitch signal, the first note, nothing to stop). */
export interface SpeakerControlBehavior {
  readonly circuit_condition?: BlueprintCondition;
  readonly circuit_parameters: { readonly signal_value_is_pitch: boolean; readonly stop_playing_sounds: boolean; readonly instrument_id: number; readonly note_id: number };
}

export interface SpeakerParameters {
  readonly playback_volume: number;
  readonly playback_mode: SpeakerPlaybackMode;
  readonly allow_polyphony: boolean;
  readonly volume_controlled_by_signal: boolean;
  readonly volume_signal_id?: BlueprintSignal;
}

export interface SpeakerAlertParameters {
  readonly show_alert: boolean;
  readonly show_on_map: boolean;
  readonly icon_signal_id?: BlueprintSignal;
  readonly alert_message: string;
}

/** The control behaviour of a generic entity: the fields of its settings (`ENTITY_SETTINGS` of the model) and the ones it kept. */
export type GenericControlBehavior = Readonly<Record<string, unknown>>;

export interface BlueprintEntity {
  readonly entity_number: number;
  readonly name: string;
  readonly position: BlueprintPosition;
  readonly direction?: number;
  /** Combinators only. */
  readonly player_description?: string;
  readonly control_behavior?: ConstantControlBehavior | ArithmeticControlBehavior | DeciderControlBehavior | SelectorControlBehavior | LampControlBehavior | SpeakerControlBehavior | GenericControlBehavior;
  /** Lamp. */
  readonly always_on?: true;
  /** Lamp: 0 to 1 per channel. */
  readonly color?: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
  /** Speaker. */
  readonly parameters?: SpeakerParameters;
  readonly alert_parameters?: SpeakerAlertParameters;
  /** A generic entity: whatever it kept of the blueprint it came from (`recipe`, `filters`, `quality`, ...). */
  readonly [kept: string]: unknown;
}

/** Entity number and connector of one end, then of the other. */
export type BlueprintWire = readonly [number, number, number, number];

export interface Blueprint {
  readonly icons?: readonly { readonly signal: BlueprintSignal; readonly index: number }[];
  readonly entities: readonly BlueprintEntity[];
  readonly wires?: readonly BlueprintWire[];
  readonly item: "blueprint";
  readonly label?: string;
  readonly version: number;
}

/** The root object of a blueprint string that holds one blueprint. */
export interface BlueprintFile {
  readonly blueprint: Blueprint;
}
