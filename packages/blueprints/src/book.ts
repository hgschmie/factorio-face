// A blueprint book that a project keeps as the game wrote it. A blueprint is written into it as one more item or over a blueprint
// it has; everything that is not on the way to that item stays the object it was, so that planners, books inside the book and
// fields the editor does not know go back to the game untouched.

import { ITEM_WORDS, itemOf, itemsAlong, type BlueprintItem } from "./import.ts";
import { isObject, listOf, type Json } from "./reader.ts";
import type { Blueprint } from "./schema.ts";
import { DEFAULT_LIMITS, encodeBlueprintString, megabytes, type BlueprintLimits } from "./string.ts";

export type BookEditErrorCode = "not-a-book" | "invalid-selection" | "not-a-blueprint" | "book-full" | "too-long";

export type BookEdit =
  /** The new book, its blueprint string, and the path of the blueprint that was written (what `ImportOptions.select` takes). */
  | { readonly ok: true; readonly data: Json; readonly string: string; readonly path: readonly number[] }
  | { readonly ok: false; readonly code: BookEditErrorCode; readonly message: string };

export interface ReplaceOptions {
  /** Carries `CARRIED_BLUEPRINT_FIELDS` of the replaced blueprint over. */
  readonly keep?: boolean;
  readonly limits?: Partial<BlueprintLimits>;
}

/** The fields of a blueprint that say what it is as an item and not what it builds. The editor models none of them; a replacement can keep them. */
export const CARRIED_BLUEPRINT_FIELDS = ["description", "icons", "label_color", "snap-to-grid", "absolute-snapping", "position-relative-to-grid"] as const;

/** The slots of a book: `index` runs from 0 to 65534 (docs/factorio-audit.md 5.2, fixture F-30). */
export const BOOK_SLOTS = 65535;

/**
 * The slot (`index`, from 0) the game gives each item of the `blueprints` list of a book when it reads it, and undefined for an
 * item it drops. It reads the list in order: an item with an `index` goes to that slot, a fraction cut off; one without, or with
 * 65535, goes to the first slot that is empty at that moment; one whose slot is taken or whose `index` is beyond the slots or
 * negative is dropped. An `index` that is no number counts as none, and an element that is no item as one, which the recording
 * does not have: both err on the side of a slot being taken.
 */
export function bookSlots(items: readonly unknown[]): (number | undefined)[] {
  const taken = new Set<number>();
  let empty = 0;
  return items.map((item) => {
    const index = isObject(item) && typeof item.index === "number" && Number.isFinite(item.index) ? Math.trunc(item.index) + 0 : BOOK_SLOTS;
    const slot = index === BOOK_SLOTS ? empty : index;
    if (slot < 0 || slot >= BOOK_SLOTS || taken.has(slot)) return undefined;
    taken.add(slot);
    while (taken.has(empty)) empty++;
    return slot;
  });
}

/**
 * The `index` of an item that is added at the end of the `blueprints` list of a book: the slot after the last one the game
 * fills from the list (`bookSlots`), so that the new item stands at the end of the book as it does at the end of the list. In a
 * book whose last slot is in use it is the first empty slot, and undefined when there is none.
 */
export function nextBookIndex(items: readonly unknown[]): number | undefined {
  const taken = new Set(bookSlots(items).filter((slot) => slot !== undefined));
  let last = -1;
  for (const slot of taken) last = Math.max(last, slot);
  if (last + 1 < BOOK_SLOTS) return last + 1;
  for (let slot = 0; slot < BOOK_SLOTS; slot++) if (!taken.has(slot)) return slot;
  return undefined;
}

const fail = (code: BookEditErrorCode, message: string): BookEdit => ({ ok: false, code, message });

/** The items from the book that `data` is to the one at `path`, or why there are none. */
function along(data: unknown, path: readonly number[], sought: string): readonly BlueprintItem[] | BookEdit {
  const root = itemOf(data);
  if (root.kind !== "book") return fail("not-a-book", root.kind === "unknown" ? "This is not a blueprint book" : `This is ${ITEM_WORDS[root.kind]}, not a blueprint book`);
  return itemsAlong(data, path) ?? fail("invalid-selection", `The blueprint book has no such ${sought}`);
}

/** The root with `body` as the body of the last of `items`, which lie along `path`. Every object and list on the way is a new one. */
function rebuilt(items: readonly BlueprintItem[], path: readonly number[], body: object): Json {
  const wrap = (item: BlueprintItem, inner: object): Json => ({ ...item.wrapper, [item.key]: inner });
  let node = wrap(items[items.length - 1]!, body);
  for (let level = items.length - 2; level >= 0; level--) {
    const parent = items[level]!;
    const blueprints = [...listOf(parent.body.blueprints)];
    blueprints[path[level]!] = node;
    node = wrap(parent, { ...parent.body, blueprints });
  }
  return node;
}

function edited(data: Json, path: readonly number[], limits: Partial<BlueprintLimits> | undefined): BookEdit {
  const { maxStringLength } = { ...DEFAULT_LIMITS, ...limits };
  const string = encodeBlueprintString(data);
  // A longer one the decoder would not take back.
  if (string.length > maxStringLength) return fail("too-long", `With this blueprint the blueprint string of the book is longer than ${megabytes(maxStringLength)}`);
  return { ok: true, data, string, path };
}

/**
 * Adds `blueprint` (the `data.blueprint` of an export) as a new item at the end of a book: `data` is the decoded object of a book
 * string, `book` the path of a book in it and [] the book itself. The path of the new item is its position in the list, which is
 * not its `index`. A `blueprints` that is missing (the game writes none for an empty book) or no list counts as an empty one, as
 * it does in the listing. `data` is not changed. Never throws for any data that JSON can hold.
 */
export function addToBook(data: unknown, book: readonly number[], blueprint: Blueprint, limits?: Partial<BlueprintLimits>): BookEdit {
  const items = along(data, book, "book");
  if ("ok" in items) return items;
  const target = items[items.length - 1]!;
  if (target.kind !== "book") return fail("not-a-book", `The item to add to is ${ITEM_WORDS[target.kind]}, not a blueprint book`);
  const present = listOf(target.body.blueprints);
  const index = nextBookIndex(present);
  if (index === undefined) return fail("book-full", `The blueprint book is full: all of its ${BOOK_SLOTS} slots are taken`);
  // The keys in the order the game writes them.
  const blueprints = [...present, { blueprint, index }];
  return edited(rebuilt(items, book, { ...target.body, blueprints }), [...book, present.length], limits);
}

/** `blueprint` with the fields of `CARRIED_BLUEPRINT_FIELDS` that `replaced` has, as it has them: an export makes icons of its own, and those of the replaced blueprint are the ones to stay. */
function carriedOver(blueprint: Blueprint, replaced: Json): object {
  const body: Record<string, unknown> = { ...blueprint };
  for (const field of CARRIED_BLUEPRINT_FIELDS) if (replaced[field] !== undefined) body[field] = replaced[field];
  return body;
}

/**
 * Puts `blueprint` in the place of the blueprint at `path` of a book. The item keeps its `index` and whatever else stands next to
 * its blueprint; of the replaced blueprint itself nothing stays (its entities, its tiles, its label), but for the fields of
 * `CARRIED_BLUEPRINT_FIELDS` that it has when `keep` is on: they take the place of the new one's. `data` is not changed. Never throws for any data
 * that JSON can hold.
 */
export function replaceInBook(data: unknown, path: readonly number[], blueprint: Blueprint, options: ReplaceOptions = {}): BookEdit {
  const items = along(data, path, "blueprint");
  if ("ok" in items) return items;
  const target = items[items.length - 1]!;
  if (target.kind !== "blueprint") return fail("not-a-blueprint", `The item to replace is ${ITEM_WORDS[target.kind]}, not a blueprint`);
  return edited(rebuilt(items, path, options.keep ? carriedOver(blueprint, target.body) : blueprint), [...path], options.limits);
}
