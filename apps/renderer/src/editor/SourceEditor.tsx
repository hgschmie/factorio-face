// CodeMirror 6 wrapper. It knows nothing about the circuit language: language support, diagnostics and listeners come
// in through `extensions`, highlighting through `tokenize`. The EditorView lives as long as the component is mounted,
// so keep it mounted (hidden if necessary) to preserve the undo history.
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import { Annotation, Compartment, EditorState, Transaction, type Extension } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Tokenizer } from "../workbench/controller.ts";
import { faceEditorTheme } from "./theme.ts";
import { tokenHighlighting } from "./tokenHighlight.ts";
import { minimalChange } from "./tokens.ts";

export interface SourceEditorHandle {
  /** The underlying view, for session code that needs to dispatch its own transactions. */
  readonly view: EditorView | null;
  focus(): void;
  undo(): boolean;
  redo(): boolean;
  /** Moves the caret to a source offset and scrolls it into view. */
  revealOffset(offset: number): void;
}

export interface SourceEditorProps {
  readonly ref?: Ref<SourceEditorHandle>;
  /** Document text. A value that differs from the editor's content replaces the differing part without a history entry. */
  readonly value: string;
  /** Called for edits made in the editor, not for changes that arrived through `value`. */
  onChange?(value: string): void;
  readonly extensions?: readonly Extension[];
  readonly tokenize?: Tokenizer;
  /** Extra or overriding token kind to class-name mappings (see editor/tokens.ts). */
  readonly tokenClasses?: Readonly<Record<string, string>>;
  readonly readOnly?: boolean;
  readonly ariaLabel?: string;
}

/** Marks transactions that mirror the `value` prop, so they are not reported back through `onChange`. */
const externalChange = Annotation.define<boolean>();

const baseExtensions: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  EditorState.tabSize.of(4),
  indentUnit.of("    "),
  indentOnInput(),
  bracketMatching(),
  highlightActiveLine(),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  faceEditorTheme,
];

export function SourceEditor({ ref, value, onChange, extensions, tokenize, tokenClasses, readOnly = false, ariaLabel = "Circuit source" }: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [compartments] = useState(() => ({ session: new Compartment(), tokens: new Compartment(), access: new Compartment() }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reportEdits = EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.every((transaction) => transaction.annotation(externalChange))) onChangeRef.current?.(update.state.doc.toString());
    });
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [baseExtensions, EditorView.contentAttributes.of({ "aria-label": ariaLabel }), compartments.access.of([]), compartments.tokens.of([]), compartments.session.of([]), reportEdits],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Created once: later prop changes are applied by the effects below.
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.session.reconfigure(extensions ? [...extensions] : []) });
  }, [compartments, extensions]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.tokens.reconfigure(tokenize ? tokenHighlighting(tokenize, tokenClasses) : []) });
  }, [compartments, tokenize, tokenClasses]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.access.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [compartments, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const change = minimalChange(view.state.doc.toString(), value);
    if (change) view.dispatch({ changes: change, annotations: [externalChange.of(true), Transaction.addToHistory.of(false)] });
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      get view() {
        return viewRef.current;
      },
      focus: () => viewRef.current?.focus(),
      undo: () => (viewRef.current ? undo(viewRef.current) : false),
      redo: () => (viewRef.current ? redo(viewRef.current) : false),
      revealOffset: (offset) => {
        const view = viewRef.current;
        if (!view) return;
        const anchor = Math.max(0, Math.min(offset, view.state.doc.length));
        view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
        view.focus();
      },
    }),
    [],
  );

  return <div ref={hostRef} className="source-editor" />;
}
