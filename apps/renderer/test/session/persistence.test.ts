// Project files through the desktop bridge: new, open, save, save as, dirty tracking and what survives a round trip.
import { describe, expect, it } from "vitest";
import type { ProjectManifest } from "../../../desktop/src/ipc.ts";
import { emptyProject, isDirty, openProjectFile, toProjectData } from "../../src/session/persistence.ts";
import { ProjectSession } from "../../src/session/projectSession.ts";
import { EXAMPLE_SOURCE } from "../fixtures/example.ts";
import { createSession, EMPTY_SOURCE, errorsOf, exampleProject, fakeDesktop, idOf, IRREGULAR, ManualScheduler, MANIFEST, project, type } from "./helpers.ts";

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

  it("a new project is the empty one the desktop shell creates, unsaved and clean", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(IRREGULAR, { api: desktop.api });
    session.commands.select([idOf(session, "gate")]);
    await session.commands.newProject();
    expect(session.state.source).toBe(EMPTY_SOURCE);
    expect(session.state.project).toMatchObject({ name: "Untitled circuit", path: null, fileName: "main.face", dirty: false });
    expect(session.state.circuit).toMatchObject({ name: "Untitled circuit", entities: [], wires: [] });
    expect(session.state).toMatchObject({ editable: true, diagnostics: [], selection: [], canUndo: false, canRedo: false, error: null });
    expect(session.state.simulation).toMatchObject({ tick: 0, running: false, available: true });
    expect(desktop.confirmations).toBe(0);
  });

  it("an empty project takes its first entities, simulates and is saved to a place the user chooses", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(IRREGULAR, { api: desktop.api });
    await session.commands.newProject();
    // Nothing to act on is not an error.
    session.commands.select(["e1"]);
    session.commands.deleteSelection();
    session.commands.duplicateSelection();
    session.commands.snapToTiles();
    session.commands.step();
    expect(session.state).toMatchObject({ source: EMPTY_SOURCE, selection: [], canUndo: false, error: null });
    expect(session.state.simulation.tick).toBe(1);

    session.commands.placeEntity("constant", { x: 40, y: 80 });
    expect(session.state.circuit.entities.map((entity) => entity.kind)).toEqual(["constant"]);
    expect(session.state.selection).toEqual([session.state.circuit.entities[0]!.id]);
    session.commands.setDisplayMode("blueprint");
    session.commands.placeEntityOnTile("lamp", { x: 4.5, y: 0.5 });
    const [constant, lamp] = session.state.circuit.entities;
    session.commands.addWire({ color: "red", a: { entity: constant!.id, side: "out" }, b: { entity: lamp!.id, side: "in" } });
    expect(session.state).toMatchObject({ editable: true, error: null });
    expect(errorsOf(session)).toEqual([]);
    expect(session.state.circuit.wires).toHaveLength(1);
    expect(session.state.source.startsWith('circuit "Untitled circuit" {\n')).toBe(true);
    expect(session.state.project).toMatchObject({ path: null, dirty: true });

    desktop.savePath = "/projects/first";
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/first")!.files).toEqual([{ name: "main.face", source: session.state.source }]);
    expect(session.state.project).toMatchObject({ name: "Untitled circuit", path: "/projects/first", dirty: false });
    // Three undo steps lead back to the empty circuit.
    for (let i = 0; i < 3; i++) session.commands.undo();
    expect(session.state).toMatchObject({ source: EMPTY_SOURCE, canUndo: false });
    expect(session.state.circuit.entities).toEqual([]);
  });

  it("an example opens as an unsaved copy: no path, no unsaved change, and Save asks for a location", async () => {
    const desktop = fakeDesktop();
    desktop.examples.set("Feedback example.faceproj", exampleProject().data);
    const { session } = createSession(IRREGULAR, { api: desktop.api });
    await session.commands.openExample("Feedback example.faceproj");
    expect(session.state.source).toBe(EXAMPLE_SOURCE);
    expect(session.state.project).toMatchObject({ name: "Feedback example", path: null, dirty: false });
    expect(session.state.circuit.entities.map((entity) => entity.name)).toEqual(["source", "gate", "twice", "light"]);
    expect(session.state).toMatchObject({ editable: true, canUndo: false, error: null });
    expect(desktop.confirmations).toBe(0);

    // A save without a path: the request leaves the location to the desktop shell, which asks the user.
    const requests: (string | null)[] = [];
    const saveProject = desktop.api.saveProject;
    const api = { ...desktop.api, saveProject: (request: Parameters<typeof saveProject>[0]) => (requests.push(request.path), saveProject(request)) };
    const copy = createSession(IRREGULAR, { api }).session;
    await copy.commands.openExample("Feedback example.faceproj");
    desktop.savePath = null;
    expect(await copy.commands.save()).toBe(false);
    expect(copy.state.project.path).toBeNull();
    desktop.savePath = "/projects/my-copy";
    expect(await copy.commands.save()).toBe(true);
    expect(requests).toEqual([null, null]);
    expect(copy.state.project).toMatchObject({ path: "/projects/my-copy", dirty: false });
    expect([...desktop.disk.keys()]).toEqual(["/projects/my-copy"]);

    // An example the application does not have is reported, and the open project stays.
    await copy.commands.openExample("../other.faceproj");
    expect(copy.state.error).toBe("Not an example of this application: ../other.faceproj");
    expect(copy.state.project.path).toBe("/projects/my-copy");
  });

  it("asks before an example replaces a project with unsaved changes", async () => {
    const desktop = fakeDesktop();
    desktop.examples.set("Feedback example.faceproj", exampleProject().data);
    const { session } = createSession(IRREGULAR, { api: desktop.api });
    type(session, 0, "// mine\n");
    desktop.unsavedChoice = "cancel";
    await session.commands.openExample("Feedback example.faceproj");
    expect(desktop.confirmations).toBe(1);
    expect(session.state.source).toBe("// mine\n" + IRREGULAR);
    desktop.unsavedChoice = "discard";
    await session.commands.openExample("Feedback example.faceproj");
    expect(session.state.source).toBe(EXAMPLE_SOURCE);
  });

  it("asks before replacing a project with unsaved changes: cancel keeps it, save writes it first, discard drops it", async () => {
    const desktop = fakeDesktop();
    desktop.disk.set("/projects/other", project(IRREGULAR, { name: "Other" }).data);
    const { session } = createSession(undefined, { api: desktop.api });
    type(session, 0, "// mine\n");

    desktop.unsavedChoice = "cancel";
    await session.commands.loadProject("/projects/other");
    expect(desktop.confirmations).toBe(1);
    expect(session.state.source).toBe("// mine\n" + EXAMPLE_SOURCE);

    // Save is chosen but the location dialog is cancelled: nothing is replaced.
    desktop.unsavedChoice = "save";
    desktop.savePath = null;
    await session.commands.loadProject("/projects/other");
    expect(session.state.source).toBe("// mine\n" + EXAMPLE_SOURCE);

    desktop.savePath = "/projects/mine";
    await session.commands.loadProject("/projects/other");
    expect(desktop.disk.get("/projects/mine")!.files[0]!.source).toBe("// mine\n" + EXAMPLE_SOURCE);
    expect(session.state.project).toMatchObject({ name: "Other", path: "/projects/other", dirty: false });

    type(session, 0, "// dropped\n");
    desktop.unsavedChoice = "discard";
    await session.commands.newProject();
    expect(session.state.source).toBe(EMPTY_SOURCE);
    expect(desktop.disk.get("/projects/other")!.files[0]!.source).toBe(IRREGULAR);
  });

  it("reports failures and keeps the open project", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(IRREGULAR, { api: desktop.api });
    await session.commands.loadProject("/projects/missing");
    expect(session.state.error).toContain("Not a face project");
    expect(session.state.source).toBe(IRREGULAR);
    // It says nothing about the circuit, so an edit and a selection do not take it away.
    session.commands.select([idOf(session, "gate")]);
    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 320, y: 80 } }]);
    session.commands.undo();
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

  it("starts from the empty project the desktop shell creates for a new one", async () => {
    expect(emptyProject()).toEqual((await fakeDesktop().api.newProject() as { value: unknown }).value);
    expect(emptyProject()).toEqual({ path: null, data: { manifest: { ...MANIFEST, name: "Untitled circuit" }, files: [{ name: "main.face", source: EMPTY_SOURCE }] } });
  });
});

describe("the start of the app", () => {
  /** A session as the app creates it: no project is handed in. */
  const startSession = (desktop = fakeDesktop()) => ({ desktop, session: new ProjectSession({ api: desktop.api, scheduler: new ManualScheduler(), editorExtensions: [] }) });
  const EMPTY = { name: "Untitled circuit", path: null, dirty: false };

  it("shows an empty, unsaved project at once", () => {
    const { session, desktop } = startSession();
    expect(session.state.source).toBe(EMPTY_SOURCE);
    expect(session.state.project).toMatchObject({ ...EMPTY, epoch: 0 });
    expect(session.state.circuit.entities).toEqual([]);
    expect(session.state).toMatchObject({ editable: true, diagnostics: [], canUndo: false, error: null });
    expect(desktop.confirmations).toBe(0);
  });

  it("stays on the empty project when no project was open before", async () => {
    const { session } = startSession();
    let notified = 0;
    session.subscribe(() => notified++);
    await session.start();
    expect(session.state.project).toMatchObject({ ...EMPTY, epoch: 0 });
    expect(session.state).toMatchObject({ source: EMPTY_SOURCE, error: null });
    expect(notified).toBe(0);
  });

  it("opens the project that was open last in place of the empty one, without a prompt and without an unsaved change", async () => {
    const { session, desktop } = startSession();
    desktop.disk.set("/projects/last", project(IRREGULAR, { name: "Last" }).data);
    desktop.lastProject = "/projects/last";
    const starting = session.start();
    // The window does not wait for it.
    expect(session.state.project).toMatchObject(EMPTY);
    await starting;
    expect(session.state.project).toMatchObject({ name: "Last", path: "/projects/last", dirty: false });
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, error: null });
    expect(desktop.confirmations).toBe(0);
    // Once per session: a second call opens nothing again.
    desktop.disk.set("/projects/last", project(EXAMPLE_SOURCE, { name: "Changed on disk" }).data);
    await session.start();
    expect(session.state.project.name).toBe("Last");
  });

  it("stays on the empty project and says why when the last project cannot be read", async () => {
    const { session, desktop } = startSession();
    desktop.lastProject = "/projects/gone";
    await session.start();
    expect(session.state.project).toMatchObject(EMPTY);
    expect(session.state.source).toBe(EMPTY_SOURCE);
    expect(session.state.error).toBe("The last project could not be reopened. Not a face project (no face.json): /projects/gone");
    // The message stays until it is dismissed, like that of a project that fails to open by hand.
    session.commands.placeEntity("lamp", { x: 40, y: 80 });
    expect(session.state.error).toContain("could not be reopened");
    session.commands.dismissError();
    expect(session.state.error).toBeNull();
  });

  it("reports a call that fails outright and leaves the project commands usable", async () => {
    const desktop = fakeDesktop();
    const { session } = startSession({ ...desktop, api: { ...desktop.api, openLastProject: () => Promise.reject(new Error("no answer")) } });
    await session.start();
    expect(session.state.error).toBe("The last project could not be reopened. no answer");
    await session.commands.newProject();
    expect(session.state).toMatchObject({ source: EMPTY_SOURCE, error: null });
  });

  it("keeps what the user did to the empty project while the last one was being read", async () => {
    const { session, desktop } = startSession();
    desktop.disk.set("/projects/last", project(IRREGULAR, { name: "Last" }).data);
    desktop.lastProject = "/projects/last";
    const starting = session.start();
    session.commands.placeEntity("lamp", { x: 40, y: 80 });
    await starting;
    expect(session.state.project).toMatchObject({ name: "Untitled circuit", path: null, dirty: true });
    expect(session.state.circuit.entities).toHaveLength(1);
    expect(desktop.confirmations).toBe(0);
  });

  it("a project chosen while the last one is being read is opened after it, and stays", async () => {
    const { session, desktop } = startSession();
    desktop.disk.set("/projects/last", project(IRREGULAR, { name: "Last" }).data);
    desktop.examples.set("Feedback example.faceproj", exampleProject().data);
    desktop.lastProject = "/projects/last";
    const starting = session.start();
    const opening = session.commands.openExample("Feedback example.faceproj");
    await Promise.all([starting, opening]);
    expect(session.state.project).toMatchObject({ name: "Feedback example", path: null, dirty: false });
    expect(session.state.project.epoch).toBe(2);
  });
});
