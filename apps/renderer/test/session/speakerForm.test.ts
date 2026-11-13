// What the speaker form and the prototype control write: every setting as canonical source, nothing for a setting that was
// never changed, and for a pole the tiles that follow its prototype. The forms emit entities; these are the edits they make.
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
    speaker alarm at (40, 80) {
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
    session.commands.placeEntity("speaker", { x: 40, y: 80 });
    expect(session.document.text).toBe('circuit "Empty" {\n    speaker speaker1 at (40, 80) {\n    }\n}\n');
    const placed = entityNamed(session, "speaker1") as Speaker;
    // The form sets what it shows: the values of a new speaker. None of them is a statement.
    const before = session.document.text;
    session.commands.updateEntity({ ...placed, volume: 100, playbackMode: "local", allowPolyphony: false, stopPlayingSounds: false, showAlert: false, showOnMap: true, alertMessage: "" });
    expect(session.document.text).toBe(before);
    session.commands.updateEntity({ ...(entityNamed(session, "speaker1") as Speaker), pitchSignal: A });
    expect(session.document.text).toBe('circuit "Empty" {\n    speaker speaker1 at (40, 80) {\n        pitch = virtual:signal-A\n    }\n}\n');
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
  const POLES = `circuit "Poles" {
    pole p at (40, 80) tile (4.5, 0.5) {
    }

    lamp light at (300, 80) tile (5.5, 0.5) {
    }

    pole free at (560, 80) {
    }
}
`;
  const pole = (session: ProjectSession, name: string): Pole => entityNamed(session, name) as Pole;

  it("is written unless it is the small pole, and a pole without a tile just changes", () => {
    const { session } = createSession(POLES);
    session.commands.updateEntity({ ...pole(session, "free"), prototype: "substation" });
    expect(session.document.text).toContain("    pole free at (560, 80) {\n        prototype = substation\n    }\n");
    // Back to the small pole: the statement that is there says so (the language patches a value, it does not remove a statement for it).
    session.commands.updateEntity({ ...pole(session, "free"), prototype: "small-electric-pole" });
    expect(session.document.text).toContain("    pole free at (560, 80) {\n        prototype = small-electric-pole\n    }\n");
    session.commands.undo();
    session.commands.undo();
    expect(session.document.text).toBe(POLES);
  });

  it("keeps the top-left tile of a pole that has a tile: the center moves with the footprint, in the same step", () => {
    const { session } = createSession(POLES.replace("tile (5.5, 0.5)", "tile (7.5, 0.5)"));
    session.commands.updateEntity({ ...pole(session, "p"), prototype: "big-electric-pole" });
    // On the tile (4, 0) a 2x2 pole covers (4..5, 0..1); its center is (5, 1).
    expect(session.document.text).toContain("    pole p at (40, 80) tile (5, 1) {\n        prototype = big-electric-pole\n    }\n");
    expect(session.state.diagnostics).toEqual([]);
    session.commands.updateEntity({ ...pole(session, "p"), prototype: "substation" });
    expect(session.document.text).toContain("    pole p at (40, 80) tile (5, 1) {\n        prototype = substation\n    }\n");
    session.commands.updateEntity({ ...pole(session, "p"), prototype: "medium-electric-pole" });
    expect(session.document.text).toContain("    pole p at (40, 80) tile (4.5, 0.5) {\n        prototype = medium-electric-pole\n    }\n");
    session.commands.undo();
    session.commands.undo();
    session.commands.undo();
    expect(session.document.text).toContain("    pole p at (40, 80) tile (4.5, 0.5) {\n    }\n");
    expect(session.state.canUndo).toBe(false);
  });

  it("is refused on the board when the bigger footprint would cover a tile of another entity, and warned about on the edit canvas", () => {
    const { session } = createSession(POLES);
    session.commands.select([idOf(session, "p")]);
    session.commands.setDisplayMode("blueprint");
    session.commands.updateEntity({ ...pole(session, "p"), prototype: "big-electric-pole" });
    expect(session.state.error).toBe("Not changed: p would stand on a tile of light.");
    expect(session.document.text).toBe(POLES);
    expect(session.state.canUndo).toBe(false);
    // A prototype of the same size is no problem, and the message about the refused change goes with the edit.
    session.commands.updateEntity({ ...pole(session, "p"), prototype: "medium-electric-pole" });
    expect(session.state.error).toBeNull();
    expect(session.document.text).toContain("tile (4.5, 0.5) {\n        prototype = medium-electric-pole");
    // The message is about the selected entity: it goes when something else is selected.
    session.commands.updateEntity({ ...pole(session, "p"), prototype: "substation" });
    expect(session.state.error).toBe("Not changed: p would stand on a tile of light.");
    session.commands.select([idOf(session, "light")]);
    expect(session.state.error).toBeNull();
    // On the edit canvas nothing is refused, as for a turn: the overlap is in the problems list.
    session.commands.setDisplayMode("edit");
    session.commands.updateEntity({ ...pole(session, "p"), prototype: "big-electric-pole" });
    expect(session.state.error).toBeNull();
    expect(session.document.text).toContain("tile (5, 1) {\n        prototype = big-electric-pole");
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["tile-overlap", "tile-overlap"]);
  });
});

describe("placing with a prototype", () => {
  const EMPTY = 'circuit "Empty" {\n}\n';

  it("places the prototype of the tool on the edit canvas and names the entity after its kind", () => {
    const { session } = createSession(EMPTY);
    session.commands.setTool({ type: "place", kind: "pole", prototype: "big-electric-pole" });
    expect(session.state.tool).toEqual({ type: "place", kind: "pole", prototype: "big-electric-pole" });
    session.commands.placeEntity("pole", { x: 40, y: 80 }, "south", "big-electric-pole");
    session.commands.placeEntity("pole", { x: 300, y: 80 });
    session.commands.placeEntity("speaker", { x: 560, y: 80 }, undefined, "programmable-speaker");
    session.commands.placeEntity("lamp", { x: 820, y: 80 }, undefined, "small-lamp");
    expect(session.document.text).toBe(
      'circuit "Empty" {\n    pole pole1 at (40, 80) {\n        prototype = big-electric-pole\n    }\n\n    pole pole2 at (300, 80) {\n    }\n\n    speaker speaker1 at (560, 80) {\n    }\n\n    lamp lamp1 at (820, 80) {\n    }\n}\n',
    );
    expect(session.state.selection).toEqual([idOf(session, "lamp1")]);
    expect(session.state.tool).toEqual({ type: "select" });
    // A prototype of another kind is refused and reported.
    session.commands.placeEntity("lamp", { x: 0, y: 0 }, undefined, "substation");
    expect(session.state.error).toMatch(/'substation' is not a lamp/);
  });

  it("places a 2x2 pole on free tiles only, with the center of its four tiles", () => {
    const { session } = createSession(EMPTY);
    session.commands.setDisplayMode("blueprint");
    session.commands.placeEntityOnTile("pole", { x: 3, y: 1 }, undefined, "substation");
    expect(session.document.text).toContain("pole pole1 at (180, 0) tile (3, 1) {\n        prototype = substation\n    }");
    // Any footprint that touches one of its four tiles (2..3, 0..1) is refused, without a message, like every taken tile.
    const before = session.document.text;
    session.commands.placeEntityOnTile("pole", { x: 4, y: 2 }, undefined, "big-electric-pole");
    session.commands.placeEntityOnTile("lamp", { x: 3.5, y: 1.5 });
    session.commands.placeEntityOnTile("pole", { x: 2.5, y: 0.5 });
    expect(session.document.text).toBe(before);
    expect(session.state.error).toBeNull();
    session.commands.placeEntityOnTile("pole", { x: 5, y: 1 }, undefined, "big-electric-pole");
    session.commands.placeEntityOnTile("pole", { x: 1.5, y: 0.5 }, undefined, "medium-electric-pole");
    expect(session.state.circuit.entities.map((entity) => [entity.name, entity.placement?.tile])).toEqual([["pole1", { x: 3, y: 1 }], ["pole2", { x: 5, y: 1 }], ["pole3", { x: 1.5, y: 0.5 }]]);
    expect(session.state.diagnostics).toEqual([]);
  });
});
