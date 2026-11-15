// What the blueprint probe sends to the game. One case per sample circuit of packages/blueprints/test/samples.ts: the blueprint
// string this project exports for it, and the same circuit as instructions for the game's runtime API (create the entity, set
// its control behaviour, connect the wires), so that the game can build it without reading a blueprint of ours and export its
// own. And every prototype of the editor with the attributes of its control behaviour, which the game is asked for as it places
// the entity. Bundled with esbuild by blueprints.mjs, because the language package is not plain enough for Node's type stripping.

import { canRotate, ENTITY_SETTINGS, entityTable, facingOf, gamePrototype, PROTOTYPE_NAMES, PROTOTYPES, settingFields, TERMINALS, type Circuit, type Entity, type EntityOfKind, type Point } from "@face/model";
import type { BlueprintEntity, BlueprintFile, BlueprintSection, LampControlBehavior, SpeakerControlBehavior } from "../../../packages/blueprints/src/index.ts";
import { ENUM_DEFINES, runtimeAttribute } from "../../../packages/blueprints/test/gameNames.ts";
import { exportedSamples, sampleCircuit, SAMPLES } from "../../../packages/blueprints/test/samples.ts";

/** A LogisticFilter of the runtime API: the slot of a constant combinator section. */
interface NativeFilter {
  readonly value: { readonly type: string; readonly name: string; readonly quality: string; readonly comparator: "=" };
  readonly min: number;
}

/**
 * One assignment to the control behaviour of a generic entity: the attribute of the runtime API and its value, which for an enum
 * is a member of `defines.control_behavior` named by its path, because the number is what the probe is to find out.
 */
export interface NativeAssignment {
  readonly attribute: string;
  readonly value?: unknown;
  readonly define?: readonly string[];
}

export interface NativeEntity {
  readonly name: string;
  readonly position: Point;
  /** A member of `defines.direction`, for an entity that can turn. */
  readonly direction?: string;
  /** `LuaEntity.combinator_description`. */
  readonly description?: string;
  /** Constant combinator: the switch and all sections of the blueprint; the section a new combinator has is removed first. */
  readonly constant?: { readonly enabled: boolean; readonly sections: readonly { readonly group?: string; readonly active: boolean; readonly multiplier: number; readonly filters: readonly NativeFilter[] }[] };
  /** Arithmetic, decider and selector combinator: `LuaCombinatorControlBehavior.parameters`. */
  readonly parameters?: unknown;
  readonly lamp?: { readonly always_on: boolean; readonly color?: BlueprintEntity["color"]; readonly behavior?: Omit<LampControlBehavior, "color_mode"> & { readonly color_mode: string } };
  readonly speaker?: { readonly parameters: BlueprintEntity["parameters"]; readonly alert_parameters: BlueprintEntity["alert_parameters"]; readonly behavior?: SpeakerControlBehavior };
  /** A generic entity: its settings as assignments to its control behaviour, in this order. */
  readonly behavior?: readonly NativeAssignment[];
}

/** Entity index from 1, a member of `defines.wire_connector_id`, and the same for the other end. */
export type NativeWire = readonly [number, string, number, string];

export interface ProbeCase {
  readonly label: string;
  /** Where the game builds the case: on a space platform when it has the hub of one, which stands nowhere else. */
  readonly surface?: "platform";
  readonly string: string;
  readonly entities: readonly NativeEntity[];
  readonly wires: readonly NativeWire[];
}

/** `defines.control_behavior.lamp.color_mode` by the editor's word for the mode. */
const COLOR_MODE_NAMES = { mapping: "color_mapping", components: "components", "packed-rgb": "packed_rgb" } as const;

/**
 * The settings of a generic entity for the runtime API: every field this project wrote into its `control_behavior`, under the
 * name the control behaviour of the game has for it. A flag comes before the condition or the mode it switches on.
 */
function nativeBehavior(entity: EntityOfKind<"entity">, record: BlueprintEntity): NativeAssignment[] {
  const { behavior, settings } = ENTITY_SETTINGS[gamePrototype(entity).type]!;
  const written = (record.control_behavior ?? {}) as Readonly<Record<string, unknown>>;
  const assignments = new Map<string, NativeAssignment>();
  const assign = (field: string, define?: readonly string[]): void => {
    if (written[field] !== undefined && !assignments.has(field)) assignments.set(field, { attribute: runtimeAttribute(behavior, field), ...(define ? { define } : { value: written[field] }) });
  };
  for (const spec of settings) {
    if (spec.type === "condition") assign(spec.flag);
    if (spec.type !== "enum") assign(spec.field);
    else {
      if (spec.flag) assign(spec.flag.field);
      const define = ENUM_DEFINES[`${behavior}.${spec.field}`];
      const member = define?.members[String(entity.settings[spec.key] ?? spec.default)];
      assign(spec.field, define && member !== undefined ? [...define.path, member] : undefined);
    }
  }
  return [...assignments.values()];
}

function nativeEntity(entity: Entity, record: BlueprintEntity): NativeEntity {
  const base = {
    name: entity.prototype,
    position: record.position,
    ...(canRotate(entity) && { direction: facingOf(entity) }),
    ...(record.player_description !== undefined && { description: record.player_description }),
  };
  const behavior = record.control_behavior as Record<string, unknown> | undefined;
  switch (entity.kind) {
    case "constant": {
      // The sections as the blueprint has them: a combinator without any in the editor is one with the empty section the game gives a new one.
      const written = (behavior?.sections as { sections?: readonly BlueprintSection[] } | undefined)?.sections ?? [];
      const sections = written.map((section) => ({
        ...(section.group !== undefined && { group: section.group }),
        active: section.active ?? true,
        multiplier: section.multiplier ?? 1,
        filters: (section.filters ?? []).map(({ type, name, quality, count }): NativeFilter => ({ value: { type: type ?? "item", name, quality, comparator: "=" }, min: count })),
      }));
      return { ...base, constant: { enabled: entity.enabled, sections } };
    }
    case "arithmetic":
      return { ...base, parameters: behavior?.arithmetic_conditions };
    case "decider":
      return { ...base, parameters: behavior?.decider_conditions };
    case "selector":
      return { ...base, parameters: behavior };
    case "lamp": {
      const lamp = record.control_behavior as LampControlBehavior | undefined;
      return { ...base, lamp: { always_on: entity.alwaysOn, ...(record.color && { color: record.color }), ...(lamp && { behavior: { ...lamp, color_mode: COLOR_MODE_NAMES[entity.colorMode] } }) } };
    }
    case "pole":
      return base;
    case "entity": {
      const assignments = nativeBehavior(entity, record);
      return { ...base, ...(assignments.length > 0 && { behavior: assignments }) };
    }
    case "speaker":
      return { ...base, speaker: { parameters: record.parameters, alert_parameters: record.alert_parameters, behavior: record.control_behavior as SpeakerControlBehavior } };
  }
}

/** The member of `defines.wire_connector_id` for a connector number of a blueprint wire (docs/factorio-audit.md 4.2). */
function connectorName(entity: Entity, connector: number): string {
  const color = connector % 2 === 1 ? "red" : "green";
  if (TERMINALS[entity.kind].length < 2) return `circuit_${color}`;
  return `combinator_${connector > 2 ? "output" : "input"}_${color}`;
}

export function nativeCase(label: string, circuit: Circuit, data: BlueprintFile, string: string): ProbeCase {
  const { entities, wires = [] } = data.blueprint;
  return {
    label,
    ...(circuit.entities.some((entity) => gamePrototype(entity).type === "space-platform-hub") && { surface: "platform" as const }),
    string,
    entities: circuit.entities.map((entity, index) => nativeEntity(entity, entities[index]!)),
    wires: wires.map(([from, fromConnector, to, toConnector]) => [from, connectorName(circuit.entities[from - 1]!, fromConnector), to, connectorName(circuit.entities[to - 1]!, toConnector)]),
  };
}

export function probeCases(): ProbeCase[] {
  const exported = exportedSamples();
  return SAMPLES.map((sample, index) => nativeCase(sample.label, sampleCircuit(sample), exported[index]!.data, exported[index]!.string));
}

/** A prototype of the editor and, for a generic one, every field of its `control_behavior` with the attribute of the runtime API that holds it. */
export interface ProbePrototype {
  readonly name: string;
  readonly attributes: readonly { readonly field: string; readonly attribute: string }[];
}

export function probePrototypes(): ProbePrototype[] {
  return PROTOTYPE_NAMES.map((name) => {
    const row = PROTOTYPES[name]!.kind === "entity" ? ENTITY_SETTINGS[entityTable().byName.get(name)!.type] : undefined;
    const fields = [...new Set((row?.settings ?? []).flatMap(settingFields))];
    return { name, attributes: fields.map((field) => ({ field, attribute: runtimeAttribute(row!.behavior, field) })) };
  });
}

export interface ProbeRequest {
  readonly prototypes: readonly ProbePrototype[];
  readonly cases: readonly ProbeCase[];
}

/** Everything blueprints.lua is given. */
export const probeRequest = (): ProbeRequest => ({ prototypes: probePrototypes(), cases: probeCases() });
