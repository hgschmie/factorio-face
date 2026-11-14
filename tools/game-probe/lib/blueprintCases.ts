// What the blueprint probe sends to the game, one case per sample circuit of packages/blueprints/test/samples.ts: the blueprint
// string this project exports for it, and the same circuit as instructions for the game's runtime API (create the entity, set
// its control behaviour, connect the wires), so that the game can build it without reading a blueprint of ours and export its
// own. Bundled with esbuild by blueprints.mjs, because the language package is not plain enough for Node's type stripping.

import { canRotate, ENTITY_SETTINGS, facingOf, gamePrototype, prototypeOf, TERMINALS, type Circuit, type Entity, type EntityOfKind, type Point } from "@face/model";
import type { BlueprintEntity, BlueprintFile, BlueprintSignal, LampControlBehavior, SpeakerControlBehavior } from "../../../packages/blueprints/src/index.ts";
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
  /** Constant combinator: the switch and all sections; the sections a new combinator has are removed first. */
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
    name: prototypeOf(entity),
    position: record.position,
    ...(canRotate(entity) && { direction: facingOf(entity) }),
    ...(record.player_description !== undefined && { description: record.player_description }),
  };
  const behavior = record.control_behavior as Record<string, unknown> | undefined;
  switch (entity.kind) {
    case "constant": {
      const filter = (signal: BlueprintSignal, count: number): NativeFilter => ({ value: { type: signal.type ?? "item", name: signal.name, quality: signal.quality ?? "normal", comparator: "=" }, min: count });
      const sections = entity.sections.map((section) => ({
        ...(section.group && { group: section.group }),
        active: section.active,
        multiplier: section.multiplier,
        filters: section.filters.map(({ signal, count }) => filter({ ...(signal.kind !== "item" && { type: signal.kind as BlueprintSignal["type"] }), name: signal.name, ...(signal.quality && { quality: signal.quality }) }, count)),
      }));
      return { ...base, constant: { enabled: entity.enabled, sections } };
    }
    case "arithmetic":
      return { ...base, ...(behavior && { parameters: behavior.arithmetic_conditions }) };
    case "decider": {
      // The runtime type wants all three lists.
      const lists = behavior?.decider_conditions as Record<string, unknown> | undefined;
      return { ...base, ...(lists && { parameters: { conditions: lists.conditions ?? [], outputs: lists.outputs ?? [], else_outputs: lists.else_outputs ?? [] } }) };
    }
    case "selector":
      return { ...base, ...(behavior && { parameters: behavior }) };
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
    string,
    entities: circuit.entities.map((entity, index) => nativeEntity(entity, entities[index]!)),
    wires: wires.map(([from, fromConnector, to, toConnector]) => [from, connectorName(circuit.entities[from - 1]!, fromConnector), to, connectorName(circuit.entities[to - 1]!, toConnector)]),
  };
}

export function probeCases(): ProbeCase[] {
  const exported = exportedSamples();
  return SAMPLES.map((sample, index) => nativeCase(sample.label, sampleCircuit(sample), exported[index]!.data, exported[index]!.string));
}
