// Two-phase tick engine.
//
// State is the output held by every arithmetic, decider and selector combinator. At tick t the content of a network is the
// wrapping sum of the outputs held by its emitters; constant combinators hold their configured signals from tick 0 on.
// `step` lets every combinator read the content of tick t, then commits all new outputs at once; they are on the networks at
// t + 1. Tick 0 (after creation and after `reset`): every combinator output is empty, only constant combinators emit.
//
// Work is change-driven: a network is re-summed only when one of its emitters changed, and a combinator is re-evaluated only
// when a network on its input changed (clock and random selectors every tick). The results are identical to evaluating
// everything every tick because evaluators are pure functions of their input.

import { terminalKey, type EntityId, type EntityKind, type WireColor } from "@face/model";
import { planArithmetic } from "./arithmetic.ts";
import { constantOutput } from "./constant.ts";
import { planDecider } from "./decider.ts";
import { defaultEnvironment, qualityLevels, type SimulationEnvironment } from "./environment.ts";
import { DARK_LAMP, planLamp, type LampPlan } from "./lamp.ts";
import { levelLookup, type Evaluator, type PlanContext } from "./plan.ts";
import { planSelector } from "./selector.ts";
import { EMPTY, InputView, SignalTable, sameMap, type SignalMap } from "./signals.ts";
import type { CompiledCircuit, EntityInput, EntitySnapshot, NetworkSnapshot, SignalList, SignalTarget, SimulationNote, TickSnapshot } from "./types.ts";

export interface SimulationOptions {
  /** Must be the environment the circuit was compiled with. Default: `defaultEnvironment`. */
  readonly environment?: SimulationEnvironment;
  /** Seed of the random selector mode. Default 0. */
  readonly seed?: number;
}

export interface Simulation {
  readonly compiled: CompiledCircuit;
  /** Current tick; 0 after creation and after `reset`. */
  readonly tick: number;
  /** Advances by `count` ticks and returns the new tick. Cheap and re-entrant: callers may inspect state between calls. */
  step(count?: number): number;
  /** Back to tick 0: all combinator outputs empty, random generators re-seeded, runtime notes cleared. */
  reset(): void;
  /** Immutable state of the current tick. Repeated calls within one tick return the same object. */
  snapshot(): TickSnapshot;
  /** Current value of one signal without building a snapshot; 0 if absent or the target does not exist. */
  probe(target: SignalTarget, signalKey: string): number;
  /** Notes raised while running since the last reset (for example a missing rocket capacity), without duplicates. */
  runtimeNotes(): readonly SimulationNote[];
}

const EMPTY_LIST: SignalList = Object.freeze([]);
const EMPTY_INPUT: EntityInput = Object.freeze({ red: EMPTY_LIST, green: EMPTY_LIST, combined: EMPTY_LIST });

class Engine implements Simulation {
  readonly compiled: CompiledCircuit;
  private time = 0;
  private readonly signals: SignalTable;
  private readonly ids: readonly EntityId[];
  private readonly kinds: readonly EntityKind[];
  private readonly entityIndex: ReadonlyMap<EntityId, number>;
  private readonly networkIndex: ReadonlyMap<string, number>;
  private readonly evaluators: (Evaluator | undefined)[] = [];
  private readonly lamps: (LampPlan | undefined)[] = [];
  private readonly fixed: SignalMap[] = [];
  private readonly volatile: number[] = [];
  private readonly inRed: Int32Array;
  private readonly inGreen: Int32Array;
  private readonly outRed: Int32Array;
  private readonly outGreen: Int32Array;
  private readonly emitters: number[][];
  private readonly readers: number[][];

  private readonly outputs: SignalMap[];
  private readonly content: SignalMap[];
  private readonly views: (InputView | undefined)[];
  private queue: number[] = [];
  private readonly queued: Uint8Array;
  private dirty: number[] = [];
  private readonly isDirty: Uint8Array;
  private notes: SimulationNote[] = [];
  private readonly noteKeys = new Set<string>();

  /** Bumped whenever an output or a network content changes; lets an idle tick reuse the previous snapshot's parts. */
  private revision = 0;
  private current: TickSnapshot | undefined;
  private currentRevision = -1;
  private readonly lists = new WeakMap<SignalMap, SignalList>();
  private readonly networkSnaps: NetworkSnapshot[] = [];
  private readonly entitySnaps: EntitySnapshot[] = [];
  private networkArray: readonly NetworkSnapshot[] = Object.freeze([]);
  private entityRecord: Readonly<Record<EntityId, EntitySnapshot>> = Object.freeze({});

  constructor(compiled: CompiledCircuit, options: SimulationOptions) {
    const env = options.environment ?? defaultEnvironment;
    const entities = compiled.entities;
    const count = entities.length;
    this.compiled = compiled;
    this.signals = new SignalTable((a, b) => env.compareSignals(a, b));
    this.ids = entities.map((e) => e.id);
    this.kinds = entities.map((e) => e.kind);
    this.entityIndex = new Map(this.ids.map((id, i) => [id, i]));
    this.networkIndex = new Map(compiled.networks.map((n, k) => [n.id, k]));

    const terminal = (i: number, side: "in" | "out", color: WireColor): number => {
      const id = compiled.terminals[terminalKey({ entity: this.ids[i]!, side })]?.[color];
      return id === undefined ? -1 : this.networkIndex.get(id)!;
    };
    this.inRed = Int32Array.from({ length: count }, (_, i) => terminal(i, "in", "red"));
    this.inGreen = Int32Array.from({ length: count }, (_, i) => terminal(i, "in", "green"));
    this.outRed = Int32Array.from({ length: count }, (_, i) => terminal(i, "out", "red"));
    this.outGreen = Int32Array.from({ length: count }, (_, i) => terminal(i, "out", "green"));
    this.emitters = compiled.networks.map((n) => n.emitters.map((id) => this.entityIndex.get(id)!));
    this.readers = compiled.networks.map((n) => n.readers.map((id) => this.entityIndex.get(id)!));

    const invalid = new Set(compiled.notes.filter((n) => n.severity === "error" && n.entity !== undefined).map((n) => n.entity));
    const levelOf = levelLookup(this.signals, qualityLevels(env.qualities));
    entities.forEach((entity, i) => {
      const context: PlanContext = {
        signals: this.signals,
        env,
        seed: options.seed ?? 0,
        levelOf,
        note: (severity, code, message, s) => this.note({ severity, code, message, entity: entity.id, ...(s !== undefined && { signal: this.signals.keys[s] }) }),
      };
      const silent = invalid.has(entity.id);
      this.fixed[i] = entity.kind === "constant" ? constantOutput(entity, this.signals) : EMPTY;
      if (entity.kind === "lamp") this.lamps[i] = silent ? DARK_LAMP : planLamp(entity, this.signals);
      else if (!silent && entity.kind === "arithmetic") this.evaluators[i] = planArithmetic(entity, context);
      else if (!silent && entity.kind === "decider") this.evaluators[i] = planDecider(entity, context);
      else if (!silent && entity.kind === "selector") this.evaluators[i] = planSelector(entity, context);
      if (this.evaluators[i]?.volatile) this.volatile.push(i);
    });

    this.outputs = new Array<SignalMap>(count).fill(EMPTY);
    this.content = new Array<SignalMap>(compiled.networks.length).fill(EMPTY);
    this.views = entities.map((e) => (e.kind === "constant" ? undefined : new InputView()));
    this.queued = new Uint8Array(count);
    this.isDirty = new Uint8Array(compiled.networks.length);
    this.reset();
  }

  get tick(): number {
    return this.time;
  }

  reset(): void {
    this.time = 0;
    this.current = undefined;
    this.revision++;
    this.notes = [];
    this.noteKeys.clear();
    this.content.fill(EMPTY);
    for (const view of this.views) view?.set(EMPTY, EMPTY);
    for (let i = 0; i < this.outputs.length; i++) {
      this.outputs[i] = this.fixed[i]!;
      this.evaluators[i]?.reset?.();
      if (this.evaluators[i]) this.enqueue(i);
    }
    for (let k = 0; k < this.content.length; k++) this.touch(k);
    this.settle();
  }

  step(count = 1): number {
    for (let n = 0; n < count; n++) this.advance();
    return this.time;
  }

  private advance(): void {
    const work = this.queue;
    this.queue = [];
    const changed: number[] = [];
    const next: SignalMap[] = [];
    // Phase 1: every scheduled combinator reads the content of this tick. Nothing is written yet.
    for (const i of work) {
      this.queued[i] = 0;
      const output = this.evaluators[i]!.evaluate(this.views[i]!, this.time);
      if (!sameMap(output, this.outputs[i]!)) {
        changed.push(i);
        next.push(output);
      }
    }
    // Phase 2: commit all new outputs at once; they define the content of the next tick.
    if (changed.length > 0) this.revision++;
    for (let n = 0; n < changed.length; n++) {
      const i = changed[n]!;
      this.outputs[i] = next[n]!;
      this.touch(this.outRed[i]!);
      this.touch(this.outGreen[i]!);
    }
    this.time++;
    this.settle();
    for (const i of this.volatile) this.enqueue(i);
  }

  private enqueue(i: number): void {
    if (this.queued[i]) return;
    this.queued[i] = 1;
    this.queue.push(i);
  }

  private touch(k: number): void {
    if (k < 0 || this.isDirty[k]) return;
    this.isDirty[k] = 1;
    this.dirty.push(k);
  }

  /** Re-sums the networks whose emitters changed and schedules the combinators that read a changed network. */
  private settle(): void {
    const dirty = this.dirty;
    this.dirty = [];
    for (const k of dirty) {
      this.isDirty[k] = 0;
      const sum = this.sum(k);
      if (sameMap(sum, this.content[k]!)) continue;
      this.content[k] = sum;
      for (const i of this.readers[k]!) {
        if (this.evaluators[i]) this.enqueue(i);
      }
    }
    // Views are refreshed after all networks are final, so a reader on two changed networks never sees a mixed state.
    for (const k of dirty) {
      for (const i of this.readers[k]!) this.views[i]!.set(this.networkContent(this.inRed[i]!), this.networkContent(this.inGreen[i]!));
    }
  }

  private networkContent(k: number): SignalMap {
    return k < 0 ? EMPTY : this.content[k]!;
  }

  private sum(k: number): SignalMap {
    let single: SignalMap = EMPTY;
    let total: Map<number, number> | undefined;
    for (const i of this.emitters[k]!) {
      const output = this.outputs[i]!;
      if (output.size === 0) continue;
      if (!total) {
        if (single.size === 0) {
          single = output;
          continue;
        }
        total = new Map(single);
      }
      for (const [s, value] of output) {
        const sum = ((total.get(s) ?? 0) + value) | 0;
        if (sum === 0) total.delete(s);
        else total.set(s, sum);
      }
    }
    return total ? (total.size > 0 ? total : EMPTY) : single;
  }

  private note(note: SimulationNote): void {
    const key = `${note.entity}|${note.code}|${note.signal}`;
    if (this.noteKeys.has(key)) return;
    this.noteKeys.add(key);
    this.notes = [...this.notes, note];
  }

  runtimeNotes(): readonly SimulationNote[] {
    return this.notes;
  }

  probe(target: SignalTarget, signalKey: string): number {
    const s = this.signals.lookup(signalKey);
    if (s === undefined) return 0;
    if (target.type === "network") return this.networkContent(this.networkIndex.get(target.id) ?? -1).get(s) ?? 0;
    const i = this.entityIndex.get(target.entity);
    if (i === undefined) return 0;
    if (target.side === "out") return this.outputs[i]!.get(s) ?? 0;
    const view = this.views[i];
    return (target.color === undefined ? view?.both : view?.[target.color])?.get(s) ?? 0;
  }

  private list(map: SignalMap): SignalList {
    if (map.size === 0) return EMPTY_LIST;
    let list = this.lists.get(map);
    if (!list) {
      const { ids, keys } = this.signals;
      list = Object.freeze(this.signals.sorted(map).map((s) => Object.freeze({ signal: ids[s]!, key: keys[s]!, value: map.get(s)! })));
      this.lists.set(map, list);
    }
    return list;
  }

  private input(view: InputView, previous: EntityInput | undefined): EntityInput {
    const red = this.list(view.red);
    const green = this.list(view.green);
    const combined = this.list(view.both);
    if (red.length === 0 && green.length === 0) return EMPTY_INPUT;
    return previous && previous.red === red && previous.green === green && previous.combined === combined ? previous : Object.freeze({ red, green, combined });
  }

  snapshot(): TickSnapshot {
    const last = this.current;
    if (last && this.currentRevision === this.revision) {
      return last.tick === this.time ? last : (this.current = Object.freeze({ tick: this.time, networks: last.networks, entities: last.entities, totals: last.totals }));
    }
    this.currentRevision = this.revision;
    const compiled = this.compiled;
    let signals = 0;
    let changed = this.networkSnaps.length !== compiled.networks.length;
    compiled.networks.forEach((network, k) => {
      const list = this.list(this.content[k]!);
      signals += list.length;
      if (this.networkSnaps[k]?.signals === list) return;
      this.networkSnaps[k] = Object.freeze({ id: network.id, color: network.color, terminals: network.terminals, signals: list });
      changed = true;
    });
    if (changed) this.networkArray = Object.freeze([...this.networkSnaps]);

    let emitting = 0;
    let lampsLit = 0;
    changed = this.entitySnaps.length !== this.ids.length;
    for (let i = 0; i < this.ids.length; i++) {
      const previous = this.entitySnaps[i];
      const view = this.views[i];
      const lampPlan = this.lamps[i];
      const input = view && this.input(view, previous?.input);
      const output = lampPlan ? undefined : this.list(this.outputs[i]!);
      const lamp = lampPlan?.evaluate(view!, this.inRed[i]! >= 0 || this.inGreen[i]! >= 0);
      if (output && output.length > 0) emitting++;
      if (lamp?.lit) lampsLit++;
      if (previous && previous.input === input && previous.output === output && previous.lamp === lamp) continue;
      const kind = this.kinds[i]!;
      this.entitySnaps[i] = Object.freeze(lamp ? { kind, input, lamp } : input ? { kind, input, output } : { kind, output });
      changed = true;
    }
    if (changed) this.entityRecord = Object.freeze(Object.fromEntries(this.ids.map((id, i) => [id, this.entitySnaps[i]!])));

    const totals = Object.freeze({ entities: this.ids.length, networks: compiled.networks.length, signals, emitting, lampsLit });
    return (this.current = Object.freeze({ tick: this.time, networks: this.networkArray, entities: this.entityRecord, totals }));
  }
}

/** Creates a simulation at tick 0. The compiled circuit is not modified and may be shared between simulations. */
export function createSimulation(compiled: CompiledCircuit, options: SimulationOptions = {}): Simulation {
  return new Engine(compiled, options);
}
