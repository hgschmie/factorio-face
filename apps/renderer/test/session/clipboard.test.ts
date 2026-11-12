// Copy, cut and paste of entities: the clipboard carries circuit text, a paste is one source patch and one undo step.
import type { Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { CLIPBOARD_TEXT_LIMIT, clipboardText, PASTE_OFFSET, pasteShift, readClipboardText } from "../../src/session/clipboard.ts";
import type { ProjectSession } from "../../src/session/projectSession.ts";
import { STARTER_SOURCE } from "../../src/session/starter.ts";
import { createSession, entityNamed, idOf, IRREGULAR, replaceText } from "./helpers.ts";

const GROUP_TEXT = `constant source at (40, 80) {
    virtual:signal-A = 1
}

decider gate at (300, 80) {
    when virtual:signal-A < 10
    output virtual:signal-A = input
}

wire red source.out <-> gate.in
wire green gate.out <-> gate.in
`;

const names = (session: ProjectSession): string[] => session.state.circuit.entities.map((entity) => entity.name);
const selected = (session: ProjectSession): string[] => session.state.circuit.entities.filter((entity) => session.state.selection.includes(entity.id)).map((entity) => entity.name);
const positions = (session: ProjectSession, ...of: string[]): Point[] => of.map((name) => entityNamed(session, name).position);
const copy = (session: ProjectSession, ...of: string[]): string => session.commands.copyEntities(of.map((name) => idOf(session, name)));

describe("clipboard text", () => {
  it("is the source of the entities and of the wires between them", () => {
    const { session } = createSession();
    expect(copy(session, "gate", "source")).toBe(GROUP_TEXT);
    expect(copy(session, "light")).toBe("lamp light at (560, 80) {\n    when virtual:signal-B > 8\n}\n");
    expect(session.commands.copyEntities([])).toBe("");
    expect(session.commands.copyEntities(["no such id"])).toBe("");
    expect(session.state).toMatchObject({ canUndo: false, error: null });
  });

  it("is read back as the same entities, and nothing else is accepted", () => {
    const { session } = createSession();
    const fragment = readClipboardText(GROUP_TEXT)!;
    expect(clipboardText({ name: "", ...fragment }, fragment.entities.map((entity) => entity.id))).toBe(GROUP_TEXT);
    expect(readClipboardText(STARTER_SOURCE)?.entities).toHaveLength(4);
    for (const text of ["", "   \n", "// a comment", "some words", "{}", "lamp a {", "wire red a.out <-> b.in", `${GROUP_TEXT}wire red gate.out <-> light.in\n`, `${copy(session, "light")}}`]) {
      expect(readClipboardText(text), text).toBeUndefined();
    }
    expect(readClipboardText(`${" ".repeat(CLIPBOARD_TEXT_LIMIT)}lamp a { }`)).toBeUndefined();
  });
});

describe("pasteShift", () => {
  const fragment = readClipboardText(GROUP_TEXT)!;
  const at = (...points: [number, number][]) => points.map(([x, y]) => ({ position: { x, y } }));

  it("leaves the group where it was copied from when that place is free", () => {
    expect(pasteShift(fragment, [])).toEqual({ x: 0, y: 0 });
    expect(pasteShift(fragment, at([40, 100], [560, 80]))).toEqual({ x: 0, y: 0 });
  });

  it("moves on by the offset until no copy sits exactly on an entity", () => {
    expect(PASTE_OFFSET).toBe(40);
    expect(pasteShift(fragment, at([40, 80], [300, 80]))).toEqual({ x: 40, y: 40 });
    expect(pasteShift(fragment, at([300, 80]))).toEqual({ x: 40, y: 40 });
    expect(pasteShift(fragment, at([40, 80], [300, 80], [80, 120], [340, 120]))).toEqual({ x: 80, y: 80 });
    expect(pasteShift(fragment, at([40, 80], [340, 120]))).toEqual({ x: 80, y: 80 });
  });

  it("puts the top-left corner of the group at the given point and keeps the shape", () => {
    expect(pasteShift(fragment, at([40, 80], [300, 80]), { x: 600, y: 400 })).toEqual({ x: 560, y: 320 });
    expect(pasteShift(fragment, [], { x: -100, y: 0 })).toEqual({ x: -140, y: -80 });
    // The corner of the group is the smallest x and the smallest y, whichever entities they belong to.
    const stairs = readClipboardText("lamp a at (100, 0) { }\nlamp b at (0, 60) { }")!;
    expect(pasteShift(stairs, [], { x: 20, y: 20 })).toEqual({ x: 20, y: 20 });
    expect(pasteShift(fragment, at([600, 400]), { x: 600, y: 400 })).toEqual({ x: 600, y: 360 });
  });
});

describe("paste", () => {
  it("inserts the group as one undo step, selects the copies and returns to the select tool", () => {
    const { session, notifications } = createSession();
    session.commands.setTool({ type: "wire", color: "red" });
    const before = notifications();
    session.commands.pasteEntities(GROUP_TEXT);
    expect(notifications()).toBe(before + 1);
    expect(names(session)).toEqual(["source", "gate", "twice", "light", "source2", "gate2"]);
    expect(selected(session)).toEqual(["source2", "gate2"]);
    expect(session.state.tool).toEqual({ type: "select" });
    expect(positions(session, "source2", "gate2")).toEqual([{ x: 80, y: 120 }, { x: 340, y: 120 }]);
    expect(session.state.circuit.wires).toHaveLength(6);
    expect(session.state.source).toBe(
      STARTER_SOURCE.replace("    wire red source.out", "    constant source2 at (80, 120) {\n        virtual:signal-A = 1\n    }\n\n    decider gate2 at (340, 120) {\n        when virtual:signal-A < 10\n        output virtual:signal-A = input\n    }\n\n    wire red source.out").replace(
        "light.in\n",
        "light.in\n    wire red source2.out <-> gate2.in\n    wire green gate2.out <-> gate2.in\n",
      ),
    );
    expect(session.state).toMatchObject({ editable: true, error: null, canUndo: true });

    session.commands.undo();
    expect(session.state.source).toBe(STARTER_SOURCE);
    expect(session.state).toMatchObject({ canUndo: false, selection: [] });
    session.commands.redo();
    expect(names(session)).toEqual(["source", "gate", "twice", "light", "source2", "gate2"]);
    expect(session.state.circuit.wires).toHaveLength(6);
    expect(session.state.canRedo).toBe(false);
  });

  it("pasting again counts the names on and never lands on an earlier copy", () => {
    const { session } = createSession();
    session.commands.pasteEntities(GROUP_TEXT);
    session.commands.pasteEntities(GROUP_TEXT);
    expect(names(session).slice(4)).toEqual(["source2", "gate2", "source3", "gate3"]);
    expect(selected(session)).toEqual(["source3", "gate3"]);
    expect(positions(session, "source3", "gate3")).toEqual([{ x: 120, y: 160 }, { x: 380, y: 160 }]);
    // A copy of the copy is one more step away.
    session.commands.pasteEntities(copy(session, "source3", "gate3"));
    expect(names(session).slice(8)).toEqual(["source4", "gate4"]);
    expect(positions(session, "source4")).toEqual([{ x: 160, y: 200 }]);
    session.commands.undo();
    session.commands.undo();
    session.commands.undo();
    expect(session.state.source).toBe(STARTER_SOURCE);
  });

  it("places the group with its corner at the given point", () => {
    const { session } = createSession();
    session.commands.pasteEntities(GROUP_TEXT, { x: 600, y: 400 });
    expect(positions(session, "source2", "gate2")).toEqual([{ x: 600, y: 400 }, { x: 860, y: 400 }]);
    // The same place again: the second copy does not cover the first.
    session.commands.pasteEntities(GROUP_TEXT, { x: 600, y: 400 });
    expect(positions(session, "source3", "gate3")).toEqual([{ x: 640, y: 440 }, { x: 900, y: 440 }]);
  });

  it("gives the copies ids of their own, so they are new to the simulation, and keeps the running state", () => {
    const { session } = createSession();
    const ids = session.state.circuit.entities.map((entity) => entity.id);
    session.commands.step();
    session.commands.step();
    session.commands.pasteEntities(GROUP_TEXT);
    expect(session.state.circuit.entities.slice(0, 4).map((entity) => entity.id)).toEqual(ids);
    expect(new Set(session.state.circuit.entities.map((entity) => entity.id)).size).toBe(6);
    // The circuit changed, so the simulation starts over; the copies run like their originals.
    expect(session.state.simulation.tick).toBe(0);
    session.commands.step();
    session.commands.step();
    session.commands.step();
    const label = (name: string) => session.state.simulation.entityStatus.get(idOf(session, name))?.label;
    expect(label("gate2")).toBe(label("gate"));
    expect(label("gate2")).toBe("A 3");
  });

  it("drops the tile, keeps everything else and writes with the indentation of the file", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.pasteEntities('decider gate at (300, 80) tile (4, 2.5) facing south {\n    description = "two\\nlines"\n    when each > 1\n    output each = input[red]\n}\nlamp src at (0, 0) {\n}\nwire red gate.out <-> src.in\n');
    expect(session.state.source).toBe(
      IRREGULAR.replace(
        "\n  wire red src.out",
        '\tdecider gate2 at (340, 120) facing south {\n\t\tdescription = "two\\nlines"\n\t\twhen each > 1\n\t\toutput each = input[red]\n\t}\n\tlamp src2 at (40, 40) {\n\t}\n\n  wire red src.out',
      ).replace("light.in\n", "light.in\n\twire red gate2.out <-> src2.in\n"),
    );
    expect(entityNamed(session, "gate2")).toMatchObject({ placement: { direction: "south" }, description: "two\nlines" });
    expect(entityNamed(session, "gate2").placement).not.toHaveProperty("tile");
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
  });

  it("ignores text that is not a fragment with a notice, and never pastes a part of it", () => {
    const { session } = createSession();
    for (const text of ["", "hello", "https://example.org", `${GROUP_TEXT}wire red gate.out <-> light.in\n`, `${GROUP_TEXT}\nlamp gate { }`, "lamp a at (1, 2) {"]) {
      session.commands.dismissError();
      session.commands.pasteEntities(text);
      expect(session.state.error, text).toMatch(/^Nothing was pasted/);
      expect(session.state.source).toBe(STARTER_SOURCE);
      expect(session.state).toMatchObject({ canUndo: false, selection: [] });
    }
  });

  it("is blocked while the source has errors; a copy still gives the circuit on show", () => {
    const { session } = createSession();
    replaceText(session, "< 10", "<");
    const broken = session.state.source;
    expect(session.state.editable).toBe(false);
    expect(copy(session, "source", "gate")).toBe(GROUP_TEXT);
    session.commands.pasteEntities(GROUP_TEXT);
    expect(session.state.source).toBe(broken);
    expect(session.state.error).toBeNull();
    expect(names(session)).toEqual(["source", "gate", "twice", "light"]);
  });
});

describe("cut", () => {
  it("is a copy and one deletion; pasting puts the group back where it was, wires inside it included", () => {
    const { session } = createSession();
    const ids = [idOf(session, "source"), idOf(session, "gate")];
    const text = session.commands.copyEntities(ids);
    session.commands.deleteEntities(ids);
    expect(names(session)).toEqual(["twice", "light"]);
    expect(session.state.circuit.wires).toHaveLength(1);

    session.commands.pasteEntities(text);
    expect(names(session)).toEqual(["twice", "light", "source", "gate"]);
    expect(selected(session)).toEqual(["source", "gate"]);
    expect(positions(session, "source", "gate")).toEqual([{ x: 40, y: 80 }, { x: 300, y: 80 }]);
    // The wire from the gate to an entity outside the cut is gone; the two inside came along.
    expect(session.state.circuit.wires).toHaveLength(3);
    expect(session.state.circuit.entities.map((entity) => entity.id)).not.toContain(ids[0]);

    session.commands.undo();
    expect(names(session)).toEqual(["twice", "light"]);
    session.commands.undo();
    expect(session.state.source).toBe(STARTER_SOURCE);
    expect(session.state.canUndo).toBe(false);
  });

  it("pastes into another project with the names that are free there", () => {
    const { session } = createSession();
    const text = copy(session, "source", "gate", "light");
    const other = createSession('circuit "Other" {\n    lamp light at (560, 80) {\n    }\n}\n').session;
    other.commands.pasteEntities(text);
    expect(names(other)).toEqual(["light", "source", "gate", "light2"]);
    expect(positions(other, "source", "gate", "light2")).toEqual([{ x: 80, y: 120 }, { x: 340, y: 120 }, { x: 600, y: 120 }]);
    expect(other.state.circuit.wires).toHaveLength(2);
    expect(other.state.diagnostics).toEqual([]);
  });
});
