// Rotating entities: the `facing` clause changes (and the `tile` of a 2x1 entity that has one), a selection turns as one undo step.
import { facingOf } from "@face/model";
import { describe, expect, it } from "vitest";
import { STARTER_SOURCE } from "../../src/session/starter.ts";
import { createSession, entityNamed, errorsOf, idOf, IRREGULAR, replaceText } from "./helpers.ts";

describe("rotating entities", () => {
  it("turns an entity clockwise through south, west and north back to east, writing the clause every time", () => {
    const { session } = createSession(IRREGULAR);
    const id = idOf(session, "gate");
    const steps = ["gate at (300, 80) facing south", "gate at (300, 80) facing west", "gate at (300, 80) facing north", "gate at (300, 80) facing east"];
    for (const text of steps) {
      session.commands.rotateEntities([id], "clockwise");
      expect(session.state.source).toBe(IRREGULAR.replace("gate at (300, 80)", text));
      expect(errorsOf(session)).toEqual([]);
    }
    expect(facingOf(entityNamed(session, "gate"))).toBe("east");
    // Four steps forward are four steps in the history; the clause stays, also for east.
    for (const text of ["gate at (300, 80) facing north", "gate at (300, 80) facing west", "gate at (300, 80) facing south", "gate at (300, 80)"]) {
      session.commands.undo();
      expect(session.state.source).toBe(IRREGULAR.replace("gate at (300, 80)", text));
    }
    expect(session.state.canUndo).toBe(false);
  });

  it("turns counter-clockwise from east to north", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.rotateEntities([idOf(session, "src")], "counterclockwise");
    expect(session.state.source).toBe(IRREGULAR.replace("at ( 40 ,80 )", "at ( 40 ,80 ) facing north"));
    expect(entityNamed(session, "src").placement).toEqual({ direction: "north" });
    session.commands.rotateEntities([idOf(session, "src")], "counterclockwise");
    expect(facingOf(entityNamed(session, "src"))).toBe("west");
  });

  it("turns every entity of a selection in place, each from its own direction, as one undo step, and leaves a lamp as it is", () => {
    const start = IRREGULAR.replace("gate at (300, 80)", "gate at (300, 80) facing north");
    const { session } = createSession(start);
    const ids = ["src", "gate", "light"].map((name) => idOf(session, name));
    const positions = session.state.circuit.entities.map((entity) => entity.position);
    session.commands.select(ids);
    session.commands.rotateEntities(ids, "clockwise");
    expect(session.state.source).toBe(start.replace("at ( 40 ,80 )", "at ( 40 ,80 ) facing south").replace("facing north", "facing east"));
    expect(session.state.circuit.entities.map(facingOf)).toEqual(["south", "east", "east"]);
    // In place: no position changes, the wires and the selection stay, the comments too.
    expect(session.state.circuit.entities.map((entity) => entity.position)).toEqual(positions);
    expect(session.state.circuit.wires).toHaveLength(3);
    expect(session.state.selection).toEqual(ids);

    session.commands.undo();
    expect(session.state.source).toBe(start);
    expect(session.state.canUndo).toBe(false);
    expect(session.state.selection).toEqual(ids);
    session.commands.redo();
    expect(session.state.circuit.entities.map(facingOf)).toEqual(["south", "east", "east"]);
    expect(session.state.canRedo).toBe(false);
  });

  it("does not rotate a lamp: no change, no undo step and no error, also when its source says a direction", () => {
    const { session, notifications } = createSession(IRREGULAR);
    const lamp = idOf(session, "light");
    session.commands.select([lamp]);
    const before = notifications();
    session.commands.rotateEntities([lamp], "clockwise");
    session.commands.rotateEntities([lamp], "counterclockwise");
    session.commands.faceEntities([lamp], "north");
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, error: null });
    expect(notifications()).toBe(before);

    replaceText(session, "light at (560,   80)", "light at (560,   80) facing south");
    expect(entityNamed(session, "light").placement).toEqual({ direction: "south" });
    expect(facingOf(entityNamed(session, "light"))).toBe("east");
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unused-facing");
    const typed = session.state.source;
    session.commands.rotateEntities([idOf(session, "light")], "clockwise");
    session.commands.faceEntities([idOf(session, "light")], "east");
    expect(session.state.source).toBe(typed);
  });

  it("moves the tile of a 2x1 entity with the turn, keeping its top-left tile, in the same undo step", () => {
    const start = IRREGULAR.replace("gate at (300, 80)", "gate at (300, 80) tile (1, 0.5)").replace("at ( 40 ,80 )", "at ( 40 ,80 ) tile (-0.5, 0.5)");
    const { session } = createSession(start);
    const ids = ["src", "gate"].map((name) => idOf(session, name));
    session.commands.rotateEntities(ids, "clockwise");
    // The gate stands on the tiles (0, 0) and (1, 0); facing south on (0, 0) and the tile below. A 1x1 entity keeps its tile.
    expect(session.state.source).toBe(start.replace("tile (1, 0.5)", "tile (0.5, 1) facing south").replace("tile (-0.5, 0.5)", "tile (-0.5, 0.5) facing south"));
    expect(entityNamed(session, "gate").placement).toEqual({ tile: { x: 0.5, y: 1 }, direction: "south" });
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["duplicate-wire"]);
    session.commands.faceEntities(ids, "west");
    // A half turn from there is the same two tiles, flipped; from south to west the footprint lies down again.
    expect(entityNamed(session, "gate").placement).toEqual({ tile: { x: 1, y: 0.5 }, direction: "west" });
    session.commands.undo();
    session.commands.undo();
    expect(session.state).toMatchObject({ source: start, canUndo: false });
  });

  it("makes entities face a direction, leaves those alone that face it already and makes no step out of nothing", () => {
    const { session } = createSession(IRREGULAR);
    const ids = session.state.circuit.entities.map((entity) => entity.id);
    session.commands.faceEntities(ids, "east");
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, error: null });
    session.commands.faceEntities([ids[0]!], "west");
    session.commands.faceEntities(ids, "west");
    expect(session.state.circuit.entities.map(facingOf)).toEqual(["west", "west", "east"]);
    session.commands.undo();
    expect(session.state.circuit.entities.map(facingOf)).toEqual(["west", "east", "east"]);
    session.commands.faceEntities([ids[0]!], "east");
    expect(session.state.source).toBe(IRREGULAR.replace("at ( 40 ,80 )", "at ( 40 ,80 ) facing east"));
  });

  it("ignores entities that do not exist and an empty list", () => {
    const { session, notifications } = createSession(IRREGULAR);
    session.commands.rotateEntities([], "clockwise");
    session.commands.rotateEntities(["nope"], "clockwise");
    session.commands.faceEntities(["nope"], "north");
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, error: null });
    const before = notifications();
    session.commands.rotateEntities(["nope", idOf(session, "gate"), idOf(session, "gate")], "clockwise");
    expect(session.state.source).toBe(IRREGULAR.replace("gate at (300, 80)", "gate at (300, 80) facing south"));
    expect(notifications()).toBe(before + 1);
  });

  it("does nothing while the source has errors", () => {
    const { session } = createSession(IRREGULAR);
    const id = idOf(session, "gate");
    replaceText(session, "< 10", "<");
    expect(session.state.editable).toBe(false);
    const broken = session.state.source;
    session.commands.rotateEntities([id], "clockwise");
    session.commands.faceEntities([id], "north");
    expect(session.state.source).toBe(broken);
    replaceText(session, "virtual:signal-A <", "virtual:signal-A < 10");
    session.commands.rotateEntities([id], "clockwise");
    expect(facingOf(entityNamed(session, "gate"))).toBe("south");
  });

  it("follows a direction typed into the source", () => {
    const { session } = createSession(IRREGULAR);
    replaceText(session, "gate at (300, 80)", "gate at (300, 80) facing north");
    expect(facingOf(entityNamed(session, "gate"))).toBe("north");
    session.commands.rotateEntities([idOf(session, "gate")], "clockwise");
    expect(session.state.source).toContain("gate at (300, 80) facing east {");
  });

  it("keeps a running simulation: the direction is no part of what the circuit computes", () => {
    const { session } = createSession(STARTER_SOURCE);
    for (let i = 0; i < 5; i++) session.commands.step();
    const { tick } = session.state.simulation;
    expect(tick).toBe(5);
    const status = session.state.simulation.entityStatus.get(idOf(session, "gate"));
    session.commands.rotateEntities(session.state.circuit.entities.map((entity) => entity.id), "clockwise");
    expect(session.state.simulation.tick).toBe(tick);
    expect(session.state.simulation.entityStatus.get(idOf(session, "gate"))).toEqual(status);
  });

  it("copies and pastes the direction with the entity", () => {
    const { session } = createSession(IRREGULAR);
    const id = idOf(session, "gate");
    session.commands.rotateEntities([id], "counterclockwise");
    const text = session.commands.copyEntities([id]);
    expect(text).toContain("facing north");
    session.commands.pasteEntities(text);
    expect(facingOf(entityNamed(session, "gate2"))).toBe("north");
    expect(session.state.source).toContain("decider gate2 at (340, 120) facing north {");
  });

  it("drops a pending inspector draft of an entity that is turned, like any other change of its declaration", () => {
    const { session } = createSession(IRREGULAR);
    const gate = entityNamed(session, "gate");
    if (gate.kind !== "decider") throw new Error("gate is a decider");
    session.commands.select([gate.id]);
    const { first: _first, ...withoutSignal } = gate.conditions[0]!;
    session.commands.updateEntity({ ...gate, conditions: [withoutSignal] });
    expect(session.state.draft).not.toBeNull();
    session.commands.rotateEntities([gate.id], "clockwise");
    expect(facingOf(entityNamed(session, "gate"))).toBe("south");
    expect(session.state.draft).toBeNull();
    // A later settings edit keeps the direction.
    const turned = entityNamed(session, "gate");
    if (turned.kind !== "decider") throw new Error("gate is a decider");
    session.commands.updateEntity({ ...turned, placement: undefined, conditions: [{ ...turned.conditions[0]!, second: { type: "constant", value: 12 } }] });
    expect(session.state.source).toContain("gate at (300, 80) facing south {");
    expect(session.state.source).toContain("< 12");
  });
});
