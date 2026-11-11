import { describe, expect, it } from "vitest";
import { ARITHMETIC_OPERATIONS, COMPARATORS } from "@face/model";
import { ARITHMETIC, COMPARE, add, bitAnd, bitOr, bitXor, divide, multiply, power, remainder, shiftLeft, shiftRight, subtract, toInt32 } from "../src/int32.ts";
import { INT_MAX, INT_MIN } from "./helpers.ts";

const isInt32 = (value: number): boolean => Number.isInteger(value) && value >= INT_MIN && value <= INT_MAX && !Object.is(value, -0);

describe("int32 arithmetic", () => {
  it("wraps arbitrary numbers to int32", () => {
    expect(toInt32(INT_MAX + 1)).toBe(INT_MIN);
    expect(toInt32(4294967296 + 5)).toBe(5);
    expect(toInt32(-2147483649)).toBe(INT_MAX);
    expect(toInt32(2.9)).toBe(2);
    expect(toInt32(-2.9)).toBe(-2);
    expect(toInt32(Number.NaN)).toBe(0);
    expect(toInt32(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("documented: addition and subtraction wrap (2147483647 + 10 = -2147483639)", () => {
    expect(add(INT_MAX, 10)).toBe(-2147483639);
    expect(add(INT_MAX, 1)).toBe(INT_MIN);
    expect(subtract(INT_MIN, 1)).toBe(INT_MAX);
    expect(add(INT_MIN, INT_MIN)).toBe(0);
  });

  it("F-06 assumption: multiplication wraps like addition", () => {
    expect(multiply(65536, 65536)).toBe(0);
    expect(multiply(INT_MIN, -1)).toBe(INT_MIN);
    expect(multiply(INT_MAX, 2)).toBe(-2);
    expect(multiply(123456789, 1000)).toBe(toInt32(123456789000));
  });

  it("documented: division truncates toward zero", () => {
    expect(divide(21, 10)).toBe(2);
    expect(divide(-21, 10)).toBe(-2);
    expect(divide(19, -10)).toBe(-1);
    expect(divide(-21, -10)).toBe(2);
    expect(divide(INT_MAX, 1)).toBe(INT_MAX);
    expect(divide(INT_MIN, INT_MAX)).toBe(-1);
  });

  it("F-06 assumption: x / 0 = 0", () => {
    for (const x of [0, 1, -1, INT_MAX, INT_MIN]) expect(divide(x, 0)).toBe(0);
  });

  it("F-06 assumption: -2147483648 / -1 wraps to -2147483648", () => {
    expect(divide(INT_MIN, -1)).toBe(INT_MIN);
  });

  it("documented: remainder takes the sign of the left operand", () => {
    expect(remainder(13, 3)).toBe(1);
    expect(remainder(13, -3)).toBe(1);
    expect(remainder(-13, 3)).toBe(-1);
    expect(remainder(-13, -3)).toBe(-1);
    expect(Object.is(remainder(-6, 3), 0)).toBe(true);
  });

  it("F-06 assumption: x % 0 = 0", () => {
    for (const x of [0, 1, -1, INT_MAX, INT_MIN]) expect(remainder(x, 0)).toBe(0);
  });

  it("F-06 assumption: -2147483648 % -1 = 0", () => {
    expect(Object.is(remainder(INT_MIN, -1), 0)).toBe(true);
  });

  it("F-06 assumption: integer power wraps to int32 and 0 ^ 0 = 1", () => {
    expect(power(0, 0)).toBe(1);
    expect(power(5, 0)).toBe(1);
    expect(power(2, 10)).toBe(1024);
    expect(power(2, 30)).toBe(1073741824);
    expect(power(2, 31)).toBe(INT_MIN);
    expect(power(2, 32)).toBe(0);
    expect(power(-2, 31)).toBe(INT_MIN);
    expect(power(-2, 3)).toBe(-8);
    expect(power(-1, INT_MAX)).toBe(-1);
    expect(power(1, INT_MAX)).toBe(1);
    expect(power(0, 5)).toBe(0);
    expect(power(3, 100)).toBe(Number(BigInt.asIntN(32, 3n ** 100n)));
    expect(power(7, 13)).toBe(Number(BigInt.asIntN(32, 7n ** 13n)));
  });

  it("F-06 assumption: a negative exponent yields 0 for every base", () => {
    for (const base of [0, 1, -1, 2, -2, INT_MAX, INT_MIN]) {
      expect(power(base, -1)).toBe(0);
      expect(power(base, INT_MIN)).toBe(0);
    }
  });

  it("documented: left shift fills with zeros, right shift preserves the sign", () => {
    expect(shiftLeft(1, 4)).toBe(16);
    expect(shiftLeft(1, 31)).toBe(INT_MIN);
    expect(shiftLeft(-1, 1)).toBe(-2);
    expect(shiftRight(-8, 1)).toBe(-4);
    expect(shiftRight(-1, 31)).toBe(-1);
    expect(shiftRight(INT_MIN, 31)).toBe(-1);
    expect(shiftRight(INT_MAX, 30)).toBe(1);
  });

  it("F-06 assumption: shift amounts are masked to five bits", () => {
    expect(shiftLeft(3, 32)).toBe(3);
    expect(shiftLeft(3, 33)).toBe(6);
    expect(shiftLeft(1, -1)).toBe(INT_MIN);
    expect(shiftRight(-8, 32)).toBe(-8);
    expect(shiftRight(-8, 33)).toBe(-4);
    expect(shiftRight(INT_MIN, -1)).toBe(-1);
  });

  it("F-06 assumption: bitwise operations act on the two's-complement pattern", () => {
    expect(bitAnd(-1, 255)).toBe(255);
    expect(bitXor(-1, INT_MIN)).toBe(INT_MAX);
    expect(bitOr(INT_MIN, INT_MAX)).toBe(-1);
    expect(bitAnd(12, 10)).toBe(8);
    expect(bitOr(12, 10)).toBe(14);
    expect(bitXor(12, 10)).toBe(6);
  });

  it("keeps every operation closed over int32 for the F-06 operand table", () => {
    const operands = [0, 1, -1, 2, -2, 31, 32, 33, INT_MAX, INT_MIN];
    for (const operation of ARITHMETIC_OPERATIONS) {
      for (const a of operands) for (const b of operands) expect(isInt32(ARITHMETIC[operation](a, b)), `${a} ${operation} ${b}`).toBe(true);
    }
  });

  it("implements the six comparators", () => {
    const truth = (a: number, b: number): string => COMPARATORS.filter((c) => COMPARE[c](a, b)).join(" ");
    expect(truth(1, 2)).toBe("< != <=");
    expect(truth(2, 1)).toBe("> != >=");
    expect(truth(2, 2)).toBe("= <= >=");
  });
});
