// Concrete syntax tree. Every node is a range; tokens are referenced, never copied. Optional parts are absent after a syntax error.

import type { EntityKind } from "@face/model";
import type { Range, Token } from "./tokens.ts";

export interface CstFile extends Range {
  /** All tokens including trivia; their texts concatenate to the source. */
  readonly tokens: readonly Token[];
  readonly circuit?: CstCircuit;
}

export interface CstCircuit extends Range {
  readonly keyword: Token;
  readonly name?: Token;
  readonly open?: Token;
  readonly close?: Token;
  readonly members: readonly CstMember[];
}

export type CstMember = CstEntity | CstWire;

export interface CstEntity extends Range {
  readonly type: "entity";
  readonly kind: EntityKind;
  readonly keyword: Token;
  readonly name?: Token;
  readonly at?: CstPoint;
  readonly tile?: CstPoint;
  readonly facing?: CstFacing;
  readonly body?: CstBlock;
}

export interface CstPoint extends Range {
  readonly keyword: Token;
  readonly x?: Token;
  readonly y?: Token;
}

export interface CstFacing extends Range {
  readonly keyword: Token;
  readonly direction?: Token;
}

/** `{ ... }` including both braces. */
export interface CstBlock extends Range {
  readonly open: Token;
  readonly close?: Token;
  readonly statements: readonly CstStatement[];
}

export interface CstWire extends Range {
  readonly type: "wire";
  readonly keyword: Token;
  readonly color?: Token;
  readonly a?: CstTerminal;
  readonly b?: CstTerminal;
}

/** `name.in`, `name.out`, or the bare `name` of an entity with one connection point that is neither (a pole). */
export interface CstTerminal extends Range {
  readonly name: Token;
  /** Absent for a bare name. */
  readonly dot?: Token;
  /** Absent for a bare name, and after a dot when the side is missing. */
  readonly side?: Token;
}

export type CstStatement = CstProperty | CstAssign | CstWhen | CstOutput | CstSection;

export interface CstProperty extends Range {
  readonly type: "property";
  readonly name: Token;
  readonly value?: Token;
}

/** `[red]`, `[green]` or `[none]`. */
export interface CstNetworks extends Range {
  /** A wire color keyword or the word `none`. */
  readonly selection?: Token;
}

export interface CstSigRef extends Range {
  /** A `signal` token or a wildcard keyword. */
  readonly signal: Token;
  readonly networks?: CstNetworks;
}

export type CstOperand = ({ readonly type: "int"; readonly token: Token } & Range) | ({ readonly type: "signal"; readonly ref: CstSigRef } & Range);

/** `signal = operand [operator operand]`: a constant filter or an arithmetic expression. */
export interface CstAssign extends Range {
  readonly type: "assign";
  readonly target: CstSigRef;
  readonly first?: CstOperand;
  readonly operator?: Token;
  readonly second?: CstOperand;
}

export interface CstCondition extends Range {
  /** `and` / `or`; absent for the first condition. */
  readonly join?: Token;
  readonly first?: CstSigRef;
  readonly comparator?: Token;
  readonly second?: CstOperand;
}

export interface CstWhen extends Range {
  readonly type: "when";
  readonly keyword: Token;
  readonly conditions: readonly CstCondition[];
}

export interface CstOutput extends Range {
  readonly type: "output";
  readonly else?: Token;
  readonly signal?: CstSigRef;
  /** An `int` token or the keyword `input`. */
  readonly value?: Token;
  /** Network selection after `input`. */
  readonly networks?: CstNetworks;
}

export interface CstSection extends Range {
  readonly type: "section";
  readonly keyword: Token;
  readonly name?: Token;
  readonly body?: CstBlock;
}
