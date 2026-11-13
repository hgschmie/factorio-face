// Lossless lexer. Every UTF-16 code unit of the source belongs to exactly one token; whitespace and comments are trivia tokens.

import { isSignalKind, signal, type SignalId } from "@face/model";

export const KEYWORDS = [
  "circuit", "constant", "arithmetic", "decider", "selector", "lamp", "pole", "speaker", "wire", "red", "green", "at", "tile", "facing", "north", "east", "south", "west",
  "in", "out", "when", "and", "or", "output", "else", "input", "section", "each", "anything", "everything", "true", "false", "AND", "OR", "XOR",
  "import", "component", "port",
] as const;
export type Keyword = (typeof KEYWORDS)[number];

const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);

export function isKeyword(text: string): text is Keyword {
  return KEYWORD_SET.has(text);
}

/** `eof` is only used by the parser's sentinel; `tokenize` never returns it. */
export type TokenKind = "whitespace" | "lineComment" | "blockComment" | "keyword" | "ident" | "word" | "int" | "decimal" | "string" | "signal" | "color" | "punct" | "op" | "error" | "eof";

export interface Range {
  readonly from: number;
  readonly to: number;
}

export interface Token extends Range {
  readonly kind: TokenKind;
  readonly text: string;
}

export interface LexError extends Range {
  readonly message: string;
}

export function isTrivia(token: Token): boolean {
  return token.kind === "whitespace" || token.kind === "lineComment" || token.kind === "blockComment";
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True for a syntactically valid entity name (keywords included; check `isKeyword` separately). */
export function isIdentifier(text: string): boolean {
  return IDENTIFIER.test(text);
}

const isDigit = (c: number) => c >= 48 && c <= 57;
const isIdentStart = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isIdentPart = (c: number) => isIdentStart(c) || isDigit(c);
const isNamePart = (c: number) => isIdentPart(c) || c === 45 || c === 46;
const isHexDigit = (c: number) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 || c === 0xa0 || c === 0xfeff;

/** The escapes besides `\"` and `\\`: the letter after the backslash and the character it stands for. A string is always written on one line. */
const ESCAPE_LETTERS: ReadonlyMap<string, string> = new Map([["n", "\n"], ["t", "\t"], ["r", "\r"]]);
const ESCAPED_LETTERS: ReadonlyMap<string, string> = new Map([...ESCAPE_LETTERS].map(([letter, character]) => [character, letter]));

const QUOTE = 34, BACKSLASH = 92, NEWLINE = 10, SLASH = 47, STAR = 42, MINUS = 45, COLON = 58, AT = 64, HASH = 35, DOT = 46;

const PUNCTUATION = "{}()[],;.";
const OPERATORS = ["<->", "<<", ">>", "<=", ">=", "!=", "=", "<", ">", "*", "/", "+", "-", "%", "^"] as const;

/** After these a `-` is a binary operator; anywhere else a `-` directly followed by a digit is a sign. */
function endsOperand(token: Token): boolean {
  switch (token.kind) {
    case "int": case "decimal": case "ident": case "word": case "signal": case "string": case "color":
      return true;
    case "keyword":
      return token.text === "each" || token.text === "anything" || token.text === "everything" || token.text === "input";
    case "punct":
      return token.text === ")" || token.text === "]";
    default:
      return false;
  }
}

export function lex(source: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  const length = source.length;
  let previous: Token | undefined;
  let i = 0;

  const push = (kind: TokenKind, from: number, to: number) => {
    const token: Token = { kind, from, to, text: source.slice(from, to) };
    tokens.push(token);
    if (kind !== "whitespace" && kind !== "lineComment" && kind !== "blockComment") previous = token;
  };

  // Returns the offset after a string starting at `from`; stops before a line break when the string is unterminated.
  const scanString = (from: number): number => {
    let j = from + 1;
    while (j < length) {
      const c = source.charCodeAt(j);
      if (c === NEWLINE) break;
      if (c === QUOTE) return j + 1;
      if (c === BACKSLASH && j + 1 < length && source.charCodeAt(j + 1) !== NEWLINE) {
        const escaped = source.charCodeAt(j + 1);
        if (escaped !== QUOTE && escaped !== BACKSLASH && !ESCAPE_LETTERS.has(source[j + 1]!)) errors.push({ from: j, to: j + 2, message: `Invalid escape sequence '${source.slice(j, j + 2)}'; use \\", \\\\, \\n, \\t or \\r` });
        j += 2;
      } else j++;
    }
    errors.push({ from, to: j, message: "Unterminated string" });
    return j;
  };

  const scanName = (from: number): number => {
    if (from < length && source.charCodeAt(from) === QUOTE) return scanString(from);
    let j = from;
    if (j < length && isIdentPart(source.charCodeAt(j))) while (j < length && isNamePart(source.charCodeAt(j))) j++;
    return j;
  };

  while (i < length) {
    const start = i;
    const c = source.charCodeAt(i);
    const next = i + 1 < length ? source.charCodeAt(i + 1) : 0;

    if (isSpace(c)) {
      while (i < length && isSpace(source.charCodeAt(i))) i++;
      push("whitespace", start, i);
    } else if (c === SLASH && next === SLASH) {
      while (i < length && source.charCodeAt(i) !== NEWLINE) i++;
      push("lineComment", start, i);
    } else if (c === SLASH && next === STAR) {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? length : end + 2;
      if (end < 0) errors.push({ from: start, to: i, message: "Unterminated block comment" });
      push("blockComment", start, i);
    } else if (c === QUOTE) {
      i = scanString(i);
      push("string", start, i);
    } else if (isIdentStart(c)) {
      i++;
      while (i < length && isIdentPart(source.charCodeAt(i))) i++;
      while (i + 1 < length && source.charCodeAt(i) === MINUS && isIdentPart(source.charCodeAt(i + 1))) {
        i += 2;
        while (i < length && isIdentPart(source.charCodeAt(i))) i++;
      }
      if (i < length && source.charCodeAt(i) === COLON) {
        i = scanName(i + 1);
        if (i < length && source.charCodeAt(i) === AT) i = scanName(i + 1);
        push("signal", start, i);
      } else {
        const text = source.slice(start, i);
        push(KEYWORD_SET.has(text) ? "keyword" : text.includes("-") ? "word" : "ident", start, i);
      }
    } else if (isDigit(c) || (c === MINUS && isDigit(next) && !(previous && endsOperand(previous)))) {
      if (c === MINUS) i++;
      let kind: TokenKind = "int";
      if (source.charCodeAt(i) === 48 && (source.charCodeAt(i + 1) | 32) === 120) {
        i += 2;
        const digits = i;
        while (i < length && isHexDigit(source.charCodeAt(i))) i++;
        if (i === digits) kind = "error";
      } else {
        while (i < length && isDigit(source.charCodeAt(i))) i++;
        if (i + 1 < length && source.charCodeAt(i) === DOT && isDigit(source.charCodeAt(i + 1))) {
          kind = "decimal";
          i++;
          while (i < length && isDigit(source.charCodeAt(i))) i++;
        }
      }
      if (i < length && isIdentPart(source.charCodeAt(i))) {
        kind = "error";
        while (i < length && isIdentPart(source.charCodeAt(i))) i++;
      }
      if (kind === "error") errors.push({ from: start, to: i, message: `Invalid number '${source.slice(start, i)}'` });
      push(kind, start, i);
    } else if (c === HASH) {
      i++;
      while (i < length && isIdentPart(source.charCodeAt(i))) i++;
      push("color", start, i);
    } else if (PUNCTUATION.includes(source[i]!)) {
      i++;
      push("punct", start, i);
    } else {
      const op = OPERATORS.find((candidate) => source.startsWith(candidate, start));
      if (op) {
        i += op.length;
        push("op", start, i);
      } else {
        // Group a run of characters that cannot start any token into one error token.
        i++;
        while (i < length) {
          const d = source.charCodeAt(i);
          if (isSpace(d) || isIdentPart(d) || d === QUOTE || d === HASH || d === SLASH || PUNCTUATION.includes(source[i]!) || OPERATORS.some((candidate) => source.startsWith(candidate, i))) break;
          i++;
        }
        errors.push({ from: start, to: i, message: `Unexpected character${i - start > 1 ? "s" : ""} '${source.slice(start, i)}'` });
        push("error", start, i);
      }
    }
  }
  return { tokens, errors };
}

/** Token kinds and ranges for syntax highlighting. Total and lossless on any input. */
export function tokenize(source: string): Token[] {
  return lex(source).tokens;
}

/** Value of a string token (also of an unterminated one). */
export function decodeString(text: string): string {
  const closed = text.length >= 2 && text.endsWith('"') && !endsWithEscape(text);
  const body = text.slice(1, closed ? -1 : undefined);
  return body.replace(/\\(.)/g, (_, c: string) => ESCAPE_LETTERS.get(c) ?? c);
}

function endsWithEscape(text: string): boolean {
  let backslashes = 0;
  for (let i = text.length - 2; i >= 1 && text.charCodeAt(i) === BACKSLASH; i--) backslashes++;
  return backslashes % 2 === 1;
}

export function encodeString(value: string): string {
  return `"${value.replace(/[\\"\n\t\r]/g, (c) => `\\${ESCAPED_LETTERS.get(c) ?? c}`)}"`;
}

function isClosedString(text: string): boolean {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') && !endsWithEscape(text);
}

export type DecodedSignal = { readonly signal: SignalId } | { readonly error: string };

/** Decodes the text of a `signal` token: `kind:name`, `kind:name@quality`, with either part optionally quoted. */
export function decodeSignal(text: string): DecodedSignal {
  const colon = text.indexOf(":");
  const kind = text.slice(0, colon);
  if (!isSignalKind(kind)) return { error: `Unknown signal kind '${kind}'` };
  let rest = text.slice(colon + 1);
  // Consumes one bare or quoted name from `rest`; undefined when it is empty or an unterminated string.
  const part = (): string | undefined => {
    if (rest.startsWith('"')) {
      const end = stringEnd(rest);
      const raw = rest.slice(0, end);
      rest = rest.slice(end);
      return isClosedString(raw) ? decodeString(raw) || undefined : undefined;
    }
    const at = rest.indexOf("@");
    const raw = at < 0 ? rest : rest.slice(0, at);
    rest = at < 0 ? "" : rest.slice(at);
    return raw || undefined;
  };
  const name = part();
  if (name === undefined) return { error: `Signal '${text}' has no name` };
  let quality: string | undefined;
  if (rest.startsWith("@")) {
    rest = rest.slice(1);
    quality = part();
    if (quality === undefined) return { error: `Signal '${text}' has an empty quality` };
  }
  if (rest !== "") return { error: `Malformed signal '${text}'` };
  return { signal: signal(kind, name, quality) };
}

function stringEnd(text: string): number {
  for (let i = 1; i < text.length; i++) {
    if (text.charCodeAt(i) === BACKSLASH) i++;
    else if (text.charCodeAt(i) === QUOTE) return i + 1;
  }
  return text.length;
}
