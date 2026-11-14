// Graphical commands are small source patches in one transaction, and the editor history is the only undo stack.
import { describe, expect, it } from "vitest";
import { EXAMPLE_SOURCE } from "../fixtures/example.ts";
import { createSession, entityNamed, errorsOf, idOf, IRREGULAR, type } from "./helpers.ts";

describe("graphical commands as source patches", () => {
  it("starts with the example circuit, valid and without history", () => {
    const { session } = createSession();
    expect(session.state.source).toBe(EXAMPLE_SOURCE);
    expect(session.state.circuit.entities.map((entity) => entity.name)).toEqual(["source", "gate", "twice", "light"]);
    expect(session.state.circuit.wires).toHaveLength(4);
    expect(session.state).toMatchObject({ editable: true, canUndo: false, canRedo: false, diagnostics: [], selection: [] });
  });

  it("moves an entity by changing only the changed coordinate", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.moveEntities([{ id: idOf(session, "src"), position: { x: 60, y: 80 } }]);
    expect(session.state.source).toBe(IRREGULAR.replace("at ( 40 ,80 )", "at ( 60 ,80 )"));
    expect(entityNamed(session, "src").position).toEqual({ x: 60, y: 80 });
    session.commands.moveEntities([{ id: idOf(session, "light"), position: { x: 561.4, y: 100 } }]);
    expect(session.state.source).toBe(IRREGULAR.replace("at ( 40 ,80 )", "at ( 60 ,80 )").replace("at (560,   80)", "at (561,   100)"));
  });

  it("moves several entities in one undo step and ignores a move to the same place", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.moveEntities([{ id: idOf(session, "src"), position: { x: 40, y: 80 } }]);
    expect(session.state.canUndo).toBe(false);
    session.commands.moveEntities([
      { id: idOf(session, "src"), position: { x: 0, y: 0 } },
      { id: idOf(session, "gate"), position: { x: 320, y: 100 } },
    ]);
    expect(session.state.source).toBe(IRREGULAR.replace("at ( 40 ,80 )", "at ( 0 ,0 )").replace("gate at (300, 80)", "gate at (320, 100)"));
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
  });

  it("two quick moves of the same entity stay two undo steps", () => {
    const { session } = createSession(IRREGULAR);
    const id = idOf(session, "gate");
    session.commands.moveEntities([{ id, position: { x: 320, y: 80 } }]);
    session.commands.moveEntities([{ id, position: { x: 340, y: 80 } }]);
    session.commands.undo();
    expect(entityNamed(session, "gate").position).toEqual({ x: 320, y: 80 });
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
  });

  it("rewrites one statement of a configuration and leaves its comment alone", () => {
    const { session } = createSession(IRREGULAR);
    const gate = entityNamed(session, "gate");
    if (gate.kind !== "decider") throw new Error("gate is a decider");
    session.commands.updateEntity({ ...gate, conditions: [{ ...gate.conditions[0]!, second: { type: "constant", value: 12 } }] });
    expect(session.state.source).toBe(IRREGULAR.replace("when virtual:signal-A < 10   // limit", "when virtual:signal-A < 12   // limit"));
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
  });

  it("renames the declaration and every wire reference, and keeps the selection", () => {
    const { session } = createSession(IRREGULAR);
    const id = idOf(session, "gate");
    session.commands.select([id]);
    session.commands.renameEntity(id, "counter");
    expect(session.state.source).toBe(IRREGULAR.replaceAll("gate", "counter"));
    expect(session.state.selection).toEqual([id]);
    expect(entityNamed(session, "counter").id).toBe(id);
    expect(session.state.circuit.wires).toHaveLength(3);

    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.selection).toEqual([id]);
    expect(entityNamed(session, "gate").id).toBe(id);
    session.commands.redo();
    expect(session.state.source).toBe(IRREGULAR.replaceAll("gate", "counter"));
    expect(session.state.selection).toEqual([id]);
  });

  it("refuses invalid, reserved and duplicate names without touching the text", () => {
    const { session } = createSession(IRREGULAR);
    for (const [name, message] of [["2fast", /valid entity name/], ["lamp", /reserved/], ["light", /already in use/]] as const) {
      session.commands.renameEntity(idOf(session, "gate"), name);
      expect(session.state.error).toMatch(message);
      session.commands.dismissError();
    }
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state).toMatchObject({ canUndo: false, error: null });
  });

  it("deletes an entity with its incident wires in one undo step", () => {
    const { session } = createSession(IRREGULAR);
    const light = idOf(session, "light");
    session.commands.select([light]);
    session.commands.deleteEntities([light]);
    expect(session.state.source).not.toContain("light");
    expect(session.state.source).toContain("wire  green  gate.out<->gate.in");
    expect(session.state.source).toContain("// reversed duplicate");
    expect(session.state.circuit.entities.map((entity) => entity.name)).toEqual(["src", "gate"]);
    expect(session.state.circuit.wires).toHaveLength(2);
    expect(session.state.selection).toEqual([]);

    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
    expect(session.state.circuit.wires).toHaveLength(3);
  });

  it("deleting the entity in the middle removes all declarations of its wires, duplicates included", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.deleteEntities([idOf(session, "gate"), "no-such-id"]);
    expect(session.state.circuit.wires).toEqual([]);
    expect(session.state.source).not.toMatch(/wire/);
    expect(session.state.source).toContain("/* about the source */ constant   src   at ( 40 ,80 )");
    expect(errorsOf(session)).toEqual([]);
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
  });

  it("adds a wire as one line and treats an existing connection, in either direction, as a no-op without undo entry", () => {
    const { session, notifications } = createSession(IRREGULAR);
    const src = idOf(session, "src");
    const gate = idOf(session, "gate");
    const light = idOf(session, "light");
    const before = notifications();
    session.commands.addWire({ color: "red", a: { entity: src, side: "out" }, b: { entity: gate, side: "in" } });
    session.commands.addWire({ color: "red", a: { entity: gate, side: "in" }, b: { entity: src, side: "out" } });
    session.commands.addWire({ color: "green", a: { entity: gate, side: "in" }, b: { entity: gate, side: "out" } });
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
    expect(notifications()).toBe(before);

    session.commands.addWire({ color: "red", a: { entity: light, side: "in" }, b: { entity: src, side: "out" } });
    // One new line after the last member; everything else is untouched.
    expect(session.state.source.replace(/\n[ \t]*wire red light\.in <-> src\.out(?=\n\}\n$)/, "")).toBe(IRREGULAR);
    expect(session.state.source).not.toBe(IRREGULAR);
    expect(session.state.circuit.wires).toHaveLength(4);
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
  });

  it("reports a wire to a terminal the entity does not have", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.addWire({ color: "red", a: { entity: idOf(session, "src"), side: "in" }, b: { entity: idOf(session, "gate"), side: "in" } });
    expect(session.state.error).toMatch(/no 'in' terminal/);
    expect(session.state.source).toBe(IRREGULAR);
  });

  it("removes every declaration of a wire", () => {
    const { session } = createSession(IRREGULAR);
    const wire = { color: "red", a: { entity: idOf(session, "gate"), side: "in" }, b: { entity: idOf(session, "src"), side: "out" } } as const;
    session.commands.removeWire(wire);
    expect(session.state.source).not.toContain("// reversed duplicate");
    expect(session.state.source).not.toContain("wire red src.out <-> gate.in");
    expect(session.state.circuit.wires).toHaveLength(2);
    session.commands.removeWire(wire);
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
  });

  it("toggles a wire as the game does: connecting an existing wire removes it, connecting again adds it", () => {
    const { session } = createSession(IRREGULAR);
    const red = { color: "red", a: { entity: idOf(session, "gate"), side: "in" }, b: { entity: idOf(session, "src"), side: "out" } } as const;
    const colors = (): string[] => session.state.circuit.wires.map((wire) => wire.color).sort();
    expect(colors()).toEqual(["green", "green", "red"]);

    // The connection is declared twice, in both directions; one gesture removes it completely.
    session.commands.toggleWire(red);
    expect(colors()).toEqual(["green", "green"]);
    expect(session.state.source).not.toContain("wire red");

    session.commands.toggleWire(red);
    expect(colors()).toEqual(["green", "green", "red"]);

    // The other color between the same terminals is a different wire.
    session.commands.toggleWire({ ...red, color: "green" });
    expect(colors()).toEqual(["green", "green", "green", "red"]);

    for (let step = 0; step < 3; step++) session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
  });

  it("places an entity with a generated name, selects it and returns to the select tool", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.setTool({ type: "place", kind: "lamp" });
    session.commands.placeEntity("lamp", { x: 100.4, y: 300 });
    const placed = entityNamed(session, "lamp1");
    expect(placed).toMatchObject({ kind: "lamp", position: { x: 100, y: 300 } });
    expect(session.state.selection).toEqual([placed.id]);
    expect(session.state.tool).toEqual({ type: "select" });
    // Everything that was there is still there, byte for byte.
    expect(session.state.source.replace(/\n[ \t]*lamp lamp1 at \(100, 300\) \{\s*\}\n/, "\n")).toBe(IRREGULAR);
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.selection).toEqual([]);
  });

  it("places an entity facing the way the tool was turned; east is not written and a lamp does not turn", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.placeEntity("decider", { x: 100, y: 300 }, "north");
    session.commands.placeEntity("constant", { x: 100, y: 500 }, "east");
    session.commands.placeEntity("lamp", { x: 100, y: 700 }, "south");
    expect(session.state.source).toContain("decider decider1 at (100, 300) facing north {");
    expect(session.state.source).toContain("constant constant1 at (100, 500) {");
    expect(session.state.source).toContain("lamp lamp1 at (100, 700) {");
    expect(entityNamed(session, "decider1").placement).toEqual({ direction: "north" });
    expect(session.state).toMatchObject({ error: null, diagnostics: expect.not.arrayContaining([expect.objectContaining({ code: "unused-facing" })]) });
  });

  it("round trips a mixed sequence of canvas, inspector and text edits byte for byte", () => {
    const { session } = createSession(IRREGULAR);
    const texts = [session.state.source];
    const record = (): void => void texts.push(session.state.source);
    session.commands.moveEntities([{ id: idOf(session, "src"), position: { x: 20, y: 40 } }]);
    record();
    type(session, session.state.source.indexOf("// first"), "// typed by hand ");
    record();
    session.commands.renameEntity(idOf(session, "light"), "beacon");
    record();
    session.commands.placeEntity("selector", { x: 0, y: 400 });
    record();
    session.commands.addWire({ color: "green", a: { entity: idOf(session, "gate"), side: "out" }, b: { entity: idOf(session, "selector1"), side: "in" } });
    record();
    session.commands.deleteEntities([idOf(session, "gate")]);
    record();
    expect(new Set(texts).size).toBe(texts.length);

    for (let step = texts.length - 2; step >= 0; step--) {
      session.commands.undo();
      expect(session.state.source).toBe(texts[step]);
    }
    expect(session.state).toMatchObject({ canUndo: false, canRedo: true });
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    for (let step = 1; step < texts.length; step++) {
      session.commands.redo();
      expect(session.state.source).toBe(texts[step]);
    }
    expect(session.state).toMatchObject({ canUndo: true, canRedo: false, editable: true });
  });

  it("typing and canvas edits share one history but never merge into one step", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 320, y: 80 } }]);
    // Typed directly after the command, right next to the text it changed.
    const offset = session.state.source.indexOf("320") + 3;
    type(session, offset, "0");
    expect(entityNamed(session, "gate").position.x).toBe(3200);
    session.commands.undo();
    expect(entityNamed(session, "gate").position.x).toBe(320);
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
  });

  it("keeps unchanged entities and wires identical across edits", () => {
    const { session } = createSession(IRREGULAR);
    const before = session.state.circuit;
    session.commands.moveEntities([{ id: idOf(session, "src"), position: { x: 60, y: 80 } }]);
    const after = session.state.circuit;
    expect(after).not.toBe(before);
    expect(after.entities[0]).not.toBe(before.entities[0]);
    expect(after.entities[1]).toBe(before.entities[1]);
    expect(after.entities[2]).toBe(before.entities[2]);
    expect(after.wires).toBe(before.wires);
    // A comment is not part of the circuit at all.
    type(session, 0, "// more\n");
    expect(session.state.circuit).toBe(after);
  });

  it("writes a description as one source line and one undo step, and removes it when it is emptied", () => {
    const { session } = createSession(IRREGULAR);
    const text = 'counts to ten\nthen "starts" over\\\n\ttab, Grüße 日本語\r\nwindows break';
    const line = '\t\tdescription = "counts to ten\\nthen \\"starts\\" over\\\\\\n\\ttab, Grüße 日本語\\r\\nwindows break"\n';
    const described = IRREGULAR.replace("\t\twhen virtual:signal-A < 10", `${line}\t\twhen virtual:signal-A < 10`);
    session.commands.updateEntity({ ...entityNamed(session, "gate"), description: text });
    // The document splits lines at carriage returns as well: the text must not bring any into the source.
    expect(session.state.source).toBe(described);
    expect(session.state.editable).toBe(true);
    expect(entityNamed(session, "gate").description).toBe(text);

    session.commands.updateEntity({ ...entityNamed(session, "gate"), description: "short" });
    expect(session.state.source).toBe(IRREGULAR.replace("\t\twhen virtual:signal-A < 10", '\t\tdescription = "short"\n\t\twhen virtual:signal-A < 10'));
    session.commands.undo();
    expect(session.state.source).toBe(described);
    session.commands.redo();

    for (const none of ["", undefined]) {
      session.commands.updateEntity({ ...entityNamed(session, "gate"), description: none });
      expect(session.state.source).toBe(IRREGULAR);
      expect(entityNamed(session, "gate").description).toBeUndefined();
      session.commands.undo();
      expect(entityNamed(session, "gate").description).toBe("short");
    }
    session.commands.undo();
    session.commands.undo();
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, error: null });
    // Nothing to remove is no edit.
    session.commands.updateEntity({ ...entityNamed(session, "gate"), description: "" });
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false, error: null, draft: null });
  });

  it("a description typed in the source arrives in the circuit, and one in an incomplete inspector edit waits with it", () => {
    const { session } = createSession(IRREGULAR);
    type(session, IRREGULAR.indexOf("when virtual:signal-A > 3"), 'description = "lit above three\\n(second line)" ');
    expect(entityNamed(session, "light").description).toBe("lit above three\n(second line)");
    expect(session.state.editable).toBe(true);

    const gate = entityNamed(session, "gate");
    if (gate.kind !== "decider") throw new Error("gate is a decider");
    const source = session.state.source;
    session.commands.select([gate.id]);
    session.commands.updateEntity({ ...gate, conditions: [{ ...gate.conditions[0]!, first: undefined }] });
    session.commands.updateEntity({ ...session.state.draft!.entity, description: "pending" });
    expect(session.state.source).toBe(source);
    expect(session.state.draft?.entity.description).toBe("pending");
    session.commands.updateEntity({ ...gate, description: "pending" });
    expect(session.state.draft).toBeNull();
    expect(session.state.source).toBe(source.replace("\t\twhen virtual:signal-A < 10", '\t\tdescription = "pending"\n\t\twhen virtual:signal-A < 10'));
  });
});
