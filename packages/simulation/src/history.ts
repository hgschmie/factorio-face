// Bounded history of snapshots for debugging traces.
//
// Memory bound: at most `capacity` snapshots are retained. Snapshots share every part that did not change between ticks
// (signal lists, per-network and per-entity records, and the whole network array or entity record when nothing in it changed),
// so a tick costs O(changed networks + changed entities + their signal entries), plus O(networks + entities) references for the
// two top-level containers if anything changed at all. Worst case, with everything changing every tick:
// capacity * (networks + entities + signal entries of all networks, inputs and outputs) small objects. An idle circuit costs
// one five-field object per tick.

import type { SignalList, SignalTarget, TickSnapshot } from "./types.ts";

export interface HistoryOptions {
  /** Maximum number of retained snapshots; older ones are dropped. Default 600 (ten seconds at 60 ticks per second). */
  readonly capacity?: number;
}

/** Values of one signal over the retained ticks, oldest first; 0 where the signal is absent. */
export interface Trace {
  readonly ticks: readonly number[];
  readonly values: readonly number[];
}

export function signalValue(list: SignalList | undefined, signalKey: string): number {
  if (list) for (const entry of list) if (entry.key === signalKey) return entry.value;
  return 0;
}

function targetList(snapshot: TickSnapshot, target: SignalTarget, hint: { position: number }): SignalList | undefined {
  if (target.type === "network") {
    if (snapshot.networks[hint.position]?.id !== target.id) hint.position = snapshot.networks.findIndex((n) => n.id === target.id);
    return snapshot.networks[hint.position]?.signals;
  }
  const entity = snapshot.entities[target.entity];
  if (target.side === "out") return entity?.output;
  return target.color === undefined ? entity?.input?.combined : entity?.input?.[target.color];
}

/** Value of one signal at a target in a snapshot; 0 if the signal or the target is absent. Same addressing as `Simulation.probe`. */
export function readSnapshot(snapshot: TickSnapshot, target: SignalTarget, signalKey: string): number {
  return signalValue(targetList(snapshot, target, { position: 0 }), signalKey);
}

export class History {
  readonly capacity: number;
  private readonly ring: (TickSnapshot | undefined)[];
  private start = 0;
  private count = 0;

  constructor(options: HistoryOptions = {}) {
    this.capacity = Math.max(1, Math.trunc(options.capacity ?? 600));
    this.ring = new Array<TickSnapshot | undefined>(this.capacity);
  }

  get length(): number {
    return this.count;
  }

  private slot(n: number): TickSnapshot {
    return this.ring[(this.start + n) % this.capacity]!;
  }

  get oldest(): TickSnapshot | undefined {
    return this.count > 0 ? this.slot(0) : undefined;
  }

  get latest(): TickSnapshot | undefined {
    return this.count > 0 ? this.slot(this.count - 1) : undefined;
  }

  /**
   * Appends a snapshot. Ticks must increase: a snapshot of the latest tick replaces it, and a snapshot of an earlier tick
   * (the simulation was reset) clears the history first.
   */
  record(snapshot: TickSnapshot): void {
    const latest = this.latest;
    if (latest && snapshot.tick < latest.tick) this.clear();
    else if (latest && snapshot.tick === latest.tick) this.count--;
    if (this.count === this.capacity) {
      this.start = (this.start + 1) % this.capacity;
      this.count--;
    }
    this.ring[(this.start + this.count) % this.capacity] = snapshot;
    this.count++;
  }

  clear(): void {
    this.ring.fill(undefined);
    this.start = 0;
    this.count = 0;
  }

  /** Snapshot of a tick, if it is retained. */
  at(tick: number): TickSnapshot | undefined {
    let low = 0;
    let high = this.count - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const snapshot = this.slot(middle);
      if (snapshot.tick === tick) return snapshot;
      if (snapshot.tick < tick) low = middle + 1;
      else high = middle - 1;
    }
    return undefined;
  }

  /** Retained snapshots, oldest first. */
  snapshots(): TickSnapshot[] {
    return Array.from({ length: this.count }, (_, n) => this.slot(n));
  }

  /** Per-tick values of one signal on a network or an entity terminal over the retained ticks. */
  trace(target: SignalTarget, signalKey: string): Trace {
    const ticks: number[] = [];
    const values: number[] = [];
    const hint = { position: 0 };
    for (let n = 0; n < this.count; n++) {
      const snapshot = this.slot(n);
      ticks.push(snapshot.tick);
      values.push(signalValue(targetList(snapshot, target, hint), signalKey));
    }
    return { ticks, values };
  }
}
