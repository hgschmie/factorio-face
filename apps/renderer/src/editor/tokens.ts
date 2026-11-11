// Maps tokens from the session's tokenizer to highlight classes. Pure; the CodeMirror glue is in tokenHighlight.ts.
import type { SourceToken } from "../workbench/controller.ts";

/** Token kinds with a dedicated style. Several spellings map to one class so the tokenizer's vocabulary can evolve. */
const KIND_CLASSES: Readonly<Record<string, string>> = {
  keyword: "keyword",
  string: "string",
  number: "number",
  integer: "number",
  int: "number",
  comment: "comment",
  "line-comment": "comment",
  "block-comment": "comment",
  signal: "signal",
  wildcard: "signal",
  color: "atom",
  "wire-color": "atom",
  direction: "atom",
  boolean: "atom",
  atom: "atom",
  red: "color-red",
  green: "color-green",
  identifier: "name",
  ident: "name",
  name: "name",
  property: "name",
  operator: "operator",
  comparator: "operator",
  punctuation: "punctuation",
  bracket: "punctuation",
  invalid: "invalid",
  error: "invalid",
  unknown: "invalid",
};

const TOKEN_CLASS_PREFIX = "face-tok-";

/** CSS class for a token kind, or undefined for kinds that are not highlighted (whitespace and anything unknown). */
export function tokenClass(kind: string, overrides?: Readonly<Record<string, string>>): string | undefined {
  const name = overrides?.[kind] ?? KIND_CLASSES[kind.toLowerCase()];
  return name ? TOKEN_CLASS_PREFIX + name : undefined;
}

export interface HighlightRange {
  readonly from: number;
  readonly to: number;
  readonly className: string;
}

/**
 * Turns tokens into ranges that are safe to hand to CodeMirror: styled kinds only, clamped to the document, non-empty,
 * sorted and without overlaps (a later token that starts inside an earlier one is dropped).
 */
export function highlightRanges(tokens: readonly SourceToken[], documentLength: number, overrides?: Readonly<Record<string, string>>): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  for (const token of tokens) {
    const className = tokenClass(token.kind, overrides);
    if (!className) continue;
    const from = Math.max(0, Math.trunc(token.from));
    const to = Math.min(documentLength, Math.trunc(token.to));
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) ranges.push({ from, to, className });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  let end = 0;
  return ranges.filter((range) => {
    if (range.from < end) return false;
    end = range.to;
    return true;
  });
}

/** Smallest replacement that turns `before` into `after`: the differing middle after removing the common prefix and suffix. */
export function minimalChange(before: string, after: string): { readonly from: number; readonly to: number; readonly insert: string } | undefined {
  if (before === after) return undefined;
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  return { from: prefix, to: before.length - suffix, insert: after.slice(prefix, after.length - suffix) };
}
