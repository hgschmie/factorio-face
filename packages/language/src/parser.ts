// Recursive-descent parser with error recovery. Never throws; a syntax error yields a diagnostic and the parser
// resynchronizes at the next statement or member.

import { COMPARATORS, DIRECTIONS, ENTITY_KINDS, WILDCARDS, WIRE_COLORS, type EntityKind, type Wildcard } from "@face/model";
import type { CstAssign, CstBlock, CstCircuit, CstCondition, CstEntity, CstFacing, CstFile, CstMember, CstNetworks, CstOperand, CstOutput, CstPoint, CstProperty, CstSection, CstSigRef, CstStatement, CstTerminal, CstWhen, CstWire } from "./cst.ts";
import { diagnostic, type Diagnostic, type DiagnosticCode } from "./diagnostics.ts";
import { ARITHMETIC_OPERATORS, NO_NETWORK, SIGNAL_SLOTS } from "./schema.ts";
import { isTrivia, lex, type Range, type Token } from "./tokens.ts";

/** What the grammar accepts at the end of a source prefix; the raw material for completion. */
export type Expectation =
  | { readonly type: "keyword"; readonly values: readonly string[] }
  | { readonly type: "literal"; readonly kind: "integer" | "number" | "string" | "name" }
  | { readonly type: "statement"; readonly kind: EntityKind; readonly section: boolean }
  | { readonly type: "value"; readonly kind: EntityKind; readonly property: string; readonly section: boolean }
  | { readonly type: "signal"; readonly wildcards: readonly Wildcard[] }
  | { readonly type: "terminal" }
  | { readonly type: "side"; readonly entity: string };

export interface SyntaxResult {
  readonly cst: CstFile;
  readonly diagnostics: readonly Diagnostic[];
}

const ENTITY_KIND_SET: ReadonlySet<string> = new Set(ENTITY_KINDS);
const UNSUPPORTED: ReadonlySet<string> = new Set(["import", "component", "port"]);
const WILDCARD_SET: ReadonlySet<string> = new Set(WILDCARDS);
const COMPARATOR_SET: ReadonlySet<string> = new Set(COMPARATORS);
const DIRECTION_SET: ReadonlySet<string> = new Set(DIRECTIONS);
const ARITHMETIC_SET: ReadonlySet<string> = new Set(ARITHMETIC_OPERATORS);
const VALUE_KEYWORDS: ReadonlySet<string> = new Set(["true", "false", "red", "green", ...WILDCARDS]);
const MEMBER_KEYWORDS: readonly string[] = [...ENTITY_KINDS, "wire"];

const isMemberStart = (t: Token) => t.kind === "keyword" && (ENTITY_KIND_SET.has(t.text) || t.text === "wire");
const isOutsideBody = (t: Token) => isMemberStart(t) || (t.kind === "keyword" && (t.text === "circuit" || UNSUPPORTED.has(t.text)));
const isSignalToken = (t: Token) => t.kind === "signal" || (t.kind === "keyword" && WILDCARD_SET.has(t.text));
const isWordLike = (t: Token) => t.kind === "ident" || t.kind === "word" || t.kind === "keyword";

function describe(token: Token): string {
  if (token.kind === "eof") return "the end of the file";
  return `'${token.text.length > 24 ? `${token.text.slice(0, 24)}...` : token.text}'`;
}

function slot(kind: EntityKind, role: string): readonly Wildcard[] {
  return (SIGNAL_SLOTS as Readonly<Record<string, readonly Wildcard[]>>)[`${kind}.${role}`] ?? [];
}

class Parser {
  readonly diagnostics: Diagnostic[] = [];
  private pos = 0;
  private lastEnd = 0;
  /** Token index of the most recent error, used to avoid reporting the same token twice. */
  private errorPos = -1;
  private failedAtEnd = false;

  constructor(private readonly tokens: readonly Token[], private readonly expectations?: Expectation[]) {}

  private get tok(): Token {
    return this.tokens[this.pos]!;
  }

  private peek(): Token {
    return this.tokens[Math.min(this.pos + 1, this.tokens.length - 1)]!;
  }

  private get eof(): boolean {
    return this.tok.kind === "eof";
  }

  private is(text: string, token: Token = this.tok): boolean {
    return token.text === text && (token.kind === "keyword" || token.kind === "punct" || token.kind === "op");
  }

  private next(): Token {
    const token = this.tok;
    if (token.kind !== "eof") {
      this.pos++;
      this.lastEnd = token.to;
    }
    return token;
  }

  /** Records what is acceptable at the end of the input, up to the first error there. */
  private note(expectation: Expectation): void {
    if (this.expectations && this.eof && !this.failedAtEnd) this.expectations.push(expectation);
  }

  private keywords(...values: readonly string[]): void {
    this.note({ type: "keyword", values });
  }

  private error(range: Range, message: string, code: DiagnosticCode = "syntax-error"): void {
    this.diagnostics.push(diagnostic(range, code, message));
    this.errorPos = this.pos;
    if (this.eof) this.failedAtEnd = true;
  }

  private expected(what: string): void {
    if (this.errorPos === this.pos) return;
    const token = this.tok;
    this.error(token.kind === "eof" ? { from: this.lastEnd, to: this.lastEnd } : token, `Expected ${what} but found ${describe(token)}`);
  }

  private take(text: string): Token | undefined {
    if (this.is(text)) return this.next();
    this.expected(`'${text}'`);
    return undefined;
  }

  /** Skips to the next member start, an unbalanced `}` or, outside nested braces, a token where `stop` holds. */
  private skip(stop: () => boolean, message?: string): void {
    const start = this.pos;
    const from = this.tok.from;
    let depth = 0;
    while (!this.eof) {
      if (isOutsideBody(this.tok)) break;
      if (this.is("{")) depth++;
      else if (this.is("}")) {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && this.pos > start && stop()) break;
      this.next();
    }
    if (message && this.pos > start && this.errorPos !== start) this.error({ from, to: this.lastEnd }, message);
  }

  file(all: readonly Token[], length: number): CstFile {
    this.unsupported();
    this.keywords("circuit");
    if (!this.is("circuit")) {
      this.expected("'circuit'");
      while (!this.eof && !this.is("circuit")) this.next();
    }
    const circuit = this.is("circuit") ? this.circuit() : undefined;
    if (!this.eof) {
      const from = this.tok.from;
      while (!this.eof) this.next();
      this.error({ from, to: this.lastEnd }, "Unexpected content after the circuit");
    }
    return { from: 0, to: length, tokens: all, circuit };
  }

  private unsupported(): void {
    while (this.tok.kind === "keyword" && UNSUPPORTED.has(this.tok.text)) {
      const token = this.next();
      this.error(token, `'${token.text}' is reserved for reusable components and is not supported yet`, "unsupported-feature");
      this.skip(() => false);
    }
  }

  private circuit(): CstCircuit {
    const keyword = this.next();
    this.note({ type: "literal", kind: "string" });
    let name: Token | undefined;
    if (this.tok.kind === "string") name = this.next();
    else this.expected("the circuit name in double quotes");
    const open = this.take("{");
    const members = this.members(true);
    let close: Token | undefined;
    if (this.is("}")) close = this.next();
    else this.expected("'}' to close the circuit");
    return { from: keyword.from, to: this.lastEnd, keyword, name, open, close, members };
  }

  /** The members of a circuit body up to its closing brace; a fragment has no braces around it and ends with the input. */
  private members(braced: boolean): CstMember[] {
    const members: CstMember[] = [];
    for (;;) {
      this.keywords(...MEMBER_KEYWORDS);
      const token = this.tok;
      if (token.kind === "eof") break;
      if (this.is("}")) {
        // A closing brace followed by more members is a stray one, not the end of the circuit.
        if (braced && !isMemberStart(this.peek())) break;
        this.error(token, "Unexpected '}'");
        this.next();
      } else if (this.is(";") || this.is(",")) this.next();
      else if (token.kind === "keyword" && ENTITY_KIND_SET.has(token.text)) members.push(this.entity());
      else if (this.is("wire")) members.push(this.wire());
      else if (token.kind === "keyword" && UNSUPPORTED.has(token.text)) this.unsupported();
      else if (this.is("circuit")) {
        this.error(token, braced ? "A file contains exactly one circuit" : "A circuit cannot follow entity or wire declarations");
        this.next();
        this.skip(() => false);
      } else this.skip(() => false, "Expected an entity or wire declaration");
    }
    return members;
  }

  /** Entity and wire declarations without a circuit around them; a whole circuit is taken for its members. */
  fragment(all: readonly Token[], length: number): readonly CstMember[] {
    return this.is("circuit") ? (this.file(all, length).circuit?.members ?? []) : this.members(false);
  }

  private entity(): CstEntity {
    const keyword = this.next();
    const kind = keyword.text as EntityKind;
    this.note({ type: "literal", kind: "name" });
    let name: Token | undefined;
    const token = this.tok;
    const following = this.peek();
    if (token.kind === "ident") name = this.next();
    else if ((token.kind === "keyword" || token.kind === "word") && (this.is("at", following) || this.is("tile", following) || this.is("facing", following) || this.is("{", following))) {
      this.error(token, token.kind === "keyword" ? `'${token.text}' is a reserved keyword and cannot be used as an entity name` : `'${token.text}' is not a valid entity name`);
      name = this.next();
    } else this.expected("an entity name");

    let at: CstPoint | undefined;
    let tile: CstPoint | undefined;
    let facing: CstFacing | undefined;
    for (;;) {
      this.keywords(...(at ? [] : ["at"]), ...(tile ? [] : ["tile"]), ...(facing ? [] : ["facing"]));
      if (this.is("at")) {
        const clause = this.point();
        if (at) this.error(clause, "Duplicate 'at' clause");
        else at = clause;
      } else if (this.is("tile")) {
        const clause = this.point();
        if (tile) this.error(clause, "Duplicate 'tile' clause");
        else tile = clause;
      } else if (this.is("facing")) {
        const clause = this.facing();
        if (facing) this.error(clause, "Duplicate 'facing' clause");
        else facing = clause;
      } else break;
    }
    let body: CstBlock | undefined;
    if (this.is("{")) body = this.block(kind, false);
    else this.expected("'{'");
    return { type: "entity", from: keyword.from, to: this.lastEnd, kind, keyword, name, at, tile, facing, body };
  }

  private point(): CstPoint {
    const keyword = this.next();
    let x: Token | undefined;
    let y: Token | undefined;
    if (this.take("(")) {
      x = this.number();
      if (x && this.take(",")) {
        y = this.number();
        if (y) this.take(")");
      }
    }
    return { from: keyword.from, to: this.lastEnd, keyword, x, y };
  }

  private number(): Token | undefined {
    this.note({ type: "literal", kind: "number" });
    if (this.tok.kind === "int" || this.tok.kind === "decimal") return this.next();
    this.expected("a number");
    return undefined;
  }

  private facing(): CstFacing {
    const keyword = this.next();
    this.keywords(...DIRECTIONS);
    let direction: Token | undefined;
    if (this.tok.kind === "keyword" && DIRECTION_SET.has(this.tok.text)) direction = this.next();
    else this.expected("north, east, south or west");
    return { from: keyword.from, to: this.lastEnd, keyword, direction };
  }

  private block(kind: EntityKind, section: boolean): CstBlock {
    const open = this.next();
    const statements: CstStatement[] = [];
    for (;;) {
      this.note({ type: "statement", kind, section });
      if (this.eof || this.is("}") || isOutsideBody(this.tok)) break;
      if (this.is(";") || this.is(",")) {
        this.next();
        continue;
      }
      const statement = this.statement(kind, section);
      if (statement) statements.push(statement);
      else this.skip(() => this.startsStatement(), `Unexpected ${describe(this.tok)}; expected a statement or '}'`);
    }
    let close: Token | undefined;
    if (this.is("}")) close = this.next();
    else this.error(open, "Missing '}' to close this block");
    return { from: open.from, to: this.lastEnd, open, close, statements };
  }

  private startsStatement(): boolean {
    const token = this.tok;
    if (isSignalToken(token)) return true;
    if (token.kind === "keyword" && (token.text === "when" || token.text === "else" || token.text === "output" || token.text === "section")) return true;
    return isWordLike(token) && this.is("=", this.peek());
  }

  private statement(kind: EntityKind, section: boolean): CstStatement | undefined {
    const token = this.tok;
    const assignment = this.is("=", this.peek());
    if (token.kind === "keyword" && !assignment) {
      if (token.text === "when") return this.when(kind);
      if (token.text === "else") return this.output(kind, this.next());
      if (token.text === "output") return this.output(kind);
      if (token.text === "section") return this.section(kind, section);
    }
    if (isSignalToken(token)) return this.assign(kind);
    if (isWordLike(token) && assignment) return this.property(kind, section);
    return undefined;
  }

  private property(kind: EntityKind, section: boolean): CstProperty {
    const name = this.next();
    this.next();
    this.note({ type: "value", kind, property: name.text, section });
    const token = this.tok;
    let value: Token | undefined;
    const accepted =
      token.kind === "int" || token.kind === "decimal" || token.kind === "string" || token.kind === "color" || token.kind === "signal" ||
      (token.kind === "op" && COMPARATOR_SET.has(token.text)) ||
      (token.kind === "keyword" && VALUE_KEYWORDS.has(token.text) && !this.is("=", this.peek())) ||
      ((token.kind === "ident" || token.kind === "word") && !this.is("=", this.peek()));
    if (accepted) value = this.next();
    else this.expected(`a value for '${name.text}'`);
    return { type: "property", from: name.from, to: this.lastEnd, name, value };
  }

  private sigref(): CstSigRef {
    const signal = this.next();
    const networks = this.is("[") ? this.networks() : undefined;
    return { from: signal.from, to: this.lastEnd, signal, networks };
  }

  private networks(): CstNetworks {
    const open = this.next();
    this.keywords(...WIRE_COLORS, NO_NETWORK);
    let selection: Token | undefined;
    // `none` is a plain word that only has this meaning here; it stays usable as an entity name.
    if (this.is("red") || this.is("green") || (this.tok.kind === "ident" && this.tok.text === NO_NETWORK)) {
      selection = this.next();
      this.take("]");
    } else this.expected("'red', 'green' or 'none'");
    return { from: open.from, to: this.lastEnd, selection };
  }

  private operand(kind: EntityKind): CstOperand | undefined {
    if (kind !== "constant") this.note({ type: "signal", wildcards: slot(kind, "operand") });
    this.note({ type: "literal", kind: "integer" });
    if (this.tok.kind === "int") {
      const token = this.next();
      return { type: "int", from: token.from, to: token.to, token };
    }
    if (isSignalToken(this.tok)) {
      const ref = this.sigref();
      return { type: "signal", from: ref.from, to: ref.to, ref };
    }
    this.expected(kind === "constant" ? "an integer" : "a signal or an integer");
    return undefined;
  }

  private assign(kind: EntityKind): CstAssign {
    const target = this.sigref();
    let first: CstOperand | undefined;
    let operator: Token | undefined;
    let second: CstOperand | undefined;
    if (this.take("=")) {
      first = this.operand(kind);
      if (first) {
        if (kind === "arithmetic") this.keywords(...ARITHMETIC_OPERATORS);
        if ((this.tok.kind === "op" || this.tok.kind === "keyword") && ARITHMETIC_SET.has(this.tok.text)) {
          operator = this.next();
          second = this.operand(kind);
        } else if (kind === "arithmetic") this.expected("an arithmetic operator");
      }
    }
    return { type: "assign", from: target.from, to: this.lastEnd, target, first, operator, second };
  }

  private when(kind: EntityKind): CstWhen {
    const keyword = this.next();
    const conditions: CstCondition[] = [];
    let join: Token | undefined;
    for (;;) {
      const condition = this.condition(kind, join);
      conditions.push(condition);
      if (!condition.second) break;
      if (kind === "decider") this.keywords("and", "or");
      if (!this.is("and") && !this.is("or")) break;
      join = this.next();
    }
    return { type: "when", from: keyword.from, to: this.lastEnd, keyword, conditions };
  }

  private condition(kind: EntityKind, join: Token | undefined): CstCondition {
    this.note({ type: "signal", wildcards: slot(kind, "condition") });
    if (!isSignalToken(this.tok)) {
      this.expected("a signal");
      return { from: join?.from ?? this.lastEnd, to: this.lastEnd, join };
    }
    const first = this.sigref();
    let comparator: Token | undefined;
    let second: CstOperand | undefined;
    this.keywords(...COMPARATORS);
    if (this.tok.kind === "op" && COMPARATOR_SET.has(this.tok.text)) {
      comparator = this.next();
      second = this.operand(kind);
    } else this.expected("a comparator (<, >, =, !=, <=, >=)");
    return { from: join?.from ?? first.from, to: this.lastEnd, join, first, comparator, second };
  }

  private output(kind: EntityKind, elseToken?: Token): CstOutput {
    const from = elseToken?.from ?? this.tok.from;
    let signal: CstSigRef | undefined;
    let value: Token | undefined;
    let networks: CstNetworks | undefined;
    if (elseToken) this.keywords("output");
    if (!this.is("output")) this.expected("'output' after 'else'");
    else {
      this.next();
      this.note({ type: "signal", wildcards: slot(kind, "output") });
      if (!isSignalToken(this.tok)) this.expected("a signal");
      else {
        signal = this.sigref();
        if (this.take("=")) {
          this.keywords("input");
          this.note({ type: "literal", kind: "integer" });
          if (this.tok.kind === "int") value = this.next();
          else if (this.is("input")) {
            value = this.next();
            if (this.is("[")) networks = this.networks();
          } else this.expected("an integer or 'input'");
        }
      }
    }
    return { type: "output", from, to: this.lastEnd, else: elseToken, signal, value, networks };
  }

  private section(kind: EntityKind, nested: boolean): CstSection {
    const keyword = this.next();
    if (nested) this.error(keyword, "Sections cannot be nested");
    this.note({ type: "literal", kind: "string" });
    const name = this.tok.kind === "string" ? this.next() : undefined;
    let body: CstBlock | undefined;
    if (this.is("{")) body = this.block(kind, true);
    else this.expected("'{'");
    return { type: "section", from: keyword.from, to: this.lastEnd, keyword, name, body };
  }

  private wire(): CstWire {
    const keyword = this.next();
    this.keywords(...WIRE_COLORS);
    let color: Token | undefined;
    if (this.is("red") || this.is("green")) color = this.next();
    else this.expected("a wire color (red or green)");
    let b: CstTerminal | undefined;
    const a = this.terminal();
    if (a && (!a.dot || a.side)) {
      this.keywords("<->");
      if (this.take("<->")) b = this.terminal();
    }
    return { type: "wire", from: keyword.from, to: this.lastEnd, keyword, color, a, b };
  }

  private terminal(): CstTerminal | undefined {
    this.note({ type: "terminal" });
    const token = this.tok;
    let name: Token;
    if (token.kind === "ident") name = this.next();
    else if (token.kind === "keyword" && !isOutsideBody(token) && this.is(".", this.peek())) {
      this.error(token, `'${token.text}' is a reserved keyword and cannot be an entity name`);
      name = this.next();
    } else {
      this.expected("an entity name");
      return undefined;
    }
    // Without a dot the name alone is the terminal: the one connection point of an entity that has neither input nor output.
    let dot: Token | undefined;
    let side: Token | undefined;
    if (this.is(".")) {
      dot = this.next();
      this.note({ type: "side", entity: name.text });
      const candidate = this.tok;
      if (this.is("in") || this.is("out") || candidate.kind === "ident" || candidate.kind === "word") side = this.next();
      else this.expected("'in' or 'out'");
    }
    return { from: name.from, to: this.lastEnd, name, dot, side };
  }
}

function parserFor(source: string, expectations?: Expectation[]): { parser: Parser; tokens: readonly Token[] } {
  const { tokens, errors } = lex(source);
  // Error tokens are reported once by the lexer and hidden from the parser so that it can carry on.
  const significant = tokens.filter((t) => !isTrivia(t) && t.kind !== "error");
  significant.push({ kind: "eof", from: source.length, to: source.length, text: "" });
  const parser = new Parser(significant, expectations);
  for (const error of errors) parser.diagnostics.push(diagnostic(error, "syntax-error", error.message));
  return { parser, tokens };
}

function run(source: string, expectations?: Expectation[]): SyntaxResult {
  const { parser, tokens } = parserFor(source, expectations);
  const cst = parser.file(tokens, source.length);
  return { cst, diagnostics: parser.diagnostics };
}

/** Parses `source` into a concrete syntax tree plus lexical and syntax diagnostics. */
export function parse(source: string): SyntaxResult {
  return run(source);
}

export interface FragmentSyntax {
  readonly members: readonly CstMember[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parses a circuit fragment: entity and wire declarations as they stand inside a circuit block, without the block. This is
 * the text form of a copied selection. The source of a whole circuit is accepted too and yields its members.
 */
export function parseFragment(source: string): FragmentSyntax {
  const { parser, tokens } = parserFor(source);
  const members = parser.fragment(tokens, source.length);
  return { members, diagnostics: parser.diagnostics };
}

/** Everything the grammar would accept directly after `prefix`. */
export function expectationsAfter(prefix: string): Expectation[] {
  const expectations: Expectation[] = [];
  run(prefix, expectations);
  return expectations;
}
