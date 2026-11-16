// The module list of a game with mods: which modules a project switches, how they depend on each other through mods that are
// not in the list, and the picker tree for any set of them. The data is tests/fixtures/game/moddedCatalog.ts.
import { describe, expect, it } from "vitest";
import {
  BASE_IN_SPACE_AGE_ROW, BASE_IN_SPACE_TAB, FILLERS, fillerSignal, LISTED_MODS, MACHINE_CRATE, MACHINES, manyModsCatalog, manyModsEntities, ORE, ORE_ITEM, ORE_RECYCLING, UNLISTED_MODS, UNREAD,
} from "../../../tests/fixtures/game/moddedCatalog.ts";
import {
  BASE_MODULE, STANDARD_MODULES, availableSignals, createCatalog, dependentModules, disableModule, enableModule, findSignal, isGameModule, listedModules, namedModules, pickerTree, resolveModules,
  type ModuleInfo, type PickerGroup, type PickerOptions,
} from "../src/index.ts";

const catalog = createCatalog(manyModsCatalog());
const GAME = [...STANDARD_MODULES];
const contributing = namedModules(manyModsEntities().entities.map((entity) => ({ modules: entity.modules ?? [BASE_MODULE] })), namedModules(catalog.signals));
const listed = listedModules(catalog.modules, contributing);
const names = listed.map((module) => module.name);
const module = (name: string): ModuleInfo => listed.find((candidate) => candidate.name === name)!;
const keys = (tree: readonly PickerGroup[]): string[] => tree.flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.map((entry) => entry.key)));

describe("the modules a project switches", () => {
  it("are the game's own and the mods that add a signal or a wired entity, in the order of the catalog", () => {
    expect([...contributing].sort()).toEqual([...GAME, ...LISTED_MODS].sort());
    expect(names).toEqual([...GAME, ...LISTED_MODS]);
    for (const name of UNLISTED_MODS) expect(names).not.toContain(name);
    expect([isGameModule("space-age"), isGameModule(ORE), BASE_MODULE]).toEqual([true, false, "base"]);
    // The game's own modules are listed whatever they add.
    expect(listedModules(catalog.modules, new Set()).map((entry) => entry.name)).toEqual(GAME);
  });

  it("require what they need through mods that are not listed, and nothing that is not listed", () => {
    // c-ore needs a-lib, which adds nothing; e-machines needs d-glue, which adds nothing and needs c-ore.
    expect(module(ORE).requires).toEqual(["base"]);
    expect(module(MACHINES)).toMatchObject({ requires: ["base", ORE], recommends: [FILLERS[0]] });
    expect(module(UNREAD)).toMatchObject({ requires: [], recommends: [] });
    expect(module("space-age")).toEqual(catalog.modules.find((entry) => entry.name === "space-age"));
    for (const entry of listed) for (const name of [...entry.requires, ...entry.recommends]) expect(names, `${entry.name} -> ${name}`).toContain(name);
  });

  it("switch on with what they require and off with what requires them", () => {
    expect(enableModule(listed, ["base"], MACHINES)).toEqual({ enabled: ["base", ORE, MACHINES], changed: [ORE, MACHINES] });
    expect(enableModule(listed, ["base"], MACHINES, { withRecommended: true }).changed).toEqual([ORE, MACHINES, FILLERS[0]]);
    expect(dependentModules(listed, names, ORE)).toEqual([MACHINES]);
    expect(disableModule(listed, names, ORE).changed).toEqual([ORE, MACHINES]);
    expect(disableModule(listed, names, FILLERS[0]!).changed).toEqual([FILLERS[0]]);
    // Every mod needs the base module but the one whose info could not be read.
    expect(dependentModules(listed, names, "base")).toEqual(names.filter((name) => name !== "base" && name !== UNREAD));
    for (const name of names) {
      expect(resolveModules(listed, enableModule(listed, [], name).enabled).valid, `enable ${name}`).toBe(true);
      expect(resolveModules(listed, disableModule(listed, names, name).enabled).valid, `disable ${name}`).toBe(true);
    }
  });

  it("pass over a dependency that names no module, itself or a circle", () => {
    const odd: ModuleInfo[] = [
      { name: "base", title: "Base", version: "1", requires: [], recommends: [], featureFlags: [] },
      { name: "x", title: "X", version: "1", requires: ["y", "gone", "x"], recommends: ["x", "gone", "y"], featureFlags: [] },
      { name: "y", title: "Y", version: "1", requires: ["x", "base"], recommends: [], featureFlags: [] },
    ];
    expect(listedModules(odd, new Set(["x", "y"])).map((entry) => [entry.name, entry.requires, entry.recommends])).toEqual([["base", [], []], ["x", ["base", "y"], ["y"]], ["y", ["base", "x"], []]]);
    expect(listedModules(odd, new Set(["x"])).map((entry) => [entry.name, entry.requires, entry.recommends])).toEqual([["base", [], []], ["x", ["base"], []]]);
  });
});

describe("a record of two modules", () => {
  it("is there when both are on", () => {
    const recycling = `recipe:${ORE_RECYCLING}`;
    expect(findSignal(catalog, recycling)!.modules).toEqual(["recycler", ORE]);
    expect(findSignal(catalog, recycling, ["base", "recycler", ORE])?.key).toBe(recycling);
    expect([findSignal(catalog, recycling, ["base", "recycler"]), findSignal(catalog, recycling, ["base", ORE])]).toEqual([undefined, undefined]);
  });

  it("makes a mod one that a project switches wherever the record names it", () => {
    expect([...namedModules([{ modules: ["recycler", ORE] }, { modules: [ORE, "d-glue", ORE] }, { modules: [] }])]).toEqual(["recycler", ORE, "d-glue"]);
    // A mod that only a recipe of another module names, in the second place, is listed as the others are.
    const second = namedModules([{ modules: ["recycler", "d-glue"] }]);
    expect(listedModules(catalog.modules, second).map((entry) => entry.name)).toEqual([...GAME, "d-glue"]);
    expect(listedModules(catalog.modules, second).at(-1)).toMatchObject({ requires: ["base"], recommends: [] });
  });
});

describe("the picker tree with mods", () => {
  const OPTIONS: readonly PickerOptions[] = [{}, { hidden: true, parameters: true }, { kinds: ["entity"], hidden: true, wildcards: false }];

  it("has a subgroup with a signal in it and a group with such a subgroup, whoever created them", () => {
    // The item of c-ore sits in the subgroup and the group of b-tabs, which is no module a project switches and never on.
    const ore = pickerTree(catalog, ["base", ORE]);
    const tab = ore.find((group) => group.group.name === "mod-tab")!;
    expect(tab.subgroups.map((subgroup) => [subgroup.subgroup.name, subgroup.signals.map((entry) => entry.key)])).toEqual([["mod-row", [`item:${ORE_ITEM}`]]]);
    expect(pickerTree(catalog, ["base"]).map((group) => group.group.name)).not.toContain("mod-tab");
    expect(keys(pickerTree(catalog, ["base", "recycler", ORE]))).toContain(`recipe:${ORE_RECYCLING}`);

    // Signals of base in a subgroup of Space Age, and in the group of Space Age, with Space Age off.
    const base = pickerTree(catalog, ["base"]);
    expect(base.find((group) => group.group.name === "production")!.subgroups.find((subgroup) => subgroup.subgroup.name === "agriculture")!.signals.map((entry) => entry.name)).toEqual([BASE_IN_SPACE_AGE_ROW]);
    expect(base.find((group) => group.group.name === "space")!.subgroups.map((subgroup) => [subgroup.subgroup.name, subgroup.signals.map((entry) => entry.name)])).toEqual([["base-row", [BASE_IN_SPACE_TAB]]]);

    // The hidden signals too: the entity of e-machines in a subgroup of base.
    expect(keys(pickerTree(catalog, [MACHINES], { kinds: ["entity"], hidden: true }))).toEqual([`entity:${MACHINE_CRATE}`]);
  });

  it("has exactly the signals that exist for the modules, for every module switched off and on, alone and with what depends on it", () => {
    const sets: (readonly string[])[] = [[], names];
    for (const name of names) {
      // Alone, as a hand-edited project file may have it, with what it requires, and everything without it, with and without its dependents.
      sets.push([name], enableModule(listed, [], name).enabled, enableModule(listed, [], name, { withRecommended: true }).enabled);
      sets.push(names.filter((other) => other !== name), disableModule(listed, names, name).enabled);
      // And from the modules of a new project: the game's own with this one more, or less.
      sets.push(enableModule(listed, GAME, name).enabled, disableModule(listed, GAME, name).enabled);
    }
    for (const enabled of sets) {
      for (const options of OPTIONS) {
        const visibility = ["normal", ...(options.wildcards ?? true ? ["wildcard"] : []), ...(options.parameters ? ["parameter"] : []), ...(options.hidden ? ["hidden"] : [])] as ("normal" | "wildcard" | "parameter" | "hidden")[];
        const expected = availableSignals(catalog, enabled, { visibility, kinds: options.kinds }).map((entry) => entry.key).sort();
        let tree: PickerGroup[] = [];
        expect(() => (tree = pickerTree(catalog, enabled, options)), enabled.join(" ")).not.toThrow();
        expect(keys(tree).sort(), enabled.join(" ")).toEqual(expected);
      }
    }
    expect(keys(pickerTree(catalog, names))).toContain(`virtual:${fillerSignal(FILLERS[5]!)}`);
  });

  it("still refuses data with a signal whose subgroup it does not have", () => {
    const data = manyModsCatalog();
    const broken = createCatalog({ ...data, subgroups: data.subgroups.filter((subgroup) => subgroup.name !== "mod-row") });
    expect(() => pickerTree(broken, ["base", ORE])).toThrow(/subgroup "mod-row"/);
    expect(() => pickerTree(createCatalog({ ...data, groups: data.groups.filter((group) => group.name !== "mod-tab") }), ["base", ORE])).toThrow(/group "mod-tab"/);
  });
});
