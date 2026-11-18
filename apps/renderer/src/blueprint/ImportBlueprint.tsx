// Bringing a blueprint of the game in. The game has no blueprint files: it shows a text box to copy a blueprint string from, so the
// dialog here has a text box to paste one into. The same dialog shows what is in the way of a file the user chose, and the
// blueprints of a blueprint book to choose from. After an import that left something out, or that switched on mods of the
// game, a second dialog reports it.
// Presentational: reading the text and opening the project are the session's.
import { useDeferredValue, useId, useMemo, useState } from "react";
import type { BlueprintFileText } from "../../../desktop/src/ipc.ts";
import { Modal } from "../dialog/Modal.tsx";
import { noteWord, unlistedNote, type BlueprintReading, type ImportedBlueprint, type ImportReportView } from "../session/blueprints.ts";

export interface ImportBlueprintProps {
  /** A file the user chose: its text is read in place of a pasted one, and there is no text box. */
  readonly file?: BlueprintFileText;
  /** What a text holds; `select` names a blueprint of a book. */
  read(text: string, select?: readonly number[]): BlueprintReading;
  /** Opens the blueprint as a new project. Resolves false when it was not opened; the dialog then stays. */
  open(blueprint: ImportedBlueprint): Promise<boolean>;
  close(): void;
}

const pathKey = (path: readonly number[]): string => path.join(".");

function summaryOf({ name, entities, total }: ImportedBlueprint): string {
  const all = `${total} ${total === 1 ? "entity" : "entities"}`;
  return entities === total ? `"${name}": ${all}.` : `"${name}": ${entities} of ${all} can be imported. The rest is dropped; a report lists it after the import.`;
}

export function ImportBlueprint({ file, read, open, close }: ImportBlueprintProps) {
  const [pasted, setPasted] = useState("");
  const [chosen, setChosen] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const group = useId();
  const text = file?.text ?? pasted;
  // Reading a long string takes a moment, which typing does not wait for.
  const shown = useDeferredValue(text);
  const reading = useMemo(() => (file || shown.trim() !== "" ? read(shown) : undefined), [file, shown, read]);
  const rows = reading?.kind === "book" ? reading.rows : [];
  const entry = rows.find((row) => row.importable && pathKey(row.path) === chosen) ?? rows.find((row) => row.importable);
  const ready = !busy && shown === text && (reading?.kind === "blueprint" || entry !== undefined);

  const run = async (): Promise<void> => {
    if (!ready || !reading) return;
    const picked = reading.kind === "blueprint" ? reading : read(text, entry?.path);
    if (picked.kind !== "blueprint") return setFailure(picked.kind === "error" ? picked.message : "This item of the book is a book itself.");
    setBusy(true);
    // Opened: the dialog is closed by its owner. Not opened (the user kept the current project): it stays as it is.
    if (!(await open(picked.blueprint))) setBusy(false);
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
          <div role="radiogroup" aria-label="Blueprints of the book">
            <ul className="book-list">
              {rows.map((row) => {
                const key = pathKey(row.path);
                const content = (
                  <>
                    <span className="book-label">{row.label}</span>
                    <small>{row.detail}</small>
                  </>
                );
                return (
                  <li key={key} data-kind={row.kind} data-path={key} style={{ paddingLeft: row.depth * 18 }}>
                    {row.kind === "blueprint" ? (
                      <label className={row.importable ? undefined : "unavailable"}>
                        <input
                          type="radio"
                          name={group}
                          checked={row === entry}
                          disabled={!row.importable}
                          onChange={() => {
                            setChosen(key);
                            setFailure(undefined);
                          }}
                        />
                        {content}
                      </label>
                    ) : (
                      <div>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          {reading.unlisted > 0 && <p className="muted-note">{unlistedNote(reading.unlisted)}</p>}
          {entry === undefined && (
            <p className="settings-message error" role="alert" data-message="error">
              No blueprint of this book has an entity the editor knows, so there is nothing to import.
            </p>
          )}
        </>
      )}
      {failure !== undefined && (
        <p className="settings-message error" role="alert" data-message="error">
          {failure}
        </p>
      )}
      <p className="muted-note">The blueprint opens as a new project on the blueprint board. This is a circuit editor: entities it does not know are dropped.</p>
      <div className="dialog-actions">
        <button type="button" className="settings-button primary-button" data-autofocus={file ? true : undefined} disabled={!ready} onClick={() => void run()}>
          Import
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
