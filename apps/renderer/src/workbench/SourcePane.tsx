// Source view: file heading, the editor and a compact diagnostics list.
import type { Ref } from "react";
import { SourceEditor, type SourceEditorHandle } from "../editor/SourceEditor.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { Diagnostic, EditorBinding } from "./controller.ts";

export interface SourcePaneProps {
  readonly editorRef?: Ref<SourceEditorHandle>;
  readonly fileName: string;
  readonly binding: EditorBinding;
  readonly diagnostics: readonly Diagnostic[];
  readonly hidden: boolean;
  /** Called with the diagnostic the user clicked. */
  onReveal(diagnostic: Diagnostic): void;
}

const MAX_LISTED_DIAGNOSTICS = 20;
const SEVERITY_ORDER: Readonly<Record<Diagnostic["severity"], number>> = { error: 0, warning: 1, info: 2 };

function count(diagnostics: readonly Diagnostic[], severity: Diagnostic["severity"], word: string): string | null {
  const total = diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
  return total === 0 ? null : `${total} ${word}${total === 1 ? "" : "s"}`;
}

export function SourcePane({ editorRef, fileName, binding, diagnostics, hidden, onReveal }: SourcePaneProps) {
  // Errors first: they block the canvas, and a long list of warnings must not push them out of view.
  const listed = [...diagnostics].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.from - b.from).slice(0, MAX_LISTED_DIAGNOSTICS);
  const summary = [count(diagnostics, "error", "error"), count(diagnostics, "warning", "warning")].filter((part) => part !== null).join(", ");
  return (
    <div className="source-pane" hidden={hidden}>
      <div className="source-heading">
        <span className="file-name">
          <Icon name="code" size={15} />
          {fileName}
        </span>
        <span>FACE CIRCUIT LANGUAGE</span>
      </div>
      <SourceEditor ref={editorRef} binding={binding} />
      {diagnostics.length > 0 && (
        <section className="diagnostics" aria-label="Diagnostics">
          <div className="diagnostics-heading">
            <span>PROBLEMS</span>
            <span data-testid="diagnostics-summary">{summary}</span>
          </div>
          <ul>
            {listed.map((diagnostic, index) => (
              <li key={`${index}:${diagnostic.from}:${diagnostic.code}`} className={`severity-${diagnostic.severity}`} data-code={diagnostic.code}>
                <button type="button" title="Show in source" onClick={() => onReveal(diagnostic)}>
                  <span className="diagnostic-dot" />
                  <span className="diagnostic-line">Ln {diagnostic.line}</span>
                  <span className="diagnostic-message">{diagnostic.message}</span>
                </button>
              </li>
            ))}
          </ul>
          {diagnostics.length > listed.length && <p className="diagnostics-more">and {diagnostics.length - listed.length} more</p>}
        </section>
      )}
    </div>
  );
}
