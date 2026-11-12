// The display mode of the canvas: view state of the session like the workbench mode and the tool.
import { describe, expect, it } from "vitest";
import { DISPLAY_CAPABILITIES, DISPLAY_MODES, toolAllowed, type Tool } from "../../src/workbench/controller.ts";
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

  it("offers every tool in edit mode and, so far, only the select tool on the blueprint board", () => {
    expect(DISPLAY_MODES).toEqual(["edit", "blueprint"]);
    for (const tool of TOOLS) expect(toolAllowed(tool, "edit")).toBe(true);
    expect(TOOLS.filter((tool) => toolAllowed(tool, "blueprint"))).toEqual([{ type: "select" }]);
    expect(Object.values(DISPLAY_CAPABILITIES.edit).every(Boolean)).toBe(true);
  });

  it("gives up a tool the new mode does not offer and refuses to pick one", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.setTool({ type: "wire", color: "green" });
    session.commands.setDisplayMode("blueprint");
    expect(session.state.tool).toEqual({ type: "select" });
    for (const tool of TOOLS) {
      session.commands.setTool(tool);
      expect(session.state.tool, JSON.stringify(tool)).toEqual({ type: "select" });
    }
    session.commands.setDisplayMode("edit");
    session.commands.setTool({ type: "place", kind: "lamp" });
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
