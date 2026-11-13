// The selection in words, for the status bar, the inspector and the context menu. Pure.
import { printTerminal } from "@face/language";
import { describeWireReach, formatWireReach, prototypeData, wireKey, withArticle, type Circuit, type Entity, type EntityId, type EntityShape, type TerminalRef, type Wire, type WireReach } from "@face/model";
import { capitalized } from "../entities/kindInfo.ts";

export interface SelectedItems {
  readonly entities: readonly Entity[];
  readonly wires: readonly Wire[];
}

/** The selected entities and wires of `circuit`, in circuit order. */
export function selectedItems(circuit: Circuit, selection: readonly EntityId[], wireSelection: readonly string[]): SelectedItems {
  const ids = new Set(selection);
  const keys = new Set(wireSelection);
  return {
    entities: ids.size === 0 ? [] : circuit.entities.filter((entity) => ids.has(entity.id)),
    wires: keys.size === 0 ? [] : circuit.wires.filter((wire) => keys.has(wireKey(wire))),
  };
}

function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** `2 entities`, `1 wire`, `1 entity and 2 wires`; empty when both counts are zero. */
export function countLabel(entities: number, wires: number): string {
  return [entities > 0 ? counted(entities, "entity", "entities") : "", wires > 0 ? counted(wires, "wire", "wires") : ""].filter((part) => part !== "").join(" and ");
}

export type EntityNames = ReadonlyMap<EntityId, string>;

export function entityNames(circuit: Circuit): EntityNames {
  return new Map(circuit.entities.map((entity) => [entity.id, entity.name]));
}

function terminalLabel(terminal: TerminalRef, names: EntityNames): string {
  return printTerminal(names.get(terminal.entity) ?? terminal.entity, terminal.side);
}

/**
 * Which reach applied to a wire between `a` and `b` and why, for the wire inspector. A wire spans the smaller reach of its two
 * ends, and only a pole has a reach of its own: "The wire reach of the project is 9.", "The wire reach of a small electric pole
 * is 7.5: a pole has its own reach, and a wire spans the smaller reach of its two ends.", and where the project's reach limits
 * a wire to a pole that would reach further: "The wire reach of the project is 9. It is the smaller reach of the two ends: a
 * big electric pole reaches 32."
 */
export function wireReachNote(a: EntityShape, b: EntityShape, limit: WireReach): string {
  const sentence = capitalized(describeWireReach(limit));
  if (limit.of !== "project") return `${sentence}: a pole has its own reach, and a wire spans the smaller reach of its two ends.`;
  const further = [a, b].map(prototypeData).find((data) => data.wireReach !== undefined);
  return further?.wireReach === undefined ? `${sentence}.` : `${sentence}. It is the smaller reach of the two ends: ${withArticle(further.label)} reaches ${formatWireReach(further.wireReach)}.`;
}

/** Both ends of a wire as in the source: `source.out <-> gate.in`, `p1 <-> p2`. */
export function wireEndsLabel(wire: Wire, names: EntityNames): string {
  return `${terminalLabel(wire.a, names)} <-> ${terminalLabel(wire.b, names)}`;
}

/** What the status bar says about the selection. */
export function selectionStatus(circuit: Circuit, { entities, wires }: SelectedItems): string {
  if (entities.length + wires.length === 0) return "No selection";
  if (wires.length === 0 && entities.length <= 4) return entities.map((entity) => entity.name).join(", ");
  if (entities.length === 0 && wires.length === 1) return `${wires[0]!.color} wire ${wireEndsLabel(wires[0]!, entityNames(circuit))}`;
  return `${countLabel(entities.length, wires.length)} selected`;
}
