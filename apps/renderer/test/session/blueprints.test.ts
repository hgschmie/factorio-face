// Blueprints of the game in the session: what a text is read as, the wording of the import report, the list of a book, the project
// a blueprint opens as, and the export of the circuit with what is in the way of it.
import { decodeBlueprintString, DEFAULT_EDIT_GRID, DEFAULT_UNITS_PER_TILE, encodeBlueprintString, type ImportReport } from "@face/blueprints";
import { analyze } from "@face/language";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../../desktop/src/emptyProject.ts";
import { EDIT_UNITS_PER_TILE } from "../../src/canvas/board.ts";
import { GRID } from "../../src/canvas/geometry.ts";
import {
  BOOK_ROWS, bookRows, exportCircuit, IMPORT_SCALE, importedProject, importedProjectName, importReport, INVALID_SOURCE_PROBLEM, noteWord, readBlueprint, REPORT_LINES, unplacedEntities,
  type BlueprintReading, type ImportedBlueprint,
} from "../../src/session/blueprints.ts";
import { createSession, EMPTY_SOURCE, fakeDesktop, type } from "./helpers.ts";

const VERSION = 562954249109504;
const at = (x: number, y: number) => ({ x, y });
const lamp = (number: number, x: number, more: object = {}) => ({ entity_number: number, name: "small-lamp", position: at(x + 0.5, 0.5), ...more });
const belt = (number: number, x: number) => ({ entity_number: number, name: "transport-belt", position: at(x + 0.5, 2.5) });
const blueprint = (body: object) => ({ blueprint: { item: "blueprint", version: VERSION, ...body } });
const read = (data: unknown, select?: readonly number[]): BlueprintReading => readBlueprint(typeof data === "string" ? data : encodeBlueprintString(data), [], select);

function imported(data: unknown, select?: readonly number[]): ImportedBlueprint {
  const reading = read(data, select);
  if (reading.kind !== "blueprint") throw new Error(`Not a blueprint: ${JSON.stringify(reading)}`);
  return reading.blueprint;
}

/** Three known entities and four unknown ones, wires between both, a copper wire, a wire that is none. */
const MIXED = blueprint({
  label: "Counter with belt",
  description: "Next to a belt.",
  icons: [{ signal: { name: "small-lamp" }, index: 1 }],
  "snap-to-grid": at(2, 2),
  entities: [lamp(1, 0), lamp(2, 1, { quality: "rare" }), { entity_number: 3, name: "medium-electric-pole", position: at(4.5, 0.5) }, belt(4, 0), belt(5, 1), belt(6, 2), { entity_number: 7, name: "inserter", position: at(3.5, 2.5) }],
  wires: [[1, 1, 2, 1], [2, 2, 3, 2], [2, 1, 7, 1], [4, 1, 7, 1], [3, 5, 3, 5], [1, 1, 99, 1]],
});

/** The four entities of the example, each on its tile. */
const PLACED = `circuit "Placed" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    decider gate at (300, 80) tile (3, 0.5) {
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    lamp light at (560, 80) tile (5.5, 0.5) {
        description = "Lit above eight."
        when virtual:signal-A > 8
    }

    wire red source.out <-> gate.in
    wire green gate.out <-> gate.in
    wire green gate.out <-> light.in
}
`;

describe("the edit positions of an import", () => {
  it("are derived at the scale and on the grid of the renderer, which are the defaults of the package", () => {
    expect(IMPORT_SCALE).toEqual({ unitsPerTile: EDIT_UNITS_PER_TILE, grid: GRID });
    expect(IMPORT_SCALE).toEqual({ unitsPerTile: DEFAULT_UNITS_PER_TILE, grid: DEFAULT_EDIT_GRID });
  });
});

describe("reading a text", () => {
  it("makes a circuit of a blueprint string and of the plain JSON, named after the label", () => {
    const data = blueprint({ label: "Two lamps", icons: [{ signal: { name: "small-lamp" }, index: 1 }], entities: [lamp(1, 0), lamp(2, 1)], wires: [[1, 1, 2, 1]] });
    for (const text of [encodeBlueprintString(data), `\n  ${encodeBlueprintString(data).replace(/(.{20})/g, "$1\n")}  `, JSON.stringify(data, null, 2)]) {
      const result = imported(text);
      expect(result).toMatchObject({ name: "Two lamps", entities: 2, total: 2, report: null });
      const parsed = analyze(result.source);
      expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(parsed.circuit).toMatchObject({ name: "Two lamps", entities: [{ name: "lamp1", placement: { tile: at(0.5, 0.5) }, position: at(0, 0) }, { name: "lamp2", placement: { tile: at(1.5, 0.5) } }], wires: [{ color: "red" }] });
    }
  });

  it("names a blueprint without a usable label, and keeps the label as the name of the circuit", () => {
    expect(imported(blueprint({ entities: [lamp(1, 0)] }))).toMatchObject({ name: "Imported blueprint" });
    expect(imported(blueprint({ entities: [lamp(1, 0)] })).source.startsWith('circuit "" {')).toBe(true);
    expect(importedProjectName("  Kitchen \n sink\t[item=iron-plate] ")).toBe("Kitchen sink [item=iron-plate]");
    expect(importedProjectName("\u0000\u001f\u007f \n")).toBe("Imported blueprint");
    expect(importedProjectName("x".repeat(300))).toHaveLength(200);
    expect(importedProjectName(`${"x".repeat(199)} y`)).toBe("x".repeat(199));
  });

  it.each([
    ["nothing", "", "There is no blueprint string."],
    ["blanks", " \n\t ", "There is no blueprint string."],
    ["other text", "hello", "This is not a blueprint string: it starts with 'h', a blueprint string starts with '0'."],
    ["a string that was cut", encodeBlueprintString(MIXED).slice(0, 80), "The blueprint string is damaged or incomplete: it cannot be unpacked."],
    ["JSON that is no blueprint", '{"a": 1}', "This is not a blueprint: the data holds neither a blueprint nor a blueprint book."],
    ["a planner", encodeBlueprintString({ deconstruction_planner: { item: "deconstruction-planner" } }), "This is a deconstruction planner, not a blueprint; the editor imports blueprints only."],
    ["an old blueprint", encodeBlueprintString({ blueprint: { item: "blueprint", entities: [lamp(1, 0)], version: 281479275675648 } }), "This blueprint is from Factorio 1.1, which stored circuits differently. Import it into Factorio 2 and export it again."],
    ["a blueprint without entities", encodeBlueprintString(blueprint({ label: "Empty" })), "This blueprint has no entities."],
    ["a blueprint of unknown entities", encodeBlueprintString(blueprint({ entities: [belt(1, 0), belt(2, 1)] })), "The editor knows none of the 2 entities of this blueprint (transport-belt), so there is nothing to import."],
    ["an empty book", encodeBlueprintString({ blueprint_book: { item: "blueprint-book", label: "Nothing" } }), "The blueprint book 'Nothing' has no blueprints."],
  ])("says why %s cannot be imported, as a sentence", (_name, text, message) => {
    expect(read(text)).toEqual({ kind: "error", message });
  });

  it("names the first prototypes when it knows none of many", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const reading = read(blueprint({ entities: names.map((name, index) => ({ entity_number: index + 1, name, position: at(index, 0) })) }));
    expect(reading).toEqual({ kind: "error", message: "The editor knows none of the 7 entities of this blueprint (a, b, c, d, e, ...), so there is nothing to import." });
  });

  it("never throws for text that is not a blueprint, whatever it is", () => {
    for (const text of ["0", "0=", "{", "[]", "null", "0eNo=", "\u0000", "0" + "A".repeat(5000), '{"blueprint": 5}', '{"blueprint": {"entities": 7, "wires": "x"}}', '{"blueprint_book": {"blueprints": [null, 1, {}]}}']) {
      expect(["error", "book"], text).toContain(read(text).kind);
    }
  });
});

describe("a blueprint book", () => {
  const BOOK = {
    blueprint_book: {
      item: "blueprint-book",
      label: "Circuits",
      blueprints: [
        { index: 0, blueprint: { item: "blueprint", label: "Belts only", entities: [belt(1, 0)], version: VERSION } },
        { index: 1, blueprint: { item: "blueprint", label: "  ", entities: [lamp(1, 0), lamp(2, 1)], version: VERSION } },
        { index: 2, blueprint: { item: "blueprint", label: "Empty", version: VERSION } },
        { index: 3, upgrade_planner: { item: "upgrade-planner", label: "Belts up" } },
        { index: 4, blueprint_book: { item: "blueprint-book", blueprints: [{ index: 0, blueprint: { item: "blueprint", label: "Three lamps", entities: [lamp(1, 0), lamp(2, 1), lamp(3, 2), belt(4, 0)], version: VERSION } }, { index: 1, something: {} }] } },
      ],
    },
  };

  it("is listed flat in its order, with what can be imported", () => {
    const reading = read(BOOK);
    expect(reading).toEqual({
      kind: "book",
      unlisted: 0,
      message: "This is a blueprint book 'Circuits' with 4 blueprints; choose one of them.",
      rows: [
        { path: [0], depth: 0, kind: "blueprint", label: "Belts only", detail: "1 entity, none known to the editor", importable: false },
        { path: [1], depth: 0, kind: "blueprint", label: "Blueprint without a label", detail: "2 entities, 2 known to the editor", importable: true },
        { path: [2], depth: 0, kind: "blueprint", label: "Empty", detail: "No entities", importable: false },
        { path: [3], depth: 0, kind: "upgrade-planner", label: "Belts up", detail: "Upgrade planner, cannot be imported", importable: false },
        { path: [4], depth: 0, kind: "book", label: "Blueprint book without a label", detail: "Blueprint book", importable: false },
        { path: [4, 0], depth: 1, kind: "blueprint", label: "Three lamps", detail: "4 entities, 3 known to the editor", importable: true },
        { path: [4, 1], depth: 1, kind: "unknown", label: "Unknown item without a label", detail: "Unknown item, cannot be imported", importable: false },
      ],
    });
    expect(bookRows([])).toEqual([]);
  });

  it("gives the blueprint a row selects, and says why another row gives none", () => {
    expect(imported(BOOK, [4, 0])).toMatchObject({ name: "Three lamps", entities: 3, total: 4, report: { summary: "Imported 3 of 4 entities and 0 wires.", dropped: ["1 x transport-belt"] } });
    expect(imported(BOOK, [1])).toMatchObject({ name: "Imported blueprint", entities: 2, report: null });
    expect(read(BOOK, [0])).toMatchObject({ kind: "error", message: "The editor knows none of the 1 entity of this blueprint (transport-belt), so there is nothing to import." });
    expect(read(BOOK, [3])).toEqual({ kind: "error", message: "This is an upgrade planner, not a blueprint; the editor imports blueprints only." });
    expect(read(BOOK, [9])).toEqual({ kind: "error", message: "The blueprint book has no such blueprint." });
    // A book inside the book lists its own items.
    expect(read(BOOK, [4])).toMatchObject({ kind: "book", rows: [{ path: [4, 0] }, { path: [4, 1] }] });
  });
});

describe("the import report", () => {
  const CLEAN: ImportReport = { version: "2.1.24.0", entities: 3, dropped: [], wires: { imported: 2, copper: 0, toDropped: 0, invalid: 0 }, settings: [], ignored: [], warnings: [] };

  it("is not made when the blueprint arrived whole; the icons every blueprint has do not count", () => {
    expect(importReport(CLEAN)).toBeNull();
    expect(importReport({ ...CLEAN, ignored: ["icons"] })).toBeNull();
    expect(imported(blueprint({ label: "L", icons: [{ signal: { name: "small-lamp" }, index: 1 }], entities: [lamp(1, 0)] })).report).toBeNull();
  });

  it("says what was imported, what was dropped by prototype, which wires went and which settings changed", () => {
    expect(imported(MIXED).report).toEqual({
      summary: "Imported 3 of 7 entities and 2 wires.",
      dropped: ["3 x transport-belt", "1 x inserter"],
      wires: [
        "2 circuit wires to dropped entities went with them.",
        "1 copper wire (power) was dropped: the editor has circuit wires only.",
        "1 wire was dropped as invalid: it does not join two connection points that exist.",
      ],
      settings: [{ kind: "ignored", text: "small-lamp: quality is something the editor does not have", entities: "1 entity: lamp2" }],
      remarks: ["Not kept from the blueprint itself: description, snap-to-grid."],
    });
  });

  it("counts in the singular and the plural", () => {
    expect(importReport({ ...CLEAN, entities: 1, wires: { imported: 1, copper: 2, toDropped: 1, invalid: 3 } })).toEqual({
      summary: "Imported 1 entity and 1 wire.",
      dropped: [],
      wires: [
        "1 circuit wire to dropped entities went with them.",
        "2 copper wires (power) were dropped: the editor has circuit wires only.",
        "3 wires were dropped as invalid: they do not join two connection points that exist.",
      ],
      settings: [],
      remarks: [],
    });
    expect(importReport({ ...CLEAN, entities: 1, dropped: [{ name: "small-lamp", count: 2, reason: "invalid" }, { name: "pipe", count: 1, reason: "unknown" }] })).toMatchObject({
      summary: "Imported 1 of 4 entities and 2 wires.",
      dropped: ["2 x small-lamp (without a usable entity number or position)", "1 x pipe"],
    });
  });

  it("names the entities of a note, the first few of many, and the kind of the note in a word", () => {
    const report = imported(blueprint({ entities: Array.from({ length: 7 }, (_, index) => lamp(index + 1, index, { quality: "rare", tags: { a: 1 } })) })).report;
    expect(report?.settings).toEqual([
      { kind: "ignored", text: "small-lamp: quality is something the editor does not have", entities: "7 entities: lamp1, lamp2, lamp3, lamp4, lamp5 and 2 more" },
      { kind: "ignored", text: "small-lamp: tags is something the editor does not have", entities: "7 entities: lamp1, lamp2, lamp3, lamp4, lamp5 and 2 more" },
    ]);
    expect((["ignored", "invalid", "changed", "reset"] as const).map(noteWord)).toEqual(["Ignored", "Invalid", "Changed", "Reset"]);
  });

  it("bounds what a blueprint can put into a dialog: the length of a name and of a message, the lines of a list", () => {
    const long = "n".repeat(5000);
    const many = Array.from({ length: 60 }, (_, index) => ({ entity_number: index + 2, name: `unknown-${String(index).padStart(2, "0")}`, position: at(index, 3) }));
    const report = imported(blueprint({ label: long, [long]: 1, entities: [lamp(1, 0, { [long]: 1, ...Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`field${index}`, 1])) }), ...many, { entity_number: 99, name: long, position: at(0, 5) }, { entity_number: 98, name: long, position: at(1, 5) }] })).report!;
    expect(report.dropped).toHaveLength(REPORT_LINES + 1);
    expect(report.dropped[0]).toBe(`2 x ${"n".repeat(80)}...`);
    expect(report.dropped.at(-1)).toBe("11 entities of 11 more prototypes");
    expect(report.settings).toHaveLength(REPORT_LINES);
    expect(report.settings.every((note) => note.text.length < 200)).toBe(true);
    expect(report.remarks).toEqual(["21 more notes on settings are not listed.", `Not kept from the blueprint itself: ${"n".repeat(80)}....`]);

    const error = read(blueprint({ entities: [{ entity_number: 1, name: long, position: at(0, 0) }] }));
    expect(error.kind === "error" && error.message.length).toBeLessThan(200);
    expect(read({ blueprint_book: { item: "blueprint-book", label: long } })).toMatchObject({ kind: "error", message: expect.stringMatching(/^The blueprint book 'n{580}\.\.\.$/) });

    const book = read({ blueprint_book: { item: "blueprint-book", blueprints: Array.from({ length: BOOK_ROWS + 5 }, (_, index) => ({ index, blueprint: { item: "blueprint", label: index === 0 ? long : `b${index}`, entities: [lamp(1, 0)] } })) } });
    expect(book).toMatchObject({ kind: "book", unlisted: 5 });
    expect(book.kind === "book" && [book.rows.length, book.rows[0]!.label.length]).toEqual([BOOK_ROWS, 83]);
  });

  it("passes on the warnings about the blueprint as sentences", () => {
    expect(importReport({ ...CLEAN, warnings: ["The blueprint is from Factorio 3.0, which is newer than the editor knows"], ignored: ["icons", "tiles"] })?.remarks).toEqual([
      "The blueprint is from Factorio 3.0, which is newer than the editor knows.",
      "Not kept from the blueprint itself: tiles.",
    ]);
  });
});

describe("the project of an imported blueprint", () => {
  it("is the empty project with the name and the circuit of the blueprint, without a file", () => {
    const empty = createEmptyProject();
    expect(importedProject(empty, { name: "Two lamps", source: "circuit {}" })).toEqual({
      path: null,
      data: { manifest: { ...empty.manifest, name: "Two lamps", circuits: ["main.face"] }, files: [{ name: "main.face", source: "circuit {}" }] },
    });
  });

  it("opens on the blueprint board as a project that was never saved, and tells the desktop that the window has no file", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(undefined, { api: desktop.api });
    const reading = session.commands.readBlueprint(encodeBlueprintString(MIXED));
    if (reading.kind !== "blueprint") throw new Error("not a blueprint");
    expect(await session.commands.openBlueprint(reading.blueprint)).toBe(true);
    expect(desktop).toMatchObject({ newProjects: 1, confirmations: 0 });
    expect(session.state.project).toMatchObject({ name: "Counter with belt", path: null, dirty: true, fileName: "main.face" });
    expect(session.state).toMatchObject({ displayMode: "blueprint", editable: true, canUndo: false, error: null, selection: [], source: reading.blueprint.source });
    expect(session.state.circuit.entities.map((entity) => [entity.name, entity.placement?.tile])).toEqual([["lamp1", at(0.5, 0.5)], ["lamp2", at(1.5, 0.5)], ["pole1", at(4.5, 0.5)]]);

    // Save asks for a location, like every project without a file; after it nothing is unsaved.
    desktop.savePath = null;
    expect(await session.commands.save()).toBe(false);
    expect(session.state.project).toMatchObject({ path: null, dirty: true });
    desktop.savePath = "/projects/counter";
    expect(await session.commands.save()).toBe(true);
    expect(session.state.project).toMatchObject({ path: "/projects/counter", dirty: false });
    expect(desktop.disk.get("/projects/counter")).toMatchObject({ manifest: { name: "Counter with belt", circuits: ["main.face"] }, files: [{ name: "main.face", source: reading.blueprint.source }] });
  });

  it("asks before it replaces unsaved changes, and replaces nothing when the user keeps them", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(undefined, { api: desktop.api });
    const lamps = imported(blueprint({ label: "Lamps", entities: [lamp(1, 0)] }));
    type(session, 0, "// mine\n");
    desktop.unsavedChoice = "cancel";
    expect(await session.commands.openBlueprint(lamps)).toBe(false);
    expect(desktop).toMatchObject({ confirmations: 1, newProjects: 0 });
    expect(session.state).toMatchObject({ displayMode: "edit", project: { name: "Feedback example" } });
    desktop.unsavedChoice = "discard";
    expect(await session.commands.openBlueprint(lamps)).toBe(true);
    expect(session.state.project).toMatchObject({ name: "Lamps", dirty: true });
    // The imported project is unsaved itself: the next one asks again.
    expect(await session.commands.openBlueprint(lamps)).toBe(true);
    expect(desktop.confirmations).toBe(3);
    // Another project opens on the edit canvas again.
    await session.commands.newProject();
    expect(session.state).toMatchObject({ displayMode: "edit", project: { dirty: false } });
  });

  it("needs the desktop app", async () => {
    const { session } = createSession();
    expect(await session.commands.openBlueprint(imported(blueprint({ entities: [lamp(1, 0)] })))).toBe(false);
    expect(session.state.error).toBe("Projects can only be opened and saved in the desktop app.");
    expect(await session.commands.chooseBlueprintFile()).toBeUndefined();
  });

  it("takes the text of a file from the desktop, which chose the file", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(undefined, { api: desktop.api });
    expect(await session.commands.chooseBlueprintFile()).toBeUndefined();
    desktop.blueprintFile = { name: "lamps.txt", text: "0abc" };
    expect(await session.commands.chooseBlueprintFile()).toEqual({ name: "lamps.txt", text: "0abc" });
    const failing = createSession(undefined, { api: { ...desktop.api, importBlueprintFile: async () => ({ ok: false, error: "Not a text file: /x" }) } }).session;
    expect(await failing.commands.chooseBlueprintFile()).toBeUndefined();
    expect(failing.state.error).toBe("Not a text file: /x");
  });
});

describe("the export of a circuit", () => {
  it("gives the blueprint string with the version it is written for and the warnings as sentences", () => {
    const { session } = createSession(PLACED);
    const exported = session.commands.exportBlueprint();
    if (!exported.ok) throw new Error("not exported");
    expect(exported.gameVersion).toBe("2.1.24");
    expect(exported.warnings).toEqual(["The game has a description on combinators only; the description of 'light' is not in the blueprint."]);
    expect(exported.string).toMatch(/^0[A-Za-z0-9+/]+={0,2}$/);
    const decoded = decodeBlueprintString(exported.string);
    expect(decoded.ok && decoded.data).toMatchObject({ blueprint: { label: "Placed", version: 562954249961472, entities: [{ name: "constant-combinator" }, { name: "decider-combinator" }, { name: "small-lamp" }] } });
    // What an import makes of the string exports to the same string: the same circuit, entity for entity and wire for wire.
    const back = imported(exported.string);
    expect(back).toMatchObject({ name: "Placed", entities: 3, total: 3, report: null });
    expect(exportCircuit(analyze(back.source).circuit!, [])).toEqual({ ok: true, string: exported.string, gameVersion: "2.1.24", warnings: [] });
  });

  it("lists everything that is in the way, with the entities, and knows which of it the board solves", () => {
    const { session } = createSession();
    const unplaced = session.commands.exportBlueprint();
    expect(unplaced).toEqual({
      ok: false,
      problems: [{ code: "no-tile", entities: ["source", "gate", "twice", "light"], message: "4 entities have no place in the game (no 'tile'): 'source', 'gate', 'twice', 'light'. Place every entity on the blueprint board first." }],
    });
    expect(!unplaced.ok && unplacedEntities(unplaced.problems)).toEqual(["source", "gate", "twice", "light"]);

    const several = exportCircuit(analyze(PLACED.replace("tile (3, 0.5)", "tile (1, 0.5)").replace("virtual:signal-A = 1", "custom:mine = 1").replace(" tile (5.5, 0.5)", "")).circuit!, []);
    expect(several).toEqual({
      ok: false,
      problems: [
        { code: "no-tile", entities: ["light"], message: "1 entity has no place in the game (no 'tile'): 'light'. Place every entity on the blueprint board first." },
        { code: "overlap", entities: ["source", "gate"], message: "These entities stand on a tile of another entity, which the game cannot build: 'source', 'gate'." },
        { code: "custom-signal", entities: ["source"], message: "'source' uses the custom signal custom:mine, which the game does not have." },
      ],
    });
    expect(!several.ok && unplacedEntities(several.problems)).toEqual(["light"]);
    expect(exportCircuit(analyze(PLACED.replace("tile (3, 0.5)", "tile (3.5, 0.5)")).circuit!, [])).toMatchObject({ ok: false, problems: [{ code: "off-grid", entities: ["gate"], message: "Not on the tile grid of the game: 'gate'." }] });
    expect(exportCircuit(analyze(EMPTY_SOURCE).circuit!, [])).toEqual({ ok: false, problems: [{ code: "empty", entities: [], message: "The circuit has no entities; a blueprint needs at least one." }] });
    expect(unplacedEntities([INVALID_SOURCE_PROBLEM])).toEqual([]);
  });

  it("is refused while the source has errors: the circuit on show is not the one of the source", () => {
    const { session } = createSession(PLACED);
    type(session, 0, "oops ");
    expect(session.state.editable).toBe(false);
    expect(session.commands.exportBlueprint()).toEqual({ ok: false, problems: [{ code: "invalid-source", entities: [], message: "The source has errors. A blueprint is made from the circuit, so fix them first." }] });
    session.commands.undo();
    expect(session.commands.exportBlueprint().ok).toBe(true);
  });

  it("writes instruments and notes of a speaker as the positions the game has them at, and reads them back by name", () => {
    const { session } = createSession(EMPTY_SOURCE);
    session.commands.placeEntityOnTile("speaker", at(0.5, 0.5));
    const instrument = session.state.catalog.speakerInstruments[2]!;
    const speaker = session.state.circuit.entities[0]!;
    session.commands.updateEntity({ ...speaker, instrument: instrument.name, note: instrument.notes[3]!.name } as typeof speaker);
    expect(session.state.source).toContain(instrument.name);
    const exported = session.commands.exportBlueprint();
    if (!exported.ok) throw new Error(JSON.stringify(exported.problems));
    const decoded = decodeBlueprintString(exported.string);
    expect(JSON.stringify(decoded.ok && decoded.data)).toMatch(/"instrument_id":2,"note_id":3/);
    const reading = session.commands.readBlueprint(exported.string);
    expect(reading.kind === "blueprint" && reading.blueprint.source).toContain(instrument.notes[3]!.name);
    expect(reading.kind === "blueprint" && reading.blueprint.report).toBeNull();
  });

  it("goes to a file the desktop asks the user for, under the name of the project, and says where it went", async () => {
    const desktop = fakeDesktop();
    const { session } = createSession(PLACED, { api: desktop.api });
    session.commands.setProjectName("My counter");
    const exported = session.commands.exportBlueprint();
    if (!exported.ok) throw new Error("not exported");
    desktop.blueprintPath = null;
    expect(await session.commands.saveBlueprintFile(exported)).toBe(false);
    expect(session.state.error).toBeNull();
    desktop.blueprintPath = "/blueprints/counter.txt";
    expect(await session.commands.saveBlueprintFile(exported)).toBe(true);
    expect(desktop.blueprintExports).toEqual([{ name: "My counter", text: exported.string }]);
    expect(session.state.error).toBe("Blueprint exported to /blueprints/counter.txt, with 1 warning: File > Show Blueprint String lists it.");
    // An export saves nothing of the project.
    expect(session.state.project).toMatchObject({ path: null, dirty: true });
    expect(desktop.disk.size).toBe(0);

    expect(await session.commands.saveBlueprintFile({ ...exported, warnings: [] })).toBe(true);
    expect(session.state.error).toBe("Blueprint exported to /blueprints/counter.txt.");
    const refusing = createSession(PLACED, { api: { ...desktop.api, exportBlueprintFile: async () => ({ ok: false, error: "Not a blueprint string" }) } }).session;
    expect(await refusing.commands.saveBlueprintFile(exported)).toBe(false);
    expect(refusing.state.error).toBe("Not a blueprint string");
    expect(await createSession(PLACED).session.commands.saveBlueprintFile(exported)).toBe(false);
  });
});
