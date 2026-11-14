// The generic entities (kind `entity`: chests, inserters, belts, machines, ...) between a blueprint and the editor. Both ways are
// driven by the settings table of the model (`ENTITY_SETTINGS`): a setting is read from and written to the field of the
// `control_behavior` its spec names, and everything else the blueprint says about the entity is kept as it is
// (`GenericEntity.blueprintData`) and written back with the modelled fields over it.

import {
  BOTH_NETWORKS, canRotate, DIRECTIONS, facingOf, gamePrototype, NORMAL_QUALITY, normalizedSettings, sameSetting, settingDefault, settingFields, settingSpecsOf,
  type Condition, type ConditionSetting, type Direction, type EntityOfKind, type EnumSetting, type NetworkSelection, type PrototypeName, type SettingValue, type SignalId,
} from "@face/model";
import { circuitCondition, Fields, isObject, type Json, type NoteSink } from "./reader.ts";
import { DIRECTION_NUMBERS, type BlueprintCondition, type BlueprintSignal } from "./schema.ts";

type GenericSettings = Omit<EntityOfKind<"entity">, "id" | "name" | "position" | "placement" | "description">;

/** What every entity record has and the editor holds elsewhere. */
const STRUCTURAL: ReadonlySet<string> = new Set(["entity_number", "name", "position"]);
/** Wires as an entity record of an older format has them; the editor reads the wires of the blueprint. */
const WIRING: ReadonlySet<string> = new Set(["wires", "connections", "neighbours"]);

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

/** The conditions of the specs: each is in the settings exactly when its flag is on and it has a left side. */
function readConditions(specs: readonly ConditionSetting[], behavior: Fields | undefined, values: Record<string, SettingValue>): void {
  const byFlag = new Map<string, ConditionSetting[]>();
  for (const spec of specs) byFlag.set(spec.flag, [...(byFlag.get(spec.flag) ?? []), spec]);
  for (const [flag, group] of byFlag) {
    const on = behavior?.boolean(flag, false) ?? false;
    const read = group.map((spec) => ({ spec, condition: circuitCondition(behavior?.fields(spec.field)) }));
    if (on && read.every(({ condition }) => !condition)) behavior?.changed(flag, "is on with a blank condition; the editor has no blank condition and takes it as off");
    for (const { spec, condition } of read) {
      if (!condition) continue;
      if (on) values[spec.key] = condition;
      else behavior?.changed(spec.field, "is set while it is not in use; the editor keeps a condition only when it is in use");
    }
  }
}

/**
 * A generic entity from its blueprint record: the settings of its prototype type, the direction it faces in the editor (north
 * without one) and, as `blueprintData`, everything else the record says. A direction that is no quarter turn, or that stands on a
 * prototype the entity table says cannot turn, is part of that data.
 */
export function readGeneric(prototype: PrototypeName, record: Json, note: NoteSink): { settings: GenericSettings; direction: Direction } {
  const shape = { kind: "entity" as const, prototype };
  const specs = settingSpecsOf(prototype);

  let direction: Direction = "north";
  let keepDirection = false;
  const turned = record.direction;
  if (turned !== undefined && turned !== null) {
    if (!isDirectionNumber(turned)) note("invalid", "direction", "is not a direction");
    else if (!canRotate(shape)) keepDirection = turned !== 0;
    else {
      direction = nearestQuarterTurn(turned);
      keepDirection = turned % 4 !== 0;
      if (keepDirection) note("changed", "direction", "is not a quarter turn, the only turns the editor has; the entity faces the nearest one there and keeps its direction for the blueprint");
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
      if (keepDirection) kept.push([key, value]);
    } else if (key === "control_behavior") {
      const rest = isObject(value) ? Object.entries(value).filter(([field, member]) => !modelled.has(field) && present(member)) : [];
      if (rest.length) kept.push([key, Object.fromEntries(rest)]);
    } else kept.push([key, value]);
  }
  // `Object.fromEntries` defines every key as a property of its own, also `__proto__`.
  const blueprintData = kept.length ? JSON.stringify(Object.fromEntries(kept)) : undefined;
  return { settings: { kind: "entity", prototype, settings: normalizedSettings(prototype, values), ...(blueprintData !== undefined && { blueprintData }) }, direction };
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
 * to it (or cannot turn in the editor at all), else the direction it faces in the editor. North is not written.
 */
function genericDirection(entity: EntityOfKind<"entity">, kept: Json): number | undefined {
  const facing = facingOf(entity);
  const turns = canRotate(entity);
  const held = kept.direction;
  if (isDirectionNumber(held) && held !== 0 && (!turns || nearestQuarterTurn(held) === facing)) return held;
  return turns && facing !== "north" ? DIRECTION_NUMBERS[facing] : undefined;
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
  const control: [string, unknown][] = isObject(kept.control_behavior) ? Object.entries(kept.control_behavior).filter(([field]) => !modelled.has(field)) : [];
  for (const spec of specs) {
    const value = entity.settings[spec.key];
    const fallback = settingDefault(spec, game);
    if (value === undefined || (fallback !== undefined && sameSetting(spec, value, fallback))) continue;
    switch (spec.type) {
      case "boolean":
        control.push([spec.field, value]);
        break;
      case "signal":
        control.push([spec.field, writers.signal(value as SignalId)]);
        break;
      case "networks": {
        const { red, green } = value as NetworkSelection;
        control.push([spec.field, { red, green }]);
        break;
      }
      case "condition":
        // Two conditions may share their flag.
        if (!control.some(([field]) => field === spec.flag)) control.push([spec.flag, true]);
        control.push([spec.field, writers.condition(value as Condition)]);
        break;
      case "enum": {
        const off = spec.flag !== undefined && value === spec.flag.off;
        if (spec.flag) control.push([spec.flag.field, !off]);
        if (!off) control.push([spec.field, spec.values.find((entry) => entry.word === value)?.value]);
        break;
      }
    }
  }
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
