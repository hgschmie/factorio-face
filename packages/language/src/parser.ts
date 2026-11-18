// Recursive-descent parser with error recovery. Never throws; a syntax error yields a diagnostic and the parser
// resynchronizes at the next statement or member.

import { COMPARATORS, DIRECTIONS, WILDCARDS, WIRE_COLORS, type EntityKind, type Wildcard } from "@face/model";
import type {
  CstAssign, CstBlock, CstCircuit, CstCondition, CstEntity, CstFacing, CstFile, CstMember, CstNetworks, CstOperand, CstOutput, CstPassedDeclaration, CstPoint, CstProperty, CstSection, CstSigRef,
  CstStatement, CstTerminal, CstWhen, CstWire,
} from "./cst.ts";
import { diagnostic, type Diagnostic, type DiagnosticCode } from "./diagnostics.ts";
import { declaredPrototype } from "./names.ts";
import { ARITHMETIC_OPERATORS, EMPTY_SIGNAL_WORD, NO_NETWORK, SIGNAL_SLOTS, takesEmptySignal, takesUnset, UNSET_WORD } from "./schema.ts";
import { decodeString, encodeString, isTrivia, lex, type Range, type Token } from "./tokens.ts";

/** What the grammar accepts at the end of a source prefix; the raw material for completion. */
export type Expectation =
  | { readonly type: "keyword"; readonly values: readonly string[] }
  | { readonly type: "literal"; readonly kind: "integer" | "number" | "string" | "name" }
  /** The start of a member: the word of an entity declaration, which is a name of the game data. `wire` comes as a keyword. */
  | { readonly type: "entity" }
  | { readonly type: "statement"; readonly kind: EntityKind; readonly section: boolean }
  | { readonly type: "value"; readonly kind: EntityKind; readonly property: string; readonly section: boolean }
  | { readonly type: "signal"; readonly wildcards: readonly Wildcard[] }
  | { readonly type: "terminal" }
  | { readonly type: "side"; readonly entity: string };

export interface SyntaxResult {
  readonly cst: CstFile;
  readonly diagnostics: readonly Diagnostic[];
}

const UNSUPPORTED: ReadonlySet<string> = new Set(["import", "component", "port"]);
const WILDCARD_SET: ReadonlySet<string> = new Set(WILDCARDS);
const COMPARATOR_SET: ReadonlySet<string> = new Set(COMPARATORS);
const DIRECTION_SET: ReadonlySet<string> = new Set(DIRECTIONS);
const ARITHMETIC_SET: ReadonlySet<string> = new Set(ARITHMETIC_OPERATORS);
const VALUE_KEYWORDS: ReadonlySet<string> = new Set(["true", "false", "red", "green", ...WILDCARDS]);

/** What the word of an entity declaration is written as: a bare word of the language that is not reserved, or a string. */
const isDeclarationWord = (t: Token) => t.kind === "ident" || t.kind === "word" || t.kind === "string";
const isSymbol = (t: Token | undefined, text: string) => t !== undefined && t.text === text && (t.kind === "keyword" || t.kind === "punct" || t.kind === "op");
/** `at`, `tile`, `facing` or `{`: what follows the name of an entity declaration. */
const opensEntity = (t: Token | undefined) => isSymbol(t, "at") || isSymbol(t, "tile") || isSymbol(t, "facing") || isSymbol(t, "{");

/**
 * An entity declaration starts at `tokens[index]` (trivia left out): its word, a name and what follows a name. No keyword says
 * so, and no statement of a body reads like it, so this is what ends a body whose closing brace is missing.
 */
function startsEntityAt(tokens: readonly Token[], index: number): boolean {
  const [word, name] = [tokens[index], tokens[index + 1]];
  return word !== undefined && isDeclarationWord(word) && (name?.kind === "ident" || name?.kind === "word") && opensEntity(tokens[index + 2]);
}

/** The words of the complete entity declarations among `tokens`, for an editor that styles them: no token says by itself that it is one. */
export function declarationWords(tokens: readonly Token[]): Set<Token> {
  const significant = tokens.filter((token) => !isTrivia(token) && token.kind !== "error");
  return new Set(significant.filter((_, index) => startsEntityAt(significant, index)));
}

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
  /** The declarations that were read past (`passDeclaration`), of the circuit or of the fragment. */
  readonly passed: CstPassedDeclaration[] = [];
  private pos = 0;
  private lastEnd = 0;
  /** Token index of the most recent error, used to avoid reporting the same token twice. */
  private errorPos = -1;
  private failedAtEnd = false;

  constructor(private readonly tokens: readonly Token[], private readonly expectations?: Expectation[]) {}

  private get tok(): Token {
    return this.tokens[this.pos]!;
  }

  private peek(ahead = 1): Token {
    return this.tokens[Math.min(this.pos + ahead, this.tokens.length - 1)]!;
  }

  /** An entity declaration starts `ahead` tokens from here (`startsEntityAt`). Between the members of a circuit a declaration is recognized by less (`members`). */
  private startsEntity(ahead = 0): boolean {
    return startsEntityAt(this.tokens, this.pos + ahead);
  }

  private startsMember(ahead = 0): boolean {
    return this.is("wire", this.peek(ahead)) || this.startsEntity(ahead);
  }

  /** At a declaration or at a word that belongs in front of a circuit: nothing of an entity body. */
  private outsideBody(): boolean {
    const token = this.tok;
    return this.startsMember() || (token.kind === "keyword" && (token.text === "circuit" || UNSUPPORTED.has(token.text)));
  }

  private get eof(): boolean {
    return this.tok.kind === "eof";
  }

  private is(text: string, token: Token = this.tok): boolean {
    return isSymbol(token, text);
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
      if (this.outsideBody()) break;
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
    return { from: keyword.from, to: this.lastEnd, keyword, name, open, close, members, passed: this.passed };
  }

  /** The members of a circuit body up to its closing brace; a fragment has no braces around it and ends with the input. */
  private members(braced: boolean): CstMember[] {
    const members: CstMember[] = [];
    for (;;) {
      this.note({ type: "entity" });
      this.keywords("wire");
      const token = this.tok;
      if (token.kind === "eof") break;
      if (this.is("}")) {
        // A closing brace followed by more members is a stray one, not the end of the circuit.
        if (braced && !this.startsMember(1)) break;
        this.error(token, "Unexpected '}'");
        this.next();
      } else if (this.is(";") || this.is(",")) this.next();
      else if (this.is("wire")) members.push(this.wire());
      else if (isDeclarationWord(token) && (this.errorPos !== this.pos || this.startsEntity())) {
        // Between the members every word starts a declaration: one that is being typed has nothing behind it yet. A word the
        // member before it stumbled over is the rest of that one, unless a whole declaration follows.
        const entity = this.entity();
        if (entity) members.push(entity);
      } else if (token.kind === "keyword" && UNSUPPORTED.has(token.text)) this.unsupported();
      else if (this.is("circuit")) {
        this.error(token, braced ? "A file contains exactly one circuit" : "A circuit cannot follow entity or wire declarations");
        this.next();
        this.skip(() => false);
      } else if (token.kind === "keyword" && this.peek().kind === "ident" && opensEntity(this.peek(2))) {
        this.error(token, `'${token.text}' is a reserved word; an entity of this name is declared in quotes: ${encodeString(token.text)} ${this.peek().text}`);
        this.passDeclaration(this.next());
      } else this.skip(() => false, "Expected an entity or wire declaration");
    }
    return members;
  }

  /** Entity and wire declarations without a circuit around them; a whole circuit is taken for its members. */
  fragment(all: readonly Token[], length: number): readonly CstMember[] {
    return this.is("circuit") ? (this.file(all, length).circuit?.members ?? []) : this.members(false);
  }

  /**
   * An entity declaration. Its word names an entity of the game, and the kind of that one decides how the body is read. A name
   * the game data in use does not have, or has without a kind, is one error on the word, and the declaration is no entity.
   */
  private entity(): CstEntity | undefined {
    const word = this.next();
    const prototype = word.kind === "string" ? decodeString(word.text) : word.text;
    const declared = declaredPrototype(prototype);
    if ("problem" in declared) {
      this.error(word, declared.message, declared.problem === "unknown" ? "unknown-prototype" : "unsupported-prototype");
      this.passDeclaration(word);
      return undefined;
    }
    const header = this.header();
    let body: CstBlock | undefined;
    if (this.is("{")) body = this.block(declared.kind, false);
    else this.expected("'{'");
    return { type: "entity", from: word.from, to: this.lastEnd, word, prototype, kind: declared.kind, ...header, body };
  }

  /** What stands between the word of an entity declaration and its block: the name and the clauses. */
  private header(): Pick<CstEntity, "name" | "at" | "tile" | "facing"> {
    this.note({ type: "literal", kind: "name" });
    let name: Token | undefined;
    const token = this.tok;
    // A word that starts the next declaration is not the name of this one.
    if (token.kind === "ident" && !this.startsEntity()) name = this.next();
    else if ((token.kind === "keyword" || token.kind === "word") && opensEntity(this.peek())) {
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
    return { name, at, tile, facing };
  }

  /**
   * Reads past the rest of a declaration that is no entity (`word` is the one error it has): the name, the clauses and the
   * block by its braces, whatever they say. It ends before the next declaration where the closing brace is missing. The name is
   * kept (`passed`).
   */
  private passDeclaration(word: Token): void {
    const { length } = this.diagnostics;
    const { errorPos } = this;
    const { name } = this.header();
    if (this.is("{")) {
      let depth = 0;
      do {
        if (this.is("{")) depth++;
        else if (this.is("}")) depth--;
        this.next();
      } while (depth > 0 && !this.eof && !this.outsideBody());
      // Inside the block nothing is expected: what an entity that is none takes is not known.
      if (depth > 0 && this.eof) this.failedAtEnd = true;
    } else if (this.eof) this.failedAtEnd = true;
    this.diagnostics.length = length;
    this.errorPos = errorPos;
    this.passed.push({ from: word.from, to: this.lastEnd, word, name });
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
      if (this.eof || this.is("}") || this.outsideBody()) break;
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

  /** `<role> when`: a word in front of `when` names one of the further conditions of a generic entity. */
  private startsRoleCondition(): boolean {
    return (this.tok.kind === "ident" || this.tok.kind === "word") && this.is("when", this.peek());
  }

  private startsStatement(): boolean {
    const token = this.tok;
    if (isSignalToken(token) || this.startsRoleCondition()) return true;
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
    if (this.startsRoleCondition()) return this.when(kind, this.next());
    // A word at the end of the input may become a property or the role of a condition.
    if (kind === "entity" && !section && (token.kind === "ident" || token.kind === "word") && this.peek().kind === "eof") {
      this.next();
      this.keywords("when");
      this.expected("'=' or 'when'");
    }
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
    // A word or a string that starts the next declaration is not the value.
    if (accepted && !this.startsEntity()) value = this.next();
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

  private when(kind: EntityKind, role?: Token): CstWhen {
    const keyword = this.next();
    const conditions: CstCondition[] = [];
    let join: Token | undefined;
    for (;;) {
      const condition = this.condition(kind, join);
      conditions.push(condition);
      if (!condition.second && !condition.unset) break;
      if (kind === "decider" && !condition.unset) this.keywords("and", "or");
      if (!this.is("and") && !this.is("or")) break;
      join = this.next();
    }
    return { type: "when", from: role?.from ?? keyword.from, to: this.lastEnd, role, keyword, conditions };
  }

  private condition(kind: EntityKind, join: Token | undefined): CstCondition {
    const unsettable = takesUnset(kind) && !join;
    this.note({ type: "signal", wildcards: slot(kind, "condition") });
    if (unsettable) this.keywords(UNSET_WORD);
    if (takesEmptySignal(kind)) this.keywords(EMPTY_SIGNAL_WORD);
    // `unset` is a plain word that only has this meaning here. It is read wherever a condition stands, so that the analysis can say where it does not belong.
    const unset = this.tok.kind === "ident" && this.tok.text === UNSET_WORD && !this.startsEntity() ? this.next() : undefined;
    // So is a number on the left side: the analysis knows where 0 stands for the empty signal slot.
    if (!unset && !isSignalToken(this.tok) && this.tok.kind !== "int") {
      this.expected(unsettable ? `a signal or '${UNSET_WORD}'` : takesEmptySignal(kind) ? `a signal or ${EMPTY_SIGNAL_WORD}` : "a signal");
      return { from: join?.from ?? this.lastEnd, to: this.lastEnd, join };
    }
    const first = unset ? undefined : this.sigref();
    const compares = (): boolean => this.tok.kind === "op" && COMPARATOR_SET.has(this.tok.text);
    let comparator: Token | undefined;
    let second: CstOperand | undefined;
    if (unset) {
      // Nothing belongs behind it. A comparison that stands there is read with it and is the one error of the analysis.
      if (compares()) comparator = this.next();
      if (comparator && (this.tok.kind === "int" || isSignalToken(this.tok))) second = this.operand(kind);
    } else {
      this.keywords(...COMPARATORS);
      if (compares()) {
        comparator = this.next();
        second = this.operand(kind);
      } else this.expected("a comparator (<, >, =, !=, <=, >=)");
    }
    return { from: join?.from ?? (unset ?? first!).from, to: this.lastEnd, join, unset, first, comparator, second };
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
    const name = this.tok.kind === "string" && !this.startsEntity() ? this.next() : undefined;
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
    if (token.kind === "ident" && !this.startsEntity()) name = this.next();
    else if (token.kind === "keyword" && !this.outsideBody() && this.is(".", this.peek())) {
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
      if (this.is("in") || this.is("out") || ((candidate.kind === "ident" || candidate.kind === "word") && !this.startsEntity())) side = this.next();
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
  /** The declarations among them that are no entities. */
  readonly passed: readonly CstPassedDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parses a circuit fragment: entity and wire declarations as they stand inside a circuit block, without the block. This is
 * the text form of a copied selection. The source of a whole circuit is accepted too and yields its members.
 */
export function parseFragment(source: string): FragmentSyntax {
  const { parser, tokens } = parserFor(source);
  const members = parser.fragment(tokens, source.length);
  return { members, passed: parser.passed, diagnostics: parser.diagnostics };
}

/** Everything the grammar would accept directly after `prefix`. */
export function expectationsAfter(prefix: string): Expectation[] {
  const expectations: Expectation[] = [];
  run(prefix, expectations);
  return expectations;
}
