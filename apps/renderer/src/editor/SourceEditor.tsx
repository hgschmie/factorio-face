// CodeMirror 6 view over an editor state that lives elsewhere. The session owns document, history and selection
// (`EditorBinding`); this component only shows that state and sends every transaction back, so it can be mounted and
// unmounted at any time without losing anything.
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { EditorBinding } from "../workbench/controller.ts";

export interface SourceEditorHandle {
  focus(): void;
  /** Selects a source range (or places the caret) and scrolls it into view. */
  reveal(from: number, to?: number): void;
}

export interface SourceEditorProps {
  readonly ref?: Ref<SourceEditorHandle>;
  readonly binding: EditorBinding;
}

export function SourceEditor({ ref, binding }: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({ parent: host, state: binding.state, dispatchTransactions: (transactions) => binding.apply(transactions) });
    const detach = binding.attach(view);
    viewRef.current = view;
    return () => {
      detach();
      view.destroy();
      viewRef.current = null;
    };
  }, [binding]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      reveal: (from, to = from) => {
        const view = viewRef.current;
        if (!view) return;
        const length = view.state.doc.length;
        const anchor = Math.max(0, Math.min(from, length));
        const head = Math.max(anchor, Math.min(to, length));
        view.dispatch({ selection: EditorSelection.single(anchor, head), effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
        view.focus();
      },
    }),
    [],
  );

  return <div ref={hostRef} className="source-editor" />;
}
