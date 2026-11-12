// Interned signals and signal sets. Internal to the engine: signal sets are maps from an interned index to a non-zero int32
// and are never mutated after they have been handed out, which is what makes sharing them between ticks and snapshots safe.

import { signal, signalKey, type NetworkSelection, type SignalId } from "@face/model";

export type SignalMap = ReadonlyMap<number, number>;
export const EMPTY: SignalMap = new Map();

export class SignalTable {
  readonly ids: SignalId[] = [];
  readonly keys: string[] = [];
  private readonly index = new Map<string, number>();
  private readonly variants = new Map<string, number>();
  private ranks: number[] = [];
  private ranked = 0;
  private readonly compare: (a: SignalId, b: SignalId) => number;

  constructor(compare: (a: SignalId, b: SignalId) => number) {
    this.compare = compare;
  }

  intern(id: SignalId): number {
    const key = signalKey(id);
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.ids.length;
      this.index.set(key, i);
      this.ids.push(Object.freeze(signal(id.kind, id.name, id.quality)));
      this.keys.push(key);
    }
    return i;
  }

  lookup(key: string): number | undefined {
    return this.index.get(key);
  }

  /** The same prototype at another quality (undefined or "normal" for the base signal). */
  withQuality(i: number, quality: string | undefined): number {
    const memo = `${i}@${quality ?? ""}`;
    let result = this.variants.get(memo);
    if (result === undefined) {
      const id = this.ids[i]!;
      result = this.intern({ kind: id.kind, name: id.name, quality });
      this.variants.set(memo, result);
    }
    return result;
  }

  /** Position in the environment's signal order. Relative order of known signals never changes when new ones are interned. */
  rank(i: number): number {
    if (this.ranked !== this.ids.length) {
      const order = this.ids.map((_, n) => n).sort((a, b) => this.compare(this.ids[a]!, this.ids[b]!) || (this.keys[a]! < this.keys[b]! ? -1 : 1));
      this.ranks = new Array<number>(order.length);
      order.forEach((n, position) => (this.ranks[n] = position));
      this.ranked = this.ids.length;
    }
    return this.ranks[i]!;
  }

  /** Signals of a set in signal order. */
  sorted(map: SignalMap): number[] {
    return [...map.keys()].sort((a, b) => this.rank(a) - this.rank(b));
  }

  /** First signal of a set in signal order, -1 if the set is empty. */
  first(map: SignalMap): number {
    let best = -1;
    for (const s of map.keys()) if (best < 0 || this.rank(s) < this.rank(best)) best = s;
    return best;
  }
}

/** Mutable accumulator for a combinator output: sums per signal with int32 wrap and drops zeros. */
export class Accumulator {
  private map: Map<number, number> | undefined;

  add(s: number, value: number): void {
    if (value === 0) return;
    const map = (this.map ??= new Map());
    const sum = ((map.get(s) ?? 0) + value) | 0;
    if (sum === 0) map.delete(s);
    else map.set(s, sum);
  }

  result(): SignalMap {
    return this.map && this.map.size > 0 ? this.map : EMPTY;
  }
}

export function sumMaps(a: SignalMap, b: SignalMap): SignalMap {
  if (a.size === 0) return b;
  if (b.size === 0) return a;
  const result = new Map(a);
  for (const [s, value] of b) {
    const sum = ((result.get(s) ?? 0) + value) | 0;
    if (sum === 0) result.delete(s);
    else result.set(s, sum);
  }
  return result.size > 0 ? result : EMPTY;
}

export function sameMap(a: SignalMap, b: SignalMap): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [s, value] of a) if (b.get(s) !== value) return false;
  return true;
}

/** What one entity sees on its input terminal. `both` is the wrapping sum of red and green, computed on demand. */
export class InputView {
  red: SignalMap = EMPTY;
  green: SignalMap = EMPTY;
  private sum: SignalMap | undefined = EMPTY;

  get both(): SignalMap {
    return (this.sum ??= sumMaps(this.red, this.green));
  }

  set(red: SignalMap, green: SignalMap): void {
    if (red === this.red && green === this.green) return;
    this.red = red;
    this.green = green;
    this.sum = undefined;
  }

  /** N-NONE: with neither network selected nothing is read. */
  select(selection: Selection): SignalMap {
    return selection === BOTH ? this.both : selection === RED ? this.red : selection === GREEN ? this.green : EMPTY;
  }
}

export type Selection = 0 | 1 | 2 | 3;
export const NONE: Selection = 0;
export const RED: Selection = 1;
export const GREEN: Selection = 2;
export const BOTH: Selection = 3;

export function selectionOf(networks: NetworkSelection): Selection {
  return ((networks.red ? 1 : 0) | (networks.green ? 2 : 0)) as Selection;
}
