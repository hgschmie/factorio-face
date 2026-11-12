// Language support for the source editor, on top of what the session already knows: tokens and diagnostics come from the
// latest analysis instead of being computed a second time.
import { autocompletion, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { linter, setDiagnostics, type Diagnostic as LintDiagnostic } from "@codemirror/lint";
import type { EditorState, Extension, TransactionSpec } from "@codemirror/state";
import { analyze, completionContext, tokenize, type ParseResult, type Token } from "@face/language";
import { tokenHighlighting } from "../editor/tokenHighlight.ts";
import type { Diagnostic, SourceToken } from "../workbench/controller.ts";
import { completionCandidates, type CompletionCatalog } from "./completion.ts";

const DIRECTIONS: ReadonlySet<string> = new Set(["north", "east", "south", "west"]);
const WILDCARDS: ReadonlySet<string> = new Set(["each", "anything", "everything"]);
const WORD_OPERATORS: ReadonlySet<string> = new Set(["AND", "OR", "XOR"]);

/** Token kind in the vocabulary of editor/tokens.ts, or undefined for trivia that is not styled. */
function highlightKind(token: Token): string | undefined {
  switch (token.kind) {
    case "whitespace":
    case "eof":
      return undefined;
    case "lineComment":
    case "blockComment":
      return "comment";
    case "keyword":
      if (token.text === "red" || token.text === "green") return token.text;
      if (token.text === "true" || token.text === "false") return "boolean";
      if (DIRECTIONS.has(token.text)) return "direction";
      if (WILDCARDS.has(token.text)) return "wildcard";
      return WORD_OPERATORS.has(token.text) ? "operator" : "keyword";
    case "ident":
      return "identifier";
    case "word":
      return "atom";
    case "int":
    case "decimal":
      return "number";
    case "punct":
      return "punctuation";
    case "op":
      return "operator";
    default:
      return token.kind;
  }
}

export function highlightTokens(tokens: readonly Token[]): SourceToken[] {
  const result: SourceToken[] = [];
  for (const token of tokens) {
    const kind = highlightKind(token);
    if (kind) result.push({ kind, from: token.from, to: token.to });
  }
  return result;
}

export interface LanguageSource {
  /** The latest analysis, if it describes `source`. */
  parseOf(source: string): ParseResult | undefined;
  catalog(): CompletionCatalog;
}

export function completionSource(language: LanguageSource): CompletionSource {
  return (context): CompletionResult | null => {
    const source = context.state.doc.toString();
    const expected = completionContext(language.parseOf(source) ?? analyze(source), context.pos);
    if (expected.expected.length === 0 || (expected.prefix === "" && !context.explicit)) return null;
    const options = completionCandidates(expected, language.catalog()).map((candidate) => ({ label: candidate.label, type: candidate.type, detail: candidate.detail }));
    return options.length === 0 ? null : { from: expected.from, to: expected.to, options };
  };
}

/** Extensions the session adds to its editor state. */
export function languageSupport(language: LanguageSource): Extension {
  let cached: { readonly parse: ParseResult; readonly tokens: readonly SourceToken[] } | undefined;
  const tokens = (source: string): readonly SourceToken[] => {
    const parse = language.parseOf(source);
    if (!parse) return highlightTokens(tokenize(source));
    if (cached?.parse !== parse) cached = { parse, tokens: highlightTokens(parse.cst.tokens) };
    return cached.tokens;
  };
  // The linter has no source of its own: the session pushes the diagnostics of each analysis with `lintTransaction`.
  return [tokenHighlighting(tokens), linter(null), autocompletion({ override: [completionSource(language)], icons: false })];
}

/** The transaction that shows `diagnostics` in the editor. */
export function lintTransaction(state: EditorState, diagnostics: readonly Diagnostic[]): TransactionSpec {
  const length = state.doc.length;
  const shown = diagnostics.map((diagnostic): LintDiagnostic => {
    const from = Math.min(diagnostic.from, length);
    return { from, to: Math.max(from, Math.min(diagnostic.to, length)), severity: diagnostic.severity, message: diagnostic.message, source: diagnostic.code };
  });
  return setDiagnostics(state, shown);
}
