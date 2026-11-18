// What the speaker form writes: every setting as canonical source, nothing for a setting that was never changed. The forms
// emit entities; these are the edits they make. Which entity of the game an entity is, is not among them.
// A statement that is there stays when its value returns to the default (`polyphony = false`): that is the rule of the
// language's `updateEntity` for every kind, which patches a statement and never removes one for its value.
import { loadStandardCatalog } from "@face/catalog";
import type { Entity, Pole, Speaker } from "@face/model";
import { describe, expect, it } from "vitest";
import { withSpeakerInstrument, withSpeakerNote } from "../../src/inspector/speakerEdits.ts";
import { parseNumberInRange } from "../../src/inspector/validation.ts";
import { CatalogService } from "../../src/session/catalogService.ts";
import type { ProjectSession } from "../../src/session/projectSession.ts";
import { createSession, entityNamed, idOf } from "./helpers.ts";

const catalog = loadStandardCatalog();
const instruments = new CatalogService(catalog, catalog.modules.map((module) => module.name)).speakerInstruments;
const A = { kind: "virtual", name: "signal-A" } as const;
const B = { kind: "virtual", name: "signal-B" } as const;

const SPEAKER = `circuit "Speaker" {
    programmable-speaker alarm at (40, 80) {
        when virtual:signal-A > 0
    }
}
`;

/** The statements of the one entity of the circuit, as the source has them. */
function body(session: ProjectSession): string[] {
  return session.document.text.split("\n").slice(2, -3).map((line) => line.trim());
}

function speaker(session: ProjectSession): Speaker {
  return entityNamed(session, "alarm") as Speaker;
}

describe("instrument and note", () => {
  const base = { instrument: undefined, note: undefined } as unknown as Speaker;
  const sound = (entity: Speaker): [string | undefined, string | undefined] => [entity.instrument, entity.note];

  it("knows the game's lists: alarms first, the piano from F3", () => {
    expect(instruments.slice(0, 4).map((instrument) => instrument.name)).toEqual(["alarms", "miscellaneous", "drum-kit", "piano"]);
    expect(instruments[3]!.notes.slice(0, 3).map((note) => note.name)).toEqual(["F3", "F#3", "G3"]);
    expect(instruments[2]!.displayName).toBe("Drumkit");
  });

  it("does not name the first instrument and the first note of an instrument", () => {
    expect(sound(withSpeakerInstrument({ ...base, instrument: "piano" }, "alarms", instruments))).toEqual([undefined, undefined]);
    expect(sound(withSpeakerNote({ ...base, note: "siren" }, "alarm-1", instruments))).toEqual([undefined, undefined]);
    expect(sound(withSpeakerNote({ ...base, instrument: "piano", note: "A3" }, "F3", instruments))).toEqual(["piano", undefined]);
    expect(sound(withSpeakerNote(base, "siren", instruments))).toEqual([undefined, "siren"]);
    expect(sound(withSpeakerNote({ ...base, instrument: "piano" }, "F#3", instruments))).toEqual(["piano", "F#3"]);
  });

  it("keeps the note across a change of the instrument when the new one has it, and takes its first note otherwise", () => {
    // A piano and a bass both have an A3; the first note of the bass is F2.
    expect(sound(withSpeakerInstrument({ ...base, instrument: "piano", note: "A3" }, "bass", instruments))).toEqual(["bass", "A3"]);
    // The note a speaker plays without naming it is the first of its instrument: the F3 of the piano stays an F3 on the bass.
    expect(sound(withSpeakerInstrument({ ...base, instrument: "piano" }, "bass", instruments))).toEqual(["bass", "F3"]);
    // The celesta starts at F5: an A3 is not among its notes.
    expect(sound(withSpeakerInstrument({ ...base, instrument: "piano", note: "A3" }, "celesta", instruments))).toEqual(["celesta", undefined]);
    expect(sound(withSpeakerInstrument({ ...base, note: "siren" }, "piano", instruments))).toEqual(["piano", undefined]);
    // The note that becomes the first one of the new instrument goes without saying.
    expect(sound(withSpeakerInstrument({ ...base, instrument: "bass", note: "F3" }, "piano", instruments))).toEqual(["piano", undefined]);
  });

  it("leaves the note alone for an instrument the lists do not have, and without lists", () => {
    expect(sound(withSpeakerInstrument({ ...base, note: "siren" }, "organ", instruments))).toEqual(["organ", "siren"]);
    expect(sound(withSpeakerInstrument({ ...base, note: "siren" }, "piano", []))).toEqual(["piano", "siren"]);
    expect(sound(withSpeakerNote({ ...base, instrument: "organ" }, "C1", instruments))).toEqual(["organ", "C1"]);
  });
});

describe("volume text", () => {
  it("takes a number from 0 to 100 with or without decimals", () => {
    expect(parseNumberInRange("60", 0, 100)).toEqual({ ok: true, value: 60 });
    expect(parseNumberInRange(" 12.5 ", 0, 100)).toEqual({ ok: true, value: 12.5 });
    expect(parseNumberInRange("0", 0, 100)).toEqual({ ok: true, value: 0 });
    expect(parseNumberInRange("100", 0, 100)).toEqual({ ok: true, value: 100 });
    for (const text of ["", "loud", "1e2", "12.", ".5", "1,5"]) expect(parseNumberInRange(text, 0, 100), text).toEqual({ ok: false, message: "Enter a number" });
    for (const text of ["100.1", "-1", "250"]) expect(parseNumberInRange(text, 0, 100), text).toEqual({ ok: false, message: "Must be from 0 to 100" });
  });
});

describe("speaker settings in the source", () => {
  it("writes each setting as its own statement, patches it back to its default and says nothing about a setting that was never touched", () => {
    const { session } = createSession(SPEAKER);
    const update = (change: Partial<Speaker>): void => session.commands.updateEntity({ ...speaker(session), ...change } as Entity);
    expect(body(session)).toEqual(["when virtual:signal-A > 0"]);
    const steps: readonly [Partial<Speaker>, string][] = [
      [{ instrument: "piano" }, "instrument = piano"],
      [{ note: "F#3" }, 'note = "F#3"'],
      [{ volume: 62.5 }, "volume = 62.5"],
      [{ volumeSignal: B }, "volume-signal = virtual:signal-B"],
      [{ playbackMode: "global" }, "playback = global"],
      [{ allowPolyphony: true }, "polyphony = true"],
      [{ stopPlayingSounds: true }, "stop-playing-sounds = true"],
      [{ showAlert: true }, "show-alert = true"],
      [{ showOnMap: false }, "show-on-map = false"],
      [{ alertIcon: { kind: "item", name: "iron-plate" } }, "alert-icon = item:iron-plate"],
      [{ alertMessage: 'Iron is "low"' }, 'alert-message = "Iron is \\"low\\""'],
    ];
    const written = ["when virtual:signal-A > 0"];
    for (const [change, statement] of steps) {
      update(change);
      written.push(statement);
      expect(body(session), statement).toEqual(written);
      expect(session.state.diagnostics, statement).toEqual([]);
      expect(session.state.draft).toBeNull();
    }
    // Back to the defaults, one undo step each. What has no value at its default (a signal, a name) loses its statement; a
    // statement with a value keeps it, as the language does for every kind.
    update({ alertMessage: "", alertIcon: undefined, showOnMap: true, showAlert: false, stopPlayingSounds: false, allowPolyphony: false, playbackMode: "local", volumeSignal: undefined, volume: 100, note: undefined, instrument: undefined });
    expect(body(session)).toEqual(["when virtual:signal-A > 0", "volume = 100", "playback = local", "polyphony = false", "stop-playing-sounds = false", "show-alert = false", "show-on-map = true", 'alert-message = ""']);
    expect(session.state.diagnostics).toEqual([]);
    for (let step = 0; step <= steps.length; step++) session.commands.undo();
    expect(session.document.text).toBe(SPEAKER);
    expect(session.state.canUndo).toBe(false);
  });

  it("writes a new speaker and a setting at its default as nothing at all", () => {
    const { session } = createSession('circuit "Empty" {\n}\n');
    session.commands.placeEntity("programmable-speaker", { x: 40, y: 80 });
    expect(session.document.text).toBe('circuit "Empty" {\n    programmable-speaker speaker1 at (40, 80) {\n    }\n}\n');
    const placed = entityNamed(session, "speaker1") as Speaker;
    // The form sets what it shows: the values of a new speaker. None of them is a statement.
    const before = session.document.text;
    session.commands.updateEntity({ ...placed, volume: 100, playbackMode: "local", allowPolyphony: false, stopPlayingSounds: false, showAlert: false, showOnMap: true, alertMessage: "" });
    expect(session.document.text).toBe(before);
    session.commands.updateEntity({ ...(entityNamed(session, "speaker1") as Speaker), pitchSignal: A });
    expect(session.document.text).toBe('circuit "Empty" {\n    programmable-speaker speaker1 at (40, 80) {\n        pitch = virtual:signal-A\n    }\n}\n');
  });

  it("changes between a condition and a pitch signal, which take each other's place", () => {
    const { session } = createSession(SPEAKER);
    const { condition, ...rest } = speaker(session);
    session.commands.updateEntity({ ...rest, pitchSignal: condition!.first } as Entity);
    expect(body(session)).toEqual(["pitch = virtual:signal-A"]);
    expect(session.state.diagnostics).toEqual([]);
    const { pitchSignal, ...silent } = speaker(session);
    session.commands.updateEntity({ ...silent, condition: { first: pitchSignal, comparator: "<=", second: { type: "signal", signal: B } } } as Entity);
    expect(body(session)).toEqual(["when virtual:signal-A <= virtual:signal-B"]);
    // Without either the speaker never plays, which the analysis says.
    const { condition: _, ...blank } = speaker(session);
    session.commands.updateEntity(blank as Entity);
    expect(body(session)).toEqual([]);
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unconfigured"]);
  });

  it("keeps a condition without a signal as a draft until it has one", () => {
    const { session } = createSession(SPEAKER.replace("        when virtual:signal-A > 0\n", ""));
    session.commands.select([idOf(session, "alarm")]);
    session.commands.updateEntity({ ...speaker(session), condition: { comparator: ">=", second: { type: "constant", value: 5 } } } as Entity);
    expect(session.state.draft).toMatchObject({ message: "The condition needs a signal." });
    expect(body(session)).toEqual([]);
    session.commands.updateEntity({ ...(session.state.draft!.entity as Speaker), condition: { first: A, comparator: ">=", second: { type: "constant", value: 5 } } } as Entity);
    expect(session.state.draft).toBeNull();
    expect(body(session)).toEqual(["when virtual:signal-A >= 5"]);
  });

  it("does not write a volume the language does not have and merges the keystrokes of one field into one step", () => {
    const { session } = createSession(SPEAKER);
    session.commands.select([idOf(session, "alarm")]);
    session.commands.updateEntity({ ...speaker(session), volume: 120 } as Entity);
    expect(session.state.draft?.message).toBe("The volume is a percentage from 0 to 100");
    expect(session.document.text).toBe(SPEAKER);
    session.commands.discardDraft();
    for (const alertMessage of ["I", "Ir", "Iro", "Iron"]) session.commands.updateEntity({ ...speaker(session), alertMessage } as Entity, { coalesce: "alarm:1" });
    expect(body(session)).toEqual(["when virtual:signal-A > 0", 'alert-message = "Iron"']);
    session.commands.undo();
    expect(session.document.text).toBe(SPEAKER);
  });
});

describe("the prototype of a pole", () => {
  it("is the word of its declaration, which no edit of the entity writes", () => {
    const source = 'circuit "Poles" {\n    small-electric-pole p at (40, 80) tile (4.5, 0.5) {\n    }\n}\n';
    const { session } = createSession(source);
    session.commands.updateEntity({ ...(entityNamed(session, "p") as Pole), prototype: "big-electric-pole" });
    expect(session.document.text).toBe(source);
    expect([session.state.error, session.state.canUndo]).toEqual([null, false]);
  });
});

describe("placing with a prototype", () => {
  const EMPTY = 'circuit "Empty" {\n}\n';

  it("places the prototype of the tool on the edit canvas and names the entity after its kind", () => {
    const { session } = createSession(EMPTY);
    session.commands.setTool({ type: "place", prototype: "big-electric-pole" });
    expect(session.state.tool).toEqual({ type: "place", prototype: "big-electric-pole" });
    session.commands.placeEntity("big-electric-pole", { x: 40, y: 80 }, "south");
    session.commands.placeEntity("small-electric-pole", { x: 300, y: 80 });
    session.commands.placeEntity("programmable-speaker", { x: 560, y: 80 });
    session.commands.placeEntity("small-lamp", { x: 820, y: 80 });
    expect(session.document.text).toBe(
      'circuit "Empty" {\n    big-electric-pole pole1 at (40, 80) {\n    }\n\n    small-electric-pole pole2 at (300, 80) {\n    }\n\n    programmable-speaker speaker1 at (560, 80) {\n    }\n\n    small-lamp lamp1 at (820, 80) {\n    }\n}\n',
    );
    expect(session.state.selection).toEqual([idOf(session, "lamp1")]);
    expect(session.state.tool).toEqual({ type: "select" });
    // A name the game data does not have is refused and reported, on the canvas and on a tile, and is no tool.
    const before = session.document.text;
    for (const place of [() => session.commands.placeEntity("lamp", { x: 0, y: 0 }), () => session.commands.placeEntityOnTile("lamp", { x: 30.5, y: 30.5 })]) {
      place();
      expect(session.state.error).toBe("'lamp' is not an entity of the game data in use");
      session.commands.dismissError();
    }
    session.commands.setTool({ type: "place", prototype: "lamp" });
    expect(session.state).toMatchObject({ tool: { type: "select" }, error: null });
    expect(session.document.text).toBe(before);
  });

  it("places a 2x2 pole on free tiles only, with the center of its four tiles", () => {
    const { session } = createSession(EMPTY);
    session.commands.setDisplayMode("blueprint");
    session.commands.placeEntityOnTile("substation", { x: 3, y: 1 });
    expect(session.document.text).toContain("substation pole1 at (180, 0) tile (3, 1) {\n    }");
    // Any footprint that touches one of its four tiles (2..3, 0..1) is refused, without a message, like every taken tile.
    const before = session.document.text;
    session.commands.placeEntityOnTile("big-electric-pole", { x: 4, y: 2 });
    session.commands.placeEntityOnTile("small-lamp", { x: 3.5, y: 1.5 });
    session.commands.placeEntityOnTile("small-electric-pole", { x: 2.5, y: 0.5 });
    expect(session.document.text).toBe(before);
    expect(session.state.error).toBeNull();
    session.commands.placeEntityOnTile("big-electric-pole", { x: 5, y: 1 });
    session.commands.placeEntityOnTile("medium-electric-pole", { x: 1.5, y: 0.5 });
    expect(session.state.circuit.entities.map((entity) => [entity.name, entity.placement?.tile])).toEqual([["pole1", { x: 3, y: 1 }], ["pole2", { x: 5, y: 1 }], ["pole3", { x: 1.5, y: 0.5 }]]);
    expect(session.state.diagnostics).toEqual([]);
  });
});
