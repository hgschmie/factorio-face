// Turns engine snapshots into what the dock and the cards show. Pure functions over snapshots and history.
import { conditionRole, ENABLE_CONDITION, settingSpecsOf, signalKey, terminalKey, type Circuit, type Entity, type EntityId, type RgbColor, type SignalId } from "@face/model";
import { POINT_ROLES, type CompiledCircuit, type EntitySnapshot, type History, type SignalList, type TerminalNetworks, type TickSnapshot } from "@face/simulation";
import { shortSignal, signalListText } from "../entities/signalText.ts";
import { soundText } from "../entities/summary.ts";
import type { ConditionStatus, EntityStatus, SignalTrace, SpeakerStatus } from "../workbench/controller.ts";

/** Entities traced when nothing is selected. */
export const DEFAULT_TRACED_ENTITIES = 3;
export const MAX_TRACED_ENTITIES = 6;
export const MAX_SIGNALS_PER_ENTITY = 4;
/** Output signals named in the plain-text label of a status. */
const LABEL_SIGNALS = 2;

export function colorHex({ r, g, b }: RgbColor): string {
  return "#" + [r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("");
}

function listText(list: SignalList | undefined): string {
  return signalListText(list ?? []) || "nothing";
}

/** What a speaker does, in words: "silent", "playing piano F#3", and the volume where it is not the full one: "playing piano F#3 at 60%". */
export function speakerText({ playing, instrument, note, volume }: SpeakerStatus): string {
  if (!playing) return "silent";
  const sound = soundText({ instrument, note });
  return `playing${sound && ` ${sound}`}${volume === undefined || volume === 100 ? "" : ` at ${Math.round(volume * 10) / 10}%`}`;
}

/** Whether a kind has something to trace over time by itself: an output, or a state. A pole has neither: it only joins networks. */
export function isTraceable(kind: EntitySnapshot["kind"]): boolean {
  return POINT_ROLES[kind].writes !== undefined || kind === "lamp" || kind === "speaker";
}

/**
 * The circuit conditions of a generic entity that the simulation evaluates, by the key of their setting and in the order of the
 * settings: those it holds, without the one on the logistic network. None for every other entity.
 */
export function tracedConditions(entity: Entity): readonly string[] {
  if (entity.kind !== "entity") return [];
  return settingSpecsOf(entity.prototype).flatMap((spec) => (spec.type === "condition" && !spec.logistic && entity.settings[spec.key] !== undefined ? [spec.key] : []));
}

/** Whether the dock has a row for an entity: its kind has an output or a state, or it is a generic entity with a circuit condition. A chest has none. */
export function hasTrace(entity: Entity): boolean {
  return isTraceable(entity.kind) || tracedConditions(entity).length > 0;
}

/** What a condition says in a word: `enabled` or `disabled` for the one that enables the entity, with what it decides in front for every other one (`harvest enabled`). */
export function conditionWord(key: string, holds: boolean): string {
  const role = conditionRole(key);
  return `${role === undefined ? "" : `${role} `}${holds ? "enabled" : "disabled"}`;
}

/** The conditions of an entity at one tick as one text: `enabled`, `enabled, harvest disabled`. */
export function conditionsText(conditions: readonly ConditionStatus[]): string {
  return conditions.map((condition) => conditionWord(condition.key, condition.holds)).join(", ");
}

/** The status of one entity; `wires` are the networks on the connection point it reads (absent without any wire). */
function statusOf(snapshot: EntitySnapshot, wires: TerminalNetworks | undefined): EntityStatus {
  const input = snapshot.input && {
    red: { wired: wires?.red !== undefined, signals: snapshot.input.red },
    green: { wired: wires?.green !== undefined, signals: snapshot.input.green },
  };
  if (snapshot.lamp) {
    const { lit } = snapshot.lamp;
    const color = lit && snapshot.lamp.color ? colorHex(snapshot.lamp.color) : undefined;
    return { label: lit ? (color ? `lit ${color}` : "lit") : "off", active: lit, input, lamp: { lit, color } };
  }
  if (snapshot.speaker) return { label: speakerText(snapshot.speaker), active: snapshot.speaker.playing, input, speaker: snapshot.speaker };
  // A generic entity with circuit conditions and a wire: whether each of them holds. It emits nothing.
  if (snapshot.conditions) {
    const conditions = Object.entries(snapshot.conditions).map(([key, holds]): ConditionStatus => ({ key, ...(key !== ENABLE_CONDITION && { role: conditionRole(key) }), holds }));
    const enabled = snapshot.conditions[ENABLE_CONDITION];
    return { label: conditionsText(conditions), active: false, input, conditions, ...(enabled !== undefined && { enabled }) };
  }
  // A relay: it emits nothing and has no state, so there is nothing to say beyond the two networks it joins.
  if (!isTraceable(snapshot.kind)) return { label: "", active: false, input };
  const output = snapshot.output ?? [];
  return { label: signalListText(output, LABEL_SIGNALS) || "no output", active: false, input, output };
}

/**
 * Card statuses for a snapshot. The engine shares unchanged entity records between ticks, so statuses are cached per record
 * and the whole map per entity table: cards and the scene only re-render for entities whose state changed. A record changes
 * exactly when what its entity reads, emits or lights changes, which is what a card shows.
 */
export class StatusCache {
  private readonly statuses = new WeakMap<EntitySnapshot, EntityStatus>();
  private readonly maps = new WeakMap<TickSnapshot["entities"], ReadonlyMap<EntityId, EntityStatus>>();

  /** `terminals` are those of the compiled circuit the snapshot was taken from. */
  of(snapshot: TickSnapshot, terminals: CompiledCircuit["terminals"]): ReadonlyMap<EntityId, EntityStatus> {
    let map = this.maps.get(snapshot.entities);
    if (!map) {
      const built = new Map<EntityId, EntityStatus>();
      for (const id in snapshot.entities) {
        const entity = snapshot.entities[id]!;
        let status = this.statuses.get(entity);
        if (!status) {
          const reads = POINT_ROLES[entity.kind].reads;
          status = statusOf(entity, reads && terminals[terminalKey({ entity: id, side: reads })]);
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

/**
 * The entities the dock traces: the selection, or the first few entities when nothing is selected. Only those with something
 * to trace (`hasTrace`): a pole and a chest have no row.
 */
export function tracedEntities(circuit: Circuit, selection: readonly EntityId[]): readonly Entity[] {
  const selected = new Set(selection);
  const limit = selection.length === 0 ? DEFAULT_TRACED_ENTITIES : MAX_TRACED_ENTITIES;
  const traced: Entity[] = [];
  for (const entity of circuit.entities) {
    if (traced.length === limit) break;
    if ((selection.length === 0 || selected.has(entity.id)) && hasTrace(entity)) traced.push(entity);
  }
  return traced;
}

function inputsText(snapshot: EntitySnapshot | undefined): string {
  if (!snapshot?.input) return "No input terminal";
  if (snapshot.kind === "pole" || snapshot.kind === "entity") return `Red: ${listText(snapshot.input.red)}\nGreen: ${listText(snapshot.input.green)}`;
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

/**
 * Trace rows for the traced entities: one per output signal, one per lamp and per speaker, one per circuit condition of a generic
 * entity, and a placeholder row for a combinator without output.
 */
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
    if (entity.kind === "speaker") {
      const speaker = snapshot?.speaker ?? { playing: false };
      const values = history.snapshots().map((tick) => (tick.entities[entity.id]?.speaker?.playing ? 1 : 0));
      traces.push({ ...base, id: `${entity.id}|speaker`, label: `${entity.name} sound`, speaker: { playing: speaker.playing }, values, current: speakerText(speaker) });
      continue;
    }
    if (entity.kind === "entity") {
      // It sends nothing: what there is to follow is whether its conditions hold. Without a wire none of them applies.
      for (const key of tracedConditions(entity)) {
        const holds = snapshot?.conditions?.[key];
        // The row names what the condition decides; its value then says whether it does.
        const what = conditionRole(key) ?? "condition";
        const values = history.snapshots().map((tick) => (tick.entities[entity.id]?.conditions?.[key] ? 1 : 0));
        traces.push({ ...base, id: `${entity.id}|${key}`, label: `${entity.name} ${what}`, condition: { what, ...(holds !== undefined && { holds }) }, values, current: holds === undefined ? "no wire" : holds ? "enabled" : "disabled" });
      }
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
