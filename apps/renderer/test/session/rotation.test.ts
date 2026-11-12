// Rotating entities: the `facing` clause is the only thing that changes, a selection turns as one undo step.
import { describe, expect, it } from "vitest";
import { facingOf } from "../../src/entities/facing.ts";
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
    session.commands.rotateEntities([idOf(session, "light")], "counterclockwise");
    expect(session.state.source).toBe(IRREGULAR.replace("light at (560,   80)", "light at (560,   80) facing north"));
    expect(entityNamed(session, "light").placement).toEqual({ direction: "north" });
    session.commands.rotateEntities([idOf(session, "light")], "counterclockwise");
    expect(facingOf(entityNamed(session, "light"))).toBe("west");
  });

  it("turns every entity of a selection in place, each from its own direction, as one undo step", () => {
    const start = IRREGULAR.replace("gate at (300, 80)", "gate at (300, 80) facing north");
    const { session } = createSession(start);
    const ids = ["src", "gate", "light"].map((name) => idOf(session, name));
    const positions = session.state.circuit.entities.map((entity) => entity.position);
    session.commands.select(ids);
    session.commands.rotateEntities(ids, "clockwise");
    expect(session.state.source).toBe(start.replace("at ( 40 ,80 )", "at ( 40 ,80 ) facing south").replace("facing north", "facing east").replace("at (560,   80)", "at (560,   80) facing south"));
    expect(session.state.circuit.entities.map(facingOf)).toEqual(["south", "east", "south"]);
    // In place: no position changes, the wires and the selection stay, the comments too.
    expect(session.state.circuit.entities.map((entity) => entity.position)).toEqual(positions);
    expect(session.state.circuit.wires).toHaveLength(3);
    expect(session.state.selection).toEqual(ids);

    session.commands.undo();
    expect(session.state.source).toBe(start);
    expect(session.state.canUndo).toBe(false);
    expect(session.state.selection).toEqual(ids);
    session.commands.redo();
    expect(session.state.circuit.entities.map(facingOf)).toEqual(["south", "east", "south"]);
    expect(session.state.canRedo).toBe(false);
  });

  it("makes entities face a direction, leaves those alone that face it already and makes no step out of nothing", () => {
    const { session } = createSession(IRREGULAR);
    const ids = session.state.circuit.entities.map((entity) => entity.id);
    session.commands.faceEntities(ids, "east");
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, error: null });
    session.commands.faceEntities([ids[0]!], "west");
    session.commands.faceEntities(ids, "west");
    expect(session.state.circuit.entities.map(facingOf)).toEqual(["west", "west", "west"]);
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
