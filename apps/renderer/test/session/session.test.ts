// The session as owner of document, analysis and view state: invalid drafts, stale results, mode switches, editor support.
import { forEachDiagnostic } from "@codemirror/lint";
import { analyze } from "@face/language";
import { describe, expect, it } from "vitest";
import { firstRangeAfter } from "../../src/editor/tokenHighlight.ts";
import { Analysis } from "../../src/session/analysis.ts";
import { highlightTokens } from "../../src/session/editorSupport.ts";
import { EXAMPLE_SOURCE } from "../fixtures/example.ts";
import { createSession, entityNamed, errorsOf, idOf, IRREGULAR, replaceText, type } from "./helpers.ts";

describe("invalid source", () => {
  it("keeps the last valid circuit, blocks commands and simulation, and recovers", () => {
    const { session } = createSession(IRREGULAR);
    const valid = session.state.circuit;
    const gate = idOf(session, "gate");
    session.commands.select([gate]);
    session.commands.step();
    session.commands.step();
    expect(session.state.simulation).toMatchObject({ available: true, tick: 2 });

    replaceText(session, "when virtual:signal-A < 10", "when virtual:signal-A < ");
    const broken = session.state.source;
    expect(errorsOf(session)).toContain("syntax-error");
    expect(session.state.editable).toBe(false);
    expect(session.state.circuit).toBe(valid);
    expect(session.state.selection).toEqual([gate]);
    expect(session.state.simulation).toMatchObject({ available: false, running: false, tick: 2 });
    expect(session.state.simulation.notice).toMatch(/Paused: \d+ errors? in the source/);

    // Nothing graphical changes the text or the history while it is broken.
    const before = session.document.version;
    session.commands.moveEntities([{ id: gate, position: { x: 0, y: 0 } }]);
    session.commands.renameEntity(gate, "other");
    session.commands.deleteEntities([gate]);
    session.commands.placeEntity("lamp", { x: 0, y: 0 });
    session.commands.addWire({ color: "green", a: { entity: gate, side: "out" }, b: { entity: idOf(session, "light"), side: "in" } });
    session.commands.updateEntity({ ...entityNamed(session, "light"), alwaysOn: true } as never);
    session.commands.step();
    session.commands.run();
    expect(session.state.source).toBe(broken);
    expect(session.document.version).toBe(before);
    expect(session.state.simulation).toMatchObject({ running: false, tick: 2 });
    expect(session.state).toMatchObject({ error: null, draft: null });

    // Typing the missing number makes everything work again; the entity kept its id and the semantic change resets the tick.
    type(session, session.state.source.indexOf("< ") + 2, "7");
    expect(errorsOf(session)).toEqual([]);
    expect(session.state.editable).toBe(true);
    expect(session.state.circuit).not.toBe(valid);
    expect(entityNamed(session, "gate").id).toBe(gate);
    expect(session.state.selection).toEqual([gate]);
    expect(session.state.simulation).toMatchObject({ available: true, tick: 0, notice: undefined });
    session.commands.moveEntities([{ id: gate, position: { x: 0, y: 0 } }]);
    expect(entityNamed(session, "gate").position).toEqual({ x: 0, y: 0 });
  });

  it("recovering to the same circuit keeps the simulation where it was", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.step();
    session.commands.step();
    session.commands.step();
    type(session, session.state.source.length, "garbage");
    expect(session.state.simulation.available).toBe(false);
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.simulation).toMatchObject({ available: true, tick: 3 });
  });

  it("resumes a running simulation when the source is valid again", () => {
    const { session, scheduler } = createSession(IRREGULAR);
    session.commands.run();
    scheduler.fire(2);
    expect(session.state.simulation).toMatchObject({ running: true, tick: 2 });
    type(session, session.state.source.length, "garbage");
    expect(scheduler.timers).toHaveLength(0);
    expect(session.state.simulation.running).toBe(false);
    session.commands.undo();
    expect(session.state.simulation.running).toBe(true);
    scheduler.fire();
    expect(session.state.simulation.tick).toBe(3);
  });

  it("shows a project that starts with errors as text, with an empty canvas", () => {
    const { session } = createSession('circuit "Broken" {\n  lamp a at (0, 0) {\n');
    expect(session.state).toMatchObject({ editable: false, canUndo: false });
    expect(session.state.circuit.entities).toEqual([]);
    expect(session.state.simulation.available).toBe(false);
    type(session, session.state.source.length, "  }\n}\n");
    expect(session.state.editable).toBe(true);
    expect(session.state.circuit.entities.map((entity) => entity.name)).toEqual(["a"]);
  });

  it("reports diagnostics with lines, in the state and in the editor", () => {
    const { session } = createSession(IRREGULAR);
    const shown = (): { from: number; to: number; severity: string; message: string }[] => {
      const list: { from: number; to: number; severity: string; message: string }[] = [];
      forEachDiagnostic(session.document.state, (diagnostic, from, to) => list.push({ from, to, severity: diagnostic.severity, message: diagnostic.message }));
      return list;
    };
    // The reversed duplicate wire is a warning from the start.
    expect(session.state.diagnostics).toMatchObject([{ severity: "warning", code: "duplicate-wire", line: 14 }]);
    expect(shown()).toMatchObject([{ severity: "warning", from: session.state.diagnostics[0]!.from }]);

    replaceText(session, "lamp light", "lamp gate");
    expect(session.state.diagnostics.map((diagnostic) => [diagnostic.severity, diagnostic.code, diagnostic.line])).toEqual([
      ["error", "duplicate-entity", 10],
      ["warning", "duplicate-wire", 14],
      ["error", "unknown-entity", 15],
    ]);
    expect(shown().map((diagnostic) => diagnostic.severity)).toEqual(["error", "warning", "error"]);
    // Showing diagnostics is not an edit.
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
    expect(shown()).toHaveLength(1);
  });
});

describe("version guard", () => {
  it("ignores an analysis result that answers an older request", () => {
    const analysis = new Analysis();
    const first = analysis.request(EXAMPLE_SOURCE, 1, undefined);
    const second = analysis.request(IRREGULAR, 2, undefined);
    expect(analysis.accept(first)).toBe(false);
    expect(analysis.parse).toBeUndefined();
    expect(analysis.isCurrent(2)).toBe(false);
    expect(analysis.accept(second)).toBe(true);
    expect(analysis.circuit.name).toBe("Irregular");
    expect(analysis.isCurrent(2)).toBe(true);
    expect(analysis.isCurrent(1)).toBe(false);
    // Delivering the old result late changes nothing.
    expect(analysis.accept(first)).toBe(false);
    expect(analysis.circuit.name).toBe("Irregular");
  });

  it("a stale result delivered to the session never replaces a newer draft", () => {
    const { session, notifications } = createSession(IRREGULAR);
    const stale = analyze(EXAMPLE_SOURCE, undefined, { version: 1 });
    type(session, 0, "// newer\n");
    const state = session.state;
    const count = notifications();
    expect(session.acceptAnalysis(stale)).toBe(false);
    expect(session.state).toBe(state);
    expect(session.state.circuit.name).toBe("Irregular");
    expect(notifications()).toBe(count);
    // Not even a result that happens to carry a future number is taken without having been requested.
    expect(session.acceptAnalysis(analyze(EXAMPLE_SOURCE, undefined, { version: 999 }))).toBe(false);
    expect(session.state.circuit.name).toBe("Irregular");
  });
});

describe("state that belongs to the session, not to a view", () => {
  it("mode switches keep document, history, selection and tick", () => {
    const { session } = createSession(IRREGULAR);
    const gate = idOf(session, "gate");
    session.commands.select([gate]);
    session.commands.moveEntities([{ id: gate, position: { x: 320, y: 80 } }]);
    session.commands.step();
    session.commands.step();
    const document = session.document.state;
    const { source, circuit, selection, simulation } = session.state;

    for (const mode of ["source", "split", "circuit", "source"] as const) {
      session.commands.setMode(mode);
      expect(session.state.mode).toBe(mode);
      expect(session.document.state).toBe(document);
      expect(session.state).toMatchObject({ source, canUndo: true, canRedo: false });
      expect(session.state.circuit).toBe(circuit);
      expect(session.state.selection).toBe(selection);
      expect(session.state.simulation).toBe(simulation);
    }
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.simulation.tick).toBe(2);
  });

  it("works identically with and without an attached view, and hands the state to a view that attaches later", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 320, y: 80 } }]);
    const updates: number[] = [];
    let state = session.document.state;
    // The part of EditorView the document uses.
    const view = { get state() { return state; }, setState: (next: typeof state) => void (state = next), update: (transactions: readonly { state: typeof state }[]) => { state = transactions.at(-1)!.state; updates.push(transactions.length); } };
    const detach = session.getController().editor.attach(view as never);
    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 340, y: 80 } }]);
    // The edit, then the diagnostics of the new text (this document has a warning).
    expect(updates).toEqual([1, 1]);
    expect(state).toBe(session.document.state);
    detach();
    session.commands.undo();
    session.commands.undo();
    expect(updates).toEqual([1, 1]);
    expect(session.state.source).toBe(IRREGULAR);
  });

  it("selection is by id, ignores unknown ids and does not notify when nothing changes", () => {
    const { session, notifications } = createSession(IRREGULAR);
    const gate = idOf(session, "gate");
    session.commands.select([gate, "nope", gate]);
    expect(session.state.selection).toEqual([gate]);
    const count = notifications();
    const state = session.state;
    session.commands.select([gate]);
    session.commands.setMode("circuit");
    session.commands.setTool({ type: "select" });
    session.commands.dismissError();
    expect(notifications()).toBe(count);
    expect(session.state).toBe(state);
  });

  it("a caret placed by the user inside a declaration selects that entity", () => {
    const { session } = createSession(IRREGULAR);
    const offset = session.state.source.indexOf("output virtual:signal-A");
    session.document.dispatch({ selection: { anchor: offset }, userEvent: "select.pointer" });
    expect(session.state.selection).toEqual([idOf(session, "gate")]);
    // Between declarations the selection stays; a programmatic caret move does not select.
    session.document.dispatch({ selection: { anchor: 3 }, userEvent: "select.pointer" });
    expect(session.state.selection).toEqual([idOf(session, "gate")]);
    session.document.dispatch({ selection: { anchor: session.state.source.indexOf("lamp light") + 2 } });
    expect(session.state.selection).toEqual([idOf(session, "gate")]);
    expect(session.state.canUndo).toBe(false);
  });

  it("setSource replaces the differing part as one undoable edit", () => {
    const { session } = createSession(IRREGULAR);
    session.commands.setSource(IRREGULAR.replace("(300, 80)", "(310, 90)"));
    expect(entityNamed(session, "gate").position).toEqual({ x: 310, y: 90 });
    session.commands.setSource(session.state.source);
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
  });
});

describe("editor support", () => {
  it("maps language tokens to highlight kinds", () => {
    const { session } = createSession('circuit "t" {\n  lamp a at (1, 2) { networks = red  always-on = true  when each > 3 /* c */ }\n  wire green a.in <-> a.in // x\n}\n');
    const source = session.state.source;
    const kinds = highlightTokens(session.parse!.cst.tokens).map((token) => [source.slice(token.from, token.to), token.kind]);
    expect(kinds).toEqual(expect.arrayContaining([["circuit", "keyword"], ['"t"', "string"], ["a", "identifier"], ["1", "number"], ["red", "red"], ["green", "green"], ["true", "boolean"], ["each", "wildcard"], [">", "operator"], ["{", "punctuation"], ["/* c */", "comment"], ["// x", "comment"]]));
    expect(kinds.some(([text]) => text!.trim() === "")).toBe(false);
  });

  it("finds the first highlight range in view by binary search", () => {
    const ranges = [0, 10, 20, 30].map((from) => ({ from, to: from + 5, className: "x" }));
    expect([0, 4, 5, 12, 25, 34, 35, 99].map((offset) => firstRangeAfter(ranges, offset))).toEqual([0, 0, 1, 1, 3, 3, 4, 4]);
    expect(firstRangeAfter([], 3)).toBe(0);
  });
});
