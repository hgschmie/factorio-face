// Editor helpers: what the grammar expects at a caret position, in terms a completion source can use directly.

import { PROTOTYPE_NAMES, SELECTOR_OPERATIONS, TERMINALS, TERMINAL_SIDES, type EntityKind, type PrototypeName, type TerminalSide, type Wildcard } from "@face/model";
import type { ParseResult } from "./analyze.ts";
import type { CstEntity } from "./cst.ts";
import { expectationsAfter } from "./parser.ts";
import { conditionRoles, enumValues, lookupProperty, propertyNames, SIGNAL_SLOTS, STATEMENT_KEYWORDS, type PropertyVariant } from "./schema.ts";
import { decodeString, type Token } from "./tokens.ts";

export interface TerminalCandidate {
  readonly name: string;
  readonly kind: EntityKind;
  readonly sides: readonly TerminalSide[];
}

export type Completion =
  | { readonly type: "keyword"; readonly values: readonly string[] }
  /** The word of an entity declaration: the entities of the game data in use, by their names in the game. */
  | { readonly type: "entity"; readonly prototypes: readonly PrototypeName[] }
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

/** The index of the token that contains `offset` or ends exactly there; -1 when there is none. */
function tokenBefore(tokens: readonly Token[], offset: number): number {
  let low = 0;
  let high = tokens.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (tokens[mid]!.from < offset) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found >= 0 && offset <= tokens[found]!.to ? found : -1;
}

/**
 * The word being typed in front of `offset`, when it so far ends in a hyphen: `small-` is lexed as a word and an operator, and
 * is the beginning of `small-lamp`.
 */
function hyphenatedPartial(tokens: readonly Token[], index: number, offset: number): Token | undefined {
  const [word, hyphen] = [tokens[index - 1], tokens[index]];
  const open = word && hyphen && hyphen.kind === "op" && hyphen.text === "-" && hyphen.to === offset && word.to === hyphen.from && (word.kind === "ident" || word.kind === "word");
  return open ? word : undefined;
}

/** What narrows the properties of a declaration: the operation of a selector, the prototype of a generic entity. */
function variantOf(entity: CstEntity | undefined): PropertyVariant | undefined {
  if (entity?.kind === "entity") return entity.prototype;
  if (entity?.kind !== "selector") return undefined;
  for (const statement of entity.body?.statements ?? []) {
    if (statement.type === "property" && statement.name.text === "operation" && statement.value && (SELECTOR_OPERATIONS as readonly string[]).includes(statement.value.text)) return statement.value.text;
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
  const index = tokenBefore(parse.cst.tokens, offset);
  const token = parse.cst.tokens[index];
  const none = { from: offset, to: offset, prefix: "", expected: [] };
  if (token) {
    const unterminated = token.kind === "string" && !(token.text.length > 1 && token.text.endsWith('"'));
    if (token.kind === "lineComment" || ((token.kind === "blockComment" || token.kind === "string") && (offset < token.to || unterminated))) return none;
    if (token.kind === "blockComment" && !token.text.endsWith("*/")) return none;
  }
  const partial = token && PARTIAL_KINDS.has(token.kind) ? token : hyphenatedPartial(parse.cst.tokens, index, offset);
  const from = partial ? partial.from : offset;
  const entity = parse.cst.circuit?.members.findLast((m): m is CstEntity => m.type === "entity" && m.from <= offset);
  const variant = variantOf(entity);
  const variantFor = (kind: EntityKind): PropertyVariant | undefined => (kind === "selector" || kind === "entity" ? variant : undefined);

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
        // The further conditions of a generic entity start with their role: `logistic when ...`.
        if (kind === "entity" && variant !== undefined) for (const role of conditionRoles(variant)) keywords.add(role);
        expected.push({ type: "property", kind, names: propertyNames(kind, variantFor(kind), section) });
        if (kind === "constant") expected.push({ type: "signal", wildcards: SIGNAL_SLOTS["constant.filter"] });
        // An arithmetic expression starts with its output or, without one, with its first operand.
        else if (kind === "arithmetic") expected.push({ type: "signal", wildcards: SIGNAL_SLOTS["arithmetic.output"] }, { type: "literal", kind: "integer" });
        break;
      }
      case "value": {
        const lookup = lookupProperty(expectation.kind, expectation.property, variantFor(expectation.kind), expectation.section);
        if (lookup.status !== "ok") break;
        const values = enumValues(expectation.kind, expectation.property, variantFor(expectation.kind), expectation.section);
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
      case "entity":
        expected.push({ type: "entity", prototypes: PROTOTYPE_NAMES });
        break;
      case "terminal":
        expected.push({ type: "terminal", entities: [...parse.sourceMap.entities.values()].filter((e) => e.name).map((e) => ({ name: e.name, kind: e.kind, sides: TERMINALS[e.kind] })) });
        break;
      case "side": {
        const target = [...parse.sourceMap.entities.values()].find((e) => e.name === expectation.entity);
        // Only `in` and `out` are written behind a dot; the one point of a pole or a generic entity is its bare name.
        expected.push({ type: "side", entity: expectation.entity, sides: (target ? TERMINALS[target.kind] : TERMINAL_SIDES).filter((side) => side !== "io") });
        break;
      }
      case "literal":
        expected.push(expectation);
        break;
    }
  }
  if (keywords.size) expected.unshift({ type: "keyword", values: [...keywords] });
  return { from, to: partial ? Math.max(partial.to, offset) : offset, prefix: source.slice(from, offset), expected };
}
