// The two commands behind the arrow keys and Cmd/Ctrl+D: moving the selection by a distance and duplicating it.
import type { Point } from "@face/model";
import { describe, expect, it } from "vitest";
import type { ProjectSession } from "../../src/session/projectSession.ts";
import { EXAMPLE_SOURCE } from "../fixtures/example.ts";
import { nudgeDelta } from "../../src/shortcuts/shortcuts.ts";
import { createSession, entityNamed, idOf, IRREGULAR, replaceText } from "./helpers.ts";

const names = (session: ProjectSession): string[] => session.state.circuit.entities.map((entity) => entity.name);
const selected = (session: ProjectSession): string[] => session.state.circuit.entities.filter((entity) => session.state.selection.includes(entity.id)).map((entity) => entity.name);
const positions = (session: ProjectSession, ...of: string[]): Point[] => of.map((name) => entityNamed(session, name).position);
const select = (session: ProjectSession, ...of: string[]): void => session.commands.select(of.map((name) => idOf(session, name)));

describe("nudging the selection", () => {
  it("moves the selected entities by the distance as one undo step and keeps the selection", () => {
    const { session, notifications } = createSession();
    select(session, "source", "gate");
    const before = notifications();
    session.commands.nudgeSelection(nudgeDelta("ArrowRight", false));
    expect(notifications()).toBe(before + 1);
    expect(positions(session, "source", "gate", "twice")).toEqual([{ x: 60, y: 80 }, { x: 320, y: 80 }, { x: 300, y: 240 }]);
    expect(session.state.source).toBe(EXAMPLE_SOURCE.replace("source at (40, 80)", "source at (60, 80)").replace("gate at (300, 80)", "gate at (320, 80)"));
    expect(selected(session)).toEqual(["source", "gate"]);
    expect(session.state.circuit.wires).toHaveLength(4);

    session.commands.nudgeSelection(nudgeDelta("ArrowUp", true));
    expect(positions(session, "source", "gate")).toEqual([{ x: 60, y: -20 }, { x: 320, y: -20 }]);
    // One step per call, and the selection is still there after taking them back.
    session.commands.undo();
    expect(positions(session, "source", "gate")).toEqual([{ x: 60, y: 80 }, { x: 320, y: 80 }]);
    session.commands.undo();
    expect(session.state.source).toBe(EXAMPLE_SOURCE);
    expect(session.state.canUndo).toBe(false);
    expect(selected(session)).toEqual(["source", "gate"]);
  });

  it("keeps an entity that is off the grid off the grid, and the text around the position as it is", () => {
    const start = IRREGULAR.replace("gate at (300, 80)", "gate at (305, 87)");
    const { session } = createSession(start);
    select(session, "src", "gate");
    session.commands.nudgeSelection({ x: -20, y: 20 });
    expect(session.state.source).toBe(start.replace("at ( 40 ,80 )", "at ( 20 ,100 )").replace("gate at (305, 87)", "gate at (285, 107)"));
  });

  it("keeps selected wires selected and moves only entities", () => {
    const { session } = createSession();
    const wire = session.state.circuit.wires[0]!;
    const key = `${wire.color}|${[`${wire.a.entity}.${wire.a.side}`, `${wire.b.entity}.${wire.b.side}`].sort().join("|")}`;
    session.commands.select([idOf(session, "light")], [key]);
    expect(session.state.wireSelection).toEqual([key]);
    session.commands.nudgeSelection({ x: 0, y: 20 });
    expect(positions(session, "light")).toEqual([{ x: 560, y: 100 }]);
    expect(session.state.wireSelection).toEqual([key]);

    // Wires alone: nothing to move, no step.
    session.commands.select([], [key]);
    const source = session.state.source;
    session.commands.nudgeSelection({ x: 20, y: 0 });
    expect(session.state.source).toBe(source);
  });

  it("does nothing without a selection, without a distance and while the source has errors", () => {
    const { session, notifications } = createSession();
    session.commands.nudgeSelection({ x: 20, y: 0 });
    select(session, "gate");
    const before = notifications();
    session.commands.nudgeSelection({ x: 0, y: 0 });
    expect(notifications()).toBe(before);
    expect(session.state).toMatchObject({ source: EXAMPLE_SOURCE, canUndo: false, error: null });

    replaceText(session, "when virtual:signal-A < 10", "when virtual:signal-A <");
    expect(session.state.editable).toBe(false);
    const broken = session.state.source;
    session.commands.nudgeSelection({ x: 20, y: 0 });
    expect(session.state).toMatchObject({ source: broken, error: null });
    expect(positions(session, "gate")).toEqual([{ x: 300, y: 80 }]);
  });
});

describe("duplicating the selection", () => {
  it("has the result of a copy and a paste, as one undo step, and selects the copies", () => {
    const { session, notifications } = createSession();
    select(session, "source", "gate");
    session.commands.setTool({ type: "wire", color: "green" });
    const before = notifications();
    session.commands.duplicateSelection();
    expect(notifications()).toBe(before + 1);
    expect(names(session)).toEqual(["source", "gate", "twice", "light", "source2", "gate2"]);
    expect(selected(session)).toEqual(["source2", "gate2"]);
    expect(positions(session, "source2", "gate2")).toEqual([{ x: 80, y: 120 }, { x: 340, y: 120 }]);
    // The wires between the two came along, those to the rest of the circuit did not.
    expect(session.state.circuit.wires).toHaveLength(6);
    expect(session.state).toMatchObject({ tool: { type: "select" }, error: null, editable: true });

    const pasted = createSession().session;
    pasted.commands.pasteEntities(pasted.commands.copyEntities(["source", "gate"].map((name) => idOf(pasted, name))));
    expect(session.state.source).toBe(pasted.state.source);

    session.commands.undo();
    expect(session.state).toMatchObject({ source: EXAMPLE_SOURCE, canUndo: false });
    session.commands.redo();
    expect(names(session)).toHaveLength(6);
  });

  it("duplicates the copies again, one step further on", () => {
    const { session } = createSession();
    select(session, "light");
    session.commands.duplicateSelection();
    session.commands.duplicateSelection();
    expect(names(session).slice(4)).toEqual(["light2", "light3"]);
    expect(selected(session)).toEqual(["light3"]);
    expect(positions(session, "light2", "light3")).toEqual([{ x: 600, y: 120 }, { x: 640, y: 160 }]);
    session.commands.undo();
    session.commands.undo();
    expect(session.state.source).toBe(EXAMPLE_SOURCE);
  });

  it("does nothing without a selected entity and while the source has errors, and reports nothing", () => {
    const { session, notifications } = createSession();
    const before = notifications();
    session.commands.duplicateSelection();
    const wire = session.state.circuit.wires[0]!;
    session.commands.select([], [`${wire.color}|${[`${wire.a.entity}.${wire.a.side}`, `${wire.b.entity}.${wire.b.side}`].sort().join("|")}`]);
    expect(session.state.wireSelection).toHaveLength(1);
    session.commands.duplicateSelection();
    expect(notifications()).toBe(before + 1);
    expect(session.state).toMatchObject({ source: EXAMPLE_SOURCE, canUndo: false, error: null });

    select(session, "gate");
    replaceText(session, "when virtual:signal-A < 10", "when virtual:signal-A <");
    const broken = session.state.source;
    session.commands.duplicateSelection();
    expect(session.state).toMatchObject({ source: broken, error: null });
    expect(names(session)).toHaveLength(4);
  });
});
