// The dialogs of the blueprint book a project holds: choosing a blueprint of it as the circuit, giving the project a book from a
// pasted string or a file, writing the circuit into it, removing it, and what is said when a command needs a book and the
// project has none, or one that cannot be read. Presentational: the book and every change of it are the session's.
import { useDeferredValue, useMemo, useState } from "react";
import type { BlueprintFileText } from "../../../desktop/src/ipc.ts";
import { Modal } from "../dialog/Modal.tsx";
import { unlistedNote, type BookRow } from "../session/blueprints.ts";
import { NO_BOOK, type BookChoice, type BookResult, type BookTarget, type BookView } from "../session/book.ts";
import { exportedText, initialChoice, initialTarget, isOrigin, overwriteWarning, pathKey, removeBookText, replacedBookNote, targetOf, targetText } from "./bookText.ts";
import { BookTree, importChoice, type RowChoice } from "./BookTree.tsx";
import { ExportWarnings } from "./ExportBlueprint.tsx";

const Failure = ({ message }: { readonly message: string | undefined }) =>
  message === undefined ? null : (
    <p className="settings-message error" role="alert" data-message="error">
      {message}
    </p>
  );

export interface ChooseFromBookProps {
  readonly book: BookView;
  /** Replaces the circuit by the blueprint at `path`. Its owner closes the dialog when that is done; a refusal is shown here. */
  choose(path: readonly number[]): BookChoice;
  close(): void;
}

export function ChooseFromBook({ book, choose, close }: ChooseFromBookProps) {
  const [chosen, setChosen] = useState(() => {
    const first = initialChoice(book);
    return first && pathKey(first.path);
  });
  const [failure, setFailure] = useState<string>();
  const entry = book.rows.find((row) => row.importable && pathKey(row.path) === chosen);

  const run = (): void => {
    if (!entry) return;
    const choice = choose(entry.path);
    if (!choice.ok) setFailure(choice.message);
  };

  return (
    <Modal title="Choose blueprint" closeLabel="Close blueprint choice" className="blueprint-dialog choose-blueprint" close={close}>
      <p className="blueprint-summary" data-message="book">
        Blueprint book "{book.label}": choose the blueprint to work on.
      </p>
      {book.rows.length > 0 && (
        <BookTree
          label="Blueprints of the book"
          rows={book.rows}
          chosen={chosen}
          origin={book.origin}
          choice={importChoice}
          onChoose={(key) => {
            setChosen(key);
            setFailure(undefined);
          }}
        />
      )}
      {book.unlisted > 0 && <p className="muted-note">{unlistedNote(book.unlisted)}</p>}
      <Failure message={entry ? failure : "No blueprint of this book has an entity the editor knows, so there is nothing to choose."} />
      <p className="muted-note" data-message="note">
        The chosen blueprint replaces the circuit of the project; Undo brings the circuit back. The name and the file of the project stay. Entity names, comments and edit positions
        are not part of a book: the entities get new names.
      </p>
      <div className="dialog-actions">
        <button type="button" className="settings-button primary-button" data-autofocus disabled={!entry} onClick={run}>
          Replace Circuit
        </button>
        <button type="button" className="settings-button" data-autofocus={entry ? undefined : true} onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export interface AttachBookProps {
  /** A file the user chose: its text is read in place of a pasted one, and there is no text box. */
  readonly file?: BlueprintFileText;
  /** The book the project holds, which the new one replaces; null without one. */
  readonly current: BookView | null;
  /** What a text holds as a blueprint book, or why it is none, as a sentence. It changes nothing. */
  read(text: string): BookView | string;
  /** Makes the book of the text the book of the project. Its owner closes the dialog when that is done; a refusal is shown here. */
  attach(text: string): BookResult;
  close(): void;
}

export function AttachBook({ file, current, read, attach, close }: AttachBookProps) {
  const [pasted, setPasted] = useState("");
  const [failure, setFailure] = useState<string>();
  const text = file?.text ?? pasted;
  // Reading a long string takes a moment, which typing does not wait for.
  const shown = useDeferredValue(text);
  const reading = useMemo(() => (file || shown.trim() !== "" ? read(shown) : undefined), [file, shown, read]);
  const found = typeof reading === "object" ? reading : undefined;
  const replaced = replacedBookNote(current);

  const run = (): void => {
    const result = attach(text);
    if (!result.ok) setFailure(result.message);
  };

  return (
    <Modal title={file ? "Load blueprint book" : "Paste blueprint book string"} closeLabel="Close blueprint book" className="blueprint-dialog attach-book" close={close}>
      {file ? (
        <p className="blueprint-file">
          File <span className="path">{file.name}</span>
        </p>
      ) : (
        <label className="blueprint-text">
          <span className="section-label">Blueprint book string</span>
          <textarea
            data-autofocus
            rows={7}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={typeof reading === "string"}
            placeholder="Paste the string of a blueprint book here: in the game, a book shows it under Export string."
            onChange={(event) => {
              setPasted(event.target.value);
              setFailure(undefined);
            }}
          />
        </label>
      )}
      <Failure message={typeof reading === "string" ? reading : undefined} />
      {found && (
        <>
          <p className="blueprint-summary" role="status" data-message="book">
            This is the blueprint book "{found.label}"{found.rows.length === 0 ? ". It has no items." : "."}
          </p>
          {found.rows.length > 0 && <BookTree label="Items of the book" rows={found.rows} />}
          {found.unlisted > 0 && <p className="muted-note">{unlistedNote(found.unlisted)}</p>}
        </>
      )}
      {replaced !== null && (
        <p className="settings-message" role="note" data-message="replaces">
          {replaced}
        </p>
      )}
      <Failure message={failure} />
      <p className="muted-note">
        The book is kept in the project and saved with it. The circuit of the project stays as it is; File &gt; Blueprint Book &gt; Choose Blueprint opens a blueprint of the book.
      </p>
      <div className="dialog-actions">
        <button type="button" className="settings-button primary-button" data-autofocus={file ? true : undefined} disabled={!found || shown !== text} onClick={run}>
          {current ? "Replace Book" : "Attach Book"}
        </button>
        <button type="button" className="settings-button" data-autofocus={file && !found ? true : undefined} onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** For an export every book takes a new blueprint and every blueprint can be overwritten; a planner is only listed. */
const exportChoice = (row: BookRow): RowChoice => (row.addable || row.replaceable ? "offered" : "none");

export interface ExportToBookProps {
  readonly book: BookView;
  /**
   * Writes the circuit into the book; `replaced` is the label of the blueprint it overwrites, null for a new one. Its owner goes
   * on from there when it is written, or when the circuit cannot become a blueprint. Returns the refusal of the book, as a sentence.
   */
  write(target: BookTarget, replaced: string | null): string | undefined;
  close(): void;
}

/** Where the circuit goes in the book, and for a blueprint that is overwritten a second step that says what that destroys. */
export function ExportToBook({ book, write, close }: ExportToBookProps) {
  const [chosen, setChosen] = useState(() => pathKey(initialTarget(book).path));
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string>();
  const target = targetOf(book.rows, chosen);
  const row = chosen === "" ? undefined : book.rows.find((candidate) => pathKey(candidate.path) === chosen);

  const run = (): void => {
    if (target) setFailure(write(target, target.type === "replace" && row ? row.label : null));
  };

  // Each step is a dialog of its own (`key`), so that the focus starts where that step wants it.
  if (confirming && row && target?.type === "replace") {
    return (
      <Modal key="confirm" title="Overwrite blueprint" closeLabel="Close overwrite confirmation" className="blueprint-dialog overwrite-blueprint" close={close}>
        <p className="blueprint-summary" data-message="overwrite">
          Overwrite the blueprint "{row.label}" of the book "{book.label}" with the circuit of the project?
        </p>
        <ul className="report-list warnings" aria-label="What overwriting does">
          {overwriteWarning(row, isOrigin(book, row)).map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
        <Failure message={failure} />
        <div className="dialog-actions">
          <button type="button" className="settings-button danger-button" onClick={run}>
            Overwrite
          </button>
          <button
            type="button"
            className="settings-button"
            data-autofocus
            onClick={() => {
              setConfirming(false);
              setFailure(undefined);
            }}
          >
            Back
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal key="target" title="Export to blueprint book" closeLabel="Close export to blueprint book" className="blueprint-dialog export-to-book" close={close}>
      <p className="blueprint-summary" data-message="book">
        Choose where the circuit goes in the book "{book.label}": the book itself or a book inside it to add it as a new blueprint, or a blueprint to overwrite.
      </p>
      <BookTree
        label="Items of the book"
        root={{ label: book.label, detail: "The book itself" }}
        rows={book.rows}
        chosen={chosen}
        origin={book.origin}
        choice={exportChoice}
        onChoose={(key) => {
          setChosen(key);
          setFailure(undefined);
        }}
      />
      {book.unlisted > 0 && <p className="muted-note">{unlistedNote(book.unlisted)}</p>}
      {target && (
        <p className="blueprint-summary" role="status" data-message="target">
          {targetText(target, row)}
        </p>
      )}
      <Failure message={failure} />
      <p className="muted-note">The book is saved with the project. It is no part of Undo: a blueprint that was written into it stays there.</p>
      <div className="dialog-actions">
        <button type="button" className="settings-button primary-button" data-autofocus disabled={!target} onClick={target?.type === "replace" ? () => setConfirming(true) : run}>
          {target?.type === "replace" ? "Overwrite..." : "Add to Book"}
        </button>
        <button type="button" className="settings-button" onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export interface BookExportedProps {
  /** The book after the export: its origin is the blueprint that was written. */
  readonly book: BookView;
  /** The label the overwritten blueprint had; null for a new blueprint. */
  readonly replaced: string | null;
  /** The warnings of the export of the circuit. */
  readonly warnings: readonly string[];
  close(): void;
}

export function BookExported({ book, replaced, warnings, close }: BookExportedProps) {
  return (
    <Modal title="Exported to blueprint book" closeLabel="Close export confirmation" className="blueprint-dialog book-exported" close={close}>
      <p className="blueprint-summary" role="status" data-message="exported">
        {exportedText(book, replaced)}
      </p>
      <ExportWarnings warnings={warnings} />
      <p className="muted-note">The book is saved with the project. It goes to the game through File &gt; Blueprint Book: Export As File or Show Book String.</p>
      <div className="dialog-actions">
        <button type="button" className="settings-button" data-autofocus onClick={close}>
          OK
        </button>
      </div>
    </Modal>
  );
}

export interface RemoveBookProps {
  readonly book: BookView;
  /** Takes the book out of the project. Its owner closes the dialog. */
  remove(): void;
  close(): void;
}

export function RemoveBook({ book, remove, close }: RemoveBookProps) {
  return (
    <Modal title="Remove blueprint book" closeLabel="Close book removal" className="blueprint-dialog remove-book" close={close}>
      <p className="blueprint-summary" data-message="remove">
        {removeBookText(book)}
      </p>
      <Failure message={book.problem ?? undefined} />
      <p className="muted-note">
        The circuit stays as it is. Blueprints that were written into the book and not exported are lost with it: Undo does not bring the book back.
        {book.problem === null && " File > Blueprint Book exports it first, as a file or as a string."}
      </p>
      <div className="dialog-actions">
        <button type="button" className="settings-button danger-button" onClick={remove}>
          Remove Book
        </button>
        <button type="button" className="settings-button" data-autofocus onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export interface BookUnavailableProps {
  /** What is wrong with the book of the project; null when the project holds none. */
  readonly problem: string | null;
  /** Load Book From File and Paste Book of the menu. */
  loadFile(): void;
  paste(): void;
  /** Goes on to the removal of the book that cannot be read. */
  remove(): void;
  close(): void;
}

/** The answer to a command that needs a blueprint book while the project has none, or one that cannot be read: what is the matter and how to get a book. */
export function BookUnavailable({ problem, loadFile, paste, remove, close }: BookUnavailableProps) {
  return (
    <Modal title={problem === null ? "No blueprint book" : "Blueprint book cannot be read"} closeLabel="Close blueprint book message" className="blueprint-dialog book-unavailable" close={close}>
      {problem === null ? (
        <p className="blueprint-summary" data-message="no-book">
          {NO_BOOK} File &gt; Blueprint Book &gt; Load Book From File or Paste Book gives it one and leaves the circuit alone; File &gt; Import Blueprint opens a book of the game as a new project.
        </p>
      ) : (
        <>
          <Failure message={problem} />
          <p className="muted-note">The book can be removed from the project, or replaced by another one from a file or a pasted string.</p>
        </>
      )}
      <div className="dialog-actions">
        {problem !== null && (
          <button type="button" className="settings-button" onClick={remove}>
            Remove Book...
          </button>
        )}
        <button type="button" className="settings-button" onClick={loadFile}>
          Load Book From File...
        </button>
        <button type="button" className="settings-button" onClick={paste}>
          Paste Book...
        </button>
        <button type="button" className="settings-button" data-autofocus onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
