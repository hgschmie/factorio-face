import { checkEntity, printCircuit } from "@face/language";
import { BOTH_NETWORKS, DEFAULT_ENTITY, ENTITY_KINDS, PROTOTYPE_NAMES, PROTOTYPES, prototypesOf, TERMINALS, type EntityKind, type TerminalSide } from "@face/model";
import { describe, expect, it } from "vitest";
import { connectorId, encodeBlueprintString, importBlueprint, importBlueprintString, inspectBlueprint, packVersion, type ImportErrorCode, type ImportOptions } from "../src/index.ts";
import { A, B, blueprintOf, imported, importedEntity, IRON } from "./helpers.ts";
import { INSTRUMENTS } from "./samples.ts";

const sig = (name: string, kind = "virtual", quality?: string) => ({ kind, name, ...(quality && { quality }) });
const SA = sig("signal-A");
const SB = sig("signal-B");
const SIRON = sig("iron-plate", "item");
const RED = { red: true, green: false };
const GREEN = { red: false, green: true };
const at = (x: number, y: number) => ({ position: { x, y } });
const lamp = (number: number, x = number + 0.5, extra: object = {}) => ({ entity_number: number, name: "small-lamp", ...at(x, 0.5), ...extra });

function codeOf(data: unknown, options: ImportOptions = {}): ImportErrorCode | "ok" {
  const result = importBlueprint(data, options);
  return result.ok ? "ok" : result.code;
}

describe("import: the blueprint", () => {
  it("makes a circuit with the label as its name, entities named by kind and number, and wires", () => {
    const data = blueprintOf(
      [
        { entity_number: 1, name: "constant-combinator", ...at(0.5, 0.5), control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, ...A, quality: "normal", comparator: "=", count: 1 }] }] } } },
        { entity_number: 2, name: "small-lamp", ...at(1.5, 0.5) },
        { entity_number: 3, name: "small-lamp", ...at(2.5, 0.5) },
        { entity_number: 4, name: "decider-combinator", ...at(1, 2.5), direction: 4 },
      ],
      [[1, 1, 2, 1], [2, 2, 4, 2], [4, 3, 4, 1]],
      { label: "Blinker" },
    );
    const { circuit, report } = imported(data);
    expect(printCircuit(circuit)).toBe(`circuit "Blinker" {
    constant constant1 at (0, 0) tile (0.5, 0.5) facing north {
        virtual:signal-A = 1
    }

    lamp lamp1 at (100, 0) tile (1.5, 0.5) {
    }

    lamp lamp2 at (180, 0) tile (2.5, 0.5) {
    }

    decider decider1 at (0, 180) tile (1, 2.5) {
    }

    wire red constant1.out <-> lamp1.in
    wire green lamp1.in <-> decider1.in
    wire red decider1.out <-> decider1.in
}
`);
    expect(circuit.entities.map((entity) => entity.id)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(report).toEqual({ version: "2.1.24.0", entities: 4, dropped: [], wires: { imported: 3, copper: 0, toDropped: 0, invalid: 0 }, settings: [], ignored: [], warnings: [] });
  });

  it("gives a blueprint without a label no name, and takes one without entities as an empty circuit", () => {
    expect(imported(blueprintOf([lamp(1)])).circuit.name).toBe("");
    expect(imported(blueprintOf([lamp(1)], [], { label: 7 })).circuit.name).toBe("");
    expect(imported({ blueprint: { item: "blueprint" } }).circuit).toEqual({ name: "", entities: [], wires: [] });
    expect(imported({ blueprint: { entities: "none", wires: 7 } }).circuit.entities).toEqual([]);
  });

  it("reads a blueprint string and the plain JSON of one, and passes on why a string cannot be read", () => {
    const data = blueprintOf([lamp(1)], [], { label: "L" });
    for (const text of [encodeBlueprintString(data), JSON.stringify(data)]) {
      const result = importBlueprintString(text);
      expect(result.ok && result.circuit.name).toBe("L");
    }
    expect(importBlueprintString("0eNq")).toMatchObject({ ok: false, code: "invalid-compression" });
    expect(importBlueprintString("")).toMatchObject({ ok: false, code: "empty" });
    expect(importBlueprintString(encodeBlueprintString(data), { limits: { maxDecodedBytes: 10 } })).toMatchObject({ ok: false, code: "too-large" });
  });

  it("says which fields of the blueprint itself are not kept", () => {
    const extra = { description: "text", icons: [{ signal: IRON, index: 1 }], "snap-to-grid": { x: 2, y: 2 }, "absolute-snapping": true, tiles: [{ name: "concrete", position: { x: 0, y: 0 } }], schedules: [], label_color: { r: 1 }, mystery: 1 };
    expect(imported(blueprintOf([lamp(1)], [], extra)).report.ignored).toEqual(["description", "icons", "snap-to-grid", "absolute-snapping", "tiles", "label_color", "mystery"]);
  });
});

describe("import: versions", () => {
  const versioned = (version: unknown) => blueprintOf([lamp(1)], [], { version });

  it("takes 2.0 and 2.1, and anything without a usable version", () => {
    for (const version of [packVersion(2, 0, 7), packVersion(2, 1, 24, 3), undefined, "2.1", -1]) expect(codeOf(versioned(version))).toBe("ok");
    expect(imported(versioned(packVersion(2, 0, 76))).report).toMatchObject({ version: "2.0.76.0", warnings: [] });
    expect(imported(versioned(undefined)).report.version).toBeUndefined();
  });

  it("refuses 1.1 and older, which stored circuits differently", () => {
    for (const version of [packVersion(1, 1, 110), packVersion(1, 0, 0), packVersion(0, 17, 79, 1)]) {
      const result = importBlueprint(versioned(version));
      expect(result).toMatchObject({ ok: false, code: "unsupported-version" });
    }
    expect(importBlueprint(versioned(packVersion(1, 1, 110)))).toMatchObject({ message: "This blueprint is from Factorio 1.1, which stored circuits differently. Import it into Factorio 2 and export it again" });
  });

  it("takes the pre-release of 2.0 and a newer game with a warning", () => {
    expect(imported(versioned(packVersion(1, 2, 10, 23))).report.warnings).toEqual(["The blueprint is from a pre-release of Factorio 2.0 (1.2.10.23)"]);
    expect(imported(versioned(packVersion(2, 2, 0))).report.warnings).toEqual(["The blueprint is from Factorio 2.2, which is newer than the editor knows"]);
    expect(imported(versioned(packVersion(3, 0, 0))).report.warnings).toHaveLength(1);
  });
});

describe("import: books and other items", () => {
  const blueprint = (label: string, entities: readonly unknown[]) => ({ blueprint: { item: "blueprint", label, entities, version: packVersion(2, 1, 24) } });
  const belt = { entity_number: 9, name: "transport-belt", ...at(9.5, 0.5) };
  const book = {
    blueprint_book: {
      item: "blueprint-book",
      label: "Circuits",
      active_index: 0,
      version: packVersion(2, 1, 24),
      blueprints: [
        { index: 0, ...blueprint("Lamps", [lamp(1), lamp(2), belt]) },
        { index: 1, deconstruction_planner: { item: "deconstruction-planner", label: "Trees" } },
        { index: 2, blueprint_book: { item: "blueprint-book", label: "Inner", blueprints: [{ index: 0, ...blueprint("Belts", [belt]) }, { index: 3, ...blueprint("Pole", [{ entity_number: 1, name: "substation", ...at(1, 1) }]) }] } },
        { index: 5, upgrade_planner: { item: "upgrade-planner" } },
        { index: 6, blueprint: { item: "blueprint" } },
        { index: 7, something_else: {} },
      ],
    },
  };
  const entries = [
    { path: [0], kind: "blueprint", label: "Lamps", entities: 3, known: 2 },
    { path: [1], kind: "deconstruction-planner", label: "Trees", entities: 0, known: 0 },
    { path: [2], kind: "book", label: "Inner", entities: 0, known: 0 },
    { path: [2, 0], kind: "blueprint", label: "Belts", entities: 1, known: 0 },
    { path: [2, 1], kind: "blueprint", label: "Pole", entities: 1, known: 1 },
    { path: [3], kind: "upgrade-planner", label: "", entities: 0, known: 0 },
    { path: [4], kind: "blueprint", label: "", entities: 0, known: 0 },
    { path: [5], kind: "unknown", label: "", entities: 0, known: 0 },
  ];

  it("does not import a book but lists its items, books inside it included, with label and entity counts", () => {
    const result = importBlueprint(book);
    expect(result).toEqual({ ok: false, code: "book", message: "This is a blueprint book 'Circuits' with 4 blueprints; choose one of them", book: entries });
    expect(inspectBlueprint(book)).toEqual({ kind: "book", label: "Circuits", entries });
  });

  it("imports the blueprint of a book that is chosen by its path", () => {
    expect(imported(book, { select: [0] }).circuit).toMatchObject({ name: "Lamps", entities: [{ name: "lamp1" }, { name: "lamp2" }] });
    expect(imported(book, { select: [2, 1] }).circuit).toMatchObject({ name: "Pole", entities: [{ kind: "pole", prototype: "substation" }] });
    expect(imported(book, { select: [2, 0] }).report).toMatchObject({ entities: 0, dropped: [{ name: "transport-belt", count: 1, reason: "unknown" }] });
  });

  it("lists the book inside a book when that is chosen, and refuses what is not a blueprint or not there", () => {
    expect(importBlueprint(book, { select: [2] })).toEqual({ ok: false, code: "book", message: "This is a blueprint book 'Inner' with 2 blueprints; choose one of them", book: entries.slice(3, 5) });
    expect(importBlueprint(book, { select: [1] })).toEqual({ ok: false, code: "unsupported-item", message: "This is a deconstruction planner, not a blueprint; the editor imports blueprints only" });
    expect(importBlueprint(book, { select: [3] })).toMatchObject({ code: "unsupported-item", message: "This is an upgrade planner, not a blueprint; the editor imports blueprints only" });
    expect(codeOf(book, { select: [5] })).toBe("unsupported-item");
    for (const select of [[6], [-1], [0.5], [0, 0], [2, 7], [Number.NaN]]) expect(codeOf(book, { select })).toBe("invalid-selection");
    expect(importBlueprint({ blueprint_book: { label: "Empty" } })).toMatchObject({ code: "book", message: "The blueprint book 'Empty' has no blueprints", book: [] });
  });

  it("refuses a planner and everything that is no blueprint, with a message that says what it is", () => {
    expect(importBlueprint({ deconstruction_planner: { item: "deconstruction-planner" } })).toMatchObject({ ok: false, code: "unsupported-item", message: "This is a deconstruction planner, not a blueprint; the editor imports blueprints only" });
    expect(importBlueprint({ upgrade_planner: { item: "upgrade-planner" } })).toMatchObject({ ok: false, code: "unsupported-item" });
    expect(importBlueprint({ "upgrade-planner": {} })).toMatchObject({ ok: false, code: "unsupported-item" });
    expect(inspectBlueprint({ upgrade_planner: { label: "U" } })).toEqual({ kind: "upgrade-planner", label: "U" });
    for (const data of [{}, { item: "blueprint" }, { blueprint: "text" }, { blueprint: [] }, null, undefined, 7, "text", []]) {
      expect(importBlueprint(data)).toMatchObject({ ok: false, code: "not-a-blueprint" });
      expect(inspectBlueprint(data)).toEqual({ kind: "unknown", label: "" });
    }
    expect(importBlueprint(blueprintOf([lamp(1)]), { select: [0] })).toMatchObject({ code: "invalid-selection" });
  });

  it("describes a single blueprint", () => {
    expect(inspectBlueprint(blueprint("One", [lamp(1), belt]))).toEqual({ kind: "blueprint", label: "One", entities: 2, known: 1, version: "2.1.24.0" });
    expect(inspectBlueprint({ blueprint: {} })).toEqual({ kind: "blueprint", label: "", entities: 0, known: 0 });
  });
});

describe("import: what is dropped", () => {
  const data = blueprintOf(
    [
      lamp(1),
      { entity_number: 2, name: "transport-belt", ...at(1.5, 1.5), direction: 4 },
      { entity_number: 3, name: "transport-belt", ...at(2.5, 1.5) },
      { entity_number: 4, name: "inserter", ...at(3.5, 1.5), control_behavior: { circuit_enabled: true } },
      { entity_number: 5, name: "medium-electric-pole", ...at(5.5, 0.5) },
      { entity_number: 6, name: "medium-electric-pole", ...at(9.5, 0.5) },
      { entity_number: 7, name: "modded-combinator", ...at(7.5, 7.5) },
      { entity_number: 8, name: "transport-belt", ...at(4.5, 1.5) },
      { entity_number: 9, name: "power-switch", ...at(12, 1) },
    ],
    [[1, 1, 5, 1], [1, 1, 4, 1], [4, 2, 5, 2], [5, 5, 6, 5], [5, 2, 6, 2], [6, 5, 9, 5], [9, 6, 6, 5], [2, 1, 3, 1], [1, 1, 77, 1]],
  );

  it("drops the entities of prototypes the editor does not know and says which, the most frequent first", () => {
    const { circuit, report } = imported(data);
    expect(circuit.entities.map((entity) => entity.name)).toEqual(["lamp1", "pole1", "pole2"]);
    expect(report.entities).toBe(3);
    expect(report.dropped).toEqual([
      { name: "transport-belt", count: 3, reason: "unknown" },
      { name: "inserter", count: 1, reason: "unknown" },
      { name: "modded-combinator", count: 1, reason: "unknown" },
      { name: "power-switch", count: 1, reason: "unknown" },
    ]);
    expect(report.settings).toEqual([]);
  });

  it("drops their wires with them, and the copper wires between poles, and counts each", () => {
    const { circuit, report } = imported(data);
    expect(printCircuit(circuit).split("\n").filter((line) => line.includes("wire"))).toEqual(["    wire red lamp1.in <-> pole1", "    wire green pole1 <-> pole2"]);
    expect(report.wires).toEqual({ imported: 2, copper: 1, toDropped: 5, invalid: 1 });
  });

  it("knows every prototype of the editor and nothing else", () => {
    const entities = [...PROTOTYPE_NAMES, "steel-chest", "", "Small-Lamp", "toString", "__proto__"].map((name, index) => ({ entity_number: index + 1, name, ...at(index * 3, 0) }));
    const { circuit, report } = imported(blueprintOf(entities));
    expect(circuit.entities.map((entity) => (entity.kind === "pole" ? entity.prototype : entity.kind))).toEqual(["constant", "arithmetic", "decider", "selector", "lamp", "small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation", "speaker"]);
    expect(report.dropped.map((entry) => `${entry.name} ${entry.reason}`).sort()).toEqual(["(no name) invalid", "Small-Lamp unknown", "__proto__ unknown", "steel-chest unknown", "toString unknown"]);
  });

  it("drops a known entity that has no number of its own or no position, as invalid", () => {
    const entities = [lamp(1), lamp(1, 5.5), { entity_number: 2, name: "small-lamp" }, { name: "small-lamp", ...at(0.5, 3.5) }, { entity_number: 3, name: "small-lamp", position: { x: "1", y: 0 } }, { entity_number: 4, name: "small-lamp", position: { x: 1e9, y: 0 } }, "lamp", null, 5];
    const { circuit, report } = imported(blueprintOf(entities, [[1, 1, 2, 1], [1, 1, 3, 1]]));
    expect(circuit.entities).toHaveLength(1);
    expect(report.dropped).toEqual([{ name: "small-lamp", count: 5, reason: "invalid" }, { name: "(no name)", count: 3, reason: "invalid" }]);
    expect(report.wires).toMatchObject({ imported: 0, toDropped: 2 });
  });

  it("refuses a blueprint with more known entities than the limit, and counts only those", () => {
    const entities = [...Array.from({ length: 5 }, (_, i) => lamp(i + 1)), ...Array.from({ length: 50 }, (_, i) => ({ entity_number: 100 + i, name: "transport-belt", ...at(i, 5.5) }))];
    expect(codeOf(blueprintOf(entities), { limits: { maxEntities: 5 } })).toBe("ok");
    expect(importBlueprint(blueprintOf(entities), { limits: { maxEntities: 4 } })).toEqual({ ok: false, code: "too-many-entities", message: "The blueprint has more than 4 entities that the editor knows" });
  });
});

describe("import: place and direction", () => {
  it("keeps the position as the tile and reads the four directions; an entity that cannot turn has none", () => {
    const entities = [0, 4, 8, 12, undefined].map((direction, index) => ({ entity_number: index + 1, name: "arithmetic-combinator", ...at(index * 3 + 0.5, 7), ...(direction !== undefined && { direction }) }));
    const { circuit } = imported(blueprintOf([...entities, { entity_number: 9, name: "small-lamp", ...at(-3.5, 2.5), direction: 8 }, { entity_number: 10, name: "constant-combinator", ...at(20.5, 2.5), direction: 12 }]));
    expect(circuit.entities.map((entity) => entity.placement)).toEqual([
      { tile: { x: 0.5, y: 7 }, direction: "north" },
      { tile: { x: 3.5, y: 7 } },
      { tile: { x: 6.5, y: 7 }, direction: "south" },
      { tile: { x: 9.5, y: 7 }, direction: "west" },
      { tile: { x: 12.5, y: 7 }, direction: "north" },
      { tile: { x: -3.5, y: 2.5 } },
      { tile: { x: 20.5, y: 2.5 }, direction: "west" },
    ]);
  });

  it("takes the nearest of the four for any other direction and says so", () => {
    const facing = (direction: unknown) => importedEntity("decider-combinator", { direction });
    expect(facing(5)).toEqual({ entity: DEFAULT_ENTITY.decider, notes: ["changed direction"] });
    expect(imported(blueprintOf([{ entity_number: 1, name: "decider-combinator", ...at(0, 0.5), direction: 14 }])).circuit.entities[0]!.placement).toEqual({ tile: { x: 0, y: 0.5 }, direction: "north" });
    expect(imported(blueprintOf([{ entity_number: 1, name: "decider-combinator", ...at(0, 0.5), direction: 9 }])).circuit.entities[0]!.placement).toEqual({ tile: { x: 0, y: 0.5 }, direction: "south" });
    expect(facing("east").notes).toEqual(["invalid direction"]);
    expect(facing(16).notes).toEqual(["changed direction"]);
  });

  it("derives the edit positions from the tiles: the same arrangement, its corner at the origin, on the grid", () => {
    const entities = [
      { entity_number: 1, name: "small-lamp", ...at(10.5, -3.5) },
      { entity_number: 2, name: "decider-combinator", ...at(13, -3.5), direction: 4 },
      { entity_number: 3, name: "decider-combinator", ...at(10.5, 0) },
      { entity_number: 4, name: "big-electric-pole", ...at(16, 2) },
      { entity_number: 5, name: "small-lamp", ...at(-2.5, 6.5) },
    ];
    const positions = (options: ImportOptions) => imported(blueprintOf(entities), options).circuit.entities.map((entity) => [entity.position.x, entity.position.y]);
    // Top-left tiles (10, -4), (12, -4), (10, -1), (15, 1), (-3, 6): times 92, on the 20-unit grid.
    expect(positions({})).toEqual([[1200, 0], [1380, 0], [1200, 280], [1660, 460], [0, 920]]);
    expect(positions({ grid: 1 })).toEqual([[1196, 0], [1380, 0], [1196, 276], [1656, 460], [0, 920]]);
    expect(positions({ unitsPerTile: 240, grid: 20 })).toEqual([[3120, 0], [3600, 0], [3120, 720], [4320, 1200], [0, 2400]]);
    expect(positions({ unitsPerTile: -1, grid: 0 })).toEqual(positions({}));
  });

  it("keeps a position that is off the grid as it is; the editor warns about it", () => {
    const { circuit } = imported(blueprintOf([{ entity_number: 1, name: "small-lamp", ...at(1.25, 2) }]));
    expect(circuit.entities[0]!.placement).toEqual({ tile: { x: 1.25, y: 2 } });
    expect(printCircuit(circuit)).toContain("tile (1.25, 2)");
  });
});

describe("import: common fields", () => {
  it("reads the description of a combinator", () => {
    for (const name of ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"]) {
      expect(importedEntity(name, { player_description: "two\nlines" }).entity.description).toBe("two\nlines");
      expect(importedEntity(name, { player_description: "" }).entity).not.toHaveProperty("description");
    }
    expect(importedEntity("small-lamp", { player_description: "x" })).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: ["ignored player_description"] });
  });

  it("says which fields of an entity the editor does not have, once per kind of entity", () => {
    const fields = { quality: "legendary", tags: { mod: 1 }, items: [], mirror: true, wires: [[1, 1, 2, 1]], future_field: 1 };
    const entities = [lamp(1, 0.5, fields), lamp(2, 1.5, fields), lamp(3, 2.5, { quality: "normal", mirror: false }), { entity_number: 4, name: "substation", ...at(6, 6), quality: "legendary" }];
    const { report } = imported(blueprintOf(entities));
    expect(report.settings).toEqual([
      { prototype: "small-lamp", field: "mirror", kind: "changed", message: "is on; the editor does not mirror entities", count: 2, entities: ["lamp1", "lamp2"] },
      { prototype: "small-lamp", field: "quality", kind: "ignored", message: "is something the editor does not have", count: 2, entities: ["lamp1", "lamp2"] },
      { prototype: "small-lamp", field: "tags", kind: "ignored", message: "is something the editor does not have", count: 2, entities: ["lamp1", "lamp2"] },
      { prototype: "small-lamp", field: "items", kind: "ignored", message: "is something the editor does not have", count: 2, entities: ["lamp1", "lamp2"] },
      { prototype: "small-lamp", field: "wires", kind: "ignored", message: "is something the editor does not have", count: 2, entities: ["lamp1", "lamp2"] },
      { prototype: "small-lamp", field: "future_field", kind: "ignored", message: "is something the editor does not have", count: 2, entities: ["lamp1", "lamp2"] },
      { prototype: "substation", field: "quality", kind: "ignored", message: "is something the editor does not have", count: 1, entities: ["pole1"] },
    ]);
  });

  it("names the first few entities of a note and counts all, each entity once", () => {
    const filters = [{ index: 1, ...A, count: 1, max_count: 5 }, { index: 2, ...B, count: 1, max_count: 5 }];
    const entities = Array.from({ length: 8 }, (_, i) => ({ entity_number: i + 1, name: "constant-combinator", ...at(i + 0.5, 0.5), control_behavior: { sections: { sections: [{ index: 1, filters }, { index: 2, filters }] } } }));
    expect(imported(blueprintOf(entities)).report.settings).toEqual([
      { prototype: "constant-combinator", field: "control_behavior.sections.sections[].filters[].max_count", kind: "ignored", message: "is something the editor does not have", count: 8, entities: ["constant1", "constant2", "constant3", "constant4", "constant5"] },
    ]);
  });
});

describe("import: constant combinator", () => {
  const read = (control_behavior: unknown) => importedEntity("constant-combinator", { control_behavior });
  const sections = (list: readonly unknown[]) => read({ sections: { sections: list } });

  it("is as placed without settings", () => {
    expect(importedEntity("constant-combinator")).toEqual({ entity: DEFAULT_ENTITY.constant, notes: [] });
    expect(read({})).toEqual({ entity: DEFAULT_ENTITY.constant, notes: [] });
    expect(read({ sections: {} }).entity).toEqual(DEFAULT_ENTITY.constant);
  });

  it("reads the switch, sections in the order of their index, and filters in the order of theirs", () => {
    const { entity, notes } = read({
      is_on: false,
      sections: {
        sections: [
          { index: 2, group: "Ore", multiplier: -0.5, active: false, filters: [{ index: 3, ...A, quality: "rare", comparator: "=", count: 7 }, { index: 1, name: "iron-plate", quality: "normal", comparator: "=", count: -3 }] },
          { index: 1, filters: [{ index: 1, type: "fluid", name: "water", count: 2147483647 }] },
          { index: 3, group: "" },
        ],
      },
    });
    expect(notes).toEqual([]);
    expect(entity).toEqual({
      kind: "constant",
      enabled: false,
      sections: [
        { active: true, multiplier: 1, filters: [{ signal: sig("water", "fluid"), count: 2147483647 }] },
        { group: "Ore", active: false, multiplier: -0.5, filters: [{ signal: SIRON, count: -3 }, { signal: sig("signal-A", "virtual", "rare"), count: 7 }] },
        { active: true, multiplier: 1, filters: [] },
      ],
    });
  });

  it("reads every kind of signal, an item by default", () => {
    const kinds = ["item", "fluid", "virtual", "entity", "recipe", "space-location", "asteroid-chunk", "quality"];
    const { entity } = sections([{ index: 1, filters: [{ index: 9, name: "plain", count: 1 }, ...kinds.map((type, index) => ({ index: index + 1, type, name: `n-${type}`, quality: "normal", count: index }))] }]);
    expect((entity.sections as { filters: { signal: unknown }[] }[])[0]!.filters.map((filter) => filter.signal)).toEqual([...kinds.map((kind) => sig(`n-${kind}`, kind)), sig("plain", "item")]);
  });

  it("gives a multiplier the short form of the float the game stores", () => {
    const multiplier = (value: number) => (sections([{ index: 1, multiplier: value }]).entity.sections as { multiplier: number }[])[0]!.multiplier;
    expect(multiplier(0.10000000149011612)).toBe(0.1);
    expect(multiplier(0.1)).toBe(0.1);
    expect(multiplier(-2.5)).toBe(-2.5);
    expect(multiplier(1e10)).toBe(1e10);
    expect(multiplier(16777216)).toBe(16777216);
    expect(multiplier(0)).toBe(0);
  });

  it("skips empty slots, adds up a signal that is in a section twice and drops a wildcard, saying so", () => {
    const { entity, notes } = sections([{ index: 1, filters: [{ index: 1 }, { index: 2, ...A, count: 2147483647 }, { index: 3, ...A, count: 1 }, { index: 4, type: "virtual", name: "signal-each", count: 1 }, { index: 5, ...B, comparator: "≥", count: 2 }] }]);
    expect(entity.sections).toEqual([{ active: true, multiplier: 1, filters: [{ signal: SA, count: -2147483648 }, { signal: SB, count: 2 }] }]);
    // The signal that is there twice, the wildcard, the comparator.
    expect(notes).toEqual(["changed control_behavior.sections.sections[].filters[].name", "changed control_behavior.sections.sections[].filters[].name", "changed control_behavior.sections.sections[].filters[].comparator"]);
  });

  it("reports what a logistic request has and a constant combinator does not, and values of the wrong type", () => {
    const { entity, notes } = read({ is_on: "no", sections: { trash_not_requested: true, sections: [{ index: 1, active: 1, multiplier: "2", group: 5, filters: [{ index: 1, ...A, count: 1.5, import_from: "nauvis" }, { index: 2, type: "plasma", name: "x", count: 1 }, "text"] }, 7] } });
    expect(entity).toEqual({ kind: "constant", enabled: true, sections: [{ active: true, multiplier: 1, filters: [{ signal: SA, count: 0 }] }] });
    expect(notes.sort()).toEqual([
      "ignored control_behavior.sections.sections[].filters[].import_from",
      "ignored control_behavior.sections.trash_not_requested",
      "invalid control_behavior.is_on",
      "invalid control_behavior.sections.sections[]",
      "invalid control_behavior.sections.sections[].active",
      "invalid control_behavior.sections.sections[].filters[]",
      "invalid control_behavior.sections.sections[].filters[]",
      "invalid control_behavior.sections.sections[].filters[].count",
      "invalid control_behavior.sections.sections[].group",
      "invalid control_behavior.sections.sections[].multiplier",
    ]);
  });
});

describe("import: arithmetic combinator", () => {
  const read = (parameters: unknown) => importedEntity("arithmetic-combinator", { control_behavior: { arithmetic_conditions: parameters } });

  it("is not configured without settings", () => {
    expect(importedEntity("arithmetic-combinator")).toEqual({ entity: DEFAULT_ENTITY.arithmetic, notes: [] });
    expect(read({})).toEqual({ entity: DEFAULT_ENTITY.arithmetic, notes: [] });
    expect(read({ operation: "*", first_constant: 0 })).toEqual({ entity: DEFAULT_ENTITY.arithmetic, notes: [] });
  });

  it("reads signals, constants, networks, the operation and the output", () => {
    expect(read({ first_signal: B, first_signal_networks: RED, second_constant: 2, operation: "+", output_signal: A })).toEqual({
      entity: { kind: "arithmetic", first: { type: "signal", signal: SB, networks: RED }, operation: "+", second: { type: "constant", value: 2 }, output: SA },
      notes: [],
    });
    expect(read({ first_constant: -5, second_signal: { name: "iron-plate", quality: "rare" }, second_signal_networks: { green: false }, output_signal: IRON }).entity).toEqual({
      kind: "arithmetic", first: { type: "constant", value: -5 }, operation: "*", second: { type: "signal", signal: sig("iron-plate", "item", "rare"), networks: RED }, output: SIRON,
    });
    for (const operation of ["*", "/", "+", "-", "%", "^", "<<", ">>", "AND", "OR", "XOR"]) expect(read({ first_signal: B, operation, output_signal: A }).entity.operation).toBe(operation);
  });

  it("reads a network selection with both, one or neither key, and takes a signal over the constant next to it", () => {
    const networks = (selection: unknown) => (read({ first_signal: B, first_signal_networks: selection, first_constant: 9, output_signal: A }).entity.first as { networks: unknown }).networks;
    expect(networks({ red: true, green: true })).toEqual(BOTH_NETWORKS);
    expect(networks({})).toEqual(BOTH_NETWORKS);
    expect(networks(undefined)).toEqual(BOTH_NETWORKS);
    expect(networks({ red: false })).toEqual(GREEN);
    expect(networks({ red: true, green: false })).toEqual(RED);
    expect(networks({ red: false, green: false })).toEqual({ red: false, green: false });
  });

  it("takes operands without an output as not configured and says so", () => {
    expect(read({ first_signal: B, second_constant: 2, operation: "+" })).toEqual({ entity: DEFAULT_ENTITY.arithmetic, notes: ["changed control_behavior.arithmetic_conditions.output_signal"] });
  });

  it("resets a configuration the game does not have, such as a wildcard that is not allowed there", () => {
    const { entity, notes } = read({ first_signal: { type: "virtual", name: "signal-everything" }, second_constant: 2, output_signal: A });
    expect(entity).toEqual(DEFAULT_ENTITY.arithmetic);
    expect(notes).toEqual(["reset control_behavior"]);
    expect(read({ first_signal: B, output_signal: { type: "virtual", name: "signal-each" } }).notes).toEqual(["reset control_behavior"]);
    expect(read({ operation: "**", first_constant: 2.5, output_signal: A }).notes).toEqual(["invalid control_behavior.arithmetic_conditions.first_constant", "invalid control_behavior.arithmetic_conditions.operation"]);
  });
});

describe("import: decider combinator", () => {
  const read = (parameters: unknown) => importedEntity("decider-combinator", { control_behavior: { decider_conditions: parameters } });
  const EACH = { type: "virtual", name: "signal-each" };

  it("is empty without settings", () => {
    expect(importedEntity("decider-combinator")).toEqual({ entity: DEFAULT_ENTITY.decider, notes: [] });
    expect(read({})).toEqual({ entity: DEFAULT_ENTITY.decider, notes: [] });
    expect(read({ conditions: [], outputs: [], else_outputs: [] })).toEqual({ entity: DEFAULT_ENTITY.decider, notes: [] });
  });

  it("reads conditions with both spellings of the comparators, the way they join, and networks", () => {
    const { entity, notes } = read({
      conditions: [
        { first_signal: A, constant: 10, comparator: ">", compare_type: "and" },
        { first_signal: IRON, first_signal_networks: RED, second_signal: B, second_signal_networks: GREEN, comparator: "≤", compare_type: "and" },
        { first_signal: B, comparator: "≠", compare_type: "or" },
        { first_signal: EACH, comparator: "≥", constant: -1 },
        { first_signal: A, comparator: ">=", second_signal: B, constant: 99 },
        { first_signal: A, comparator: "<=" },
        { first_signal: A, comparator: "!=" },
        { first_signal: A },
        { first_signal: A, comparator: "=" },
      ],
    });
    expect(notes).toEqual([]);
    const constant = (value: number) => ({ type: "constant", value });
    expect(entity.conditions).toEqual([
      { join: "or", first: SA, firstNetworks: BOTH_NETWORKS, comparator: ">", second: constant(10) },
      { join: "and", first: SIRON, firstNetworks: RED, comparator: "<=", second: { type: "signal", signal: SB, networks: GREEN } },
      { join: "or", first: SB, firstNetworks: BOTH_NETWORKS, comparator: "!=", second: constant(0) },
      { join: "or", first: sig("signal-each"), firstNetworks: BOTH_NETWORKS, comparator: ">=", second: constant(-1) },
      { join: "or", first: SA, firstNetworks: BOTH_NETWORKS, comparator: ">=", second: { type: "signal", signal: SB, networks: BOTH_NETWORKS } },
      { join: "or", first: SA, firstNetworks: BOTH_NETWORKS, comparator: "<=", second: constant(0) },
      { join: "or", first: SA, firstNetworks: BOTH_NETWORKS, comparator: "!=", second: constant(0) },
      { join: "or", first: SA, firstNetworks: BOTH_NETWORKS, comparator: "<", second: constant(0) },
      { join: "or", first: SA, firstNetworks: BOTH_NETWORKS, comparator: "=", second: constant(0) },
    ]);
  });

  it("reads outputs and else outputs: the input count with its networks, or a constant, 1 by default", () => {
    const { entity, notes } = read({
      conditions: [{ first_signal: A, comparator: ">", constant: 0 }],
      outputs: [{ signal: A }, { signal: B, networks: RED, constant: 9 }, { signal: IRON, copy_count_from_input: false, constant: 5, networks: GREEN }, { signal: A, copy_count_from_input: false }, {}],
      else_outputs: [{ signal: { type: "virtual", name: "signal-everything" }, copy_count_from_input: true, networks: { red: false, green: false } }],
    });
    expect(notes).toEqual([]);
    expect(entity.outputs).toEqual([
      { signal: SA, copyCountFromInput: true, constant: 1, networks: BOTH_NETWORKS },
      { signal: SB, copyCountFromInput: true, constant: 1, networks: RED },
      { signal: SIRON, copyCountFromInput: false, constant: 5, networks: BOTH_NETWORKS },
      { signal: SA, copyCountFromInput: false, constant: 1, networks: BOTH_NETWORKS },
    ]);
    expect(entity.elseOutputs).toEqual([{ signal: sig("signal-everything"), copyCountFromInput: true, constant: 1, networks: { red: false, green: false } }]);
  });

  it("drops a condition without a left side and says that this can change the result", () => {
    const { entity, notes } = read({ conditions: [{ comparator: ">", constant: 1 }, { first_signal: A, comparator: ">", constant: 2, compare_type: "and" }, { compare_type: "and" }] });
    expect(entity.conditions).toEqual([{ join: "or", first: SA, firstNetworks: BOTH_NETWORKS, comparator: ">", second: { type: "constant", value: 2 } }]);
    expect(notes).toEqual(["changed control_behavior.decider_conditions.conditions[].first_signal"]);
  });

  it("takes the blank rows of a combinator that is not configured for what they are", () => {
    expect(read({ conditions: [{ comparator: "<", constant: 0 }], outputs: [{ copy_count_from_input: true }], else_outputs: [] })).toEqual({ entity: DEFAULT_ENTITY.decider, notes: [] });
    expect(read({ conditions: [{ comparator: "<", constant: 0 }], outputs: [{ signal: A }] }).notes).toEqual(["changed control_behavior.decider_conditions.conditions[].first_signal"]);
  });

  it("reports the single condition of a 1.1 blueprint and values of the wrong type", () => {
    const { entity, notes } = read({ first_signal: A, constant: 1, comparator: ">", output_signal: A, copy_count_from_input: true, conditions: [{ first_signal: A, comparator: "~", compare_type: "xor", constant: 2 ** 31 }] });
    expect(entity.conditions).toEqual([{ join: "or", first: SA, firstNetworks: BOTH_NETWORKS, comparator: "<", second: { type: "constant", value: 0 } }]);
    expect(notes.sort()).toEqual([
      "ignored control_behavior.decider_conditions.comparator",
      "ignored control_behavior.decider_conditions.constant",
      "ignored control_behavior.decider_conditions.copy_count_from_input",
      "ignored control_behavior.decider_conditions.first_signal",
      "ignored control_behavior.decider_conditions.output_signal",
      "invalid control_behavior.decider_conditions.conditions[].comparator",
      "invalid control_behavior.decider_conditions.conditions[].compare_type",
      "invalid control_behavior.decider_conditions.conditions[].constant",
    ]);
  });

  it("resets an each output without each in a condition, which the game does not have", () => {
    expect(read({ conditions: [{ first_signal: A, comparator: ">", constant: 0 }], outputs: [{ signal: EACH }] })).toEqual({ entity: DEFAULT_ENTITY.decider, notes: ["reset control_behavior"] });
  });
});

describe("import: selector combinator", () => {
  const read = (control_behavior: unknown) => importedEntity("selector-combinator", { control_behavior });
  const mode = (control_behavior: unknown) => read(control_behavior).entity.mode;

  it("is as placed without settings", () => {
    expect(importedEntity("selector-combinator")).toEqual({ entity: DEFAULT_ENTITY.selector, notes: [] });
    expect(read({})).toEqual({ entity: DEFAULT_ENTITY.selector, notes: [] });
  });

  it("reads every mode", () => {
    const constant = (value: number) => ({ type: "constant", value });
    expect(mode({ operation: "select", select_max: false, index_constant: 2, index_comparator: "<" })).toEqual({ operation: "select", max: false, index: constant(2), indexComparator: "<" });
    expect(mode({ index_signal: A, index_constant: 7, index_comparator: "≥" })).toEqual({ operation: "select", max: true, index: { type: "signal", signal: SA, networks: BOTH_NETWORKS }, indexComparator: ">=" });
    expect(mode({ operation: "count", count_signal: A })).toEqual({ operation: "count", output: SA });
    expect(mode({ operation: "count" })).toEqual({ operation: "count" });
    expect(mode({ operation: "random", random_update_interval: 15 })).toEqual({ operation: "random", interval: 15 });
    expect(mode({ operation: "random" })).toEqual({ operation: "random", interval: 0 });
    expect(mode({ operation: "stack-size" })).toEqual({ operation: "stack-size" });
    expect(mode({ operation: "rocket-capacity" })).toEqual({ operation: "rocket-capacity" });
    expect(mode({ operation: "quality-filter", quality_filter: { quality: "rare", comparator: "≥" } })).toEqual({ operation: "quality-filter", comparator: ">=", quality: "rare" });
    expect(mode({ operation: "quality-filter", quality_filter: "epic" })).toEqual({ operation: "quality-filter", comparator: "=", quality: "epic" });
    expect(mode({ operation: "quality-filter", quality_filter: { comparator: ">" } })).toEqual({ operation: "quality-filter", comparator: ">" });
    expect(mode({ operation: "quality-filter" })).toEqual({ operation: "quality-filter", comparator: "=" });
    expect(mode({ operation: "quality-select" })).toEqual({ operation: "quality-select", highest: true });
    expect(mode({ operation: "quality-select", select_highest_quality: false })).toEqual({ operation: "quality-select", highest: false });
    expect(mode({ operation: "quality-transfer", quality_source_static: { name: "legendary" }, quality_destination_signal: { type: "virtual", name: "signal-each" } })).toEqual({
      operation: "quality-transfer", source: { type: "quality", quality: "legendary" }, destination: sig("signal-each"),
    });
    expect(mode({ operation: "quality-transfer" })).toEqual({ operation: "quality-transfer", source: { type: "quality", quality: "normal" } });
    expect(mode({ operation: "quality-transfer", select_quality_from_signal: true, quality_source_signal: { name: "iron-plate", quality: "rare" }, quality_source_static: { name: "epic" }, quality_destination_signal: A })).toEqual({
      operation: "quality-transfer", source: { type: "signal", signal: SIRON }, destination: SA,
    });
    expect(mode({ operation: "quality-transfer", select_quality_from_signal: true })).toEqual({ operation: "quality-transfer", source: { type: "signal" } });
    expect(mode({ operation: "time", day_length_signal: A, day_tick_signal: B, game_tick_signal: IRON })).toEqual({ operation: "time", dayLength: SA, dayTick: SB, gameTick: SIRON });
    expect(mode({ operation: "time" })).toEqual({ operation: "time" });
  });

  it("reads the wrapper of a pre-release string and passes over the fields of the modes that are not selected", () => {
    expect(read({ selector_conditions: { operation: "random", select_max: true, index_constant: 0, random_update_interval: 15 } })).toEqual({ entity: { kind: "selector", mode: { operation: "random", interval: 15 } }, notes: [] });
    expect(read({ operation: "stack-size", count_signal: A, quality_filter: "rare", game_tick_signal: B })).toEqual({ entity: { kind: "selector", mode: { operation: "stack-size" } }, notes: [] });
  });

  it("reports an operation it does not know and fields that are no selector's", () => {
    expect(read({ operation: "teleport", mystery: 1 })).toEqual({ entity: DEFAULT_ENTITY.selector, notes: ["invalid control_behavior.operation", "ignored control_behavior.mystery"] });
    expect(read({ operation: "random", random_update_interval: -1 })).toEqual({ entity: { kind: "selector", mode: { operation: "random", interval: 0 } }, notes: ["invalid control_behavior.random_update_interval"] });
  });
});

describe("import: lamp", () => {
  const read = (control_behavior: unknown, fields: object = {}) => importedEntity("small-lamp", { control_behavior, ...fields });
  const condition = { first_signal: A, constant: 0, comparator: ">" };

  it("is as placed without settings", () => {
    expect(importedEntity("small-lamp")).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: [] });
    expect(read({})).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: [] });
  });

  it("reads the condition when the lamp is controlled by the circuit", () => {
    expect(read({ circuit_enabled: true, circuit_condition: condition }).entity).toEqual({ ...DEFAULT_ENTITY.lamp, condition: { first: SA, comparator: ">", second: { type: "constant", value: 0 } } });
    expect(read({ circuit_enabled: true, circuit_condition: { first_signal: { type: "virtual", name: "signal-anything" }, second_signal: B, constant: 4, comparator: "≠" } }).entity.condition).toEqual({
      first: sig("signal-anything"), comparator: "!=", second: { type: "signal", signal: SB },
    });
    expect(read({ circuit_enabled: true, circuit_condition: { first_signal: A } }).entity.condition).toEqual({ first: SA, comparator: "<", second: { type: "constant", value: 0 } });
  });

  it("says so when a condition is not in use, or in use and blank; the editor has neither", () => {
    expect(read({ circuit_condition: condition })).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: ["changed control_behavior.circuit_condition"] });
    expect(read({ circuit_enabled: false, circuit_condition: { comparator: "<", constant: 0 } })).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: [] });
    expect(read({ circuit_enabled: true })).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: ["changed control_behavior.circuit_enabled"] });
    expect(read({ circuit_enabled: true, circuit_condition: { constant: 5 } }).notes).toEqual(["changed control_behavior.circuit_enabled"]);
  });

  it("reads networks, always on, the color modes by number and the color signals", () => {
    const { entity, notes } = read({ input_networks: GREEN, use_colors: true, color_mode: 1, red_signal: A, green_signal: B, blue_signal: IRON, rgb_signal: { type: "virtual", name: "signal-white" } }, { always_on: true });
    expect(notes).toEqual([]);
    expect(entity).toEqual({ kind: "lamp", inputNetworks: GREEN, alwaysOn: true, useColors: true, colorMode: "components", redSignal: SA, greenSignal: SB, blueSignal: SIRON, rgbSignal: sig("signal-white") });
    expect(read({ use_colors: true }).entity.colorMode).toBe("mapping");
    expect(read({ use_colors: true, color_mode: 0 }).entity.colorMode).toBe("mapping");
    expect(read({ use_colors: true, color_mode: 2 }).entity.colorMode).toBe("packed-rgb");
  });

  it("keeps a color mode only with colors on, and reports one it does not know", () => {
    expect(read({ color_mode: 2 })).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: ["changed control_behavior.color_mode"] });
    expect(read({ use_colors: true, color_mode: 3 })).toEqual({ entity: { ...DEFAULT_ENTITY.lamp, useColors: true }, notes: ["changed control_behavior.color_mode"] });
  });

  it("reads the color from 0 to 1, or from 0 to 255 when a value is above 1, as an object or a list", () => {
    const color = (value: unknown) => read(undefined, { color: value }).entity.color;
    expect(color({ r: 1, g: 0.5, b: 0, a: 1 })).toEqual({ r: 255, g: 128, b: 0 });
    expect(color({ r: 255, g: 128, b: 0, a: 255 })).toEqual({ r: 255, g: 128, b: 0 });
    expect(color({ g: 0.2 })).toEqual({ r: 0, g: 51, b: 0 });
    expect(color([1, 0, 0.5019607843137255, 0.5])).toEqual({ r: 255, g: 0, b: 128 });
    expect(color({ r: 300, g: 1, b: 0 })).toEqual({ r: 255, g: 1, b: 0 });
    expect(read(undefined, { color: "red" })).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: ["changed color"] });
    expect(read(undefined, { color: { r: -1 } }).notes).toEqual(["changed color"]);
  });

  it("reports the connection to the logistic network, which the editor does not have", () => {
    expect(read({ connect_to_logistic_network: true, logistic_condition: condition })).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: ["changed control_behavior.connect_to_logistic_network"] });
    expect(read({ connect_to_logistic_network: false, logistic_condition: condition }).notes).toEqual([]);
  });

  it("resets a condition the game does not have", () => {
    expect(read({ circuit_enabled: true, circuit_condition: { first_signal: { type: "virtual", name: "signal-each" }, constant: 1, comparator: ">" } })).toEqual({ entity: DEFAULT_ENTITY.lamp, notes: ["reset control_behavior"] });
  });
});

describe("import: electric pole", () => {
  it("is the prototype it names and has no settings", () => {
    for (const prototype of prototypesOf("pole")) expect(importedEntity(prototype)).toEqual({ entity: { kind: "pole", prototype }, notes: [] });
    expect(importedEntity("big-electric-pole", { control_behavior: {}, neighbours: [2] })).toEqual({ entity: { kind: "pole", prototype: "big-electric-pole" }, notes: ["ignored control_behavior", "ignored neighbours"] });
  });
});

describe("import: programmable speaker", () => {
  const parameters = { playback_volume: 1, playback_mode: "local", allow_polyphony: false, volume_controlled_by_signal: false };
  const alert = { show_alert: false, show_on_map: true, alert_message: "" };
  const circuit = { signal_value_is_pitch: false, stop_playing_sounds: false, instrument_id: 0, note_id: 0 };
  const read = (fields: { parameters?: object; alert_parameters?: object; condition?: object; circuit?: object }, options?: ImportOptions) =>
    importedEntity(
      "programmable-speaker",
      { parameters: { ...parameters, ...fields.parameters }, alert_parameters: { ...alert, ...fields.alert_parameters }, control_behavior: { circuit_condition: fields.condition ?? { constant: 0, comparator: "<" }, circuit_parameters: { ...circuit, ...fields.circuit } } },
      options,
    );

  it("is as placed without settings, with its objects missing or filled with the defaults", () => {
    expect(importedEntity("programmable-speaker")).toEqual({ entity: DEFAULT_ENTITY.speaker, notes: [] });
    expect(read({})).toEqual({ entity: DEFAULT_ENTITY.speaker, notes: [] });
  });

  it("reads every setting", () => {
    const { entity, notes } = read({
      parameters: { playback_volume: 0.625, playback_mode: "global", allow_polyphony: true, volume_controlled_by_signal: true, volume_signal_id: B },
      alert_parameters: { show_alert: true, show_on_map: false, icon_signal_id: IRON, alert_message: "Out of plates" },
      condition: { first_signal: A, constant: 3, comparator: "≥" },
      circuit: { stop_playing_sounds: true, instrument_id: 3, note_id: 1 },
    });
    expect(notes).toEqual([]);
    expect(entity).toEqual({
      kind: "speaker", condition: { first: SA, comparator: ">=", second: { type: "constant", value: 3 } }, instrument: "piano", note: "F#3", volume: 62.5, volumeSignal: SB, playbackMode: "global", allowPolyphony: true, stopPlayingSounds: true,
      showAlert: true, showOnMap: false, alertIcon: SIRON, alertMessage: "Out of plates",
    });
    expect(read({ parameters: { playback_mode: "surface" }, condition: { first_signal: { type: "virtual", name: "signal-everything" }, second_signal: B, comparator: "<" } }).entity).toMatchObject({
      playbackMode: "surface", condition: { first: sig("signal-everything"), comparator: "<", second: { type: "signal", signal: SB } },
    });
  });

  it("gives the volume in percent, without the noise of the float the game stores, and within 0 to 100", () => {
    const volume = (stored: unknown) => read({ parameters: { playback_volume: stored } });
    expect(volume(0.800000011920929).entity.volume).toBe(80);
    expect(volume(0.8).entity.volume).toBe(80);
    expect(volume(0.12345).entity.volume).toBe(12.345);
    expect(volume(0).entity.volume).toBe(0);
    expect(volume(0.3333333432674408).entity.volume).toBe(33.33333);
    expect(volume(1.5)).toMatchObject({ entity: { volume: 100 }, notes: ["changed parameters.playback_volume"] });
    expect(volume(-0.5)).toMatchObject({ entity: { volume: 0 }, notes: ["changed parameters.playback_volume"] });
    expect(volume("loud")).toMatchObject({ entity: { volume: 100 }, notes: ["invalid parameters.playback_volume"] });
  });

  it("reads the pitch signal from the left side of the condition", () => {
    expect(read({ condition: { first_signal: A, constant: 0, comparator: "<" }, circuit: { signal_value_is_pitch: true, instrument_id: 2 } })).toEqual({ entity: { ...DEFAULT_ENTITY.speaker, pitchSignal: SA, instrument: "drum-kit" }, notes: [] });
    expect(read({ condition: { first_signal: A }, circuit: { signal_value_is_pitch: true } }).notes).toEqual([]);
    expect(read({ condition: { first_signal: A, constant: 5, comparator: ">" }, circuit: { signal_value_is_pitch: true } })).toEqual({ entity: { ...DEFAULT_ENTITY.speaker, pitchSignal: SA }, notes: ["changed control_behavior.circuit_condition.comparator"] });
    expect(read({ circuit: { signal_value_is_pitch: true } })).toEqual({ entity: DEFAULT_ENTITY.speaker, notes: ["changed control_behavior.circuit_parameters.signal_value_is_pitch"] });
  });

  it("names instrument and note from their places in the lists of the game; the first of each goes without saying", () => {
    const sound = (instrument_id: number, note_id: number, options?: ImportOptions) => {
      const { entity, notes } = read({ circuit: { instrument_id, note_id } }, options);
      return [entity.instrument, entity.note, ...notes];
    };
    expect(sound(0, 0)).toEqual([undefined, undefined]);
    expect(sound(0, 6)).toEqual([undefined, "siren"]);
    expect(sound(11, 0)).toEqual(["steel-drum", undefined]);
    expect(sound(11, 35)).toEqual(["steel-drum", "E6"]);
    expect(sound(12, 0)).toEqual([undefined, undefined, "changed control_behavior.circuit_parameters.instrument_id"]);
    expect(sound(3, 48)).toEqual(["piano", undefined, "changed control_behavior.circuit_parameters.note_id"]);
    expect(sound(3, 1, {})).toEqual([undefined, undefined, "changed control_behavior.circuit_parameters.instrument_id"]);
    expect(sound(0, 0, {})).toEqual([undefined, undefined]);
    expect(sound(-1, 1.5)).toEqual([undefined, undefined, "invalid control_behavior.circuit_parameters.instrument_id", "invalid control_behavior.circuit_parameters.note_id"]);
  });

  it("keeps the volume signal only while it is in use, and says so", () => {
    expect(read({ parameters: { volume_controlled_by_signal: true } })).toEqual({ entity: DEFAULT_ENTITY.speaker, notes: ["changed parameters.volume_controlled_by_signal"] });
    expect(read({ parameters: { volume_signal_id: B } })).toEqual({ entity: DEFAULT_ENTITY.speaker, notes: ["changed parameters.volume_signal_id"] });
  });

  it("reads the switch between local and global of older strings", () => {
    const old = (fields: object) => importedEntity("programmable-speaker", { parameters: fields }).entity.playbackMode;
    expect(old({ playback_globally: true })).toBe("global");
    expect(old({ playback_globally: false })).toBe("local");
    expect(old({ playback_globally: true, playback_mode: "surface" })).toBe("surface");
  });

  it("reports values of the wrong type and fields it does not know", () => {
    const { entity, notes } = importedEntity("programmable-speaker", { parameters: { playback_mode: "everywhere", allow_polyphony: 1, reverb: true }, alert_parameters: { alert_message: 5, show_on_map: "yes" }, control_behavior: { circuit_enabled: true, circuit_parameters: [] } });
    expect(entity).toEqual(DEFAULT_ENTITY.speaker);
    expect(notes.sort()).toEqual([
      "ignored control_behavior.circuit_enabled", "ignored parameters.reverb", "invalid alert_parameters.alert_message", "invalid alert_parameters.show_on_map", "invalid control_behavior.circuit_parameters", "invalid parameters.allow_polyphony",
      "invalid parameters.playback_mode",
    ]);
  });
});

describe("import: wires", () => {
  const SIDES: readonly (readonly [EntityKind, TerminalSide])[] = ENTITY_KINDS.flatMap((kind) => TERMINALS[kind].map((side) => [kind, side] as const));
  const entity = (number: number, kind: EntityKind) => ({ entity_number: number, name: prototypesOf(kind)[0], ...at(number * 3 + (PROTOTYPES[prototypesOf(kind)[0]!].height > 1 ? 0 : 0.5), 0.5), direction: 4 });

  it("reads a wire between every two kinds of connection point, in both colors and in either order", () => {
    for (const [aKind, aSide] of SIDES) {
      for (const [bKind, bSide] of SIDES) {
        for (const color of ["red", "green"] as const) {
          const tuple = [1, connectorId({ kind: aKind }, { side: aSide }, color), 2, connectorId({ kind: bKind }, { side: bSide }, color)];
          for (const wire of [tuple, [tuple[2], tuple[3], tuple[0], tuple[1]]]) {
            const { circuit, report } = imported(blueprintOf([entity(1, aKind), entity(2, bKind)], [wire]));
            expect(report.wires, `${color} ${aKind}.${aSide} ${bKind}.${bSide}`).toEqual({ imported: 1, copper: 0, toDropped: 0, invalid: 0 });
            expect(circuit.wires).toEqual([{ color, a: { entity: "e1", side: aSide }, b: { entity: "e2", side: bSide } }]);
          }
        }
      }
    }
  });

  it("reads a wire from a combinator to itself and a wire that is there twice once", () => {
    const { circuit, report } = imported(blueprintOf([entity(1, "decider"), entity(2, "lamp")], [[1, 3, 1, 1], [1, 2, 1, 4], [1, 1, 1, 3], [2, 1, 1, 3], [1, 3, 2, 1]]));
    expect(circuit.wires).toEqual([
      { color: "red", a: { entity: "e1", side: "in" }, b: { entity: "e1", side: "out" } },
      { color: "green", a: { entity: "e1", side: "in" }, b: { entity: "e1", side: "out" } },
      { color: "red", a: { entity: "e1", side: "out" }, b: { entity: "e2", side: "in" } },
    ]);
    expect(report.wires).toEqual({ imported: 3, copper: 0, toDropped: 0, invalid: 0 });
  });

  it("counts as invalid what is no wire between two connectors that exist", () => {
    const wires = [[1, 1, 2, 2], [1, 3, 2, 1], [2, 4, 3, 1], [1, 1, 1, 1], [3, 3, 3, 3], [1, 0, 2, 1], [1, 7, 2, 1], [1, 5, 3, 1], [1, 1, 2], [1, 1, 2, 1, 1], [1, 1.5, 2, 1], "wire", null, { 0: 1 }, [1, 1, 99, 1], ["1", 1, 2, 1]];
    const { circuit, report } = imported(blueprintOf([entity(1, "lamp"), entity(2, "constant"), entity(3, "decider")], wires));
    expect(circuit.wires).toEqual([]);
    expect(report.wires).toEqual({ imported: 0, copper: 0, toDropped: 0, invalid: wires.length });
  });

  it("counts the copper wires of poles and switches apart", () => {
    const { report } = imported(blueprintOf([entity(1, "pole"), entity(2, "pole")], [[1, 5, 2, 5], [1, 5, 2, 6], [1, 6, 2, 5], [1, 1, 2, 1]]));
    expect(report.wires).toEqual({ imported: 1, copper: 3, toDropped: 0, invalid: 0 });
  });
});

describe("import: robustness", () => {
  it("gives a circuit the language can say exactly, whatever the settings are", () => {
    const odd = { type: "virtual", name: 'say "hi"\n\\', quality: "odd quality" };
    const entities = [
      { entity_number: 1, name: "constant-combinator", ...at(0.5, 0.5), player_description: 'a "b"\n\\c\t', control_behavior: { sections: { sections: [{ index: 1, group: 'g "1"\n', filters: [{ index: 1, ...odd, count: 1 }] }] } } },
      { entity_number: 2, name: "selector-combinator", ...at(3, 0.5), direction: 4, control_behavior: { operation: "quality-filter", quality_filter: { quality: "signal", comparator: "<" } } },
      { entity_number: 3, name: "selector-combinator", ...at(6, 0.5), direction: 4, control_behavior: { operation: "quality-transfer", quality_source_static: { name: "in" }, quality_destination_signal: odd } },
      { entity_number: 4, name: "programmable-speaker", ...at(9.5, 0.5), alert_parameters: { alert_message: 'm "x"\r\n' }, control_behavior: { circuit_condition: { first_signal: odd, second_signal: odd } } },
      { entity_number: 5, name: "small-lamp", ...at(11.5, 0.5), control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: { name: "" }, comparator: ">" }, red_signal: { name: 7 } } },
      { entity_number: 6, name: "decider-combinator", ...at(14, 0.5), direction: 4, control_behavior: { decider_conditions: { conditions: [{ first_signal: odd, second_signal: odd, comparator: "=" }], outputs: [{ signal: odd, constant: -2147483648, copy_count_from_input: false }] } } },
    ];
    const { circuit, report } = imported(blueprintOf(entities, [], { label: 'label "x"\n\\' }));
    for (const entity of circuit.entities) expect(checkEntity(entity), entity.name).toEqual({ ok: true });
    expect(report.settings.filter((note) => note.kind === "reset")).toEqual([]);
    expect(circuit.name).toBe('label "x"\n\\');
  });

  it("never throws for a blueprint of the wrong shape", () => {
    const shapes: unknown[] = [null, 0, "x", [], [[]], {}, { a: 1 }, true];
    for (const control_behavior of shapes) {
      for (const name of PROTOTYPE_NAMES) {
        const fields = { control_behavior, parameters: control_behavior, alert_parameters: control_behavior, color: control_behavior, always_on: control_behavior, direction: control_behavior, player_description: control_behavior };
        expect(() => importBlueprint(blueprintOf([{ entity_number: 1, name, ...at(0.5, 0.5), ...fields }], shapes))).not.toThrow();
      }
      expect(() => importBlueprint({ blueprint: control_behavior })).not.toThrow();
      expect(() => importBlueprint({ blueprint_book: control_behavior })).not.toThrow();
      expect(() => importBlueprint({ blueprint_book: { blueprints: control_behavior } })).not.toThrow();
      expect(() => importBlueprint({ blueprint: { entities: control_behavior, wires: control_behavior, label: control_behavior, version: control_behavior } })).not.toThrow();
      expect(() => inspectBlueprint({ blueprint_book: { blueprints: [control_behavior] } })).not.toThrow();
    }
  });

  it("uses the lists of the game that are given, not the ones it was tested with", () => {
    const blueprint = blueprintOf([{ entity_number: 1, name: "programmable-speaker", ...at(0.5, 0.5), control_behavior: { circuit_parameters: { instrument_id: 1, note_id: 1 } } }]);
    expect(imported(blueprint, { instruments: [{ name: "first", notes: ["a"] }, { name: "second", notes: ["b", "c"] }] }).circuit.entities[0]).toMatchObject({ instrument: "second", note: "c" });
    expect(imported(blueprint, { instruments: INSTRUMENTS }).circuit.entities[0]).toMatchObject({ instrument: "miscellaneous", note: "alert-destroyed" });
  });
});
