// Fixture F-30: the reading of blueprint books against books the game itself wrote. tests/fixtures/game/F-30-blueprint-book.json
// is recorded from the installed game by `make probe-blueprint-book` (tools/game-probe/blueprint-book.mjs): `book` is a book the
// game filled through its runtime API, `imports` are books written by hand as the game exported them after reading them, each
// with what the game says is in its slots (`contents`), and `edits` are books of the game that `addToBook` and `replaceInBook`
// wrote an export into, as the game read them and exported them again.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addToBook, canonicalBlueprintString, CARRIED_BLUEPRINT_FIELDS, decodeBlueprintString, EXPORT_VERSION, importBlueprint, inspectBlueprint, replaceInBook,
  type BlueprintItemKind, type BookEdit, type BookEntry,
} from "../src/index.ts";
import { imported } from "./helpers.ts";
import { exportedSamples, INSTRUMENTS } from "./samples.ts";

/** What a stack of the game holds; `slot` counts from 1, and a book lists only its slots that are not empty. */
interface Held {
  readonly slot?: number;
  readonly item: string;
  readonly label?: string;
  readonly entities?: number;
  readonly slots?: readonly Held[];
}

interface BookItem {
  readonly index: number;
  readonly blueprint?: Readonly<Record<string, unknown>>;
  readonly blueprint_book?: BookBody;
}

interface BookBody {
  readonly blueprints?: readonly BookItem[];
  readonly active_index: number;
  readonly version: number;
}

interface ExportedBook {
  readonly blueprint_book: BookBody;
}

/** A book of the game that the package wrote a blueprint into (`sent`), and what the game made of it. */
interface Edit {
  readonly label: string;
  /** Where in the fixture the book is that was written into. */
  readonly input: string;
  readonly operation: "add" | "replace";
  readonly target: readonly number[];
  readonly keep?: boolean;
  readonly sample: string;
  readonly path: readonly number[];
  readonly sent: ExportedBook;
  readonly importResult: number;
  readonly contents: Held;
  readonly exported: ExportedBook;
}

interface Fixture {
  readonly gameVersion: string;
  readonly native: { readonly empty: { readonly exported: ExportedBook }; readonly carried: { readonly exported: ExportedBook } };
  readonly book: { readonly string: string; readonly exported: ExportedBook; readonly contents: Held; readonly items: readonly { readonly slot: number; readonly exported: object }[] };
  readonly imports: readonly { readonly label: string; readonly importResult: number; readonly contents: Held; readonly exported: ExportedBook }[];
  readonly edits: readonly Edit[];
}

const FIXTURE = new URL("../../../tests/fixtures/game/F-30-blueprint-book.json", import.meta.url);
const fixture = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture) : undefined;

const KINDS: Readonly<Record<string, BlueprintItemKind>> = { blueprint: "blueprint", "blueprint-book": "book", "upgrade-planner": "upgrade-planner", "deconstruction-planner": "deconstruction-planner" };

type Listed = Pick<BookEntry, "path" | "kind" | "label" | "entities">;

/** The entries the slots of a book come to: the game writes its items in the order of the slots and leaves the empty ones out, and a path is a position in what it wrote. */
function slotEntries(book: Held, path: readonly number[] = []): Listed[] {
  return (book.slots ?? []).flatMap((held, position) => {
    const own = [...path, position];
    return [{ path: own, kind: KINDS[held.item] ?? "unknown", label: held.label ?? "", entities: held.entities ?? 0 }, ...slotEntries(held, own)];
  });
}

function listed(data: unknown): Listed[] {
  const inspection = inspectBlueprint(data);
  if (inspection.kind !== "book") throw new Error(`not a book: ${inspection.kind}`);
  return inspection.entries.map(({ path, kind, label, entities }) => ({ path, kind, label, entities }));
}

/** The item at a path: positions in the nested `blueprints` lists. */
function itemAt(book: ExportedBook, path: readonly number[]): BookItem {
  let item: BookItem | undefined;
  let body: BookBody | undefined = book.blueprint_book;
  for (const position of path) {
    item = body?.blueprints?.[position];
    body = item?.blueprint_book;
  }
  if (!item) throw new Error(`no item at [${path.join(", ")}]`);
  return item;
}

type Draft = { blueprint?: Record<string, unknown>; blueprint_book?: { blueprints?: Draft[] }; index?: number };

/** A copy of the book that `change` is given the list with the item at `path` and its position in to work on. */
function changedAt(book: ExportedBook, path: readonly number[], change: (list: Draft[], position: number, parent: { blueprints?: Draft[] }) => void): ExportedBook {
  const copy = JSON.parse(JSON.stringify(book)) as { blueprint_book: { blueprints?: Draft[] } };
  let parent = copy.blueprint_book;
  for (const position of path.slice(0, -1)) parent = parent.blueprints![position]!.blueprint_book!;
  change(parent.blueprints!, path[path.length - 1]!, parent);
  return copy as unknown as ExportedBook;
}

/** The book without the item at `path`; a list that is empty then is none, which is how the game writes an empty book. */
const without = (book: ExportedBook, path: readonly number[]): ExportedBook =>
  changedAt(book, path, (list, position, parent) => {
    list.splice(position, 1);
    if (list.length === 0) delete parent.blueprints;
  });

/** What the game exports for a book it changes nothing else in: `version` on the blueprint at `path`, and every list in the order of its slots. */
function asTheGameWrites(book: ExportedBook, path: readonly number[], version: number): ExportedBook {
  const sorted = (body: { blueprints?: Draft[] }): void => {
    body.blueprints?.sort((a, b) => a.index! - b.index!);
    for (const item of body.blueprints ?? []) if (item.blueprint_book) sorted(item.blueprint_book);
  };
  const copy = changedAt(book, path, (list, position) => (list[position]!.blueprint!.version = version)) as unknown as { blueprint_book: { blueprints?: Draft[] } };
  sorted(copy.blueprint_book);
  return copy as unknown as ExportedBook;
}

/** The stack in the slots that the items along `path` name with their `index`. */
function heldAt(contents: Held, book: ExportedBook, path: readonly number[]): Held | undefined {
  return path.reduce<Held | undefined>((held, _position, depth) => held?.slots?.find((one) => one.slot === itemAt(book, path.slice(0, depth + 1)).index + 1), contents);
}

describe.skipIf(!fixture)(fixture ? `books of the game, Factorio ${fixture.gameVersion} (fixture F-30)` : "books of the game (fixture F-30): SKIPPED, not recorded; run `make probe-blueprint-book`", () => {
  if (!fixture) return it("holds the package against tests/fixtures/game/F-30-blueprint-book.json", () => {});
  const { book, imports, native } = fixture;

  it("decodes the string the game exported for a book", () => {
    expect(decodeBlueprintString(book.string)).toEqual({ ok: true, data: book.exported });
  });

  it("lists the items of the book with their kinds, labels and paths, the one in the book inside it included", () => {
    expect(inspectBlueprint(book.exported)).toMatchObject({ kind: "book", label: "Probe" });
    expect(listed(book.exported)).toEqual([
      { path: [0], kind: "blueprint", label: "first", entities: 1 },
      { path: [1], kind: "blueprint", label: "third", entities: 1 },
      { path: [2], kind: "book", label: "inner", entities: 0 },
      { path: [2, 0], kind: "blueprint", label: "inside", entities: 1 },
      { path: [3], kind: "upgrade-planner", label: "belts", entities: 0 },
      { path: [4], kind: "deconstruction-planner", label: "combinators", entities: 0 },
    ]);
    expect(listed(book.exported)).toEqual(slotEntries(book.contents));
    // A path is a position in the list the game wrote, not an `index`: the second slot is empty, so the item at [1] has index 2.
    expect(book.exported.blueprint_book.blueprints!.map((item) => item.index)).toEqual([0, 2, 3, 4, 5]);
    expect(book.contents.slots!.map((held) => held.slot)).toEqual([1, 3, 4, 5, 6]);
  });

  it("does not import the book but offers its three blueprints", () => {
    expect(importBlueprint(book.exported)).toMatchObject({ ok: false, code: "book", message: "This is a blueprint book 'Probe' with 3 blueprints; choose one of them" });
  });

  it("imports each blueprint of the book that is chosen by its path", () => {
    for (const [select, name] of [[[0], "first"], [[1], "third"], [[2, 0], "inside"]] as const) {
      const { circuit, report } = imported(book.exported, { select });
      expect(circuit).toMatchObject({ name, entities: [{ kind: "constant", prototype: "constant-combinator" }] });
      expect(report).toMatchObject({ entities: 1, dropped: [] });
    }
    expect(imported(book.exported, { select: [1] }).report.ignored).toEqual(expect.arrayContaining(["description", "icons"]));
  });

  it("lists the book inside the book when that is chosen, and refuses the planners and a path that leads nowhere", () => {
    expect(importBlueprint(book.exported, { select: [2] })).toMatchObject({ code: "book", message: "This is a blueprint book 'inner' with 1 blueprint; choose one of them", book: [{ path: [2, 0], kind: "blueprint", label: "inside" }] });
    expect(importBlueprint(book.exported, { select: [3] })).toMatchObject({ code: "unsupported-item", message: "This is an upgrade planner, not a blueprint; the editor imports blueprints only" });
    expect(importBlueprint(book.exported, { select: [4] })).toMatchObject({ code: "unsupported-item", message: "This is a deconstruction planner, not a blueprint; the editor imports blueprints only" });
    for (const select of [[5], [0, 0], [2, 1]]) expect(importBlueprint(book.exported, { select })).toMatchObject({ code: "invalid-selection" });
  });

  it("knows the items of the book when the game exports them on their own", () => {
    expect(book.items.map((item) => inspectBlueprint(item.exported))).toMatchObject([
      { kind: "blueprint", label: "first", entities: 1 },
      { kind: "blueprint", label: "third", entities: 1 },
      { kind: "book", label: "inner", entries: [{ path: [0], kind: "blueprint", label: "inside" }] },
      { kind: "upgrade-planner", label: "belts" },
      { kind: "deconstruction-planner", label: "combinators" },
    ]);
  });

  it("reads an empty book, which the game writes without a list of items", () => {
    expect(native.empty.exported.blueprint_book.blueprints).toBeUndefined();
    expect(inspectBlueprint(native.empty.exported)).toEqual({ kind: "book", label: "", entries: [] });
    expect(importBlueprint(native.empty.exported)).toMatchObject({ code: "book", message: "The blueprint book has no blueprints", book: [] });
  });

  it("lists every book the game exported after reading one written by hand as the game has it in its slots", () => {
    expect(imports.length).toBeGreaterThan(20);
    for (const { label, contents, exported } of imports) {
      const entries = listed(exported);
      expect(entries, label).toEqual(slotEntries(contents));
      for (const entry of entries.filter((one) => one.kind === "blueprint" && one.entities > 0)) {
        expect(imported(exported, { select: entry.path }).circuit, `${label}, ${entry.label}`).toMatchObject({ name: entry.label, entities: [{ prototype: "constant-combinator" }] });
      }
    }
  });

  it("imports the blueprint of a book three levels deep", () => {
    const deep = imports.find((entry) => entry.label === "three levels")!;
    expect(listed(deep.exported).map((entry) => entry.path)).toEqual([[0], [0, 0], [0, 0, 0]]);
    expect(imported(deep.exported, { select: [0, 0, 0] }).circuit).toMatchObject({ name: "deep", entities: [{ kind: "constant" }] });
  });

  it("keeps the string of the game as it is", () => {
    expect(canonicalBlueprintString(`${book.string.slice(0, 60)}\n ${book.string.slice(60)}\n`)).toEqual({ ok: true, data: book.exported, string: book.string });
  });

  // Books of this recording that addToBook and replaceInBook wrote the export of a sample into; the game then read each of them.
  describe("written into by the package and read by the game", () => {
    const { edits } = fixture;
    const gameVersion = book.exported.blueprint_book.version;
    const inputs: Readonly<Record<string, ExportedBook>> = {
      "book.exported": book.exported,
      "native.empty.exported": native.empty.exported,
      "the exported of the import 'index 65534'": imports.find((entry) => entry.label === "index 65534")!.exported,
      "native.carried.exported": native.carried.exported,
    };
    const samples = new Map(exportedSamples().map((sample) => [sample.label, sample.data]));
    const written = (edit: Edit): Readonly<Record<string, unknown>> => samples.get(edit.sample)!.blueprint as unknown as Readonly<Record<string, unknown>>;
    const apply = (edit: Edit): BookEdit => {
      const blueprint = samples.get(edit.sample)!.blueprint;
      return edit.operation === "add" ? addToBook(inputs[edit.input], edit.target, blueprint) : replaceInBook(inputs[edit.input], edit.target, blueprint, { keep: edit.keep === true });
    };
    // Per edit the `index` the function gave the blueprint (kept, for a replacement) and where the game has the item in the list it exports.
    const PLACES: readonly { readonly label: string; readonly index: number; readonly position: readonly number[] }[] = [
      { label: "add to the book", index: 6, position: [5] },
      { label: "add to the book inside the book", index: 1, position: [2, 1] },
      { label: "add to an empty book", index: 0, position: [0] },
      // The first empty slot: the game lists the item by its slot, before the one in the last slot it was written after.
      { label: "add to a book whose last slot is taken", index: 1, position: [1] },
      { label: "replace", index: 2, position: [1] },
      { label: "replace and keep", index: 0, position: [0] },
    ];
    const cases = edits.map((edit) => ({ edit, place: PLACES.find((place) => place.label === edit.label)! }));
    // The keys of a blueprint that has all it can have as an item, in the order the game writes them.
    const GAME_KEYS = ["description", "snap-to-grid", "absolute-snapping", "position-relative-to-grid", "icons", "entities", "wires", "item", "label", "label_color", "version"];

    it("has every edit of the probe, all of them of a sample with entities of several kinds and wires", () => {
      expect(edits.map((edit) => edit.label)).toEqual(PLACES.map((place) => place.label));
      expect(edits.map((edit) => [edit.operation, edit.keep === true])).toEqual([["add", false], ["add", false], ["add", false], ["add", false], ["replace", false], ["replace", true]]);
      for (const edit of edits) expect(written(edit), edit.label).toMatchObject({ label: "a counter with a speaker", version: EXPORT_VERSION, entities: { length: 4 }, wires: { length: 4 }, icons: { length: 4 } });
      expect(gameVersion).toBeGreaterThan(EXPORT_VERSION);
    });

    it.each(cases)("$edit.label: is what the function writes now, an export with its own version in a book of the game's", ({ edit, place }) => {
      const result = apply(edit);
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      expect(result).toMatchObject({ path: edit.path, data: edit.sent });
      expect(result.data).toEqual(edit.sent);
      expect(decodeBlueprintString(result.string)).toEqual({ ok: true, data: edit.sent });
      const item = itemAt(edit.sent, edit.path);
      expect(item.index).toBe(place.index);
      expect(Object.keys(item)).toEqual(["blueprint", "index"]);
      expect(item.blueprint).toMatchObject({ ...written(edit), ...(edit.keep && Object.fromEntries(CARRIED_BLUEPRINT_FIELDS.map((field) => [field, itemAt(inputs[edit.input]!, edit.target).blueprint![field]]))) });
      expect(edit.sent.blueprint_book.version).toBe(gameVersion);
    });

    it.each(cases)("$edit.label: the game reads it without an error and has the blueprint in the slot its index says", ({ edit }) => {
      expect(edit.importResult).toBe(0);
      expect(heldAt(edit.contents, edit.sent, edit.path)).toMatchObject({ item: "blueprint", label: edit.sample, entities: 4 });
    });

    it.each(cases)("$edit.label: the game exports the book as it was written, with its own version on the blueprint and the items in the order of their slots", ({ edit, place }) => {
      expect(edit.exported).toEqual(asTheGameWrites(edit.sent, edit.path, gameVersion));
      const again = itemAt(edit.exported, place.position);
      expect(again.index).toBe(place.index);
      expect(again.blueprint).toEqual({ ...itemAt(edit.sent, edit.path).blueprint, version: gameVersion });
    });

    it("finds the blueprint where the returned path says in what the game exports, but in the book whose last slot was taken", () => {
      expect(cases.filter(({ edit, place }) => JSON.stringify(edit.path) !== JSON.stringify(place.position)).map(({ edit, place }) => [edit.label, edit.path, place.position])).toEqual([["add to a book whose last slot is taken", [2], [1]]]);
    });

    it.each(cases)("$edit.label: every other item, and the book itself, is what the game had written", ({ edit, place }) => {
      const input = inputs[edit.input]!;
      expect(without(edit.exported, place.position)).toEqual(edit.operation === "add" ? input : without(input, edit.target));
      expect(JSON.stringify(without(edit.exported, place.position))).toBe(JSON.stringify(edit.operation === "add" ? input : without(input, edit.target)));
    });

    it("writes the keys in the order of the game, so that the game's string holds the same text, but for the list of an empty book and the fields a replacement carried over", () => {
      const differing = edits.filter((edit) => JSON.stringify(edit.exported) !== JSON.stringify(asTheGameWrites(edit.sent, edit.path, gameVersion)));
      expect(differing.map((edit) => edit.label)).toEqual(["add to an empty book", "replace and keep"]);
      const [empty, kept] = differing;
      // The game wrote no `blueprints` for the empty book, so the list is its last key; the game has it first.
      expect(Object.keys(empty!.sent.blueprint_book)).toEqual(["item", "active_index", "version", "blueprints"]);
      expect(Object.keys(empty!.exported.blueprint_book)).toEqual(["blueprints", "item", "active_index", "version"]);
      // The carried fields stand behind the export's own; the game sorts them in.
      expect(Object.keys(itemAt(kept!.sent, kept!.path).blueprint!)).toEqual(["icons", "entities", "wires", "item", "label", "version", "description", "label_color", "snap-to-grid", "absolute-snapping", "position-relative-to-grid"]);
      expect(Object.keys(itemAt(kept!.exported, kept!.path).blueprint!)).toEqual(GAME_KEYS);
      expect(Object.keys(kept!.exported.blueprint_book)).toEqual(Object.keys(kept!.sent.blueprint_book));
    });

    it.each(cases)("$edit.label: the blueprint the game exports is the circuit that was written", ({ edit, place }) => {
      const { circuit, report } = imported(edit.exported, { select: place.position, instruments: INSTRUMENTS });
      expect(circuit).toEqual(imported(samples.get(edit.sample)).circuit);
      expect(report).toMatchObject({ entities: 4, dropped: [], wires: { imported: 4, copper: 0, toDropped: 0, invalid: 0 }, settings: [], warnings: [] });
    });

    it("reads the blueprint in a book as it reads it on its own (fixture F-01)", () => {
      const recorded = new URL("../../../tests/fixtures/game/F-01-blueprints.json", import.meta.url);
      if (!existsSync(recorded)) return;
      const alone = (JSON.parse(readFileSync(recorded, "utf8")) as { cases: { label: string; reexported: { blueprint: { blueprint: object } } }[] }).cases.find((entry) => entry.label === edits[0]!.sample)!;
      for (const { edit, place } of cases.filter(({ edit }) => !edit.keep)) expect(JSON.stringify(itemAt(edit.exported, place.position).blueprint), edit.label).toBe(JSON.stringify(alone.reexported.blueprint.blueprint));
    });

    it("leaves nothing of a replaced blueprint without `keep`: its description is gone and the icons are the export's", () => {
      const { edit, place } = cases.find(({ edit }) => edit.label === "replace")!;
      const replaced = itemAt(inputs[edit.input]!, edit.target).blueprint!;
      expect(replaced).toMatchObject({ label: "third", description: "The third slot", icons: [{ signal: { type: "virtual", name: "signal-C" }, index: 1 }] });
      const again = itemAt(edit.exported, place.position).blueprint!;
      expect(Object.keys(again)).toEqual(["icons", "entities", "wires", "item", "label", "version"]);
      expect(again.icons).toEqual(written(edit).icons);
    });

    it("has all six fields that `keep` carried over in what the game exports, as the game had written them, next to the new entities", () => {
      const { edit, place } = cases.find(({ edit }) => edit.keep)!;
      const replaced = itemAt(inputs[edit.input]!, edit.target).blueprint!;
      // The game wrote them itself: the probe set them through the runtime API.
      expect(Object.keys(replaced)).toEqual(GAME_KEYS.filter((key) => key !== "wires"));
      expect(replaced).toMatchObject({ "snap-to-grid": { x: 8, y: 4 }, "absolute-snapping": true, "position-relative-to-grid": { x: 3, y: 1 }, entities: { length: 2 } });
      const again = itemAt(edit.exported, place.position).blueprint!;
      for (const field of CARRIED_BLUEPRINT_FIELDS) expect(again[field], field).toEqual(replaced[field]);
      expect(again.icons).not.toEqual(written(edit).icons);
      expect(again).toMatchObject({ label: edit.sample, entities: written(edit).entities, wires: written(edit).wires });
    });
  });
});
