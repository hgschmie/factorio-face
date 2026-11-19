// What the dialogs of the blueprint book start with and say: the row a choice starts with, where an export goes, the warning
// before a blueprint is overwritten, and the line about the book in the status line. The book of the game is fixture F-30.
import { readFileSync } from "node:fs";
import { encodeBlueprintString } from "@face/blueprints";
import { describe, expect, it } from "vitest";
import { exportedText, initialChoice, initialTarget, isOrigin, overwriteWarning, pathKey, readBookPreview, removeBookText, replacedBookNote, targetOf, targetText } from "../src/blueprint/bookText.ts";
import { importChoice } from "../src/blueprint/BookTree.tsx";
import { bookView, storedBook, type BookView } from "../src/session/book.ts";
import { bookLine } from "../src/workbench/statusText.ts";

const GAME_BOOK = (JSON.parse(readFileSync(new URL("../../../tests/fixtures/game/F-30-blueprint-book.json", import.meta.url), "utf8")) as { readonly book: { readonly string: string } }).book.string;

const VERSION = 562954249109504;
const at = (x: number, y: number) => ({ x, y });
const lamp = (number: number, x: number) => ({ entity_number: number, name: "small-lamp", position: at(x + 0.5, 0.5) });
const rail = (number: number, x: number) => ({ entity_number: number, name: "straight-rail", position: at(x + 0.5, 2.5) });
const blueprint = (body: object) => ({ blueprint: { item: "blueprint", version: VERSION, ...body } });
const bookOf = (label: string, blueprints: readonly object[]) => encodeBlueprintString({ blueprint_book: { item: "blueprint-book", label, blueprints: blueprints.map((item, index) => ({ ...item, index })), active_index: 0, version: VERSION } });

/** Rails only, rails with a lamp on landfill, and one lamp. */
const RAILS_BOOK = bookOf("Rails", [
  blueprint({ label: "Track", entities: [rail(1, 0), rail(2, 2)] }),
  blueprint({ label: "Crossing", entities: [rail(1, 0), rail(2, 2), lamp(3, 0)], tiles: [{ name: "landfill", position: at(0, 0) }, { name: "landfill", position: at(1, 0) }] }),
  blueprint({ label: "Signal", entities: [lamp(1, 0)] }),
]);

const view = (string: string, origin?: readonly number[]): BookView => bookView(storedBook(string), origin);
const row = (book: BookView, label: string) => book.rows.find((candidate) => candidate.label === label)!;

describe("the choice of a blueprint", () => {
  it("starts with the blueprint the circuit came from, and with the first that can be imported when it came from none", () => {
    expect(initialChoice(view(GAME_BOOK))?.label).toBe("first");
    expect(initialChoice(view(GAME_BOOK, [2, 0]))?.label).toBe("inside");
    // The first blueprint of this book has nothing the editor knows.
    expect(initialChoice(view(RAILS_BOOK))?.label).toBe("Crossing");
    expect(initialChoice(view(RAILS_BOOK, [0]))?.label).toBe("Crossing");
    expect(initialChoice(view(bookOf("Tracks", [blueprint({ label: "Track", entities: [rail(1, 0)] })])))).toBeUndefined();
  });

  it("offers the blueprints with an entity the editor knows, shows the others as not on offer and only lists books and planners", () => {
    const book = view(RAILS_BOOK);
    expect(book.rows.map(importChoice)).toEqual(["unavailable", "offered", "offered"]);
    expect(view(GAME_BOOK).rows.map(importChoice)).toEqual(["offered", "offered", "none", "offered", "none", "none"]);
  });

  it("knows the row of the blueprint the circuit came from", () => {
    const book = view(GAME_BOOK, [2, 0]);
    expect(book.rows.filter((candidate) => isOrigin(book, candidate)).map((candidate) => candidate.label)).toEqual(["inside"]);
    expect(view(GAME_BOOK).rows.some((candidate) => isOrigin(view(GAME_BOOK), candidate))).toBe(false);
  });
});

describe("the target of an export into the book", () => {
  it("starts as a new blueprint of the book itself, and over the blueprint the circuit came from when there is one", () => {
    expect(initialTarget(view(GAME_BOOK))).toEqual({ type: "add", path: [] });
    expect(initialTarget(view(GAME_BOOK, [1]))).toEqual({ type: "replace", path: [1] });
    expect(initialTarget(view(GAME_BOOK, [2, 0]))).toEqual({ type: "replace", path: [2, 0] });
    // An origin a file made up names no blueprint, and one beyond the rows cannot be shown: both are none here.
    expect(initialTarget(view(GAME_BOOK, [2]))).toEqual({ type: "add", path: [] });
    const many = view(bookOf("Many", Array.from({ length: 1001 }, (_, index) => blueprint({ label: `b${index}`, entities: [lamp(1, 0)] }))), [1000]);
    expect(many.origin).toEqual([1000]);
    expect(initialTarget(many)).toEqual({ type: "add", path: [] });
  });

  it("is a new blueprint for the book itself and a book inside it, a replacement for a blueprint, and nothing for a planner", () => {
    const { rows } = view(GAME_BOOK);
    expect(pathKey([])).toBe("");
    expect(targetOf(rows, "")).toEqual({ type: "add", path: [] });
    expect(targetOf(rows, "2")).toEqual({ type: "add", path: [2] });
    expect(targetOf(rows, "2.0")).toEqual({ type: "replace", path: [2, 0] });
    expect(targetOf(rows, "1")).toEqual({ type: "replace", path: [1] });
    expect(targetOf(rows, "3")).toBeUndefined();
    expect(targetOf(rows, "9")).toBeUndefined();
  });

  it("is said in a sentence", () => {
    const book = view(GAME_BOOK);
    expect(targetText({ type: "add", path: [] }, undefined)).toBe("The circuit is added as a new blueprint at the end of the book.");
    expect(targetText({ type: "add", path: [2] }, row(book, "inner"))).toBe('The circuit is added as a new blueprint at the end of "inner", a book inside the book.');
    expect(targetText({ type: "replace", path: [1] }, row(book, "third"))).toBe('The circuit takes the place of the blueprint "third". The next step says what is lost by that.');
  });
});

describe("the warning before a blueprint is overwritten", () => {
  const WHOLE = "The whole blueprint is replaced by the circuit of the project: its entities, its wires and its label.";
  const KEPT = "Its description, icons and snapping are kept, because the circuit came from this blueprint.";
  const NOT_KEPT = "Its description, icons and snapping are not kept: the circuit did not come from this blueprint.";
  const NO_UNDO = "Undo does not bring the replaced blueprint back.";

  it("says that the whole blueprint goes, and what of it stays only for the blueprint the circuit came from", () => {
    const book = view(RAILS_BOOK, [2]);
    expect(overwriteWarning(row(book, "Signal"), true)).toEqual([WHOLE, KEPT, NO_UNDO]);
    expect(overwriteWarning(row(book, "Signal"), false)).toEqual([WHOLE, NOT_KEPT, NO_UNDO]);
  });

  it("counts the entities and the tiles the editor does not hold", () => {
    const book = view(RAILS_BOOK);
    expect(overwriteWarning(row(book, "Crossing"), false)).toEqual([WHOLE, "2 entities and 2 tiles that the editor does not hold are gone from it.", NOT_KEPT, NO_UNDO]);
    expect(overwriteWarning(row(book, "Track"), true)[1]).toBe("2 entities that the editor does not hold are gone from it.");
    expect(overwriteWarning({ lost: { entities: 1, tiles: 0 } }, false)[1]).toBe("1 entity that the editor does not hold is gone from it.");
    expect(overwriteWarning({ lost: { entities: 0, tiles: 1 } }, false)[1]).toBe("1 tile that the editor does not hold is gone from it.");
    expect(overwriteWarning({ lost: { entities: 1, tiles: 1 } }, false)[1]).toBe("1 entity and 1 tile that the editor does not hold are gone from it.");
  });
});

describe("what the dialogs say about a book", () => {
  it("names the book and the blueprint after an export", () => {
    const { rows } = view(GAME_BOOK);
    expect(exportedText({ label: "Probe", rows, origin: [6], originLabel: "Placed" }, null)).toBe('The circuit was added to the book "Probe" as the blueprint "Placed".');
    expect(exportedText({ label: "Probe", rows, origin: null, originLabel: null }, null)).toBe('The circuit was added to the book "Probe" as a new blueprint.');
    expect(exportedText({ label: "Probe", rows, origin: [1], originLabel: "Placed" }, "third")).toBe('The circuit was written over the blueprint "third" of the book "Probe". It is now "Placed".');
    expect(exportedText({ label: "Probe", rows, origin: [1], originLabel: "third" }, "third")).toBe('The circuit was written over the blueprint "third" of the book "Probe".');
    // In a book inside the book, that book is named.
    expect(exportedText({ label: "Probe", rows, origin: [2, 1], originLabel: "Placed" }, null)).toBe('The circuit was added to "inner", a book inside the book "Probe", as the blueprint "Placed".');
    expect(exportedText({ label: "Probe", rows, origin: [2, 0], originLabel: "inside" }, "inside")).toBe('The circuit was written over the blueprint "inside" of "inner", a book inside the book "Probe".');
  });

  it("names the book another one replaces, and the book that is removed", () => {
    const unreadable = view("0not a book");
    expect(unreadable.problem).not.toBeNull();
    expect(replacedBookNote(null)).toBeNull();
    expect(replacedBookNote(view(GAME_BOOK))).toBe('This replaces the blueprint book "Probe" of the project. Blueprints that were written into it and not exported are lost with it; Undo does not bring it back.');
    expect(replacedBookNote(unreadable)).toBe("This replaces the blueprint book of the project, which cannot be read.");
    expect(removeBookText(view(GAME_BOOK))).toBe('Remove the blueprint book "Probe" from the project?');
    expect(removeBookText(unreadable)).toBe("Remove the blueprint book that cannot be read from the project?");
  });

  it("reads a text as the book it would attach, or says why it is none in the words of the session", () => {
    expect(readBookPreview(`${GAME_BOOK.slice(0, 40)}\n${GAME_BOOK.slice(40)}`)).toEqual(view(GAME_BOOK));
    expect(readBookPreview(encodeBlueprintString(blueprint({ label: "One", entities: [lamp(1, 0)] })))).toBe("This is a blueprint, not a blueprint book. File > Import Blueprint opens a blueprint as a project.");
    expect(readBookPreview("nothing")).toMatch(/^This is not a blueprint string/);
  });
});

describe("the book in the status line", () => {
  it("names the book and the blueprint the circuit came from", () => {
    expect(bookLine(view(GAME_BOOK, [1]))).toEqual({
      label: "Book: Probe",
      origin: "Blueprint: third",
      title: 'The project holds the blueprint book "Probe". The circuit came from its blueprint "third", or was last exported to it. Press to choose a blueprint of the book.',
    });
    expect(bookLine(view(GAME_BOOK))).toEqual({ label: "Book: Probe", origin: null, title: 'The project holds the blueprint book "Probe". The circuit came from none of its blueprints. Press to choose a blueprint of the book.' });
  });

  it("says that a book cannot be read, with the problem as its tooltip", () => {
    const unreadable = view("0not a book");
    expect(bookLine(unreadable)).toEqual({ label: "Book cannot be read", origin: null, title: unreadable.problem });
  });
});
