// CodeMirror extension that colors the document with tokens from an external tokenizer.
import { RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { Tokenizer } from "../workbench/controller.ts";
import { highlightRanges } from "./tokens.ts";

const marks = new Map<string, Decoration>();

function markFor(className: string): Decoration {
  let mark = marks.get(className);
  if (!mark) {
    mark = Decoration.mark({ class: className });
    marks.set(className, mark);
  }
  return mark;
}

function decorate(tokenize: Tokenizer, source: string, classes?: Readonly<Record<string, string>>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  try {
    for (const range of highlightRanges(tokenize(source), source.length, classes)) builder.add(range.from, range.to, markFor(range.className));
  } catch (error) {
    // A failing tokenizer must not take the editor down; the text simply stays unstyled.
    console.error("[face] tokenizer failed:", error);
    return Decoration.none;
  }
  return builder.finish();
}

/** Re-tokenizes the whole document on every change. Tokenizing is linear and cheap next to parsing the same text. */
export function tokenHighlighting(tokenize: Tokenizer, classes?: Readonly<Record<string, string>>): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => decorate(tokenize, state.doc.toString(), classes),
    update: (decorations, transaction) => (transaction.docChanged ? decorate(tokenize, transaction.newDoc.toString(), classes) : decorations),
    provide: (field) => EditorView.decorations.from(field),
  });
}
