import { describe, expect, it } from "vitest";
import { applyMultiplier } from "../src/constant.ts";
import { INT_MAX, INT_MIN, circuit, constant, outputOf, section, simulate, v } from "./helpers.ts";

const emitted = (...args: Parameters<typeof constant> extends [string, ...infer R] ? R : never): Record<string, number> => outputOf(simulate(circuit([constant("c", ...args)])), "c");

describe("constant combinator", () => {
  it("documented: emits its filters, including quality (their presence at tick 0 is the F-03 assumption)", () => {
    expect(emitted({ A: 10, "item:iron-plate@rare": -5, "fluid:water": 1 })).toEqual(v({ A: 10, "item:iron-plate@rare": -5, "fluid:water": 1 }));
  });

  it("documented: emits nothing when switched off", () => {
    expect(emitted({ A: 10 }, false)).toEqual({});
  });

  it("documented: inactive sections contribute nothing and sections sum per signal", () => {
    expect(emitted([section({ A: 10, B: 1 }), section({ A: 5 }, { active: false }), section({ A: -3, C: 2 }, { group: "setpoints" })])).toEqual(v({ A: 7, B: 1, C: 2 }));
  });

  it("documented: the sum over sections wraps instead of clamping", () => {
    expect(emitted([section({ A: INT_MAX }), section({ A: 1 })])).toEqual(v({ A: INT_MIN }));
    expect(emitted([section({ A: INT_MIN }), section({ A: -1 })])).toEqual(v({ A: INT_MAX }));
  });

  it("F-20 assumption: a filter with count 0 and a zero sum emit nothing", () => {
    expect(emitted([section({ A: 0, B: 4 }), section({ B: -4 })])).toEqual({});
  });

  it("F-20 assumption: count * multiplier truncates toward zero", () => {
    expect(applyMultiplier(5, 0.5)).toBe(2);
    expect(applyMultiplier(-5, 0.5)).toBe(-2);
    expect(applyMultiplier(7, 1.5)).toBe(10);
    expect(applyMultiplier(3, 0.1)).toBe(0);
    expect(applyMultiplier(15, 0.1)).toBe(1);
    expect(applyMultiplier(5, -1)).toBe(-5);
    expect(applyMultiplier(5, 0)).toBe(0);
    expect(applyMultiplier(9, 1)).toBe(9);
  });

  it("F-20 assumption: binary representation error never makes a value one smaller", () => {
    expect(100 * 0.29).toBeLessThan(29);
    expect(applyMultiplier(100, 0.29)).toBe(29);
    expect(applyMultiplier(10, 0.7)).toBe(7);
    expect(applyMultiplier(30, 0.1)).toBe(3);
    expect(applyMultiplier(-100, 0.29)).toBe(-29);
  });

  it("F-20 assumption: a product outside int32 wraps; non-finite products are 0", () => {
    expect(applyMultiplier(INT_MAX, 2)).toBe(-2);
    expect(applyMultiplier(INT_MAX, 1.5)).toBe(-1073741826);
    expect(applyMultiplier(INT_MIN, -1)).toBe(INT_MIN);
    expect(applyMultiplier(1, Number.NaN)).toBe(0);
    expect(applyMultiplier(1, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("F-20 assumption: the multiplier applies per section before summation, grouped or not", () => {
    expect(emitted([section({ A: 5, B: 3 }, { multiplier: 0.5 }), section({ A: 5 }, { multiplier: 1.5, group: "g" }), section({ B: 3 }, { multiplier: -1 })])).toEqual(v({ A: 9, B: -2 }));
  });

  it("skips wildcard filters; the rest of the combinator still emits", () => {
    expect(emitted({ each: 5, anything: 1, everything: 2, A: 3 })).toEqual(v({ A: 3 }));
  });
});
