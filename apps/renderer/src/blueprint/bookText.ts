// What the dialogs of the blueprint book start with and say: the row that is chosen when one opens, where an export goes, what
// overwriting a blueprint destroys. Labels of a book are untrusted text that the session has bounded; here they only become
// part of sentences, which are rendered as text. Pure.
import type { BookRow } from "../session/blueprints.ts";
import { bookView, readBookText, type BookTarget, type BookView } from "../session/book.ts";

/** A path as the key of its row in a list; "" is the book itself. */
export const pathKey = (path: readonly number[]): string => path.join(".");

const count = (amount: number, one: string, many = `${one}s`): string => `${amount} ${amount === 1 ? one : many}`;

/** True for the row of the blueprint the circuit of the project came from. */
export function isOrigin(book: Pick<BookView, "origin">, row: Pick<BookRow, "path">): boolean {
  return book.origin !== null && pathKey(book.origin) === pathKey(row.path);
}

/** What a text holds as a blueprint book, as the workbench shows a book (without an origin); or why it is none, as a sentence. */
export function readBookPreview(text: string): BookView | string {
  const read = readBookText(text);
  return read.ok ? bookView(read.book, undefined) : read.message;
}

/** The blueprint the choice of one starts with: the one the circuit came from when it can be imported, otherwise the first that can. */
export function initialChoice(book: Pick<BookView, "rows" | "origin">): BookRow | undefined {
  const importable = book.rows.filter((row) => row.importable);
  return importable.find((row) => isOrigin(book, row)) ?? importable[0];
}

/**
 * Where an export into the book goes when its dialog opens: over the blueprint the circuit came from, and as a new blueprint of
 * the book itself when it came from none (or from one beyond the rows, which the dialog cannot show).
 */
export function initialTarget(book: Pick<BookView, "rows" | "origin">): BookTarget {
  const from = book.rows.find((row) => row.replaceable && isOrigin(book, row));
  return from ? { type: "replace", path: from.path } : { type: "add", path: [] };
}

/** What choosing the row with `key` means for an export: "" is the book itself, a book takes a new blueprint, a blueprint is overwritten. Undefined for a planner and for no row. */
export function targetOf(rows: readonly BookRow[], key: string): BookTarget | undefined {
  if (key === "") return { type: "add", path: [] };
  const row = rows.find((candidate) => pathKey(candidate.path) === key);
  return row?.addable ? { type: "add", path: row.path } : row?.replaceable ? { type: "replace", path: row.path } : undefined;
}

/** What the chosen target does, in a sentence. `row` is the row of the target; undefined for the book itself. */
export function targetText(target: BookTarget, row: Pick<BookRow, "label"> | undefined): string {
  if (target.type === "replace") return `The circuit takes the place of the blueprint "${row?.label ?? ""}". The next step says what is lost by that.`;
  return row ? `The circuit is added as a new blueprint at the end of "${row.label}", a book inside the book.` : "The circuit is added as a new blueprint at the end of the book.";
}

/**
 * What overwriting a blueprint of the book with the circuit destroys, as sentences. `fromHere`: it is the blueprint the circuit
 * came from, which is when the session keeps its description, icons and snapping.
 */
export function overwriteWarning(row: Pick<BookRow, "lost">, fromHere: boolean): string[] {
  const { entities, tiles } = row.lost;
  const lost = [...(entities > 0 ? [count(entities, "entity", "entities")] : []), ...(tiles > 0 ? [count(tiles, "tile")] : [])];
  return [
    "The whole blueprint is replaced by the circuit of the project: its entities, its wires and its label.",
    ...(lost.length > 0 ? [`${lost.join(" and ")} that the editor does not hold ${entities + tiles === 1 ? "is" : "are"} gone from it.`] : []),
    `Its description, icons and snapping are ${fromHere ? "kept, because the circuit came from this blueprint" : "not kept: the circuit did not come from this blueprint"}.`,
    "Undo does not bring the replaced blueprint back.",
  ];
}

/** The book inside the book that the blueprint the circuit came from stands in; undefined when it stands in the book itself. */
function innerBook(book: Pick<BookView, "origin" | "rows">): BookRow | undefined {
  if (book.origin === null || book.origin.length < 2) return undefined;
  const parent = pathKey(book.origin.slice(0, -1));
  return book.rows.find((row) => pathKey(row.path) === parent);
}

/** What an export into the book did. `replaced` is the label the overwritten blueprint had; null for a new blueprint. `book` is the book afterwards, whose origin is the written blueprint. */
export function exportedText(book: Pick<BookView, "label" | "origin" | "originLabel" | "rows">, replaced: string | null): string {
  const now = book.originLabel;
  const inner = innerBook(book);
  const holder = inner ? `"${inner.label}", a book inside the book "${book.label}"` : `the book "${book.label}"`;
  if (replaced === null) return `The circuit was added to ${holder}${inner ? "," : ""} as ${now === null ? "a new blueprint" : `the blueprint "${now}"`}.`;
  return `The circuit was written over the blueprint "${replaced}" of ${holder}.${now !== null && now !== replaced ? ` It is now "${now}".` : ""}`;
}

/** Which book a new one replaces, said before it does; null for a project without a book. */
export function replacedBookNote(current: Pick<BookView, "label" | "problem"> | null): string | null {
  if (current === null) return null;
  if (current.problem !== null) return "This replaces the blueprint book of the project, which cannot be read.";
  return `This replaces the blueprint book "${current.label}" of the project. Blueprints that were written into it and not exported are lost with it; Undo does not bring it back.`;
}

/** The question of the dialog that removes the book. */
export function removeBookText(book: Pick<BookView, "label" | "problem">): string {
  return book.problem !== null ? "Remove the blueprint book that cannot be read from the project?" : `Remove the blueprint book "${book.label}" from the project?`;
}
