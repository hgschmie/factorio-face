// What a search of the signal picker says about the signals it finds that the picker does not offer.
import { describe, expect, it } from "vitest";
import { matchesSearch, notOfferedNote } from "../src/picker/notOffered.ts";
import type { NotOfferedSignal } from "../src/workbench/controller.ts";

const signal = (displayName: string, ...switchedOff: string[]): NotOfferedSignal => {
  const name = displayName.toLowerCase().replaceAll(" ", "-");
  return { key: `item:${name}`, name, displayName, switchedOff };
};
const DIODE = [signal("Diode combinator", "Diode Combinator"), signal("Diode signal", "Diode Combinator")];
const FIBER = signal("Fiber diode", "Fiber Optics");
const HIDDEN = [signal("Wooden chest"), signal("Iron chest")];
const OFF_SETTINGS = "It is switched off in this project (Project Settings).";

describe("the search of the signal picker", () => {
  it("finds a signal by its name in the game or its internal name", () => {
    expect(["de comb", "de-comb", "item:", "chest"].map((query) => matchesSearch(DIODE[0]!, query))).toEqual([true, true, false, false]);
  });
});

describe("the note of a search about signals that are not offered", () => {
  it("says nothing without a search, and nothing when the search finds none of them", () => {
    expect(notOfferedNote([...DIODE, ...HIDDEN], "")).toBeNull();
    expect(notOfferedNote([...DIODE, ...HIDDEN], "   ")).toBeNull();
    expect(notOfferedNote([...DIODE, ...HIDDEN], "plate")).toBeNull();
    expect(notOfferedNote([], "diode")).toBeNull();
  });

  it("counts the signals of one group that is switched off, by the search of the picker", () => {
    expect(notOfferedNote(DIODE, "diode")).toBe(`2 signals of Diode Combinator match. ${OFF_SETTINGS}`);
    expect(notOfferedNote(DIODE, "  Diode SIG ")).toBe(`1 signal of Diode Combinator matches. ${OFF_SETTINGS}`);
    expect(notOfferedNote(DIODE, "diode-combinator")).toBe(`1 signal of Diode Combinator matches. ${OFF_SETTINGS}`);
    expect(notOfferedNote([signal("Thing", "x".repeat(200))], "thing")).toBe(`1 signal of ${"x".repeat(60)}... matches. ${OFF_SETTINGS}`);
  });

  it("names several groups by title with their counts, four at most", () => {
    const several = (titles: string): string => `Signals of groups that are switched off in this project match: ${titles}. They are switched on in the Project Settings.`;
    expect(notOfferedNote([FIBER, ...DIODE], "diode")).toBe(several("Diode Combinator (2), Fiber Optics (1)"));
    const many = ["nixie Tubes", "Cargo Ships", "LTN", "Bob's Logistics", "Mod 10", "Mod 9"].map((title) => signal(`Part of ${title}`, title));
    expect(notOfferedNote([...many, signal("Part two", "LTN")], "part")).toBe(several("Bob's Logistics (1), Cargo Ships (1), LTN (2), Mod 9 (1) and 2 more"));
    expect(notOfferedNote(many.slice(0, 4), "part")).toBe(several("Bob's Logistics (1), Cargo Ships (1), LTN (1), nixie Tubes (1)"));
  });

  it("counts a signal that needs several groups that are off for the first one it names", () => {
    expect(notOfferedNote([signal("Diode crate", "Fiber Optics", "Diode Combinator"), FIBER], "diode")).toBe(`2 signals of Fiber Optics match. ${OFF_SETTINGS}`);
  });

  it("counts the signals the user hid, and says both when the search finds both", () => {
    expect(notOfferedNote(HIDDEN, "wooden")).toBe('1 matching signal is hidden on this machine (Project Settings, "Signals and entities" of its group).');
    expect(notOfferedNote(HIDDEN, "chest")).toBe('2 matching signals are hidden on this machine (Project Settings, "Signals and entities" of their groups).');
    expect(notOfferedNote([...HIDDEN, ...DIODE, signal("Diode chest", "Fiber Optics")], "chest")).toBe(
      `1 signal of Fiber Optics matches. ${OFF_SETTINGS} 2 matching signals are hidden on this machine (Project Settings, "Signals and entities" of their groups).`,
    );
  });
});
