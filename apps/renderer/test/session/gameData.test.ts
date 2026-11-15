// A session on data read from the user's game: the game's modules are all on and cannot be switched, what a mod brings can be
// placed and picked, a save records the game's mods in the project file, and a project made with other mods says so when it
// is opened. With the built-in data the record of a project is kept as it is.
import { signal } from "@face/model";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectMods } from "../../../desktop/src/ipc.ts";
import { applyData, builtInData, type DataInUse } from "../../src/gameData/dataInUse.ts";
import { ProjectSession } from "../../src/session/projectSession.ts";
import { MOD, MOD_ENTITY, MOD_SIGNAL, MODDED_MODS, moddedData } from "../fixtures/moddedData.ts";
import { createSession, EMPTY_SOURCE, errorsOf, fakeDesktop, MANIFEST, project, type TestSession } from "./helpers.ts";

const RECORD: ProjectMods = { gameVersion: "2.1.24", mods: MODDED_MODS };
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

afterEach(() => applyData({ source: { kind: "built-in", version: "2.1.24" }, problem: null, mods: [], catalog: null, entities: null, icons: [] }));

/** A session on the modded data, which is applied as a window does at start. */
function modded(source = EMPTY_SOURCE, options: ConstructorParameters<typeof ProjectSession>[0] = {}): TestSession & { readonly data: DataInUse } {
  const data = applyData(moddedData());
  return { ...createSession(source, { data, ...options }), data };
}

describe("with data read from the game", () => {
  it("has every module of the game on, as in the game, whatever the project file lists", () => {
    const { session } = modded(EMPTY_SOURCE, { project: project(MODDED_CIRCUIT, { modules: ["base", "no-such-module"] }) });
    const { catalog } = session.state;
    expect(catalog.modulesFixed).toBe(true);
    expect(catalog.modules.map((module) => [module.name, module.enabled, module.canDisable])).toEqual([["base", true, false], ["elevated-rails", true, false], ["recycler", true, false], ["quality", true, false], ["space-age", true, false], [MOD, true, false]]);
    expect(catalog.unknownModules).toEqual([]);
    // A Space Age signal and the mod's are known although the project lists neither module, and the mod's entity is one.
    expect(session.state.diagnostics).toEqual([]);
    expect(catalog.describe(signal("virtual", MOD_SIGNAL))).toMatchObject({ status: "known", displayName: "Mod signal" });
    expect(catalog.describe(signal("item", "carbon-fiber")).status).toBe("known");
    expect(session.state.circuit.entities.map((entity) => entity.name)).toEqual(["crate", "source"]);

    // The switches do nothing, and the project is not changed by trying.
    session.commands.setModuleEnabled("space-age", false);
    session.commands.setModuleEnabled(MOD, false);
    expect(session.state.catalog).toBe(catalog);
    expect(session.state.project.dirty).toBe(false);
  });

  it("offers what the mod brings in the selector and the picker, and places it", () => {
    const { session } = modded();
    const registry = session.state.catalog.entities();
    expect(registry.offers(MOD_ENTITY)).toBe(true);
    expect(registry.entry(MOD_ENTITY)).toMatchObject({ kind: "entity", prototype: MOD_ENTITY, label: "Mod crate" });
    expect(registry.groupOf(MOD_ENTITY)).toBe("logistics");
    const picked = session.state.catalog.picker().flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.map((entry) => entry.key)));
    expect(picked).toContain(`virtual:${MOD_SIGNAL}`);

    session.commands.placeEntity(MOD_ENTITY, { x: 40, y: 80 });
    expect(errorsOf(session)).toEqual([]);
    expect(session.state.circuit.entities).toMatchObject([{ name: "mod_crate1", kind: "entity", prototype: MOD_ENTITY }]);
    expect(session.state.source).toContain(`    ${MOD_ENTITY} mod_crate1 at (40, 80) {\n    }\n`);
  });

  it("writes the record of the game and its mods on save, keeps the module list of the file, and reopens without a notice", async () => {
    const desktop = fakeDesktop();
    const { session, data } = modded(EMPTY_SOURCE, { api: desktop.api, project: project(MODDED_CIRCUIT, { modules: ["base", "space-age"], extras: { later: true } }) });
    expect(session.state.project).toMatchObject({ madeWith: null, modsNotice: null });
    expect(await session.commands.saveAs()).toBe(true);
    const saved = desktop.disk.get("/projects/saved")!;
    expect(saved.manifest).toEqual({ ...MANIFEST, modules: ["base", "space-age"], extras: { later: true }, gameMods: RECORD });
    expect(session.state.project).toMatchObject({ dirty: false, madeWith: `Factorio 2.1.24 with ${MOD} 1.2.3`, modsNotice: null });

    const reopened = new ProjectSession({ api: desktop.api, data, editorExtensions: [], project: { path: "/projects/saved", data: saved } });
    expect(reopened.state).toMatchObject({ error: null, diagnostics: [] });
    expect(reopened.state.project).toMatchObject({ madeWith: `Factorio 2.1.24 with ${MOD} 1.2.3`, modsNotice: null });
  });

  it("replaces the record of a project that was made with another game, after saying what differs", async () => {
    const desktop = fakeDesktop();
    desktop.disk.set("/projects/older.faceproj", project(EMPTY_SOURCE, { gameMods: OTHER_RECORD }).data);
    const { session } = modded(EMPTY_SOURCE, { api: desktop.api });
    await session.commands.loadProject("/projects/older.faceproj");
    const notice = `This project was made with other game data. It was made with Factorio 2.1.20; the data in use is of 2.1.24. The data in use lacks gone-mod 0.2.0. It has ${MOD} 1.2.3 instead of 1.0.0.`;
    expect(session.state.error).toContain(notice);
    expect(session.state.project).toMatchObject({ path: "/projects/older.faceproj", dirty: false, madeWith: `Factorio 2.1.20 with ${MOD} 1.0.0, gone-mod 0.2.0` });
    expect(session.state.project.modsNotice).toBe(session.state.error);

    session.commands.dismissError();
    expect(session.state.project.modsNotice).toContain(notice);
    session.commands.setProjectName("Brought along");
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/older.faceproj")!.manifest.gameMods).toEqual(RECORD);
    expect(session.state.project).toMatchObject({ dirty: false, modsNotice: null, madeWith: `Factorio 2.1.24 with ${MOD} 1.2.3` });
  });
});

describe("with the built-in data", () => {
  it("writes no record, and the modules are the project's to switch", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(EMPTY_SOURCE, { api: desktop.api, data: builtInData() });
    expect(session.state.catalog.modulesFixed).toBe(false);
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
    expect(session.state.project).toMatchObject({ path: "/projects/modded.faceproj", dirty: false, madeWith: `Factorio 2.1.24 with ${MOD} 1.2.3` });
    // The source is as it was; the mod's entity is an error in it and the mod's signal a warning.
    expect(session.state.source).toBe(MODDED_CIRCUIT);
    expect(session.state.diagnostics.map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}`)).toEqual(["error unknown-prototype", "warning unknown-signal"]);

    session.commands.setProjectName("Still modded");
    session.commands.setWireReach(12);
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/modded.faceproj")!.manifest).toEqual({ ...MANIFEST, name: "Still modded", wireReach: 12, gameMods: RECORD });
    expect(session.state.project.dirty).toBe(false);
  });

  it("says nothing for a project whose game the built-in data covers", async () => {
    const desktop = fakeDesktop();
    const standard: ProjectMods = { gameVersion: "2.1.24", mods: [{ name: "base", version: "2.1.24" }, { name: "space-age", version: "2.1.24" }] };
    desktop.disk.set("/projects/plain.faceproj", project(EMPTY_SOURCE, { gameMods: standard }).data);
    const { session } = createSession(EMPTY_SOURCE, { api: desktop.api });
    await session.commands.loadProject("/projects/plain.faceproj");
    expect(session.state.error).toBeNull();
    expect(session.state.project).toMatchObject({ madeWith: "Factorio 2.1.24", modsNotice: null });
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
