// Source view: file heading, the editor and the diagnostics list.
import type { Extension } from "@codemirror/state";
import type { Ref } from "react";
import { SourceEditor, type SourceEditorHandle } from "../editor/SourceEditor.tsx";
import { Icon } from "../icons/Icon.tsx";
import type { Diagnostic, Tokenizer } from "./controller.ts";

export interface SourcePaneProps {
  readonly editorRef?: Ref<SourceEditorHandle>;
  readonly fileName: string;
  readonly source: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly extensions?: readonly Extension[];
  readonly tokenize?: Tokenizer;
  readonly hidden: boolean;
  onSourceChange(source: string): void;
  /** Called with the source offset of a diagnostic the user clicked. */
  onRevealOffset(offset: number): void;
}

const MAX_LISTED_DIAGNOSTICS = 20;

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let index = source.indexOf("\n"); index !== -1 && index < offset; index = source.indexOf("\n", index + 1)) line++;
  return line;
}

export function SourcePane({ editorRef, fileName, source, diagnostics, extensions, tokenize, hidden, onSourceChange, onRevealOffset }: SourcePaneProps) {
  return (
    <div className="source-pane" hidden={hidden}>
      <div className="source-heading">
        <span className="file-name">
          <Icon name="code" size={15} />
          {fileName}
        </span>
        <span>FACE CIRCUIT LANGUAGE</span>
      </div>
      <SourceEditor ref={editorRef} value={source} onChange={onSourceChange} extensions={extensions} tokenize={tokenize} />
      {diagnostics.length > 0 && (
        <ul className="diagnostics" aria-label="Diagnostics">
          {diagnostics.slice(0, MAX_LISTED_DIAGNOSTICS).map((diagnostic, index) => (
            <li key={index} className={`severity-${diagnostic.severity}`}>
              <button type="button" onClick={() => onRevealOffset(diagnostic.from)}>
                Line {lineOf(source, diagnostic.from)}: {diagnostic.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
