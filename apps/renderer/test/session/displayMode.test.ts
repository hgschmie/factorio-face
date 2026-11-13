// The display mode of the canvas: view state of the session like the workbench mode and the tool.
import { describe, expect, it } from "vitest";
import { DISPLAY_CAPABILITIES, DISPLAY_MODES, placeFacing, sameTool, toolAllowed, turnedTool, type Tool } from "../../src/workbench/controller.ts";
import { createSession, idOf, IRREGULAR, project } from "./helpers.ts";

const TOOLS: readonly Tool[] = [{ type: "select" }, { type: "wire", color: "red" }, { type: "wire", color: "green" }, { type: "place", kind: "lamp" }];

describe("display mode", () => {
  it("starts as edit and switches without touching document, history, selection or simulation", () => {
    const { session, notifications } = createSession(IRREGULAR);
    expect(session.state.displayMode).toBe("edit");
    const gate = idOf(session, "gate");
    session.commands.select([gate]);
    session.commands.moveEntities([{ id: gate, position: { x: 320, y: 80 } }]);
    session.commands.step();
    const document = session.document.state;
    const { source, circuit, selection, simulation, project: shown } = session.state;
    const count = notifications();

    session.commands.setDisplayMode("blueprint");
    expect(notifications()).toBe(count + 1);
    expect(session.state).toMatchObject({ displayMode: "blueprint", source, canUndo: true, canRedo: false, mode: "circuit" });
    expect(session.document.state).toBe(document);
    expect(session.state.circuit).toBe(circuit);
    expect(session.state.selection).toBe(selection);
    expect(session.state.simulation).toBe(simulation);
    expect(session.state.project).toBe(shown);

    // The same mode again is no change; neither is something that is no mode.
    session.commands.setDisplayMode("blueprint");
    session.commands.setDisplayMode("sideways" as never);
    expect(notifications()).toBe(count + 1);
    expect(session.state.displayMode).toBe("blueprint");

    // Undo takes back the move, not the mode.
    session.commands.undo();
    expect(session.state).toMatchObject({ displayMode: "blueprint", source: IRREGULAR });
    session.commands.setMode("source");
    session.commands.setMode("circuit");
    expect(session.state.displayMode).toBe("blueprint");
    session.commands.setDisplayMode("edit");
    expect(session.state.displayMode).toBe("edit");
  });

  it("offers every tool and everything else in both modes; only the board works on tiles", () => {
    expect(DISPLAY_MODES).toEqual(["edit", "blueprint"]);
    for (const mode of DISPLAY_MODES) for (const tool of TOOLS) expect(toolAllowed(tool, mode), `${mode} ${JSON.stringify(tool)}`).toBe(true);
    const { tiles: _tiles, ...edit } = DISPLAY_CAPABILITIES.edit;
    expect(Object.values(edit).every(Boolean)).toBe(true);
    expect(Object.values(DISPLAY_CAPABILITIES.blueprint).every(Boolean)).toBe(true);
  });

  it("turns a place tool with the keys of a rotation: the direction is part of the tool, and picking the tool again faces east", () => {
    const decider: Tool = { type: "place", kind: "decider" };
    expect(placeFacing(decider)).toBe("east");
    expect(turnedTool(decider, "clockwise")).toEqual({ type: "place", kind: "decider", facing: "south" });
    expect(turnedTool(decider, "counterclockwise")).toEqual({ type: "place", kind: "decider", facing: "north" });
    expect(turnedTool({ ...decider, facing: "north" }, "clockwise")).toEqual({ type: "place", kind: "decider", facing: "east" });
    // The same button of the palette whatever the direction.
    expect(sameTool(decider, { ...decider, facing: "west" })).toBe(true);
    // A lamp does not rotate, and the other tools place nothing.
    expect(turnedTool({ type: "place", kind: "lamp" }, "clockwise")).toBeUndefined();
    expect(placeFacing({ type: "place", kind: "lamp", facing: "south" })).toBe("east");
    expect(turnedTool({ type: "select" }, "clockwise")).toBeUndefined();
    expect(turnedTool({ type: "wire", color: "red" }, "clockwise")).toBeUndefined();

    const { session, notifications } = createSession(IRREGULAR);
    session.commands.setTool(decider);
    session.commands.setTool(turnedTool(session.state.tool, "clockwise")!);
    expect(session.state.tool).toEqual({ type: "place", kind: "decider", facing: "south" });
    const count = notifications();
    session.commands.setTool({ type: "place", kind: "decider", facing: "south" });
    expect(notifications()).toBe(count);
    // The mode keeps it; the tool picked again starts over.
    session.commands.setDisplayMode("blueprint");
    expect(placeFacing(session.state.tool)).toBe("south");
    session.commands.setTool(decider);
    expect(placeFacing(session.state.tool)).toBe("east");
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false });
  });

  it("keeps the tool when the mode changes, and picks every tool on the board", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.setTool({ type: "wire", color: "green" });
    session.commands.setDisplayMode("blueprint");
    expect(session.state.tool).toEqual({ type: "wire", color: "green" });
    for (const tool of TOOLS) {
      session.commands.setTool(tool);
      expect(session.state.tool, JSON.stringify(tool)).toEqual(tool);
    }
    session.commands.setDisplayMode("edit");
    expect(session.state.tool).toEqual({ type: "place", kind: "lamp" });
  });

  it("is edit again for every project that is loaded", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.setDisplayMode("blueprint");
    session.load(project(IRREGULAR));
    expect(session.state.displayMode).toBe("edit");
  });

  it("leaves the document commands alone: the inspector edits and deletes in both modes", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.setDisplayMode("blueprint");
    const gate = idOf(session, "gate");
    session.commands.renameEntity(gate, "door");
    expect(session.state.source).toContain("decider door");
    session.commands.deleteEntities([gate]);
    expect(session.state.circuit.entities.some((entity) => entity.id === gate)).toBe(false);
    expect(session.state).toMatchObject({ displayMode: "blueprint", error: null });
  });
});
