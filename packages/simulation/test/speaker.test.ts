// The programmable speaker (rules SP-*, fixture F-25). Nothing sounds: the state says what the game would start to play.
import type { Comparator, SignalId, Speaker } from "@face/model";
import { describe, expect, it } from "vitest";
import { compile, runFixture, validateFixture, type ConformanceFixture } from "../src/index.ts";
import { signalVolume } from "../src/speaker.ts";
import { ANYTHING, EACH, EVERYTHING, INSTRUMENTS, WITH_INSTRUMENTS, arithmetic, circuit, constant, pole, simulate, sig, speaker, speakerState, v, wire } from "./helpers.ts";

const when = (first: string | SignalId | undefined, comparator: Comparator, second: number | string): Speaker["condition"] => ({
  ...(first !== undefined && { first: sig(first) }),
  comparator,
  second: typeof second === "number" ? { type: "constant", value: second } : { type: "signal", signal: sig(second) },
});
const SILENT = { playing: false };
const env = { environment: WITH_INSTRUMENTS };

describe("speaker condition", () => {
  it("F-25 assumption: plays at every tick at which the condition holds, from the content of that tick", () => {
    const s = speaker("s", { condition: when("A", ">", 3) });
    expect(speakerState(s, { red: { A: 5 } })).toEqual({ playing: true, volume: 100, alert: false });
    expect(speakerState(s, { red: { A: 3 } })).toEqual(SILENT);
    expect(speakerState(speaker("s", { condition: when("A", "<", "B") }), { red: { A: 5 }, green: { B: 6 } })).toMatchObject({ playing: true });
    // A counter behind a combinator: the speaker follows the network tick by tick and is reported while the condition holds.
    const c = circuit([constant("c", { A: 1 }), arithmetic("a", "A", "+", "B", "B"), speaker("s", { condition: when("B", ">=", 2) })], [wire("red", "c.out", "a.in"), wire("green", "a.out", "a.in"), wire("green", "a.out", "s.in")]);
    const simulation = simulate(c);
    const playing: boolean[] = [];
    for (let tick = 0; tick <= 4; tick++) {
      playing.push(simulation.snapshot().entities.s!.speaker!.playing);
      simulation.step();
    }
    expect(playing).toEqual([false, false, true, true, true]);
  });

  it("F-25: without a circuit wire a speaker makes no sound", () => {
    expect(speakerState(speaker("s", { condition: when("A", "=", 0) }))).toEqual(SILENT);
    expect(speakerState(speaker("s", { condition: when("A", "=", 0) }), { green: { B: 1 } })).toMatchObject({ playing: true });
  });

  it("F-25 assumption: the condition of a new speaker (no first signal) and a speaker without one never play", () => {
    expect(speakerState(speaker("s", { condition: when(undefined, "<", 1) }), { red: { A: 5 } })).toEqual(SILENT);
    expect(speakerState(speaker("s"), { red: { A: 5 } })).toEqual(SILENT);
  });

  it("F-25 assumption: reads the sum of red and green, and everything and anything work as in a lamp", () => {
    expect(speakerState(speaker("s", { condition: when("A", "=", 0) }), { red: { A: 5 }, green: { A: -5 } })).toMatchObject({ playing: true });
    const feed = { red: { A: 5, B: 9 } };
    expect(speakerState(speaker("s", { condition: when(EVERYTHING, ">", 4) }), feed).playing).toBe(true);
    expect(speakerState(speaker("s", { condition: when(EVERYTHING, ">", 5) }), feed).playing).toBe(false);
    expect(speakerState(speaker("s", { condition: when(ANYTHING, ">", 8) }), feed).playing).toBe(true);
    expect(speakerState(speaker("s", { condition: when(ANYTHING, ">", 9) }), feed).playing).toBe(false);
  });

  it("F-25 assumption: each, a wildcard on the right and wildcard pitch or volume signals make the speaker invalid and silent", () => {
    const invalid = [
      speaker("s", { condition: when(EACH, ">", 0) }),
      speaker("s", { condition: { first: sig("A"), comparator: ">", second: { type: "signal", signal: ANYTHING } } }),
      speaker("s", { pitchSignal: EVERYTHING }),
      speaker("s", { condition: when("A", ">", 0), volumeSignal: EACH }),
    ];
    for (const entity of invalid) {
      expect(compile(circuit([entity])).notes.map((n) => [n.severity, n.code])).toContainEqual(["error", "invalid-wildcard"]);
      expect(speakerState(entity, { red: { A: 5 }, ...env })).toEqual(SILENT);
    }
  });

  it("emits nothing and counts in the totals", () => {
    const c = circuit([constant("c", { A: 1 }), speaker("on", { condition: when("A", ">", 0) }), speaker("off", { condition: when("A", ">", 1) }), pole("p")], [wire("red", "c.out", "p"), wire("red", "p", "on.in"), wire("red", "p", "off.in")]);
    const snapshot = simulate(c).snapshot();
    expect(Object.keys(snapshot.entities.on!).sort()).toEqual(["input", "kind", "speaker"]);
    expect(snapshot.totals).toEqual({ entities: 4, networks: 1, signals: 1, emitting: 1, lampsLit: 0, speakersPlaying: 1 });
    expect(compile(c).networks[0]).toMatchObject({ emitters: ["c"], readers: ["off", "on", "p"] });
  });

  it("shares the state object between ticks while nothing about the sound changes", () => {
    const simulation = simulate(circuit([constant("c", { A: 1 }), speaker("s", { condition: when("A", ">", 0) })], [wire("red", "c.out", "s.in")]));
    const first = simulation.snapshot().entities.s;
    simulation.step(3);
    expect(simulation.snapshot().entities.s).toBe(first);
  });
});

describe("speaker sound", () => {
  it("F-25 assumption: names the sound it is set to; without names the first instrument and its first note of the game data", () => {
    const feed = { red: { A: 1 }, ...env };
    expect(speakerState(speaker("s", { condition: when("A", ">", 0), instrument: "piano", note: "G3" }), feed)).toEqual({ playing: true, instrument: "piano", note: "G3", volume: 100, alert: false });
    expect(speakerState(speaker("s", { condition: when("A", ">", 0) }), feed)).toMatchObject({ instrument: "alarms", note: "alarm-1" });
    expect(speakerState(speaker("s", { condition: when("A", ">", 0), instrument: "piano" }), feed)).toMatchObject({ instrument: "piano", note: "F3" });
    expect(speakerState(speaker("s", { condition: when("A", ">", 0), note: "siren" }), feed)).toMatchObject({ instrument: "alarms", note: "siren" });
    // Names the environment does not know are reported as written; without game data a speaker without names has none.
    expect(speakerState(speaker("s", { condition: when("A", ">", 0), instrument: "organ", note: "C1" }), feed)).toMatchObject({ playing: true, instrument: "organ", note: "C1" });
    expect(speakerState(speaker("s", { condition: when("A", ">", 0), instrument: "organ" }), feed)).toEqual({ playing: true, instrument: "organ", volume: 100, alert: false });
    expect(speakerState(speaker("s", { condition: when("A", ">", 0) }), { red: { A: 1 } })).toEqual({ playing: true, volume: 100, alert: false });
  });

  it("F-25 assumption: with a pitch signal the value picks the note, 1 being the first; 0 and values beyond the list play nothing", () => {
    const piano = speaker("s", { pitchSignal: sig("P"), instrument: "piano", note: "G3" });
    const at = (value: number) => speakerState(piano, { red: { P: value, A: 9 }, ...env });
    expect(at(1)).toEqual({ playing: true, instrument: "piano", note: "F3", volume: 100, alert: false });
    expect([at(2).note, at(3).note, at(4).note]).toEqual(["F#3", "G3", "G#3"]);
    for (const value of [5, 100, -1, -2147483648, 2147483647]) expect(at(value)).toEqual(SILENT);
    expect(speakerState(piano, { red: { A: 9 }, ...env })).toEqual(SILENT);
    // Red and green add up, and without an instrument name the first instrument is played.
    expect(speakerState(piano, { red: { P: 1 }, green: { P: 2 }, ...env }).note).toBe("G3");
    expect(speakerState(speaker("s", { pitchSignal: sig("P") }), { red: { P: 3 }, ...env })).toMatchObject({ instrument: "alarms", note: "siren" });
    expect(INSTRUMENTS[1]!.notes).toHaveLength(4);
  });

  it("F-25 assumption: a pitch signal without the notes of the instrument picks nothing, with a note", () => {
    const unknown = speaker("s", { pitchSignal: sig("P"), instrument: "organ" });
    expect(speakerState(unknown, { red: { P: 1 }, ...env })).toEqual(SILENT);
    expect(compile(circuit([unknown]), WITH_INSTRUMENTS).notes).toEqual([{ severity: "warning", code: "missing-instruments", message: 'The notes of the instrument "organ" are not known; the pitch signal picks nothing.', entity: "s" }]);
    const first = speaker("s", { pitchSignal: sig("P") });
    expect(speakerState(first, { red: { P: 1 } })).toEqual(SILENT);
    expect(compile(circuit([first])).notes.map((n) => n.message)).toEqual(["The notes of the first instrument are not known; the pitch signal picks nothing."]);
    expect(compile(circuit([first]), WITH_INSTRUMENTS).notes).toEqual([]);
    // A condition next to a pitch signal is not used.
    const both = speaker("s", { pitchSignal: sig("P"), condition: when("A", ">", 100) });
    expect(speakerState(both, { red: { P: 2 }, ...env })).toMatchObject({ playing: true, note: "alarm-2" });
    expect(compile(circuit([both]), WITH_INSTRUMENTS).notes.map((n) => n.code)).toEqual(["unconfigured"]);
  });

  it("F-25: the volume is the percentage set, or the value of the volume signal clamped to 0..100", () => {
    const fixed = speaker("s", { condition: when("A", ">", 0), volume: 12.5 });
    expect(speakerState(fixed, { red: { A: 1 } }).volume).toBe(12.5);
    const bySignal = speaker("s", { condition: when("A", ">", 0), volume: 12.5, volumeSignal: sig("V") });
    const at = (value: number) => speakerState(bySignal, { red: { A: 1 }, green: { V: value } });
    expect([at(40).volume, at(100).volume, at(101).volume, at(2147483647).volume, at(-5).volume]).toEqual([40, 100, 100, 100, 0]);
    // F-25 assumption: a volume of 0, also from an absent signal, is still a sound that is played.
    expect(speakerState(bySignal, { red: { A: 1 } })).toEqual({ playing: true, volume: 0, alert: false });
    expect([signalVolume(-1), signalVolume(0), signalVolume(55), signalVolume(100), signalVolume(1e9)]).toEqual([0, 0, 55, 100, 100]);
  });

  it("F-25: shows the alert while a sound is played", () => {
    const alerting = speaker("s", { condition: when("A", ">", 0), showAlert: true, alertMessage: "now", alertIcon: sig("A") });
    expect(speakerState(alerting, { red: { A: 1 } })).toEqual({ playing: true, volume: 100, alert: true });
    expect(speakerState(alerting, { red: { A: 0, B: 1 } })).toEqual(SILENT);
  });

  it("F-25 assumption: playback mode, polyphony and stop-playing-sounds do not change what is reported", () => {
    const plain = speakerState(speaker("s", { condition: when("A", ">", 0) }), { red: { A: 1 } });
    for (const props of [{ playbackMode: "global" }, { playbackMode: "surface" }, { allowPolyphony: true }, { stopPlayingSounds: true }, { showOnMap: false }] as const) {
      expect(speakerState(speaker("s", { condition: when("A", ">", 0), ...props }), { red: { A: 1 } })).toEqual(plain);
    }
  });
});

describe("speaker in fixtures", () => {
  const fixture: ConformanceFixture = {
    format: 1, id: "inline", covers: ["F-25"], title: "inline", provenance: "assumed", ticks: 1, environment: { instruments: INSTRUMENTS },
    circuit: circuit([constant("c", { P: 2 }), speaker("s", { pitchSignal: sig("P"), instrument: "piano" }), speaker("t", { condition: when("P", ">", 5) })], [wire("red", "c.out", "s.in"), wire("red", "c.out", "t.in")]),
    expect: [{ tick: 0, through: 1, speakers: { s: { playing: true, instrument: "piano", note: "F#3", volume: 100, alert: false }, t: { playing: false } }, outputs: { c: v({ P: 2 }) } }],
  };

  it("checks the listed fields of a speaker", () => {
    expect(validateFixture(fixture)).toEqual([]);
    expect(runFixture(fixture)).toEqual([]);
    const wrong = runFixture({ ...fixture, ticks: 0, expect: [{ tick: 0, speakers: { s: { playing: false, note: "G3" }, t: { playing: false, volume: 3 }, c: { playing: true } } }] });
    expect(wrong.map((f) => `${f.target}: ${f.message}`)).toEqual(['speaker s: expected playing false, got true', 'speaker s: expected note "G3", got "F#3"', "speaker t: expected volume 3, got undefined", "speaker c: no such speaker"]);
    expect(validateFixture({ ...fixture, expect: [{ tick: 0, speakers: { s: { note: "G3" } } }] })).toEqual(["expect[0].speakers.s needs playing"]);
  });
});
