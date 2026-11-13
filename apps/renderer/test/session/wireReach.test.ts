// The wire reach: a project setting that the analysis measures wires against, kept in the project file.
import { DEFAULT_WIRE_REACH } from "@face/model";
import { describe, expect, it } from "vitest";
import { isDirty, openProjectFile, toProjectData } from "../../src/session/persistence.ts";
import { createSession, fakeDesktop, idOf, MANIFEST, project, replaceText } from "./helpers.ts";

/** `far` is 11 tiles from `source` (the tiles between them), `near` 3; `loose` has no tile. */
const SPREAD = `circuit "Spread" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    lamp near at (300, 80) tile (4.5, 0.5) {
    }

    lamp far at (560, 80) tile (12.5, 0.5) {
    }

    lamp loose at (4000, 80) {
    }

    wire red source.out <-> near.in
    wire red source.out <-> far.in
    wire green source.out <-> loose.in
}
`;

const tooLong = (session: { readonly state: { readonly diagnostics: readonly { readonly code: string; readonly message: string }[] } }): string[] =>
  session.state.diagnostics.filter((diagnostic) => diagnostic.code === "wire-too-long").map((diagnostic) => diagnostic.message);

describe("wire reach", () => {
  it("is 9 tiles for a project that does not say, and warns about wires between placed entities that are further apart", () => {
    const { session } = createSession(SPREAD);
    expect(session.state.project.wireReach).toBe(DEFAULT_WIRE_REACH);
    expect(tooLong(session)).toEqual(["Wire from 'source.out' to 'far.in': the entities are 11.0 tiles apart; the wire reach of the project is 9"]);
    expect(session.state.diagnostics.find((diagnostic) => diagnostic.code === "wire-too-long")).toMatchObject({ severity: "warning", line: 16 });
    // A warning: the circuit is there, can be edited and simulated.
    expect(session.state).toMatchObject({ editable: true });
    expect(session.state.circuit.wires).toHaveLength(3);
    expect(session.state.simulation.available).toBe(true);
  });

  it("measures the wires again when the setting changes, without touching the document or the simulation", () => {
    const { session, notifications } = createSession(SPREAD);
    session.commands.step();
    const { circuit, source } = session.state;
    const tick = session.state.simulation.tick;

    session.commands.setWireReach(12);
    expect(session.state.project).toMatchObject({ wireReach: 12, dirty: true });
    expect(tooLong(session)).toEqual([]);
    session.commands.setWireReach(11);
    expect(tooLong(session)).toEqual([]);
    session.commands.setWireReach(2.5);
    expect(tooLong(session)).toEqual([
      "Wire from 'source.out' to 'near.in': the entities are 3.0 tiles apart; the wire reach of the project is 2.5",
      "Wire from 'source.out' to 'far.in': the entities are 11.0 tiles apart; the wire reach of the project is 2.5",
    ]);
    // 0 is a reach too: unlimited, nothing is flagged.
    session.commands.setWireReach(0);
    expect(session.state.project).toMatchObject({ wireReach: 0, dirty: true });
    expect(tooLong(session)).toEqual([]);
    session.commands.setWireReach(64);
    expect(session.state.project.wireReach).toBe(64);
    session.commands.setWireReach(DEFAULT_WIRE_REACH);
    expect(session.state.project).toMatchObject({ wireReach: 9, dirty: false });
    expect(tooLong(session)).toHaveLength(1);

    // The setting is not part of the document: same circuit object, same text, nothing to undo, the simulation went on.
    expect(session.state.circuit).toBe(circuit);
    expect(session.state.source).toBe(source);
    expect(session.state.canUndo).toBe(false);
    expect(session.state.simulation.tick).toBe(tick);

    // The same value again changes nothing and notifies nobody; a value out of range is ignored.
    const before = notifications();
    session.commands.setWireReach(9);
    for (const invalid of [-1, -0.5, 64.5, 101, Number.NaN, Number.POSITIVE_INFINITY, "12" as unknown as number]) session.commands.setWireReach(invalid);
    expect(notifications()).toBe(before);
    expect(session.state.project.wireReach).toBe(9);
  });

  it("judges every edit of the document against the reach that is set", () => {
    const { session } = createSession(SPREAD);
    session.commands.setWireReach(12);
    session.commands.setTiles([{ id: idOf(session, "far"), tile: { x: 13.5, y: 0.5 } }]);
    expect(tooLong(session)).toEqual([]);
    session.commands.setTiles([{ id: idOf(session, "far"), tile: { x: 14.5, y: 0.5 } }]);
    expect(tooLong(session)).toEqual(["Wire from 'source.out' to 'far.in': the entities are 13.0 tiles apart; the wire reach of the project is 12"]);
    session.commands.undo();
    session.commands.undo();
    expect(tooLong(session)).toEqual([]);
    // The move is not refused, and an entity that gets a tile gets a wire that is measured.
    session.commands.setTiles([{ id: idOf(session, "loose"), tile: { x: 0.5, y: 30.5 } }]);
    expect(session.state.circuit.entities.find((entity) => entity.name === "loose")!.placement).toEqual({ tile: { x: 0.5, y: 30.5 } });
    expect(tooLong(session)).toEqual(["Wire from 'source.out' to 'loose.in': the entities are 29.0 tiles apart; the wire reach of the project is 12"]);
    // While the source has errors the warning waits with everything else, and comes back with the reach that is set.
    replaceText(session, "lamp near", "lamp");
    session.commands.setWireReach(40);
    expect(session.state.editable).toBe(false);
    replaceText(session, "lamp at (300", "lamp near at (300");
    expect(session.state.editable).toBe(true);
    expect(tooLong(session)).toEqual([]);
  });

  it("is saved in the project file when it is not the default, and read back", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(SPREAD, { api: desktop.api });
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/saved")!.manifest).not.toHaveProperty("wireReach");

    session.commands.setWireReach(12.5);
    expect(session.state.project.dirty).toBe(true);
    expect(await session.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/saved")!.manifest).toEqual({ ...MANIFEST, wireReach: 12.5 });
    expect(session.state.project).toMatchObject({ wireReach: 12.5, dirty: false });

    const second = createSession(undefined, { api: desktop.api }).session;
    expect(second.state.project.wireReach).toBe(9);
    await second.commands.loadProject("/projects/saved");
    expect(second.state.project).toMatchObject({ wireReach: 12.5, dirty: false });
    expect(tooLong(second)).toEqual([]);

    // Back at the default the field leaves the file again; everything else of the manifest stays.
    second.commands.setWireReach(9);
    expect(second.state.project.dirty).toBe(true);
    expect(await second.commands.save()).toBe(true);
    expect(desktop.disk.get("/projects/saved")!.manifest).toEqual(MANIFEST);
    expect(tooLong(second)).toHaveLength(1);

    // A new project starts with the default again.
    await second.commands.newProject();
    expect(second.state.project.wireReach).toBe(9);
  });

  it("takes the reach of a loaded manifest, and writes an explicit 9 as no field", () => {
    const loaded = openProjectFile(project(SPREAD, { wireReach: 20, extras: { later: true } }, "/projects/p"));
    expect(loaded.settings.wireReach).toBe(20);
    expect(isDirty(loaded.file, loaded.source, loaded.settings)).toBe(false);
    expect(isDirty(loaded.file, loaded.source, { ...loaded.settings, wireReach: 9 })).toBe(true);
    expect(toProjectData(loaded.file, loaded.source, loaded.settings).manifest).toEqual({ ...MANIFEST, wireReach: 20, extras: { later: true } });
    expect(toProjectData(loaded.file, loaded.source, { ...loaded.settings, wireReach: 9 }).manifest).toEqual({ ...MANIFEST, extras: { later: true } });
    // Unlimited is a value like any other, not an absent one.
    const unlimited = openProjectFile(project(SPREAD, { wireReach: 0 }));
    expect(unlimited.settings.wireReach).toBe(0);
    expect(isDirty(unlimited.file, unlimited.source, unlimited.settings)).toBe(false);
    expect(toProjectData(unlimited.file, unlimited.source, unlimited.settings).manifest).toEqual({ ...MANIFEST, wireReach: 0 });
    const explicit = openProjectFile(project(SPREAD, { wireReach: 9 }));
    expect(explicit.settings.wireReach).toBe(9);
    expect(toProjectData(explicit.file, explicit.source, explicit.settings).manifest).toEqual(MANIFEST);
  });
});
