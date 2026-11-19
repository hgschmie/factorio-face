import { existsSync, readFileSync } from "node:fs";
import { strToU8, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  addToBook, BOOK_SLOTS, bookSlots, canonicalBlueprintString, CARRIED_BLUEPRINT_FIELDS, decodeBlueprintString, encodeBlueprintString, importBlueprintString, inspectBlueprint, itemOf, nextBookIndex, packVersion, replaceInBook,
  type Blueprint, type BookEdit, type BookEditErrorCode,
} from "../src/index.ts";
import { circuitOf, exported, imported } from "./helpers.ts";
import { INSTRUMENTS } from "./samples.ts";

const VERSION = packVersion(2, 1, 25);
const lamp = (number: number) => ({ entity_number: number, name: "small-lamp", position: { x: number + 0.5, y: 0.5 } });
const blueprint = (label: string, entities: readonly unknown[], extra: object = {}) => ({ item: "blueprint", label, entities, version: VERSION, ...extra });

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** What the editor does not model of a blueprint, on the one that is replaced. */
const KEPT = {
  description: "What it is for",
  icons: [{ signal: { name: "small-lamp" }, index: 1 }, { signal: { type: "virtual", name: "signal-A" }, index: 2 }],
  label_color: { r: 1, g: 0.5, b: 0, a: 1 },
  "snap-to-grid": { x: 2, y: 2 },
  "absolute-snapping": true,
  "position-relative-to-grid": { x: 1, y: 0 },
};
const LOST = { tiles: [{ name: "landfill", position: { x: 0, y: 0 } }, { name: "landfill", position: { x: 1, y: 0 } }], schedules: [{ locomotives: [1] }] };

// Frozen through and through: a function that changed what it is given would throw. The second book is under the key with a hyphen.
const BOOK = deepFreeze({
  blueprint_book: {
    item: "blueprint-book",
    label: "Circuits",
    description: "Of the book",
    icons: [{ signal: { name: "blueprint-book" }, index: 1 }],
    active_index: 1,
    of_a_mod: { deep: [1, 2, { three: 3 }] },
    blueprints: [
      { index: 0, blueprint: blueprint("Old", [lamp(1), lamp(2), { entity_number: 3, name: "gate", position: { x: 9.5, y: 0.5 } }], { ...KEPT, ...LOST }), beside: "the blueprint" },
      { index: 1, deconstruction_planner: { item: "deconstruction-planner", label: "Trees", settings: { tile_selection_mode: 2 } } },
      { index: 2, "blueprint-book": { item: "blueprint-book", label: "Inner", active_index: 0, blueprints: [{ index: 0, blueprint: blueprint("Gates", []) }, { index: 3, blueprint: blueprint("Pole", [lamp(1)], { description: "Inner words" }) }] } },
      { index: 5, upgrade_planner: { item: "upgrade-planner" } },
      7,
      { index: 9, something_else: {} },
    ],
    version: VERSION,
  },
});

const CIRCUIT = circuitOf(
  `constant-combinator source { virtual:signal-A = 1 }
   small-lamp light { when virtual:signal-A > 0 }
   decider-combinator gate { when virtual:signal-A > 0  output virtual:signal-B = 1 }
   wire red source.out <-> light.in
   wire green source.out <-> gate.in`,
  "Written",
);
const NEW: Blueprint = deepFreeze(exported(CIRCUIT).blueprint);

function dig(value: unknown, ...keys: readonly (string | number)[]): unknown {
  return keys.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], value);
}
const rootItem = (data: unknown, index: number): unknown => dig(data, "blueprint_book", "blueprints", index);
const innerItem = (data: unknown, index: number): unknown => dig(data, "blueprint_book", "blueprints", 2, "blueprint-book", "blueprints", index);

function done(edit: BookEdit): Extract<BookEdit, { ok: true }> {
  if (!edit.ok) throw new Error(`Edit failed: ${edit.code}: ${edit.message}`);
  return edit;
}

function codeOf(edit: BookEdit): BookEditErrorCode | "ok" {
  if (edit.ok) return "ok";
  // A message of this package is a sentence without its full stop.
  expect(edit.message).toMatch(/^[A-Z].*[^.\s]$/);
  return edit.code;
}

describe("book: adding a blueprint", () => {
  it("appends it to the book itself, with the next index, and leaves every other item the object it was", () => {
    const before = JSON.stringify(BOOK);
    const edit = done(addToBook(BOOK, [], NEW));
    expect(edit.path).toEqual([6]);
    expect(rootItem(edit.data, 6)).toEqual({ index: 10, blueprint: NEW });
    expect(dig(rootItem(edit.data, 6), "blueprint")).toBe(NEW);
    // The order of the game.
    expect(Object.keys(rootItem(edit.data, 6) as object)).toEqual(["blueprint", "index"]);
    for (let index = 0; index < 6; index++) expect(rootItem(edit.data, index)).toBe(BOOK.blueprint_book.blueprints[index]);
    expect(dig(edit.data, "blueprint_book", "of_a_mod")).toBe(BOOK.blueprint_book.of_a_mod);
    expect(dig(edit.data, "blueprint_book", "icons")).toBe(BOOK.blueprint_book.icons);
    expect(edit.data).toEqual({ blueprint_book: { ...BOOK.blueprint_book, blueprints: [...BOOK.blueprint_book.blueprints, { index: 10, blueprint: NEW }] } });
    expect(Object.keys(dig(edit.data, "blueprint_book") as object)).toEqual(Object.keys(BOOK.blueprint_book));
    expect(JSON.stringify(BOOK)).toBe(before);
    expect(edit.data).not.toBe(BOOK);
  });

  it("gives the blueprint string of the new book", () => {
    const edit = done(addToBook(BOOK, [], NEW));
    expect(edit.string).toBe(encodeBlueprintString(edit.data));
    expect(decodeBlueprintString(edit.string)).toEqual({ ok: true, data: edit.data });
  });

  it("appends to a book inside the book, which keeps its key, its index and its other items", () => {
    const edit = done(addToBook(BOOK, [2], NEW));
    expect(edit.path).toEqual([2, 2]);
    expect(innerItem(edit.data, 2)).toEqual({ index: 4, blueprint: NEW });
    expect(innerItem(edit.data, 0)).toBe(innerItem(BOOK, 0));
    expect(innerItem(edit.data, 1)).toBe(innerItem(BOOK, 1));
    expect(rootItem(edit.data, 2)).toEqual({ index: 2, "blueprint-book": { item: "blueprint-book", label: "Inner", active_index: 0, blueprints: [innerItem(BOOK, 0), innerItem(BOOK, 1), { index: 4, blueprint: NEW }] } });
    for (const index of [0, 1, 3, 4, 5]) expect(rootItem(edit.data, index)).toBe(BOOK.blueprint_book.blueprints[index]);
    expect(dig(edit.data, "blueprint_book", "blueprints")).toHaveLength(6);
    expect(dig(edit.data, "blueprint_book", "of_a_mod")).toBe(BOOK.blueprint_book.of_a_mod);
  });

  it("lists the new blueprint at the path it returns, and importing that path gives the circuit back", () => {
    for (const book of [[], [2]]) {
      const edit = done(addToBook(BOOK, book, NEW));
      const inspection = inspectBlueprint(edit.data);
      expect(inspection.kind === "book" && inspection.entries.find((entry) => entry.path.join() === edit.path.join())).toEqual({ path: edit.path, kind: "blueprint", label: "Written", entities: 3, known: 3, tiles: 0 });
      const { circuit, report } = imported(edit.data, { select: edit.path, instruments: INSTRUMENTS });
      expect(circuit).toEqual(imported({ blueprint: NEW }).circuit);
      expect(circuit).toMatchObject({ name: "Written", entities: [{ kind: "constant" }, { kind: "lamp" }, { kind: "decider" }] });
      expect(report).toMatchObject({ entities: 3, dropped: [], settings: [], wires: { imported: 2, invalid: 0 } });
      // What comes back is the circuit that was written: its export is the blueprint that went in.
      expect(exported(circuit)).toEqual({ blueprint: NEW });
      expect(importBlueprintString(edit.string, { select: edit.path, instruments: INSTRUMENTS })).toEqual({ ok: true, circuit, report });
    }
  });

  it("starts a book that has no list of items, or something else in its place", () => {
    for (const body of [{}, { blueprints: [] }, { blueprints: {} }, { blueprints: "text" }, { blueprints: 5 }, { blueprints: null }]) {
      const edit = done(addToBook({ blueprint_book: { label: "Empty", ...body } }, [], NEW));
      expect(edit.data).toEqual({ blueprint_book: { label: "Empty", blueprints: [{ index: 0, blueprint: NEW }] } });
      expect(edit.path).toEqual([0]);
    }
    const nested = done(addToBook({ blueprint_book: { blueprints: [{ blueprint_book: { blueprints: 5 } }] } }, [0], NEW));
    expect(nested.data).toEqual({ blueprint_book: { blueprints: [{ blueprint_book: { blueprints: [{ index: 0, blueprint: NEW }] } }] } });
    expect(nested.path).toEqual([0, 0]);
  });
});

describe("book: the index of a new item", () => {
  const LAST = BOOK_SLOTS - 1;
  const indexed = (...indexes: readonly unknown[]) => indexes.map((index) => (index === undefined ? { blueprint: {} } : { blueprint: {}, index }));

  it("gives every item the slot the game gives it: its index, or the first empty slot for one without", () => {
    expect(BOOK_SLOTS).toBe(65535);
    expect(bookSlots([])).toEqual([]);
    expect(bookSlots(indexed(0, 1, 2))).toEqual([0, 1, 2]);
    expect(bookSlots(indexed(2, 0, 1))).toEqual([2, 0, 1]);
    expect(bookSlots(indexed(0, 3))).toEqual([0, 3]);
    expect(bookSlots(indexed(undefined, undefined, undefined))).toEqual([0, 1, 2]);
    expect(bookSlots(indexed(3, undefined, 1, undefined))).toEqual([3, 0, 1, 2]);
    expect(bookSlots(indexed(1, undefined, undefined, undefined))).toEqual([1, 0, 2, 3]);
  });

  it("drops an item whose slot is taken, also by one that had no index", () => {
    expect(bookSlots(indexed(0, 0, 1))).toEqual([0, undefined, 1]);
    expect(bookSlots(indexed(0, 1, 1))).toEqual([0, 1, undefined]);
    expect(bookSlots(indexed(undefined, 0, undefined))).toEqual([0, undefined, 1]);
  });

  it("cuts a fraction off, reads 65535 as no index and drops an item beyond the slots or before them", () => {
    expect(bookSlots(indexed(0, 1.5))).toEqual([0, 1]);
    expect(bookSlots(indexed(2.9, -0.5))).toEqual([2, 0]);
    expect(bookSlots(indexed(0, LAST))).toEqual([0, LAST]);
    expect(bookSlots(indexed(0, BOOK_SLOTS))).toEqual([0, 1]);
    for (const index of [BOOK_SLOTS + 1, 100000, 1e300, -1, -7.5]) expect(bookSlots(indexed(0, index, undefined))).toEqual([0, undefined, 1]);
  });

  it("takes an index that is no number as none, and an element that is no item as one", () => {
    for (const index of ["7", null, true, [9], { n: 9 }, Number.NaN, Number.POSITIVE_INFINITY]) expect(bookSlots(indexed(3, index, 0))).toEqual([3, 0, undefined]);
    expect(bookSlots([7, "text", null, [], {}, { index: 1 }])).toEqual([0, 1, 2, 3, 4, undefined]);
  });

  it("is the slot after the last one in use, whatever the order and the gaps", () => {
    expect(nextBookIndex([])).toBe(0);
    expect(nextBookIndex(indexed(0))).toBe(1);
    expect(nextBookIndex(indexed(0, 5, 2))).toBe(6);
    expect(nextBookIndex(indexed(40))).toBe(41);
    expect(nextBookIndex(indexed(undefined, undefined, undefined))).toBe(3);
    expect(nextBookIndex(indexed(7, undefined))).toBe(8);
    expect(nextBookIndex(indexed(3, undefined, 1, undefined))).toBe(4);
  });

  it("does not count an item the game drops, and never is a slot an item without an index takes", () => {
    expect(nextBookIndex(indexed(undefined, 0, undefined))).toBe(2);
    expect(nextBookIndex(indexed(0, 0, 0, 0))).toBe(1);
    expect(nextBookIndex(indexed(-1))).toBe(0);
    expect(nextBookIndex(indexed(0, 100000))).toBe(1);
    expect(nextBookIndex(indexed(0, BOOK_SLOTS))).toBe(2);
    expect(nextBookIndex(indexed(0, 1.5))).toBe(2);
    // The slot after the one with an index would be 2, where the game puts the third item of the list.
    expect(nextBookIndex(indexed(1, undefined, undefined))).toBe(3);
  });

  it("is the first empty slot once the last slot is in use, and none in a book that is full", () => {
    expect(nextBookIndex(indexed(LAST - 1))).toBe(LAST);
    expect(nextBookIndex(indexed(LAST))).toBe(0);
    expect(nextBookIndex(indexed(LAST, 0, undefined, 3))).toBe(2);
    const full = Array.from({ length: BOOK_SLOTS }, () => ({ blueprint: {} }));
    expect(nextBookIndex(full)).toBeUndefined();
    expect(nextBookIndex([...full, ...full])).toBeUndefined();
    expect(nextBookIndex(full.map((item, index) => (index === 100 ? { ...item, index: 0 } : item)))).toBe(LAST);
    expect(nextBookIndex(full.map((item, index) => ({ ...item, index: index === 100 ? 0 : index })))).toBe(100);
  });

  it("is what an added item gets", () => {
    const indexOf = (blueprints: readonly unknown[]) => dig(done(addToBook({ blueprint_book: { blueprints } }, [], NEW)).data, "blueprint_book", "blueprints", blueprints.length, "index");
    expect(indexOf([])).toBe(0);
    expect(indexOf([{ index: 0, blueprint: {} }, { index: 8, upgrade_planner: {} }, { index: 3, blueprint: {} }])).toBe(9);
    expect(indexOf([{ blueprint: {} }, { blueprint: {} }])).toBe(2);
    expect(indexOf([{ blueprint: {} }, { blueprint: {}, index: 0 }, { blueprint: {} }])).toBe(2);
    expect(indexOf([7, "text", null])).toBe(3);
    // In the list the new item is the last, whatever its slot.
    const wrapped = done(addToBook({ blueprint_book: { blueprints: indexed(0, LAST) } }, [], NEW));
    expect(wrapped.path).toEqual([2]);
    expect(dig(wrapped.data, "blueprint_book", "blueprints", 2)).toEqual({ blueprint: NEW, index: 1 });
  });
});

describe("book: replacing a blueprint", () => {
  it("puts the new one in its place; the item keeps its index and what stands beside the blueprint", () => {
    const before = JSON.stringify(BOOK);
    const edit = done(replaceInBook(BOOK, [0], NEW));
    expect(edit.path).toEqual([0]);
    expect(rootItem(edit.data, 0)).toEqual({ index: 0, blueprint: NEW, beside: "the blueprint" });
    expect(Object.keys(rootItem(edit.data, 0) as object)).toEqual(["index", "blueprint", "beside"]);
    for (let index = 1; index < 6; index++) expect(rootItem(edit.data, index)).toBe(BOOK.blueprint_book.blueprints[index]);
    expect(dig(edit.data, "blueprint_book", "blueprints")).toHaveLength(6);
    expect(decodeBlueprintString(edit.string)).toEqual({ ok: true, data: edit.data });
    expect(JSON.stringify(BOOK)).toBe(before);
  });

  it("replaces in a book inside the book", () => {
    const edit = done(replaceInBook(BOOK, [2, 1], NEW));
    expect(edit.path).toEqual([2, 1]);
    expect(innerItem(edit.data, 1)).toEqual({ index: 3, blueprint: NEW });
    expect(innerItem(edit.data, 0)).toBe(innerItem(BOOK, 0));
    expect(dig(rootItem(edit.data, 2), "index")).toBe(2);
    expect(dig(rootItem(edit.data, 2), "blueprint-book", "label")).toBe("Inner");
    for (const index of [0, 1, 3, 4, 5]) expect(rootItem(edit.data, index)).toBe(BOOK.blueprint_book.blueprints[index]);
    expect(imported(edit.data, { select: edit.path, instruments: INSTRUMENTS }).circuit).toEqual(imported({ blueprint: NEW }).circuit);
  });

  it("without keep leaves nothing of the replaced blueprint", () => {
    for (const options of [undefined, {}, { keep: false }]) {
      const edit = done(replaceInBook(BOOK, [0], NEW, options));
      expect(dig(rootItem(edit.data, 0), "blueprint")).toBe(NEW);
    }
  });

  it("with keep carries over what the editor does not model, in the place of what the new blueprint has of it", () => {
    expect(CARRIED_BLUEPRINT_FIELDS).toEqual(["description", "icons", "label_color", "snap-to-grid", "absolute-snapping", "position-relative-to-grid"]);
    expect(Object.keys(KEPT)).toEqual([...CARRIED_BLUEPRINT_FIELDS]);
    const old = dig(rootItem(BOOK, 0), "blueprint") as Record<string, unknown>;

    // An exported blueprint has icons of its own; those of the replaced one stay. The label is the new one's, and tiles and schedules are gone.
    const written = dig(rootItem(done(replaceInBook(BOOK, [0], NEW, { keep: true })).data, 0), "blueprint") as Record<string, unknown>;
    expect(written).toEqual({ ...NEW, ...KEPT });
    expect(written.icons).toBe(old.icons);
    expect(written.label).toBe("Written");
    expect(written.entities).toBe(NEW.entities);
    expect(written.label_color).toBe(old.label_color);
    expect(written["snap-to-grid"]).toBe(old["snap-to-grid"]);

    const { icons: _icons, label: _label, ...bare } = NEW;
    const carried = dig(rootItem(done(replaceInBook(BOOK, [0], bare, { keep: true })).data, 0), "blueprint") as Record<string, unknown>;
    expect(carried).toEqual({ ...bare, ...KEPT });
    expect(carried.icons).toBe(old.icons);
    expect("label" in carried).toBe(false);

    const described = { ...NEW, description: "New words" } as Blueprint;
    expect(dig(rootItem(done(replaceInBook(BOOK, [0], described, { keep: true })).data, 0), "blueprint", "description")).toBe(KEPT.description);
    expect(dig(innerItem(done(replaceInBook(BOOK, [2, 1], NEW, { keep: true })).data, 1), "blueprint")).toEqual({ ...NEW, description: "Inner words" });
    expect(dig(innerItem(done(replaceInBook(BOOK, [2, 0], NEW, { keep: true })).data, 0), "blueprint")).toEqual(NEW);
  });
});

describe("book: what is refused", () => {
  const SINGLE = { blueprint: blueprint("One", [lamp(1)]) };

  it("not-a-book: data that is no book, and adding to an item that is none", () => {
    for (const data of [SINGLE, { deconstruction_planner: { item: "deconstruction-planner" } }, {}, { blueprint_book: "text" }, { blueprint_book: [] }, null, undefined, 7, "text", [], [BOOK]]) {
      for (const path of [[], [0]]) {
        expect(codeOf(addToBook(data, path, NEW))).toBe("not-a-book");
        expect(codeOf(replaceInBook(data, path, NEW))).toBe("not-a-book");
      }
    }
    expect(addToBook(SINGLE, [], NEW)).toEqual({ ok: false, code: "not-a-book", message: "This is a blueprint, not a blueprint book" });
    expect(addToBook({}, [], NEW)).toEqual({ ok: false, code: "not-a-book", message: "This is not a blueprint book" });
    expect(addToBook(BOOK, [0], NEW)).toEqual({ ok: false, code: "not-a-book", message: "The item to add to is a blueprint, not a blueprint book" });
    expect(addToBook(BOOK, [1], NEW)).toEqual({ ok: false, code: "not-a-book", message: "The item to add to is a deconstruction planner, not a blueprint book" });
    for (const path of [[3], [4], [5], [2, 0]]) expect(codeOf(addToBook(BOOK, path, NEW))).toBe("not-a-book");
  });

  it("invalid-selection: a path that leads nowhere", () => {
    for (const path of [[6], [-1], [0.5], [Number.NaN], [Number.POSITIVE_INFINITY], [0, 0], [1, 0], [4, 0], [2, 7], [2, 1.5], [2, -1], [2, 1, 0]]) {
      expect(codeOf(addToBook(BOOK, path, NEW))).toBe("invalid-selection");
      expect(codeOf(replaceInBook(BOOK, path, NEW))).toBe("invalid-selection");
    }
    expect(replaceInBook(BOOK, [6], NEW)).toEqual({ ok: false, code: "invalid-selection", message: "The blueprint book has no such blueprint" });
    expect(addToBook(BOOK, [6], NEW)).toEqual({ ok: false, code: "invalid-selection", message: "The blueprint book has no such book" });
    for (const blueprints of ["text", 5, {}, null, undefined]) expect(codeOf(replaceInBook({ blueprint_book: { blueprints } }, [0], NEW))).toBe("invalid-selection");
  });

  it("not-a-blueprint: replacing a book, a planner or an item that is none", () => {
    for (const path of [[], [1], [2], [3], [4], [5]]) expect(codeOf(replaceInBook(BOOK, path, NEW))).toBe("not-a-blueprint");
    expect(replaceInBook(BOOK, [], NEW)).toEqual({ ok: false, code: "not-a-blueprint", message: "The item to replace is a blueprint book, not a blueprint" });
    expect(replaceInBook(BOOK, [3], NEW)).toEqual({ ok: false, code: "not-a-blueprint", message: "The item to replace is an upgrade planner, not a blueprint" });
    expect(replaceInBook(BOOK, [4], NEW)).toEqual({ ok: false, code: "not-a-blueprint", message: "The item to replace is an item the editor does not know, not a blueprint" });
    for (const item of [7, "text", null, [], {}, { blueprint: "text" }, { blueprint: [] }]) expect(codeOf(replaceInBook({ blueprint_book: { blueprints: [item] } }, [0], NEW))).toBe("not-a-blueprint");
  });

  it("book-full: every slot of the book is taken", () => {
    const item = { blueprint: blueprint("One", []) };
    const full = { blueprint_book: { blueprints: Array.from({ length: BOOK_SLOTS }, () => item) } };
    expect(addToBook(full, [], NEW)).toEqual({ ok: false, code: "book-full", message: "The blueprint book is full: all of its 65535 slots are taken" });
    expect(codeOf(addToBook({ blueprint_book: { blueprints: [{ index: 0, blueprint_book: full.blueprint_book }] } }, [0], NEW))).toBe("book-full");
    expect(codeOf(addToBook({ blueprint_book: { blueprints: [{ index: 0, blueprint_book: full.blueprint_book }] } }, [], NEW))).toBe("ok");
    expect(codeOf(replaceInBook(full, [BOOK_SLOTS - 1], NEW))).toBe("ok");
  });

  it("too-long: a book whose string is longer than the limit", () => {
    const { length } = done(addToBook(BOOK, [], NEW)).string;
    expect(codeOf(addToBook(BOOK, [], NEW, { maxStringLength: length }))).toBe("ok");
    expect(codeOf(addToBook(BOOK, [], NEW, { maxStringLength: length - 1 }))).toBe("too-long");
    const replaced = done(replaceInBook(BOOK, [0], NEW)).string.length;
    expect(codeOf(replaceInBook(BOOK, [0], NEW, { limits: { maxStringLength: replaced } }))).toBe("ok");
    expect(codeOf(replaceInBook(BOOK, [0], NEW, { keep: true, limits: { maxStringLength: replaced - 1 } }))).toBe("too-long");
    expect(addToBook(BOOK, [2], NEW, { maxStringLength: 2 * 1024 * 1024 })).toMatchObject({ ok: true });
    expect(addToBook(BOOK, [2], NEW, { maxStringLength: 512 })).toEqual({ ok: false, code: "too-long", message: "With this blueprint the blueprint string of the book is longer than 0 MB" });
  });
});

describe("book: hostile data", () => {
  const JUNK: readonly unknown[] = [undefined, null, true, 0, -1, 1.5, "text", [], [[]], {}, { blueprints: 1 }, { blueprints: [null, 7, "x", [], {}] }, { blueprint: 1 }, { index: "x", blueprint: null }];

  it("never throws and never changes what it is given, wherever junk stands", () => {
    const shapes = JUNK.flatMap((junk) => [junk, { blueprint_book: junk }, { blueprint_book: { blueprints: junk } }, { blueprint_book: { blueprints: [junk] } }, { blueprint_book: { blueprints: [{ blueprint_book: junk }, { index: junk, blueprint: junk }] } }]);
    for (const shape of shapes) {
      deepFreeze(shape);
      for (const path of [[], [0], [1], [0, 0], [0.5], [-1]]) {
        expect(() => addToBook(shape, path, NEW)).not.toThrow();
        expect(() => replaceInBook(shape, path, NEW, { keep: true })).not.toThrow();
      }
    }
  });

  it("keeps a key named __proto__ a key", () => {
    const data: unknown = JSON.parse('{"blueprint_book":{"__proto__":{"polluted":1},"blueprints":[{"__proto__":{"polluted":2},"index":4,"blueprint":{"__proto__":{"polluted":3},"description":"d"}}]}}');
    const edit = done(replaceInBook(data, [0], NEW, { keep: true }));
    expect(JSON.parse(JSON.stringify(edit.data))).toEqual({ blueprint_book: { ["__proto__"]: { polluted: 1 }, blueprints: [{ ["__proto__"]: { polluted: 2 }, index: 4, blueprint: { ...NEW, description: "d" } }] } });
    for (const node of [edit.data, dig(edit.data, "blueprint_book"), rootItem(edit.data, 0), dig(rootItem(edit.data, 0), "blueprint")]) {
      expect(Object.getPrototypeOf(node)).toBe(Object.prototype);
      expect((node as { polluted?: number }).polluted).toBeUndefined();
    }
    expect(Object.keys(dig(edit.data, "blueprint_book") as object)).toEqual(["__proto__", "blueprints"]);
    expect(dig(done(addToBook(data, [], NEW)).data, "blueprint_book", "blueprints", 1)).toEqual({ index: 5, blueprint: NEW });
  });
});

describe("book: the string a project keeps", () => {
  const data = { blueprint_book: { item: "blueprint-book", label: "Grüße ≥ 𠀀", blueprints: [{ index: 0, blueprint: blueprint("One", [lamp(1)]) }], active_index: 0, version: VERSION } };
  /** As another encoder writes it: not what `encodeBlueprintString` gives for the same data. */
  const foreign = (value: unknown): string => `0${Buffer.from(zlibSync(strToU8(JSON.stringify(value)), { level: 0 })).toString("base64")}`;
  /** The same data with a label that makes the base64 end in padding. */
  const padded = (): string => {
    for (let length = 0; length < 3; length++) {
      const text = foreign({ ...data, pad: "x".repeat(length) });
      if (text.endsWith("=")) return text;
    }
    throw new Error("No padding");
  };

  it("is the text itself for a blueprint string, without its blanks and line breaks", () => {
    const text = foreign(data);
    expect(text).not.toBe(encodeBlueprintString(data));
    expect(canonicalBlueprintString(text)).toEqual({ ok: true, data, string: text });
    const wrapped = `\n  ${text.replace(/(.{20})/g, "$1\r\n")}\t \n`;
    expect(wrapped).not.toBe(text);
    expect(canonicalBlueprintString(wrapped)).toEqual({ ok: true, data, string: text });
    expect(canonicalBlueprintString(encodeBlueprintString(data))).toEqual({ ok: true, data, string: encodeBlueprintString(data) });
  });

  it("keeps a string without padding as it is", () => {
    const text = padded();
    const bare = text.replace(/=+$/, "");
    expect(bare.length).toBeLessThan(text.length);
    const result = canonicalBlueprintString(`${bare}\n`);
    expect(result).toMatchObject({ ok: true, string: bare });
    expect(result).toEqual({ ...canonicalBlueprintString(text), string: bare });
    expect(decodeBlueprintString(bare)).toEqual(decodeBlueprintString(text));
  });

  it("is the encoding of the data for plain JSON", () => {
    const expected = { ok: true, data, string: encodeBlueprintString(data) };
    expect(canonicalBlueprintString(JSON.stringify(data))).toEqual(expected);
    expect(canonicalBlueprintString(`\n ${JSON.stringify(data, null, 2)}\n`)).toEqual(expected);
    // Blanks inside a label are the label's.
    const spaced = { blueprint: blueprint("two  words\there", []) };
    expect(canonicalBlueprintString(JSON.stringify(spaced, null, 1))).toEqual({ ok: true, data: spaced, string: encodeBlueprintString(spaced) });
  });

  it("fails as the decoder fails, and for JSON whose string is longer than the limit", () => {
    for (const text of ["", " \n", "hello", "0", "0eN!!", "{ not json", "[1]", `1${foreign(data).slice(1)}`, foreign(data).slice(0, -8)]) {
      const decoded = decodeBlueprintString(text);
      expect(decoded.ok).toBe(false);
      expect(canonicalBlueprintString(text)).toEqual(decoded);
    }
    const text = foreign(data);
    expect(canonicalBlueprintString(text, { maxStringLength: text.length })).toMatchObject({ ok: true });
    expect(canonicalBlueprintString(text, { maxStringLength: text.length - 1 })).toMatchObject({ ok: false, code: "too-long" });
    const json = '{"a":1}';
    expect(encodeBlueprintString({ a: 1 }).length).toBeGreaterThan(json.length);
    expect(decodeBlueprintString(json, { maxStringLength: json.length })).toEqual({ ok: true, data: { a: 1 } });
    expect(canonicalBlueprintString(json, { maxStringLength: json.length })).toEqual({ ok: false, code: "too-long", message: "The blueprint string is longer than 0 MB" });
  });

  it("gives a book back byte for byte when nothing was written into it, and a book that was written into as a string of its own", () => {
    const text = foreign(BOOK);
    const kept = canonicalBlueprintString(text.replace(/(.{64})/g, "$1\n"));
    if (!kept.ok) throw new Error(kept.message);
    expect(kept.string).toBe(text);
    const edit = done(addToBook(kept.data, [], NEW));
    expect(canonicalBlueprintString(edit.string)).toEqual({ ok: true, data: edit.data, string: edit.string });
    // What decoding gave is still what it was.
    expect(kept.data).toEqual(BOOK);
  });
});

// Fixture F-30: books the game wrote and what it made of books written by hand (docs/factorio-audit.md 5.2). `slot` counts from 1.
interface Held {
  readonly slot: number;
  readonly label?: string;
}
interface RecordedBook {
  readonly blueprint_book: { readonly blueprints?: readonly { readonly index?: number }[] };
}
interface Fixture {
  readonly gameVersion: string;
  readonly book: { readonly string: string; readonly exported: RecordedBook };
  readonly imports: readonly { readonly label: string; readonly sent: RecordedBook; readonly contents: { readonly slots: readonly Held[] }; readonly exported: RecordedBook }[];
}

const FIXTURE = new URL("../../../tests/fixtures/game/F-30-blueprint-book.json", import.meta.url);
const fixture = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture) : undefined;

describe.skipIf(!fixture)(fixture ? `book: against books of the game, Factorio ${fixture.gameVersion} (fixture F-30)` : "book: against books of the game (fixture F-30): SKIPPED, not recorded; run `make probe-blueprint-book`", () => {
  if (!fixture) return it("holds the index rule against tests/fixtures/game/F-30-blueprint-book.json", () => {});
  const { book, imports } = fixture;
  const itemsOf = (data: RecordedBook): readonly unknown[] => data.blueprint_book.blueprints ?? [];
  const labelOf = (item: unknown): string => String(itemOf(item).body.label ?? "");

  it("has the cases the index rule is about", () => {
    const labels = imports.map((one) => one.label);
    for (const label of ["no index", "index on some", "no index, then index 0", "duplicate index", "duplicate index, last", "out of order", "gap", "far index", "index 65534", "index 65535", "index 65536", "index -1", "index 1.5", "no blueprints"]) expect(labels).toContain(label);
  });

  it("gives every item of a book written by hand the slot the game gave it, and none to those the game dropped", () => {
    for (const one of imports) {
      const sent = itemsOf(one.sent);
      const slots = bookSlots(sent);
      const kept = sent.flatMap((item, position) => (slots[position] === undefined ? [] : [{ slot: slots[position] + 1, label: labelOf(item) }])).sort((a, b) => a.slot - b.slot);
      expect(kept, one.label).toEqual(one.contents.slots.map(({ slot, label }) => ({ slot, label: label ?? "" })));
      // What the game then writes says the same.
      expect(bookSlots(itemsOf(one.exported)), one.label).toEqual(one.contents.slots.map(({ slot }) => slot - 1));
    }
  });

  it("picks for a new item a slot that the game left empty: the one after the last, or the first empty one when the last is in use", () => {
    for (const one of imports) {
      const taken = one.contents.slots.map(({ slot }) => slot - 1);
      const last = Math.max(-1, ...taken);
      const expected = last + 1 < BOOK_SLOTS ? last + 1 : Array.from({ length: BOOK_SLOTS }, (_, slot) => slot).find((slot) => !taken.includes(slot));
      expect(nextBookIndex(itemsOf(one.sent)), one.label).toBe(expected);
      expect(nextBookIndex(itemsOf(one.exported)), one.label).toBe(expected);
      expect(taken, one.label).not.toContain(expected);
    }
    expect(nextBookIndex(itemsOf(imports.find((one) => one.label === "index 65534")!.sent))).toBe(1);
  });

  it("adds to the book the game wrote, after its last slot, and to the book inside it", () => {
    const items = itemsOf(book.exported);
    expect(items.map((item) => (item as { index: number }).index)).toEqual([0, 2, 3, 4, 5]);
    const edit = done(addToBook(book.exported, [], NEW));
    expect(edit.path).toEqual([5]);
    expect(dig(edit.data, "blueprint_book", "blueprints", 5)).toEqual({ blueprint: NEW, index: 6 });
    items.forEach((item, position) => expect(dig(edit.data, "blueprint_book", "blueprints", position)).toBe(item));
    expect(Object.keys(dig(edit.data, "blueprint_book") as object)).toEqual(Object.keys(book.exported.blueprint_book));
    expect(imported(edit.data, { select: edit.path, instruments: INSTRUMENTS }).circuit).toEqual(imported({ blueprint: NEW }).circuit);

    expect(itemOf(items[2])).toMatchObject({ kind: "book", key: "blueprint_book" });
    const inner = done(addToBook(book.exported, [2], NEW));
    expect(inner.path).toEqual([2, 1]);
    expect(dig(inner.data, "blueprint_book", "blueprints", 2, "blueprint_book", "blueprints", 1)).toEqual({ blueprint: NEW, index: 1 });
    expect(dig(inner.data, "blueprint_book", "blueprints", 2, "index")).toBe(3);
    for (const position of [0, 1, 3, 4]) expect(dig(inner.data, "blueprint_book", "blueprints", position)).toBe(items[position]);
  });

  it("replaces a blueprint of the book the game wrote: the item keeps its index, and with keep its description", () => {
    const replacedItem = itemOf(itemsOf(book.exported)[1]);
    expect(replacedItem).toMatchObject({ kind: "blueprint", body: { label: "third", description: "The third slot" }, wrapper: { index: 2 } });
    const edit = done(replaceInBook(book.exported, [1], NEW, { keep: true }));
    // What the game wrote of the fields that are carried over (its icons among them) stays.
    const carried = Object.fromEntries(CARRIED_BLUEPRINT_FIELDS.filter((field) => field in replacedItem.body).map((field) => [field, replacedItem.body[field]]));
    expect(carried).toMatchObject({ description: "The third slot" });
    expect(dig(edit.data, "blueprint_book", "blueprints", 1)).toEqual({ blueprint: { ...NEW, ...carried }, index: 2 });
    expect(Object.keys(dig(edit.data, "blueprint_book", "blueprints", 1) as object)).toEqual(["blueprint", "index"]);
    expect(bookSlots(itemsOf(edit.data as unknown as RecordedBook))).toEqual([0, 2, 3, 4, 5]);
    expect(dig(done(replaceInBook(book.exported, [1], NEW)).data, "blueprint_book", "blueprints", 1)).toEqual({ blueprint: NEW, index: 2 });
    for (const path of [[2], [3], [4]]) expect(codeOf(replaceInBook(book.exported, path, NEW))).toBe("not-a-blueprint");
  });

  it("keeps the string of the game as it is for a project", () => {
    expect(canonicalBlueprintString(`${book.string}\n`)).toEqual({ ok: true, data: book.exported, string: book.string });
  });
});
