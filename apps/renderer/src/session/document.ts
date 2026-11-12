// The source document: a CodeMirror EditorState (text, history, selection) that exists whether or not an editor view is
// mounted. Every change is a transaction that passes through `apply`, so the session sees each one exactly once.
import { history, isolateHistory, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { Annotation, EditorState, Transaction, type Extension, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { TextChange } from "@face/language";
import { minimalChange } from "../editor/tokens.ts";
import type { EditorBinding } from "../workbench/controller.ts";

/** Marks a transaction produced by a graphical command; the value says whether it continues the previous command's undo step. */
const commandEdit = Annotation.define<"new" | "join">();

export interface DocumentHooks {
  /** Called for every applied batch, before an attached view is updated. */
  applied(transactions: readonly Transaction[]): void;
  /** Called after the view (if any) has caught up; further transactions may be dispatched from here. */
  settled(): void;
  /** Called when the whole state was replaced (a project was loaded). */
  replaced(): void;
}

export class SourceDocument implements EditorBinding {
  private current: EditorState;
  private view: EditorView | null = null;
  private changes = 0;
  private cachedText: { readonly state: EditorState; readonly text: string } | undefined;
  /** Whether the latest document change was a graphical command, and when; plain typing never joins such a step. */
  private lastCommandTime: number | undefined;
  private readonly extensions: Extension;

  constructor(source: string, extensions: Extension, private readonly hooks: DocumentHooks) {
    this.extensions = [
      history({ joinToEvent: (transaction, adjacent) => (transaction.annotation(commandEdit) === "join" ? true : adjacent && this.lastCommandTime === undefined) }),
      extensions,
    ];
    this.current = this.createState(source);
  }

  private createState(source: string): EditorState {
    return EditorState.create({ doc: source, extensions: this.extensions });
  }

  get state(): EditorState {
    return this.current;
  }

  /** Incremented for every change of the text, including a replaced document. */
  get version(): number {
    return this.changes;
  }

  get text(): string {
    if (this.cachedText?.state.doc !== this.current.doc) this.cachedText = { state: this.current, text: this.current.doc.toString() };
    return this.cachedText.text;
  }

  get canUndo(): boolean {
    return undoDepth(this.current) > 0;
  }

  get canRedo(): boolean {
    return redoDepth(this.current) > 0;
  }

  apply(transactions: readonly Transaction[]): void {
    const last = transactions.at(-1);
    if (!last) return;
    this.current = last.state;
    for (const transaction of transactions) {
      if (!transaction.docChanged) continue;
      this.changes++;
      this.lastCommandTime = transaction.annotation(commandEdit) ? transaction.annotation(Transaction.time) : undefined;
    }
    this.hooks.applied(transactions);
    try {
      this.view?.update(transactions);
    } finally {
      this.hooks.settled();
    }
  }

  dispatch(...specs: TransactionSpec[]): void {
    this.apply([this.current.update(...specs)]);
  }

  /**
   * Applies the text changes of one graphical command as one transaction and one undo step. With `join`, the step is merged
   * into the directly preceding command step instead (the caller decides that both belong to the same edit).
   */
  edit(changes: readonly TextChange[], join = false): void {
    if (changes.length === 0) return;
    const joined = join && this.lastCommandTime !== undefined;
    this.dispatch({
      changes: changes.map((change) => ({ from: change.from, to: change.to, insert: change.insert })),
      annotations: joined ? [commandEdit.of("join"), Transaction.time.of(this.lastCommandTime!)] : [commandEdit.of("new"), isolateHistory.of("before")],
    });
  }

  /** Replaces the text with `source` as one ordinary edit of the differing part. */
  setText(source: string): void {
    const change = minimalChange(this.text, source);
    if (change) this.dispatch({ changes: change, annotations: isolateHistory.of("full") });
  }

  undo(): boolean {
    return undo({ state: this.current, dispatch: (transaction) => this.apply([transaction]) });
  }

  redo(): boolean {
    return redo({ state: this.current, dispatch: (transaction) => this.apply([transaction]) });
  }

  /** Starts over with a new document and an empty history. */
  replace(source: string): void {
    this.current = this.createState(source);
    this.changes++;
    this.lastCommandTime = undefined;
    this.view?.setState(this.current);
    this.hooks.replaced();
  }

  attach(view: EditorView): () => void {
    this.view = view;
    if (view.state !== this.current) view.setState(this.current);
    return () => {
      if (this.view === view) this.view = null;
    };
  }
}
