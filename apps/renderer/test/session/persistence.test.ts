// Project files through the desktop bridge: new, open, save, save as, dirty tracking and what survives a round trip.
import { describe, expect, it } from "vitest";
import type { ProjectManifest } from "../../../desktop/src/ipc.ts";
import { isDirty, openProjectFile, starterProject, toProjectData } from "../../src/session/persistence.ts";
import { STARTER_SOURCE } from "../../src/session/starter.ts";
import { createSession, fakeDesktop, idOf, IRREGULAR, MANIFEST, project, type } from "./helpers.ts";

describe("dirty tracking", () => {
  it("compares the document and the settings with what was saved", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(undefined, { api: desktop.api });
    expect(session.state.project).toMatchObject({ name: "Feedback example", path: null, fileName: "main.face", dirty: false });

    // An edit makes it dirty, undoing it makes it clean again: the text is compared, not a counter.
    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 320, y: 80 } }]);
    expect(session.state.project.dirty).toBe(true);
    session.commands.undo();
    expect(session.state.project.dirty).toBe(false);
    type(session, 0, "x");
    expect(session.state.project.dirty).toBe(true);
    session.commands.undo();

    // Settings count as well, in either direction.
    session.commands.setModuleEnabled("space-age", false);
    expect(session.state.project.dirty).toBe(true);
    session.commands.setModuleEnabled("space-age", true);
    expect(session.state.project.dirty).toBe(false);
    session.commands.setProjectName("  Counter  ");
    expect(session.state.project).toMatchObject({ name: "Counter", dirty: true });
    session.commands.setProjectName("");
    expect(session.state.project.name).toBe("Counter");

    // Selection, modes and the simulation never do.
    session.commands.setProjectName("Feedback example");
    session.commands.select([idOf(session, "gate")]);
    session.commands.setMode("split");
    session.commands.step();
    expect(session.state.project.dirty).toBe(false);

    session.commands.setProjectName("Counter");
    expect(await session.commands.save()).toBe(true);
    expect(session.state.project).toMatchObject({ name: "Counter", path: "/projects/saved", dirty: false });
    expect(session.state.canUndo).toBe(false);
    type(session, 0, "// more\n");
    expect(session.state.project.dirty).toBe(true);
    session.commands.undo();
    expect(session.state.project.dirty).toBe(false);
  });

  it("an edit made while a save is in flight stays unsaved", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(IRREGULAR, { api: desktop.api });
    type(session, 0, "// one\n");
    const saving = session.commands.save();
    type(session, 0, "// two\n");
    expect(await saving).toBe(true);
    expect(desktop.disk.get("/projects/saved")!.files[0]!.source).toBe("// one\n" + IRREGULAR);
    expect(session.state.project).toMatchObject({ path: "/projects/saved", dirty: true });
  });
});

describe("project lifecycle", () => {
  it("saves source, name and modules, and keeps everything else of the manifest", async () => {
    const desktop = fakeDesktop();
    const manifest: ProjectManifest = {
      ...MANIFEST,
      name: "Loaded",
      modules: ["base", "my-mod", "quality", "recycler"],
      customSignalGroups: [{ id: "g1", name: "Mine", enabled: true, signals: [{ name: "alpha", icon: "alpha.png" }] }],
      circuits: ["main.face", "second.face"],
      extras: { editor: { theme: "dusk" }, revision: 7 },
    };
    desktop.disk.set("/projects/loaded", { manifest, files: [{ name: "main.face", source: IRREGULAR }, { name: "second.face", source: 'circuit "Second" {\n}\n' }] });
    const { session } = createSession(undefined, { api: desktop.api });
    await session.commands.loadProject("/projects/loaded");
    expect(session.state.project).toMatchObject({ name: "Loaded", path: "/projects/loaded", dirty: false });
    expect(session.state.circuit.name).toBe("Irregular");
    expect(session.state.catalog.unknownModules).toEqual(["my-mod"]);
    expect(session.state.catalog.modules.filter((module) => module.enabled).map((module) => module.name)).toEqual(["base", "recycler", "quality"]);

    // Saving without a settings change writes the module list exactly as it was.
    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 320, y: 80 } }]);
    expect(await session.commands.save()).toBe(true);
    let saved = desktop.disk.get("/projects/loaded")!;
    expect(saved.manifest).toEqual(manifest);
    expect(saved.files).toEqual([{ name: "main.face", source: IRREGULAR.replace("gate at (300, 80)", "gate at (320, 80)") }, { name: "second.face", source: 'circuit "Second" {\n}\n' }]);

    // A module change is written; the unknown module, the custom groups and the unknown fields stay.
    session.commands.setModuleEnabled("quality", false);
    session.commands.setProjectName("Renamed");
    expect(await session.commands.save()).toBe(true);
    saved = desktop.disk.get("/projects/loaded")!;
    expect(saved.manifest).toEqual({ ...manifest, name: "Renamed", modules: ["base", "recycler", "my-mod"] });
    expect(session.state.project.dirty).toBe(false);
  });

  it("reopens what it saved: source, layout and module settings", async () => {
    const desktop = fakeDesktop();
    const first = createSession(undefined, { api: desktop.api }).session;
    first.commands.moveEntities([{ id: idOf(first, "light"), position: { x: 700, y: 300 } }]);
    first.commands.setModuleEnabled("space-age", false);
    desktop.savePath = "/projects/roundtrip";
    expect(await first.commands.saveAs()).toBe(true);
    const text = first.state.source;

    const second = createSession(IRREGULAR, { api: desktop.api }).session;
    await second.commands.loadProject("/projects/roundtrip");
    expect(second.state.source).toBe(text);
    expect(second.state.circuit.entities.find((entity) => entity.name === "light")!.position).toEqual({ x: 700, y: 300 });
    expect(second.state.catalog.modules.find((module) => module.name === "space-age")!.enabled).toBe(false);
    expect(second.state).toMatchObject({ editable: true, canUndo: false, selection: [] });
    expect(second.state.project).toMatchObject({ name: "Feedback example", path: "/projects/roundtrip", dirty: false });
  });

  it("a loaded project replaces document, history, selection and simulation state", async () => {
    const desktop = fakeDesktop();
    desktop.disk.set("/projects/other", project(IRREGULAR, { name: "Other" }).data);
    const { session } = createSession(undefined, { api: desktop.api });
    session.commands.select([idOf(session, "gate")]);
    session.commands.step();
    session.commands.run();
    const epoch = session.state.project.epoch;
    await session.commands.loadProject("/projects/other");
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, canRedo: false, selection: [], editable: true, draft: null });
    expect(session.state.simulation).toMatchObject({ tick: 0, running: false, available: true });
    expect(session.state.project.epoch).toBe(epoch + 1);
    expect(session.state.circuit.entities.map((entity) => entity.name)).toEqual(["src", "gate", "light"]);
  });

  it("a new project starts with the example circuit, unsaved and clean", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(IRREGULAR, { api: desktop.api });
    await session.commands.newProject();
    expect(session.state.source).toBe(STARTER_SOURCE);
    expect(session.state.project).toMatchObject({ name: "Feedback example", path: null, dirty: false });
    expect(session.state.circuit.entities).toHaveLength(4);
    expect(desktop.confirmations).toBe(0);
  });

  it("asks before replacing a project with unsaved changes: cancel keeps it, save writes it first, discard drops it", async () => {
    const desktop = fakeDesktop();
    desktop.disk.set("/projects/other", project(IRREGULAR, { name: "Other" }).data);
    const { session } = createSession(undefined, { api: desktop.api });
    type(session, 0, "// mine\n");

    desktop.unsavedChoice = "cancel";
    await session.commands.loadProject("/projects/other");
    expect(desktop.confirmations).toBe(1);
    expect(session.state.source).toBe("// mine\n" + STARTER_SOURCE);

    // Save is chosen but the location dialog is cancelled: nothing is replaced.
    desktop.unsavedChoice = "save";
    desktop.savePath = null;
    await session.commands.loadProject("/projects/other");
    expect(session.state.source).toBe("// mine\n" + STARTER_SOURCE);

    desktop.savePath = "/projects/mine";
    await session.commands.loadProject("/projects/other");
    expect(desktop.disk.get("/projects/mine")!.files[0]!.source).toBe("// mine\n" + STARTER_SOURCE);
    expect(session.state.project).toMatchObject({ name: "Other", path: "/projects/other", dirty: false });

    type(session, 0, "// dropped\n");
    desktop.unsavedChoice = "discard";
    await session.commands.newProject();
    expect(session.state.source).toBe(STARTER_SOURCE);
    expect(desktop.disk.get("/projects/other")!.files[0]!.source).toBe(IRREGULAR);
  });

  it("reports failures and keeps the open project", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(IRREGULAR, { api: desktop.api });
    await session.commands.loadProject("/projects/missing");
    expect(session.state.error).toContain("Not a face project");
    expect(session.state.source).toBe(IRREGULAR);
    session.commands.dismissError();

    // A cancelled location dialog is not an error.
    desktop.savePath = null;
    expect(await session.commands.save()).toBe(false);
    expect(session.state).toMatchObject({ error: null });
    expect(session.state.project.path).toBeNull();

    // Without the desktop bridge nothing can be opened or saved.
    const browser = createSession(IRREGULAR).session;
    expect(await browser.commands.save()).toBe(false);
    expect(browser.state.error).toMatch(/desktop app/);
  });
});

describe("project file mapping", () => {
  it("treats module lists as sets and keeps the stored order when nothing changed", () => {
    const { file, source, settings } = openProjectFile(project(IRREGULAR, { modules: ["quality", "base", "recycler"] }, "/p"));
    expect(isDirty(file, source, { ...settings, modules: ["base", "recycler", "quality"] })).toBe(false);
    expect(toProjectData(file, source, { ...settings, modules: ["base", "recycler", "quality"] }).manifest.modules).toEqual(["quality", "base", "recycler"]);
    expect(isDirty(file, source, { ...settings, modules: ["base"] })).toBe(true);
    expect(isDirty(file, source + " ", settings)).toBe(true);
  });

  it("builds the starter project on the manifest the desktop shell hands out", () => {
    const starter = starterProject({ ...MANIFEST, name: "Untitled circuit", gameVersion: "2.1.99", modules: ["base"] });
    expect(starter).toEqual({ path: null, data: { manifest: { ...MANIFEST, name: "Feedback example", gameVersion: "2.1.99", modules: ["base"], circuits: ["main.face"] }, files: [{ name: "main.face", source: STARTER_SOURCE }] } });
    expect(starterProject().data.manifest.modules).toEqual(["base", "space-age", "quality", "recycler", "elevated-rails"]);
  });
});
