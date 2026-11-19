// The pure part of the blueprint book probe: the books it sends and the fixture built from a recording. The library is plain .mjs, loaded as in tools/catalog.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Case { label: string; data: Record<string, unknown>; plain?: boolean }
interface Edit { label: string; input: string; operation: string; target: number[]; keep?: boolean; sample: string; path: number[]; string: string }
interface Edits { cases: Edit[]; imports: unknown[]; lastSlotCase: string }
type Fixture = Record<string, unknown> & { imports: Record<string, unknown>[]; edits: Record<string, unknown>[]; book: Record<string, unknown>; errors: string[] };

const load = async <T>(file: string): Promise<T> => (await import(/* @vite-ignore */ new URL(file, import.meta.url).href)) as T;
const { CASES, composeScenario, encodeString, sentCases } = await load<{
  CASES: Case[];
  composeScenario(books: { label: string; string: string }[], importsOnly?: boolean): string;
  encodeString(data: unknown): string;
  sentCases(cases?: Case[]): { label: string; string: string }[];
}>("./blueprintBookCases.mjs");
const { buildFixture, fixtureErrors, serialiseFixture, summarise } = await load<{
  buildFixture(recording: unknown, cases: Case[], source: string, edits: Edits): Fixture;
  fixtureErrors(fixture: Fixture): string[];
  serialiseFixture(fixture: Fixture): string;
  summarise(fixture: Fixture): string[];
}>("./blueprintBookFixture.mjs");
const { decodeString } = await load<{ decodeString(text: string): unknown }>("./blueprintFixture.mjs");

const book = (label: string, blueprints?: unknown[]): Record<string, unknown> => ({ blueprint_book: { ...(blueprints && { blueprints }), item: "blueprint-book", label, active_index: 0, version: 1 } });
const blueprint = (label: string, index: number): unknown => ({ blueprint: { item: "blueprint", label, version: 1 }, index });
const held = (label: string, slots: unknown): unknown => ({ contents: { slots, active_index: 1, size: Array.isArray(slots) ? slots.length : 0, label, item: "blueprint-book" }, exported: encodeString(book(label, Array.isArray(slots) ? [blueprint("A", 0)] : undefined)) });
const cases: Case[] = [{ label: "one", data: book("one", [blueprint("A", 0)]) }, { label: "refused", data: book("refused"), plain: true }];
const recording = {
  game_version: "2.1.25",
  native: {
    // The game writes an empty Lua table as an object.
    errors: {},
    empty: held("", {}),
    empty_labelled: held("Empty", {}),
    beyond_size: { size_before: 0, error: "Index out of inventory bounds.", size_after: 0 },
    blank_blueprint: { inserts: [{ size: 1, slot: 1, inserted: 1, item: "blueprint" }], state: held("", [{ entities: 0, item: "blueprint", slot: 1 }]) },
    carried: held("Carried", [{ label: "kept", entities: 2, item: "blueprint", slot: 1 }]),
    full: {
      size_fresh: 0, inserts: [{ size: 1, slot: 1, inserted: 1, item: "blueprint" }], size_after_clear: 1, state: held("Probe", [{ label: "A", entities: 1, item: "blueprint", slot: 1 }]),
      items: [{ slot: 1, exported: encodeString(blueprint("A", 0)) }], reimport: { import_result: 0, same_string: true, same_contents: true },
      active: [{ set: 1, read: 1, exported: encodeString(book("Probe")) }, { set: 0, read: 1, exported: encodeString(book("Probe")), error: "too small" }],
      added: [{ size: 2, slot: 2, inserted: 1, item: "blueprint" }], state_after_adding: held("Probe", [{ label: "A", entities: 1, item: "blueprint", slot: 1 }]), size_after_clearing_last: 1,
    },
  },
  imports: [{ label: "one", import_result: 0, ...(held("one", [{ slot: 1, entities: 0, label: "A", item: "blueprint" }]) as object) }, { label: "refused", error: "no" }],
  limits: { inserted: { tried: 3, inserted: 2, size: 2, filled: 2, can_insert: false }, imported: { sent: 3, import_result: 0, size: 2, filled: 2, first_label: "1", last_label: "2", exported: 2, last_index: 1 } },
};
// The second run: a book of the first that a blueprint was written into, and what the game made of it.
const edits: Edits = {
  cases: [{ label: "added", input: "last slot", operation: "add", target: [], sample: "s", path: [1], string: encodeString(book("one", [blueprint("A", 0), blueprint("s", 1)])) }, { label: "kept", input: "carried", operation: "replace", target: [0], keep: true, sample: "s", path: [0], string: encodeString(book("Carried", [blueprint("s", 0)])) }],
  imports: [{ label: "added", import_result: 0, ...(held("one", [{ slot: 1, entities: 0, label: "A", item: "blueprint" }]) as object) }, { label: "kept", error: "no" }],
  lastSlotCase: "one",
};

describe("blueprint book cases", () => {
  it("encodes a book as a string the fixture decodes again, and gives the game the JSON text where a case says so", () => {
    expect(decodeString(encodeString(cases[0]!.data))).toEqual(cases[0]!.data);
    expect(sentCases(cases)).toEqual([{ label: "one", string: encodeString(cases[0]!.data) }, { label: "refused", string: JSON.stringify(cases[1]!.data) }]);
    const [first, second, third] = composeScenario(sentCases(cases)).split("\n");
    expect(JSON.parse(/^local CASES_JSON = \[==\[(.*)\]==\]$/.exec(first!)![1]!)).toEqual(sentCases(cases));
    expect(second).toBe("local IMPORTS_ONLY = false");
    expect(third).toMatch(/^-- Scenario run headless by tools\/game-probe\/blueprint-book\.mjs/);
    expect(composeScenario([{ label: "edit", string: "0eN" }], true).split("\n").slice(0, 2)).toEqual(['local CASES_JSON = [==[[{"label":"edit","string":"0eN"}]]==]', "local IMPORTS_ONLY = true"]);
  });

  it("names every case once", () => {
    expect(new Set(CASES.map((entry) => entry.label)).size).toBe(CASES.length);
  });
});

describe("blueprint book fixture", () => {
  const fixture = buildFixture(recording, cases, "test", edits);

  it("decodes what the game exported and keeps the fields in one order", () => {
    expect(fixture).toMatchObject({ id: "F-30-blueprint-book", source: "test", gameVersion: "2.1.25", errors: [] });
    expect(fixture.imports[0]).toEqual({ label: "one", sent: cases[0]!.data, importResult: 0, contents: { item: "blueprint-book", label: "one", size: 1, activeIndex: 1, slots: [{ slot: 1, item: "blueprint", label: "A", entities: 0 }] }, exported: book("one", [blueprint("A", 0)]) });
    expect(Object.keys((fixture.imports[0]!.contents as { slots: object[] }).slots[0]!)).toEqual(["slot", "item", "label", "entities"]);
    expect(fixture.native).toMatchObject({ empty: { contents: { size: 0, slots: [] }, exported: book("") } });
    expect(fixture.book).toMatchObject({ string: encodeString(book("Probe", [blueprint("A", 0)])), active: [{ set: 1, read: 1, exportedActiveIndex: 0 }, { set: 0, read: 1, exportedActiveIndex: 0, error: "too small" }], afterAdding: { exportedIndexes: [0] } });
  });

  it("has the books the package wrote into with what was done to them, where the book is that was written into, and what the game made of them", () => {
    expect(fixture.native).toMatchObject({ carried: { contents: { label: "Carried", slots: [{ slot: 1, item: "blueprint", label: "kept", entities: 2 }] } } });
    expect(fixture.edits[0]).toEqual({
      label: "added", input: "the exported of the import 'one'", operation: "add", target: [], sample: "s", path: [1], sent: book("one", [blueprint("A", 0), blueprint("s", 1)]),
      importResult: 0, contents: { item: "blueprint-book", label: "one", size: 1, activeIndex: 1, slots: [{ slot: 1, item: "blueprint", label: "A", entities: 0 }] }, exported: book("one", [blueprint("A", 0)]),
    });
    expect(fixture.edits[1]).toEqual({ label: "kept", input: "native.carried.exported", operation: "replace", target: [0], keep: true, sample: "s", path: [0], sent: book("Carried", [blueprint("s", 0)]), contents: null, error: "no" });
  });

  it("keeps what the game refused", () => {
    expect(fixture.imports[1]).toEqual({ label: "refused", plain: true, sent: cases[1]!.data, contents: null, error: "no" });
    expect(fixtureErrors(fixture)).toEqual(["refused: no", "kept: no"]);
    expect(summarise(fixture).find((line) => line.startsWith("refused"))).toBe("refused: import_stack undefined; nothing");
  });

  it("wants one recorded import per case, in the order of the cases", () => {
    expect(() => buildFixture(recording, [...cases].reverse(), "test", edits)).toThrow("the recording has 'one' where 'refused' was sent");
    expect(() => buildFixture(recording, cases.slice(1), "test", edits)).toThrow("not one import per case");
    expect(() => buildFixture(recording, cases, "test", { ...edits, cases: [...edits.cases].reverse() })).toThrow("the second recording has 'added' where 'kept' was sent");
    expect(() => buildFixture(recording, cases, "test", { ...edits, imports: [] })).toThrow("not one import per edit");
  });

  it("writes one book per line, as valid JSON, the same for the same recording", () => {
    const text = serialiseFixture(fixture);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(fixture)));
    expect(text).toContain('  "imports": [\n    {\n      "label": "one",\n      "sent": {"blueprint_book":');
    expect(text).toContain('  "errors": [],\n  "native": {\n    "empty": {"contents":');
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('  "edits": [\n    {\n      "label": "added",\n      "input": "the exported of the import \'one\'",\n      "operation": "add",\n      "target": [],\n      "sample": "s",\n      "path": [1],\n      "sent": {"blueprint_book":');
    expect(serialiseFixture(buildFixture(JSON.parse(JSON.stringify(recording)), cases, "test", JSON.parse(JSON.stringify(edits)) as Edits))).toBe(text);
  });

  const recorded = new URL("../../../tests/fixtures/game/F-30-blueprint-book.json", import.meta.url);
  it.skipIf(!existsSync(recorded))("writes the recorded fixture as it is in the repository, with the cases that were sent", () => {
    const text = readFileSync(recorded, "utf8");
    const parsed = JSON.parse(text) as Fixture;
    expect(serialiseFixture(parsed)).toBe(text);
    expect(parsed.imports.map(({ label, sent, plain }) => ({ label, data: sent, ...(plain !== undefined && { plain }) }))).toEqual(CASES);
  });

  it.skipIf(!existsSync(recorded))("has the edits of lib/blueprintBookEdits.ts as they come out now for its own books: a changed edit, sample or function is recorded again", async () => {
    const { editCases } = await import("./blueprintBookEdits.ts");
    const parsed = JSON.parse(readFileSync(recorded, "utf8")) as Fixture & { native: Record<string, { exported: unknown }>; book: { string: string } };
    const lastSlot = parsed.imports.find((entry) => entry.label === "index 65534")!;
    const made = editCases({ book: parsed.book.string, empty: JSON.stringify(parsed.native.empty!.exported), "last slot": JSON.stringify(lastSlot.exported), carried: JSON.stringify(parsed.native.carried!.exported) });
    const what = ({ label, operation, target, keep, sample, path }: Record<string, unknown>): object => ({ label, operation, target, keep, sample, path });
    expect(made.map((edit) => ({ ...what({ ...edit }), sent: decodeString(edit.string) }))).toEqual(parsed.edits.map((edit) => ({ ...what(edit), sent: edit.sent })));
  });
});
