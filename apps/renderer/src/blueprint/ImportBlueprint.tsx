// Bringing a blueprint of the game in. The game has no blueprint files: it shows a text box to copy a blueprint string from, so the
// dialog here has a text box to paste one into. The same dialog shows what is in the way of a file the user chose, and the
// blueprints of a blueprint book to choose from: the project the chosen one opens as keeps the book, and a book without a
// blueprint the editor can import opens as a project without a circuit. After an import that left something out, or that
// switched on mods of the game, a second dialog reports it.
// Presentational: reading the text and opening the project are the session's.
import { useDeferredValue, useMemo, useState } from "react";
import type { BlueprintFileText } from "../../../desktop/src/ipc.ts";
import { Modal } from "../dialog/Modal.tsx";
import { noteWord, unlistedNote, type BlueprintReading, type ImportedBlueprint, type ImportedBook, type ImportReportView } from "../session/blueprints.ts";
import { pathKey } from "./bookText.ts";
import { BookTree, importChoice } from "./BookTree.tsx";

export interface ImportBlueprintProps {
  /** A file the user chose: its text is read in place of a pasted one, and there is no text box. */
  readonly file?: BlueprintFileText;
  /** What a text holds; `select` names a blueprint of a book. */
  read(text: string, select?: readonly number[]): BlueprintReading;
  /** Opens the blueprint as a new project. Resolves false when it was not opened; the dialog then stays. */
  open(blueprint: ImportedBlueprint): Promise<boolean>;
  /** Opens a blueprint book as a new project without a circuit. Resolves like `open`. */
  openBook(book: ImportedBook): Promise<boolean>;
  close(): void;
}

function summaryOf({ name, entities, total }: ImportedBlueprint): string {
  const all = `${total} ${total === 1 ? "entity" : "entities"}`;
  return entities === total ? `"${name}": ${all}.` : `"${name}": ${entities} of ${all} can be imported. The rest is dropped; a report lists it after the import.`;
}

export function ImportBlueprint({ file, read, open, openBook, close }: ImportBlueprintProps) {
  const [pasted, setPasted] = useState("");
  const [chosen, setChosen] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const text = file?.text ?? pasted;
  // Reading a long string takes a moment, which typing does not wait for.
  const shown = useDeferredValue(text);
  const reading = useMemo(() => (file || shown.trim() !== "" ? read(shown) : undefined), [file, shown, read]);
  const rows = reading?.kind === "book" ? reading.rows : [];
  const entry = rows.find((row) => row.importable && pathKey(row.path) === chosen) ?? rows.find((row) => row.importable);
  // A book of which nothing can be imported still opens: as a project that holds the book and has no circuit.
  const bookOnly = reading?.kind === "book" && entry === undefined;
  const ready = !busy && shown === text && (reading?.kind === "blueprint" || reading?.kind === "book");
  const keepsBook = reading?.kind === "book" ? "The project keeps the book: File > Blueprint Book has its other blueprints and exports it again. " : "";

  const run = async (): Promise<void> => {
    if (!ready || !reading) return;
    let opening: Promise<boolean>;
    if (reading.kind === "book" && !entry) opening = openBook(reading.book);
    else {
      const picked = reading.kind === "blueprint" ? reading : read(text, entry?.path);
      if (picked.kind !== "blueprint") return setFailure(picked.kind === "error" ? picked.message : "This item of the book is a book itself.");
      opening = open(picked.blueprint);
    }
    setBusy(true);
    // Opened: the dialog is closed by its owner. Not opened (the user kept the current project): it stays as it is.
    if (!(await opening)) setBusy(false);
  };

  return (
    <Modal title={file ? "Import blueprint" : "Paste blueprint string"} closeLabel="Close blueprint import" className="blueprint-dialog import-blueprint" close={close}>
      {file ? (
        <p className="blueprint-file">
          File <span className="path">{file.name}</span>
        </p>
      ) : (
        <label className="blueprint-text">
          <span className="section-label">Blueprint string</span>
          <textarea
            data-autofocus
            rows={7}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={reading?.kind === "error"}
            placeholder="Paste a blueprint string here: in the game, a blueprint shows it under Export string."
            onChange={(event) => {
              setPasted(event.target.value);
              setFailure(undefined);
            }}
          />
        </label>
      )}
      {reading?.kind === "error" && (
        <p className="settings-message error" role="alert" data-message="error">
          {reading.message}
        </p>
      )}
      {reading?.kind === "blueprint" && (
        <p className="blueprint-summary" role="status" data-message="blueprint">
          {summaryOf(reading.blueprint)}
        </p>
      )}
      {reading?.kind === "book" && (
        <>
          <p className="blueprint-summary" role="status" data-message="book">
            {reading.message}
          </p>
          {rows.length > 0 && (
            <BookTree
              label="Blueprints of the book"
              rows={rows}
              chosen={entry && pathKey(entry.path)}
              choice={importChoice}
              onChoose={(key) => {
                setChosen(key);
                setFailure(undefined);
              }}
            />
          )}
          {reading.unlisted > 0 && <p className="muted-note">{unlistedNote(reading.unlisted)}</p>}
          {bookOnly && (
            <p className="settings-message" role="status" data-message="book-only">
              {rows.some((row) => row.kind === "blueprint") && "No blueprint of this book has an entity the editor knows, so there is no circuit to import. "}
              The book can be opened as a project without a circuit: the project keeps the book, and File &gt; Export Blueprint &gt; To Blueprint Book writes a circuit into it.
            </p>
          )}
        </>
      )}
      {failure !== undefined && (
        <p className="settings-message error" role="alert" data-message="error">
          {failure}
        </p>
      )}
      <p className="muted-note" data-message="note">
        {bookOnly
          ? "The book opens as a new project that holds it and has no circuit."
          : `The blueprint opens as a new project on the blueprint board. ${keepsBook}This is a circuit editor: entities it does not know are dropped.`}
      </p>
      <div className="dialog-actions">
        <button type="button" className="settings-button primary-button" data-autofocus={file ? true : undefined} disabled={!ready} onClick={() => void run()}>
          {bookOnly ? "Open Book" : "Import"}
        </button>
        <button type="button" className="settings-button" onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export interface ImportReportProps {
  /** The name of the project the blueprint opened as. */
  readonly name: string;
  readonly report: ImportReportView;
  close(): void;
}

/** What an import left out, changed or switched on: shown once, after the blueprint is open. */
export function ImportReport({ name, report, close }: ImportReportProps) {
  const list = (label: string, lines: readonly string[]) =>
    lines.length > 0 && (
      <section aria-label={label}>
        <h3 className="section-label">{label}</h3>
        <ul className="report-list">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>
    );
  return (
    <Modal title="Blueprint imported" closeLabel="Close import report" className="blueprint-dialog import-report" close={close}>
      <p className="blueprint-summary" data-message="summary">
        "{name}": {report.summary}
      </p>
      {list("Signal groups", report.modules)}
      {list("Dropped entities", report.dropped)}
      {list("Wires", report.wires)}
      {report.settings.length > 0 && (
        <section aria-label="Settings">
          <h3 className="section-label">Settings</h3>
          <ul className="report-list">
            {report.settings.map((note, index) => (
              <li key={index} data-note={note.kind}>
                <span className="note-kind">{noteWord(note.kind)}</span> {note.text}
                <small>{note.entities}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {list("Blueprint", report.remarks)}
      <div className="dialog-actions">
        <button type="button" className="settings-button" data-autofocus onClick={close}>
          OK
        </button>
      </div>
    </Modal>
  );
}
