// The circuit settings of the generic entities (kind `entity`), as a table keyed by the game's prototype type. A row lists the
// settings of that type; each setting is one of five field types with the field of the blueprint's `control_behavior` it is read
// from and written to, its default and its label. The language, the simulation and the blueprint mapping all read this table:
// a further prototype type is a row here. Where the fields are from: docs/factorio-audit.md 14. The numbers of the modes and the
// defaults are what the game itself says (fixture F-01: `defines`, and `defaults`, the control behaviour of a new entity).

import { BOTH_NETWORKS, COMPARATORS, UNSET_CONDITION, type Condition, type ConditionValue, type EntitySettings, type NetworkSelection, type SettingValue } from "./circuit.ts";
import type { EntityPrototype } from "./entityTable.ts";
import { isSignalKind, sameSignal, type SignalId } from "./signal.ts";

interface SettingBase {
  /** The word of the language and the key in `GenericEntity.settings`: `read-contents`, `when`, `logistic-when`. */
  readonly key: string;
  /** The field of the blueprint's `control_behavior`. */
  readonly field: string;
  /** For a form, in the words of the game's GUI. */
  readonly label: string;
  /**
   * The setting belongs to another one of the entity and the game shows it only while that one has this value (a switch: is on):
   * the signal of "read empty slots", the channel of a radar in universe mode. A form shows it by `settingShown`; the language,
   * the simulation and the blueprint mapping take the setting whatever the other one says.
   */
  readonly shownWhile?: { readonly key: string; readonly is: boolean | string };
}

export interface BooleanSetting extends SettingBase {
  readonly type: "boolean";
  readonly default: boolean;
}

/** A signal the entity sends or reads. Absent: the default of the prototype where it has one (`EntityPrototype.signals`), else none. */
export interface SignalSetting extends SettingBase {
  readonly type: "signal";
  /** The key of the prototype's default in `EntityPrototype.signals`: `empty_slots`. */
  readonly prototypeDefault?: string;
}

/**
 * A circuit condition. It is in the settings exactly while it is in use: `flag` is the boolean field of the blueprint that says so
 * (two conditions of a splitter share one). One in use that names no signal is `UNSET_CONDITION`. The key is `when` for the
 * condition that enables the entity and `<role>-when` for every other one; the language writes `when S > 5` and
 * `<role> when S > 5`, and `when unset` for the blank one.
 */
export interface ConditionSetting extends SettingBase {
  readonly type: "condition";
  readonly flag: string;
  /** Read from the logistic network, which the simulation does not have: kept, never evaluated. */
  readonly logistic?: true;
  /**
   * The game's flag is on in a new entity (the open-gate flag of a wall, with a blank condition). An entity without the condition
   * says in a blueprint that the flag is off, where it says anything; a blueprint that does not name the flag is read as one
   * without the condition.
   */
  readonly flagOnByDefault?: true;
  /**
   * The condition the game has where a blueprint switches the flag on and names none (the sides of a splitter): it leaves this
   * one out of a blueprint and takes it for a condition that is missing.
   */
  readonly gameDefault?: Condition;
}

export interface EnumValue {
  readonly word: string;
  /** What the blueprint holds: the number of the game's define. Absent for the word that stands for the flag being off. */
  readonly value?: number;
}

/**
 * One of several modes. Where the game has a checkbox in front of the modes (`flag`, "read hand contents" before pulse or hold), the
 * checkbox is folded in as the word `flag.off`, so that the setting is one word: `read-hand = none`, `pulse` or `hold`.
 */
export interface EnumSetting extends SettingBase {
  readonly type: "enum";
  readonly values: readonly EnumValue[];
  readonly default: string;
  readonly flag?: { readonly field: string; readonly off: string };
  /** The API reference types the field as a boolean: the words for false and true, accepted when a blueprint has one. */
  readonly booleans?: readonly [string, string];
}

/** Which of the two networks the entity reads its conditions from (`input_networks`) or sends to (`output_networks`). Default: both. */
export interface NetworksSetting extends SettingBase {
  readonly type: "networks";
}

export type SettingSpec = BooleanSetting | SignalSetting | ConditionSetting | EnumSetting | NetworksSetting;
export type SettingType = SettingSpec["type"];

export interface SettingsRow {
  /** The concept of the API reference that describes the `control_behavior` of the type: "InserterBlueprintControlBehavior". */
  readonly behavior: string;
  /** The API reference names no control behaviour for this type; it is the one of the type it derives from, which the game confirms (fixture F-01). */
  readonly assumed?: true;
  /** In the order of the canonical source and of a form. */
  readonly settings: readonly SettingSpec[];
  /** Fields of the control behaviour that the editor keeps for the blueprint without modelling them (`GenericEntity.blueprintData`). */
  readonly kept?: readonly string[];
}

const bool = (key: string, field: string, label: string, fallback = false): BooleanSetting => ({ type: "boolean", key, field, label, default: fallback });
const signalOf = (key: string, field: string, label: string, prototypeDefault?: string): SignalSetting => ({ type: "signal", key, field, label, ...(prototypeDefault !== undefined && { prototypeDefault }) });
/** A setting that belongs to the switch `key`: shown while that is on. */
const under = <S extends SettingSpec>(key: string, spec: S, is: boolean | string = true): S => ({ ...spec, shownWhile: { key, is } });
type ConditionExtras = Partial<Pick<ConditionSetting, "logistic" | "flagOnByDefault" | "gameDefault">>;
const condition = (key: string, field: string, flag: string, label: string, more: ConditionExtras = {}): ConditionSetting => ({ type: "condition", key, field, flag, label, ...more });
/** The words of a mode whose numbers in the game start at `first` and go up by one. */
const words = (first: number, ...names: readonly string[]): EnumValue[] => names.map((word, index) => ({ word, value: first + index }));
/** A side of a splitter as the game has it in a new one: the virtual signal below or above 0. */
const side = (name: string, comparator: "<" | ">"): Condition => ({ first: { kind: "virtual", name }, comparator, second: { type: "constant", value: 0 } });

/** The key of the condition that enables or disables the entity. */
export const ENABLE_CONDITION = "when";
const CONDITION_SUFFIX = "-when";

const NETWORKS: NetworksSetting = { type: "networks", key: "networks", field: "input_networks", label: "Read from" };
const OUTPUT_NETWORKS: NetworksSetting = { type: "networks", key: "output-networks", field: "output_networks", label: "Send to" };
const ENABLE = condition(ENABLE_CONDITION, "circuit_condition", "circuit_enabled", "Enable/disable");
const LOGISTIC = condition("logistic-when", "logistic_condition", "connect_to_logistic_network", "Logistic network condition", { logistic: true });
/** `GenericOnOffBlueprintControlBehavior`, which most behaviours with an enable condition extend. */
const ON_OFF: readonly SettingSpec[] = [ENABLE, LOGISTIC, NETWORKS];

const READ_CONTENTS = bool("read-contents", "read_contents", "Read contents");
const READ_CONTENTS_ON = bool("read-contents", "read_contents", "Read contents", true);
const READ_EMPTY_SLOTS = bool("read-empty-slots", "read_empty_slots", "Read empty slots");
const EMPTY_SLOTS_SIGNAL = under("read-empty-slots", signalOf("empty-slots-signal", "empty_slots_signal", "Empty slots signal", "empty_slots"));
const SET_REQUESTS = bool("set-requests", "set_requests", "Set requests");
const READ_FUEL = bool("read-fuel", "read_fuel", "Read fuel");
const READ_AMMO = bool("read-ammo", "read_ammo", "Read ammunition");
// An artillery turret reads its ammunition unless told otherwise; the other turrets do not.
const READ_AMMO_ON = bool("read-ammo", "read_ammo", "Read ammunition", true);
const READ_TEMPERATURE = bool("read-temperature", "read_temperature", "Read temperature");
const SET_FILTERS = bool("set-filters", "circuit_set_filters", "Set filters");
const SET_FILTER = bool("set-filter", "set_filter", "Set filter");

const CONTAINER: readonly SettingSpec[] = [OUTPUT_NETWORKS, READ_CONTENTS_ON, READ_EMPTY_SLOTS, EMPTY_SLOTS_SIGNAL];
const LOGISTIC_CONTAINER: readonly SettingSpec[] = [
  condition(ENABLE_CONDITION, "circuit_condition", "circuit_condition_enabled", "Enable/disable the logistic connection"), NETWORKS, OUTPUT_NETWORKS, READ_CONTENTS_ON, READ_EMPTY_SLOTS, EMPTY_SLOTS_SIGNAL, SET_REQUESTS,
];
const CRAFTING: readonly SettingSpec[] = [
  READ_CONTENTS, under("read-contents", bool("include-in-crafting", "include_in_crafting", "Include in crafting", true)), READ_FUEL, bool("read-ingredients", "read_ingredients", "Read ingredients"),
  bool("read-recipe-finished", "read_recipe_finished", "Read recipe finished"), under("read-recipe-finished", signalOf("recipe-finished-signal", "recipe_finished_signal", "Recipe finished signal")),
  bool("read-working", "read_working", "Read working"), under("read-working", signalOf("working-signal", "working_signal", "Working signal")),
];
const TURRET: readonly SettingSpec[] = [
  ...ON_OFF, condition("ignore-unlisted-when", "ignore_unlisted_targets_condition", "set_ignore_unlisted_targets", "Ignore unlisted targets"), OUTPUT_NETWORKS, READ_AMMO, bool("set-priority-list", "set_priority_list", "Set priority list"),
];
const FLUID_BOX: readonly SettingSpec[] = [
  OUTPUT_NETWORKS,
  { type: "enum", key: "read-contents", field: "circuit_mode_of_operation", label: "Read contents", values: words(0, "none", "contents", "segment-contents"), default: "contents" },
  READ_TEMPERATURE, under("read-temperature", signalOf("temperature-signal", "temperature_signal", "Temperature signal", "fluid_temperature")),
];
const RAIL_SIGNAL: readonly SettingSpec[] = [
  condition("close-when", "circuit_condition", "circuit_close_signal", "Close signal"), NETWORKS, OUTPUT_NETWORKS, bool("read-signal", "circuit_read_signal", "Read signal", true),
  under("read-signal", signalOf("red-signal", "red_output_signal", "Red signal", "red_output")), under("read-signal", signalOf("orange-signal", "orange_output_signal", "Yellow signal", "orange_output")),
  under("read-signal", signalOf("green-signal", "green_output_signal", "Green signal", "green_output")),
];

const row = (behavior: string, settings: readonly SettingSpec[], more: Partial<Pick<SettingsRow, "assumed" | "kept">> = {}): SettingsRow => ({ behavior, settings, ...more });

const LOADER = row("LoaderBlueprintControlBehavior", [...ON_OFF, OUTPUT_NETWORKS, SET_FILTERS, bool("read-transfers", "circuit_read_transfers", "Read transfers")]);

/** The settings per prototype type. A type that is not here is not a generic entity of the editor. Two types that share a row share its object. */
export const ENTITY_SETTINGS: Readonly<Record<string, SettingsRow>> = {
  accumulator: row("AccumulatorBlueprintControlBehavior", [OUTPUT_NETWORKS, bool("read-charge", "read_charge", "Read charge", true), under("read-charge", signalOf("output-signal", "output_signal", "Charge signal", "output"))]),
  "agricultural-tower": row("AgriculturalTowerBlueprintControlBehavior", [
    ...ON_OFF, condition("harvest-when", "harvesting_condition", "enable_harvesting_condition", "Harvest"), condition("plant-when", "planting_condition", "enable_planting_condition", "Plant"), OUTPUT_NETWORKS, READ_CONTENTS,
  ]),
  "ammo-turret": row("TurretBlueprintControlBehavior", TURRET),
  "artillery-turret": row("ArtilleryTurretBlueprintControlBehavior", [...ON_OFF, OUTPUT_NETWORKS, READ_AMMO_ON]),
  "assembling-machine": row("AssemblingMachineBlueprintControlBehavior", [...ON_OFF, OUTPUT_NETWORKS, bool("set-recipe", "set_recipe", "Set recipe"), ...CRAFTING]),
  "asteroid-collector": row("AsteroidCollectorBlueprintControlBehavior", [...ON_OFF, OUTPUT_NETWORKS, SET_FILTERS, bool("read-contents", "circuit_read_contents", "Read contents"), under("read-contents", bool("include-hands", "include_hands", "Include hands", true))]),
  boiler: row("BoilerBlueprintControlBehavior", [...ON_OFF, OUTPUT_NETWORKS, READ_FUEL]),
  "cargo-landing-pad": row("CargoLandingPadBlueprintControlBehavior", [NETWORKS, OUTPUT_NETWORKS, READ_CONTENTS_ON, READ_EMPTY_SLOTS, EMPTY_SLOTS_SIGNAL, SET_REQUESTS]),
  container: row("ContainerBlueprintControlBehavior", CONTAINER),
  "display-panel": row("DisplayPanelBlueprintControlBehavior", [], { kept: ["parameters"] }),
  "electric-turret": row("TurretBlueprintControlBehavior", TURRET),
  "fluid-turret": row("TurretBlueprintControlBehavior", TURRET),
  furnace: row("FurnaceBlueprintControlBehavior", [...ON_OFF, OUTPUT_NETWORKS, ...CRAFTING]),
  "heat-pipe": row("HeatPipeBlueprintControlBehavior", [OUTPUT_NETWORKS, READ_TEMPERATURE, under("read-temperature", signalOf("temperature-signal", "temperature_signal", "Temperature signal", "temperature"))]),
  "infinity-container": row("LogisticContainerBlueprintControlBehavior", LOGISTIC_CONTAINER),
  "infinity-pipe": row("SingleFluidBoxBlueprintControlBehavior", FLUID_BOX, { assumed: true }),
  inserter: row("InserterBlueprintControlBehavior", [
    ...ON_OFF, OUTPUT_NETWORKS, SET_FILTERS,
    { type: "enum", key: "read-hand", field: "circuit_hand_read_mode", label: "Read hand contents", values: [{ word: "none" }, { word: "pulse", value: 0 }, { word: "hold", value: 1 }], default: "none", flag: { field: "circuit_read_hand_contents", off: "none" } },
    bool("set-stack-size", "circuit_set_stack_size", "Set stack size"), under("set-stack-size", signalOf("stack-size-signal", "stack_control_input_signal", "Stack size signal", "stack_control_input")),
  ]),
  lab: row("LabBlueprintControlBehavior", [
    NETWORKS, OUTPUT_NETWORKS, bool("set-research", "set_research", "Set research"), READ_CONTENTS, READ_FUEL,
    bool("read-research-cost", "read_research_cost", "Read research cost"), bool("read-technology-level", "read_technology_level", "Read technology level"),
    under("read-technology-level", signalOf("technology-level-signal", "technology_level_signal", "Technology level signal", "technology_level")),
  ], { kept: ["conditions"] }),
  "land-mine": row("LandMineBlueprintControlBehavior", ON_OFF),
  "linked-container": row("ContainerBlueprintControlBehavior", CONTAINER, { assumed: true }),
  loader: LOADER,
  // The loader of one tile, which only mods give a circuit connection (miniloaders): the game has one control behaviour for both.
  "loader-1x1": LOADER,
  "logistic-container": row("LogisticContainerBlueprintControlBehavior", LOGISTIC_CONTAINER),
  "mining-drill": row("MiningDrillBlueprintControlBehavior", [
    ...ON_OFF, OUTPUT_NETWORKS,
    { type: "enum", key: "read-resources", field: "circuit_resource_read_mode", label: "Read resources", values: [{ word: "none" }, { word: "this-miner", value: 0 }, { word: "entire-patch", value: 1 }], default: "this-miner", flag: { field: "circuit_read_resources", off: "none" } },
  ]),
  "offshore-pump": row("GenericOnOffBlueprintControlBehavior", ON_OFF),
  pipe: row("SingleFluidBoxBlueprintControlBehavior", FLUID_BOX),
  "pipe-to-ground": row("SingleFluidBoxBlueprintControlBehavior", FLUID_BOX),
  "power-switch": row("GenericOnOffBlueprintControlBehavior", ON_OFF),
  "proxy-container": row("ProxyContainerBlueprintControlBehavior", CONTAINER),
  pump: row("PumpBlueprintControlBehavior", [...ON_OFF, SET_FILTER]),
  radar: row("RadarBlueprintControlBehavior", [
    // `defines.control_behavior.radar.mode` starts at 1.
    { type: "enum", key: "mode", field: "mode", label: "Mode", values: words(1, "surface", "universe"), default: "surface" },
    under("mode", signalOf("channel", "universe_channel", "Universe channel"), "universe"),
  ]),
  "rail-chain-signal": row("RailSignalBaseBlueprintControlBehavior", [...RAIL_SIGNAL, under("read-signal", signalOf("blue-signal", "blue_output_signal", "Blue signal", "blue_output"))]),
  "rail-signal": row("RailSignalBaseBlueprintControlBehavior", RAIL_SIGNAL, { kept: ["blue_output_signal"] }),
  reactor: row("ReactorBlueprintControlBehavior", [OUTPUT_NETWORKS, READ_FUEL, READ_TEMPERATURE, under("read-temperature", signalOf("temperature-signal", "temperature_signal", "Temperature signal", "temperature"))]),
  roboport: row("RoboportBlueprintControlBehavior", [
    OUTPUT_NETWORKS,
    { type: "enum", key: "read-items", field: "read_items_mode", label: "Read items", values: words(0, "none", "logistics", "missing-requests"), default: "logistics", booleans: ["none", "logistics"] },
    bool("read-robot-stats", "read_robot_stats", "Read robot statistics"),
    under("read-robot-stats", signalOf("available-logistic-signal", "available_logistic_output_signal", "Available logistic robots", "available_logistic_output")),
    under("read-robot-stats", signalOf("total-logistic-signal", "total_logistic_output_signal", "Total logistic robots", "total_logistic_output")),
    under("read-robot-stats", signalOf("available-construction-signal", "available_construction_output_signal", "Available construction robots", "available_construction_output")),
    under("read-robot-stats", signalOf("total-construction-signal", "total_construction_output_signal", "Total construction robots", "total_construction_output")),
    under("read-robot-stats", signalOf("roboport-count-signal", "roboport_count_output_signal", "Roboport count", "roboport_count_output")),
  ]),
  "rocket-silo": row("RocketSiloBlueprintControlBehavior", [
    OUTPUT_NETWORKS,
    { type: "enum", key: "read-items", field: "read_items_mode", label: "Read items", values: words(0, "none", "logistic-inventory", "orbital-requests"), default: "logistic-inventory" },
    bool("read-launched", "read_launched", "Read rocket launched"), under("read-launched", signalOf("launched-signal", "launched_signal", "Rocket launched signal", "launched")),
  ]),
  "space-platform-hub": row("SpacePlatformHubBlueprintControlBehavior", [
    NETWORKS, OUTPUT_NETWORKS, READ_CONTENTS_ON, bool("send-to-platform", "send_to_platform", "Send to platform", true), SET_REQUESTS, READ_EMPTY_SLOTS, EMPTY_SLOTS_SIGNAL,
    bool("read-moving-from", "read_moving_from", "Read moving from"), bool("read-moving-to", "read_moving_to", "Read moving to"),
    bool("read-speed", "read_speed", "Read speed"), under("read-speed", signalOf("speed-signal", "speed_signal", "Speed signal", "speed")),
    bool("read-damage-taken", "read_damage_taken", "Read damage taken"), under("read-damage-taken", signalOf("damage-taken-signal", "damage_taken_signal", "Damage taken signal", "damage_taken")),
  ]),
  splitter: row("SplitterBlueprintControlBehavior", [
    condition("input-left-when", "input_left_condition", "set_input_side", "Input priority left", { gameDefault: side("signal-I", "<") }),
    condition("input-right-when", "input_right_condition", "set_input_side", "Input priority right", { gameDefault: side("signal-I", ">") }),
    condition("output-left-when", "output_left_condition", "set_output_side", "Output priority left", { gameDefault: side("signal-O", "<") }),
    condition("output-right-when", "output_right_condition", "set_output_side", "Output priority right", { gameDefault: side("signal-O", ">") }),
    NETWORKS, SET_FILTER,
  ]),
  "storage-tank": row("SingleFluidBoxBlueprintControlBehavior", FLUID_BOX),
  "train-stop": row("TrainStopBlueprintControlBehavior", [
    ...ON_OFF, OUTPUT_NETWORKS, bool("send-to-train", "send_to_train", "Send to train", true), bool("read-from-train", "read_from_train", "Read train contents"),
    bool("read-stopped-train", "read_stopped_train", "Read stopped train"), under("read-stopped-train", signalOf("train-stopped-signal", "train_stopped_signal", "Stopped train signal", "train_stopped")),
    bool("set-trains-limit", "set_trains_limit", "Set train limit"), under("set-trains-limit", signalOf("trains-limit-signal", "trains_limit_signal", "Train limit signal", "trains_limit")),
    bool("read-trains-count", "read_trains_count", "Read train count"), under("read-trains-count", signalOf("trains-count-signal", "trains_count_signal", "Train count signal", "trains_count")),
    bool("set-priority", "set_priority", "Set priority"), under("set-priority", signalOf("priority-signal", "priority_signal", "Priority signal", "priority")),
  ]),
  "transport-belt": row("TransportBeltBlueprintControlBehavior", [
    ...ON_OFF, OUTPUT_NETWORKS,
    {
      type: "enum", key: "read-contents", field: "circuit_contents_read_mode", label: "Read belt contents", values: [{ word: "none" }, { word: "pulse", value: 0 }, { word: "hold", value: 1 }, { word: "entire-belt-hold", value: 2 }], default: "none",
      flag: { field: "circuit_read_hand_contents", off: "none" },
    },
  ]),
  wall: row("WallBlueprintControlBehavior", [
    condition("open-gate-when", "circuit_condition", "circuit_open_gate", "Open gate", { flagOnByDefault: true }), NETWORKS, OUTPUT_NETWORKS, bool("read-sensor", "circuit_read_sensor", "Read gate sensor"),
    under("read-sensor", signalOf("output-signal", "output_signal", "Gate sensor signal", "output")),
  ]),
};

/** The role of a condition in the language: nothing for `when`, `logistic` for `logistic-when`. */
export function conditionRole(key: string): string | undefined {
  return key === ENABLE_CONDITION ? undefined : key.slice(0, -CONDITION_SUFFIX.length);
}

/** The key of the condition a role names: `when` without one. */
export function conditionKey(role: string | undefined): string {
  return role === undefined ? ENABLE_CONDITION : `${role}${CONDITION_SUFFIX}`;
}

/** Every field of the control behaviour a spec reads and writes: its own and the flag folded into it. */
export function settingFields(spec: SettingSpec): string[] {
  if (spec.type === "condition") return [spec.field, spec.flag];
  return spec.type === "enum" && spec.flag ? [spec.field, spec.flag.field] : [spec.field];
}

/** The value a setting has while it is absent. Undefined: no condition, or no signal. */
export function settingDefault(spec: SettingSpec, prototype: Pick<EntityPrototype, "signals">): SettingValue | undefined {
  switch (spec.type) {
    case "boolean": return spec.default;
    case "enum": return spec.default;
    case "networks": return BOTH_NETWORKS;
    case "signal": return spec.prototypeDefault === undefined ? undefined : prototype.signals[spec.prototypeDefault];
    case "condition": return undefined;
  }
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const isSignal = (value: unknown): value is SignalId => isObject(value) && typeof value.kind === "string" && isSignalKind(value.kind) && typeof value.name === "string" && value.name !== "" && (value.quality === undefined || typeof value.quality === "string");
const isNetworks = (value: unknown): value is NetworkSelection => isObject(value) && typeof value.red === "boolean" && typeof value.green === "boolean";

function isCondition(value: unknown): value is Condition {
  if (!isObject(value) || !isSignal(value.first) || !(COMPARATORS as readonly unknown[]).includes(value.comparator) || !isObject(value.second)) return false;
  const { second } = value;
  return second.type === "constant" ? Number.isInteger(second.value) : second.type === "signal" && isSignal(second.signal);
}

/** Whether a value is one the setting takes. A condition has a first signal or is `UNSET_CONDITION`. */
export function isSettingValue(spec: SettingSpec, value: unknown): value is SettingValue {
  switch (spec.type) {
    case "boolean": return typeof value === "boolean";
    case "enum": return typeof value === "string" && spec.values.some((entry) => entry.word === value);
    case "networks": return isNetworks(value);
    case "signal": return isSignal(value);
    case "condition": return value === UNSET_CONDITION || isCondition(value);
  }
}

function sameCondition(a: ConditionValue, b: ConditionValue): boolean {
  if (a === UNSET_CONDITION || b === UNSET_CONDITION) return a === b;
  const sameSecond = a.second.type === "constant" ? b.second.type === "constant" && a.second.value === b.second.value : b.second.type === "signal" && sameSignal(a.second.signal, b.second.signal);
  return a.comparator === b.comparator && sameSecond && (a.first && b.first ? sameSignal(a.first, b.first) : a.first === b.first);
}

/** Whether two values of one setting, both valid for it, say the same. */
export function sameSetting(spec: SettingSpec, a: SettingValue, b: SettingValue): boolean {
  switch (spec.type) {
    case "boolean":
    case "enum": return a === b;
    case "networks": return (a as NetworkSelection).red === (b as NetworkSelection).red && (a as NetworkSelection).green === (b as NetworkSelection).green;
    case "signal": return sameSignal(a as SignalId, b as SignalId);
    case "condition": return sameCondition(a as ConditionValue, b as ConditionValue);
  }
}

/**
 * Whether the game shows a setting, given the settings the entity holds (`shownWhile`): a setting that belongs to a switch only
 * while that is on. One that depends on nothing is always shown.
 */
export function settingShown(spec: SettingSpec, specs: readonly SettingSpec[], prototype: Pick<EntityPrototype, "signals">, settings: EntitySettings): boolean {
  const { shownWhile } = spec;
  const owner = shownWhile && specs.find((candidate) => candidate.key === shownWhile.key);
  return !shownWhile || !owner || (settings[owner.key] ?? settingDefault(owner, prototype)) === shownWhile.is;
}

/**
 * The settings in the form the model holds them: in the order of the specs, without the ones at their default and without
 * anything the specs do not have or that is no value of its setting. Entities are made with it so that two that say the same
 * are equal, and so that the canonical source reads back as the same entity.
 */
export function normalizeSettings(specs: readonly SettingSpec[], prototype: Pick<EntityPrototype, "signals">, settings: EntitySettings): EntitySettings {
  const result: Record<string, SettingValue> = {};
  for (const spec of specs) {
    const value = settings[spec.key];
    if (value === undefined || !isSettingValue(spec, value)) continue;
    const fallback = settingDefault(spec, prototype);
    if (fallback === undefined || !sameSetting(spec, value, fallback)) result[spec.key] = value;
  }
  return result;
}
