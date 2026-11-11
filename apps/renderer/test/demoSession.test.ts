import { wireKey, type Wire } from "@face/model";
import { describe, expect, it, vi } from "vitest";
import type { FaceApi, IpcResult, LoadedProject, SaveProjectRequest, UnsavedChoice } from "../../desktop/src/ipc.ts";
import { createDemoSession, createDemoState, isDirty, reduceDemo, toProjectData, toWorkbenchState, type DemoAction, type DemoState } from "../src/workbench/demoSession.ts";
import { printDemoSource } from "../src/workbench/demoSource.ts";

function run(state: DemoState, ...actions: DemoAction[]): DemoState {
  return actions.reduce(reduceDemo, state);
}

const ok = <T>(value: T): Promise<IpcResult<T>> => Promise.resolve({ ok: true, value });

function fakeApi(overrides: Partial<FaceApi> = {}): FaceApi {
  return {
    platform: "test",
    catalogAssetUrl: "face-asset://catalog/",
    newProject: () => ok<LoadedProject>({ path: null, data: { manifest: { formatVersion: 1, name: "Untitled circuit", gameVersion: "2.1.24", modules: ["base"], customSignalGroups: [], circuits: ["main.face"] }, files: [{ name: "main.face", source: "" }] } }),
    openProject: () => ok(null),
    loadProject: () => Promise.resolve({ ok: false, error: "not found" }),
    saveProject: (request: SaveProjectRequest) => ok(request.path === null ? null : { path: request.path }),
    saveProjectAs: () => ok({ path: "/projects/demo" }),
    getRecentProjects: () => ok([]),
    clearRecentProjects: () => ok(null),
    confirmUnsavedChanges: () => ok<UnsavedChoice>("cancel"),
    setDirty: () => undefined,
    onMenuCommand: () => () => undefined,
    onSaveBeforeClose: () => () => undefined,
    ...overrides,
  };
}

describe("demo circuit", () => {
  const state = createDemoState();

  it("contains all five kinds, a feedback pair in both colors and one two-color pair", () => {
    expect(state.circuit.entities.map((entity) => entity.kind).sort()).toEqual(["arithmetic", "constant", "decider", "lamp", "selector"]);
    const keys = state.circuit.wires.map(wireKey);
    expect(keys).toContain("red|e2.in|e2.out");
    expect(keys).toContain("green|e2.in|e2.out");
    expect(keys).toContain("red|e1.out|e2.in");
    expect(keys).toContain("green|e1.out|e2.in");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("starts clean and prints its source", () => {
    expect(isDirty(state)).toBe(false);
    expect(state.source).toContain('circuit "Feedback example" {');
    expect(state.source).toContain("    decider gate at (300, 80) {\n        when virtual:signal-A < 10\n        output virtual:signal-A = input\n    }");
    expect(state.source).toContain("virtual:signal-B = virtual:signal-A[red] * 2");
    expect(state.source).toContain("operation = select");
    expect(state.source).toContain("    wire green gate.out <-> gate.in\n");
    expect(state.source.endsWith("}\n")).toBe(true);
  });
});

describe("demo edits", () => {
  const initial = createDemoState();

  it("places an entity with a unique name, selects it and returns to the select tool", () => {
    const next = run(initial, { type: "setTool", tool: { type: "place", kind: "lamp" } }, { type: "placeEntity", kind: "lamp", position: { x: 100.4, y: 400 } });
    const placed = next.circuit.entities.at(-1)!;
    expect(placed).toMatchObject({ kind: "lamp", name: "lamp1", position: { x: 100, y: 400 } });
    expect(next.selection).toEqual([placed.id]);
    expect(next.tool).toEqual({ type: "select" });
    expect(isDirty(next)).toBe(true);
    const again = run(next, { type: "placeEntity", kind: "lamp", position: { x: 0, y: 0 } });
    expect(again.circuit.entities.at(-1)!.name).toBe("lamp2");
    expect(new Set(again.circuit.entities.map((entity) => entity.id)).size).toBe(7);
  });

  it("moves entities and keeps the identity of untouched ones", () => {
    const next = run(initial, { type: "moveEntities", moves: [{ id: "e1", position: { x: 100, y: 180 } }] });
    expect(next.circuit.entities[0]!.position).toEqual({ x: 100, y: 180 });
    expect(next.circuit.entities[1]).toBe(initial.circuit.entities[1]);
    expect(next.source).toContain("constant source at (100, 180)");
    expect(run(next, { type: "moveEntities", moves: [{ id: "e1", position: { x: 100, y: 180 } }] })).toBe(next);
  });

  it("adds wires once, in either direction", () => {
    const wire: Wire = { color: "red", a: { entity: "e5", side: "in" }, b: { entity: "e4", side: "out" } };
    const next = run(initial, { type: "addWire", wire });
    expect(next.circuit.wires.map(wireKey)).toContain("red|e4.out|e5.in");
    expect(next.past).toHaveLength(1);
    const reversed = run(next, { type: "addWire", wire: { color: "red", a: wire.b, b: wire.a } });
    expect(reversed).toBe(next);
  });

  it("rejects wires to missing terminals or from a terminal to itself", () => {
    const toConstantInput = run(initial, { type: "addWire", wire: { color: "red", a: { entity: "e1", side: "in" }, b: { entity: "e2", side: "in" } } });
    expect(toConstantInput.circuit).toBe(initial.circuit);
    expect(toConstantInput.error).toContain("no input terminal");
    const self = run(initial, { type: "addWire", wire: { color: "red", a: { entity: "e2", side: "in" }, b: { entity: "e2", side: "in" } } });
    expect(self.circuit).toBe(initial.circuit);
    expect(self.error).not.toBeNull();
    expect(run(self, { type: "dismissError" }).error).toBeNull();
  });

  it("removes a wire given in either direction", () => {
    const next = run(initial, { type: "removeWire", wire: { color: "green", a: { entity: "e2", side: "out" }, b: { entity: "e2", side: "in" } } });
    expect(next.circuit.wires).toHaveLength(initial.circuit.wires.length - 1);
    expect(next.circuit.wires.map(wireKey)).not.toContain("green|e2.in|e2.out");
  });

  it("deletes entities together with their wires and drops them from the selection", () => {
    const next = run(initial, { type: "select", ids: ["e2", "e5"] }, { type: "deleteEntities", ids: ["e2"] });
    expect(next.circuit.entities.map((entity) => entity.name)).toEqual(["source", "twice", "pick", "light"]);
    expect(next.circuit.wires.map(wireKey)).toEqual(["green|e3.out|e5.in", "red|e3.out|e4.in"]);
    expect(next.selection).toEqual(["e5"]);
    expect(next.past).toHaveLength(1);
  });

  it("renames with validation and rewrites wire references in the source", () => {
    const next = run(initial, { type: "renameEntity", id: "e2", name: "limiter" });
    expect(next.source).toContain("wire red source.out <-> limiter.in");
    expect(run(initial, { type: "renameEntity", id: "e2", name: "source" }).error).toContain("already used");
    expect(run(initial, { type: "renameEntity", id: "e2", name: "9lives" }).error).toContain("not a valid");
    expect(run(initial, { type: "renameEntity", id: "e2", name: "gate" })).toBe(initial);
  });

  it("updates configuration but not name or position", () => {
    const lamp = initial.circuit.entities.find((entity) => entity.id === "e5")!;
    const next = run(initial, { type: "updateEntity", entity: { ...lamp, alwaysOn: true, name: "hijacked", position: { x: 1, y: 1 } } as typeof lamp });
    expect(next.circuit.entities.find((entity) => entity.id === "e5")).toMatchObject({ alwaysOn: true, name: "light", position: { x: 560, y: 80 } });
    expect(next.source).toContain("always-on = true");
  });

  it("undoes and redoes whole steps and returns to a clean state", () => {
    const edited = run(initial, { type: "deleteEntities", ids: ["e2"] }, { type: "moveEntities", moves: [{ id: "e1", position: { x: 0, y: 0 } }] });
    const undone = run(edited, { type: "undo" }, { type: "undo" });
    expect(undone.circuit).toBe(initial.circuit);
    expect(isDirty(undone)).toBe(false);
    expect(toWorkbenchState(undone)).toMatchObject({ canUndo: false, canRedo: true });
    const redone = run(undone, { type: "redo" }, { type: "redo" });
    expect(redone.circuit).toBe(edited.circuit);
    expect(run(redone, { type: "redo" })).toBe(redone);
    // A new edit discards the redo branch.
    expect(run(undone, { type: "redo" }, { type: "deleteEntities", ids: ["e5"] }).future).toEqual([]);
  });

  it("keeps typed text until the next canvas edit and flags it", () => {
    const typed = run(initial, { type: "setSource", source: initial.source + "// note\n" });
    expect(isDirty(typed)).toBe(true);
    expect(typed.circuit).toBe(initial.circuit);
    expect(toWorkbenchState(typed).diagnostics[0]).toMatchObject({ severity: "info", code: "demo-text-not-parsed" });
    const edited = run(typed, { type: "deleteEntities", ids: ["e5"] });
    expect(edited.source).toBe(printDemoSource(edited.circuit));
    expect(toWorkbenchState(edited).diagnostics).toEqual([]);
  });

  it("never lets simulation or view state touch the document", () => {
    const next = run(initial, { type: "step" }, { type: "run" }, { type: "setSpeed", speed: 10 }, { type: "setMode", mode: "split" }, { type: "select", ids: ["e1", "missing"] });
    expect(next.circuit).toBe(initial.circuit);
    expect(next.source).toBe(initial.source);
    expect(next.past).toEqual([]);
    expect(next.selection).toEqual(["e1"]);
    const view = toWorkbenchState(next);
    expect(view.simulation).toMatchObject({ tick: 1, running: true, speed: 10 });
    expect(view.simulation.traces.map((trace) => trace.label)).toEqual(["source"]);
    expect(view.simulation.traces[0]!.values).toHaveLength(2);
    expect(run(next, { type: "resetSimulation" })).toMatchObject({ tick: 0, running: false });
    expect(run(next, { type: "setSpeed", speed: 7 })).toBe(next);
  });
});

describe("demo project commands", () => {
  it("asks for a location on first save, then saves in place and becomes clean", async () => {
    const saveProject = vi.fn((request: SaveProjectRequest) => ok(request.path === null ? { path: "/projects/demo" } : { path: request.path }));
    const session = createDemoSession(fakeApi({ saveProject }));
    session.getController().commands.deleteEntities(["e5"]);
    expect(session.getController().state.project).toMatchObject({ dirty: true, path: null });

    expect(await session.getController().commands.save()).toBe(true);
    expect(saveProject.mock.calls[0]![0].path).toBeNull();
    expect(saveProject.mock.calls[0]![0].data).toEqual(toProjectData(session.getState()));
    expect(session.getController().state.project).toMatchObject({ dirty: false, path: "/projects/demo" });

    session.getController().commands.deleteEntities(["e4"]);
    expect(await session.getController().commands.save()).toBe(true);
    expect(saveProject.mock.calls[1]![0].path).toBe("/projects/demo");
    expect(saveProject.mock.calls[1]![0].data.files[0]!.source).toBe(session.getState().source);
  });

  it("reports a cancelled dialog and a failed write as not saved", async () => {
    const cancelled = createDemoSession(fakeApi({ saveProjectAs: () => ok(null) }));
    expect(await cancelled.getController().commands.saveAs()).toBe(false);
    expect(cancelled.getController().state.error).toBeNull();

    const failing = createDemoSession(fakeApi({ saveProject: () => Promise.resolve({ ok: false, error: "disk full" }) }));
    expect(await failing.getController().commands.save()).toBe(false);
    expect(failing.getController().state.error).toBe("disk full");

    const noDesktop = createDemoSession(undefined);
    expect(await noDesktop.getController().commands.save()).toBe(false);
    expect(noDesktop.getController().state.error).toContain("desktop app");
  });

  it("keeps the project when replacing it is cancelled, and replaces it after discard", async () => {
    const choices: UnsavedChoice[] = ["cancel", "discard"];
    const session = createDemoSession(fakeApi({ confirmUnsavedChanges: () => ok(choices.shift()!) }));
    session.getController().commands.deleteEntities(["e5"]);
    await session.getController().commands.newProject();
    expect(session.getController().state.circuit.entities).toHaveLength(4);
    await session.getController().commands.newProject();
    expect(session.getController().state).toMatchObject({ editable: true, project: { name: "Untitled circuit", path: null, dirty: false } });
    expect(session.getController().state.circuit.entities).toEqual([]);
  });

  it("shows an opened project as source only", async () => {
    const project: LoadedProject = { path: "/projects/other", data: { manifest: { formatVersion: 1, name: "Other", gameVersion: "2.1.24", modules: ["base"], customSignalGroups: [], circuits: ["other.face"] }, files: [{ name: "other.face", source: 'circuit "Other" {\n}\n' }] } };
    const session = createDemoSession(fakeApi({ loadProject: () => ok(project) }));
    await session.getController().commands.loadProject("/projects/other");
    const state = session.getController().state;
    expect(state).toMatchObject({ editable: false, mode: "source", source: 'circuit "Other" {\n}\n', project: { name: "Other", path: "/projects/other", fileName: "other.face", dirty: false } });
    expect(state.diagnostics[0]!.code).toBe("demo-source-only");
    session.getController().commands.placeEntity("lamp", { x: 0, y: 0 });
    expect(session.getController().state.circuit.entities).toEqual([]);
    expect(toProjectData(session.getState()).manifest.modules).toEqual(["base"]);
  });

  it("notifies subscribers once per change and keeps the controller stable in between", () => {
    const session = createDemoSession(fakeApi());
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    const before = session.getController();
    expect(session.getController()).toBe(before);
    before.commands.select(["e1"]);
    before.commands.select(["e1"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.getController()).not.toBe(before);
    expect(session.getController().commands).toBe(before.commands);
    unsubscribe();
    before.commands.select([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
