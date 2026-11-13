// Electric poles and the programmable speaker in the renderer: what their cards say, how the session analyzes and simulates
// them, where their pins are on both canvases and what completion offers. The palette is in registry.test.ts, the connection
// point of a pole in ioPoint.test.ts, the forms in session/speakerForm.test.ts.
import { loadStandardCatalog } from "@face/catalog";
import { analyze, completionContext } from "@face/language";
import { ENTITY_KINDS, type Entity } from "@face/model";
import { describe, expect, it } from "vitest";
import { arrangeBoard } from "../src/canvas/board.ts";
import { blueprintLayout, editLayout } from "../src/canvas/layout.ts";
import { entityNoun, entityTitle, KIND_INFO, prototypeFacts, prototypeLabel } from "../src/entities/kindInfo.ts";
import { entitySummary, speakerSound, summaryLines } from "../src/entities/summary.ts";
import { CatalogService } from "../src/session/catalogService.ts";
import { completionCandidates } from "../src/session/completion.ts";
import { checkDraft, normalizeEntity } from "../src/session/drafts.ts";
import { environmentData } from "../src/session/environment.ts";
import { isTraceable, speakerText } from "../src/session/simulationView.ts";
import { wireEndsLabel, wireReachNote } from "../src/workbench/selectionText.ts";
import { createSession, entityNamed, idOf } from "./session/helpers.ts";

const SOURCE = `circuit "Poles" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 3
    }

    pole p1 at (280, 80) tile (4.5, 0.5) {
    }

    pole big at (520, 80) tile (9, 1) {
        prototype = big-electric-pole
    }

    lamp light at (760, 80) tile (12.5, 0.5) {
        when virtual:signal-A > 0
    }

    speaker alarm at (760, 300) tile (12.5, 2.5) {
        pitch = virtual:signal-A
        instrument = piano
    }

    pole far at (1000, 300) tile (13.5, 0.5) {
    }

    wire red source.out <-> p1
    wire red p1 <-> big
    wire red big <-> light.in
    wire red big <-> alarm.in
    wire green p1 <-> far
}
`;

const catalog = loadStandardCatalog();
const ALL = catalog.modules.map((module) => module.name);

describe("kinds", () => {
  it("has display data for every kind and names an entity by its kind, or by its prototype where the kind has several", () => {
    for (const kind of ENTITY_KINDS) expect(KIND_INFO[kind].label.length).toBeGreaterThan(0);
    expect(entityTitle({ kind: "decider" })).toBe("Decider");
    expect(entityTitle({ kind: "lamp" })).toBe("Lamp");
    expect(entityTitle({ kind: "speaker" })).toBe("Speaker");
    expect(entityTitle({ kind: "pole" })).toBe("Small electric pole");
    expect(entityTitle({ kind: "pole", prototype: "substation" })).toBe("Substation");
    expect(entityNoun({ kind: "arithmetic" })).toBe("an arithmetic");
    expect(entityNoun({ kind: "pole", prototype: "big-electric-pole" })).toBe("a big electric pole");
    expect(prototypeLabel({ kind: "speaker" })).toBe("Programmable speaker");
    // What sets a prototype apart: nothing for an entity that has the reach of the project.
    expect(prototypeFacts({ kind: "lamp" })).toBe("");
    expect(prototypeFacts({ kind: "decider" })).toBe("");
    expect(prototypeFacts({ kind: "pole" })).toBe("1 tile, wire reach 7.5");
    expect(prototypeFacts({ kind: "pole", prototype: "big-electric-pole" })).toBe("2 x 2 tiles, wire reach 32");
    // The game has a description on the combinators only.
    expect(ENTITY_KINDS.filter((kind) => !KIND_INFO[kind].describedInGame)).toEqual(["lamp", "pole", "speaker"]);
  });

  it("sums a pole up by its reach and its tiles and a speaker by what it plays and when", () => {
    const { session } = createSession(SOURCE);
    const instruments = new CatalogService(catalog, ALL).speakerInstruments;
    expect(summaryLines(entityNamed(session, "p1"))).toEqual(["reach 7.5 · 1x1"]);
    expect(summaryLines(entityNamed(session, "big"))).toEqual(["reach 32 · 2x2"]);
    const alarm = entityNamed(session, "alarm");
    expect(summaryLines(alarm, instruments)).toEqual(["pitch from A", "piano"]);
    const conditional = { ...alarm, pitchSignal: undefined, condition: { first: { kind: "virtual", name: "signal-A" }, comparator: ">=", second: { type: "constant", value: 2 } } } as Entity;
    // A speaker that does not name its note plays the first one of its instrument, which the catalog knows.
    expect(summaryLines(conditional, instruments)).toEqual(["piano F3", "when A ≥ 2"]);
    expect(summaryLines(conditional)).toEqual(["piano", "when A ≥ 2"]);
    expect(summaryLines({ ...conditional, instrument: undefined, note: "siren" } as Entity, instruments)).toEqual(["alarms siren", "when A ≥ 2"]);
    expect(summaryLines({ ...alarm, pitchSignal: undefined, instrument: undefined } as Entity, instruments)).toEqual(["alarms alarm-1", "no condition"]);
    expect(summaryLines({ ...alarm, pitchSignal: undefined, instrument: undefined } as Entity)).toEqual(["first sound", "no condition"]);
    expect(entitySummary(conditional, instruments)).toBe("piano F3, when A ≥ 2");
    expect(speakerSound({ instrument: "organ" }, instruments)).toEqual({ instrument: "organ", note: undefined });
    for (const name of ["p1", "big", "alarm"]) {
      const entity = entityNamed(session, name);
      expect(normalizeEntity(entity)).toBe(entity);
      expect(checkDraft(entity)).toEqual({ ok: true });
    }
  });

  it("says what a speaker does and which entities have something to trace", () => {
    expect(speakerText({ playing: false })).toBe("silent");
    expect(speakerText({ playing: true })).toBe("playing");
    expect(speakerText({ playing: true, instrument: "piano", note: "F#3", volume: 100 })).toBe("playing piano F#3");
    expect(speakerText({ playing: true, instrument: "piano", note: "F#3", volume: 62.5, alert: true })).toBe("playing piano F#3 at 62.5%");
    expect(ENTITY_KINDS.filter((kind) => !isTraceable(kind))).toEqual(["pole"]);
  });
});

describe("session", () => {
  it("analyzes the source with the instruments of the catalog and the wire reach per entity", () => {
    const { session } = createSession(SOURCE);
    expect(session.state.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)).toEqual(["wire-too-long: Wire from 'p1' to 'far': the entities are 8 tiles apart; the wire reach of a small electric pole is 7.5"]);
    // Unlimited for the project still leaves the pole its reach; a wire between other entities is then never too long.
    session.commands.setWireReach(0);
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["wire-too-long"]);
    session.commands.setWireReach(2);
    // The wire from the constant has the project's 2 tiles; the one between the two poles has theirs, whatever the project says.
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.message.replace(/^Wire from (.*): .*; /, "$1: "))).toEqual([
      "'source.out' to 'p1': the wire reach of the project is 2",
      "'p1' to 'far': the wire reach of a small electric pole is 7.5",
    ]);
    session.commands.setWireReach(9);
    session.commands.setSource(SOURCE.replace("instrument = piano", "instrument = organ"));
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unknown-instrument", "wire-too-long"]);
    session.commands.setSource(SOURCE.replace("instrument = piano", 'instrument = piano\n        note = "X#9"'));
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.message)).toContain("The instrument 'piano' has no note 'X#9'");
  });

  it("simulates through the poles: the lamp is lit at tick 0 and the speaker plays the note its signal picks", () => {
    const { session } = createSession(SOURCE);
    const status = (name: string) => session.state.simulation.entityStatus.get(idOf(session, name))!;
    expect(session.state.simulation.available).toBe(true);
    expect(status("light")).toMatchObject({ label: "lit", active: true });
    // The third note of the piano, from the catalog's instrument table.
    expect(status("alarm")).toMatchObject({ label: "playing piano G3", active: true, speaker: { playing: true, instrument: "piano", note: "G3", volume: 100 } });
    // A pole is a relay: the two networks it joins, no output, no state and nothing to say about it.
    expect(status("p1")).toEqual({ label: "", active: false, input: { red: { wired: true, signals: [expect.objectContaining({ value: 3 })] }, green: { wired: true, signals: [] } } });
    expect(status("far").input).toMatchObject({ red: { wired: false }, green: { wired: true } });
    // Without a selection the dock traces the first entities that have something to trace: the poles are passed over.
    expect(session.state.simulation.traces.map((row) => [row.label, row.current])).toEqual([["source A", "3"], ["light light", "lit"], ["alarm sound", "playing piano G3"]]);
    // A selected pole has no row and no "no output"; a speaker has one like a lamp's, 1 while it plays.
    session.commands.select([idOf(session, "p1"), idOf(session, "alarm")]);
    expect(session.state.simulation.traces).toHaveLength(1);
    expect(session.state.simulation.traces[0]).toMatchObject({ label: "alarm sound", current: "playing piano G3", speaker: { playing: true }, values: [1], inputs: "Input red: A 3\nInput green: nothing\nInput sum: A 3" });
    session.commands.select([idOf(session, "p1"), idOf(session, "big")]);
    expect(session.state.simulation.traces).toEqual([]);
    // Silent once the signal picks no note.
    session.commands.setSource(SOURCE.replace("virtual:signal-A = 3", "virtual:signal-A = 0"));
    expect(status("alarm")).toMatchObject({ label: "silent", active: false, speaker: { playing: false } });
    expect(environmentData(catalog, ALL).instruments!.map((instrument) => instrument.name).slice(0, 4)).toEqual(["alarms", "miscellaneous", "drum-kit", "piano"]);
  });

  it("edits around poles: a wire to the point of a pole, a rename, a turn that leaves it alone", () => {
    const { session } = createSession(SOURCE);
    session.commands.addWire({ color: "green", a: { entity: idOf(session, "big"), side: "io" }, b: { entity: idOf(session, "light"), side: "in" } });
    expect(session.document.text).toContain("    wire green big <-> light.in\n");
    session.commands.renameEntity(idOf(session, "big"), "hub");
    expect(session.document.text).toContain("    wire red p1 <-> hub\n    wire red hub <-> light.in\n");
    const before = session.document.text;
    session.commands.rotateEntities([idOf(session, "hub"), idOf(session, "alarm")], "clockwise");
    expect(session.document.text).toBe(before);
    expect(session.state.error).toBeNull();
  });
});

describe("canvases", () => {
  const { session } = createSession(SOURCE);
  const entities = session.state.circuit.entities;
  const byName = (name: string): Entity => entityNamed(session, name);

  it("routes every wire of the circuit on the edit canvas", () => {
    const edit = editLayout(entities);
    for (const wire of session.state.circuit.wires) {
      const route = edit.route(wire, entities.find((entity) => entity.id === wire.a.entity)!, entities.find((entity) => entity.id === wire.b.entity)!);
      expect(route.path.startsWith("M ")).toBe(true);
      expect(Number.isFinite(route.bounds.width + route.bounds.height)).toBe(true);
    }
  });

  it("stands a big pole on two by two tiles and measures its wires from them", () => {
    const board = blueprintLayout(entities);
    expect(arrangeBoard(entities).get(byName("big").id)).toMatchObject({ origin: { x: 8, y: 0 }, size: { width: 2, height: 2 }, conflict: false });
    expect(board.rect(byName("big"))).toEqual({ x: 640, y: 0, width: 160, height: 160 });
    // The pins of a pole are in the middle of the top end of its footprint, red left of green.
    expect(board.pin(byName("big"), "io", "red")).toEqual({ x: 710, y: 12 });
    expect(board.pin(byName("big"), "io", "green")).toEqual({ x: 730, y: 22 });
    expect(board.pin(byName("p1"), "io", "red")).toEqual({ x: 350, y: 12 });
    expect(board.wireSpan(byName("p1"), byName("big"), 9)).toEqual({ reach: 7.5, of: "small-electric-pole", distance: 3, tooLong: false });
    expect(board.wireSpan(byName("big"), byName("light"), 9)).toEqual({ reach: 9, of: "project", distance: 2, tooLong: false });
    expect(board.wireSpan(byName("p1"), byName("far"), 9)).toMatchObject({ reach: 7.5, distance: 8, tooLong: true });
    // A pole being dragged is measured where the drag would put it.
    const moved = blueprintLayout(entities, new Map([[byName("far").id, { x: 12 * 80, y: 0 }]]));
    expect(moved.wireSpan(byName("p1"), byName("far"), 9)).toMatchObject({ distance: 7, tooLong: false });
  });
});

describe("wires in words", () => {
  const { session } = createSession(SOURCE);
  const byName = (name: string): Entity => entityNamed(session, name);

  it("names the point of a pole by the bare name, as the source does", () => {
    const names = new Map(session.state.circuit.entities.map((entity) => [entity.id, entity.name]));
    expect(session.state.circuit.wires.map((wire) => wireEndsLabel(wire, names)).sort()).toEqual(["big <-> alarm.in", "big <-> light.in", "p1 <-> big", "p1 <-> far", "source.out <-> p1"]);
  });

  it("says whose reach applied to a wire and why", () => {
    expect(wireReachNote(byName("source"), byName("light"), { reach: 9, of: "project" })).toBe("The wire reach of the project is 9.");
    expect(wireReachNote(byName("source"), byName("p1"), { reach: 7.5, of: "small-electric-pole" })).toBe("The wire reach of a small electric pole is 7.5: a pole has its own reach, and a wire spans the smaller reach of its two ends.");
    expect(wireReachNote(byName("big"), byName("light"), { reach: 9, of: "project" })).toBe("The wire reach of the project is 9. It is the smaller reach of the two ends: a big electric pole reaches 32.");
    expect(wireReachNote(byName("light"), byName("source"), { reach: 0, of: "project" })).toBe("The wire reach of the project is unlimited.");
  });
});

describe("completion", () => {
  const service = new CatalogService(catalog, ALL);
  const at = (text: string): string[] => completionCandidates(completionContext(analyze(text.replace("|", "")), text.indexOf("|")), service).map((candidate) => candidate.label);

  it("offers a pole by its bare name and the other entities with their terminals", () => {
    expect(at('circuit "c" {\n pole p { }\n lamp l { }\n decider d { }\n wire red |\n}')).toEqual(["p", "l.in", "d.in", "d.out"]);
  });

  it("offers the instruments and the notes of the instrument a speaker names, quoted where they are not one word", () => {
    expect(at('circuit "c" {\n speaker s { instrument = | }\n}')).toEqual(["alarms", "miscellaneous", "drum-kit", "piano", "bass", "lead", "saw", "square", "celesta", "vibraphone", "plucked", "steel-drum"]);
    expect(at('circuit "c" {\n speaker s { instrument = piano note = | }\n}').slice(0, 3)).toEqual(["F3", '"F#3"', "G3"]);
    expect(at('circuit "c" {\n speaker s { note = | }\n}')).toEqual(["alarm-1", "alarm-2", "buzzer-1", "buzzer-2", "buzzer-3", "ring", "siren"]);
    expect(at('circuit "c" {\n speaker s { instrument = organ note = | }\n}')).toEqual([]);
    expect(at('circuit "c" {\n pole p { prototype = | }\n}')).toEqual(["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"]);
  });
});
