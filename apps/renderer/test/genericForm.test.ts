// The settings form of a generic entity as data and through the session: which settings it shows, what an edit of each field
// type makes of the entity and of the source, the prototypes an entity can become, what it keeps from a blueprint, and the lines
// and notes per prototype type.
import { loadStandardCatalog } from "@face/catalog";
import { ENTITY_SETTINGS, entityTable, PROTOTYPES, settingSpecsOf, signal, UNSET_CONDITION, type Condition, type ConditionValue, type GenericEntity, type Lamp, type SettingSpec, type SettingValue } from "@face/model";
import { describe, expect, it } from "vitest";
import { alternativePrototypes, enumOptions, incompleteCondition, keptFields, newCondition, settingValue, shownSettings, withPrototype, withSetting, wordLabel } from "../src/entities/genericSettings.ts";
import { entityDescription } from "../src/entities/kindInfo.ts";
import { entityRegistry } from "../src/entities/registry.ts";
import { conditionLines, summaryLines } from "../src/entities/summary.ts";
import { describeSettings, prototypeNotes, TYPE_DESCRIPTIONS, TYPE_NOTES, typeDescription } from "../src/entities/typeInfo.ts";
import { BLANK_CONDITION, editedCondition, shownCondition } from "../src/inspector/conditionEdits.ts";
import { checkDraft } from "../src/session/drafts.ts";
import { createSession, entityNamed, errorsOf, idOf } from "./session/helpers.ts";

const entity = (prototype: string, settings: Record<string, SettingValue> = {}, blueprintData?: string): GenericEntity => ({ id: "e1", name: "e", kind: "entity", position: { x: 0, y: 0 }, prototype, settings, ...(blueprintData !== undefined && { blueprintData }) });
const spec = (prototype: string, key: string): SettingSpec => settingSpecsOf(prototype).find((candidate) => candidate.key === key)!;
const keys = (specs: readonly SettingSpec[]): string[] => specs.map((candidate) => candidate.key);
const A = signal("virtual", "signal-A");
const IRON = signal("item", "iron-plate");

describe("which settings the form shows", () => {
  it("has the settings of the prototype type in the order of the table, without those that belong to a switch that is off", () => {
    expect(keys(shownSettings(entity("fast-inserter")))).toEqual(["when", "logistic-when", "networks", "output-networks", "set-filters", "read-hand", "set-stack-size"]);
    expect(keys(shownSettings(entity("fast-inserter", { "set-stack-size": true })))).toEqual(["when", "logistic-when", "networks", "output-networks", "set-filters", "read-hand", "set-stack-size", "stack-size-signal"]);
    // A chest reads its contents unless told otherwise; the signal of the empty slots comes with its switch.
    expect(keys(shownSettings(entity("iron-chest")))).toEqual(["output-networks", "read-contents", "read-empty-slots"]);
    expect(keys(shownSettings(entity("iron-chest", { "read-empty-slots": true })))).toEqual(["output-networks", "read-contents", "read-empty-slots", "empty-slots-signal"]);
    // A switch that is on by default shows what belongs to it until it is switched off.
    expect(keys(shownSettings(entity("accumulator")))).toEqual(["output-networks", "read-charge", "output-signal"]);
    expect(keys(shownSettings(entity("accumulator", { "read-charge": false })))).toEqual(["output-networks", "read-charge"]);
    expect(keys(shownSettings(entity("rail-chain-signal")))).toEqual(["close-when", "networks", "output-networks", "read-signal", "red-signal", "orange-signal", "green-signal", "blue-signal"]);
    expect(keys(shownSettings(entity("rail-signal", { "read-signal": false })))).toEqual(["close-when", "networks", "output-networks", "read-signal"]);
    // The channel of a radar belongs to a mode, not to a switch.
    expect(keys(shownSettings(entity("radar")))).toEqual(["mode"]);
    expect(keys(shownSettings(entity("radar", { mode: "universe" })))).toEqual(["mode", "channel"]);
    expect(keys(shownSettings(entity("assembling-machine-2", { "read-contents": true, "read-working": true })))).toEqual([
      "when", "logistic-when", "networks", "output-networks", "set-recipe", "read-contents", "include-in-crafting", "read-fuel", "read-ingredients", "read-recipe-finished", "read-working", "working-signal",
    ]);
    expect(shownSettings(entity("display-panel"))).toEqual([]);
  });

  it("names in the table only settings of the same row, for every type", () => {
    for (const [type, row] of Object.entries(ENTITY_SETTINGS)) {
      for (const candidate of row.settings) {
        if (!candidate.shownWhile) continue;
        const owner = row.settings.find((other) => other.key === candidate.shownWhile!.key);
        expect(owner, `${type} ${candidate.key}`).toBeDefined();
        expect(owner!.type === "boolean" ? typeof candidate.shownWhile.is : owner!.type === "enum" && owner!.values.some((value) => value.word === candidate.shownWhile!.is), `${type} ${candidate.key}`).toBe(owner!.type === "boolean" ? "boolean" : true);
      }
    }
  });

  it("shows the value an entity holds, else the default of a new entity of its prototype", () => {
    const chest = entity("iron-chest");
    expect(settingValue(chest, spec("iron-chest", "read-contents"))).toBe(true);
    expect(settingValue(chest, spec("iron-chest", "read-empty-slots"))).toBe(false);
    expect(settingValue(chest, spec("iron-chest", "empty-slots-signal"))).toEqual(signal("virtual", "signal-E"));
    expect(settingValue(chest, spec("iron-chest", "output-networks"))).toEqual({ red: true, green: true });
    expect(settingValue(entity("inserter"), spec("inserter", "read-hand"))).toBe("none");
    expect(settingValue(entity("inserter"), spec("inserter", "when"))).toBeUndefined();
    expect(settingValue(entity("assembling-machine-1"), spec("assembling-machine-1", "working-signal"))).toBeUndefined();
    expect(settingValue(entity("inserter", { "read-hand": "hold" }), spec("inserter", "read-hand"))).toBe("hold");
  });
});

describe("an edit of one setting", () => {
  it("holds a switch that is not at its default and drops one that is", () => {
    const chest = entity("iron-chest");
    const reading = withSetting(chest, spec("iron-chest", "read-empty-slots"), true);
    expect(reading.settings).toEqual({ "read-empty-slots": true });
    expect(withSetting(reading, spec("iron-chest", "read-empty-slots"), false).settings).toEqual({});
    // On by default: switching it off is what is written.
    expect(withSetting(chest, spec("iron-chest", "read-contents"), false).settings).toEqual({ "read-contents": false });
    expect(withSetting(entity("iron-chest", { "read-contents": false }), spec("iron-chest", "read-contents"), true).settings).toEqual({});
    expect(chest.settings).toEqual({});
  });

  it("holds a mode, a signal and a network selection the same way, in the order of the table", () => {
    let inserter = entity("fast-inserter");
    inserter = withSetting(inserter, spec("fast-inserter", "stack-size-signal"), IRON);
    inserter = withSetting(inserter, spec("fast-inserter", "read-hand"), "hold");
    inserter = withSetting(inserter, spec("fast-inserter", "networks"), { red: true, green: false });
    expect(Object.entries(inserter.settings)).toEqual([["networks", { red: true, green: false }], ["read-hand", "hold"], ["stack-size-signal", IRON]]);
    inserter = withSetting(inserter, spec("fast-inserter", "read-hand"), "none");
    inserter = withSetting(inserter, spec("fast-inserter", "networks"), { red: true, green: true });
    // The signal of the prototype is the default: choosing it, or emptying the field, writes nothing.
    expect(withSetting(inserter, spec("fast-inserter", "stack-size-signal"), signal("virtual", "signal-S")).settings).toEqual({});
    expect(withSetting(inserter, spec("fast-inserter", "stack-size-signal"), undefined).settings).toEqual({});
    // A signal without a default of the prototype is held as it is.
    expect(withSetting(entity("assembling-machine-1"), spec("assembling-machine-1", "working-signal"), A).settings).toEqual({ "working-signal": A });
    expect(withSetting(entity("iron-chest"), spec("iron-chest", "output-networks"), { red: false, green: false }).settings).toEqual({ "output-networks": { red: false, green: false } });
  });

  it("switches a condition on with the one of a new entity and off by taking it away; one without its signal is a draft", () => {
    const when = spec("inserter", "when");
    if (when.type !== "condition") throw new Error("not a condition");
    expect(newCondition(when)).toEqual({ first: A, comparator: ">", second: { type: "constant", value: 0 } });
    const left = spec("splitter", "input-left-when");
    if (left.type !== "condition") throw new Error("not a condition");
    // The game has its own condition for a side of a splitter that is switched on.
    expect(newCondition(left)).toEqual({ first: signal("virtual", "signal-I"), comparator: "<", second: { type: "constant", value: 0 } });
    const enabled = withSetting(entity("inserter"), when, newCondition(when));
    expect(enabled.settings).toEqual({ when: newCondition(when) });
    expect(checkDraft(enabled)).toEqual({ ok: true });
    expect(withSetting(enabled, when, undefined).settings).toEqual({});
    const blank: Condition = { comparator: ">", second: { type: "constant", value: 0 } };
    const draft = withSetting(enabled, when, blank);
    expect(draft.settings).toEqual({ when: blank });
    expect(incompleteCondition(draft)?.key).toBe("when");
    expect(checkDraft(draft)).toMatchObject({ ok: false, message: 'The condition "Enable/disable" needs a signal.' });
    expect(incompleteCondition(enabled)).toBeUndefined();
  });

  it("shows a condition in use without a signal as one with an empty signal, and makes it a comparison or unset again by its signal", () => {
    const when = spec("express-transport-belt", "when");
    const full: Condition = { first: IRON, comparator: ">=", second: { type: "constant", value: 100 } };
    const { first: _first, ...emptied } = full;
    expect(shownCondition(UNSET_CONDITION)).toEqual({ comparator: "<", second: { type: "constant", value: 0 } });
    expect(shownCondition(UNSET_CONDITION)).toBe(BLANK_CONDITION);
    expect(shownCondition(full)).toBe(full);
    // The signal is filled in: a comparison with what the fields showed behind it.
    expect(editedCondition(UNSET_CONDITION, { ...BLANK_CONDITION, first: A })).toEqual({ first: A, comparator: "<", second: { type: "constant", value: 0 } });
    // The signal is taken out: unset, and what stood behind it is not kept.
    expect(editedCondition(full, emptied)).toBe(UNSET_CONDITION);
    // Any other edit of a comparison is that edit.
    expect(editedCondition(full, { ...full, comparator: "<" })).toEqual({ ...full, comparator: "<" });
    // A change behind a signal that is still missing waits for the signal, as a draft; the signal then completes it.
    const waiting = editedCondition(UNSET_CONDITION, { ...BLANK_CONDITION, comparator: ">" });
    expect(waiting).toEqual({ comparator: ">", second: { type: "constant", value: 0 } });
    expect(editedCondition(waiting, { ...(waiting as Condition), second: { type: "constant", value: 7 } })).toEqual({ comparator: ">", second: { type: "constant", value: 7 } });
    expect(editedCondition(waiting, { ...(waiting as Condition), first: A })).toEqual({ first: A, comparator: ">", second: { type: "constant", value: 0 } });

    // The unset condition is complete: the entity holds it, the language writes it, and nothing asks for a signal.
    const unset = withSetting(entity("express-transport-belt"), when, UNSET_CONDITION);
    expect(unset.settings).toEqual({ when: UNSET_CONDITION });
    expect(settingValue(unset, when)).toBe(UNSET_CONDITION);
    expect(incompleteCondition(unset)).toBeUndefined();
    expect(checkDraft(unset)).toEqual({ ok: true });
    const draft = withSetting(unset, when, waiting);
    expect(incompleteCondition(draft)?.key).toBe("when");
    expect(checkDraft(draft)).toMatchObject({ ok: false, message: 'The condition "Enable/disable" needs a signal.' });
    // Switching the condition off takes it away, as any other.
    expect(withSetting(unset, when, undefined).settings).toEqual({});
    // It stays with the entity when the prototype changes, and it is no default of any.
    expect(withPrototype(unset, "transport-belt").settings).toEqual({ when: UNSET_CONDITION });
    const left = spec("splitter", "input-left-when");
    expect(withSetting(entity("splitter"), left, UNSET_CONDITION).settings).toEqual({ "input-left-when": UNSET_CONDITION });
    // A lamp has the same switch.
    const lamp: Lamp = { id: "l", name: "l", kind: "lamp", prototype: "small-lamp", position: { x: 0, y: 0 }, inputNetworks: { red: true, green: true }, alwaysOn: false, useColors: false, colorMode: "mapping", condition: UNSET_CONDITION };
    expect(checkDraft(lamp)).toEqual({ ok: true });
    expect(checkDraft({ ...lamp, condition: emptied })).toMatchObject({ ok: false, message: "The light condition needs a signal." });
  });

  it("says 'unset' on the card in the place of the comparison", () => {
    expect(summaryLines(entity("express-transport-belt", { when: UNSET_CONDITION }))).toEqual(["unset"]);
    expect(summaryLines(entity("express-transport-belt", { when: UNSET_CONDITION, "read-contents": "hold" }))).toEqual(["unset", "read-contents: hold"]);
    expect(summaryLines(entity("stone-wall", { "open-gate-when": UNSET_CONDITION }))).toEqual(["open-gate unset"]);
    expect(conditionLines(entity("agricultural-tower", { when: UNSET_CONDITION, "logistic-when": UNSET_CONDITION, "harvest-when": { first: A, comparator: ">", second: { type: "constant", value: 0 } }, "plant-when": UNSET_CONDITION }))).toEqual([
      "unset", "logistic unset", "harvest A > 0", "plant unset",
    ]);
    const lamp: Lamp = { id: "l", name: "l", kind: "lamp", prototype: "small-lamp", position: { x: 0, y: 0 }, inputNetworks: { red: true, green: true }, alwaysOn: true, useColors: false, colorMode: "mapping", condition: UNSET_CONDITION };
    expect(summaryLines(lamp)).toEqual(["unset"]);
    expect(summaryLines({ ...lamp, condition: undefined })).toEqual(["always on"]);
  });

  it("offers the modes of the table by their words", () => {
    const hand = spec("inserter", "read-hand");
    const belt = spec("transport-belt", "read-contents");
    if (hand.type !== "enum" || belt.type !== "enum") throw new Error("not a mode");
    expect(enumOptions(hand)).toEqual([{ value: "none", label: "None" }, { value: "pulse", label: "Pulse" }, { value: "hold", label: "Hold" }]);
    expect(enumOptions(belt).map((option) => option.label)).toEqual(["None", "Pulse", "Hold", "Entire belt hold"]);
    expect(wordLabel("missing-requests")).toBe("Missing requests");
  });
});

describe("through the session", () => {
  const SOURCE = `circuit "Form" {
    inserter feeder at (40, 80) tile (0.5, 0.5) {
    }

    iron-chest box at (280, 80) tile (2.5, 0.5) {
    }

    train-stop stop at (520, 80) {
        blueprint-data = "{\\"station\\":\\"Iron\\",\\"manual_trains_limit\\":2}"
    }
}
`;
  const body = (text: string, name: string): string[] => {
    const start = text.indexOf(` ${name} `);
    return text.slice(text.indexOf("{", start) + 1, text.indexOf("\n    }", start)).split("\n").map((line) => line.trim()).filter((line) => line !== "");
  };

  it("writes every field type to the source and reads it back; a default is not written, and a statement that is there says it", () => {
    const { session } = createSession(SOURCE);
    const feeder = (): GenericEntity => entityNamed(session, "feeder") as GenericEntity;
    const edit = (key: string, value: SettingValue | undefined): void => session.commands.updateEntity(withSetting(feeder(), spec("inserter", key), value));
    edit("when", { first: IRON, comparator: "<", second: { type: "constant", value: 100 } });
    edit("read-hand", "pulse");
    edit("set-filters", true);
    edit("networks", { red: true, green: false });
    edit("stack-size-signal", A);
    edit("logistic-when", { first: IRON, comparator: ">", second: { type: "signal", signal: A } });
    expect(errorsOf(session)).toEqual([]);
    expect(body(session.document.text, "feeder")).toEqual([
      "when item:iron-plate < 100", "logistic when item:iron-plate > virtual:signal-A", "networks = red", "set-filters = true", "read-hand = pulse", "stack-size-signal = virtual:signal-A",
    ]);
    expect(feeder().settings).toEqual({
      when: { first: IRON, comparator: "<", second: { type: "constant", value: 100 } },
      "logistic-when": { first: IRON, comparator: ">", second: { type: "signal", signal: A } },
      networks: { red: true, green: false },
      "set-filters": true,
      "read-hand": "pulse",
      "stack-size-signal": A,
    });
    edit("read-hand", "none");
    edit("set-filters", false);
    edit("networks", { red: true, green: true });
    edit("stack-size-signal", undefined);
    edit("logistic-when", undefined);
    edit("when", undefined);
    // The conditions and the network selection are gone. A switch, a mode and a signal that are written stay written and say the
    // default: the language patches the value of a statement and removes none for its value, as for every kind.
    expect(body(session.document.text, "feeder")).toEqual(["set-filters = false", "read-hand = none", "stack-size-signal = virtual:signal-S"]);
    expect(feeder().settings).toEqual({});
    expect(errorsOf(session)).toEqual([]);
    // Each edit is a step of its own.
    for (let step = 0; step < 6; step++) session.commands.undo();
    expect(body(session.document.text, "feeder")).toHaveLength(6);
    for (let step = 0; step < 6; step++) session.commands.undo();
    expect(session.document.text).toBe(SOURCE);
    // A setting that is at its default and not in the source is not written by an edit of another one.
    edit("set-filters", true);
    expect(body(session.document.text, "feeder")).toEqual(["set-filters = true"]);
  });

  it("keeps an incomplete condition as a draft and writes it once it has its signal", () => {
    const { session } = createSession(SOURCE);
    const box = entityNamed(session, "feeder") as GenericEntity;
    session.commands.select([box.id]);
    const blank: Condition = { comparator: ">", second: { type: "constant", value: 5 } };
    session.commands.updateEntity(withSetting(box, spec("inserter", "when"), blank));
    expect(session.state.draft).toMatchObject({ message: 'The condition "Enable/disable" needs a signal.', entity: { settings: { when: blank } } });
    expect(session.document.text).toBe(SOURCE);
    session.commands.updateEntity(withSetting(session.state.draft!.entity as GenericEntity, spec("inserter", "when"), { ...blank, first: A }));
    expect(session.state.draft).toBeNull();
    expect(body(session.document.text, "feeder")).toEqual(["when virtual:signal-A > 5"]);
  });

  it("writes a condition whose signal is taken out as 'when unset', shows the entity as disabled while a wire is on it, and writes the comparison once the signal is back", () => {
    const { session } = createSession(`circuit "Unset" {
    inserter feeder at (40, 80) tile (0.5, 0.5) {
        when item:iron-plate < 100
    }

    constant-combinator source at (40, 300) tile (0.5, 2.5) {
        item:iron-plate = 5
    }

    small-lamp light at (280, 300) tile (2.5, 2.5) {
        when item:iron-plate > 0
        always-on = true
    }

    wire red source.out <-> feeder
    wire red source.out <-> light.in
}
`);
    expect(errorsOf(session)).toEqual([]);
    const feeder = (): GenericEntity => entityNamed(session, "feeder") as GenericEntity;
    const light = (): Lamp => entityNamed(session, "light") as Lamp;
    const when = spec("inserter", "when");
    const status = (name: string) => session.state.simulation.entityStatus.get(idOf(session, name))!;
    const edit = (next: Condition): void => session.commands.updateEntity(withSetting(feeder(), when, editedCondition(feeder().settings.when as ConditionValue, next)));
    expect([status("feeder").label, status("light").label]).toEqual(["enabled", "lit"]);
    session.commands.select([feeder().id]);

    // The user empties the signal field of the condition.
    const { first: _first, ...emptied } = feeder().settings.when as Condition;
    edit(emptied);
    expect(session.state.draft).toBeNull();
    expect(body(session.document.text, "feeder")).toEqual(["when unset"]);
    expect(feeder().settings).toEqual({ when: UNSET_CONDITION });
    expect(errorsOf(session)).toEqual([]);
    expect(session.state.diagnostics).toEqual([]);
    expect(summaryLines(feeder())).toEqual(["unset"]);
    expect(status("feeder")).toMatchObject({ label: "disabled", enabled: false, conditions: [{ key: "when", holds: false }] });
    expect(session.state.simulation.traces.find((row) => row.label === "feeder condition")).toMatchObject({ current: "disabled", condition: { what: "condition", holds: false } });
    // A comparator chosen before the signal waits for it; the source keeps saying unset.
    edit({ ...shownCondition(UNSET_CONDITION), comparator: ">=" });
    expect(session.state.draft).toMatchObject({ message: 'The condition "Enable/disable" needs a signal.' });
    expect(body(session.document.text, "feeder")).toEqual(["when unset"]);
    const waiting = session.state.draft!.entity as GenericEntity;
    session.commands.updateEntity(withSetting(waiting, when, editedCondition(waiting.settings.when as ConditionValue, { ...(waiting.settings.when as Condition), first: A })));
    expect(session.state.draft).toBeNull();
    expect(body(session.document.text, "feeder")).toEqual(["when virtual:signal-A >= 0"]);
    expect(status("feeder").label).toBe("enabled");
    session.commands.undo();
    expect(body(session.document.text, "feeder")).toEqual(["when unset"]);
    // Without the wire nothing is disabled, and the checkbox takes the condition away.
    session.commands.setSource(session.document.text.replace("    wire red source.out <-> feeder\n", ""));
    expect(status("feeder").label).toBe("");
    session.commands.updateEntity(withSetting(feeder(), when, undefined));
    expect(body(session.document.text, "feeder")).toEqual([]);

    // The lamp: the same edit, the same word, and it is dark although it is always on.
    const { first: _signal, ...dark } = light().condition as Condition;
    session.commands.updateEntity({ ...light(), condition: editedCondition(light().condition!, dark) });
    expect(body(session.document.text, "light")).toEqual(["when unset", "always-on = true"]);
    expect(light().condition).toBe(UNSET_CONDITION);
    expect(status("light")).toMatchObject({ label: "off", active: false });
    expect(summaryLines(light())).toEqual(["unset"]);
    session.commands.updateEntity({ ...light(), condition: editedCondition(light().condition!, { ...shownCondition(light().condition!), first: IRON }) });
    expect(body(session.document.text, "light")).toEqual(["when item:iron-plate < 0", "always-on = true"]);
    expect(errorsOf(session)).toEqual([]);
  });

  it("reads 'when unset' from the source, for the lamp and for every condition of an entity", () => {
    const { session } = createSession(`circuit "Unset" {
    express-transport-belt belt1 at (0, 0) {
        when unset
    }

    small-lamp lamp1 at (200, 0) {
        when unset
    }

    stone-wall wall1 at (400, 0) {
        open-gate when unset
    }

    wire red belt1 <-> lamp1.in
    wire red belt1 <-> wall1
}
`);
    expect(errorsOf(session)).toEqual([]);
    expect((entityNamed(session, "belt1") as GenericEntity).settings).toEqual({ when: UNSET_CONDITION });
    expect((entityNamed(session, "lamp1") as Lamp).condition).toBe(UNSET_CONDITION);
    expect(session.state.circuit.entities.map((one) => summaryLines(one))).toEqual([["unset"], ["unset"], ["open-gate unset"]]);
    const status = (name: string) => session.state.simulation.entityStatus.get(idOf(session, name))!;
    expect([status("belt1").label, status("lamp1").label, status("wall1").label]).toEqual(["disabled", "off", "open-gate disabled"]);
    expect([status("belt1").enabled, status("wall1").enabled]).toEqual([false, undefined]);
    for (const one of session.state.circuit.entities) expect(checkDraft(one)).toEqual({ ok: true });
  });

  it("changes the prototype within its type and keeps the settings and what the blueprint had", () => {
    const { session } = createSession(SOURCE);
    session.commands.updateEntity(withSetting(entityNamed(session, "feeder") as GenericEntity, spec("inserter", "read-hand"), "hold"));
    const before = session.document.text;
    session.commands.updateEntity(withPrototype(entityNamed(session, "feeder") as GenericEntity, "fast-inserter"));
    // The word of the declaration is the prototype: nothing else changes, in one step.
    expect(session.document.text).toBe(before.replace("    inserter feeder at", "    fast-inserter feeder at"));
    session.commands.undo();
    expect(session.document.text).toBe(before);
    session.commands.redo();
    expect(body(session.document.text, "feeder")).toEqual(["read-hand = hold"]);
    expect(entityNamed(session, "feeder")).toMatchObject({ prototype: "fast-inserter", settings: { "read-hand": "hold" }, placement: { tile: { x: 0.5, y: 0.5 } } });
    const stop = entityNamed(session, "stop") as GenericEntity;
    session.commands.updateEntity(withSetting(stop, spec("train-stop", "read-from-train"), true));
    expect(body(session.document.text, "stop")).toEqual(["read-from-train = true", 'blueprint-data = "{\\"station\\":\\"Iron\\",\\"manual_trains_limit\\":2}"']);
    expect(keptFields(entityNamed(session, "stop") as GenericEntity)).toEqual(["station", "manual_trains_limit"]);
    expect(errorsOf(session)).toEqual([]);
  });

  it("refuses a prototype whose footprint would cover a tile of another entity on the board, and takes it on the edit canvas", () => {
    const source = `circuit "Tight" {
    assembling-machine-1 maker at (40, 80) tile (1.5, 1.5) {
    }

    iron-chest box at (280, 80) tile (4.5, 3.5) {
    }
}
`;
    const { session } = createSession(source);
    const maker = (): GenericEntity => entityNamed(session, "maker") as GenericEntity;
    expect(alternativePrototypes("assembling-machine-1")).toContain("oil-refinery");
    session.commands.setDisplayMode("blueprint");
    // An oil refinery covers 5 x 5 tiles from the same top-left tile: the chest stands on one of them.
    session.commands.updateEntity(withPrototype(maker(), "oil-refinery"));
    expect(session.state.error).toBe("Not changed: maker would stand on a tile of box.");
    expect(session.document.text).toBe(source);
    session.commands.dismissError();
    // An assembling machine 2 covers the same 3 x 3 tiles.
    session.commands.updateEntity(withPrototype(maker(), "assembling-machine-2"));
    expect(session.state.error).toBeNull();
    expect(maker()).toMatchObject({ prototype: "assembling-machine-2", placement: { tile: { x: 1.5, y: 1.5 } } });
    session.commands.setDisplayMode("edit");
    session.commands.updateEntity(withPrototype(maker(), "oil-refinery"));
    // The top-left tile stays: the center moves with the size. The overlap is the source's warning.
    expect(maker()).toMatchObject({ prototype: "oil-refinery", placement: { tile: { x: 2.5, y: 2.5 } } });
    expect(session.state.diagnostics.filter((diagnostic) => diagnostic.code === "tile-overlap")).toHaveLength(2);
    expect(idOf(session, "maker")).toBeDefined();
  });
});

describe("the prototypes an entity can become", () => {
  const registry = (modules: readonly string[]) => entityRegistry(loadStandardCatalog(), entityTable(), modules);
  const spaceAge = registry(["base", "elevated-rails", "recycler", "quality", "space-age"]);
  const base = registry(["base"]);

  it("are those of its prototype type that the project can place, in the game's order", () => {
    expect(alternativePrototypes("inserter", spaceAge.offers, spaceAge.position)).toEqual(["burner-inserter", "inserter", "long-handed-inserter", "fast-inserter", "bulk-inserter", "stack-inserter"]);
    expect(alternativePrototypes("inserter", base.offers, base.position)).toEqual(["burner-inserter", "inserter", "long-handed-inserter", "fast-inserter", "bulk-inserter"]);
    expect(alternativePrototypes("splitter", spaceAge.offers, spaceAge.position)).toEqual(["splitter", "fast-splitter", "express-splitter", "turbo-splitter"]);
    // The chests of the game's editor are of the same type as a wooden chest and hidden.
    expect(alternativePrototypes("iron-chest", spaceAge.offers, spaceAge.position)).toEqual(["wooden-chest", "iron-chest", "steel-chest"]);
    expect(alternativePrototypes("train-stop", spaceAge.offers, spaceAge.position)).toEqual(["train-stop"]);
    expect(alternativePrototypes("gun-turret", spaceAge.offers, spaceAge.position)).toEqual(["gun-turret", "rocket-turret", "railgun-turret"]);
  });

  it("always have the one the entity is, also a hidden one and one of a module that is off", () => {
    expect(alternativePrototypes("red-chest", spaceAge.offers, spaceAge.position)).toEqual(["wooden-chest", "iron-chest", "steel-chest", "red-chest"]);
    expect(alternativePrototypes("loader", spaceAge.offers, spaceAge.position)).toEqual(["loader"]);
    expect(alternativePrototypes("stack-inserter", base.offers, base.position)).toContain("stack-inserter");
    // Without the registry: every prototype of the type that is not hidden, by name.
    expect(alternativePrototypes("fast-loader")).toEqual(["fast-loader"]);
    expect(alternativePrototypes("fast-inserter")).toEqual(["bulk-inserter", "burner-inserter", "fast-inserter", "inserter", "long-handed-inserter", "stack-inserter"]);
  });

  it("keep the settings the new prototype does not have as its default", () => {
    const chest = entity("iron-chest", { "read-empty-slots": true, "empty-slots-signal": A }, '{"bar":3}');
    expect(withPrototype(chest, "steel-chest")).toEqual({ ...chest, prototype: "steel-chest" });
  });
});

describe("what a blueprint had", () => {
  it("names the fields the editor keeps, as the blueprint has them", () => {
    expect(keptFields(entity("assembling-machine-2", {}, '{"recipe":"iron-gear-wheel","recipe_quality":"normal"}'))).toEqual(["recipe", "recipe_quality"]);
    expect(keptFields(entity("display-panel", {}, '{"control_behavior":{"parameters":[{}]},"text":"x"}'))).toEqual(["control_behavior", "text"]);
    expect(keptFields(entity("iron-chest"))).toEqual([]);
    expect(keptFields(entity("iron-chest", {}, "not json"))).toEqual([]);
    expect(keptFields(entity("iron-chest", {}, "[1]"))).toEqual([]);
  });
});

describe("what a type is for", () => {
  it("has a line for every prototype type of the settings table and for no other", () => {
    expect(Object.keys(TYPE_DESCRIPTIONS).sort()).toEqual(Object.keys(ENTITY_SETTINGS).sort());
    for (const text of Object.values(TYPE_DESCRIPTIONS)) expect(text.length).toBeLessThanOrEqual(70);
    for (const type of Object.keys(TYPE_NOTES)) expect(Object.keys(ENTITY_SETTINGS)).toContain(type);
  });

  it("describes an entity by its prototype type, and a type without a line by its settings", () => {
    expect(entityDescription({ prototype: "bulk-inserter" })).toBe(TYPE_DESCRIPTIONS.inserter);
    expect(entityDescription({ prototype: "steel-chest" })).toBe("Read what a chest holds");
    expect(entityDescription({ prototype: "decider-combinator" })).toBe("Compare and decide");
    for (const name of Object.keys(PROTOTYPES)) expect(entityDescription({ prototype: name }).length, name).toBeGreaterThan(8);
    expect(typeDescription("no-such-entity")).toBe("An entity of the game on the circuit network");
    expect(describeSettings(settingSpecsOf("inserter"))).toBe("Act on a circuit condition, take settings from signals, send what it reads");
    expect(describeSettings(settingSpecsOf("iron-chest"))).toBe("Send what it reads");
    expect(describeSettings([])).toBe("An entity of the game on the circuit network");
  });

  it("notes what the game does otherwise: a wall without a gate, the chests no item builds", () => {
    expect(prototypeNotes("stone-wall")).toEqual([TYPE_NOTES.wall]);
    expect(TYPE_NOTES.wall).toContain("only while a gate stands next to it");
    // No list of names: whatever the table says no item builds.
    const unbuilt = entityTable().entities.filter((game) => game.placedBy.length === 0).map((game) => game.name);
    expect(unbuilt).toEqual(["blue-chest", "crash-site-chest-1", "crash-site-chest-2", "red-chest"]);
    for (const name of unbuilt) expect(prototypeNotes(name).join(" "), name).toContain("takes it into no blueprint");
    expect(prototypeNotes("iron-chest")).toEqual([]);
    expect(prototypeNotes("fast-inserter")).toEqual([]);
    expect(prototypeNotes("no-such-entity")).toEqual([]);
  });
});
