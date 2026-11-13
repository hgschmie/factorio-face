// Electric poles and the programmable speaker: declarations, the bare terminal of a pole, their diagnostics, the canonical
// printer, completion and the edit commands.
import { DEFAULT_ENTITY, prototypesOf, type Entity, type EntityOfKind, type SignalId, type SpeakerInstrument } from "@face/model";
import { describe, expect, it } from "vitest";
import { analyze, analyzeFragment, applyChanges, checkEntity, completionContext, executeCommand, extractFragment, isKeyword, parse, printCircuit, printFragment, printTerminal, type Completion, type CstWire, type EditCommand } from "../src/index.ts";
import { circuit, idOf, valid } from "./helpers.ts";

const A: SignalId = { kind: "virtual", name: "signal-A" };
const INSTRUMENTS: readonly SpeakerInstrument[] = [{ name: "alarms", notes: ["alarm-1", "siren"] }, { name: "piano", notes: ["F3", "F#3", "G3"] }];

function entity<K extends Entity["kind"]>(declaration: string, kind: K): EntityOfKind<K> {
  const found = valid(circuit(declaration)).circuit.entities[0]!;
  expect(found.kind).toBe(kind);
  return found as EntityOfKind<K>;
}

const diagnostics = (source: string, options?: Parameters<typeof analyze>[2]) => analyze(source, undefined, options).diagnostics.map((d) => [d.code, d.message]);
const codes = (source: string, options?: Parameters<typeof analyze>[2]) => diagnostics(source, options).map(([code]) => code);

/** Runs a command on `source` and returns the new source. */
function run(source: string, command: (parsed: ReturnType<typeof valid>) => EditCommand): string {
  const parsed = valid(source);
  const result = executeCommand(parsed, command(parsed));
  if (!result.ok) throw new Error(result.message);
  return applyChanges(source, result.changes);
}

const CHAIN = circuit(
  [
    "    constant source tile (0.5, 0.5) {",
    "        virtual:signal-A = 1",
    "    }",
    "    pole p1 tile (4.5, 0.5) {",
    "    }",
    "    pole p2 tile (10, 1) {",
    "        prototype = big-electric-pole",
    "    }",
    "    lamp light tile (14.5, 0.5) {",
    "        when virtual:signal-A > 0",
    "    }",
    "    wire red source.out <-> p1",
    "    wire red p1 <-> p2",
    "    wire red p2 <-> light.in",
  ].join("\n"),
);

describe("reserved words", () => {
  it("reserves the two kind words", () => {
    expect([isKeyword("pole"), isKeyword("speaker")]).toEqual([true, true]);
    expect(codes(circuit("lamp pole { }"))).toEqual(["syntax-error"]);
    expect(diagnostics(circuit("lamp speaker { }"))[0]![1]).toBe("'speaker' is a reserved keyword and cannot be used as an entity name");
    // The names of their properties are not reserved.
    expect(codes(circuit("lamp prototype { }\nlamp pitch { }\nlamp note { }\nlamp volume { }"))).toEqual([]);
  });
});

describe("pole", () => {
  it("is a small electric pole unless it says which prototype it is", () => {
    expect(entity("pole p at (20, 40) { }", "pole")).toEqual({ id: "e1", name: "p", position: { x: 20, y: 40 }, kind: "pole", prototype: "small-electric-pole" });
    for (const prototype of prototypesOf("pole")) expect(entity(`pole p { prototype = ${prototype} }`, "pole").prototype).toBe(prototype);
    expect(entity('pole p tile (2, 2) { prototype = substation description = "hub" }', "pole")).toMatchObject({ prototype: "substation", description: "hub", placement: { tile: { x: 2, y: 2 } } });
    // No configuration is needed: an empty pole is complete.
    expect(codes(circuit("pole p { }"))).toEqual([]);
  });

  it("rejects an unknown prototype and everything a pole does not take", () => {
    expect(diagnostics(circuit("pole p { prototype = small-lamp }"))).toEqual([["invalid-value", "Invalid value 'small-lamp' for 'prototype'; expected one of small-electric-pole, medium-electric-pole, big-electric-pole, substation"]]);
    expect(diagnostics(circuit("pole p { prototype = big-electric-pole prototype = substation }"))).toEqual([["duplicate-statement", "Duplicate property 'prototype'"]]);
    expect(diagnostics(circuit("pole p { enabled = true }"))).toEqual([["unknown-property", "Unknown property 'enabled' in an electric pole; expected one of description, prototype"]]);
    expect(diagnostics(circuit("pole p { when virtual:signal-A > 1 }"))).toEqual([["invalid-statement", "An electric pole does not take a 'when' statement"]]);
    expect(diagnostics(circuit("pole p { virtual:signal-A = 1 }"))).toEqual([["invalid-statement", "An electric pole does not take signal assignments"]]);
    // A kind with one prototype has no such property.
    expect(codes(circuit("lamp l { prototype = small-lamp }"))).toEqual(["unknown-property"]);
  });

  it("prints the prototype unless it is the default", () => {
    const parsed = valid(CHAIN);
    expect(printCircuit(parsed.circuit).split("\n\n").slice(1, 3)).toEqual(["    pole p1 at (280, 40) tile (4.5, 0.5) {\n    }", "    pole p2 at (520, 40) tile (10, 1) {\n        prototype = big-electric-pole\n    }"]);
    expect(printCircuit(parsed.circuit)).toContain("\n\n    wire red source.out <-> p1\n    wire red p1 <-> p2\n    wire red p2 <-> light.in\n}\n");
    expect(valid(printCircuit(parsed.circuit)).circuit.entities.map((e) => (e.kind === "pole" ? e.prototype : e.kind))).toEqual(["constant", "small-electric-pole", "big-electric-pole", "lamp"]);
    expect(checkEntity({ ...DEFAULT_ENTITY.pole, id: "x", name: "p", position: { x: 0, y: 0 }, prototype: "substation" })).toEqual({ ok: true });
  });
});

describe("the terminal of a pole", () => {
  it("is the bare entity name, on either end of a wire", () => {
    const parsed = valid(CHAIN);
    const [source, p1, p2, light] = ["source", "p1", "p2", "light"].map((name) => idOf(parsed, name)) as [string, string, string, string];
    expect(parsed.circuit.wires).toEqual([
      { color: "red", a: { entity: source, side: "out" }, b: { entity: p1, side: "io" } },
      { color: "red", a: { entity: p1, side: "io" }, b: { entity: p2, side: "io" } },
      { color: "red", a: { entity: p2, side: "io" }, b: { entity: light, side: "in" } },
    ]);
    const wires = parse(CHAIN).cst.circuit!.members.filter((member): member is CstWire => member.type === "wire");
    expect(wires.map((wire) => [wire.a?.side?.text, wire.b?.dot?.text, wire.b?.side?.text])).toEqual([["out", undefined, undefined], [undefined, undefined, undefined], [undefined, ".", "in"]]);
    expect([printTerminal("p1", "io"), printTerminal("light", "in"), printTerminal("source", "out")]).toEqual(["p1", "light.in", "source.out"]);
    // The source map has the terminal with the range of the name.
    const declaration = parsed.sourceMap.wires.get(`red|${p1}.io|${p2}.io`)!.declarations[0]!;
    expect([CHAIN.slice(declaration.a.range.from, declaration.a.range.to), declaration.a.side, CHAIN.slice(declaration.b.nameRange.from, declaration.b.nameRange.to)]).toEqual(["p1", "io", "p2"]);
  });

  it("joins both colors and takes several wires of one color", () => {
    const parsed = valid(circuit("pole a { }\npole b { }\nlamp l { }\nwire red a <-> b\nwire green a <-> b\nwire red a <-> l.in\nwire green l.in <-> a"));
    expect(parsed.circuit.wires).toHaveLength(4);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("says how each kind is wired when the form does not fit", () => {
    const source = "pole p { }\nlamp l { }\nconstant c { item:a = 1 }\nselector s { }\n";
    expect(diagnostics(circuit(`${source}wire red p.in <-> l.in`))).toEqual([["invalid-terminal", "An electric pole has no 'in' terminal; write the bare name 'p'"]]);
    expect(diagnostics(circuit(`${source}wire red c.out <-> p.out`))).toEqual([["invalid-terminal", "An electric pole has no 'out' terminal; write the bare name 'p'"]]);
    expect(diagnostics(circuit(`${source}wire red p <-> l`))).toEqual([["invalid-terminal", "A lamp is wired at a terminal: write 'l.in'"]]);
    expect(diagnostics(circuit(`${source}wire red c <-> s`))).toEqual([["invalid-terminal", "A constant combinator is wired at a terminal: write 'c.out'"], ["invalid-terminal", "A selector combinator is wired at a terminal: write 's.in' or 's.out'"]]);
    expect(diagnostics(circuit(`${source}wire red l.out <-> p`))).toEqual([["invalid-terminal", "A lamp has no 'out' terminal"]]);
    expect(diagnostics(circuit(`${source}wire red p.io <-> l.in`))).toEqual([["unknown-terminal", "Unknown terminal 'io'; expected 'in' or 'out'"]]);
    expect(codes(circuit(`${source}wire red p <-> p`))).toEqual(["self-wire"]);
    expect(codes(circuit(`${source}wire red nope <-> p`))).toEqual(["unknown-entity"]);
    expect(codes(circuit(`${source}wire red p <-> l.in\nwire red l.in <-> p\nwire red p <-> l.in`))).toEqual(["duplicate-wire", "duplicate-wire"]);
    // A dot without a side stays a syntax error, and the wire is dropped.
    expect(diagnostics(circuit(`${source}wire red p. <-> l.in`))).toEqual([["syntax-error", "Expected 'in' or 'out' but found '<->'"]]);
    expect(diagnostics(circuit(`${source}wire red p l.in`))).toEqual([["syntax-error", "Expected '<->' but found 'l'"]]);
  });

  it("is offered by completion as the bare name, and '<->' follows it", () => {
    const at = (text: string): readonly Completion[] => {
      const offset = text.indexOf("|");
      const source = text.replace("|", "");
      return completionContext(analyze(source), offset).expected;
    };
    const source = "pole p { }\nlamp l { }\n";
    expect(at(circuit(`${source}wire red |`))).toEqual([{ type: "terminal", entities: [{ name: "p", kind: "pole", sides: ["io"] }, { name: "l", kind: "lamp", sides: ["in"] }] }]);
    expect(at(circuit(`${source}wire red p |`))).toEqual([{ type: "keyword", values: ["<->"] }]);
    expect(at(circuit(`${source}wire red p <-> |`))).toMatchObject([{ type: "terminal" }]);
    // Behind a dot only `in` and `out` are written; a pole has neither.
    expect(at(circuit(`${source}wire red p.|`))).toEqual([{ type: "side", entity: "p", sides: [] }]);
    expect(at(circuit(`${source}wire red nope.|`))).toEqual([{ type: "side", entity: "nope", sides: ["in", "out"] }]);
    expect(at(circuit("pole p { prototype = | }"))).toEqual([{ type: "enum", property: "prototype", values: ["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"] }]);
    expect(at(circuit("pole p { | }"))).toEqual([{ type: "property", kind: "pole", names: ["description", "prototype"] }]);
  });
});

describe("placement of poles and speakers", () => {
  it("puts a 2x2 pole on whole coordinates and names what it needs", () => {
    const big = (tile: string, prototype = "big-electric-pole") => circuit(`pole p tile ${tile} { prototype = ${prototype} }`);
    expect(codes(big("(4, -1)"))).toEqual([]);
    expect(diagnostics(big("(4.5, -1.5)"))).toEqual([["tile-off-grid", "Not on the tile grid: the center of this big electric pole, which covers 2 x 2 tiles, needs a whole x and a whole y; the nearest is (5, -1)"]]);
    expect(diagnostics(big("(0.5, 1)", "substation"))).toEqual([["tile-off-grid", "Not on the tile grid: the center of this substation, which covers 2 x 2 tiles, needs a whole x and a whole y; the nearest is (1, 1)"]]);
    expect(diagnostics(big("(4, -1)", "small-electric-pole"))).toEqual([["tile-off-grid", "Not on the tile grid: the center of this small electric pole needs x and y ending in .5; the nearest is (4.5, -0.5)"]]);
    expect(diagnostics(circuit("speaker s tile (1, 1.5) { when virtual:signal-A > 0 }"))).toEqual([["tile-off-grid", "Not on the tile grid: the center of this programmable speaker needs x and y ending in .5; the nearest is (1.5, 1.5)"]]);
  });

  it("counts all four tiles of a big pole for an overlap", () => {
    const source = circuit("pole big tile (1, 1) { prototype = big-electric-pole }\nlamp a tile (1.5, 1.5) { }\nlamp b tile (2.5, 0.5) { }\nspeaker c tile (0.5, 0.5) { when virtual:signal-A > 0 }");
    expect(diagnostics(source)).toEqual([
      ["tile-overlap", "Stands on a tile that 'c' and 'a' stand on as well; in the game two entities cannot share a tile"],
      ["tile-overlap", "Stands on a tile that 'big' stands on as well; in the game two entities cannot share a tile"],
      ["tile-overlap", "Stands on a tile that 'big' stands on as well; in the game two entities cannot share a tile"],
    ]);
  });

  it("warns about facing on an entity that does not turn", () => {
    expect(diagnostics(circuit("pole p facing north { }"))).toEqual([["unused-facing", "An electric pole cannot be rotated; 'facing' is ignored"]]);
    expect(diagnostics(circuit("speaker s facing west { when virtual:signal-A > 0 }"))).toEqual([["unused-facing", "A programmable speaker cannot be rotated; 'facing' is ignored"]]);
  });
});

describe("wire reach with poles", () => {
  const wired = (pole: string, lamp: string, prototype = "small-electric-pole") => circuit(`pole p tile ${pole} { prototype = ${prototype} }\nlamp l tile ${lamp} { }\nwire red p <-> l.in`);

  it("gives a wire to a small pole the pole's 7.5 tiles and says so", () => {
    expect(codes(wired("(0.5, 0.5)", "(8.5, 0.5)"))).toEqual([]);
    expect(diagnostics(wired("(0.5, 0.5)", "(9.5, 0.5)"))).toEqual([["wire-too-long", "Wire from 'p' to 'l.in': the entities are 8 tiles apart; the wire reach of a small electric pole is 7.5"]]);
    // In a project without a limit the pole still has its reach, and a smaller project reach wins over it.
    expect(diagnostics(wired("(0.5, 0.5)", "(9.5, 0.5)"), { wireReach: 0 })).toEqual([["wire-too-long", "Wire from 'p' to 'l.in': the entities are 8 tiles apart; the wire reach of a small electric pole is 7.5"]]);
    expect(diagnostics(wired("(0.5, 0.5)", "(6.5, 0.5)"), { wireReach: 4 })).toEqual([["wire-too-long", "Wire from 'p' to 'l.in': the entities are 5 tiles apart; the wire reach of the project is 4"]]);
  });

  it("limits a wire from a big pole to another entity by the project, and one between two big poles by the poles", () => {
    expect(diagnostics(wired("(1, 1)", "(12.5, 0.5)", "big-electric-pole"))).toEqual([["wire-too-long", "Wire from 'p' to 'l.in': the entities are 10 tiles apart; the wire reach of the project is 9"]]);
    expect(codes(wired("(1, 1)", "(11.5, 0.5)", "big-electric-pole"))).toEqual([]);
    const poles = (x: number, a = "big-electric-pole", b = "big-electric-pole") => circuit(`pole a tile (1, 1) { prototype = ${a} }\npole b tile (${x}, 1) { prototype = ${b} }\nwire green a <-> b`);
    for (const wireReach of [9, 0, 2]) expect(codes(poles(35), { wireReach })).toEqual([]);
    expect(diagnostics(poles(36))).toEqual([["wire-too-long", "Wire from 'a' to 'b': the entities are 33 tiles apart; the wire reach of a big electric pole is 32"]]);
    expect(diagnostics(poles(22, "big-electric-pole", "substation"))).toEqual([["wire-too-long", "Wire from 'a' to 'b': the entities are 19 tiles apart; the wire reach of a substation is 18"]]);
    expect(codes(poles(21, "substation", "big-electric-pole"))).toEqual([]);
  });

  it("measures the chain of the example without a warning", () => {
    expect(valid(CHAIN).diagnostics).toEqual([]);
  });
});

describe("speaker", () => {
  it("has the defaults of a new speaker in the game", () => {
    expect(entity("speaker s at (0, 0) { when virtual:signal-A > 0 }", "speaker")).toEqual({
      id: "e1", name: "s", position: { x: 0, y: 0 }, kind: "speaker", condition: { first: A, comparator: ">", second: { type: "constant", value: 0 } },
      volume: 100, playbackMode: "local", allowPolyphony: false, stopPlayingSounds: false, showAlert: false, showOnMap: true, alertMessage: "",
    });
    expect(diagnostics(circuit("speaker s { }"))).toEqual([["unconfigured", "This programmable speaker has neither a 'when' condition nor a 'pitch' signal; it never plays"]]);
  });

  it("reads every setting", () => {
    const speaker = entity(
      'speaker s { when anything <= virtual:signal-B instrument = piano note = "F#3" volume = 62.5 volume-signal = virtual:signal-V playback = global polyphony = true stop-playing-sounds = true show-alert = true show-on-map = false alert-icon = item:iron-plate alert-message = "Out of\\nplates" }',
      "speaker",
    );
    expect(speaker).toMatchObject({
      condition: { first: { kind: "virtual", name: "signal-anything" }, comparator: "<=", second: { type: "signal", signal: { kind: "virtual", name: "signal-B" } } },
      instrument: "piano", note: "F#3", volume: 62.5, volumeSignal: { kind: "virtual", name: "signal-V" }, playbackMode: "global", allowPolyphony: true, stopPlayingSounds: true,
      showAlert: true, showOnMap: false, alertIcon: { kind: "item", name: "iron-plate" }, alertMessage: "Out of\nplates",
    });
    expect(speaker.pitchSignal).toBeUndefined();
    const tune = entity("speaker t { pitch = virtual:signal-A instrument = \"drum-kit\" note = hat-1 playback = surface }", "speaker");
    expect(tune).toMatchObject({ pitchSignal: A, instrument: "drum-kit", note: "hat-1", playbackMode: "surface" });
    expect(tune.condition).toBeUndefined();
  });

  it("prints canonically: defaults omitted, names bare where they are one word", () => {
    const speaker: Entity = {
      ...DEFAULT_ENTITY.speaker, id: "x", name: "s", position: { x: 0, y: 0 }, condition: { first: A, comparator: ">", second: { type: "constant", value: 0 } },
      instrument: "piano", note: "F#3", volume: 12.5, volumeSignal: A, playbackMode: "surface", allowPolyphony: true, stopPlayingSounds: true, showAlert: true, showOnMap: false, alertIcon: A, alertMessage: 'a "b"',
    };
    expect(printCircuit({ name: "p", entities: [speaker, { ...DEFAULT_ENTITY.speaker, id: "y", name: "t", position: { x: 240, y: 0 }, pitchSignal: A, note: "true", instrument: "2 tone" }], wires: [] })).toBe(
      [
        'circuit "p" {',
        "    speaker s at (0, 0) {",
        "        when virtual:signal-A > 0",
        "        instrument = piano",
        '        note = "F#3"',
        "        volume = 12.5",
        "        volume-signal = virtual:signal-A",
        "        playback = surface",
        "        polyphony = true",
        "        stop-playing-sounds = true",
        "        show-alert = true",
        "        show-on-map = false",
        "        alert-icon = virtual:signal-A",
        '        alert-message = "a \\"b\\""',
        "    }",
        "",
        "    speaker t at (240, 0) {",
        "        pitch = virtual:signal-A",
        '        instrument = "2 tone"',
        '        note = "true"',
        "    }",
        "}",
        "",
      ].join("\n"),
    );
    expect(checkEntity(speaker)).toEqual({ ok: true });
    // A condition and a pitch signal together are not a configuration of the language.
    expect(checkEntity({ ...speaker, pitchSignal: A })).toMatchObject({ ok: false, code: "invalid-entity" });
    expect(checkEntity({ ...speaker, volume: 101 })).toMatchObject({ ok: false, code: "invalid-entity" });
  });

  it("reports what does not fit", () => {
    const body = (text: string, options?: Parameters<typeof analyze>[2]) => diagnostics(circuit(`speaker s { ${text} }`), options);
    expect(body("when virtual:signal-A > 0 pitch = virtual:signal-B")).toEqual([["contradictory-statement", "'pitch' takes the place of the 'when' condition: the value of the signal picks the note; remove one of the two"]]);
    expect(body("when virtual:signal-A > 0 and virtual:signal-B > 1")).toEqual([["syntax-error", "A speaker condition is a single comparison"]]);
    expect(body("when virtual:signal-A[red] > 0")).toEqual([["syntax-error", "A speaker condition signal takes no network selection"]]);
    expect(body("when each > 0")).toEqual([["illegal-wildcard", "The wildcard 'each' is not allowed here in a programmable speaker"]]);
    expect(body("when virtual:signal-A > anything")).toEqual([["illegal-wildcard", "The wildcard 'anything' is not allowed here in a programmable speaker"]]);
    expect(body("pitch = anything")).toEqual([["illegal-wildcard", "The wildcard 'anything' is not allowed in 'pitch'"]]);
    expect(body("pitch = virtual:signal-A volume-signal = each")).toEqual([["illegal-wildcard", "The wildcard 'each' is not allowed in 'volume-signal'"]]);
    for (const volume of ["-1", "100.5", "101"]) expect(body(`pitch = virtual:signal-A volume = ${volume}`)).toEqual([["invalid-value", "The volume is a percentage from 0 to 100"]]);
    for (const volume of ["0", "100", "0.5"]) expect(body(`pitch = virtual:signal-A volume = ${volume}`)).toEqual([]);
    expect(body("pitch = virtual:signal-A playback = universe")).toEqual([["invalid-value", "Invalid value 'universe' for 'playback'; expected one of local, surface, global"]]);
    expect(body("pitch = virtual:signal-A instrument = 5")).toEqual([["invalid-value", "Invalid value '5' for 'instrument'; expected an instrument name"]]);
    expect(body('pitch = virtual:signal-A note = ""')).toEqual([["invalid-value", "Invalid value '\"\"' for 'note'; expected a note name"]]);
    expect(body("pitch = virtual:signal-A networks = red")).toMatchObject([["unknown-property", expect.stringContaining("in a programmable speaker")]]);
    expect(body("output virtual:signal-A = 1")).toMatchObject([["unconfigured", expect.any(String)], ["invalid-statement", "A programmable speaker does not take 'output' statements"]]);
    expect(diagnostics(circuit("speaker s { pitch = virtual:signal-A }\nlamp l { }\nwire red s.out <-> l.in"))).toEqual([["invalid-terminal", "A programmable speaker has no 'out' terminal"]]);
    expect(diagnostics(circuit("speaker s { pitch = virtual:signal-A }\npole p { }\nwire red p <-> s"))).toEqual([["invalid-terminal", "A programmable speaker is wired at a terminal: write 's.in'"]]);
  });

  it("checks instrument and note against the game data when it is given", () => {
    const body = (text: string) => diagnostics(circuit(`speaker s { pitch = virtual:signal-A ${text} }`), { instruments: INSTRUMENTS });
    expect(body("instrument = piano note = \"F#3\"")).toEqual([]);
    expect(body("")).toEqual([]);
    expect(body("instrument = organ note = C4")).toEqual([["unknown-instrument", "Unknown instrument 'organ'; the game has alarms, piano"]]);
    expect(body("instrument = piano note = siren")).toEqual([["unknown-note", "The instrument 'piano' has no note 'siren'"]]);
    // Without an instrument the note is one of the first instrument.
    expect(body("note = siren")).toEqual([]);
    expect(body("note = F3")).toEqual([["unknown-note", "The instrument 'alarms' has no note 'F3'"]]);
    // Both are warnings: the circuit is there with the names as written. Without game data nothing is checked.
    const parsed = analyze(circuit("speaker s { pitch = virtual:signal-A instrument = organ }"), undefined, { instruments: INSTRUMENTS });
    expect(parsed.circuit?.entities[0]).toMatchObject({ instrument: "organ" });
    expect(diagnostics(circuit("speaker s { pitch = virtual:signal-A instrument = organ note = x }"))).toEqual([]);
  });

  it("completes its statements, the instrument and the notes of the instrument named", () => {
    const at = (text: string): readonly Completion[] => completionContext(analyze(text.replace("|", "")), text.indexOf("|")).expected;
    expect(at(circuit("speaker s { | }"))).toMatchObject([{ type: "keyword", values: ["when"] }, { type: "property", kind: "speaker" }]);
    expect(at(circuit("speaker s { when | }"))).toEqual([{ type: "signal", wildcards: ["anything", "everything"] }]);
    expect(at(circuit("speaker s { instrument = | }"))).toEqual([{ type: "instrument" }]);
    expect(at(circuit("speaker s { note = | }"))).toEqual([{ type: "note" }]);
    expect(at(circuit('speaker s { instrument = "drum-kit" note = | }'))).toEqual([{ type: "note", instrument: "drum-kit" }]);
    expect(at(circuit("speaker s { note = F| instrument = piano }"))).toEqual([{ type: "note", instrument: "piano" }]);
    expect(at(circuit("speaker s { playback = | }"))).toEqual([{ type: "enum", property: "playback", values: ["local", "surface", "global"] }]);
    expect(at(circuit("speaker s { volume = | }"))).toEqual([{ type: "literal", kind: "number" }]);
    expect(at(circuit("speaker s { alert-message = | }"))).toEqual([{ type: "literal", kind: "string" }]);
  });
});

describe("edit commands", () => {
  it("adds a pole of a prototype, with a tile on the grid of that prototype", () => {
    const added = run(CHAIN, () => ({ type: "addEntity", kind: "pole", position: { x: 20, y: 400 }, prototype: "substation", tile: { x: 20, y: 6 } }));
    expect(added).toContain("    pole pole1 at (20, 400) tile (20, 6) {\n        prototype = substation\n    }\n");
    expect(run(CHAIN, () => ({ type: "addEntity", kind: "pole", position: { x: 0, y: 0 }, tile: { x: 20.5, y: 6.5 } }))).toContain("pole pole1 at (0, 0) tile (20.5, 6.5) {\n    }");
    expect(run(CHAIN, () => ({ type: "addEntity", kind: "speaker", position: { x: 0, y: 0 }, facing: "north" }))).toContain("speaker speaker1 at (0, 0) {\n    }");
    const parsed = valid(CHAIN);
    expect(executeCommand(parsed, { type: "addEntity", kind: "pole", position: { x: 0, y: 0 }, prototype: "big-electric-pole", tile: { x: 20.5, y: 6.5 } })).toEqual({ ok: false, code: "invalid-position", message: "tile (20.5, 6.5) is not on the tile grid for a new big electric pole" });
    expect(executeCommand(parsed, { type: "addEntity", kind: "pole", position: { x: 0, y: 0 }, prototype: "small-lamp" })).toMatchObject({ ok: false, code: "invalid-entity" });
    expect(executeCommand(parsed, { type: "addEntity", kind: "lamp", position: { x: 0, y: 0 }, prototype: "substation" })).toMatchObject({ ok: false, code: "invalid-entity" });
  });

  it("wires, renames and deletes a pole through its bare name", () => {
    const wired = run(CHAIN, (parsed) => ({ type: "addWire", color: "green", a: { entity: idOf(parsed, "p1"), side: "io" }, b: { entity: idOf(parsed, "light"), side: "in" } }));
    expect(wired).toContain("    wire red p2 <-> light.in\n    wire green p1 <-> light.in\n");
    const parsed = valid(CHAIN);
    expect(executeCommand(parsed, { type: "addWire", color: "red", a: { entity: idOf(parsed, "p1"), side: "in" }, b: { entity: idOf(parsed, "light"), side: "in" } })).toMatchObject({ ok: false, code: "invalid-terminal" });
    expect(executeCommand(parsed, { type: "addWire", color: "red", a: { entity: idOf(parsed, "p1"), side: "io" }, b: { entity: idOf(parsed, "p1"), side: "io" } })).toMatchObject({ ok: false, code: "self-wire" });
    expect(executeCommand(parsed, { type: "addWire", color: "red", a: { entity: idOf(parsed, "p2"), side: "io" }, b: { entity: idOf(parsed, "p1"), side: "io" } })).toEqual({ ok: true, changes: [] });

    const renamed = run(CHAIN, (p) => ({ type: "renameEntity", id: idOf(p, "p1"), name: "relay" }));
    expect(renamed).toContain("pole relay tile (4.5, 0.5) {");
    expect(renamed).toContain("    wire red source.out <-> relay\n    wire red relay <-> p2\n");
    expect(valid(renamed).circuit.wires).toHaveLength(3);

    const deleted = run(CHAIN, (p) => ({ type: "deleteEntities", ids: [idOf(p, "p2")] }));
    expect(deleted).not.toContain("p2");
    expect(valid(deleted).circuit.wires).toHaveLength(1);
    const unwired = run(CHAIN, (p) => ({ type: "removeWire", key: `red|${idOf(p, "p1")}.io|${idOf(p, "p2")}.io` }));
    expect(unwired).not.toContain("p1 <-> p2");
  });

  it("changes the prototype and the settings of a speaker statement by statement", () => {
    const parsed = valid(CHAIN);
    const p1 = parsed.circuit.entities[1] as EntityOfKind<"pole">;
    expect(run(CHAIN, () => ({ type: "updateEntity", id: p1.id, entity: { ...p1, prototype: "medium-electric-pole" } }))).toContain("    pole p1 tile (4.5, 0.5) {\n        prototype = medium-electric-pole\n    }");
    const p2 = parsed.circuit.entities[2] as EntityOfKind<"pole">;
    // A statement that is there stays, also with the default.
    expect(run(CHAIN, () => ({ type: "updateEntity", id: p2.id, entity: { ...p2, prototype: "small-electric-pole" } }))).toContain("    pole p2 tile (10, 1) {\n        prototype = small-electric-pole\n    }");
    expect(run(CHAIN, () => ({ type: "updateEntity", id: p2.id, entity: { ...p2, prototype: "substation" } }))).toContain("        prototype = substation\n");

    const source = circuit("    speaker s {\n        when virtual:signal-A > 0 // why\n        volume = 50\n    }");
    const speaker = valid(source).circuit.entities[0] as EntityOfKind<"speaker">;
    const next = run(source, () => ({ type: "updateEntity", id: speaker.id, entity: { ...speaker, volume: 100, instrument: "piano", note: "F#3", showAlert: true, alertMessage: "now" } }));
    expect(next).toBe(circuit('    speaker s {\n        when virtual:signal-A > 0 // why\n        instrument = piano\n        note = "F#3"\n        volume = 100\n        show-alert = true\n        alert-message = "now"\n    }'));
    const pitched = run(source, () => ({ type: "updateEntity", id: speaker.id, entity: { ...speaker, condition: undefined, pitchSignal: A } }));
    expect(pitched).toBe(circuit("    speaker s {\n        pitch = virtual:signal-A\n        volume = 50\n    }"));
  });

  it("does not turn a pole or a speaker, and puts a tile on their grid", () => {
    const parsed = valid(CHAIN);
    const ids = ["p1", "p2"].map((name) => idOf(parsed, name));
    expect(executeCommand(parsed, { type: "faceEntities", facings: ids.map((id) => ({ id, direction: "north" as const })) })).toEqual({ ok: true, changes: [] });
    expect(run(CHAIN, () => ({ type: "setTiles", tiles: [{ id: ids[1]!, tile: { x: 12, y: -3 } }] }))).toContain("pole p2 tile (12, -3) {");
    expect(executeCommand(parsed, { type: "setTiles", tiles: [{ id: ids[1]!, tile: { x: 12.5, y: -3.5 } }] })).toMatchObject({ ok: false, code: "invalid-position" });
    expect(executeCommand(parsed, { type: "setTiles", tiles: [{ id: ids[0]!, tile: { x: 12, y: -3 } }] })).toMatchObject({ ok: false, code: "invalid-position" });
  });

  it("copies poles with the wires between them as a fragment", () => {
    const parsed = valid(CHAIN);
    const text = printFragment(extractFragment(parsed.circuit, ["p1", "p2", "light"].map((name) => idOf(parsed, name))));
    expect(text).toBe("pole p1 at (280, 40) tile (4.5, 0.5) {\n}\n\npole p2 at (520, 40) tile (10, 1) {\n    prototype = big-electric-pole\n}\n\nlamp light at (760, 40) tile (14.5, 0.5) {\n    when virtual:signal-A > 0\n}\n\nwire red p1 <-> p2\nwire red p2 <-> light.in\n");
    const fragment = analyzeFragment(text);
    expect(fragment.hasErrors).toBe(false);
    const pasted = run(CHAIN, () => ({ type: "pasteFragment", fragment: fragment.fragment!, shift: { x: 0, y: 200 } }));
    expect(pasted).toContain("    pole p3 at (280, 240) {\n    }\n    pole p4 at (520, 240) {\n        prototype = big-electric-pole\n    }");
    expect(pasted).toContain("    wire red p3 <-> p4\n    wire red p4 <-> light2.in\n");
    expect(valid(pasted).circuit.wires).toHaveLength(5);
  });
});
