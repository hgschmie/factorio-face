import { describe, expect, it } from "vitest";
import type { Comparator } from "@face/model";
import { createEnvironment } from "../src/index.ts";
import { ANYTHING, EACH, EVERYTHING, GREEN, INT_MAX, RED, and, cond, decider, evaluate, out, v } from "./helpers.ts";

const YES = v({ Y: 1 });
const NO = v({ N: 1 });
/** Decider that reports the truth of its condition list on Y (true) or N (false). */
const truth = (...conditions: Parameters<typeof decider>[1]) => decider("d", conditions, [out("Y", 1)], [out("N", 1)]);

describe("decider conditions", () => {
  it("documented: compares a signal with a constant or another signal using all six comparators", () => {
    const expected: Record<Comparator, [boolean, boolean, boolean]> = {
      "<": [true, false, false],
      ">": [false, false, true],
      "=": [false, true, false],
      "!=": [true, false, true],
      "<=": [true, true, false],
      ">=": [false, true, true],
    };
    for (const [comparator, results] of Object.entries(expected) as [Comparator, boolean[]][]) {
      [4, 5, 6].forEach((a, i) => {
        expect(evaluate(truth(cond("A", comparator, 5)), { red: { A: a } }), `${a} ${comparator} 5`).toEqual(results[i] ? YES : NO);
        expect(evaluate(truth(cond("A", comparator, "B")), { red: { A: a, B: 5 } }), `${a} ${comparator} B`).toEqual(results[i] ? YES : NO);
      });
    }
  });

  it("documented: a missing signal compares as 0", () => {
    expect(evaluate(truth(cond("A", "=", 0)))).toEqual(YES);
    expect(evaluate(truth(cond("A", "<", "B")), { red: { B: 1 } })).toEqual(YES);
  });

  it("F-10 assumption: AND binds tighter than OR (A > 0 AND B > 0 OR C > 0)", () => {
    const d = truth(cond("A", ">", 0), and("B", ">", 0), cond("C", ">", 0));
    for (let bits = 0; bits < 8; bits++) {
      const [a, b, c] = [bits & 1, (bits >> 1) & 1, (bits >> 2) & 1];
      expect(evaluate(d, { red: { A: a, B: b, C: c } }), `A=${a} B=${b} C=${c}`).toEqual((a && b) || c ? YES : NO);
    }
  });

  it("F-10 assumption: a new AND group starts at every OR (A AND B OR C AND D OR E)", () => {
    const d = truth(cond("A", ">", 0), and("B", ">", 0), cond("C", ">", 0), and("D", ">", 0), cond("E", ">", 0));
    for (let bits = 0; bits < 32; bits++) {
      const [a, b, c, dd, e] = [0, 1, 2, 3, 4].map((n) => (bits >> n) & 1);
      expect(evaluate(d, { red: { A: a!, B: b!, C: c!, D: dd!, E: e! } }), `bits ${bits}`).toEqual((a && b) || (c && dd) || e ? YES : NO);
    }
  });

  it("F-10 assumption: the join of the first condition is ignored", () => {
    expect(evaluate(truth(and("A", ">", 0), cond("B", ">", 0)), { red: { B: 1 } })).toEqual(YES);
    expect(evaluate(truth(and("A", ">", 0), and("B", ">", 0)), { red: { B: 1 } })).toEqual(NO);
  });

  it("documented: each operand has its own network selection; both networks are summed", () => {
    const feed = { red: { A: 5, B: 1 }, green: { A: -5, B: 9 } };
    expect(evaluate(truth(cond("A", "=", 0)), feed)).toEqual(YES);
    expect(evaluate(truth(cond("A", "=", 5, { firstNetworks: RED })), feed)).toEqual(YES);
    expect(evaluate(truth(cond("A", "=", -5, { firstNetworks: GREEN })), feed)).toEqual(YES);
    expect(evaluate(truth(cond("B", "<", "B", { firstNetworks: RED, secondNetworks: GREEN })), feed)).toEqual(YES);
    expect(evaluate(truth(cond("B", "=", "B", { firstNetworks: RED, secondNetworks: RED })), feed)).toEqual(YES);
    expect(evaluate(truth(cond("B", "=", 10)), feed)).toEqual(YES);
  });

  it("F-15 assumption: an empty condition list is false, so only else outputs fire", () => {
    expect(evaluate(truth(), { red: { A: 1 } })).toEqual(NO);
  });

  it("F-15 assumption: a condition without a first signal is false", () => {
    expect(evaluate(truth(cond(undefined, "=", 0)), { red: { A: 1 } })).toEqual(NO);
    expect(evaluate(truth(cond(undefined, "<", 0), cond("A", ">", 0)), { red: { A: 1 } })).toEqual(YES);
  });
});

describe("decider everything and anything", () => {
  it("documented: everything is true when all input signals pass, and true without input", () => {
    expect(evaluate(truth(cond(EVERYTHING, ">", 0)), { red: { A: 1, B: 2 } })).toEqual(YES);
    expect(evaluate(truth(cond(EVERYTHING, ">", 1)), { red: { A: 1, B: 2 } })).toEqual(NO);
    expect(evaluate(truth(cond(EVERYTHING, ">", 1)))).toEqual(YES);
  });

  it("documented: anything is true when at least one input signal passes, and false without input", () => {
    expect(evaluate(truth(cond(ANYTHING, ">", 1)), { red: { A: 1, B: 2 } })).toEqual(YES);
    expect(evaluate(truth(cond(ANYTHING, ">", 2)), { red: { A: 1, B: 2 } })).toEqual(NO);
    expect(evaluate(truth(cond(ANYTHING, "=", 0)))).toEqual(NO);
    expect(evaluate(truth(cond(ANYTHING, "<", 5)))).toEqual(NO);
  });

  it("documented: wildcards only see the networks selected for their operand", () => {
    const feed = { red: { A: 1 }, green: { B: -1 } };
    expect(evaluate(truth(cond(EVERYTHING, ">", 0, { firstNetworks: RED })), feed)).toEqual(YES);
    expect(evaluate(truth(cond(EVERYTHING, ">", 0)), feed)).toEqual(NO);
    expect(evaluate(truth(cond(ANYTHING, "<", 0, { firstNetworks: RED })), feed)).toEqual(NO);
    expect(evaluate(truth(cond(ANYTHING, "<", 0, { firstNetworks: GREEN })), feed)).toEqual(YES);
  });

  it("F-07 assumption: red +3 and green -3 cancel; wildcards do not see the signal", () => {
    const feed = { red: { A: 3 }, green: { A: -3 } };
    expect(evaluate(truth(cond(ANYTHING, "!=", 0)), feed)).toEqual(NO);
    expect(evaluate(truth(cond(EVERYTHING, ">", 100)), feed)).toEqual(YES);
    expect(evaluate(truth(cond(ANYTHING, ">", 0, { firstNetworks: RED })), feed)).toEqual(YES);
    expect(evaluate(decider("d", [cond("A", "=", 0)], [out(EVERYTHING)], []), feed)).toEqual({});
  });

  it("F-11 assumption: the right-hand signal is excluded from the set everything and anything check", () => {
    expect(evaluate(truth(cond(EVERYTHING, "<", "L")), { red: { A: 1, B: 2, L: 5 } })).toEqual(YES);
    expect(evaluate(truth(cond(EVERYTHING, "<", "L")), { red: { A: 1, B: 7, L: 5 } })).toEqual(NO);
    expect(evaluate(truth(cond(ANYTHING, "=", "L")), { red: { A: 1, L: 5 } })).toEqual(NO);
    expect(evaluate(truth(cond(ANYTHING, "=", "L")), { red: { A: 5, L: 5 } })).toEqual(YES);
    expect(evaluate(truth(cond(EVERYTHING, "<", "L")), { red: { L: 5 } })).toEqual(YES);
    expect(evaluate(truth(cond(ANYTHING, ">", "L")), { red: { L: -5 } })).toEqual(NO);
  });

  it("F-11 assumption: several anything conditions of one AND group must hold for the same signal", () => {
    const d = truth(cond(ANYTHING, ">", 5), and(ANYTHING, "<", 10));
    expect(evaluate(d, { red: { A: 3, B: 12 } })).toEqual(NO);
    expect(evaluate(d, { red: { A: 3, B: 7 } })).toEqual(YES);
    const split = truth(cond(ANYTHING, ">", 5), cond(ANYTHING, "<", 10));
    expect(evaluate(split, { red: { A: 12 } })).toEqual(YES);
  });

  it("F-11 assumption: everything conditions are independent of anything and of each other", () => {
    const d = truth(cond(EVERYTHING, ">", 0), and(ANYTHING, ">", 5), and("A", "=", 1));
    expect(evaluate(d, { red: { A: 1, B: 7 } })).toEqual(YES);
    expect(evaluate(d, { red: { A: 1, B: 7, C: -1 } })).toEqual(NO);
    expect(evaluate(d, { red: { A: 1, B: 2 } })).toEqual(NO);
  });
});

describe("decider outputs without each", () => {
  it("documented: copies the input count or emits the constant; else outputs fire when false", () => {
    const d = decider("d", [cond("A", ">", 10)], [out("A"), out("C", 5)], [out("D", 1), out("A", -1)]);
    expect(evaluate(d, { red: { A: 11 } })).toEqual(v({ A: 11, C: 5 }));
    expect(evaluate(d, { red: { A: 10 } })).toEqual(v({ D: 1, A: -1 }));
    expect(evaluate(decider("d", [cond("A", ">", 10)], [out("A")]), { red: { A: 10 } })).toEqual({});
  });

  it("documented: an output reads its input count from its own network selection", () => {
    const feed = { red: { A: 5, B: 1 }, green: { A: 7, B: 2 } };
    const d = decider("d", [cond("A", ">", 0)], [out("B", "input", RED)]);
    expect(evaluate(d, feed)).toEqual(v({ B: 1 }));
    expect(evaluate(decider("d", [cond("A", ">", 0)], [out("B", "input", GREEN)]), feed)).toEqual(v({ B: 2 }));
    expect(evaluate(decider("d", [cond("A", ">", 0)], [out("B")]), feed)).toEqual(v({ B: 3 }));
  });

  it("documented: an everything output passes every input signal of its selected wires", () => {
    const feed = { red: { A: 5, B: 1 }, green: { A: 7, C: -2 } };
    expect(evaluate(decider("d", [cond("A", ">", 0)], [out(EVERYTHING)]), feed)).toEqual(v({ A: 12, B: 1, C: -2 }));
    expect(evaluate(decider("d", [cond("A", ">", 0)], [out(EVERYTHING, "input", RED)]), feed)).toEqual(v({ A: 5, B: 1 }));
    expect(evaluate(decider("d", [cond("A", ">", 0)], [out(EVERYTHING, 1)]), feed)).toEqual(v({ A: 1, B: 1, C: 1 }));
    expect(evaluate(decider("d", [cond("A", ">", 0)], [out(EVERYTHING, 3, GREEN)]), feed)).toEqual(v({ A: 3, C: 3 }));
  });

  it("F-13 assumption: an anything output without anything in the conditions emits the first input signal in signal order", () => {
    const feed = { red: { Z: 9, B: 2, "item:iron-plate@rare": 4, "item:iron-plate": 3, "fluid:water": 1 } };
    const d = decider("d", [cond("Z", ">", 0)], [out(ANYTHING)]);
    expect(evaluate(d, feed)).toEqual(v({ "fluid:water": 1 }));
    const order = { signalOrder: ["virtual:signal-Z", "item:iron-plate"] };
    expect(evaluate(d, { ...feed, environment: createEnvironment(order) })).toEqual(v({ Z: 9 }));
  });

  it("F-13 assumption: an anything output emits the first signal that passed the anything conditions", () => {
    const feed = { red: { A: 1, B: 7, C: 9, D: 2 } };
    expect(evaluate(decider("d", [cond(ANYTHING, ">", 5)], [out(ANYTHING)]), feed)).toEqual(v({ B: 7 }));
    expect(evaluate(decider("d", [cond(ANYTHING, ">", 5)], [out(ANYTHING, 1)]), feed)).toEqual(v({ B: 1 }));
    expect(evaluate(decider("d", [cond(ANYTHING, ">", 8), cond(ANYTHING, "=", 2)], [out(ANYTHING)]), feed)).toEqual(v({ C: 9 }));
    expect(evaluate(decider("d", [cond(ANYTHING, ">", 5), and(ANYTHING, "<", 8)], [out(ANYTHING), out("X", 1)]), feed)).toEqual(v({ B: 7, X: 1 }));
  });

  it("F-13 assumption: quality variants are distinct candidates ordered by quality level", () => {
    const feed = { red: { "item:iron-plate@legendary": 1, "item:iron-plate@rare": 2, "item:iron-plate@uncommon": 3 } };
    expect(evaluate(decider("d", [cond(ANYTHING, ">", 0)], [out(ANYTHING)]), feed)).toEqual(v({ "item:iron-plate@uncommon": 3 }));
    expect(evaluate(decider("d", [cond(ANYTHING, "<", 3)], [out(ANYTHING)]), feed)).toEqual(v({ "item:iron-plate@rare": 2 }));
  });

  it("F-14 assumption: anything and everything in else outputs refer to the input signals of the output's wires", () => {
    const feed = { red: { B: 7, C: 9 }, green: { A: 4 } };
    expect(evaluate(decider("d", [cond(ANYTHING, ">", 50)], [], [out(ANYTHING)]), feed)).toEqual(v({ A: 4 }));
    expect(evaluate(decider("d", [cond(ANYTHING, ">", 50)], [], [out(ANYTHING, "input", RED)]), feed)).toEqual(v({ B: 7 }));
    expect(evaluate(decider("d", [cond("A", ">", 50)], [], [out(EVERYTHING, 2)]), feed)).toEqual(v({ A: 2, B: 2, C: 2 }));
  });

  it("F-14 assumption: outputs naming the same signal add up and wrap", () => {
    const d = decider("d", [cond("A", ">", 0)], [out("A"), out("A"), out("A", 10), out(EVERYTHING)]);
    expect(evaluate(d, { red: { A: 5, B: 1 } })).toEqual(v({ A: 25, B: 1 }));
    expect(evaluate(decider("d", [cond("A", ">", 0)], [out("A"), out("A", 1)]), { red: { A: INT_MAX } })).toEqual(v({ A: -2147483648 }));
    expect(evaluate(decider("d", [cond("A", ">", 0)], [out("A"), out("A", -5)]), { red: { A: 5 } })).toEqual({});
  });

  it("F-15 assumption: a copied value of 0 and a constant 0 emit nothing", () => {
    expect(evaluate(decider("d", [cond("A", ">", 0)], [out("B"), out("C", 0)]), { red: { A: 5 } })).toEqual({});
  });

  it("emits nothing without outputs", () => {
    expect(evaluate(decider("d", [cond("A", ">", 0)], []), { red: { A: 5 } })).toEqual({});
  });
});

describe("decider each", () => {
  const feed = { red: { A: 1, B: 7, C: 9, D: -2 } };

  it("F-12 assumption: each output passes every signal that satisfies the conditions", () => {
    expect(evaluate(decider("d", [cond(EACH, ">", 5)], [out(EACH)]), feed)).toEqual(v({ B: 7, C: 9 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 5)], [out(EACH, 1)]), feed)).toEqual(v({ B: 1, C: 1 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 50)], [out(EACH)]), feed)).toEqual({});
    expect(evaluate(decider("d", [cond(EACH, ">", 5)], [out(EACH)]))).toEqual({});
  });

  it("F-12 assumption: the whole AND/OR expression is evaluated per signal", () => {
    expect(evaluate(decider("d", [cond(EACH, ">", 5), and(EACH, "<", 9)], [out(EACH)]), feed)).toEqual(v({ B: 7 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 8), cond(EACH, "<", 0)], [out(EACH)]), feed)).toEqual(v({ C: 9, D: -2 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 5), and("A", "=", 1)], [out(EACH)]), feed)).toEqual(v({ B: 7, C: 9 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 5), and("A", "=", 2)], [out(EACH)]), feed)).toEqual({});
  });

  it("F-12 assumption: a specific output sums the passing signals' input counts, or emits the constant once per passing signal", () => {
    expect(evaluate(decider("d", [cond(EACH, ">", 5)], [out("S")]), feed)).toEqual(v({ S: 16 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 5)], [out("S", 1)]), feed)).toEqual(v({ S: 2 }));
    expect(evaluate(decider("d", [cond(EACH, "!=", 0)], [out("S", 10)]), feed)).toEqual(v({ S: 40 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 50)], [out("S", 1)]), feed)).toEqual({});
  });

  it("F-12 assumption: an anything output emits the first passing signal in signal order", () => {
    expect(evaluate(decider("d", [cond(EACH, ">", 5)], [out(ANYTHING)]), feed)).toEqual(v({ B: 7 }));
    expect(evaluate(decider("d", [cond(EACH, "<", 0)], [out(ANYTHING, 3)]), feed)).toEqual(v({ D: 3 }));
  });

  it("F-12 assumption: each iterates the union of the networks of all each operands; an absent bound signal compares as 0", () => {
    const split = { red: { A: 5, B: 1 }, green: { B: 4, C: 2 } };
    expect(evaluate(decider("d", [cond(EACH, ">", 0, { firstNetworks: RED })], [out(EACH)]), split)).toEqual(v({ A: 5, B: 5 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 0, { firstNetworks: RED })], [out(EACH, "input", GREEN)]), split)).toEqual(v({ B: 4 }));
    const d = decider("d", [cond(EACH, ">", 0, { firstNetworks: RED }), and(EACH, "<", 3, { firstNetworks: GREEN })], [out(EACH, 1)], [out(EACH, -1)]);
    expect(evaluate(d, split)).toEqual(v({ A: 1, B: -1, C: -1 }));
  });

  it("F-12 assumption: each on the right-hand side is the bound signal's value on that operand's networks", () => {
    const split = { red: { A: 5, B: 1, C: 3 }, green: { A: 2, B: 4, C: 3 } };
    const d = decider("d", [cond(EACH, ">", EACH, { firstNetworks: RED, secondNetworks: GREEN })], [out(EACH, 1)], [out(EACH, -1)]);
    expect(evaluate(d, split)).toEqual(v({ A: 1, B: -1, C: -1 }));
    expect(evaluate(decider("d", [cond("T", "<", EACH)], [out(EACH)]), { red: { T: 4, A: 3, B: 9 } })).toEqual(v({ B: 9 }));
  });

  it("F-12 assumption: anything and everything next to each are evaluated on their own", () => {
    expect(evaluate(decider("d", [cond(EACH, ">", 5), and(ANYTHING, "<", 0)], [out(EACH)]), feed)).toEqual(v({ B: 7, C: 9 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 5), and(EVERYTHING, ">", 0)], [out(EACH)]), feed)).toEqual({});
  });

  it("F-14 assumption: a failing signal activates the else outputs", () => {
    const d = decider("d", [cond(EACH, ">", 5)], [out(EACH)], [out(EACH, 1), out("F"), out("N", 1)]);
    expect(evaluate(d, feed)).toEqual(v({ B: 7, C: 9, A: 1, D: 1, F: -1, N: 2 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 5)], [], [out(ANYTHING)]), feed)).toEqual(v({ A: 1 }));
    expect(evaluate(decider("d", [cond(EACH, ">", 0)], [out("P", 1)], [out("F", 1)]), { red: { A: 1 } })).toEqual(v({ P: 1 }));
  });

  it("F-12 assumption: results on the same signal add up across outputs", () => {
    expect(evaluate(decider("d", [cond(EACH, ">", 5)], [out(EACH), out(EACH, 1), out("B", 100)]), feed)).toEqual(v({ B: 208, C: 10 }));
  });
});
