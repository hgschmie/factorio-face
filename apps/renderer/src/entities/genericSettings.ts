// The settings form of a generic entity (kind `entity`) as data: which settings it shows, the value of each, the entity after an
// edit, and what it keeps from a blueprint; and for an entity of any kind the prototypes it can become. Everything follows the
// settings table of the model (`ENTITY_SETTINGS` by prototype type) and its entity table: a further type, setting or prototype
// needs nothing here. Pure.
import {
  entityTable, gamePrototype, heldPrototype, isSettingValue, PROTOTYPES, prototypesOf, sameSetting, settingDefault, settingShown, settingSpecsOf, signal,
  type Condition, type ConditionSetting, type Entity, type EnumSetting, type GenericEntity, type PrototypeName, type SettingSpec, type SettingValue,
} from "@face/model";

/** The value a control shows: what the entity holds, else the default of a new entity. Undefined: no condition, or no signal. */
export function settingValue(entity: GenericEntity, spec: SettingSpec): SettingValue | undefined {
  return entity.settings[spec.key] ?? settingDefault(spec, gamePrototype(entity));
}

/** The settings the form shows, in the order of the table: all but those that belong to a switch that is off (`shownWhile`). */
export function shownSettings(entity: GenericEntity): readonly SettingSpec[] {
  const specs = settingSpecsOf(entity.prototype);
  const game = gamePrototype(entity);
  return specs.filter((spec) => settingShown(spec, specs, game, entity.settings));
}

/**
 * The entity with one setting changed. A value at its default is not held, so the source does not say it; `undefined` takes the
 * setting away (a condition that is switched off, a signal field that is emptied: the default of the prototype then applies).
 * A value the setting does not take as it is (a condition whose signal is still missing) is held all the same: it is the draft
 * the inspector shows until it is complete.
 */
export function withSetting(entity: GenericEntity, spec: SettingSpec, value: SettingValue | undefined): GenericEntity {
  const fallback = settingDefault(spec, gamePrototype(entity));
  const atDefault = value !== undefined && fallback !== undefined && isSettingValue(spec, value) && sameSetting(spec, value, fallback);
  const settings: Record<string, SettingValue> = {};
  for (const candidate of settingSpecsOf(entity.prototype)) {
    const held = candidate.key === spec.key ? (atDefault ? undefined : value) : entity.settings[candidate.key];
    if (held !== undefined) settings[candidate.key] = held;
  }
  return { ...entity, settings };
}

/**
 * The condition a checkbox switches on: the one the game has in a new entity where it has one (the sides of a splitter), else
 * the first virtual signal above zero, as for a lamp.
 */
export function newCondition(spec: ConditionSetting): Condition {
  return spec.gameDefault ?? { first: signal("virtual", "signal-A"), comparator: ">", second: { type: "constant", value: 0 } };
}

/** A word of the language as a label: `entire-belt-hold` is "Entire belt hold". */
export function wordLabel(word: string): string {
  const text = word.replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The modes of an enum for a select, in the order of the table. */
export function enumOptions(spec: EnumSetting): readonly { readonly value: string; readonly label: string }[] {
  return spec.values.map(({ word }) => ({ value: word, label: wordLabel(word) }));
}

/**
 * The prototypes an entity can become. A generic entity stays in its prototype type (an inserter can be a fast inserter; they
 * take the same settings); an entity of any other kind stays in its kind, whose first prototype comes first. In the order of
 * `position` where given. Without the ones the game hides and the ones `offers` refuses (a module that is off), but always with
 * the one the entity is.
 */
export function alternativePrototypes(prototype: PrototypeName, offers: (candidate: PrototypeName) => boolean = () => true, position?: (candidate: PrototypeName) => number): readonly PrototypeName[] {
  const table = entityTable();
  const kind = PROTOTYPES[prototype]?.kind;
  const type = table.byName.get(prototype)?.type;
  const candidates = kind === undefined ? [] : kind === "entity" ? table.entities.filter((game) => game.type === type && PROTOTYPES[game.name]?.kind === "entity").map((game) => game.name) : prototypesOf(kind);
  const same = candidates.filter((name) => name === prototype || (!table.byName.get(name)!.hidden && offers(name)));
  return position ? [...same].sort((a, b) => position(a) - position(b)) : same;
}

/**
 * The entity as another prototype. A generic entity becomes another one of its type: the settings it holds stay, less those
 * that are the default of the new one (the defaults of the signals are the prototype's). An entity of any other kind becomes
 * another one of its kind and keeps everything else: the prototype decides its tiles and its reach, not what it does; the
 * first of the kind goes without saying (`heldPrototype`).
 */
export function withPrototype<E extends Entity>(entity: E, prototype: PrototypeName): E {
  if (entity.kind !== "entity") {
    const { prototype: _held, ...rest } = entity;
    const held = heldPrototype(entity.kind, prototype);
    return (held === undefined ? rest : { ...rest, prototype: held }) as E;
  }
  let next: GenericEntity = { ...entity, prototype, settings: {} };
  for (const spec of settingSpecsOf(prototype)) next = withSetting(next, spec, entity.settings[spec.key]);
  return next as E;
}

/** The fields a blueprint has for the entity that the editor keeps without modelling them: the top-level keys of `blueprintData`, as they are written. */
export function keptFields(entity: GenericEntity): readonly string[] {
  if (entity.blueprintData === undefined) return [];
  try {
    const data: unknown = JSON.parse(entity.blueprintData);
    return typeof data === "object" && data !== null && !Array.isArray(data) ? Object.keys(data) : [];
  } catch {
    return [];
  }
}

/** The condition of the entity that lacks its signal, if one does: what keeps an edit from being written. */
export function incompleteCondition(entity: GenericEntity): ConditionSetting | undefined {
  return settingSpecsOf(entity.prototype).find((spec): spec is ConditionSetting => spec.type === "condition" && entity.settings[spec.key] !== undefined && !(entity.settings[spec.key] as Condition).first);
}
