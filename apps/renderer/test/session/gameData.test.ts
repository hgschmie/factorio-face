// A session on data read from the user's game: the mods of the game are modules of the project like the game's own, off in a
// new project; what a mod brings can be placed and picked once the mod is on, and stays in the source with a warning while it is
// off; a save records the game's mods in the project file, and a project made with other mods says so when it is opened. With
// the built-in data the record of a project is kept as it is.
import { createCatalog, STANDARD_CATALOG_VERSION } from "@face/catalog";
import { signal } from "@face/model";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectMods } from "../../../desktop/src/ipc.ts";
import { applyData, builtInData, type DataInUse } from "../../src/gameData/dataInUse.ts";
import { CatalogService } from "../../src/session/catalogService.ts";
import { ProjectSession } from "../../src/session/projectSession.ts";
import { MOD, MOD_ENTITY, MOD_SIGNAL, MODDED_MODS, MODDED_MODULES, moddedData } from "../fixtures/moddedData.ts";
import { createSession, EMPTY_SOURCE, errorsOf, fakeDesktop, ManualScheduler, MANIFEST, project, type TestSession } from "./helpers.ts";

const RECORD: ProjectMods = { gameVersion: "2.1.25", mods: MODDED_MODS };
const OTHER_RECORD: ProjectMods = { gameVersion: "2.1.20", mods: [{ name: "base", version: "2.1.20" }, { name: MOD, version: "1.0.0" }, { name: "gone-mod", version: "0.2.0" }] };
const MODDED_CIRCUIT = `circuit "Modded" {
    ${MOD_ENTITY} crate at (40, 80) {
    }

    constant-combinator source at (300, 80) {
        virtual:${MOD_SIGNAL} = 1
        item:carbon-fiber = 2
    }
}
`;
const GAME_MODULES = ["base", "elevated-rails", "recycler", "quality", "space-age"];

afterEach(() => applyData({ source: { kind: "built-in", version: STANDARD_CATALOG_VERSION }, problem: null, mods: [], catalog: null, entities: null, icons: [] }));

/** A session on the modded data, which is applied as a window does at start. Without a project: the empty one, as the window starts. */
function modded(source?: string, options: ConstructorParameters<typeof ProjectSession>[0] = {}): TestSession & { readonly data: DataInUse } {
  const data = applyData(moddedData());
  if (source !== undefined || options.project) return { ...createSession(source ?? EMPTY_SOURCE, { data, ...options }), data };
  const scheduler = new ManualScheduler();
  return { session: new ProjectSession({ scheduler, editorExtensions: [], data, ...options }), scheduler, notifications: () => 0, data };
}

const codes = (session: ProjectSession): string[] => session.state.diagnostics.map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}`);

describe("with data read from the game", () => {
  it("starts a new project with the modules of the game itself on and its mods off", async () => {
    const desktop = fakeDesktop();
    const { session } = modded(undefined, { api: desktop.api });
    const listed = (): unknown[] => session.state.catalog.modules.map((module) => [module.name, module.enabled, module.canDisable]);
    expect(listed()).toEqual([["base", true, false], ["elevated-rails", true, true], ["recycler", true, true], ["quality", true, true], ["space-age", true, true], [MOD, false, true]]);
    expect(session.state.catalog).toMatchObject({ unknownModules: [], otherMods: 0 });
    expect(session.state.project).toMatchObject({ dirty: false, gameData: true, modulesOff: [] });
    // What the mod brings is not offered, and File > New Project gives the same.
    expect(session.state.catalog.entities().offers(MOD_ENTITY)).toBe(false);
    session.commands.setModuleEnabled(MOD, true);
    expect(session.state.project.dirty).toBe(true);
    desktop.unsavedChoice = "discard";
    await session.commands.newProject();
    expect(listed().at(-1)).toEqual([MOD, false, true]);
    expect(session.state.project).toMatchObject({ dirty: false, name: "Untitled circuit" });
  });

  it("leaves out of a new project a module of the game that the game did not have loaded", () => {
    const data = moddedData();
    const withoutQuality = applyData({ ...data, catalog: { ...data.catalog!, modules: data.catalog!.modules.filter((module) => module.name !== "quality").map((module) => ({ ...module, recommends: [] })) } });
    const session = new ProjectSession({ editorExtensions: [], data: withoutQuality });
    expect(session.state.catalog.modules.map((module) => [module.name, module.enabled])).toEqual([["base", true], ["elevated-rails", true], ["recycler", true], ["space-age", true], [MOD, false]]);
    expect(session.state.catalog.unknownModules).toEqual([]);
    expect(session.state.project.dirty).toBe(false);
    // A project that lists the module keeps the name, and says so.
    const kept = createSession(EMPTY_SOURCE, { data: withoutQuality }).session;
    expect(kept.state.catalog.unknownModules).toEqual(["quality"]);
  });

  it("has the list of the project, whatever data is in use: what is off stays in the source with a warning that names the module", () => {
    const { session } = modded(EMPTY_SOURCE, { project: project(MODDED_CIRCUIT, { modules: ["base", "no-such-module"] }) });
    const { catalog } = session.state;
    expect(catalog.modules.map((module) => [module.name, module.enabled])).toEqual([["base", true], ["elevated-rails", false], ["recycler", false], ["quality", false], ["space-age", false], [MOD, false]]);
    expect(catalog.unknownModules).toEqual(["no-such-module"]);
    expect(session.state.diagnostics.map((diagnostic) => [diagnostic.severity, diagnostic.code, diagnostic.message])).toEqual([
      ["warning", "disabled-prototype", `'${MOD_ENTITY}' (Mod crate) is an entity of Some Mod, which is switched off in the project settings`],
      ["warning", "disabled-signal", `The signal 'virtual:${MOD_SIGNAL}' is of Some Mod, which is switched off in the project settings`],
      ["warning", "disabled-signal", "The signal 'item:carbon-fiber' is of Space Age, which is switched off in the project settings"],
    ]);
    // Parsed, on the canvas and simulated all the same; only not offered.
    expect(session.state).toMatchObject({ editable: true, source: MODDED_CIRCUIT });
    expect(session.state.circuit.entities.map((entity) => [entity.name, entity.prototype])).toEqual([["crate", MOD_ENTITY], ["source", "constant-combinator"]]);
    session.commands.step();
    expect(session.state.simulation.tick).toBe(1);
    expect(catalog.describe(signal("virtual", MOD_SIGNAL))).toMatchObject({ status: "disabled", displayName: "Mod signal" });
    expect(catalog.entities().offers(MOD_ENTITY)).toBe(false);
    expect(catalog.entities().entry(MOD_ENTITY)).toMatchObject({ label: "Mod crate" });
    expect(catalog.picker().flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.map((entry) => entry.key)))).not.toContain(`virtual:${MOD_SIGNAL}`);

    // The project says which modules it uses although they are off, and one command switches them on, with what they require
    // and without what they only recommend (Quality).
    expect(session.state.project).toMatchObject({ dirty: false, modulesOff: ["space-age", MOD] });
    session.commands.enableUsedModules();
    expect(session.state.catalog.modules.filter((module) => module.enabled).map((module) => module.name)).toEqual(["base", "elevated-rails", "recycler", "space-age", MOD]);
    expect(session.state.catalog.unknownModules).toEqual(["no-such-module"]);
    expect(session.state).toMatchObject({ diagnostics: [], source: MODDED_CIRCUIT, canUndo: false });
    expect(session.state.project).toMatchObject({ dirty: true, modulesOff: [] });
    const settled = session.state.catalog;
    session.commands.enableUsedModules();
    expect(session.state.catalog).toBe(settled);

    // Switched off again, the mod's entity and signal have their warnings again; the base module cannot be switched off.
    session.commands.setModuleEnabled(MOD, false);
    expect(codes(session)).toEqual(["warning disabled-prototype", "warning disabled-signal"]);
    expect(session.state.project.modulesOff).toEqual([MOD]);
    session.commands.setModuleEnabled("base", false);
    expect(session.state.catalog.modules[0]).toMatchObject({ name: "base", enabled: true });
  });

  it("shows a mod by its title, with what it brings and what switching it does", () => {
    const { session } = modded();
    const { catalog } = session.state;
    expect(catalog.modules.at(-1)).toEqual({ name: MOD, title: "Some Mod", version: "1.2.3", game: false, enabled: false, canDisable: true, enables: [], disables: [], missing: [], signalCount: 1, entityCount: 1, hasItems: true });
    expect(catalog.modules[0]).toMatchObject({ name: "base", game: true, enabled: true, canDisable: false, disables: ["elevated-rails", "recycler", "quality", "space-age"] });
    expect(catalog.modules[4]).toMatchObject({ name: "space-age", game: true, entityCount: 17 });
    const data = createCatalog(moddedData().catalog!);
    expect(data.signalsByKey.get(`virtual:${MOD_SIGNAL}`)!.modules).toEqual([MOD]);

    const without = new CatalogService(data, ["base", "space-age", "elevated-rails", "recycler"]);
    expect(without.describe(signal("virtual", MOD_SIGNAL)).status).toBe("disabled");
    expect([without.signalModulesOff(signal("virtual", MOD_SIGNAL)), without.switchedOff(signal("virtual", MOD_SIGNAL)), without.prototypeModulesOff(MOD_ENTITY), without.prototypes.switchedOff(MOD_ENTITY)]).toEqual([[MOD], ["Some Mod"], [MOD], ["Some Mod"]]);
    expect([without.offersPrototype(MOD_ENTITY), without.offersPrototype("small-lamp"), without.offersPrototype("no-such-entity")]).toEqual([false, true, false]);
    expect(without.modules.at(-1)).toMatchObject({ name: MOD, enabled: false, canDisable: true, enables: [], missing: [] });
    const enabled = without.withModule(MOD, true);
    expect(enabled).toEqual(["base", "elevated-rails", "recycler", "space-age", MOD]);
    const again = new CatalogService(data, enabled!);
    expect(again.describe(signal("virtual", MOD_SIGNAL)).status).toBe("known");
    expect([again.entities().offers(MOD_ENTITY), again.offersPrototype(MOD_ENTITY), again.prototypeModulesOff(MOD_ENTITY)]).toEqual([true, true, []]);
    expect(again.modules[0]!.disables).toEqual(["elevated-rails", "recycler", "space-age", MOD]);
    // Switched on alone, the mod brings what it requires; the base module is on in any case.
    expect(new CatalogService(data, []).withModule(MOD, true)).toEqual(["base", MOD]);
    expect(new CatalogService(data, []).enabled).toEqual(["base"]);
    expect(new CatalogService(data, [MOD]).withModulesOn(["space-age", "no-such-module", MOD])).toEqual(["base", "elevated-rails", "recycler", "space-age", MOD]);
    expect(again.withModulesOn([MOD, "base"])).toBeUndefined();
  });

  it("offers what the mod brings in the selector and the picker once the mod is on, and places it", () => {
    const { session } = modded();
    session.commands.setModuleEnabled(MOD, true);
    const registry = session.state.catalog.entities();
    expect(registry.offers(MOD_ENTITY)).toBe(true);
    expect(registry.entry(MOD_ENTITY)).toMatchObject({ kind: "entity", prototype: MOD_ENTITY, label: "Mod crate" });
    expect(registry.groupOf(MOD_ENTITY)).toBe("logistics");
    const picked = session.state.catalog.picker().flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.map((entry) => entry.key)));
    expect(picked).toContain(`virtual:${MOD_SIGNAL}`);

    session.commands.placeEntity(MOD_ENTITY, { x: 40, y: 80 });
    expect(errorsOf(session)).toEqual([]);
    expect(session.state.diagnostics).toEqual([]);
    expect(session.state.circuit.entities).toMatchObject([{ name: "mod_crate1", kind: "entity", prototype: MOD_ENTITY }]);
    expect(session.state.source).toContain(`    ${MOD_ENTITY} mod_crate1 at (40, 80) {\n    }\n`);
  });

  it("writes the record of the game and its mods on save, keeps the module list of the file, and reopens without a notice", async () => {
    const desktop = fakeDesktop();
    const { session, data } = modded(EMPTY_SOURCE, { api: desktop.api, project: project(MODDED_CIRCUIT, { modules: MODDED_MODULES, extras: { later: true } }) });
    expect(session.state.project).toMatchObject({ madeWith: null, modsNotice: null });
    expect(await session.commands.saveAs()).toBe(true);
    const saved = desktop.disk.get("/projects/saved")!;
    expect(saved.manifest).toEqual({ ...MANIFEST, modules: MODDED_MODULES, extras: { later: true }, gameMods: RECORD });
    expect(session.state.project).toMatchObject({ dirty: false, madeWith: `Factorio 2.1.25 with ${MOD} 1.2.3`, modsNotice: null });

    const reopened = new ProjectSession({ api: desktop.api, data, editorExtensions: [], project: { path: "/projects/saved", data: saved } });
    expect(reopened.state).toMatchObject({ error: null, diagnostics: [] });
    expect(reopened.state.project).toMatchObject({ madeWith: `Factorio 2.1.25 with ${MOD} 1.2.3`, modsNotice: null });
  });

  it("replaces the record of a project that was made with another game, after saying what differs", async () => {
    const desktop = fakeDesktop();
    desktop.disk.set("/projects/older.faceproj", project(EMPTY_SOURCE, { gameMods: OTHER_RECORD }).data);
    const { session } = modded(EMPTY_SOURCE, { api: desktop.api });
    await session.commands.loadProject("/projects/older.faceproj");
    const notice = `This project was made with other game data. It was made with Factorio 2.1.20; the data in use is of 2.1.25. The data in use lacks gone-mod 0.2.0. It has ${MOD} 1.2.3 instead of 1.0.0.`;
    expect(session.state.error).toContain(notice);
    expect(session.state.project).toMatchObject({ path: "/projects/older.faceproj", dirty: false, madeWith: `Factorio 2.1.20 with ${MOD} 1.0.0, gone-mod 0.2.0` });
    expect(session.state.project.modsNotice).toBe(session.state.error);

    session.commands.dismissError();
    expect(session.state.project.modsNotice).toContain(notice);
    session.commands.setProjectName("Brought along");
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/older.faceproj")!.manifest.gameMods).toEqual(RECORD);
    expect(session.state.project).toMatchObject({ dirty: false, modsNotice: null, madeWith: `Factorio 2.1.25 with ${MOD} 1.2.3` });
  });
});

describe("with the built-in data", () => {
  it("writes no record, and the modules are the project's to switch", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(EMPTY_SOURCE, { api: desktop.api, data: builtInData() });
    expect(session.state.project.gameData).toBe(false);
    expect(session.state.catalog).toMatchObject({ otherMods: 0, unknownModules: [] });
    expect(session.state.catalog.modules.map((module) => [module.name, module.game, module.enabled])).toEqual(GAME_MODULES.map((name) => [name, true, true]));
    session.commands.setModuleEnabled("space-age", false);
    expect(session.state.catalog.modules.find((module) => module.name === "space-age")).toMatchObject({ enabled: false });
    expect(await session.commands.saveAs()).toBe(true);
    expect(desktop.disk.get("/projects/saved")!.manifest).not.toHaveProperty("gameMods");
    expect(session.state.project).toMatchObject({ madeWith: null, modsNotice: null });
  });

  it("opens a project made with mods all the same, says what the data lacks, and keeps the record through a save", async () => {
    const desktop = fakeDesktop();
    desktop.disk.set("/projects/modded.faceproj", project(MODDED_CIRCUIT, { gameMods: RECORD }).data);
    const { session } = createSession(EMPTY_SOURCE, { api: desktop.api });
    await session.commands.loadProject("/projects/modded.faceproj");
    expect(session.state.error).toContain(`This project was made with other game data. The data in use lacks ${MOD} 1.2.3.`);
    expect(session.state.project).toMatchObject({ path: "/projects/modded.faceproj", dirty: false, madeWith: `Factorio 2.1.25 with ${MOD} 1.2.3` });
    // The source is as it was; the mod's entity is an error in it and the mod's signal a warning.
    expect(session.state.source).toBe(MODDED_CIRCUIT);
    expect(codes(session)).toEqual(["error unknown-prototype", "warning unknown-signal"]);
    expect(session.state.project.modulesOff).toEqual([]);

    session.commands.setProjectName("Still modded");
    session.commands.setWireReach(12);
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/modded.faceproj")!.manifest).toEqual({ ...MANIFEST, name: "Still modded", wireReach: 12, gameMods: RECORD });
    expect(session.state.project.dirty).toBe(false);
  });

  it("says nothing for a project whose game the built-in data covers", async () => {
    const desktop = fakeDesktop();
    const standard: ProjectMods = { gameVersion: "2.1.25", mods: [{ name: "base", version: "2.1.25" }, { name: "space-age", version: "2.1.25" }] };
    desktop.disk.set("/projects/plain.faceproj", project(EMPTY_SOURCE, { gameMods: standard }).data);
    const { session } = createSession(EMPTY_SOURCE, { api: desktop.api });
    await session.commands.loadProject("/projects/plain.faceproj");
    expect(session.state.error).toBeNull();
    expect(session.state.project).toMatchObject({ madeWith: "Factorio 2.1.25", modsNotice: null });
  });
});

describe("loading the window again for other data", () => {
  it("asks the main process at once when nothing is unsaved", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(EMPTY_SOURCE, { api: desktop.api });
    expect(await session.commands.reloadWindow()).toBe(true);
    expect([desktop.reloads, desktop.confirmations]).toEqual([1, 0]);
  });

  it("asks about unsaved changes first: cancel keeps the window, discard and save let it go", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(EMPTY_SOURCE, { api: desktop.api });
    session.commands.setProjectName("Changed");
    desktop.unsavedChoice = "cancel";
    expect(await session.commands.reloadWindow()).toBe(false);
    expect([desktop.reloads, desktop.confirmations]).toEqual([0, 1]);
    desktop.unsavedChoice = "discard";
    expect(await session.commands.reloadWindow()).toBe(true);
    expect([desktop.reloads, desktop.confirmations]).toEqual([1, 2]);
    desktop.unsavedChoice = "save";
    expect(await session.commands.reloadWindow()).toBe(true);
    expect(desktop.disk.get("/projects/saved")!.manifest.name).toBe("Changed");
    expect(desktop.reloads).toBe(2);
  });

  it("is refused without the desktop app, and a refusal of the main process is shown", async () => {
    const { session } = createSession(EMPTY_SOURCE);
    expect(await session.commands.reloadWindow()).toBe(false);
    expect(session.state.error).toBe("Projects can only be opened and saved in the desktop app.");
    const desktop = fakeDesktop();
    const refusing = { ...desktop.api, applyGameData: async () => ({ ok: false as const, error: "The game is being read. Cancel that first." }) };
    const busy = createSession(EMPTY_SOURCE, { api: refusing }).session;
    expect(await busy.commands.reloadWindow()).toBe(false);
    expect(busy.state.error).toBe("The game is being read. Cancel that first.");
  });
});
