// Inspector edits: configurations the language cannot write yet stay a draft, and typing in a field is one undo step.
import { BOTH_NETWORKS, signal, wildcardSignal, type ArithmeticCombinator, type Condition, type DeciderCombinator, type Entity, type Lamp, type SelectorCombinator } from "@face/model";
import { describe, expect, it } from "vitest";
import { checkDraft, normalizeEntity } from "../../src/session/drafts.ts";
import { createSession, entityNamed, idOf, IRREGULAR, type } from "./helpers.ts";

const A = signal("virtual", "signal-A");
const B = signal("virtual", "signal-B");

function decider(session: ReturnType<typeof createSession>["session"]): DeciderCombinator {
  return entityNamed(session, "gate") as DeciderCombinator;
}

describe("inspector drafts", () => {
  it("writes a decider condition whose signal is emptied with 0 on its left side: the empty slot is no draft", () => {
    const { session } = createSession(IRREGULAR);
    const gate = decider(session);
    session.commands.select([gate.id]);

    // The user clears the signal field of the condition, which read the red network only.
    session.commands.updateEntity({ ...gate, conditions: [{ ...gate.conditions[0]!, firstNetworks: { red: true, green: false } }] });
    const { first: _first, ...blank } = decider(session).conditions[0]!;
    session.commands.updateEntity({ ...decider(session), conditions: [blank] });
    expect(session.state.draft).toBeNull();
    expect(session.state.error).toBeNull();
    const written = IRREGULAR.replace("when virtual:signal-A < 10   // limit", "when 0 < 10   // limit");
    expect(session.state.source).toBe(written);
    // The condition stays in the circuit, without a signal, and the empty slot has both networks.
    expect(decider(session).conditions).toEqual([{ join: "or", firstNetworks: BOTH_NETWORKS, comparator: "<", second: { type: "constant", value: 10 } }]);
    expect(session.state.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    // It is edited like any other, next to others and with a signal on its right side.
    const second = { join: "and" as const, firstNetworks: BOTH_NETWORKS, comparator: "=" as const, second: { type: "signal" as const, signal: B, networks: BOTH_NETWORKS } };
    session.commands.updateEntity({ ...decider(session), conditions: [{ ...decider(session).conditions[0]!, comparator: ">=" }, second] });
    expect(session.state.source).toBe(written.replace("when 0 < 10", "when 0 >= 10 and 0 = virtual:signal-B"));
    expect(decider(session).conditions.map((condition) => condition.first)).toEqual([undefined, undefined]);

    // Choosing a signal again puts it in the place of the 0.
    session.commands.updateEntity({ ...decider(session), conditions: [{ ...decider(session).conditions[0]!, first: B }, second] });
    expect(session.state.source).toBe(written.replace("when 0 < 10", "when virtual:signal-B >= 10 and 0 = virtual:signal-B"));
    for (let step = 0; step < 4; step++) session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.draft).toBeNull();
  });

  it("holds an expression without output signal until one is chosen", () => {
    const { session } = createSession('circuit "c" {\n  arithmetic-combinator sum at (0, 0) {\n  }\n}\n');
    const sum = entityNamed(session, "sum") as ArithmeticCombinator;
    session.commands.select([sum.id]);
    session.commands.updateEntity({ ...sum, first: { type: "signal", signal: A, networks: BOTH_NETWORKS }, operation: "+" });
    expect(session.state.draft?.message).toBe("Choose an output signal to complete the expression.");
    expect(session.state.canUndo).toBe(false);
    session.commands.updateEntity({ ...(session.state.draft!.entity as ArithmeticCombinator), second: { type: "constant", value: 1 } });
    session.commands.updateEntity({ ...(session.state.draft!.entity as ArithmeticCombinator), output: A });
    expect(session.state.draft).toBeNull();
    expect(session.state.source).toContain("virtual:signal-A = virtual:signal-A + 1");
    expect(session.state.diagnostics).toEqual([]);
  });

  it("explains edits the language rejects, such as a signal twice in one section or a misplaced wildcard", () => {
    const { session } = createSession(IRREGULAR);
    const src = entityNamed(session, "src");
    if (src.kind !== "constant") throw new Error("src is a constant");
    session.commands.select([src.id]);
    session.commands.updateEntity({ ...src, sections: [{ ...src.sections[0]!, filters: [...src.sections[0]!.filters, { signal: A, count: 2 }] }] });
    expect(session.state.draft?.message).toMatch(/more than once/);
    expect(session.state).toMatchObject({ source: IRREGULAR, error: null });
    const draft = session.state.draft!.entity;
    if (draft.kind !== "constant") throw new Error("draft is a constant");
    session.commands.updateEntity({ ...draft, sections: [{ ...draft.sections[0]!, filters: [draft.sections[0]!.filters[0]!, { signal: B, count: 2 }] }] });
    expect(session.state.draft).toBeNull();
    expect(session.state.source).toContain("virtual:signal-B = 2");

    expect(checkDraft({ id: "x", name: "a", position: { x: 0, y: 0 }, kind: "arithmetic", prototype: "arithmetic-combinator", first: { type: "constant", value: 0 }, operation: "*", second: { type: "constant", value: 0 }, output: wildcardSignal("each") })).toMatchObject({ ok: false, code: "invalid-entity", message: expect.stringContaining("each") });
  });

  it("drops the draft when the selection moves on, when it is discarded, or when the entity changes underneath it", () => {
    const { session } = createSession(IRREGULAR);
    // A lamp condition that loses its signal while something else of it changes is a draft (a decider condition is written with 0).
    const makeDraft = (): void => {
      const light = entityNamed(session, "light") as Lamp;
      session.commands.select([light.id]);
      session.commands.updateEntity({ ...light, condition: { comparator: ">=", second: { type: "constant", value: 3 } } });
      expect(session.state.draft).not.toBeNull();
    };
    makeDraft();
    session.commands.select([idOf(session, "gate")]);
    expect(session.state.draft).toBeNull();
    session.commands.select([idOf(session, "light")]);
    expect(session.state.draft).toBeNull();

    makeDraft();
    session.commands.discardDraft();
    expect(session.state.draft).toBeNull();

    // Another entity changing does not disturb it; its own entity changing in the source does.
    makeDraft();
    session.commands.moveEntities([{ id: idOf(session, "gate"), position: { x: 600, y: 100 } }]);
    expect(session.state.draft).not.toBeNull();
    type(session, session.state.source.indexOf("> 3") + 3, "0");
    expect(session.state.draft).toBeNull();
    expect(session.state.source).toContain("> 30");
  });

  it("a draft never overrides a later move or rename of its entity", () => {
    const { session } = createSession(IRREGULAR);
    const gate = decider(session);
    session.commands.select([gate.id]);
    // The form still holds the entity as it was before the move.
    session.commands.moveEntities([{ id: gate.id, position: { x: 400, y: 200 } }]);
    session.commands.renameEntity(gate.id, "counter");
    session.commands.updateEntity({ ...gate, conditions: [{ ...gate.conditions[0]!, comparator: ">" }] });
    expect(entityNamed(session, "counter")).toMatchObject({ position: { x: 400, y: 200 }, conditions: [{ comparator: ">" }] });
  });

  it("sets fields without meaning to what the language implies instead of holding the edit back", () => {
    const base = { id: "x", name: "a", position: { x: 0, y: 0 } };
    const red = { red: true, green: false };
    const copy = { signal: A, copyCountFromInput: true, constant: 5, networks: red };
    const fixed = { signal: A, copyCountFromInput: false, constant: 5, networks: red };
    const d: DeciderCombinator = { ...base, kind: "decider", prototype: "decider-combinator", conditions: [{ join: "and", first: A, firstNetworks: BOTH_NETWORKS, comparator: ">", second: { type: "constant", value: 0 } }], outputs: [copy, fixed], elseOutputs: [fixed] };
    expect(checkDraft(d).ok).toBe(false);
    const normal = normalizeEntity(d) as DeciderCombinator;
    expect(normal.conditions[0]!.join).toBe("or");
    expect(normal.outputs).toEqual([{ ...copy, constant: 1 }, { ...fixed, networks: BOTH_NETWORKS }]);
    expect(normal.elseOutputs).toEqual([{ ...fixed, networks: BOTH_NETWORKS }]);
    expect(checkDraft(normal)).toEqual({ ok: true });
    expect(normalizeEntity(normal)).toBe(normal);

    const s: SelectorCombinator = { ...base, kind: "selector", prototype: "selector-combinator", mode: { operation: "select", max: true, index: { type: "signal", signal: A, networks: red }, indexComparator: "=" } };
    expect(checkDraft(normalizeEntity(s))).toEqual({ ok: true });
    expect(checkDraft(normalizeEntity({ ...base, kind: "selector", prototype: "selector-combinator", mode: { operation: "quality-filter" } }))).toEqual({ ok: true });
    const l: Lamp = { ...base, kind: "lamp", prototype: "small-lamp", inputNetworks: BOTH_NETWORKS, alwaysOn: false, useColors: false, colorMode: "components" };
    expect(checkDraft(l).ok).toBe(false);
    expect(checkDraft(normalizeEntity(l))).toEqual({ ok: true });
    expect(checkDraft({ ...l, condition: { comparator: ">", second: { type: "constant", value: 0 } } })).toMatchObject({ ok: false, message: "The light condition needs a signal." });

    // A decider condition without a signal is complete; the network selection of its empty slot says nothing and is set to both.
    const blank: DeciderCombinator = { ...normal, conditions: [{ join: "or", firstNetworks: red, comparator: "=", second: { type: "constant", value: 0 } }, { ...normal.conditions[0]!, join: "and", firstNetworks: red }] };
    expect(checkDraft(blank)).toMatchObject({ ok: false, code: "unrepresentable" });
    const written = normalizeEntity(blank) as DeciderCombinator;
    expect(written.conditions).toEqual([{ join: "or", firstNetworks: BOTH_NETWORKS, comparator: "=", second: { type: "constant", value: 0 } }, { ...normal.conditions[0]!, join: "and", firstNetworks: red }]);
    expect(written.conditions[1]).toBe(blank.conditions[1]);
    expect(checkDraft(written)).toEqual({ ok: true });
    expect(normalizeEntity(written)).toBe(written);
  });

  it("writes a selection of neither input network as none instead of holding it back", () => {
    const { session } = createSession(IRREGULAR);
    const none = { red: false, green: false };
    const gate = decider(session);
    session.commands.updateEntity({ ...gate, conditions: [{ ...gate.conditions[0]!, firstNetworks: none }], outputs: [{ ...gate.outputs[0]!, networks: none }] });
    expect(session.state.draft).toBeNull();
    expect(session.state.error).toBeNull();
    const written = IRREGULAR.replace("when virtual:signal-A < 10   // limit", "when virtual:signal-A[none] < 10   // limit").replace("output virtual:signal-A = input", "output virtual:signal-A = input[none]");
    expect(session.state.source).toBe(written);
    expect(decider(session)).toMatchObject({ conditions: [{ firstNetworks: none }], outputs: [{ networks: none }] });

    session.commands.updateEntity({ ...(entityNamed(session, "light") as Lamp), inputNetworks: none });
    expect(session.state.source).toBe(written.replace("{ when virtual:signal-A > 3 }", "{ when virtual:signal-A > 3 networks = none }"));
    expect((entityNamed(session, "light") as Lamp).inputNetworks).toEqual(none);
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["duplicate-wire"]);

    session.commands.undo();
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    session.commands.redo();
    expect(session.state.source).toBe(written);
  });

  it("writes a normalized edit through the session", () => {
    const { session } = createSession(IRREGULAR);
    const gate = decider(session);
    session.commands.updateEntity({ ...gate, outputs: [{ ...gate.outputs[0]!, copyCountFromInput: false, constant: 5, networks: { red: true, green: false } }] });
    expect(session.state.draft).toBeNull();
    expect(session.state.source).toContain("output virtual:signal-A = 5");
    // Switching back to the input count needs no manual reset of the constant.
    const again = decider(session);
    session.commands.updateEntity({ ...again, outputs: [{ ...again.outputs[0]!, copyCountFromInput: true }] });
    expect(session.state.source).toBe(IRREGULAR);
  });
});

describe("coherent undo steps for field edits", () => {
  const setLimit = (session: ReturnType<typeof createSession>["session"], value: number, coalesce?: string): void => {
    const gate = decider(session);
    session.commands.updateEntity({ ...gate, conditions: [{ ...gate.conditions[0]!, second: { type: "constant", value } }] } as Entity, coalesce === undefined ? undefined : { coalesce });
  };
  const limit = (session: ReturnType<typeof createSession>["session"]): number => {
    const second = decider(session).conditions[0]!.second;
    return second.type === "constant" ? second.value : Number.NaN;
  };

  it("merges the keystrokes of one field focus into one undo step", () => {
    const { session } = createSession(IRREGULAR);
    // Typing "1234" over "10": every intermediate value is live, one undo takes all of it back.
    for (const value of [1, 12, 123, 1234]) setLimit(session, value, "gate:1");
    expect(limit(session)).toBe(1234);
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
    expect(session.state.canUndo).toBe(false);
    session.commands.redo();
    expect(limit(session)).toBe(1234);
  });

  it("starts a new step for another focus, for edits without a key and after anything else touched the document", () => {
    const { session } = createSession(IRREGULAR);
    setLimit(session, 1, "gate:1");
    setLimit(session, 12, "gate:1");
    setLimit(session, 5, "gate:2");
    setLimit(session, 6);
    setLimit(session, 7);
    const steps: number[] = [];
    while (session.state.canUndo) {
      session.commands.undo();
      steps.push(limit(session));
    }
    expect(steps).toEqual([6, 5, 12, 10]);

    // An undo, a canvas edit or typing in between ends the run.
    setLimit(session, 1, "k");
    session.commands.moveEntities([{ id: idOf(session, "light"), position: { x: 0, y: 0 } }]);
    setLimit(session, 12, "k");
    session.commands.undo();
    expect(limit(session)).toBe(1);
    session.commands.undo();
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);

    setLimit(session, 1, "k");
    session.commands.undo();
    session.commands.redo();
    setLimit(session, 12, "k");
    session.commands.undo();
    expect(limit(session)).toBe(1);
  });

  it("a draft in the middle of typing does not break the step", () => {
    const { session } = createSession(IRREGULAR);
    const light = entityNamed(session, "light") as Lamp;
    const condition = light.condition as Condition;
    session.commands.select([light.id]);
    // The signal text is retyped: valid, cleared with another comparator (a draft), valid again, all within one focus.
    session.commands.updateEntity({ ...light, condition: { ...condition, first: B } }, { coalesce: "light:9" });
    session.commands.updateEntity({ ...light, condition: { comparator: "<", second: condition.second } }, { coalesce: "light:9" });
    expect(session.state.draft).not.toBeNull();
    session.commands.updateEntity({ ...light, condition: { ...condition, first: signal("virtual", "signal-C") } }, { coalesce: "light:9" });
    expect(session.state.draft).toBeNull();
    expect(session.state.source).toContain("when virtual:signal-C > 3");
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
  });

  it("a decider signal that is retyped is one step, with the empty slot written in between", () => {
    const { session } = createSession(IRREGULAR);
    const gate = decider(session);
    session.commands.select([gate.id]);
    session.commands.updateEntity({ ...gate, conditions: [{ ...gate.conditions[0]!, first: B }] }, { coalesce: "gate:9" });
    const { first: _first, ...blank } = gate.conditions[0]!;
    session.commands.updateEntity({ ...gate, conditions: [blank] }, { coalesce: "gate:9" });
    expect(session.state.draft).toBeNull();
    expect(session.state.source).toContain("when 0 < 10");
    session.commands.updateEntity({ ...gate, conditions: [{ ...gate.conditions[0]!, first: signal("virtual", "signal-C") }] }, { coalesce: "gate:9" });
    expect(session.state.source).toContain("when virtual:signal-C < 10");
    session.commands.undo();
    expect(session.state.source).toBe(IRREGULAR);
  });
});
