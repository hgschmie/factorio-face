// Electric poles and the programmable speaker in the renderer. They are handled the simplest correct way until the palette
// and their cards are designed: they come from the source, show on both canvases with their wires and follow the wire reach.
import { loadStandardCatalog } from "@face/catalog";
import { analyze, completionContext } from "@face/language";
import { ENTITY_KINDS, type Entity } from "@face/model";
import { describe, expect, it } from "vitest";
import { arrangeBoard } from "../src/canvas/board.ts";
import { drawnSide, pinEdge, pinPoint } from "../src/canvas/geometry.ts";
import { blueprintLayout, editLayout } from "../src/canvas/layout.ts";
import { KIND_INFO, PALETTE_KINDS } from "../src/entities/kindInfo.ts";
import { entitySummary } from "../src/entities/summary.ts";
import { CatalogService } from "../src/session/catalogService.ts";
import { completionCandidates } from "../src/session/completion.ts";
import { checkDraft, normalizeEntity } from "../src/session/drafts.ts";
import { environmentData } from "../src/session/environment.ts";
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
  it("has display data for every kind and keeps the palette to its five", () => {
    for (const kind of ENTITY_KINDS) expect(KIND_INFO[kind].label.length).toBeGreaterThan(0);
    expect(PALETTE_KINDS).toEqual(["constant", "arithmetic", "decider", "selector", "lamp"]);
  });

  it("sums a pole up by what it is and a speaker by when it plays", () => {
    const { session } = createSession(SOURCE);
    expect(entitySummary(entityNamed(session, "p1"))).toBe("small electric pole");
    expect(entitySummary(entityNamed(session, "big"))).toBe("big electric pole");
    expect(entitySummary(entityNamed(session, "alarm"))).toBe("pitch A");
    expect(entitySummary({ ...entityNamed(session, "alarm"), pitchSignal: undefined, condition: { first: { kind: "virtual", name: "signal-A" }, comparator: ">=", second: { type: "constant", value: 2 } } } as Entity)).toBe("A ≥ 2");
    expect(entitySummary({ ...entityNamed(session, "alarm"), pitchSignal: undefined } as Entity)).toBe("no condition");
    for (const name of ["p1", "big", "alarm"]) {
      const entity = entityNamed(session, name);
      expect(normalizeEntity(entity)).toBe(entity);
      expect(checkDraft(entity)).toEqual({ ok: true });
    }
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
    expect(status("alarm")).toMatchObject({ label: "playing G3", active: true });
    expect(status("p1")).toMatchObject({ label: "relay", active: false, input: { red: { wired: true, signals: [{ value: 3 }] }, green: { wired: true, signals: [] } } });
    expect(status("far").input).toMatchObject({ red: { wired: false }, green: { wired: true } });
    expect(status("p1").output).toBeUndefined();
    session.commands.select([idOf(session, "p1"), idOf(session, "alarm")]);
    expect(session.state.simulation.traces.map((row) => [row.label, row.current])).toEqual([["p1", "no output"], ["alarm", "no output"]]);
    expect(session.state.simulation.traces[0]!.inputs).toBe("Red: A 3\nGreen: nothing");
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

  it("draws the one point of a pole where an input is, on the edit canvas and on the board", () => {
    expect(drawnSide("io")).toBe("in");
    expect(pinEdge("io")).toBe(pinEdge("in"));
    expect(pinPoint({ x: 0, y: 0 }, "io", "red")).toEqual(pinPoint({ x: 0, y: 0 }, "in", "red"));
    const edit = editLayout(entities);
    expect(edit.pin(byName("p1"), "io", "green")).toEqual({ x: 280, y: 160 });
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
    expect(board.pin(byName("big"), "io", "red")).toEqual({ x: 652, y: 70 });
    expect(board.wireSpan(byName("p1"), byName("big"), 9)).toEqual({ reach: 7.5, of: "small-electric-pole", distance: 3, tooLong: false });
    expect(board.wireSpan(byName("big"), byName("light"), 9)).toEqual({ reach: 9, of: "project", distance: 2, tooLong: false });
    expect(board.wireSpan(byName("p1"), byName("far"), 9)).toMatchObject({ reach: 7.5, distance: 8, tooLong: true });
    // A pole being dragged is measured where the drag would put it.
    const moved = blueprintLayout(entities, new Map([[byName("far").id, { x: 12 * 80, y: 0 }]]));
    expect(moved.wireSpan(byName("p1"), byName("far"), 9)).toMatchObject({ distance: 7, tooLong: false });
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
