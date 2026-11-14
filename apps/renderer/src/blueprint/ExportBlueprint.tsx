// Taking the circuit to the game: the dialog with its blueprint string, ready to copy (the game takes it in its Import string box),
// and the dialog that says what is in the way of a blueprint. Presentational: the export itself is the session's.
import { useEffect, useRef, useState } from "react";
import { Modal } from "../dialog/Modal.tsx";
import { unplacedEntities, type BlueprintExport, type BlueprintProblem } from "../session/blueprints.ts";

export interface BlueprintStringProps {
  readonly exported: BlueprintExport & { readonly ok: true };
  close(): void;
}

export function BlueprintString({ exported, close }: BlueprintStringProps) {
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  // The dialog has put the focus into the box; with the string selected, the copy key is all it takes.
  useEffect(() => boxRef.current?.select(), []);

  // A copy of the selection, which a page may start on a click. The clipboard itself is out of the page's reach.
  const copy = (): void => {
    const box = boxRef.current;
    if (!box) return;
    box.focus();
    box.select();
    setCopied(document.execCommand("copy"));
  };

  return (
    <Modal title="Blueprint string" closeLabel="Close blueprint string" className="blueprint-dialog blueprint-string" close={close}>
      <label className="blueprint-text">
        <span className="section-label">
          <span>Blueprint string</span>
          <span data-fact="version">Factorio {exported.gameVersion}</span>
        </span>
        <textarea ref={boxRef} data-autofocus readOnly rows={7} spellCheck={false} value={exported.string} />
      </label>
      {exported.warnings.length > 0 && (
        <section aria-label="Warnings">
          <h3 className="section-label">Warnings</h3>
          <ul className="report-list warnings">
            {exported.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted-note">In the game: Import string in the shortcut bar, paste, Import. Entity names and edit positions are not part of a blueprint.</p>
      <div className="dialog-actions">
        <button type="button" className="settings-button primary-button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="settings-button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export interface ExportProblemsProps {
  readonly problems: readonly BlueprintProblem[];
  /** Shows the blueprint board with these entities (by name) selected: where an entity gets its tile. */
  showBoard(entities: readonly string[]): void;
  close(): void;
}

export function ExportProblems({ problems, showBoard, close }: ExportProblemsProps) {
  const unplaced = unplacedEntities(problems);
  return (
    <Modal title="No blueprint yet" closeLabel="Close export problems" className="blueprint-dialog export-problems" close={close}>
      <p className="blueprint-summary">The circuit cannot be exported as a blueprint until this is solved:</p>
      <ul className="report-list problems">
        {problems.map((problem, index) => (
          <li key={index} data-problem={problem.code}>
            {problem.message}
          </li>
        ))}
      </ul>
      {unplaced.length > 0 && <p className="muted-note">On the blueprint board, "Place all" gives every entity without a tile the one it is shown at.</p>}
      <div className="dialog-actions">
        {unplaced.length > 0 && (
          <button type="button" className="settings-button primary-button" data-autofocus onClick={() => showBoard(unplaced)}>
            Show blueprint board
          </button>
        )}
        <button type="button" className="settings-button" data-autofocus={unplaced.length === 0 ? true : undefined} onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
