// Fixture F-30: the reading of blueprint books against books the game itself wrote. tests/fixtures/game/F-30-blueprint-book.json
// is recorded from the installed game by `make probe-blueprint-book` (tools/game-probe/blueprint-book.mjs): `book` is a book the
// game filled through its runtime API, `imports` are books written by hand as the game exported them after reading them, each
// with what the game says is in its slots (`contents`).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeBlueprintString, importBlueprint, inspectBlueprint, type BlueprintItemKind, type BookEntry } from "../src/index.ts";
import { imported } from "./helpers.ts";

/** What a stack of the game holds; `slot` counts from 1, and a book lists only its slots that are not empty. */
interface Held {
  readonly slot?: number;
  readonly item: string;
  readonly label?: string;
  readonly entities?: number;
  readonly slots?: readonly Held[];
}

interface ExportedBook {
  readonly blueprint_book: { readonly blueprints?: readonly { readonly index: number }[]; readonly active_index: number };
}

interface Fixture {
  readonly gameVersion: string;
  readonly native: { readonly empty: { readonly exported: ExportedBook } };
  readonly book: { readonly string: string; readonly exported: ExportedBook; readonly contents: Held; readonly items: readonly { readonly slot: number; readonly exported: object }[] };
  readonly imports: readonly { readonly label: string; readonly importResult: number; readonly contents: Held; readonly exported: ExportedBook }[];
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
});
