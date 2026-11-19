// The blueprint book of a project: in the project file, as the workbench sees it, and the commands that attach one, take a
// blueprint from it, write the circuit into it, export it and remove it. The book of the game is fixture F-30
// (tests/fixtures/game/F-30-blueprint-book.json): two blueprints, a book with one blueprint inside it and two planners.
import { readFileSync } from "node:fs";
import { decodeBlueprintString, encodeBlueprintString, importBlueprintString, itemsAlong, type BlueprintItem } from "@face/blueprints";
import { analyze } from "@face/language";
import { describe, expect, it } from "vitest";
import type { LoadedProject, ProjectBook } from "../../../desktop/src/ipc.ts";
import { circuitBlueprint, INVALID_SOURCE_PROBLEM, readBlueprint, type ImportedBlueprint } from "../../src/session/blueprints.ts";
import { bookFileName, bookView, editedBook, NO_BOOK, readBookText, storedBook, writeToBook, type ReadableBook } from "../../src/session/book.ts";
import { isDirty, neverSaved, openProjectFile, sameBook, toProjectData } from "../../src/session/persistence.ts";
import type { ProjectSession } from "../../src/session/projectSession.ts";
import { createSession, EMPTY_SOURCE, fakeDesktop, idOf, project, type, type FakeDesktop } from "./helpers.ts";

const GAME_BOOK = (JSON.parse(readFileSync(new URL("../../../../tests/fixtures/game/F-30-blueprint-book.json", import.meta.url), "utf8")) as { readonly book: { readonly string: string } }).book.string;

const VERSION = 562954249109504;
const at = (x: number, y: number) => ({ x, y });
const lamp = (number: number, x: number) => ({ entity_number: number, name: "small-lamp", position: at(x + 0.5, 0.5) });
const rail = (number: number, x: number) => ({ entity_number: number, name: "straight-rail", position: at(x + 0.5, 2.5) });
const blueprint = (body: object) => ({ blueprint: { item: "blueprint", version: VERSION, ...body } });
const bookOf = (label: string | undefined, blueprints: readonly object[]) => ({ blueprint_book: { item: "blueprint-book", ...(label !== undefined && { label }), blueprints: blueprints.map((item, index) => ({ ...item, index })), active_index: 0, version: VERSION } });

/** A constant combinator with an item of Space Age, a blueprint of rails with tiles, and one without entities. */
const OTHER_BOOK = encodeBlueprintString(
  bookOf("Other", [
    blueprint({ label: "Fiber", entities: [{ entity_number: 1, name: "constant-combinator", position: at(0.5, 0.5), control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, name: "carbon-fiber", quality: "normal", comparator: "=", count: 5 }] }] } } }] }),
    blueprint({ label: "Rails", entities: [rail(1, 0), rail(2, 2), lamp(3, 0)], tiles: [{ name: "landfill", position: at(0, 0) }, { name: "landfill", position: at(1, 0) }] }),
    blueprint({ label: "Nothing" }),
  ]),
);

/** Three entities, each on its tile; the description of the lamp is a warning of every export. */
const PLACED = `circuit "Placed" {
    constant-combinator source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    decider-combinator gate at (300, 80) tile (3, 0.5) {
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    small-lamp light at (560, 80) tile (5.5, 0.5) {
        description = "Lit above eight."
        when virtual:signal-A > 8
    }

    wire red source.out <-> gate.in
    wire green gate.out <-> light.in
}
`;
const LAMP_WARNING = "The game has a description on combinators only; the description of 'light' is not in the blueprint.";

function withBook(book?: ProjectBook, source = PLACED, modules?: readonly string[]): LoadedProject {
  const loaded = project(source, modules ? { modules } : {}, "/projects/p");
  return book ? { ...loaded, data: { ...loaded.data, book } } : loaded;
}

function sessionWith(book?: ProjectBook, source = PLACED, modules?: readonly string[]): { readonly session: ProjectSession; readonly desktop: FakeDesktop } {
  const desktop = fakeDesktop();
  return { desktop, session: createSession(undefined, { api: desktop.api, project: withBook(book, source, modules) }).session };
}

/** The string the session gives for its book. */
function stringOf(session: ProjectSession): string {
  const exported = session.commands.exportBook();
  if (!exported.ok) throw new Error(exported.message);
  return exported.string;
}

/** The item at `path` of a book string, as the game wraps it. */
function itemAt(string: string, path: readonly number[]): BlueprintItem {
  const decoded = decodeBlueprintString(string);
  const item = decoded.ok ? itemsAlong(decoded.data, path)?.at(-1) : undefined;
  if (!item) throw new Error(`No item at ${path.join(".")}`);
  return item;
}

/** The source the editor makes of the blueprint at `path` of a book string. */
function sourceOf(string: string, path: readonly number[]): string {
  const reading = readBlueprint(string, [], path);
  if (reading.kind !== "blueprint") throw new Error(JSON.stringify(reading));
  return reading.blueprint.source;
}

function readable(string: string): ReadableBook {
  const book = storedBook(string);
  if (!book.ok) throw new Error(book.problem);
  return book;
}

describe("the book in the project file", () => {
  it("is loaded and written back with its origin, and a round trip gives the same project", () => {
    const book = { string: GAME_BOOK, origin: [2, 0] };
    const loaded = openProjectFile(withBook(book));
    expect(loaded.book).toEqual(book);
    expect(loaded.file.savedBook).toEqual(book);
    const data = toProjectData(loaded.file, loaded.source, loaded.settings, undefined, loaded.book);
    expect(data).toEqual(withBook(book).data);
    expect(openProjectFile({ path: "/projects/p", data })).toEqual(loaded);
    // A book without an origin has none in the file; an empty list is none (the main process refuses one).
    expect(toProjectData(loaded.file, loaded.source, loaded.settings, undefined, { string: GAME_BOOK }).book).toEqual({ string: GAME_BOOK });
    expect(toProjectData(loaded.file, loaded.source, loaded.settings, undefined, { string: GAME_BOOK, origin: [] }).book).toEqual({ string: GAME_BOOK });
  });

  it("makes the project count as changed when its string or its origin is another one", () => {
    const loaded = openProjectFile(withBook({ string: GAME_BOOK, origin: [2, 0] }));
    const dirty = (book?: ProjectBook): boolean => isDirty(loaded.file, loaded.source, loaded.settings, book);
    expect(dirty({ string: GAME_BOOK, origin: [2, 0] })).toBe(false);
    for (const other of [undefined, { string: GAME_BOOK }, { string: GAME_BOOK, origin: [2] }, { string: GAME_BOOK, origin: [2, 1] }, { string: OTHER_BOOK, origin: [2, 0] }]) expect(dirty(other), JSON.stringify(other?.origin)).toBe(true);
    expect(sameBook({ string: GAME_BOOK }, { string: GAME_BOOK, origin: [] })).toBe(true);
    expect(sameBook(undefined, undefined)).toBe(true);
    // A project that exists only in the window has nothing on disk, so its book is a change.
    expect(neverSaved(loaded.file)).not.toHaveProperty("savedBook");
    expect(isDirty(neverSaved(loaded.file), loaded.source, loaded.settings, loaded.book)).toBe(true);
  });

  it("leaves a project without a book as it always was", () => {
    const loaded = openProjectFile(withBook());
    expect(loaded).not.toHaveProperty("book");
    expect(loaded.file).not.toHaveProperty("savedBook");
    const data = toProjectData(loaded.file, loaded.source, loaded.settings);
    expect(data).toEqual(withBook().data);
    expect(Object.keys(data)).toEqual(["manifest", "files"]);
    expect(isDirty(loaded.file, loaded.source, loaded.settings)).toBe(false);
    expect(isDirty(loaded.file, loaded.source, loaded.settings, { string: GAME_BOOK })).toBe(true);
  });
});

describe("a stored book", () => {
  it("is decoded to its label and its items, and shown as rows with the blueprint the circuit came from", () => {
    const book = readable(GAME_BOOK);
    expect(book).toMatchObject({ ok: true, string: GAME_BOOK, label: "Probe" });
    expect(book.entries.map((entry) => [entry.path.join("."), entry.kind, entry.label])).toEqual([
      ["0", "blueprint", "first"], ["1", "blueprint", "third"], ["2", "book", "inner"], ["2.0", "blueprint", "inside"], ["3", "upgrade-planner", "belts"], ["4", "deconstruction-planner", "combinators"],
    ]);
    const view = bookView(book, undefined);
    expect(view).toMatchObject({ label: "Probe", unlisted: 0, origin: null, originLabel: null, problem: null });
    expect(view.rows.map(({ path, depth, label, importable, replaceable, addable }) => ({ path, depth, label, importable, replaceable, addable }))).toEqual([
      { path: [0], depth: 0, label: "first", importable: true, replaceable: true, addable: false },
      { path: [1], depth: 0, label: "third", importable: true, replaceable: true, addable: false },
      { path: [2], depth: 0, label: "inner", importable: false, replaceable: false, addable: true },
      { path: [2, 0], depth: 1, label: "inside", importable: true, replaceable: true, addable: false },
      { path: [3], depth: 0, label: "belts", importable: false, replaceable: false, addable: false },
      { path: [4], depth: 0, label: "combinators", importable: false, replaceable: false, addable: false },
    ]);
    expect(bookView(book, [2, 0])).toMatchObject({ origin: [2, 0], originLabel: "inside" });
    // An origin is from a file: one that names a book, a planner or nothing is none.
    for (const origin of [[2], [3], [9], [2, 0, 0], [-1], [0.5]]) expect(bookView(book, origin), origin.join(".")).toMatchObject({ origin: null, originLabel: null });
  });

  it("says what a replacement destroys, and has words for a book and a blueprint without a label", () => {
    const view = bookView(readable(OTHER_BOOK), [1]);
    expect(view.rows.map((row) => [row.label, row.detail, row.lost])).toEqual([
      ["Fiber", "1 entity, 1 known to the editor", { entities: 0, tiles: 0 }],
      ["Rails", "3 entities, 1 known to the editor", { entities: 2, tiles: 2 }],
      ["Nothing", "No entities", { entities: 0, tiles: 0 }],
    ]);
    const unlabelled = bookView(readable(encodeBlueprintString(bookOf(undefined, [blueprint({ entities: [lamp(1, 0)] })]))), [0]);
    expect(unlabelled).toMatchObject({ label: "Blueprint book without a label", originLabel: "Blueprint without a label" });
    // Labels are any text: bounded like every text of a blueprint.
    const long = bookView(readable(encodeBlueprintString(bookOf("b".repeat(500), [blueprint({ label: "l".repeat(500), entities: [lamp(1, 0)] })]))), [0]);
    expect([long.label, long.originLabel, long.rows[0]!.label]).toEqual([`${"b".repeat(80)}...`, `${"l".repeat(80)}...`, `${"l".repeat(80)}...`]);
  });

  it("lists the first thousand items of a long book and counts the rest", () => {
    const many = bookView(readable(encodeBlueprintString(bookOf("Many", Array.from({ length: 1003 }, (_, index) => blueprint({ label: `b${index}`, entities: [lamp(1, 0)] }))))), [1002]);
    expect([many.rows.length, many.unlisted]).toEqual([1000, 3]);
    // The origin may be beyond the rows.
    expect(many).toMatchObject({ origin: [1002], originLabel: "b1002" });
  });

  it("that does not decode or is no book is kept as it is, with what is wrong and nothing to show", () => {
    const damaged = storedBook(GAME_BOOK.slice(0, 80));
    expect(damaged).toEqual({ ok: false, string: GAME_BOOK.slice(0, 80), problem: "The blueprint book of this project cannot be read. The blueprint string is damaged or incomplete: it cannot be unpacked. It stays in the project file as it is until it is removed." });
    expect(bookView(damaged, [0])).toEqual({ label: "Blueprint book", rows: [], unlisted: 0, origin: null, originLabel: null, problem: damaged.ok ? null : damaged.problem });
    const foreign = encodeBlueprintString(blueprint({ entities: [lamp(1, 0)] }));
    expect(storedBook(foreign)).toMatchObject({ ok: false, string: foreign, problem: expect.stringContaining("cannot be read. This is a blueprint, not a blueprint book. It stays") });
    for (const text of ["", "0", "hello", "{}", encodeBlueprintString({ upgrade_planner: {} }), encodeBlueprintString([1])]) expect(storedBook(text), text).toMatchObject({ ok: false, string: text });
  });

  it("is read from a text as the string a project keeps, and anything that is no book is refused with a sentence", () => {
    const spaced = `  ${GAME_BOOK.slice(0, 50)}\n${GAME_BOOK.slice(50)}\n`;
    expect(readBookText(spaced)).toMatchObject({ ok: true, book: { string: GAME_BOOK, label: "Probe" } });
    const data = bookOf("Plain", [blueprint({ entities: [lamp(1, 0)] })]);
    expect(readBookText(JSON.stringify(data, null, 2))).toMatchObject({ ok: true, book: { string: encodeBlueprintString(data), label: "Plain" } });
    expect(readBookText(encodeBlueprintString(blueprint({ entities: [lamp(1, 0)] })))).toEqual({ ok: false, message: "This is a blueprint, not a blueprint book. File > Import Blueprint opens a blueprint as a project." });
    expect(readBookText(encodeBlueprintString({ deconstruction_planner: { item: "deconstruction-planner" } }))).toEqual({ ok: false, message: "This is a deconstruction planner, not a blueprint book." });
    expect(readBookText(encodeBlueprintString({ upgrade_planner: { item: "upgrade-planner" } }))).toEqual({ ok: false, message: "This is an upgrade planner, not a blueprint book." });
    expect(readBookText('{"a": 1}')).toEqual({ ok: false, message: "This is not a blueprint book." });
    expect(readBookText(" \n ")).toEqual({ ok: false, message: "There is no blueprint string." });
    expect(readBookText("hello")).toEqual({ ok: false, message: "This is not a blueprint string: it starts with 'h', a blueprint string starts with '0'." });
    expect(readBookText(GAME_BOOK.slice(0, 80))).toEqual({ ok: false, message: "The blueprint string is damaged or incomplete: it cannot be unpacked." });
  });

  it("takes a blueprint as a new item or in the place of one, and keeps the description only of the blueprint the circuit came from", () => {
    const exported = circuitBlueprint(analyze(PLACED).circuit!, []);
    if (!exported.ok) throw new Error("not exported");
    const book = readable(GAME_BOOK);
    const added = writeToBook(book, [1], { type: "add", path: [2] }, exported.blueprint);
    expect(added).toMatchObject({ ok: true, path: [2, 1], book: { ok: true, label: "Probe" } });
    expect(added.ok && added.book.ok && added.book.entries.map((entry) => entry.label)).toEqual(["first", "third", "inner", "inside", "Placed", "belts", "combinators"]);
    const kept = writeToBook(book, [1], { type: "replace", path: [1] }, exported.blueprint);
    expect(kept.ok && itemAt(kept.book.string, [1]).body).toMatchObject({ label: "Placed", description: "The third slot", icons: [{ signal: { type: "virtual", name: "signal-C" }, index: 1 }] });
    const plain = writeToBook(book, [0], { type: "replace", path: [1] }, exported.blueprint);
    expect(plain.ok && itemAt(plain.book.string, [1]).body).not.toHaveProperty("description");
    expect(plain.ok && itemAt(plain.book.string, [1]).body.icons).toEqual(exported.blueprint.icons);
    // The book that was written into is not the one that was read.
    expect(readable(GAME_BOOK).entries).toHaveLength(6);
  });

  it("refuses an edit with a sentence", () => {
    const exported = circuitBlueprint(analyze(PLACED).circuit!, []);
    if (!exported.ok) throw new Error("not exported");
    const book = readable(GAME_BOOK);
    expect(writeToBook(book, undefined, { type: "replace", path: [2] }, exported.blueprint)).toEqual({ ok: false, message: "The item to replace is a blueprint book, not a blueprint." });
    expect(writeToBook(book, undefined, { type: "replace", path: [] }, exported.blueprint)).toEqual({ ok: false, message: "The item to replace is a blueprint book, not a blueprint." });
    expect(writeToBook(book, undefined, { type: "replace", path: [9] }, exported.blueprint)).toEqual({ ok: false, message: "The blueprint book has no such blueprint." });
    expect(writeToBook(book, undefined, { type: "add", path: [0] }, exported.blueprint)).toEqual({ ok: false, message: "The item to add to is a blueprint, not a blueprint book." });
    expect(writeToBook(book, undefined, { type: "add", path: [9] }, exported.blueprint)).toEqual({ ok: false, message: "The blueprint book has no such book." });
    const full = editedBook("0", bookOf("Full", Array.from({ length: 65535 }, () => ({ blueprint: { item: "blueprint" } }))));
    expect(full.ok && writeToBook(full, undefined, { type: "add", path: [] }, exported.blueprint)).toEqual({ ok: false, message: "The blueprint book is full: all of its 65535 slots are taken." });
  });

  it("suggests the file of the book under its label, as a project name is written, or under the name of the project", () => {
    expect(bookFileName(readable(GAME_BOOK), "My project")).toBe("Probe");
    expect(bookFileName(readable(encodeBlueprintString(bookOf(undefined, []))), "My project")).toBe("My project");
    expect(bookFileName(readable(encodeBlueprintString(bookOf(" \n\u0000 ", []))), "My project")).toBe("My project");
    expect(bookFileName(readable(encodeBlueprintString(bookOf(`Line one\nline\ttwo ${"x".repeat(300)}`, []))), "My project")).toBe(`Line one line two ${"x".repeat(182)}`);
  });
});

describe("a project with a book", () => {
  it("shows the book, is unchanged when opened, and saves the book with its origin", async () => {
    const { session, desktop } = sessionWith({ string: GAME_BOOK, origin: [1] });
    expect(session.state.book).toMatchObject({ label: "Probe", origin: [1], originLabel: "third", problem: null, unlisted: 0 });
    expect(session.state.book!.rows).toHaveLength(6);
    expect(session.state).toMatchObject({ error: null, source: PLACED, project: { dirty: false } });
    // The view is the same object while neither the book nor the origin changed.
    const view = session.state.book;
    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 320, y: 80 } }]);
    session.commands.setProjectName("Renamed");
    expect(session.state.book).toBe(view);
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/p")!.book).toEqual({ string: GAME_BOOK, origin: [1] });
    expect(session.state.project.dirty).toBe(false);

    // And comes back from the file as it was.
    const again = createSession(undefined, { api: desktop.api }).session;
    await again.commands.loadProject("/projects/p");
    expect(again.state.book).toEqual(view);
    expect(again.state.project).toMatchObject({ name: "Renamed", dirty: false });
    expect(again.commands.exportBook()).toEqual({ ok: true, string: GAME_BOOK });
  });

  it("without a book has none, and saves the project data it always saved", async () => {
    const { session, desktop } = sessionWith();
    expect(session.state.book).toBeNull();
    type(session, 0, "// mine\n");
    expect(await session.commands.save()).toBe(true);
    expect(Object.keys(desktop.disk.get("/projects/p")!)).toEqual(["manifest", "files"]);
    expect(desktop.disk.get("/projects/p")).toEqual(withBook(undefined, "// mine\n" + PLACED).data);
    // Every command on the book says that there is none, and changes nothing.
    expect(session.commands.chooseFromBook([0])).toEqual({ ok: false, message: NO_BOOK });
    expect(session.commands.exportToBook({ type: "add", path: [] })).toEqual({ ok: false, reason: "book", message: NO_BOOK });
    expect(session.commands.exportBook()).toEqual({ ok: false, message: "The project holds no blueprint book." });
    expect(await session.commands.saveBookFile()).toBe(false);
    expect(session.state.error).toBe(NO_BOOK);
    session.commands.removeBook();
    expect(session.state).toMatchObject({ book: null, canUndo: true, project: { dirty: false } });
    expect(desktop.blueprintExports).toEqual([]);
  });

  it("keeps an origin a file made up as it is, and shows none", async () => {
    const { session, desktop } = sessionWith({ string: GAME_BOOK, origin: [3] });
    expect(session.state).toMatchObject({ book: { origin: null, originLabel: null, problem: null }, project: { dirty: false } });
    type(session, 0, "// mine\n");
    await session.commands.save();
    expect(desktop.disk.get("/projects/p")!.book).toEqual({ string: GAME_BOOK, origin: [3] });
  });

  it.each([
    ["damaged", GAME_BOOK.slice(0, 80), "The blueprint string is damaged or incomplete: it cannot be unpacked."],
    ["no book", encodeBlueprintString(blueprint({ label: "Lamp", entities: [lamp(1, 0)] })), "This is a blueprint, not a blueprint book."],
  ])("opens with a stored string that is %s, says so, keeps the string and offers only to remove it", async (_name, string, reason) => {
    const desktop = fakeDesktop();
    desktop.disk.set("/projects/p", withBook({ string, origin: [0] }).data);
    const { session } = createSession(undefined, { api: desktop.api });
    await session.commands.loadProject("/projects/p");
    const problem = `The blueprint book of this project cannot be read. ${reason} It stays in the project file as it is until it is removed.`;
    expect(session.state).toMatchObject({ error: problem, source: PLACED, editable: true, project: { dirty: false } });
    expect(session.state.book).toEqual({ label: "Blueprint book", rows: [], unlisted: 0, origin: null, originLabel: null, problem });

    expect(session.commands.chooseFromBook([0])).toEqual({ ok: false, message: problem });
    expect(session.commands.exportToBook({ type: "add", path: [] })).toEqual({ ok: false, reason: "book", message: problem });
    expect(session.commands.exportBook()).toEqual({ ok: false, message: problem });
    expect(await session.commands.saveBookFile()).toBe(false);
    expect(desktop.blueprintExports).toEqual([]);
    expect(session.state).toMatchObject({ source: PLACED, canUndo: false, project: { dirty: false } });

    // A save writes it back as it came, with the origin the file had.
    type(session, 0, "// mine\n");
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/p")!.book).toEqual({ string, origin: [0] });

    session.commands.removeBook();
    expect(session.state).toMatchObject({ book: null, source: "// mine\n" + PLACED, project: { dirty: true } });
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/p")).not.toHaveProperty("book");
  });

  it("says what is wrong with the book of the project it starts with", () => {
    const { session } = sessionWith({ string: "0AAAA" });
    expect(session.state.book).toMatchObject({ rows: [], problem: expect.stringContaining("cannot be read.") });
  });

  it("ends with the book of the project that is open, or none, whatever opens", async () => {
    const { session, desktop } = sessionWith({ string: GAME_BOOK, origin: [0] });
    desktop.disk.set("/projects/other", withBook({ string: OTHER_BOOK }).data);
    desktop.disk.set("/projects/plain", withBook().data);
    await session.commands.loadProject("/projects/other");
    expect(session.state.book).toMatchObject({ label: "Other", origin: null });
    await session.commands.loadProject("/projects/plain");
    expect(session.state.book).toBeNull();
    await session.commands.loadProject("/projects/other");
    await session.commands.newProject();
    expect(session.state).toMatchObject({ book: null, project: { dirty: false } });
    await session.commands.loadProject("/projects/other");
    // A single blueprint opens as a project without a book.
    const single = session.commands.readBlueprint(encodeBlueprintString(blueprint({ label: "Lamp", entities: [lamp(1, 0)] })));
    if (single.kind !== "blueprint") throw new Error("not a blueprint");
    expect(single.blueprint).not.toHaveProperty("book");
    expect(await session.commands.openBlueprint(single.blueprint)).toBe(true);
    expect(session.state).toMatchObject({ book: null, project: { name: "Lamp" } });
    await session.commands.save();
    expect(desktop.disk.get("/projects/saved")).not.toHaveProperty("book");
  });
});

describe("importing a book", () => {
  function picked(session: ProjectSession, text: string, path: readonly number[]): ImportedBlueprint {
    const reading = session.commands.readBlueprint(text, path);
    if (reading.kind !== "blueprint") throw new Error(JSON.stringify(reading));
    return reading.blueprint;
  }

  it("opens the chosen blueprint as a project that holds the book, with that blueprint as the origin", async () => {
    const { session, desktop } = sessionWith(undefined, EMPTY_SOURCE);
    const spaced = `${GAME_BOOK.slice(0, 60)}\n${GAME_BOOK.slice(60)}\n`;
    expect(session.commands.readBlueprint(spaced)).toMatchObject({ kind: "book", book: { name: "Probe", book: { string: GAME_BOOK } } });
    const inside = picked(session, spaced, [2, 0]);
    expect(inside.book).toEqual({ string: GAME_BOOK, origin: [2, 0] });
    expect(await session.commands.openBlueprint(inside)).toBe(true);
    expect(session.state).toMatchObject({ displayMode: "blueprint", source: inside.source, canUndo: false, project: { name: "inside", path: null, dirty: true } });
    expect(session.state.book).toMatchObject({ label: "Probe", origin: [2, 0], originLabel: "inside", problem: null });
    // The book is the string the game wrote, byte for byte, in the dialog and in the file.
    expect(session.commands.exportBook()).toEqual({ ok: true, string: GAME_BOOK });
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/saved")).toMatchObject({ manifest: { name: "inside" }, files: [{ source: inside.source }], book: { string: GAME_BOOK, origin: [2, 0] } });
    expect(session.state.project.dirty).toBe(false);
  });

  it("opens a book as a project without a circuit, which is all there is to open of a book the editor can import nothing of", async () => {
    const planners = encodeBlueprintString(bookOf("Planners", [{ upgrade_planner: { item: "upgrade-planner", label: "up" } }, blueprint({ label: "Rails", entities: [rail(1, 0)] })]));
    const { session, desktop } = sessionWith(undefined, PLACED);
    const reading = session.commands.readBlueprint(planners);
    if (reading.kind !== "book") throw new Error(JSON.stringify(reading));
    expect(reading.rows.map((row) => row.importable)).toEqual([false, false]);
    expect(reading.book).toEqual({ name: "Planners", book: { string: planners } });
    expect(await session.commands.openBook(reading.book)).toBe(true);
    expect(desktop.newProjects).toBe(1);
    expect(session.state).toMatchObject({ source: EMPTY_SOURCE, displayMode: "blueprint", canUndo: false, project: { name: "Planners", path: null, dirty: true } });
    expect(session.state.book).toMatchObject({ label: "Planners", origin: null });
    expect(session.state.catalog.modules.filter((module) => module.enabled).map((module) => module.name)).toEqual(createSession(EMPTY_SOURCE).session.state.catalog.modules.filter((module) => module.enabled).map((module) => module.name));
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/saved")!.book).toEqual({ string: planners });

    // Like every import it asks before it replaces unsaved changes.
    type(session, 0, "// mine\n");
    desktop.unsavedChoice = "cancel";
    expect(await session.commands.openBook({ name: "Probe", book: { string: GAME_BOOK } })).toBe(false);
    expect(session.state.book).toMatchObject({ label: "Planners" });
    expect(await createSession().session.commands.openBook(reading.book)).toBe(false);
  });
});

describe("attaching a book", () => {
  it("gives the open project the book, leaves the circuit alone and has no origin", async () => {
    const { session, desktop } = sessionWith(undefined, PLACED);
    expect(session.commands.attachBook(`\n${GAME_BOOK}\n`)).toEqual({ ok: true });
    expect(session.state).toMatchObject({ source: PLACED, canUndo: false, displayMode: "edit", error: null, project: { name: "Test project", path: "/projects/p", dirty: true } });
    expect(session.state.book).toMatchObject({ label: "Probe", origin: null, problem: null });
    expect(stringOf(session)).toBe(GAME_BOOK);
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/p")!.book).toEqual({ string: GAME_BOOK });
    expect(session.state.project.dirty).toBe(false);
  });

  it("replaces the book the project has and clears the origin", () => {
    const { session } = sessionWith({ string: GAME_BOOK, origin: [1] });
    const other = decodeBlueprintString(OTHER_BOOK);
    expect(session.commands.attachBook(JSON.stringify(other.ok && other.data))).toEqual({ ok: true });
    expect(session.state.book).toMatchObject({ label: "Other", origin: null });
    // The stored string of plain JSON is its encoding.
    expect(stringOf(session)).toBe(OTHER_BOOK);
    expect(session.state.project.dirty).toBe(true);
    // The same book again is a book the circuit came from no item of.
    const again = sessionWith({ string: GAME_BOOK, origin: [1] }).session;
    expect(again.commands.attachBook(GAME_BOOK)).toEqual({ ok: true });
    expect(again.state).toMatchObject({ book: { label: "Probe", origin: null }, project: { dirty: true } });
  });

  it("refuses a blueprint, a planner and text that is not readable, and keeps the book the project has", () => {
    const { session } = sessionWith({ string: GAME_BOOK, origin: [1] });
    const view = session.state.book;
    expect(session.commands.attachBook(encodeBlueprintString(blueprint({ entities: [lamp(1, 0)] })))).toEqual({ ok: false, message: "This is a blueprint, not a blueprint book. File > Import Blueprint opens a blueprint as a project." });
    expect(session.commands.attachBook(encodeBlueprintString({ upgrade_planner: { item: "upgrade-planner" } }))).toEqual({ ok: false, message: "This is an upgrade planner, not a blueprint book." });
    expect(session.commands.attachBook("")).toEqual({ ok: false, message: "There is no blueprint string." });
    expect(session.commands.attachBook("not a string")).toMatchObject({ ok: false, message: expect.stringMatching(/^This is not a blueprint string: .*\.$/) });
    expect(session.state.book).toBe(view);
    expect(session.state).toMatchObject({ error: null, project: { dirty: false } });
  });
});

describe("choosing a blueprint of the book", () => {
  it("replaces the circuit as one undo step, sets the origin and shows the blueprint board", () => {
    const { session } = sessionWith({ string: GAME_BOOK, origin: [1] });
    session.commands.select([idOf(session, "gate")]);
    const epoch = session.state.project.epoch;
    expect(session.commands.chooseFromBook([2, 0])).toEqual({ ok: true, name: "inside", report: null });
    expect(session.state).toMatchObject({ source: sourceOf(GAME_BOOK, [2, 0]), displayMode: "blueprint", editable: true, selection: [], canUndo: true, canRedo: false, error: null });
    expect(session.state.circuit.entities.map((entity) => entity.prototype)).toEqual(["constant-combinator"]);
    expect(session.state.book).toMatchObject({ origin: [2, 0], originLabel: "inside" });
    // Name and file of the project stay; the canvas starts over.
    expect(session.state.project).toMatchObject({ name: "Test project", path: "/projects/p", dirty: true, epoch: epoch + 1 });

    // One undo brings the source back, and the origin with it; a redo sets both again.
    session.commands.undo();
    expect(session.state).toMatchObject({ source: PLACED, canUndo: false, canRedo: true, book: { origin: [1], originLabel: "third" }, project: { dirty: false } });
    session.commands.redo();
    expect(session.state).toMatchObject({ source: sourceOf(GAME_BOOK, [2, 0]), book: { origin: [2, 0] }, project: { dirty: true } });
  });

  it("follows the history through several choices and edits", () => {
    const { session } = sessionWith({ string: GAME_BOOK }, PLACED);
    session.commands.chooseFromBook([0]);
    session.commands.moveEntities([{ id: session.state.circuit.entities[0]!.id, position: { x: 200, y: 200 } }]);
    session.commands.chooseFromBook([1]);
    expect(session.state.book).toMatchObject({ origin: [1] });
    session.commands.undo();
    expect(session.state.book).toMatchObject({ origin: [0] });
    session.commands.undo();
    expect(session.state.book).toMatchObject({ origin: [0] });
    session.commands.undo();
    expect(session.state).toMatchObject({ source: PLACED, canUndo: false, book: { origin: null } });
    session.commands.redo();
    session.commands.redo();
    session.commands.redo();
    expect(session.state).toMatchObject({ canRedo: false, book: { origin: [1], originLabel: "third" } });
  });

  it("does not bring back an origin of a book the project no longer holds", () => {
    const { session } = sessionWith({ string: GAME_BOOK }, PLACED);
    session.commands.chooseFromBook([0]);
    session.commands.chooseFromBook([1]);
    session.commands.attachBook(OTHER_BOOK);
    expect(session.state.book).toMatchObject({ label: "Other", origin: null });
    session.commands.undo();
    expect(session.state).toMatchObject({ source: sourceOf(GAME_BOOK, [0]), book: { label: "Other", origin: null } });
    session.commands.removeBook();
    session.commands.attachBook(GAME_BOOK);
    session.commands.redo();
    expect(session.state.book).toMatchObject({ label: "Probe", origin: null });
  });

  it("switches on the modules the circuit needs in addition to those that are on, and reports them", () => {
    const { session } = sessionWith({ string: OTHER_BOOK }, PLACED, ["base", "recycler"]);
    const enabled = (): string[] => session.state.catalog.modules.filter((module) => module.enabled).map((module) => module.name);
    expect(enabled()).toEqual(["base", "recycler"]);
    const choice = session.commands.chooseFromBook([0]);
    if (!choice.ok) throw new Error(choice.message);
    expect(choice.name).toBe("Fiber");
    expect(choice.report).toMatchObject({ summary: "Imported 1 entity and 0 wires.", dropped: [], modules: [expect.stringMatching(/^Switched on: .*Space Age.*\. The blueprint has (its|their) signals or entities; the project had them off\.$/)] });
    expect(enabled()).toEqual(expect.arrayContaining(["base", "recycler", "space-age"]));
    expect(session.state).toMatchObject({ diagnostics: [], project: { modulesOff: [] } });
    expect(session.state.source).toContain("carbon-fiber");
    // The modules are a setting of the project: an undo of the circuit leaves them on.
    session.commands.undo();
    expect(session.state.source).toBe(PLACED);
    expect(enabled()).toContain("space-age");
    // A blueprint that needs nothing more switches nothing and reports what it dropped.
    const rails = session.commands.chooseFromBook([1]);
    expect(rails).toMatchObject({ ok: true, name: "Rails", report: { summary: "Imported 1 of 3 entities and 0 wires.", dropped: ["2 x straight-rail"], modules: [], remarks: ["Not kept from the blueprint itself: tiles."] } });
  });

  it("replaces a source with errors as well", () => {
    const { session } = sessionWith({ string: GAME_BOOK }, PLACED);
    type(session, 0, "oops ");
    expect(session.state.editable).toBe(false);
    expect(session.commands.chooseFromBook([0])).toMatchObject({ ok: true, name: "first" });
    expect(session.state).toMatchObject({ editable: true, source: sourceOf(GAME_BOOK, [0]) });
    session.commands.undo();
    expect(session.state.source).toBe("oops " + PLACED);
  });

  it("refuses what is no blueprint the editor can import, and changes nothing", () => {
    const { session } = sessionWith({ string: GAME_BOOK, origin: [1] });
    const view = session.state.book;
    expect(session.commands.chooseFromBook([2])).toEqual({ ok: false, message: "This is a blueprint book 'inner' with 1 blueprint; choose one of them." });
    expect(session.commands.chooseFromBook([])).toEqual({ ok: false, message: "This is a blueprint book 'Probe' with 3 blueprints; choose one of them." });
    expect(session.commands.chooseFromBook([3])).toEqual({ ok: false, message: "This is an upgrade planner, not a blueprint; the editor imports blueprints only." });
    expect(session.commands.chooseFromBook([9])).toEqual({ ok: false, message: "The blueprint book has no such blueprint." });
    expect(session.state).toMatchObject({ source: PLACED, canUndo: false, displayMode: "edit", error: null, project: { dirty: false } });
    expect(session.state.book).toBe(view);
    const other = sessionWith({ string: OTHER_BOOK }).session;
    expect(other.commands.chooseFromBook([2])).toEqual({ ok: false, message: "This blueprint has no entities." });
    expect(other.state.source).toBe(PLACED);
  });
});

describe("exporting the circuit into the book", () => {
  it("adds it as a new blueprint at the end of the book or of a book inside it, and makes it the origin", async () => {
    const { session, desktop } = sessionWith({ string: GAME_BOOK, origin: [1] });
    expect(session.commands.exportToBook({ type: "add", path: [] })).toEqual({ ok: true, path: [5], warnings: [LAMP_WARNING] });
    expect(session.state.book).toMatchObject({ origin: [5], originLabel: "Placed" });
    expect(session.state.book!.rows.map((row) => row.label)).toEqual(["first", "third", "inner", "inside", "belts", "combinators", "Placed"]);
    // The book is no step of the history, and the project counts as changed.
    expect(session.state).toMatchObject({ source: PLACED, canUndo: false, project: { dirty: true } });
    // The written item is the circuit: it comes back entity for entity, in the slot after the last.
    const string = stringOf(session);
    expect(itemAt(string, [5]).wrapper.index).toBe(6);
    const back = importBlueprintString(string, { select: [5] });
    expect(back.ok && back.circuit).toMatchObject({ name: "Placed", entities: [{ prototype: "constant-combinator" }, { prototype: "decider-combinator" }, { prototype: "small-lamp" }], wires: [{ color: "red" }, { color: "green" }] });
    // Everything else of the book is as the game wrote it.
    for (const path of [[0], [1], [2], [3], [4]]) expect(itemAt(string, path).wrapper, path.join(".")).toEqual(itemAt(GAME_BOOK, path).wrapper);

    expect(session.commands.exportToBook({ type: "add", path: [2] })).toMatchObject({ ok: true, path: [2, 1] });
    expect(session.state.book).toMatchObject({ origin: [2, 1], originLabel: "Placed" });
    expect(itemAt(stringOf(session), [2, 1]).body).toMatchObject({ label: "Placed" });
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/p")!.book).toEqual({ string: stringOf(session), origin: [2, 1] });
    expect(session.state.project.dirty).toBe(false);
  });

  it("replaces a blueprint in its slot, and keeps its description and icons exactly when the circuit came from it", () => {
    const { session } = sessionWith({ string: GAME_BOOK, origin: [1] });
    expect(session.commands.exportToBook({ type: "replace", path: [1] })).toEqual({ ok: true, path: [1], warnings: [LAMP_WARNING] });
    const kept = itemAt(stringOf(session), [1]);
    expect(kept.wrapper.index).toBe(2);
    expect(kept.body).toMatchObject({ label: "Placed", description: "The third slot", icons: [{ signal: { type: "virtual", name: "signal-C" }, index: 1 }] });
    expect(session.state).toMatchObject({ book: { origin: [1], originLabel: "Placed" }, project: { dirty: true } });
    const back = importBlueprintString(stringOf(session), { select: [1] });
    expect(back.ok && back.circuit.entities.map((entity) => entity.prototype)).toEqual(["constant-combinator", "decider-combinator", "small-lamp"]);

    // Over another blueprint nothing of the replaced one stays, and that one is the origin from then on.
    const other = sessionWith({ string: GAME_BOOK, origin: [0] }).session;
    expect(other.commands.exportToBook({ type: "replace", path: [1] })).toMatchObject({ ok: true, path: [1] });
    const plain = itemAt(stringOf(other), [1]);
    expect(plain.body).not.toHaveProperty("description");
    expect(plain.body.icons).not.toEqual(kept.body.icons);
    expect(other.state.book).toMatchObject({ origin: [1] });
    // A second export over it is now over the origin: what the first one wrote stays where the export has nothing of its own.
    expect(other.commands.exportToBook({ type: "replace", path: [1] })).toMatchObject({ ok: true });
    expect(itemAt(stringOf(other), [1]).body.icons).toEqual(plain.body.icons);
    // Without an origin nothing is kept either.
    const none = sessionWith({ string: GAME_BOOK }).session;
    none.commands.exportToBook({ type: "replace", path: [1] });
    expect(itemAt(stringOf(none), [1]).body).not.toHaveProperty("description");
  });

  it("keeps the description of the blueprint a circuit was chosen from", () => {
    const { session } = sessionWith({ string: GAME_BOOK });
    session.commands.chooseFromBook([1]);
    session.commands.moveEntities([{ id: session.state.circuit.entities[0]!.id, position: { x: 200, y: 200 } }]);
    expect(session.commands.exportToBook({ type: "replace", path: [1] })).toEqual({ ok: true, path: [1], warnings: [] });
    expect(itemAt(stringOf(session), [1]).body).toMatchObject({ label: "third", description: "The third slot" });
    // The origin an export set stays through an undo of an edit; an undo of the choice brings back the one before the choice.
    session.commands.exportToBook({ type: "add", path: [] });
    expect(session.state.book).toMatchObject({ origin: [5] });
    session.commands.undo();
    expect(session.state.book).toMatchObject({ origin: [5] });
    session.commands.undo();
    expect(session.state).toMatchObject({ source: PLACED, book: { origin: null } });
    expect(session.state.book!.rows).toHaveLength(7);
  });

  it("returns the problems of the export, and changes nothing, while the circuit cannot become a blueprint", () => {
    const { session } = sessionWith({ string: GAME_BOOK, origin: [1] });
    const view = session.state.book;
    type(session, 0, "oops ");
    expect(session.commands.exportToBook({ type: "add", path: [] })).toEqual({ ok: false, reason: "circuit", problems: [INVALID_SOURCE_PROBLEM] });
    session.commands.undo();
    const unplaced = sessionWith({ string: GAME_BOOK }, PLACED.replace(" tile (3, 0.5)", "")).session;
    // The same problems the export of the circuit as a blueprint gives.
    const direct = unplaced.commands.exportBlueprint();
    const refused = unplaced.commands.exportToBook({ type: "replace", path: [0] });
    expect(refused).toEqual({ ok: false, reason: "circuit", problems: direct.ok ? [] : direct.problems });
    expect(refused).toMatchObject({ problems: [{ code: "no-tile", entities: ["gate"] }] });
    expect(stringOf(unplaced)).toBe(GAME_BOOK);
    expect(session.state.book).toBe(view);
    expect(stringOf(session)).toBe(GAME_BOOK);
    expect(session.state.project.dirty).toBe(false);
  });

  it("gives the refusal of the book as a sentence, and changes nothing", () => {
    const { session } = sessionWith({ string: GAME_BOOK, origin: [1] });
    const view = session.state.book;
    expect(session.commands.exportToBook({ type: "replace", path: [2] })).toEqual({ ok: false, reason: "book", message: "The item to replace is a blueprint book, not a blueprint." });
    expect(session.commands.exportToBook({ type: "replace", path: [4] })).toEqual({ ok: false, reason: "book", message: "The item to replace is a deconstruction planner, not a blueprint." });
    expect(session.commands.exportToBook({ type: "replace", path: [7] })).toEqual({ ok: false, reason: "book", message: "The blueprint book has no such blueprint." });
    expect(session.commands.exportToBook({ type: "add", path: [1] })).toEqual({ ok: false, reason: "book", message: "The item to add to is a blueprint, not a blueprint book." });
    expect(session.commands.exportToBook({ type: "add", path: [2, 5] })).toEqual({ ok: false, reason: "book", message: "The blueprint book has no such book." });
    expect(session.state.book).toBe(view);
    expect(stringOf(session)).toBe(GAME_BOOK);
    expect(session.state).toMatchObject({ error: null, project: { dirty: false } });
  });
});

describe("exporting and removing the book", () => {
  it("gives the stored string byte for byte, and writes it to a file under the label of the book", async () => {
    // Padding and compression are those of whoever wrote the string: nothing is encoded again.
    const padded = encodeBlueprintString(bookOf("Padded", [blueprint({ entities: [lamp(1, 0)] })])).replace(/=+$/, "");
    for (const string of [GAME_BOOK, padded]) {
      const { session, desktop } = sessionWith({ string });
      expect(session.commands.exportBook()).toEqual({ ok: true, string });
      desktop.blueprintPath = null;
      expect(await session.commands.saveBookFile()).toBe(false);
      expect(session.state.error).toBeNull();
      desktop.blueprintPath = "/blueprints/book.txt";
      expect(await session.commands.saveBookFile()).toBe(true);
      expect(desktop.blueprintExports).toEqual([{ name: string === GAME_BOOK ? "Probe" : "Padded", text: string }]);
      expect(session.state.error).toBe("Blueprint book exported to /blueprints/book.txt.");
      // An export saves nothing of the project and changes nothing of it.
      expect(session.state.project.dirty).toBe(false);
      expect(desktop.disk.size).toBe(0);
    }
  });

  it("names the file after the project when the book has no label, and needs the desktop app", async () => {
    const unlabelled = encodeBlueprintString(bookOf(undefined, [blueprint({ entities: [lamp(1, 0)] })]));
    const { session, desktop } = sessionWith({ string: unlabelled });
    expect(await session.commands.saveBookFile()).toBe(true);
    expect(desktop.blueprintExports).toEqual([{ name: "Test project", text: unlabelled }]);
    const refusing = createSession(undefined, { project: withBook({ string: GAME_BOOK }), api: { ...desktop.api, exportBlueprintFile: async () => ({ ok: false, error: "Not a blueprint string" }) } }).session;
    expect(await refusing.commands.saveBookFile()).toBe(false);
    expect(refusing.state.error).toBe("Not a blueprint string");
    const offline = createSession(undefined, { project: withBook({ string: GAME_BOOK }) }).session;
    expect(await offline.commands.saveBookFile()).toBe(false);
    expect(offline.state.error).toBe("Projects can only be opened and saved in the desktop app.");
  });

  it("removes the book and leaves the circuit", async () => {
    const { session, desktop } = sessionWith({ string: GAME_BOOK, origin: [1] });
    session.commands.removeBook();
    expect(session.state).toMatchObject({ book: null, source: PLACED, canUndo: false, project: { dirty: true } });
    expect(session.commands.exportBook()).toEqual({ ok: false, message: NO_BOOK });
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/p")).not.toHaveProperty("book");
    expect(session.state.project.dirty).toBe(false);
    // Attached again it is the book it was, without an origin.
    session.commands.attachBook(GAME_BOOK);
    expect(session.state).toMatchObject({ book: { label: "Probe", origin: null }, project: { dirty: true } });
  });
});
