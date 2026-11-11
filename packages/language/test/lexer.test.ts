import { describe, expect, it } from "vitest";
import { decodeSignal, decodeString, encodeString, isTrivia, KEYWORDS, lex, tokenize, type Token } from "../src/index.ts";
import { fixture, random } from "./helpers.ts";

const text = (tokens: readonly Token[]) => tokens.map((t) => t.text).join("");
const significant = (source: string) => tokenize(source).filter((t) => !isTrivia(t)).map((t) => `${t.kind}:${t.text}`);

function expectLossless(source: string): void {
  const tokens = tokenize(source);
  expect(text(tokens)).toBe(source);
  let offset = 0;
  for (const token of tokens) {
    expect(token.from).toBe(offset);
    expect(token.to).toBeGreaterThan(token.from);
    expect(token.text).toBe(source.slice(token.from, token.to));
    offset = token.to;
  }
  expect(offset).toBe(source.length);
}

describe("lexer losslessness", () => {
  it.each(["example.face", "comments.face", "all-kinds.face"])("covers every byte of %s", (name) => {
    expectLossless(fixture(name));
  });

  it("covers garbage, unterminated constructs and non-BMP characters", () => {
    for (const source of ["", " ", "\n", "@@@ ~~ ` ? \\ !", '"unterminated', '"esc\\', "/* open", "/*/", "//", "0x", "12abc", "#", "#12", "a:", "a:@", 'a:"x', 'a:"x"@', "item:x@\"q", "<-", "<->", "!", "café \u{1F600} x", "a\r\nb\tc", "﻿circuit", "- -1 --2", "a-b-", "..", "1.2.3", "-", "=-=", " "]) {
      expectLossless(source);
    }
  });

  it("covers deterministic fuzz input", () => {
    const next = random(42);
    const alphabet = ['"', "\\", "/", "*", "\n", " ", "-", ":", "@", "#", ".", "<", ">", "=", "!", "{", "}", "(", ")", "[", "]", ",", ";", "a", "Z", "_", "0", "9", "x", "virtual:signal-A", "circuit", "wire", "é", "\u{1F600}", "//", "/*", "*/", "0x1F", "1.5"];
    for (let round = 0; round < 500; round++) {
      let source = "";
      for (let i = Math.floor(next() * 40); i > 0; i--) source += alphabet[Math.floor(next() * alphabet.length)];
      expectLossless(source);
    }
  });

  it("uses UTF-16 offsets", () => {
    const tokens = tokenize('"\u{1F600}" x');
    expect(tokens.map((t) => [t.kind, t.from, t.to])).toEqual([["string", 0, 4], ["whitespace", 4, 5], ["ident", 5, 6]]);
  });
});

describe("token kinds", () => {
  it("classifies keywords, identifiers and hyphenated words", () => {
    expect(significant("circuit Circuit foo_1 index-comparator stack-size in-put")).toEqual(["keyword:circuit", "ident:Circuit", "ident:foo_1", "word:index-comparator", "word:stack-size", "word:in-put"]);
    for (const keyword of KEYWORDS) expect(tokenize(keyword)[0]!.kind).toBe("keyword");
  });

  it("lexes trivia", () => {
    expect(tokenize("a // c\n/* b\n */ b").map((t) => t.kind)).toEqual(["ident", "whitespace", "lineComment", "whitespace", "blockComment", "whitespace", "ident"]);
  });

  it("lexes punctuation and operators with longest match", () => {
    expect(significant("{ } ( ) [ ] , ; . = < > != <= >= <-> * / + - % ^ << >>").map((t) => t.split(":")[0])).toEqual([...Array(9).fill("punct"), ...Array(15).fill("op")]);
    expect(significant("a<->b<<c<=d<e")).toEqual(["ident:a", "op:<->", "ident:b", "op:<<", "ident:c", "op:<=", "ident:d", "op:<", "ident:e"]);
  });

  it("lexes integers, hexadecimal and decimals", () => {
    expect(significant("0 42 0x1F 0XfF 1.5")).toEqual(["int:0", "int:42", "int:0x1F", "int:0XfF", "decimal:1.5"]);
    expect(significant("-3, -0.25, -0x10")).toEqual(["int:-3", "punct:,", "decimal:-0.25", "punct:,", "int:-0x10"]);
  });

  it("treats '-' before a digit as a sign only where no operand precedes", () => {
    expect(significant("= -5")).toEqual(["op:=", "int:-5"]);
    expect(significant("* -5")).toEqual(["op:*", "int:-5"]);
    expect(significant("(-260, -80)")).toEqual(["punct:(", "int:-260", "punct:,", "int:-80", "punct:)"]);
    expect(significant("virtual:signal-A - 1")).toEqual(["signal:virtual:signal-A", "op:-", "int:1"]);
    expect(significant("virtual:signal-A -1")).toEqual(["signal:virtual:signal-A", "op:-", "int:1"]);
    expect(significant("2 - -1")).toEqual(["int:2", "op:-", "int:-1"]);
    expect(significant("each -1")).toEqual(["keyword:each", "op:-", "int:1"]);
    expect(significant("XOR -1 and -2 when -3")).toEqual(["keyword:XOR", "int:-1", "keyword:and", "int:-2", "keyword:when", "int:-3"]);
    expect(significant("x[red] -1")).toEqual(["ident:x", "punct:[", "keyword:red", "punct:]", "op:-", "int:1"]);
  });

  it("lexes signal literals as one token", () => {
    expect(significant("virtual:signal-A item:iron-plate@rare space-location:nauvis[red] item:a.b-c=1")).toEqual([
      "signal:virtual:signal-A", "signal:item:iron-plate@rare", "signal:space-location:nauvis", "punct:[", "keyword:red", "punct:]", "signal:item:a.b-c", "op:=", "int:1",
    ]);
    expect(significant('item:"odd name"@"odd \\" quality" = 1')).toEqual(['signal:item:"odd name"@"odd \\" quality"', "op:=", "int:1"]);
    expect(significant("virtual:signal-A-1")).toEqual(["signal:virtual:signal-A-1"]);
  });

  it("lexes strings and colors", () => {
    expect(significant('"a \\"b\\" \\\\ \\n" #ff8000 #xyz')).toEqual(['string:"a \\"b\\" \\\\ \\n"', "color:#ff8000", "color:#xyz"]);
  });

  it("stops an unterminated string at the line break", () => {
    const { tokens, errors } = lex('"open\nnext');
    expect(tokens.map((t) => t.kind)).toEqual(["string", "whitespace", "ident"]);
    expect(errors.map((e) => e.message)).toEqual(["Unterminated string"]);
  });

  it("reports lexical errors with ranges", () => {
    expect(lex("/* open").errors).toEqual([{ from: 0, to: 7, message: "Unterminated block comment" }]);
    expect(lex("a ?? b").errors).toEqual([{ from: 2, to: 4, message: "Unexpected characters '??'" }]);
    expect(lex("12abc").errors[0]).toMatchObject({ from: 0, to: 5 });
    expect(lex("0x").errors[0]).toMatchObject({ from: 0, to: 2 });
    expect(lex('"\\q"').errors[0]).toMatchObject({ from: 1, to: 3 });
    expect(tokenize("a ?? b")[2]!.kind).toBe("error");
  });
});

describe("literal decoding", () => {
  it("round-trips strings", () => {
    for (const value of ["", "plain", 'a "b"', "back\\slash", "two\nlines", "trailing\\"]) expect(decodeString(encodeString(value))).toBe(value);
    expect(decodeString('"open')).toBe("open");
  });

  it("decodes signals", () => {
    expect(decodeSignal("item:iron-plate")).toEqual({ signal: { kind: "item", name: "iron-plate" } });
    expect(decodeSignal("item:iron-plate@rare")).toEqual({ signal: { kind: "item", name: "iron-plate", quality: "rare" } });
    expect(decodeSignal("item:iron-plate@normal")).toEqual({ signal: { kind: "item", name: "iron-plate" } });
    expect(decodeSignal('item:"odd @ name"@"odd quality"')).toEqual({ signal: { kind: "item", name: "odd @ name", quality: "odd quality" } });
    for (const bad of ["bogus:x", "item:", "item:x@", 'item:"x', 'item:""', 'item:"a"b']) expect(decodeSignal(bad)).toHaveProperty("error");
  });
});
