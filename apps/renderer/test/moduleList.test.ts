// The module list of the project settings in words: the note of a row, its counts, the filter, and the notes around the list.
import { describe, expect, it } from "vitest";
import { consequence, FILTER_FROM, filterModules, listOrder, moduleCounts, MODS_HINT, modulesOffNotice, moduleTitles, otherModsNote, rowHint } from "../src/settings/moduleList.ts";
import type { ModuleView } from "../src/workbench/controller.ts";

const view = (name: string, title: string, more: Partial<ModuleView> = {}): ModuleView => ({ name, title, version: "1.0.0", game: false, enabled: true, canDisable: true, enables: [], disables: [], missing: [], signalCount: 0, entityCount: 0, ...more });
const MODULES = [view("base", "Base Mod", { game: true, canDisable: false }), view("space-age", "Space Age", { game: true }), view("quality", "Quality", { game: true }), view("bobs", "Bob's Logistics"), view("ltn", "LTN - Logistic Train Network")];
const LONG = "x".repeat(200);

describe("the note of a row", () => {
  it("says what switching the module does to others, or why it cannot be switched", () => {
    expect(consequence(MODULES[0]!, MODULES)).toBe("Always enabled");
    expect(consequence(view("a", "A"), MODULES)).toBeNull();
    expect(consequence(view("a", "A", { disables: ["quality", "bobs"] }), MODULES)).toBe("Switching off also switches off Quality, Bob's Logistics");
    expect(consequence(view("a", "A", { enabled: false, enables: ["space-age"] }), MODULES)).toBe("Switching on also switches on Space Age");
    expect(consequence(view("a", "A", { missing: ["space-age"] }), MODULES)).toBe("Needs Space Age, which is switched off");
    expect(consequence(view("a", "A", { missing: ["space-age", "quality"] }), MODULES)).toBe("Needs Space Age, Quality, which are switched off");
    // An enabled module's dependents are not what an enabling would bring, and the other way round.
    expect(consequence(view("a", "A", { enabled: false, disables: ["quality"] }), MODULES)).toBeNull();
  });

  it("names a few modules by their titles, cut to a length, and counts the rest", () => {
    expect(moduleTitles(["bobs", "ltn"], MODULES)).toBe("Bob's Logistics, LTN - Logistic Train Network");
    expect(moduleTitles(["base", "space-age", "quality", "bobs", "ltn", "gone"], MODULES)).toBe("Base Mod, Space Age, Quality, Bob's Logistics and 2 more");
    expect(moduleTitles(["gone"], MODULES)).toBe("gone");
    expect(moduleTitles(["long"], [view("long", LONG)])).toBe(`${"x".repeat(60)}...`);
    expect(moduleTitles([], MODULES)).toBe("");
  });

  it("counts the signals, and the entities where there are some", () => {
    expect(moduleCounts(view("a", "A", { signalCount: 771, entityCount: 17 }))).toBe("771 signals, 17 entities");
    expect(moduleCounts(view("a", "A", { signalCount: 1, entityCount: 1 }))).toBe("1 signal, 1 entity");
    expect(moduleCounts(view("a", "A", { signalCount: 0 }))).toBe("0 signals");
  });
});

describe("the filter of the list", () => {
  it("finds a module by its title or its name, whatever the case, and everything for no text", () => {
    const names = (text: string): string[] => filterModules(MODULES, text).map((module) => module.name);
    expect(names("")).toEqual(["base", "space-age", "quality", "bobs", "ltn"]);
    expect(names("   ")).toHaveLength(5);
    expect(names("LOGISTIC")).toEqual(["bobs", "ltn"]);
    expect(names(" space ")).toEqual(["space-age"]);
    expect(names("bobs")).toEqual(["bobs"]);
    expect(names("nothing like it")).toEqual([]);
    // The five of the built-in data need no filter; a game with mods soon does.
    expect(FILTER_FROM).toBeGreaterThan(5);
  });
});

describe("the notes around the list", () => {
  it("say which modules the project uses although they are off", () => {
    expect(modulesOffNotice([], MODULES)).toBeNull();
    expect(modulesOffNotice(["bobs"], MODULES)).toBe("This project uses signals or entities of Bob's Logistics, which is switched off. They are marked with a warning and are not offered.");
    expect(modulesOffNotice(["space-age", "quality", "bobs", "ltn", "base"], MODULES)).toBe(
      "This project uses signals or entities of Space Age, Quality, Bob's Logistics, LTN - Logistic Train Network and 1 more, which are switched off. They are marked with a warning and are not offered.",
    );
  });

  it("count the mods that are not in the list, and say where the mods come from", () => {
    expect(otherModsNote(0)).toBeNull();
    expect(otherModsNote(1)).toBe("1 other mod of your game adds no signals or entities.");
    expect(otherModsNote(14)).toBe("14 other mods of your game add no signals or entities.");
    expect(MODS_HINT).toBe("The mods of your game appear here after the game has been read in the application settings.");
  });
});

describe("the order of the rows", () => {
  it("has the game's modules as they come and the mods by title, whatever the case of title or name", () => {
    // As a game lists its mods: by name, capitals first.
    const titles = { LogisticTrainNetwork: "LTN - Logistic Train Network", Warehousing: "Warehousing Mod", "cargo-ships": "Cargo Ships", "crates-10": "crates 10", "crates-2": "Crates 2", "b-twin": "Twin", "a-twin": "Twin" };
    const mods = Object.entries(titles).map(([name, title]) => view(name, title));
    const listed = [...MODULES.slice(0, 3), ...mods];
    expect(listOrder(listed).map((module) => module.name)).toEqual(["base", "space-age", "quality", "cargo-ships", "crates-2", "crates-10", "LogisticTrainNetwork", "a-twin", "b-twin", "Warehousing"]);
    expect(listOrder(MODULES.slice(0, 3))).toEqual(MODULES.slice(0, 3));
    expect(listOrder([])).toEqual([]);
    // The list it is given stays as it is.
    expect(listed.map((module) => module.name).slice(3, 5)).toEqual(["LogisticTrainNetwork", "Warehousing"]);
  });

  it("says the title in full and the name on hover, the name alone where the mod has no other title", () => {
    expect(rowHint(view("LogisticTrainNetwork", "LTN - Logistic Train Network"))).toBe("LTN - Logistic Train Network (LogisticTrainNetwork)");
    expect(rowHint(view("f-unread", "f-unread"))).toBe("f-unread");
  });
});
