// The blueprint book a project holds: the string as the game wrote it, decoded once, what the window shows of it, and the three
// things done with it: a text becomes the book, a blueprint of it becomes the circuit, the circuit is written into it. The format
// and the edits themselves are in @face/blueprints. Pure; the session keeps the book and applies the results.
import { addToBook, canonicalBlueprintString, decodeBlueprintString, inspectBlueprint, ITEM_WORDS, replaceInBook, type Blueprint, type BlueprintInspection, type BookEntry } from "@face/blueprints";
import { BOOK_ROWS, bookRows, importedProjectName, itemLabel, sentence, type BlueprintProblem, type BookRow, type ImportReportView } from "./blueprints.ts";

/** The stored string of a book, decoded. One that does not decode or is no book is kept as it is, with what is wrong. */
export type StoredBook = ReadableBook | { readonly ok: false; readonly string: string; readonly problem: string };

export interface ReadableBook {
  readonly ok: true;
  readonly string: string;
  /** The decoded object of `string`: what `addToBook` and `replaceInBook` take, and an import with `select`. */
  readonly data: unknown;
  /** The label as the book has it: any text, "" without one. */
  readonly label: string;
  readonly entries: readonly BookEntry[];
}

/** What the workbench shows of the book of the project. */
export interface BookView {
  /** The label of the book, bounded like every text of a blueprint; "Blueprint book without a label" without one. */
  readonly label: string;
  /** The first `BOOK_ROWS` items in the order and the nesting of the book; none while there is a `problem`. */
  readonly rows: readonly BookRow[];
  /** How many items the book has beyond the rows (`unlistedNote` says it in words). */
  readonly unlisted: number;
  /**
   * The path of the blueprint the circuit of the project came from or was last written to (`BookRow.path`); null when it came
   * from none, or when the book has no blueprint there. It may name a blueprint beyond the rows.
   */
  readonly origin: readonly number[] | null;
  /** The label of that blueprint as a row shows it; null without an origin. */
  readonly originLabel: string | null;
  /**
   * What is wrong with the stored string, as sentences: it does not decode, or it is no book (a damaged or a foreign project
   * file). The string stays in the project and is saved with it; of the commands only `removeBook` does something then.
   */
  readonly problem: string | null;
}

/** Where an export of the circuit goes in the book. A path is what `BookRow.path` is; `[]` is the book itself. */
export type BookTarget =
  /** As a new blueprint at the end of the book at `path`: the book itself, or a row that is `addable`. */
  | { readonly type: "add"; readonly path: readonly number[] }
  /** In the place of the blueprint at `path`: a row that is `replaceable`. Of the blueprint that was there, what `BookRow.lost` counts is gone. */
  | { readonly type: "replace"; readonly path: readonly number[] };

export type BookExport =
  /** `path` is where the blueprint stands now, which is the new origin; `warnings` are those of the export of the circuit. */
  | { readonly ok: true; readonly path: readonly number[]; readonly warnings: readonly string[] }
  /** The circuit cannot become a blueprint: the problems `exportBlueprint` gives. */
  | { readonly ok: false; readonly reason: "circuit"; readonly problems: readonly BlueprintProblem[] }
  /** The book did not take it (no book, no such item, the book is full, its string would be too long), as a sentence. */
  | { readonly ok: false; readonly reason: "book"; readonly message: string };

/** Whether a command on the book did what it says, and why not, as a sentence for a dialog. */
export type BookResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export type BookChoice =
  /** `name` is the label of the blueprint ("Imported blueprint" without one) and `report` what the import left out, changed or switched on; null when nothing. */
  | { readonly ok: true; readonly name: string; readonly report: ImportReportView | null }
  | { readonly ok: false; readonly message: string };

export type BookStringExport = { readonly ok: true; readonly string: string } | { readonly ok: false; readonly message: string };

export const NO_BOOK = "The project holds no blueprint book.";

const notABook = (inspection: Exclude<BlueprintInspection, { kind: "book" }>): string => (inspection.kind === "unknown" ? "This is not a blueprint book." : `This is ${ITEM_WORDS[inspection.kind]}, not a blueprint book.`);

/** The book that decoded `data` is, with `string` as its blueprint string; or what `data` is instead, as a sentence. */
function bookOf(string: string, data: unknown): ReadableBook | string {
  const inspection = inspectBlueprint(data);
  return inspection.kind === "book" ? { ok: true, string, data, label: inspection.label, entries: inspection.entries } : notABook(inspection);
}

/** The book of a project from its stored string. Never throws: the string comes from a file. */
export function storedBook(string: string): StoredBook {
  const decoded = decodeBlueprintString(string);
  const book = decoded.ok ? bookOf(string, decoded.data) : sentence(decoded.message);
  return typeof book === "string" ? { ok: false, string, problem: `The blueprint book of this project cannot be read. ${book} It stays in the project file as it is until it is removed.` } : book;
}

/** The book after an edit: `string` and `data` are the result of `addToBook` or `replaceInBook` on a book. */
export function editedBook(string: string, data: unknown): StoredBook {
  const book = bookOf(string, data);
  return typeof book === "string" ? { ok: false, string, problem: book } : book;
}

/**
 * The book a text holds, pasted or read from a file, as a project keeps it: the string is the text without its blanks, and for
 * plain JSON its encoding (`canonicalBlueprintString`). A single blueprint, a planner and text that is no blueprint string are
 * refused with a sentence.
 */
export function readBookText(text: string): { readonly ok: true; readonly book: ReadableBook } | { readonly ok: false; readonly message: string } {
  const canonical = canonicalBlueprintString(text);
  if (!canonical.ok) return { ok: false, message: sentence(canonical.message) };
  const book = bookOf(canonical.string, canonical.data);
  if (typeof book !== "string") return { ok: true, book };
  return { ok: false, message: inspectBlueprint(canonical.data).kind === "blueprint" ? `${book} File > Import Blueprint opens a blueprint as a project.` : book };
}

const samePath = (a: readonly number[], b: readonly number[] | undefined): boolean => b !== undefined && a.length === b.length && a.every((position, index) => position === b[index]);

/** What the workbench shows of a stored book. `origin` is the origin the project has, which a file may have made up. */
export function bookView(book: StoredBook, origin: readonly number[] | undefined): BookView {
  if (!book.ok) return { label: "Blueprint book", rows: [], unlisted: 0, origin: null, originLabel: null, problem: book.problem };
  const from = book.entries.find((entry) => entry.kind === "blueprint" && samePath(entry.path, origin));
  return {
    label: itemLabel("book", book.label),
    rows: bookRows(book.entries),
    unlisted: Math.max(0, book.entries.length - BOOK_ROWS),
    origin: from ? from.path : null,
    originLabel: from ? itemLabel("blueprint", from.label) : null,
    problem: null,
  };
}

/**
 * The book with `blueprint` (of an export of the circuit) written to `target`. Over the blueprint the circuit came from
 * (`origin`) the description, the icons and the snapping of that blueprint stay (`keep` of `replaceInBook`); over any other
 * nothing of the replaced one does. The message of a refusal is a sentence.
 */
export function writeToBook(book: ReadableBook, origin: readonly number[] | undefined, target: BookTarget, blueprint: Blueprint): { readonly ok: true; readonly book: StoredBook; readonly path: readonly number[] } | { readonly ok: false; readonly message: string } {
  const edit = target.type === "add" ? addToBook(book.data, target.path, blueprint) : replaceInBook(book.data, target.path, blueprint, { keep: samePath(target.path, origin) });
  return edit.ok ? { ok: true, book: editedBook(edit.string, edit.data), path: edit.path } : { ok: false, message: sentence(edit.message) };
}

/** The name a file of the book is suggested under: its label as a project name is written (one line, bounded), or the name of the project without one. */
export function bookFileName(book: ReadableBook, projectName: string): string {
  return importedProjectName(book.label, projectName);
}
