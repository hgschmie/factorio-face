// Wires are selected by their key (color and the ids of both ends), next to the entity selection.
import { wireKey, type TerminalSide, type WireColor } from "@face/model";
import { describe, expect, it } from "vitest";
import type { ProjectSession } from "../../src/session/projectSession.ts";
import { createSession, entityNamed, fakeDesktop, idOf, IRREGULAR, project, replaceText, type } from "./helpers.ts";

/** The key of a wire given as in the source, for example `key(session, "red", "src.out", "gate.in")`. */
function key(session: ProjectSession, color: WireColor, a: string, b: string): string {
  const end = (text: string) => {
    const [name, side] = text.split(".") as [string, TerminalSide];
    return { entity: idOf(session, name), side };
  };
  return wireKey({ color, a: end(a), b: end(b) });
}

describe("wire selection", () => {
  it("selects wires next to entities, ignores what does not exist and does not notify when nothing changes", () => {
    const { session, notifications } = createSession(IRREGULAR);
    const gate = idOf(session, "gate");
    const red = key(session, "red", "src.out", "gate.in");
    const loop = key(session, "green", "gate.out", "gate.in");
    expect(session.state.wireSelection).toEqual([]);

    session.commands.select([], [red, "red|e1.out|e9.in", red]);
    expect(session.state).toMatchObject({ selection: [], wireSelection: [red] });
    // The reversed declaration is the same wire.
    session.commands.select([gate], [key(session, "red", "gate.in", "src.out"), loop]);
    expect(session.state).toMatchObject({ selection: [gate], wireSelection: [red, loop] });

    const count = notifications();
    const state = session.state;
    session.commands.select([gate], [red, loop]);
    expect(notifications()).toBe(count);
    expect(session.state).toBe(state);

    // A selection given without wires has none, as every click on a card does it.
    session.commands.select([gate]);
    expect(session.state).toMatchObject({ selection: [gate], wireSelection: [] });
    expect(notifications()).toBe(count + 1);
    // Only the wires changed: the entity selection keeps its identity.
    const { selection } = session.state;
    session.commands.select([gate], [loop]);
    expect(session.state.selection).toBe(selection);
    expect(session.state.wireSelection).toEqual([loop]);
    expect(session.state.canUndo).toBe(false);
  });

  it("survives a move, a rename and typing elsewhere", () => {
    const { session } = createSession(IRREGULAR);
    const red = key(session, "red", "src.out", "gate.in");
    const lamp = key(session, "green", "gate.out", "light.in");
    session.commands.select([], [red, lamp]);

    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 320, y: 200 } }]);
    expect(session.state.wireSelection).toEqual([red, lamp]);
    session.commands.renameEntity(idOf(session, "gate"), "counter");
    expect(session.state.source).toContain("wire red src.out <-> counter.in");
    expect(session.state.wireSelection).toEqual([red, lamp]);
    expect(key(session, "red", "src.out", "counter.in")).toBe(red);
    type(session, 0, "// a note\n");
    replaceText(session, "< 10", "< 12");
    expect(session.state.wireSelection).toEqual([red, lamp]);

    // While the source has errors the circuit on show, and with it the selection, stays.
    type(session, session.state.source.indexOf("lamp light"), "?");
    expect(session.state).toMatchObject({ editable: false, wireSelection: [red, lamp] });
    session.commands.undo();
    expect(session.state).toMatchObject({ editable: true, wireSelection: [red, lamp] });
  });

  it("drops a wire from the selection when the wire goes", () => {
    const { session } = createSession(IRREGULAR);
    const red = key(session, "red", "src.out", "gate.in");
    const loop = key(session, "green", "gate.out", "gate.in");
    const lamp = key(session, "green", "gate.out", "light.in");
    session.commands.select([], [red, loop, lamp]);

    session.commands.removeWire({ color: "green", a: { entity: idOf(session, "gate"), side: "out" }, b: { entity: idOf(session, "gate"), side: "in" } });
    expect(session.state.wireSelection).toEqual([red, lamp]);
    // Taken out of the text by hand.
    replaceText(session, "  wire green gate.out <-> light.in\n", "");
    expect(session.state.wireSelection).toEqual([red]);
    // With an entity at one of its ends.
    session.commands.deleteEntities([idOf(session, "src")]);
    expect(session.state.wireSelection).toEqual([]);
    // Undo brings the wire back, not its selection (the restored entity has a new id, and with it the wire a new key).
    session.commands.undo();
    expect(session.state.circuit.wires.map(wireKey)).toContain(key(session, "red", "src.out", "gate.in"));
    expect(session.state.wireSelection).toEqual([]);
  });

  it("deleteSelection removes the selected wires as one undo step", () => {
    const { session } = createSession(IRREGULAR);
    const red = key(session, "red", "src.out", "gate.in");
    const lamp = key(session, "green", "gate.out", "light.in");
    session.commands.select([], [red, lamp]);
    session.commands.deleteSelection();
    // Both declarations of the red wire are gone, the feedback wire is untouched.
    expect(session.state.source).toBe(IRREGULAR.replace("  wire red src.out <-> gate.in   // first\n", "").replace("  wire red gate.in <-> src.out // reversed duplicate\n", "").replace("  wire green gate.out <-> light.in\n", ""));
    expect(session.state.circuit.wires.map(wireKey)).toEqual([key(session, "green", "gate.out", "gate.in")]);
    expect(session.state.circuit.entities).toHaveLength(3);
    expect(session.state).toMatchObject({ selection: [], wireSelection: [], error: null });

    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
  });

  it("deleteSelection removes entities and wires together as one undo step", () => {
    const { session } = createSession(IRREGULAR);
    const red = key(session, "red", "src.out", "gate.in");
    const loop = key(session, "green", "gate.out", "gate.in");
    session.commands.select([idOf(session, "light")], [red, loop]);
    session.commands.deleteSelection();
    expect(session.state.circuit.entities.map((entity) => entity.name)).toEqual(["src", "gate"]);
    expect(session.state.circuit.wires).toEqual([]);
    expect(session.state).toMatchObject({ selection: [], wireSelection: [], error: null });

    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
    session.commands.redo();
    expect(session.state.circuit.wires).toEqual([]);
  });

  it("deleteSelection does nothing without a selection or while the source has errors", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.deleteSelection();
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, error: null });

    const red = key(session, "red", "src.out", "gate.in");
    session.commands.select([idOf(session, "light")], [red]);
    type(session, session.state.source.indexOf("lamp light"), "?");
    const broken = session.state.source;
    session.commands.deleteSelection();
    expect(session.state).toMatchObject({ source: broken, editable: false, wireSelection: [red], error: null });
  });

  it("deleting or cutting entities leaves the selected wires that still exist", () => {
    const { session } = createSession(IRREGULAR);
    const red = key(session, "red", "src.out", "gate.in");
    const lamp = key(session, "green", "gate.out", "light.in");
    session.commands.select([idOf(session, "light")], [red, lamp]);
    // Copy takes the entities; a wire selection alone gives no text.
    expect(session.commands.copyEntities(session.state.selection)).toContain("lamp light");
    expect(session.commands.copyEntities([])).toBe("");
    session.commands.deleteEntities(session.state.selection);
    expect(session.state).toMatchObject({ selection: [], wireSelection: [red] });
    expect(session.state.source).toContain("wire red src.out <-> gate.in");
  });

  it("a caret placed by the user inside a wire declaration selects that wire", () => {
    const { session } = createSession(IRREGULAR);
    const red = key(session, "red", "src.out", "gate.in");
    session.commands.select([idOf(session, "light")]);
    session.document.dispatch({ selection: { anchor: session.state.source.indexOf("gate.in <-> src.out") }, userEvent: "select.pointer" });
    expect(session.state).toMatchObject({ selection: [], wireSelection: [red] });
    // Between declarations the selection stays; a caret inside an entity selects the entity alone.
    session.document.dispatch({ selection: { anchor: 3 }, userEvent: "select.pointer" });
    expect(session.state.wireSelection).toEqual([red]);
    session.document.dispatch({ selection: { anchor: session.state.source.indexOf("output virtual:signal-A") }, userEvent: "select.pointer" });
    expect(session.state).toMatchObject({ selection: [idOf(session, "gate")], wireSelection: [] });
    expect(session.state.canUndo).toBe(false);
  });

  it("a pending inspector draft is dropped when a wire joins the selection", () => {
    const { session } = createSession(IRREGULAR);
    const gate = entityNamed(session, "gate");
    if (gate.kind !== "decider") throw new Error("gate is a decider");
    session.commands.select([gate.id]);
    const { first: _first, ...blank } = gate.conditions[0]!;
    session.commands.updateEntity({ ...gate, conditions: [blank] });
    expect(session.state.draft).not.toBeNull();
    session.commands.select([gate.id], [key(session, "red", "src.out", "gate.in")]);
    expect(session.state.draft).toBeNull();
    session.commands.select([gate.id]);
    expect(session.state.draft).toBeNull();
  });

  it("placing and pasting select the new entities alone, and a loaded project starts without a selection", async () => {
    const desktop = fakeDesktop();
    desktop.disk.set("/projects/other", project(IRREGULAR).data);
    const { session } = createSession(IRREGULAR, { api: desktop.api });
    const red = key(session, "red", "src.out", "gate.in");
    session.commands.select([], [red]);
    session.commands.placeEntity("lamp", { x: 800, y: 80 });
    expect(session.state.selection).toHaveLength(1);
    expect(session.state.wireSelection).toEqual([]);

    session.commands.select([], [red]);
    session.commands.pasteEntities(session.commands.copyEntities([idOf(session, "light")]));
    expect(session.state.selection).toHaveLength(1);
    expect(session.state.wireSelection).toEqual([]);

    session.commands.select([], [red]);
    desktop.unsavedChoice = "discard";
    await session.commands.loadProject("/projects/other");
    expect(session.state).toMatchObject({ selection: [], wireSelection: [] });
  });
});
