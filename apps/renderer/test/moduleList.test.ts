// The module list of the project settings in words: the note of a row, its counts, the filter, and the notes around the list.
import { describe, expect, it } from "vitest";
import { consequence, FILTER_FROM, filterModules, listedRows, listOrder, moduleCounts, MODS_HINT, modulesOffNotice, moduleTitles, NOTHING_TO_CHOOSE, otherModsNote, rowHint } from "../src/settings/moduleList.ts";
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

  it("names them in the order of the rows, whatever order the names come in", () => {
    // As the catalog has them: by name, capitals first, the game's modules among the mods.
    const modules = [view("LogisticTrainNetwork", "LTN - Logistic Train Network"), view("base", "Base Mod", { game: true }), view("nixie-tubes", "Nixie Tubes"), view("cargo-ships", "Cargo Ships"), view("quality", "Quality", { game: true })];
    expect(moduleTitles(["LogisticTrainNetwork", "nixie-tubes", "cargo-ships"], modules)).toBe("Cargo Ships, LTN - Logistic Train Network, Nixie Tubes");
    expect(moduleTitles(["nixie-tubes", "gone", "quality", "LogisticTrainNetwork", "base"], modules)).toBe("Base Mod, Quality, LTN - Logistic Train Network, Nixie Tubes and 1 more");
    expect(moduleTitles(["nixie-tubes", "quality"], modules, 1)).toBe("Quality and 1 more");
    expect(consequence(view("a", "A", { enabled: false, enables: ["nixie-tubes", "cargo-ships", "base"] }), modules)).toBe("Switching on also switches on Base Mod, Cargo Ships, Nixie Tubes");
    expect(modulesOffNotice(["LogisticTrainNetwork", "nixie-tubes"], modules)).toBe("This project uses signals or entities of LTN - Logistic Train Network, Nixie Tubes, which are switched off. They are marked with a warning and are not offered.");
    expect(modulesOffNotice(["nixie-tubes", "cargo-ships"], modules)).toContain("of Cargo Ships, Nixie Tubes, which are");
  });

  it("counts the signals and the entities, and leaves out a count of none", () => {
    expect(moduleCounts(view("a", "A", { signalCount: 771, entityCount: 17 }))).toBe("771 signals, 17 entities");
    expect(moduleCounts(view("a", "A", { signalCount: 1, entityCount: 1 }))).toBe("1 signal, 1 entity");
    expect(moduleCounts(view("a", "A", { signalCount: 5 }))).toBe("5 signals");
    expect(moduleCounts(view("a", "A", { entityCount: 67 }))).toBe("67 entities");
    expect(moduleCounts(view("a", "A", { entityCount: 1 }))).toBe("1 entity");
    // A row it has only while it is on or in use: what it adds is all hidden.
    expect(moduleCounts(view("a", "A"))).toBe("Only hidden signals or entities");
    expect(NOTHING_TO_CHOOSE).toBe("Only hidden signals or entities");
  });
});

describe("the rows of the list", () => {
  const names = (modules: readonly ModuleView[], used: readonly string[] = []): string[] => listedRows(modules, used).map((module) => module.name);
  const game = view("elevated-rails", "Elevated Rails", { game: true, enabled: false });
  const signals = view("nixie", "Nixie Tubes", { enabled: false, signalCount: 8 });
  const entities = view("crates", "Crates", { enabled: false, entityCount: 1 });
  const hidden = view("helper", "Helper", { enabled: false });

  it("have every module of the game and every mod that adds a signal or an entity to choose, on or off", () => {
    expect(names([game, signals, entities])).toEqual(["elevated-rails", "nixie", "crates"]);
    expect(names([{ ...signals, enabled: true }, { ...entities, enabled: true }])).toEqual(["nixie", "crates"]);
    expect(names([])).toEqual([]);
  });

  it("have a mod that adds only hidden signals or entities while the project has it switched on or uses something of it", () => {
    const modules = [game, signals, hidden, view("other", "Other", { enabled: false })];
    expect(names(modules)).toEqual(["elevated-rails", "nixie"]);
    // In use although it is off: the row is where it is switched on.
    expect(names(modules, ["helper"])).toEqual(["elevated-rails", "nixie", "helper"]);
    expect(names(modules, ["other", "helper", "gone"])).toEqual(["elevated-rails", "nixie", "helper", "other"]);
    // Switched on: the row is where it is switched off again.
    expect(names([game, signals, { ...hidden, enabled: true }])).toEqual(["elevated-rails", "nixie", "helper"]);
    // The list it is given stays as it is, and so do its rows.
    expect(listedRows(modules, ["helper"])[2]).toBe(hidden);
    expect(modules).toHaveLength(4);
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
      "This project uses signals or entities of Base Mod, Space Age, Quality, Bob's Logistics and 1 more, which are switched off. They are marked with a warning and are not offered.",
    );
  });

  it("count the mods that are not in the list, and say where the mods come from", () => {
    expect(otherModsNote(0)).toBeNull();
    // True of a mod that adds nothing and of one that adds only what is hidden.
    expect(otherModsNote(1)).toBe("1 other mod of your game adds nothing that can be chosen here.");
    expect(otherModsNote(14)).toBe("14 other mods of your game add nothing that can be chosen here.");
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
    // Anything with a name, a title and the mark of the game is ordered, and comes back as it went in.
    const plain = [{ name: "b", title: "beta", game: false }, { name: "a", title: "Alpha", game: false }, { name: "base", title: "Base Mod", game: true }];
    expect(listOrder(plain)).toEqual([plain[2], plain[1], plain[0]]);
  });

  it("says the title in full and the name on hover, the name alone where the mod has no other title", () => {
    expect(rowHint(view("LogisticTrainNetwork", "LTN - Logistic Train Network"))).toBe("LTN - Logistic Train Network (LogisticTrainNetwork)");
    expect(rowHint(view("f-unread", "f-unread"))).toBe("f-unread");
  });
});
