// The text of the wire reach field of the project settings.
import { describe, expect, it } from "vitest";
import { parseWireReach, WIRE_REACH_ERROR } from "../src/settings/wireReach.ts";

describe("wire reach field", () => {
  it("reads whole numbers and fractions, with a point or a comma", () => {
    expect(parseWireReach("9")).toBe(9);
    expect(parseWireReach(" 12.5 ")).toBe(12.5);
    expect(parseWireReach("7,25")).toBe(7.25);
    expect(parseWireReach("1")).toBe(1);
    expect(parseWireReach("100")).toBe(100);
    expect(parseWireReach("100.0")).toBe(100);
  });

  it("refuses what is not a number in the range", () => {
    for (const text of ["", " ", "0", "0.99", "100.01", "101", "-9", "+9", "nine", "9 tiles", "1e2", "0x10", "9.", ".5", "1.2.3", "1,000.5", "Infinity"]) expect(parseWireReach(text), JSON.stringify(text)).toBeUndefined();
    expect(WIRE_REACH_ERROR).toBe("A number from 1 to 100");
  });
});
