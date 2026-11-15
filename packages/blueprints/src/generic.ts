// The generic entities (kind `entity`: chests, inserters, belts, machines, ...) between a blueprint and the editor. Both ways are
// driven by the settings table of the model (`ENTITY_SETTINGS`): a setting is read from and written to the field of the
// `control_behavior` its spec names, and everything else the blueprint says about the entity is kept as it is
// (`GenericEntity.blueprintData`) and written back with the modelled fields over it.

import {
  BOTH_NETWORKS, canRotate, DIRECTIONS, ENTITY_SETTINGS, facingOf, gamePrototype, NORMAL_QUALITY, normalizedSettings, sameSetting, settingDefault, settingFields, settingSpecsOf, UNSET_CONDITION,
  type Condition, type ConditionSetting, type Direction, type EntityConfig, type EntityOfKind, type EnumSetting, type NetworkSelection, type PrototypeName, type SettingValue, type SignalId,
} from "@face/model";
import { circuitCondition, Fields, isObject, type Json, type NoteSink } from "./reader.ts";
import { DIRECTION_NUMBERS, type BlueprintCondition, type BlueprintSignal } from "./schema.ts";

type GenericSettings = Omit<EntityConfig<"entity">, "placement" | "description">;

/** What every entity record has and the editor holds elsewhere. */
const STRUCTURAL: ReadonlySet<string> = new Set(["entity_number", "name", "position"]);
/** Wires as an entity record of an older format has them; the editor reads the wires of the blueprint. */
const WIRING: ReadonlySet<string> = new Set(["wires", "connections", "neighbours"]);

/** A condition without a left side as the game has it in a new entity. */
const BLANK_CONDITION: Condition = { comparator: "<", second: { type: "constant", value: 0 } };

const NETWORK_FIELDS: ReadonlySet<string> = new Set(["input_networks", "output_networks"]);

const CRAFTING_ORDER = ["read_recipe_finished", "recipe_finished_signal", "read_ingredients", "read_working", "working_signal"];
const RAIL_SIGNAL_ORDER = ["circuit_close_signal", "circuit_read_signal", "red_output_signal", "orange_output_signal", "green_output_signal", "blue_output_signal", "circuit_condition"];
const TURRET_ORDER = ["set_priority_list", "set_ignore_unlisted_targets", "read_ammo", "ignore_unlisted_targets_condition"];

/**
 * The order in which the game writes the fields of a control behaviour (fixture F-01), where it is not the order of the settings
 * table: the network selections come first, then the fields that are not listed here in the order of the table, then the listed
 * ones in this order. Keyed by `SettingsRow.behavior`.
 */
const FIELD_ORDER: Readonly<Record<string, readonly string[]>> = {
  AccumulatorBlueprintControlBehavior: ["output_signal", "read_charge"],
  AgriculturalTowerBlueprintControlBehavior: ["read_contents", "enable_harvesting_condition", "enable_planting_condition", "harvesting_condition", "planting_condition"],
  AssemblingMachineBlueprintControlBehavior: CRAFTING_ORDER,
  FurnaceBlueprintControlBehavior: CRAFTING_ORDER,
  LabBlueprintControlBehavior: ["read_contents", "read_research_cost", "set_research", "read_technology_level", "technology_level_signal"],
  LogisticContainerBlueprintControlBehavior: ["circuit_condition_enabled", "circuit_condition"],
  RailSignalBaseBlueprintControlBehavior: RAIL_SIGNAL_ORDER,
  SpacePlatformHubBlueprintControlBehavior: [
    "read_contents", "read_empty_slots", "empty_slots_signal", "set_requests", "send_to_platform", "read_moving_from", "read_moving_to", "read_speed", "speed_signal", "read_damage_taken", "damage_taken_signal",
  ],
  TurretBlueprintControlBehavior: TURRET_ORDER,
  WallBlueprintControlBehavior: ["circuit_open_gate", "circuit_read_sensor", "output_signal", "circuit_condition"],
};

/** The written settings in the order of the game. The sort is stable, so that what has no place of its own keeps the order it came in. */
function inGameOrder(behavior: string, settings: readonly [string, unknown][]): [string, unknown][] {
  const order = FIELD_ORDER[behavior] ?? [];
  const rank = ([field]: [string, unknown]): number => (NETWORK_FIELDS.has(field) ? -2 : order.indexOf(field));
  return [...settings].sort((a, b) => rank(a) - rank(b));
}

/** `defines.direction` has sixteen steps. */
const isDirectionNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 15;

/** The quarter turn nearest to a direction of sixteen steps; halfway goes clockwise. */
export function nearestQuarterTurn(direction: number): Direction {
  return DIRECTIONS[((Math.round(direction / 4) % 4) + 4) % 4]!;
}

function readEnum(spec: EnumSetting, behavior: Fields | undefined, note: NoteSink): string {
  const valued = spec.values.filter((entry) => entry.value !== undefined);
  const raw = behavior?.raw(spec.field);
  const word = typeof raw === "number" ? valued.find((entry) => entry.value === raw)?.word : typeof raw === "boolean" ? spec.booleans?.[raw ? 1 : 0] : undefined;
  if (raw !== undefined && word === undefined) note("invalid", `control_behavior.${spec.field}`, `is not one of ${valued.map((entry) => entry.value).join(", ")}`);
  if (!spec.flag) return word ?? spec.default;
  // The checkbox in front of the modes: off is a word of its own, and a mode kept while it is off means nothing.
  const onByDefault = spec.default !== spec.flag.off;
  if (!(behavior?.boolean(spec.flag.field, onByDefault) ?? onByDefault)) return spec.flag.off;
  return word ?? (onByDefault ? spec.default : valued[0]!.word);
}

/**
 * The conditions of the specs: each is in the settings exactly when its flag is on. One that is on without a left side is the
 * unset condition, whatever stands behind the blank signal. So is one that is on and not written, with two exceptions: where the
 * game has a condition of its own for one that a blueprint leaves out (the sides of a splitter), that one stands in; and a flag
 * the blueprint does not name, on because the game has it on in a new entity (the open-gate flag of a wall), is no condition.
 */
function readConditions(specs: readonly ConditionSetting[], behavior: Fields | undefined, values: Record<string, SettingValue>): void {
  const byFlag = new Map<string, ConditionSetting[]>();
  for (const spec of specs) byFlag.set(spec.flag, [...(byFlag.get(spec.flag) ?? []), spec]);
  for (const [flag, group] of byFlag) {
    const said = behavior?.has(flag) ?? false;
    const on = behavior?.boolean(flag, group.some((spec) => spec.flagOnByDefault)) ?? false;
    for (const spec of group) {
      const fields = behavior?.fields(spec.field);
      const written = circuitCondition(fields);
      if (!on) {
        if (written) behavior?.changed(spec.field, "is set while it is not in use; the editor keeps a condition only when it is in use");
        continue;
      }
      const unwritten = spec.gameDefault ?? (said ? UNSET_CONDITION : undefined);
      const condition = written ?? (fields ? UNSET_CONDITION : unwritten);
      if (condition !== undefined) values[spec.key] = condition;
    }
  }
}

/**
 * A generic entity from its blueprint record: the settings of its prototype type, the direction it faces in the editor (north
 * without one) and, as `blueprintData`, everything else the record says. A direction is read as the game builds it: none on a
 * prototype that does not turn, and of the sixteen the last one before it that the prototype is built in. Of a prototype of eight
 * or sixteen directions one that is no quarter turn is part of the kept data.
 */
export function readGeneric(prototype: PrototypeName, record: Json, note: NoteSink): { settings: GenericSettings; direction: Direction } {
  const shape = { prototype };
  const specs = settingSpecsOf(prototype);

  let direction: Direction = "north";
  let keptDirection: number | undefined;
  const turned = record.direction;
  if (turned !== undefined && turned !== null && canRotate(shape)) {
    if (!isDirectionNumber(turned)) note("invalid", "direction", "is not a direction");
    else {
      const step = 16 / Math.max(gamePrototype(shape).directions, 4);
      const built = Math.floor(turned / step) * step;
      if (step === 4) direction = DIRECTIONS[built / 4]!;
      else {
        direction = nearestQuarterTurn(built);
        if (built % 4 !== 0) keptDirection = built;
      }
      const kept = "is not a quarter turn, the only turns the editor has; the entity faces the nearest one there and keeps its direction for the blueprint";
      if (keptDirection !== undefined) note("changed", "direction", kept);
      else if (built !== turned) note("changed", "direction", "is not a direction the entity is built in; the game takes the one before it, and so does the editor");
    }
  }

  const control = record.control_behavior;
  if (control !== undefined && control !== null && !isObject(control)) note("invalid", "control_behavior", "is not an object");
  const behavior = isObject(control) ? new Fields(control, "control_behavior", note) : undefined;
  const values: Record<string, SettingValue> = {};
  for (const spec of specs) {
    switch (spec.type) {
      case "boolean":
        values[spec.key] = behavior?.boolean(spec.field, spec.default) ?? spec.default;
        break;
      case "signal": {
        const id = behavior?.signal(spec.field);
        if (id) values[spec.key] = id;
        break;
      }
      case "networks":
        values[spec.key] = behavior?.networks(spec.field) ?? BOTH_NETWORKS;
        break;
      case "enum":
        values[spec.key] = readEnum(spec, behavior, note);
        break;
      case "condition":
        break;
    }
  }
  readConditions(specs.filter((spec) => spec.type === "condition"), behavior, values);

  const modelled = new Set(specs.flatMap(settingFields));
  const present = (value: unknown): boolean => value !== undefined && value !== null;
  const kept: [string, unknown][] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!present(value) || STRUCTURAL.has(key) || (key === "quality" && value === NORMAL_QUALITY)) continue;
    if (WIRING.has(key)) note("ignored", key, "is something the editor does not have");
    else if (key === "direction") {
      if (keptDirection !== undefined) kept.push([key, keptDirection]);
    } else if (key === "control_behavior") {
      const rest = isObject(value) ? Object.entries(value).filter(([field, member]) => !modelled.has(field) && present(member)) : [];
      if (rest.length) kept.push([key, Object.fromEntries(rest)]);
    } else kept.push([key, value]);
  }
  // `Object.fromEntries` defines every key as a property of its own, also `__proto__`.
  const blueprintData = kept.length ? JSON.stringify(Object.fromEntries(kept)) : undefined;
  return { settings: { kind: "entity", settings: normalizedSettings(prototype, values), ...(blueprintData !== undefined && { blueprintData }) }, direction };
}

/** The kept data of a generic entity as the object it is the text of; undefined when it is not the JSON of an object. */
export function parseBlueprintData(text: string | undefined): Json | undefined {
  if (text === undefined) return {};
  try {
    const data: unknown = JSON.parse(text);
    return isObject(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `direction` of a generic entity in a blueprint: the one it kept, as long as the entity still faces the quarter turn nearest
 * to it, else the direction it faces in the editor. North is not written, and nothing for an entity that does not turn.
 */
function genericDirection(entity: EntityOfKind<"entity">, kept: Json): number | undefined {
  if (!canRotate(entity)) return undefined;
  const facing = facingOf(entity);
  const held = kept.direction;
  if (isDirectionNumber(held) && held !== 0 && nearestQuarterTurn(held) === facing) return held;
  return facing !== "north" ? DIRECTION_NUMBERS[facing] : undefined;
}

export interface GenericWriters {
  signal(id: SignalId): BlueprintSignal;
  condition(condition: Condition): BlueprintCondition;
}

/**
 * What a generic entity has in a blueprint besides number, name and position: its direction, its `control_behavior` (the kept
 * one with every modelled field written over it; a setting at its default is not written) and the rest of the kept data. The
 * kept fields stand in the order they were kept in, direction and control behaviour among them, so that the data reads back as
 * the same text; where the kept data has neither, they come first.
 */
export function writeGeneric(entity: EntityOfKind<"entity">, kept: Json, writers: GenericWriters): Record<string, unknown> {
  const specs = settingSpecsOf(entity.prototype);
  const game = gamePrototype(entity);
  const modelled = new Set(specs.flatMap(settingFields));
  const settings: [string, unknown][] = [];
  /** Conditions the entity does not have although the game switches them on in a new one: said as off when anything else is said. */
  const off: [string, false][] = [];
  for (const spec of specs) {
    const value = entity.settings[spec.key];
    if (spec.type === "condition") {
      const inUse = specs.some((other) => other.type === "condition" && other.flag === spec.flag && entity.settings[other.key] !== undefined);
      // Two conditions may share their flag. One that is the game's own for a missing condition is left out, as the game leaves it out.
      if (inUse && !settings.some(([field]) => field === spec.flag)) settings.push([spec.flag, true]);
      // The unset condition is the flag alone, as the game writes it; where a missing condition stands for the game's own, it is one without a left side.
      if (value === UNSET_CONDITION) {
        if (spec.gameDefault) settings.push([spec.field, writers.condition(BLANK_CONDITION)]);
      } else if (value !== undefined && !(spec.gameDefault && sameSetting(spec, value, spec.gameDefault))) settings.push([spec.field, writers.condition(value as Condition)]);
      if (!inUse && spec.flagOnByDefault) off.push([spec.flag, false]);
      continue;
    }
    const fallback = settingDefault(spec, game);
    if (value === undefined || (fallback !== undefined && sameSetting(spec, value, fallback))) continue;
    switch (spec.type) {
      case "boolean":
        settings.push([spec.field, value]);
        break;
      case "signal":
        settings.push([spec.field, writers.signal(value as SignalId)]);
        break;
      case "networks": {
        const { red, green } = value as NetworkSelection;
        settings.push([spec.field, { red, green }]);
        break;
      }
      case "enum": {
        const none = spec.flag !== undefined && value === spec.flag.off;
        if (spec.flag) settings.push([spec.flag.field, !none]);
        if (!none) settings.push([spec.field, spec.values.find((entry) => entry.word === value)?.value]);
        break;
      }
    }
  }
  if (settings.length > 0) settings.push(...off);
  const control: [string, unknown][] = [
    ...(isObject(kept.control_behavior) ? Object.entries(kept.control_behavior).filter(([field]) => !modelled.has(field)) : []),
    ...inGameOrder(ENTITY_SETTINGS[game.type]!.behavior, settings),
  ];
  const direction = genericDirection(entity, kept);
  const behavior = control.length ? Object.fromEntries(control) : undefined;
  const written: [string, unknown][] = [];
  if (direction !== undefined && !Object.hasOwn(kept, "direction")) written.push(["direction", direction]);
  if (behavior && !Object.hasOwn(kept, "control_behavior")) written.push(["control_behavior", behavior]);
  for (const [key, value] of Object.entries(kept)) {
    if (STRUCTURAL.has(key) || WIRING.has(key)) continue;
    if (key === "direction") {
      if (direction !== undefined) written.push([key, direction]);
    } else if (key === "control_behavior") {
      if (behavior) written.push([key, behavior]);
    } else written.push([key, value]);
  }
  return Object.fromEntries(written);
}
