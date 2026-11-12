// CodeMirror extension that colors the visible part of the document with tokens from an external tokenizer.
import { RangeSetBuilder, type Extension, type Text } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Tokenizer } from "../workbench/controller.ts";
import { highlightRanges, type HighlightRange } from "./tokens.ts";

const marks = new Map<string, Decoration>();

function markFor(className: string): Decoration {
  let mark = marks.get(className);
  if (!mark) {
    mark = Decoration.mark({ class: className });
    marks.set(className, mark);
  }
  return mark;
}

/** Index of the first range that ends after `offset`. */
export function firstRangeAfter(ranges: readonly HighlightRange[], offset: number): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle]!.to <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The document is tokenized once per change (the tokenizer is linear, and the session serves tokens it already has);
 * decorations are only built for the lines in view, so the cost of an edit does not grow with the document.
 */
export function tokenHighlighting(tokenize: Tokenizer, classes?: Readonly<Record<string, string>>): Extension {
  let cache: { readonly doc: Text; readonly ranges: readonly HighlightRange[] } | undefined;
  const rangesOf = (doc: Text): readonly HighlightRange[] => {
    if (cache?.doc !== doc) {
      try {
        cache = { doc, ranges: highlightRanges(tokenize(doc.toString()), doc.length, classes) };
      } catch (error) {
        // A failing tokenizer must not take the editor down; the text simply stays unstyled.
        console.error("[face] tokenizer failed:", error);
        cache = { doc, ranges: [] };
      }
    }
    return cache.ranges;
  };
  const decorate = (view: EditorView): DecorationSet => {
    const ranges = rangesOf(view.state.doc);
    const builder = new RangeSetBuilder<Decoration>();
    for (const visible of view.visibleRanges) {
      for (let index = firstRangeAfter(ranges, visible.from); index < ranges.length && ranges[index]!.from < visible.to; index++) {
        const range = ranges[index]!;
        builder.add(Math.max(range.from, visible.from), Math.min(range.to, visible.to), markFor(range.className));
      }
    }
    return builder.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.decorations = decorate(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
