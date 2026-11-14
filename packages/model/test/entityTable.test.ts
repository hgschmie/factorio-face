// The entity table of the game (data/entities-2.1.24.json, written by tools/catalog/generate.mjs) and what the editor takes from
// it. The numbers are those of Factorio 2.1.24 with its five standard modules; docs/factorio-audit.md 13 says where each is from.
import { afterEach, describe, expect, it } from "vitest";
import data from "../data/entities-2.1.24.json" with { type: "json" };
import {
  DEFAULT_WIRE_REACH, entityTable, hasOwnWireReach, missingEditorPrototypes, parseEntityTable, PROTOTYPE_NAMES, PROTOTYPES, prototypeData, setEntityTable, STANDARD_ENTITY_TABLE, STANDARD_WIRE_REACH, tileSize, wireReachBetween,
  type EntityPrototype,
} from "../src/index.ts";

const table = STANDARD_ENTITY_TABLE;
const names = (entities: readonly EntityPrototype[]): string[] => entities.map((entity) => entity.name);
const withModules = (...enabled: string[]): EntityPrototype[] => table.entities.filter((entity) => entity.modules.every((module) => enabled.includes(module)) && !entity.removedBy?.some((module) => enabled.includes(module)));
const get = (name: string): EntityPrototype => table.byName.get(name)!;
/** The file's table with other records, or with records changed by name. */
const tableWith = (change: (records: Record<string, unknown>[]) => Record<string, unknown>[]): unknown => ({ ...data, entities: change(data.entities.map((record) => ({ ...record }))) });

afterEach(() => setEntityTable(STANDARD_ENTITY_TABLE));

describe("standard entity table", () => {
  it("has every prototype a circuit wire connects to: 98, of which 80 without Space Age and 79 with base alone", () => {
    expect(table.game).toEqual({ version: "2.1.24", build: 87808 });
    expect(table.entities).toHaveLength(98);
    expect(names(table.entities)).toEqual([...names(table.entities)].sort());
    expect(table.byName.size).toBe(98);
    expect(withModules("base")).toHaveLength(79);
    expect(withModules("base", "elevated-rails")).toHaveLength(79);
    expect(withModules("base", "recycler", "quality")).toHaveLength(80);
    expect(withModules("base", "elevated-rails", "recycler", "quality", "space-age")).toHaveLength(98);
    expect(names(withModules("base", "recycler")).filter((name) => !names(withModules("base")).includes(name))).toEqual(["recycler"]);
    expect(new Set(table.entities.map((entity) => entity.type)).size).toBe(48);
  });

  it("has thirteen footprints, eighteen prototypes that are not square, and eighteen whose selection box is not their tiles", () => {
    const footprints = new Map<string, number>();
    for (const { width, height } of table.entities) footprints.set(`${width}x${height}`, (footprints.get(`${width}x${height}`) ?? 0) + 1);
    expect(Object.fromEntries(footprints)).toEqual({ "1x1": 41, "1x2": 8, "2x1": 4, "2x2": 10, "2x3": 2, "2x4": 1, "3x2": 2, "3x3": 17, "3x5": 1, "4x4": 3, "5x5": 6, "8x8": 2, "9x9": 1 });
    expect(table.entities.filter((entity) => entity.width !== entity.height)).toHaveLength(18);
    // In the game's 1/256 of a tile: 0.4 is 102/256.
    const boxes = new Map<string, string[]>();
    for (const { name, width, height, selectionBox } of table.entities) if (selectionBox) boxes.set(`${width}x${height} ${selectionBox.join(" ")}`, [...(boxes.get(`${width}x${height} ${selectionBox.join(" ")}`) ?? []), name]);
    expect(Object.fromEntries(boxes)).toEqual({
      "1x1 -0.3984375 -0.34765625 0.3984375 0.44921875": ["bulk-inserter", "burner-inserter", "fast-inserter", "inserter", "long-handed-inserter", "stack-inserter"],
      "1x1 -0.5 -0.6484375 0.5 0.5": ["display-panel"],
      "2x1 -0.8984375 -0.5 0.8984375 0.5": ["express-splitter", "fast-splitter", "splitter", "turbo-splitter"],
      "1x1 -0.59765625 -1.48828125 0.59765625 0.48828125": ["offshore-pump"],
      "1x1 -0.44921875 -0.6484375 0.44921875 0.6484375": ["rail-signal"],
      "2x4 -0.8984375 -1.84765625 0.8984375 1.84765625": ["recycler"],
      "1x1 -0.3984375 -0.3984375 0.3984375 0.3984375": ["small-electric-pole"],
      "2x2 -0.796875 -1 0.796875 1": ["steel-furnace", "stone-furnace"],
      "2x2 -0.8984375 -0.8984375 0.8984375 0.8984375": ["train-stop"],
    });
    expect(table.entities.every(({ selectionBox }) => !selectionBox || selectionBox.every((edge) => Number.isInteger(edge * 256)))).toBe(true);
    expect(names(table.entities.filter((entity) => entity.offGrid))).toEqual(["land-mine"]);
  });

  it("turns only what is not square in every direction it has, and knows the entities with 2, 8 and 16 directions", () => {
    expect(table.entities.filter((entity) => entity.width !== entity.height && entity.directions === 1)).toEqual([]);
    const byCount = (count: number): string[] => names(table.entities.filter((entity) => entity.directions === count));
    expect(byCount(2)).toEqual(["storage-tank"]);
    expect(byCount(8)).toEqual(["flamethrower-turret", "railgun-turret"]);
    expect(byCount(16)).toEqual(["rail-chain-signal", "rail-signal"]);
    expect(byCount(1).length + byCount(4).length).toBe(93);
  });

  it("gives 93 prototypes the standard reach of 9 and five another", () => {
    expect(STANDARD_WIRE_REACH).toBe(9);
    expect(DEFAULT_WIRE_REACH).toBe(STANDARD_WIRE_REACH);
    expect(Object.fromEntries(table.entities.filter((entity) => entity.wireReach !== STANDARD_WIRE_REACH).map((entity) => [entity.name, entity.wireReach]))).toEqual({
      "agricultural-tower": 30,
      "big-electric-pole": 32,
      "power-switch": 10,
      "small-electric-pole": 7.5,
      substation: 18,
    });
  });

  it("lets every pole and every prototype with another reach than 9 have its own, and nothing else", () => {
    expect(names(table.entities.filter(hasOwnWireReach))).toEqual(["agricultural-tower", "big-electric-pole", "medium-electric-pole", "power-switch", "small-electric-pole", "substation"]);
    expect(get("medium-electric-pole").wireReach).toBe(9);
  });

  it("knows what is hidden, what no item places, and the default signals", () => {
    const hidden = table.entities.filter((entity) => entity.hidden);
    expect(names(hidden)).toEqual([
      "blue-chest", "bottomless-chest", "crash-site-chest-1", "crash-site-chest-2", "express-loader", "fast-loader", "infinity-chest", "infinity-pipe", "linked-chest", "loader", "proxy-container", "red-chest", "turbo-loader",
    ]);
    expect(names(table.entities.filter((entity) => entity.placedBy.length === 0))).toEqual(["blue-chest", "crash-site-chest-1", "crash-site-chest-2", "red-chest"]);
    expect(table.entities.every((entity) => entity.placedBy.length === 0 || (entity.placedBy.length === 1 && entity.placedBy[0] === entity.name))).toBe(true);
    expect(get("accumulator").signals).toEqual({ output: { kind: "virtual", name: "signal-A" } });
    expect(get("small-lamp").signals).toEqual({
      red: { kind: "virtual", name: "signal-red" }, green: { kind: "virtual", name: "signal-green" }, blue: { kind: "virtual", name: "signal-blue" }, rgb: { kind: "virtual", name: "signal-white" },
    });
    expect(Object.keys(get("train-stop").signals)).toEqual(["priority", "train_stopped", "trains_count", "trains_limit"]);
    expect(get("constant-combinator").signals).toEqual({});
    expect(table.entities.filter((entity) => Object.keys(entity.signals).length > 0)).toHaveLength(40);
  });

  it("is a full record for every prototype, defaults filled in", () => {
    expect(get("medium-electric-pole")).toEqual({
      name: "medium-electric-pole", type: "electric-pole", displayName: "Medium electric pole", width: 1, height: 1, directions: 1, wireReach: 9, hidden: false, offGrid: false, placedBy: ["medium-electric-pole"], signals: {}, modules: ["base"],
    });
    expect(get("railgun-turret")).toMatchObject({ type: "ammo-turret", width: 3, height: 5, directions: 8, modules: ["space-age"] });
    expect(get("recycler")).toMatchObject({ type: "furnace", width: 2, height: 4, directions: 4, modules: ["recycler"] });
  });
});

/** The prototypes with a kind of their own; every other one of the table is a generic entity (entitySettings.test.ts). */
const OWN_NAMES = PROTOTYPE_NAMES.filter((name) => PROTOTYPES[name]!.kind !== "entity");

describe("the editor's prototypes", () => {
  it("are what they were when their game data was written by hand", () => {
    expect(Object.fromEntries(OWN_NAMES.map((name) => [name, PROTOTYPES[name]]))).toEqual({
      "constant-combinator": { kind: "constant", label: "constant combinator", width: 1, height: 1, rotatable: true },
      "arithmetic-combinator": { kind: "arithmetic", label: "arithmetic combinator", width: 1, height: 2, rotatable: true },
      "decider-combinator": { kind: "decider", label: "decider combinator", width: 1, height: 2, rotatable: true },
      "selector-combinator": { kind: "selector", label: "selector combinator", width: 1, height: 2, rotatable: true },
      "small-lamp": { kind: "lamp", label: "lamp", width: 1, height: 1, rotatable: false },
      "small-electric-pole": { kind: "pole", label: "small electric pole", width: 1, height: 1, rotatable: false, wireReach: 7.5, selectionBox: [-0.3984375, -0.3984375, 0.3984375, 0.3984375] },
      "medium-electric-pole": { kind: "pole", label: "medium electric pole", width: 1, height: 1, rotatable: false, wireReach: 9 },
      "big-electric-pole": { kind: "pole", label: "big electric pole", width: 2, height: 2, rotatable: false, wireReach: 32 },
      substation: { kind: "pole", label: "substation", width: 2, height: 2, rotatable: false, wireReach: 18 },
      "programmable-speaker": { kind: "speaker", label: "programmable speaker", width: 1, height: 1, rotatable: false },
    });
    expect(Object.keys(PROTOTYPES)).toEqual([...PROTOTYPE_NAMES]);
    for (const name of PROTOTYPE_NAMES) expect("wireReach" in PROTOTYPES[name]!).toBe(hasOwnWireReach(get(name)));
  });

  it("are in the table of the game, none of them hidden or of a module other than base", () => {
    for (const name of OWN_NAMES) expect(get(name)).toMatchObject({ name, hidden: false, modules: ["base"], placedBy: [name] });
    expect(entityTable()).toBe(STANDARD_ENTITY_TABLE);
  });
});

describe("another entity table", () => {
  it("replaces the game data of the editor's prototypes, and the standard one brings it back", () => {
    const modded = parseEntityTable(tableWith((records) => records.map((record) => (record.name === "small-lamp" ? { ...record, displayName: "Big lamp", width: 2, height: 3, directions: 4, wireReach: 12 } : record))));
    setEntityTable(modded);
    expect(entityTable()).toBe(modded);
    expect(PROTOTYPES["small-lamp"]).toEqual({ kind: "lamp", label: "big lamp", width: 2, height: 3, rotatable: true, wireReach: 12 });
    expect(prototypeData({ kind: "lamp" }).width).toBe(2);
    expect(tileSize({ kind: "lamp" }, "east")).toEqual({ width: 3, height: 2 });
    expect(wireReachBetween({ kind: "lamp" }, { kind: "constant" }, 20)).toEqual({ reach: 12, of: "small-lamp" });
    expect(PROTOTYPES["decider-combinator"]).toEqual({ kind: "decider", label: "decider combinator", width: 1, height: 2, rotatable: true });

    setEntityTable(STANDARD_ENTITY_TABLE);
    expect(PROTOTYPES["small-lamp"]).toEqual({ kind: "lamp", label: "lamp", width: 1, height: 1, rotatable: false });
    expect(wireReachBetween({ kind: "lamp" }, { kind: "constant" }, 20)).toEqual({ reach: 20, of: "project" });
  });

  it("is refused, and nothing changes, when it lacks a prototype the editor has", () => {
    const without = parseEntityTable(tableWith((records) => records.filter((record) => record.name !== "substation").map((record) => (record.name === "small-lamp" ? { ...record, width: 2 } : record))));
    expect(missingEditorPrototypes(without)).toEqual(["substation"]);
    expect(missingEditorPrototypes(STANDARD_ENTITY_TABLE)).toEqual([]);
    expect(missingEditorPrototypes(parseEntityTable(tableWith(() => [])))).toHaveLength(10);
    expect(() => setEntityTable(without)).toThrow("The entity table of Factorio 2.1.24 has no substation");
    expect(entityTable()).toBe(STANDARD_ENTITY_TABLE);
    expect(PROTOTYPES["small-lamp"].width).toBe(1);
  });

  it("is read with the defaults of its file and sorted by name", () => {
    const parsed = parseEntityTable({
      schema: 1, game: { version: "3.0.0" }, defaults: { width: 2, height: 2, directions: 4, wireReach: 5, modules: ["base", "mod"] },
      entities: [{ name: "b", type: "thing", displayName: "B", height: 1, signals: { output: "item:iron-plate" }, placedBy: [], removedBy: ["other"] }, { name: "a", type: "thing", displayName: "A", wireReach: 9, hidden: true, offGrid: true, selectionBox: [-0.5, -1, 1, 1] }],
    });
    expect(parsed.game).toEqual({ version: "3.0.0" });
    expect(parsed.runtimeChecked).toBe(false);
    expect(parsed.entities).toEqual([
      { name: "a", type: "thing", displayName: "A", width: 2, height: 2, directions: 4, wireReach: 9, hidden: true, offGrid: true, selectionBox: [-0.5, -1, 1, 1], placedBy: ["a"], signals: {}, modules: ["base", "mod"] },
      { name: "b", type: "thing", displayName: "B", width: 2, height: 1, directions: 4, wireReach: 5, hidden: false, offGrid: false, placedBy: [], signals: { output: { kind: "item", name: "iron-plate" } }, modules: ["base", "mod"], removedBy: ["other"] },
    ]);
    expect(parsed.byName.get("b")).toBe(parsed.entities[1]);
    expect(parseEntityTable({ ...data, runtimeChecked: true }).runtimeChecked).toBe(true);
  });

  it("is refused when it is not a table or a record lacks what the editor needs", () => {
    const bad = (record: object): unknown => tableWith(() => [{ name: "x", type: "thing", displayName: "X", ...record }]);
    expect(() => parseEntityTable(undefined)).toThrow("Entity table: not a table of schema 1");
    expect(() => parseEntityTable({ ...data, schema: 2 })).toThrow("not a table of schema 1");
    expect(() => parseEntityTable({ ...data, game: {} })).toThrow("no game version");
    expect(() => parseEntityTable({ ...data, entities: {} })).toThrow("no defaults or no entities");
    expect(() => parseEntityTable(tableWith(() => [{ type: "thing" }]))).toThrow("record 0 has no name");
    expect(() => parseEntityTable(bad({ type: undefined }))).toThrow("x: type is undefined");
    expect(() => parseEntityTable(bad({ width: 0 }))).toThrow("x: width is 0");
    expect(() => parseEntityTable(bad({ height: 1.5 }))).toThrow("x: height is 1.5");
    expect(() => parseEntityTable(bad({ directions: 3 }))).toThrow("x: directions is 3");
    expect(() => parseEntityTable(bad({ wireReach: 0 }))).toThrow("x: wireReach is 0");
    expect(() => parseEntityTable(bad({ placedBy: [1] }))).toThrow("x: placedBy is [1]");
    expect(() => parseEntityTable(bad({ modules: "base" }))).toThrow('x: modules is "base"');
    expect(() => parseEntityTable(bad({ signals: { output: "signal-A" } }))).toThrow('x: signal output is "signal-A"');
    expect(() => parseEntityTable(bad({ selectionBox: [0, 0, 1] }))).toThrow("x: selectionBox is [0,0,1]");
    expect(() => parseEntityTable(bad({ selectionBox: [0.5, -0.5, -0.5, 0.5] }))).toThrow("x: selectionBox is [0.5,-0.5,-0.5,0.5]");
    expect(() => parseEntityTable(tableWith((records) => [records[0]!, records[0]!]))).toThrow("a name occurs twice");
  });
});
