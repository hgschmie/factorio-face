// Signed 32-bit arithmetic. One function per operation, so that a conformance result (fixture F-06) changes exactly one place.
// Every edge case that is not documented by the game or the wiki is listed in CONFORMANCE.md under the rule id in the comment.

import type { ArithmeticOperation, Comparator } from "@face/model";

/** Wraps any finite number to int32 (ECMAScript ToInt32: truncate, then modulo 2^32); NaN and infinities become 0. */
export function toInt32(value: number): number {
  return value | 0;
}

export function add(a: number, b: number): number {
  return (a + b) | 0;
}

export function subtract(a: number, b: number): number {
  return (a - b) | 0;
}

/** A-MUL: wraps like addition. */
export function multiply(a: number, b: number): number {
  return Math.imul(a, b);
}

/** Truncates toward zero. A-DIV0: x / 0 = 0. A-DIVMIN: -2^31 / -1 wraps to -2^31. */
export function divide(a: number, b: number): number {
  return b === 0 ? 0 : (a / b) | 0;
}

/** Remainder with the sign of the left operand. A-MOD0: x % 0 = 0. A-MODMIN: -2^31 % -1 = 0. */
export function remainder(a: number, b: number): number {
  return b === 0 ? 0 : (a % b) | 0;
}

/** A-POWNEG: a negative exponent yields 0 for every base. A-POW: integer power with int32 wrap, 0 ^ 0 = 1. */
export function power(base: number, exponent: number): number {
  if (exponent < 0) return 0;
  let result = 1;
  let factor = base;
  for (let e = exponent; e > 0; e >>>= 1) {
    if (e & 1) result = Math.imul(result, factor);
    factor = Math.imul(factor, factor);
  }
  return result;
}

/** A-SHIFT: the shift amount is masked to its low five bits (32 behaves like 0, -1 like 31). */
export function shiftAmount(amount: number): number {
  return amount & 31;
}

export function shiftLeft(a: number, b: number): number {
  return a << shiftAmount(b);
}

/** Arithmetic shift: preserves the sign bit. */
export function shiftRight(a: number, b: number): number {
  return a >> shiftAmount(b);
}

export function bitAnd(a: number, b: number): number {
  return a & b;
}

export function bitOr(a: number, b: number): number {
  return a | b;
}

export function bitXor(a: number, b: number): number {
  return a ^ b;
}

export type BinaryOperation = (a: number, b: number) => number;

export const ARITHMETIC: Readonly<Record<ArithmeticOperation, BinaryOperation>> = {
  "*": multiply,
  "/": divide,
  "+": add,
  "-": subtract,
  "%": remainder,
  "^": power,
  "<<": shiftLeft,
  ">>": shiftRight,
  AND: bitAnd,
  OR: bitOr,
  XOR: bitXor,
};

export type Comparison = (a: number, b: number) => boolean;

export const COMPARE: Readonly<Record<Comparator, Comparison>> = {
  "<": (a, b) => a < b,
  ">": (a, b) => a > b,
  "=": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<=": (a, b) => a <= b,
  ">=": (a, b) => a >= b,
};
