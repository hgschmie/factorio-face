import { describe, expect, it } from "vitest";
import { ARITHMETIC_OPERATIONS } from "@face/model";
import { ARITHMETIC } from "../src/index.ts";
import { EACH, GREEN, INT_MAX, INT_MIN, NEITHER, RED, arithmetic, evaluate, operand, v } from "./helpers.ts";

describe("arithmetic combinator", () => {
  it("applies every operation to signal and constant operands", () => {
    const table: Record<string, number> = { "*": 84, "/": 5, "+": 25, "-": 17, "%": 1, "^": 194481, "<<": 336, ">>": 1, AND: 4, OR: 21, XOR: 17 };
    for (const operation of ARITHMETIC_OPERATIONS) {
      expect(evaluate(arithmetic("a", "A", operation, 4, "B"), { red: { A: 21 } }), operation).toEqual(v({ B: table[operation]! }));
      expect(evaluate(arithmetic("a", 21, operation, "A", "B"), { red: { A: 4 } }), operation).toEqual(v({ B: table[operation]! }));
      expect(evaluate(arithmetic("a", "A", operation, "C", "B"), { red: { A: 21 }, green: { C: 4 } }), operation).toEqual(v({ B: table[operation]! }));
      expect(table[operation]).toBe(ARITHMETIC[operation](21, 4));
    }
  });

  it("works on constants alone, without any wire", () => {
    expect(evaluate(arithmetic("a", 6, "*", 7, "A"))).toEqual(v({ A: 42 }));
  });

  it("documented: a missing signal reads as 0 and a zero result is not emitted", () => {
    expect(evaluate(arithmetic("a", "A", "+", "B", "C"), { red: { A: 5 } })).toEqual(v({ C: 5 }));
    expect(evaluate(arithmetic("a", "A", "-", "B", "C"), { red: { A: 5, B: 5 } })).toEqual({});
    expect(evaluate(arithmetic("a", "A", "*", 2, "C"))).toEqual({});
  });

  it("F-06 assumption: results wrap to int32 inside a circuit", () => {
    expect(evaluate(arithmetic("a", "A", "+", 1, "A"), { red: { A: INT_MAX } })).toEqual(v({ A: INT_MIN }));
    expect(evaluate(arithmetic("a", "A", "*", "A", "A"), { red: { A: 65537 } })).toEqual(v({ A: 131073 }));
    expect(evaluate(arithmetic("a", "A", "/", 0, "A"), { red: { A: 7 } })).toEqual({});
    expect(evaluate(arithmetic("a", "A", "/", -1, "A"), { red: { A: INT_MIN } })).toEqual(v({ A: INT_MIN }));
    expect(evaluate(arithmetic("a", "A", "^", -1, "A"), { red: { A: 1 } })).toEqual({});
  });

  it("documented: per-operand network selection; both networks are summed", () => {
    const feed = { red: { A: 10, B: 1 }, green: { A: 3, B: 2 } };
    expect(evaluate(arithmetic("a", operand("A", RED), "-", operand("A", GREEN), "C"), feed)).toEqual(v({ C: 7 }));
    expect(evaluate(arithmetic("a", "A", "*", operand("B", GREEN), "C"), feed)).toEqual(v({ C: 26 }));
  });

  it("N-NONE assumption: an operand with neither network selected reads 0, and each finds no signals there", () => {
    const feed = { red: { A: 10, B: 1 }, green: { A: 3, B: 2 } };
    expect(evaluate(arithmetic("a", operand("A", NEITHER), "+", operand("B", RED), "C"), feed)).toEqual(v({ C: 1 }));
    expect(evaluate(arithmetic("a", operand("A", NEITHER), "*", "B", "C"), feed)).toEqual({});
    expect(evaluate(arithmetic("a", operand(EACH, NEITHER), "+", 1, EACH), feed)).toEqual({});
    // Each iterates the other operand's signals; the one read from no network contributes 0 to every result.
    expect(evaluate(arithmetic("a", operand(EACH, NEITHER), "+", operand(EACH, GREEN), EACH), feed)).toEqual(v({ A: 3, B: 2 }));
  });

  it("documented: each -> each applies the operation to every input signal, keeping kind and quality", () => {
    const feed = { red: { A: 3, B: -4, "item:iron-plate": 10, "item:iron-plate@rare": 20, "fluid:water": 1 } };
    expect(evaluate(arithmetic("a", EACH, "*", 2, EACH), feed)).toEqual(v({ A: 6, B: -8, "item:iron-plate": 20, "item:iron-plate@rare": 40, "fluid:water": 2 }));
    expect(evaluate(arithmetic("a", 100, "/", EACH, EACH), feed)).toEqual(v({ A: 33, B: -25, "item:iron-plate": 10, "item:iron-plate@rare": 5, "fluid:water": 100 }));
  });

  it("documented: each results of 0 are not emitted", () => {
    expect(evaluate(arithmetic("a", EACH, "-", 3, EACH), { red: { A: 3, B: 5 } })).toEqual(v({ B: 2 }));
    expect(evaluate(arithmetic("a", EACH, "/", 10, EACH), { red: { A: 3, B: 50 } })).toEqual(v({ B: 5 }));
  });

  it("documented: each -> specific signal adds the individual results together", () => {
    expect(evaluate(arithmetic("a", EACH, "*", 2, "S"), { red: { A: 3, B: -4, C: 10 } })).toEqual(v({ S: 18 }));
    expect(evaluate(arithmetic("a", EACH, "+", 0, "S"), { red: { A: 3, B: -3 } })).toEqual({});
  });

  it("F-06 assumption: the each -> specific sum wraps", () => {
    expect(evaluate(arithmetic("a", EACH, "+", 0, "S"), { red: { A: INT_MAX, B: INT_MAX, C: 2 } })).toEqual({});
    expect(evaluate(arithmetic("a", EACH, "+", 0, "S"), { red: { A: INT_MAX, B: 1 } })).toEqual(v({ S: INT_MIN }));
  });

  it("F-07 assumption: red +3 and green -3 cancel, so each does not see the signal", () => {
    const feed = { red: { A: 3, B: 1 }, green: { A: -3 } };
    expect(evaluate(arithmetic("a", EACH, "+", 100, EACH), feed)).toEqual(v({ B: 101 }));
    expect(evaluate(arithmetic("a", operand(EACH, RED), "+", 100, EACH), feed)).toEqual(v({ A: 103, B: 101 }));
    expect(evaluate(arithmetic("a", operand(EACH, GREEN), "+", 100, EACH), feed)).toEqual(v({ A: 97 }));
  });

  it("F-08 assumption: each op each iterates the union of both selections; a signal missing on one side reads as 0", () => {
    const feed = { red: { A: 10, B: 4 }, green: { B: 3, C: 7 } };
    expect(evaluate(arithmetic("a", operand(EACH, RED), "-", operand(EACH, GREEN), EACH), feed)).toEqual(v({ A: 10, B: 1, C: -7 }));
    expect(evaluate(arithmetic("a", operand(EACH, RED), "*", operand(EACH, GREEN), EACH), feed)).toEqual(v({ B: 12 }));
    expect(evaluate(arithmetic("a", operand(EACH, RED), "-", operand(EACH, GREEN), "S"), feed)).toEqual(v({ S: 4 }));
    expect(evaluate(arithmetic("a", EACH, "*", EACH, EACH), feed)).toEqual(v({ A: 100, B: 49, C: 49 }));
    expect(evaluate(arithmetic("a", operand(EACH, RED), "^", operand(EACH, GREEN), EACH), feed)).toEqual(v({ A: 1, B: 64 }));
  });

  it("F-09 assumption: in each op S the signal S reads normally and stays in the iteration", () => {
    const feed = { red: { A: 5, B: 3, S: 2 } };
    expect(evaluate(arithmetic("a", EACH, "*", "S", EACH), feed)).toEqual(v({ A: 10, B: 6, S: 4 }));
    expect(evaluate(arithmetic("a", "S", "-", EACH, EACH), feed)).toEqual(v({ A: -3, B: -1 }));
    expect(evaluate(arithmetic("a", operand(EACH, RED), "+", operand("S", GREEN), EACH), { red: { A: 5 }, green: { S: 2 } })).toEqual(v({ A: 7 }));
  });

  it("emits nothing while unconfigured", () => {
    expect(evaluate(arithmetic("a", "A", "+", 1), { red: { A: 5 } })).toEqual({});
  });
});
