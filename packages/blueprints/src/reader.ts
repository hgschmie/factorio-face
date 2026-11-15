// Reading blueprint JSON that may hold anything: every field is asked for by name with the type it should have, a value of
// another type is reported and replaced by the default, and what nobody asked for is reported as not known to the editor.

import { BOTH_NETWORKS, COMPARATORS, isInt32, signal, STANDARD_SIGNAL_KINDS, type Comparator, type Condition, type NetworkSelection, type SignalId, type StandardSignalKind } from "@face/model";

export type Json = Readonly<Record<string, unknown>>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What became of a setting: `ignored` (the editor has nothing like it, it is dropped), `invalid` (not a value the field takes,
 * the default stands in), `changed` (read, but the editor cannot keep it as it is) or `reset` (the whole entity went back to
 * its defaults).
 */
export type NoteKind = "ignored" | "invalid" | "changed" | "reset";

export type NoteSink = (kind: NoteKind, field: string, message: string) => void;

const COMPARATOR_SPELLINGS: Readonly<Record<string, Comparator>> = { "≠": "!=", "≤": "<=", "≥": ">=", ...Object.fromEntries(COMPARATORS.map((comparator) => [comparator, comparator])) };

/** A float of the game (32 bits) as the shortest decimal that still names it: 0.1, not 0.10000000149011612. */
export function float32(value: number): number {
  const stored = Math.fround(value);
  for (let digits = 1; digits < 9; digits++) {
    const short = Number(stored.toPrecision(digits));
    if (Math.fround(short) === stored) return short;
  }
  return stored;
}

/** The fields of one JSON object. `path` is where the object stands in its entity, for the notes. */
export class Fields {
  private readonly read = new Set<string>();
  private readonly children: Fields[] = [];
  private readonly record: Json;
  private readonly path: string;
  private readonly note: NoteSink;

  constructor(record: Json, path: string, note: NoteSink) {
    this.record = record;
    this.path = path;
    this.note = note;
  }

  private where(key: string): string {
    return this.path ? `${this.path}.${key}` : key;
  }

  private child(record: Json, path: string): Fields {
    const child = new Fields(record, path, this.note);
    this.children.push(child);
    return child;
  }

  private take(key: string): unknown {
    this.read.add(key);
    const value = this.record[key];
    return value === null ? undefined : value;
  }

  private invalid(key: string, expected: string): void {
    this.note("invalid", this.where(key), `is not ${expected}`);
  }

  has(key: string): boolean {
    return this.record[key] !== undefined && this.record[key] !== null;
  }

  /** The value as it is, for a field that takes more than one shape. */
  raw(key: string): unknown {
    return this.take(key);
  }

  /** Marks fields as read that mean nothing in the place they stand in. */
  skip(...keys: readonly string[]): void {
    for (const key of keys) this.read.add(key);
  }

  /** A field the editor does not have: nothing to say while it holds `inert`, a note otherwise. */
  unsupported(key: string, inert: unknown): void {
    const value = this.take(key);
    if (value !== undefined && value !== inert) this.note("ignored", this.where(key), "is something the editor does not have");
  }

  changed(key: string, message: string): void {
    this.note("changed", this.where(key), message);
  }

  boolean(key: string, fallback: boolean): boolean {
    const value = this.take(key);
    if (value === undefined || typeof value === "boolean") return value ?? fallback;
    this.invalid(key, "true or false");
    return fallback;
  }

  number(key: string, fallback: number): number {
    const value = this.take(key);
    if (value === undefined) return fallback;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    this.invalid(key, "a number");
    return fallback;
  }

  int32(key: string, fallback: number): number {
    const value = this.take(key);
    if (value === undefined) return fallback;
    if (typeof value === "number" && isInt32(value)) return value;
    this.invalid(key, "a whole number of 32 bits");
    return fallback;
  }

  /** A count that cannot be negative; the editor keeps it as a 32-bit integer. */
  count(key: string, fallback: number): number {
    const value = this.take(key);
    if (value === undefined) return fallback;
    if (typeof value === "number" && isInt32(value) && value >= 0) return value;
    this.invalid(key, "a whole number from 0 to 2147483647");
    return fallback;
  }

  string(key: string): string | undefined {
    const value = this.take(key);
    if (value === undefined || typeof value === "string") return value;
    this.invalid(key, "a text");
    return undefined;
  }

  oneOf<T extends string>(key: string, values: readonly T[], fallback: T): T {
    const value = this.take(key);
    if (value === undefined) return fallback;
    if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T;
    this.invalid(key, `one of ${values.join(", ")}`);
    return fallback;
  }

  comparator(key: string, fallback: Comparator): Comparator {
    const value = this.take(key);
    if (value === undefined) return fallback;
    const comparator = typeof value === "string" ? COMPARATOR_SPELLINGS[value] : undefined;
    if (comparator) return comparator;
    this.invalid(key, "a comparator");
    return fallback;
  }

  fields(key: string): Fields | undefined {
    const value = this.take(key);
    if (value === undefined) return undefined;
    if (isObject(value)) return this.child(value, this.where(key));
    this.invalid(key, "an object");
    return undefined;
  }

  /** The objects of an array, each with its position in it. */
  list(key: string): Fields[] {
    const value = this.take(key);
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      this.invalid(key, "a list");
      return [];
    }
    return value.flatMap((element: unknown, index) => {
      if (isObject(element)) return [this.child(element, `${this.where(key)}[${index}]`)];
      this.note("invalid", `${this.where(key)}[${index}]`, "is not an object");
      return [];
    });
  }

  /** A SignalID. Undefined for an empty slot (no field, or no name). */
  signal(key: string): SignalId | undefined {
    const value = this.take(key);
    if (value === undefined) return undefined;
    if (!isObject(value)) {
      this.invalid(key, "a signal");
      return undefined;
    }
    return this.signalOf(value, this.where(key));
  }

  /** The signal that the fields `type`, `name` and `quality` of this object itself name, as a logistic filter has them. */
  ownSignal(): SignalId | undefined {
    this.skip("type", "name", "quality");
    return this.signalOf(this.record, this.path);
  }

  private signalOf(value: Json, where: string): SignalId | undefined {
    const { type = "item", name, quality } = value;
    if (name === undefined || name === null || name === "") return undefined;
    if (typeof name !== "string" || typeof type !== "string" || !(STANDARD_SIGNAL_KINDS as readonly string[]).includes(type)) {
      this.note("invalid", where, "is not a signal the editor knows");
      return undefined;
    }
    return signal(type as StandardSignalKind, name, typeof quality === "string" && quality !== "" ? quality : undefined);
  }

  networks(key: string): NetworkSelection {
    const selection = this.fields(key);
    if (!selection) return BOTH_NETWORKS;
    const result = { red: selection.boolean("red", true), green: selection.boolean("green", true) };
    return result.red && result.green ? BOTH_NETWORKS : result;
  }

  /** Reports every field that was not read, of this object and of the objects read from it. */
  done(): void {
    for (const key of Object.keys(this.record)) {
      if (!this.read.has(key) && this.record[key] !== undefined) this.note("ignored", this.where(key), "is something the editor does not have");
    }
    for (const child of this.children) child.done();
  }
}

/** A circuit condition as every entity with one connector has it. Undefined without a left side: what that means is up to the entity (unset behind a switch that is on). */
export function circuitCondition(fields: Fields | undefined): Condition | undefined {
  if (!fields) return undefined;
  const first = fields.signal("first_signal");
  const comparator = fields.comparator("comparator", "<");
  const signalSecond = fields.signal("second_signal");
  const constant = fields.int32("constant", 0);
  return first ? { first, comparator, second: signalSecond ? { type: "signal", signal: signalSecond } : { type: "constant", value: constant } } : undefined;
}
