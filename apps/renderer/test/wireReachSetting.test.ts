// The text of the wire reach field of the project settings.
import { describe, expect, it } from "vitest";
import { parseWireReach, WIRE_REACH_ERROR } from "../src/settings/wireReach.ts";

describe("wire reach field", () => {
  it("reads whole numbers and fractions, with a point or a comma", () => {
    expect(parseWireReach("9")).toBe(9);
    expect(parseWireReach(" 12.5 ")).toBe(12.5);
    expect(parseWireReach("7,25")).toBe(7.25);
    expect(parseWireReach("0.5")).toBe(0.5);
    expect(parseWireReach("64")).toBe(64);
    expect(parseWireReach("64.0")).toBe(64);
    // Unlimited.
    expect(parseWireReach("0")).toBe(0);
    expect(parseWireReach("0,0")).toBe(0);
  });

  it("brings a number out of range to the nearest end of it", () => {
    for (const text of ["64.5", "64,01", "65", "100", "999999999999"]) expect(parseWireReach(text), text).toBe(64);
    for (const text of ["-1", "-0", "-0,5", " -100 "]) expect(parseWireReach(text), text).toBe(0);
  });

  it("refuses what is not a number", () => {
    for (const text of ["", " ", "-", "--1", "+9", "nine", "9 tiles", "1e2", "0x10", "9.", ".5", "1.2.3", "1,000.5", "Infinity"]) expect(parseWireReach(text), JSON.stringify(text)).toBeUndefined();
    expect(WIRE_REACH_ERROR).toBe("A number from 0 to 64; 0 means unlimited");
  });
});
