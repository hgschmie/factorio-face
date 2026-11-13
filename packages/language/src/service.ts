// Editor helpers: what the grammar expects at a caret position, in terms a completion source can use directly.

import { SELECTOR_OPERATIONS, TERMINALS, TERMINAL_SIDES, type EntityKind, type SelectorOperation, type TerminalSide, type Wildcard } from "@face/model";
import type { ParseResult } from "./analyze.ts";
import type { CstEntity } from "./cst.ts";
import { expectationsAfter } from "./parser.ts";
import { enumValues, lookupProperty, propertyNames, SIGNAL_SLOTS, STATEMENT_KEYWORDS } from "./schema.ts";
import { decodeString, type Token } from "./tokens.ts";

export interface TerminalCandidate {
  readonly name: string;
  readonly kind: EntityKind;
  readonly sides: readonly TerminalSide[];
}

export type Completion =
  | { readonly type: "keyword"; readonly values: readonly string[] }
  | { readonly type: "property"; readonly kind: EntityKind; readonly names: readonly string[] }
  | { readonly type: "enum"; readonly property: string; readonly values: readonly string[] }
  | { readonly type: "signal"; readonly wildcards: readonly Wildcard[] }
  | { readonly type: "terminal"; readonly entities: readonly TerminalCandidate[] }
  | { readonly type: "side"; readonly entity: string; readonly sides: readonly TerminalSide[] }
  /** A speaker instrument, or a note of `instrument` (of the first instrument when absent); the names are game data. */
  | { readonly type: "instrument" }
  | { readonly type: "note"; readonly instrument?: string }
  | { readonly type: "literal"; readonly kind: "integer" | "number" | "string" | "color" | "name" | "quality" };

export interface CompletionContext {
  /** Range of the word being typed (empty at `offset` when there is none); a completion replaces it. */
  readonly from: number;
  readonly to: number;
  readonly prefix: string;
  /** Everything legal at this position; empty inside comments and strings. */
  readonly expected: readonly Completion[];
}

const PARTIAL_KINDS: ReadonlySet<string> = new Set(["keyword", "ident", "word", "signal", "int", "decimal", "color"]);

/** The token that contains `offset` or ends exactly there. */
function tokenBefore(tokens: readonly Token[], offset: number): Token | undefined {
  let low = 0;
  let high = tokens.length - 1;
  let found: Token | undefined;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (tokens[mid]!.from < offset) {
      found = tokens[mid];
      low = mid + 1;
    } else high = mid - 1;
  }
  return found && offset <= found.to ? found : undefined;
}

function operationOf(entity: CstEntity | undefined): SelectorOperation | undefined {
  if (entity?.kind !== "selector") return undefined;
  for (const statement of entity.body?.statements ?? []) {
    if (statement.type === "property" && statement.name.text === "operation" && statement.value && (SELECTOR_OPERATIONS as readonly string[]).includes(statement.value.text)) {
      return statement.value.text as SelectorOperation;
    }
  }
  return "select";
}

/** The instrument a speaker declaration names, for the notes that fit it. */
function instrumentOf(entity: CstEntity | undefined): { instrument?: string } {
  for (const statement of entity?.body?.statements ?? []) {
    if (statement.type !== "property" || statement.name.text !== "instrument" || !statement.value) continue;
    return { instrument: statement.value.kind === "string" ? decodeString(statement.value.text) : statement.value.text };
  }
  return {};
}

export function completionContext(parse: ParseResult, offset: number): CompletionContext {
  const { source } = parse;
  offset = Math.max(0, Math.min(offset, source.length));
  const token = tokenBefore(parse.cst.tokens, offset);
  const none = { from: offset, to: offset, prefix: "", expected: [] };
  if (token) {
    const unterminated = token.kind === "string" && !(token.text.length > 1 && token.text.endsWith('"'));
    if (token.kind === "lineComment" || ((token.kind === "blockComment" || token.kind === "string") && (offset < token.to || unterminated))) return none;
    if (token.kind === "blockComment" && !token.text.endsWith("*/")) return none;
  }
  const partial = token && PARTIAL_KINDS.has(token.kind) ? token : undefined;
  const from = partial ? partial.from : offset;
  const entity = parse.cst.circuit?.members.findLast((m): m is CstEntity => m.type === "entity" && m.from <= offset);
  const operation = operationOf(entity);

  const keywords = new Set<string>();
  const expected: Completion[] = [];
  for (const expectation of expectationsAfter(source.slice(0, from))) {
    switch (expectation.type) {
      case "keyword":
        for (const value of expectation.values) keywords.add(value);
        break;
      case "statement": {
        const { kind, section } = expectation;
        if (!section) for (const value of STATEMENT_KEYWORDS[kind]) keywords.add(value);
        expected.push({ type: "property", kind, names: propertyNames(kind, kind === "selector" ? operation : undefined, section) });
        if (kind === "constant") expected.push({ type: "signal", wildcards: SIGNAL_SLOTS["constant.filter"] });
        else if (kind === "arithmetic") expected.push({ type: "signal", wildcards: SIGNAL_SLOTS["arithmetic.output"] });
        break;
      }
      case "value": {
        const lookup = lookupProperty(expectation.kind, expectation.property, expectation.kind === "selector" ? operation : undefined, expectation.section);
        if (lookup.status !== "ok") break;
        const values = enumValues(expectation.kind, expectation.property, expectation.kind === "selector" ? operation : undefined, expectation.section);
        if (values.length) expected.push({ type: "enum", property: expectation.property, values });
        for (const alternative of lookup.spec.values) {
          if (alternative.type === "signal") expected.push({ type: "signal", wildcards: alternative.wildcards });
          else if (alternative.type === "int") expected.push({ type: "literal", kind: "integer" });
          else if (alternative.type === "number" || alternative.type === "string" || alternative.type === "color" || alternative.type === "quality") expected.push({ type: "literal", kind: alternative.type });
          else if (alternative.type === "name") expected.push(alternative.of === "instrument" ? { type: "instrument" } : { type: "note", ...instrumentOf(entity) });
        }
        break;
      }
      case "signal":
        expected.push({ type: "signal", wildcards: expectation.wildcards });
        break;
      case "terminal":
        expected.push({ type: "terminal", entities: [...parse.sourceMap.entities.values()].filter((e) => e.name).map((e) => ({ name: e.name, kind: e.kind, sides: TERMINALS[e.kind] })) });
        break;
      case "side": {
        const target = [...parse.sourceMap.entities.values()].find((e) => e.name === expectation.entity);
        // Only `in` and `out` are written behind a dot; the one point of a pole is its bare name.
        expected.push({ type: "side", entity: expectation.entity, sides: (target ? TERMINALS[target.kind] : TERMINAL_SIDES).filter((side) => side !== "io") });
        break;
      }
      case "literal":
        expected.push(expectation);
        break;
    }
  }
  if (keywords.size) expected.unshift({ type: "keyword", values: [...keywords] });
  return { from, to: partial ? partial.to : offset, prefix: source.slice(from, offset), expected };
}
