// Turns engine snapshots into what the dock and the cards show. Pure functions over snapshots and history.
import { signalKey, type Circuit, type Entity, type EntityId, type RgbColor, type SignalId } from "@face/model";
import type { EntitySnapshot, History, SignalList, TickSnapshot } from "@face/simulation";
import { shortSignal } from "../entities/signalText.ts";
import type { EntityStatus, SignalTrace } from "../workbench/controller.ts";

/** Entities traced when nothing is selected. */
export const DEFAULT_TRACED_ENTITIES = 3;
export const MAX_TRACED_ENTITIES = 6;
export const MAX_SIGNALS_PER_ENTITY = 4;
const STATUS_SIGNALS = 2;

export function colorHex({ r, g, b }: RgbColor): string {
  return "#" + [r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("");
}

function listText(list: SignalList | undefined): string {
  return list && list.length > 0 ? list.map((entry) => `${shortSignal(entry.signal)} ${entry.value}`).join(", ") : "nothing";
}

function statusOf(snapshot: EntitySnapshot): EntityStatus {
  if (snapshot.lamp) {
    const color = snapshot.lamp.lit && snapshot.lamp.color ? colorHex(snapshot.lamp.color) : undefined;
    return { label: snapshot.lamp.lit ? (color ? `lit ${color}` : "lit") : "off", active: snapshot.lamp.lit, color };
  }
  const output = snapshot.output ?? [];
  if (output.length === 0) return { label: "no output", active: false };
  const shown = output.slice(0, STATUS_SIGNALS);
  const label = shown.map((entry) => `${shortSignal(entry.signal)} ${entry.value}`).join(", ") + (output.length > shown.length ? ` +${output.length - shown.length}` : "");
  return { label, active: false, signals: shown.map((entry) => ({ signal: entry.signal, value: entry.value })) };
}

/**
 * Card statuses for a snapshot. The engine shares unchanged entity records between ticks, so statuses are cached per record
 * and the whole map per entity table: cards and the scene only re-render for entities whose state changed.
 */
export class StatusCache {
  private readonly statuses = new WeakMap<EntitySnapshot, EntityStatus>();
  private readonly maps = new WeakMap<TickSnapshot["entities"], ReadonlyMap<EntityId, EntityStatus>>();

  of(snapshot: TickSnapshot): ReadonlyMap<EntityId, EntityStatus> {
    let map = this.maps.get(snapshot.entities);
    if (!map) {
      const built = new Map<EntityId, EntityStatus>();
      for (const id in snapshot.entities) {
        const entity = snapshot.entities[id]!;
        let status = this.statuses.get(entity);
        if (!status) {
          status = statusOf(entity);
          this.statuses.set(entity, status);
        }
        built.set(id, status);
      }
      map = built;
      this.maps.set(snapshot.entities, map);
    }
    return map;
  }
}

/** The entities the dock traces: the selection, or the first few entities when nothing is selected. */
export function tracedEntities(circuit: Circuit, selection: readonly EntityId[]): readonly Entity[] {
  if (selection.length === 0) return circuit.entities.slice(0, DEFAULT_TRACED_ENTITIES);
  const selected = new Set(selection);
  const traced: Entity[] = [];
  for (const entity of circuit.entities) {
    if (selected.has(entity.id)) traced.push(entity);
    if (traced.length === MAX_TRACED_ENTITIES) break;
  }
  return traced;
}

function inputsText(snapshot: EntitySnapshot | undefined): string {
  if (!snapshot?.input) return "No input terminal";
  return `Input red: ${listText(snapshot.input.red)}\nInput green: ${listText(snapshot.input.green)}\nInput sum: ${listText(snapshot.input.combined)}`;
}

/** Output signals of an entity over the retained ticks: those present now first (in signal order), then earlier ones. */
function outputSignals(history: History, entity: EntityId): SignalId[] {
  const snapshots = history.snapshots();
  const seen = new Map<string, SignalId>();
  let previous: SignalList | undefined;
  for (let index = snapshots.length - 1; index >= 0 && seen.size < MAX_SIGNALS_PER_ENTITY; index--) {
    const output = snapshots[index]!.entities[entity]?.output;
    // Unchanged outputs are shared between snapshots; one look at each distinct list is enough.
    if (!output || output === previous) continue;
    previous = output;
    for (const entry of output) {
      if (seen.size === MAX_SIGNALS_PER_ENTITY) break;
      if (!seen.has(entry.key)) seen.set(entry.key, entry.signal);
    }
  }
  return [...seen.values()];
}

/** Trace rows for the traced entities: one per output signal, one per lamp, and a placeholder row for an entity without output. */
export function buildTraces(history: History, entities: readonly Entity[]): SignalTrace[] {
  const latest = history.latest;
  if (!latest) return [];
  const traces: SignalTrace[] = [];
  for (const entity of entities) {
    const snapshot = latest.entities[entity.id];
    const base = { entity: entity.id, entityName: entity.name, inputs: inputsText(snapshot) };
    if (entity.kind === "lamp") {
      const lamp = snapshot?.lamp ?? { lit: false };
      const color = lamp.lit && lamp.color ? colorHex(lamp.color) : undefined;
      const values = history.snapshots().map((tick) => (tick.entities[entity.id]?.lamp?.lit ? 1 : 0));
      traces.push({ ...base, id: `${entity.id}|lamp`, label: `${entity.name} light`, lamp: { lit: lamp.lit, color }, values, current: lamp.lit ? (color ? `lit ${color}` : "lit") : "off" });
      continue;
    }
    const signals = outputSignals(history, entity.id);
    if (signals.length === 0) {
      traces.push({ ...base, id: `${entity.id}|idle`, label: entity.name, values: [], current: "no output" });
      continue;
    }
    for (const signal of signals) {
      const key = signalKey(signal);
      const { values } = history.trace({ type: "terminal", entity: entity.id, side: "out" }, key);
      traces.push({ ...base, id: `${entity.id}|${key}`, label: `${entity.name} ${shortSignal(signal)}`, signal, values, current: String(values.at(-1) ?? 0) });
    }
  }
  return traces;
}
