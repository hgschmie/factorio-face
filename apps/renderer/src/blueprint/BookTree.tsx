// The items of a blueprint book as a list in the order and the nesting of the book: what the import dialog chooses a blueprint
// from, and what the dialogs of the book of a project show. A row that can be chosen is a radio button; the rest is listed.
// Labels are untrusted text, bounded by the session and rendered as text.
import { useId } from "react";
import type { BookRow } from "../session/blueprints.ts";
import { pathKey } from "./bookText.ts";

/** A row as a choice: on offer, shown as one that is not (a blueprint the editor knows nothing of), or no choice at all (a planner). */
export type RowChoice = "offered" | "unavailable" | "none";

/** The choice of a blueprint to open: every blueprint is one, on offer when the editor knows an entity of it. */
export const importChoice = (row: BookRow): RowChoice => (row.kind !== "blueprint" ? "none" : row.importable ? "offered" : "unavailable");

export interface BookTreeProps {
  /** The accessible name of the list. */
  readonly label: string;
  readonly rows: readonly BookRow[];
  /** The book itself as a first row that can be chosen, with its items one step in. Its key is "". */
  readonly root?: { readonly label: string; readonly detail: string };
  /** The key of the chosen row (`pathKey`). */
  readonly chosen?: string;
  /** The blueprint the circuit of the project came from: its row says so. */
  readonly origin?: readonly number[] | null;
  /** What each row is as a choice. Without it the list only shows the book. */
  choice?(row: BookRow): RowChoice;
  onChoose?(key: string): void;
}

export function BookTree({ label, rows, root, chosen, origin, choice, onChoose }: BookTreeProps) {
  const group = useId();
  const originKey = origin ? pathKey(origin) : undefined;
  const line = (key: string, kind: string, depth: number, text: string, detail: string, state: RowChoice) => {
    const content = (
      <>
        <span className="book-label">{text}</span>
        {key === originKey && (
          <span className="note-kind" data-mark="origin">
            Circuit came from here
          </span>
        )}
        <small>{detail}</small>
      </>
    );
    return (
      <li key={key} data-kind={kind} data-path={key} style={{ paddingLeft: depth * 18 }}>
        {state === "none" ? (
          <div>{content}</div>
        ) : (
          <label className={state === "unavailable" ? "unavailable" : undefined}>
            <input type="radio" name={group} checked={key === chosen} disabled={state === "unavailable"} onChange={() => onChoose?.(key)} />
            {content}
          </label>
        )}
      </li>
    );
  };
  return (
    <div role={choice ? "radiogroup" : "group"} aria-label={label}>
      <ul className="book-list">
        {root && line("", "book", 0, root.label, root.detail, "offered")}
        {rows.map((row) => line(pathKey(row.path), row.kind, row.depth + (root ? 1 : 0), row.label, row.detail, choice?.(row) ?? "none"))}
      </ul>
    </div>
  );
}
