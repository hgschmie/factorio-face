// The selection in words, for the status bar, the inspector and the context menu. Pure.
import { wireKey, type Circuit, type Entity, type EntityId, type TerminalRef, type Wire } from "@face/model";

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
  return `${names.get(terminal.entity) ?? terminal.entity}.${terminal.side}`;
}

/** Both ends of a wire as in the source: `source.out <-> gate.in`. */
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
