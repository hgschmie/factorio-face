// The modules of a project with data read from a game with many mods: which are listed, how they switch with their
// dependencies, what a signal or an entity of a module that is off does, that no set of modules breaks the picker, the
// selector or the simulation, and the blueprint import, which switches on what it needs.
import { encodeBlueprintString } from "@face/blueprints";
import { loadStandardCatalog, STANDARD_CATALOG_VERSION } from "@face/catalog";
import { analyze, completionContext } from "@face/language";
import { signal } from "@face/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE_IN_SPACE_TAB, FILLERS, fillerSignal, LISTED_MODS, MACHINE_CRATE, MACHINES, MACHINES_TITLE, ORE, ORE_ITEM, ORE_RECYCLING, UNREAD, UNREAD_SIGNAL,
} from "../../../../tests/fixtures/game/moddedCatalog.ts";
import { applyData, type DataInUse } from "../../src/gameData/dataInUse.ts";
import { completionCandidates } from "../../src/session/completion.ts";
import { modulesUsedOff } from "../../src/session/moduleUse.ts";
import { CatalogService } from "../../src/session/catalogService.ts";
import { listedRows, otherModsNote } from "../../src/settings/moduleList.ts";
import { defaultModules } from "../../src/session/persistence.ts";
import { ProjectSession } from "../../src/session/projectSession.ts";
import { manyModsData } from "../fixtures/moddedData.ts";
import { createSession, EMPTY_SOURCE, fakeDesktop, project } from "./helpers.ts";

const GAME = ["base", "elevated-rails", "recycler", "quality", "space-age"];
const ALL = [...GAME, ...LISTED_MODS];
const USES_MODS = `circuit "Uses mods" {
    ${MACHINE_CRATE} crate at (40, 80) {
    }

    constant-combinator source at (300, 80) {
        item:${ORE_ITEM} = 1
        recipe:${ORE_RECYCLING} = 2
        virtual:${UNREAD_SIGNAL} = 3
        item:iron-plate = 4
    }
}
`;

let data: DataInUse;
beforeAll(() => {
  data = applyData(manyModsData());
});
afterAll(() => applyData({ source: { kind: "built-in", version: STANDARD_CATALOG_VERSION }, problem: null, mods: [], catalog: null, entities: null, icons: [] }));

const sessionWith = (modules: readonly string[], source = EMPTY_SOURCE, api?: ReturnType<typeof fakeDesktop>["api"]): ProjectSession => createSession(source, { data, api, project: project(source, { modules: [...modules] }) }).session;
const enabledOf = (session: ProjectSession): string[] => session.state.catalog.modules.filter((module) => module.enabled).map((module) => module.name);
const row = (session: ProjectSession, name: string) => session.state.catalog.modules.find((module) => module.name === name)!;
/** The rows of the project settings, and the line about the mods that have none. */
const rows = (session: ProjectSession): string[] => listedRows(session.state.catalog.modules, session.state.project.modulesOff).map((module) => module.name);
const otherMods = (session: ProjectSession): string | null => otherModsNote(session.state.catalog.otherMods + session.state.catalog.modules.length - rows(session).length);
const picked = (session: ProjectSession): string[] => session.state.catalog.picker().flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.map((entry) => entry.key)));

describe("the module list with the mods of a game", () => {
  it("has the game's modules and the mods that add a signal or an entity, and counts the others", () => {
    const session = new ProjectSession({ editorExtensions: [], data });
    const { catalog } = session.state;
    expect(catalog.modules.map((module) => module.name)).toEqual(ALL);
    expect(catalog.modules.map((module) => module.game)).toEqual(ALL.map((name) => GAME.includes(name)));
    expect(catalog.otherMods).toBe(3);
    expect(enabledOf(session)).toEqual(GAME);
    // What a new project lists: the game's own modules, in the order of the empty project.
    expect(defaultModules((catalog as CatalogService).catalog)).toEqual(["base", "space-age", "quality", "recycler", "elevated-rails"]);
    expect(defaultModules({ modules: [{ name: "base" }, { name: "recycler" }, { name: ORE }] })).toEqual(["base", "recycler"]);
    expect(row(session, MACHINES)).toMatchObject({ title: MACHINES_TITLE, signalCount: 1, entityCount: 1, canDisable: true, enables: [ORE, FILLERS[0]] });
    // The recycling recipe of the ore counts for the recycler as well; a mod with hidden signals only is listed with none.
    expect(row(session, ORE)).toMatchObject({ signalCount: 2, entityCount: 0, enables: [] });
    expect(row(session, "recycler").signalCount).toBe(loadStandardCatalog().signals.filter((entry) => entry.visibility === "normal" && entry.modules.includes("recycler")).length + 1);
    expect(row(session, UNREAD)).toMatchObject({ title: UNREAD, signalCount: 0, entityCount: 0, canDisable: true, enables: [] });
  });

  it("gives a mod with hidden signals only a row while the project has it on or uses it, and counts it with the other mods otherwise", () => {
    const visible = ALL.filter((name) => name !== UNREAD);
    const unused = sessionWith(GAME);
    expect(rows(unused)).toEqual(visible);
    expect(otherMods(unused)).toBe("4 other mods of your game add nothing that can be chosen here.");
    // The catalog still lists it: that is how a source that uses it, and the import of a blueprint, switch it on.
    expect(row(unused, UNREAD)).toMatchObject({ enabled: false, signalCount: 0, entityCount: 0 });

    // In use although it is off: it has its row, and the notice of the modules in use names it.
    const used = sessionWith(GAME, USES_MODS);
    expect(used.state.project.modulesOff).toContain(UNREAD);
    expect(rows(used)).toEqual(ALL);
    expect(otherMods(used)).toBe("3 other mods of your game add nothing that can be chosen here.");
    // Switched on it keeps the row, where it is switched off again; off and no longer in use, it has none.
    used.commands.enableUsedModules();
    expect(used.state.project.modulesOff).toEqual([]);
    expect(rows(used)).toEqual(ALL);
    unused.commands.setModuleEnabled(UNREAD, true);
    expect(rows(unused)).toEqual(ALL);
    unused.commands.setModuleEnabled(UNREAD, false);
    expect(rows(unused)).toEqual(visible);
  });

  it("switches a mod on with what it requires and recommends, and off with what requires it", () => {
    const session = sessionWith(GAME);
    session.commands.setModuleEnabled(MACHINES, true);
    expect(enabledOf(session)).toEqual([...GAME, ORE, MACHINES, FILLERS[0]]);
    expect(row(session, ORE).disables).toEqual([MACHINES]);
    expect(row(session, "base").disables).toEqual(["elevated-rails", "recycler", "quality", "space-age", ORE, MACHINES, FILLERS[0]]);
    session.commands.setModuleEnabled(ORE, false);
    expect(enabledOf(session)).toEqual([...GAME, FILLERS[0]]);
    // A mod whose dependencies are not known switches by itself, also without the base module's say.
    session.commands.setModuleEnabled(UNREAD, true);
    session.commands.setModuleEnabled(UNREAD, false);
    expect(enabledOf(session)).toEqual([...GAME, FILLERS[0]]);
    // A mod that adds nothing is no module to switch.
    const before = session.state.catalog;
    session.commands.setModuleEnabled("a-lib", true);
    session.commands.setModuleEnabled("d-glue", true);
    expect(session.state.catalog).toBe(before);
  });

  it("keeps the names of the project file that the list does not have, and shows those the data does not know", () => {
    const session = sessionWith(["base", "a-lib", "no-such-mod", ORE]);
    expect(session.state.catalog.unknownModules).toEqual(["no-such-mod"]);
    expect(enabledOf(session)).toEqual(["base", ORE]);
    expect(row(session, ORE).missing).toEqual([]);
    session.commands.setModuleEnabled(FILLERS[1]!, true);
    expect((session.state.catalog as CatalogService).requested).toEqual(["base", ORE, FILLERS[1], "a-lib", "no-such-mod"]);
    expect(session.state.catalog.unknownModules).toEqual(["no-such-mod"]);
    // A hand-edited list without what a mod requires says so on its row.
    expect(row(sessionWith(["base", MACHINES]), MACHINES).missing).toEqual([ORE]);
  });

  it("never loses the picker, the selector or the simulation, whichever module is switched off or on", () => {
    const check = (session: ProjectSession, what: string): void => {
      const { catalog } = session.state;
      const keys = picked(session);
      expect(keys.length, what).toBeGreaterThan(500);
      expect(keys, what).toContain("virtual:signal-A");
      expect(keys, what).toContain(`virtual:${BASE_IN_SPACE_TAB}`);
      expect(catalog.entities().groups.length, what).toBeGreaterThan(1);
      expect(catalog.entities().offers("steel-chest"), what).toBe(true);
      session.commands.step();
      expect(session.state.simulation.tick, what).toBeGreaterThan(0);
      expect(session.state.editable, what).toBe(true);
    };
    for (const name of ALL) {
      const full = sessionWith(ALL, USES_MODS);
      full.commands.setModuleEnabled(name, false);
      check(full, `${name} off`);
      expect(picked(full).some((key) => key === `virtual:${fillerSignal(name)}`), name).toBe(false);
      full.commands.setModuleEnabled(name, true);
      check(full, `${name} on again`);

      const bare = sessionWith(["base"], USES_MODS);
      bare.commands.setModuleEnabled(name, true);
      check(bare, `${name} on alone`);
      // As a hand-edited project file may have it: the module without what it requires.
      check(sessionWith([name], USES_MODS), `${name} only`);
    }
  });
});

describe("a signal or an entity of a mod that is switched off", () => {
  it("stays in the source with a warning that names the mod by its title, and one command switches on what is needed", () => {
    const session = sessionWith(["base"], USES_MODS);
    expect(session.state.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message])).toEqual([
      ["disabled-prototype", `'${MACHINE_CRATE}' (Machine crate) is an entity of ${MACHINES_TITLE}, which is switched off in the project settings`],
      ["disabled-signal", `The signal 'item:${ORE_ITEM}' is of Ore Mod, which is switched off in the project settings`],
      ["disabled-signal", `The signal 'recipe:${ORE_RECYCLING}' is of Recycler and Ore Mod, which are switched off in the project settings`],
      ["disabled-signal", `The signal 'virtual:${UNREAD_SIGNAL}' is of ${UNREAD}, which is switched off in the project settings`],
    ]);
    expect(session.state.circuit.entities.map((entity) => entity.prototype)).toEqual([MACHINE_CRATE, "constant-combinator"]);
    // The inspector's sentence for the entity is the warning of the source; an entity of modules that are on has none.
    expect(session.state.catalog.entityWarning(MACHINE_CRATE)).toBe(session.state.diagnostics[0]!.message);
    expect(session.state.catalog.entityWarning("constant-combinator")).toBeUndefined();
    // In the order of the list, each once.
    expect(session.state.project.modulesOff).toEqual(["recycler", ORE, MACHINES, UNREAD]);
    expect(modulesUsedOff(USES_MODS, session.state.catalog as CatalogService)).toEqual(["recycler", ORE, MACHINES, UNREAD]);
    expect(modulesUsedOff("not a circuit {", session.state.catalog as CatalogService)).toEqual([]);

    // With only the recycler missing, the recipe names only it.
    session.commands.setModuleEnabled(ORE, true);
    expect(session.state.diagnostics.find((diagnostic) => diagnostic.message.includes(ORE_RECYCLING))?.message).toBe(`The signal 'recipe:${ORE_RECYCLING}' is of Recycler, which is switched off in the project settings`);
    expect(session.state.project.modulesOff).toEqual(["recycler", MACHINES, UNREAD]);

    session.commands.enableUsedModules();
    expect(enabledOf(session)).toEqual(["base", "recycler", ORE, MACHINES, UNREAD]);
    expect(session.state).toMatchObject({ diagnostics: [], source: USES_MODS, project: { modulesOff: [], dirty: true } });
    expect(session.state.catalog.entityWarning(MACHINE_CRATE)).toBeUndefined();
  });

  it("is not offered: not in the picker, the selector or the completion", () => {
    const off = sessionWith(GAME);
    const on = sessionWith(ALL);
    const labels = (session: ProjectSession, text: string): string[] => completionCandidates(completionContext(analyze(text.replace("|", "")), text.indexOf("|")), session.state.catalog as CatalogService).map((candidate) => candidate.label);
    const member = 'circuit "t" {\n    |\n}\n';
    const filter = 'circuit "t" {\n    constant-combinator c {\n        |\n    }\n}\n';
    expect(labels(on, member)).toEqual(expect.arrayContaining(["steel-chest", MACHINE_CRATE]));
    expect(labels(off, member)).toContain("steel-chest");
    expect(labels(off, member)).not.toContain(MACHINE_CRATE);
    expect(labels(on, filter)).toEqual(expect.arrayContaining([`item:${ORE_ITEM}`, `recipe:${ORE_RECYCLING}`, `item:${MACHINE_CRATE}`]));
    for (const label of [`item:${ORE_ITEM}`, `recipe:${ORE_RECYCLING}`, `item:${MACHINE_CRATE}`]) expect(labels(off, filter)).not.toContain(label);

    expect(picked(on)).toEqual(expect.arrayContaining([`item:${ORE_ITEM}`, `recipe:${ORE_RECYCLING}`]));
    expect(picked(off).filter((key) => key.includes("mod-ore"))).toEqual([]);
    // The recipe needs the recycler too.
    expect(picked(sessionWith(["base", ORE])).filter((key) => key.includes("mod-ore"))).toEqual([`item:${ORE_ITEM}`]);
    expect(off.state.catalog.describe(signal("item", ORE_ITEM))).toMatchObject({ status: "disabled", displayName: "Mod ore" });

    const [registryOn, registryOff] = [on.state.catalog.entities(), off.state.catalog.entities()];
    expect([registryOn.offers(MACHINE_CRATE), registryOff.offers(MACHINE_CRATE)]).toEqual([true, false]);
    expect(registryOn.groupOf(MACHINE_CRATE)).toBe("logistics");
  });
});

describe("a blueprint import with the mods of a game", () => {
  const at = (x: number, y: number) => ({ position: { x, y } });
  const filter = (index: number, type: string, name: string) => ({ index, type, name, quality: "normal", comparator: "=", count: 1 });
  const blueprint = (entities: object[]) => encodeBlueprintString({ blueprint: { item: "blueprint", label: "Modded", version: 562954249109504, entities } });
  const MODDED = blueprint([
    { entity_number: 1, name: MACHINE_CRATE, ...at(1, 1) },
    { entity_number: 2, name: "constant-combinator", ...at(3.5, 0.5), control_behavior: { sections: { sections: [{ index: 1, filters: [filter(1, "item", "carbon-fiber"), filter(2, "virtual", fillerSignal(FILLERS[2]!))] }] } } },
  ]);
  const PLAIN = blueprint([{ entity_number: 1, name: "small-lamp", ...at(0.5, 0.5) }]);

  it("switches on the mods its signals and entities are of, with what they require, and names them in the report", async () => {
    const desktop = fakeDesktop();
    const session = sessionWith(["base"], EMPTY_SOURCE, desktop.api);
    const reading = session.commands.readBlueprint(MODDED);
    if (reading.kind !== "blueprint") throw new Error(JSON.stringify(reading));
    // e-machines requires c-ore through a mod that is not listed; what it only recommends stays off. Space Age is on in a new project and not reported.
    expect(reading.blueprint.modules).toEqual([...GAME, ORE, MACHINES, FILLERS[2]]);
    expect(reading.blueprint.report).toEqual({
      summary: "Imported 2 entities and 0 wires.",
      dropped: [],
      wires: [],
      settings: [],
      remarks: [],
      // In the order of the rows of the project settings, by title; the catalog has them by name: c-ore, e-machines, g-filler-3.
      modules: [`Switched on: Filler 3, ${MACHINES_TITLE}, Ore Mod. The blueprint has their signals or entities; a new project has only the modules of the game itself on.`],
    });
    expect(await session.commands.openBlueprint(reading.blueprint)).toBe(true);
    expect(enabledOf(session)).toEqual([...GAME, ORE, MACHINES, FILLERS[2]]);
    expect(session.state).toMatchObject({ diagnostics: [], displayMode: "blueprint", project: { name: "Modded", dirty: true, modulesOff: [] } });
    expect(session.state.circuit.entities.map((entity) => entity.prototype)).toEqual([MACHINE_CRATE, "constant-combinator"]);
  });

  it("switches on every module of a recipe that two modules make, and names the one a new project has off", async () => {
    // The recycling recipe of the mod's ore is the recycler's and the mod's: the recycler is on in a new project, the mod is not.
    const sections = { sections: [{ index: 1, filters: [filter(1, "recipe", ORE_RECYCLING)] }] };
    const recycled = blueprint([{ entity_number: 1, name: "constant-combinator", ...at(0.5, 0.5), control_behavior: { sections } }]);
    const desktop = fakeDesktop();
    const session = sessionWith(["base"], EMPTY_SOURCE, desktop.api);
    const reading = session.commands.readBlueprint(recycled);
    if (reading.kind !== "blueprint") throw new Error(JSON.stringify(reading));
    expect(reading.blueprint.source).toContain(`recipe:${ORE_RECYCLING} = 1`);
    expect(reading.blueprint.modules).toEqual([...GAME, ORE]);
    expect(reading.blueprint.report?.modules).toEqual(["Switched on: Ore Mod. The blueprint has its signals or entities; a new project has only the modules of the game itself on."]);
    expect(await session.commands.openBlueprint(reading.blueprint)).toBe(true);
    expect(enabledOf(session)).toEqual([...GAME, ORE]);
    expect(session.state).toMatchObject({ diagnostics: [], project: { modulesOff: [] } });
    expect(picked(session)).toContain(`recipe:${ORE_RECYCLING}`);
    // Either of its modules switched off takes the recipe away, and the warning names the one that is off.
    for (const [name, title] of [["recycler", "Recycler"], [ORE, "Ore Mod"]] as const) {
      session.commands.setModuleEnabled(name, false);
      expect(session.state.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([`The signal 'recipe:${ORE_RECYCLING}' is of ${title}, which is switched off in the project settings`]);
      expect(session.state.project.modulesOff).toEqual([name]);
      expect(picked(session)).not.toContain(`recipe:${ORE_RECYCLING}`);
      session.commands.enableUsedModules();
      expect(session.state.diagnostics).toEqual([]);
    }
  });

  it("switches on a mod of which it uses a hidden signal, names it, and the mod then has its row", async () => {
    const hidden = blueprint([{ entity_number: 1, name: "constant-combinator", ...at(0.5, 0.5), control_behavior: { sections: { sections: [{ index: 1, filters: [filter(1, "virtual", UNREAD_SIGNAL)] }] } } }]);
    const session = sessionWith(GAME, EMPTY_SOURCE, fakeDesktop().api);
    expect(rows(session)).not.toContain(UNREAD);
    const reading = session.commands.readBlueprint(hidden);
    if (reading.kind !== "blueprint") throw new Error(JSON.stringify(reading));
    expect(reading.blueprint.modules).toEqual([...GAME, UNREAD]);
    expect(reading.blueprint.report?.modules).toEqual([`Switched on: ${UNREAD}. The blueprint has its signals or entities; a new project has only the modules of the game itself on.`]);
    expect(await session.commands.openBlueprint(reading.blueprint)).toBe(true);
    expect(enabledOf(session)).toEqual([...GAME, UNREAD]);
    expect(session.state).toMatchObject({ diagnostics: [], project: { modulesOff: [] } });
    expect(rows(session)).toContain(UNREAD);
  });

  it("opens a blueprint of the game itself with the modules of a new project and no report", async () => {
    const desktop = fakeDesktop();
    const session = sessionWith(ALL, EMPTY_SOURCE, desktop.api);
    const reading = session.commands.readBlueprint(PLAIN);
    if (reading.kind !== "blueprint") throw new Error(JSON.stringify(reading));
    expect(reading.blueprint).toMatchObject({ modules: ["base", "space-age", "quality", "recycler", "elevated-rails"], report: null });
    expect(await session.commands.openBlueprint(reading.blueprint)).toBe(true);
    expect(enabledOf(session)).toEqual(GAME);
  });
});
