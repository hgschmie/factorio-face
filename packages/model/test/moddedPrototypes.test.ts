// Prototypes a mod adds: a prototype of a type with a kind of its own has that kind whatever its name and size, the standard
// prototype stays the first of its kind, and a loader of one tile has the settings of the loader.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODDED_ENTITY_TABLE, MODDED_RECORDS, moddedEntityData } from "../../../tests/fixtures/game/moddedEntities.ts";
import {
  canRotate, ENTITY_KINDS, ENTITY_SETTINGS, entityNameBase, facingOf, isPrototypeName, isTileCenter, missingEditorPrototypes, occupiedTiles, parseEntityTable, PROTOTYPE_NAMES, PROTOTYPES, prototypeData,
  newEntity, prototypesOf, rotateTile, setEntityTable, settingSpecsOf, STANDARD_ENTITY_TABLE, tileHalves, tileSize, wireMeasure, wireReachBetween, wireSpan,
  type EntityKind, type EntityShape,
} from "../src/index.ts";

const STANDARD_FIRST: Readonly<Record<EntityKind, string>> = {
  constant: "constant-combinator", arithmetic: "arithmetic-combinator", decider: "decider-combinator", selector: "selector-combinator", lamp: "small-lamp", pole: "small-electric-pole", speaker: "programmable-speaker",
  entity: "accumulator",
};
const standardNames = [...PROTOTYPE_NAMES];
const records = (moddedEntityData() as { entities: Record<string, unknown>[] }).entities;
const tableOf = (change: (all: Record<string, unknown>[]) => Record<string, unknown>[]) => parseEntityTable({ ...(moddedEntityData() as object), entities: change(records) });

describe("a table with modded prototypes", () => {
  beforeAll(() => setEntityTable(MODDED_ENTITY_TABLE));
  afterAll(() => setEntityTable(STANDARD_ENTITY_TABLE));

  it("gives a prototype the kind of its prototype type, whatever its name", () => {
    const kinds = Object.fromEntries(MODDED_RECORDS.map(({ name }) => [name, PROTOTYPES[name]?.kind]));
    expect(kinds).toEqual({
      "mod-constant": "constant", "mod-arithmetic": "arithmetic", "mod-decider": "decider", "mod-selector": "selector", "mod-lamp": "lamp", "5d-lamp": "lamp", "mod-hidden-lamp": "lamp", "mod-pole": "pole", "mod-loader": "entity",
      // A speaker has its kind by name, and the editor has nothing for a type it does not know.
      "mod-speaker": undefined, "mod-oddity": undefined,
    });
    expect([isPrototypeName("mod-speaker"), isPrototypeName("mod-oddity"), isPrototypeName("mod-lamp")]).toEqual([false, false, true]);
    expect(prototypesOf("speaker")).toEqual(["programmable-speaker"]);
  });

  it("keeps the standard prototype the first of its kind, and the standard poles in their order before a modded one", () => {
    for (const kind of ENTITY_KINDS) {
      expect(prototypesOf(kind)[0], kind).toBe(STANDARD_FIRST[kind]);
    }
    expect(prototypesOf("constant")).toEqual(["constant-combinator", "mod-constant"]);
    expect(prototypesOf("lamp")).toEqual(["small-lamp", "5d-lamp", "mod-hidden-lamp", "mod-lamp"]);
    expect(prototypesOf("pole")).toEqual(["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation", "mod-pole"]);
    // The ten standard ones first, as without mods, then every other one by name.
    expect(PROTOTYPE_NAMES.slice(0, 10)).toEqual(standardNames.slice(0, 10));
    expect(PROTOTYPE_NAMES.slice(10)).toEqual([...PROTOTYPE_NAMES.slice(10)].sort());
    expect(PROTOTYPE_NAMES).toHaveLength(standardNames.length + 9);
  });

  it("makes a new entity of a prototype with the kind of that prototype, which it holds whichever of the kind it is", () => {
    expect(newEntity("mod-arithmetic")).toEqual({ ...newEntity("arithmetic-combinator"), prototype: "mod-arithmetic" });
    expect(newEntity("small-lamp")).toMatchObject({ kind: "lamp", prototype: "small-lamp" });
    expect(newEntity("mod-lamp")).toMatchObject({ kind: "lamp", prototype: "mod-lamp" });
    expect(newEntity("mod-pole")).toEqual({ kind: "pole", prototype: "mod-pole" });
    expect(newEntity("mod-loader")).toEqual({ kind: "entity", prototype: "mod-loader", settings: {} });
  });

  it("has the size, the rotation and the reach of the table, not those of the standard prototype of the kind", () => {
    expect(PROTOTYPES["mod-arithmetic"]).toEqual({ kind: "arithmetic", label: "tiny arithmetic combinator", width: 1, height: 1, rotatable: true });
    expect(PROTOTYPES["mod-constant"]).toEqual({ kind: "constant", label: "tiny constant combinator", width: 1, height: 1, rotatable: false });
    expect(PROTOTYPES["mod-decider"]).toEqual({ kind: "decider", label: "wide decider combinator", width: 2, height: 2, rotatable: true });
    expect(PROTOTYPES["mod-lamp"]).toEqual({ kind: "lamp", label: "big lamp", width: 2, height: 2, rotatable: false });
    expect(PROTOTYPES["mod-pole"]).toEqual({ kind: "pole", label: "huge electric pole", width: 2, height: 2, rotatable: false, wireReach: 48 });

    const tiny: EntityShape = { prototype: "mod-arithmetic" };
    const standard: EntityShape = { prototype: "arithmetic-combinator" };
    expect([tileSize(tiny, "east"), tileSize(standard, "east")]).toEqual([{ width: 1, height: 1 }, { width: 2, height: 1 }]);
    expect([isTileCenter(tiny, "east", { x: 0.5, y: 0.5 }), isTileCenter(standard, "east", { x: 0.5, y: 0.5 })]).toEqual([true, false]);
    expect(occupiedTiles(tiny, "north", { x: 2.5, y: 3.5 })).toEqual([{ x: 2, y: 3 }]);
    // One tile has no halves: the input and the output are both on it. It turns in place.
    const whole = { x: 2, y: 3, width: 1, height: 1 };
    expect(tileHalves(tiny, "east", { x: 2.5, y: 3.5 })).toEqual({ input: whole, output: whole });
    expect(rotateTile(tiny, { x: 2.5, y: 3.5 }, "east", "south")).toEqual({ x: 2.5, y: 3.5 });
    // Two by two is cut across its facing: the input half behind, the output half in front.
    const wide: EntityShape = { prototype: "mod-decider" };
    expect(tileHalves(wide, "east", { x: 1, y: 1 })).toEqual({ input: { x: 0, y: 0, width: 1, height: 2 }, output: { x: 1, y: 0, width: 1, height: 2 } });
    expect(tileHalves(wide, "north", { x: 1, y: 1 })).toEqual({ input: { x: 0, y: 1, width: 2, height: 1 }, output: { x: 0, y: 0, width: 2, height: 1 } });
    // A constant combinator that does not turn faces east whatever its declaration says.
    expect(canRotate({ prototype: "mod-constant" })).toBe(false);
    expect(facingOf({ prototype: "mod-constant", placement: { direction: "south" } })).toBe("east");
    expect(occupiedTiles({ prototype: "mod-lamp" }, "east", { x: 1, y: 1 })).toHaveLength(4);
  });

  it("measures a modded pole like a pole: its own reach, and from center to center to another pole", () => {
    const huge: EntityShape = { prototype: "mod-pole" };
    const big: EntityShape = { prototype: "big-electric-pole" };
    expect(wireReachBetween(huge, { prototype: "small-lamp" }, 9)).toEqual({ reach: 9, of: "project" });
    expect(wireReachBetween(huge, { prototype: "small-lamp" }, 0)).toEqual({ reach: 48, of: "mod-pole" });
    expect(wireReachBetween(huge, big, 9)).toEqual({ reach: 32, of: "big-electric-pole" });
    expect([wireMeasure(huge, big), wireMeasure(huge, { prototype: "mod-lamp" })]).toEqual(["centers", "boxes"]);
    const at = (shape: EntityShape, x: number) => ({ ...shape, placement: { tile: { x, y: 1 } } });
    expect(wireSpan(at(huge, 1), at(huge, 49), 9)).toMatchObject({ distance: 48, reach: 48, of: "mod-pole", measure: "centers", tooLong: false });
    expect(wireSpan(at(huge, 1), at(huge, 50), 9)).toMatchObject({ distance: 49, tooLong: true });
  });

  it("has the settings of the loader for a loader of one tile, and none for a prototype with a kind of its own", () => {
    expect(PROTOTYPES["mod-loader"]).toEqual({ kind: "entity", label: "miniloader", width: 1, height: 1, rotatable: true });
    expect(settingSpecsOf("mod-loader")).toBe(ENTITY_SETTINGS.loader!.settings);
    expect(settingSpecsOf("mod-loader").map((spec) => spec.key)).toEqual(["when", "logistic-when", "networks", "output-networks", "set-filters", "read-transfers"]);
    expect(settingSpecsOf("mod-arithmetic")).toEqual([]);
    expect(prototypesOf("entity")).toContain("mod-loader");
  });

  it("names a new entity after its kind, whichever prototype of it, and a generic one after its prototype", () => {
    expect([entityNameBase({ prototype: "mod-arithmetic" }), entityNameBase({ prototype: "5d-lamp" }), entityNameBase({ prototype: "mod-pole" })]).toEqual(["arithmetic", "lamp", "pole"]);
    expect(entityNameBase({ prototype: "mod-loader" })).toBe("mod_loader");
    expect(prototypeData({ prototype: "mod-lamp" }).label).toBe("big lamp");
  });
});

describe("the standard prototypes with a kind of their own", () => {
  it("are demanded of every table, also of one that has other prototypes of the kind", () => {
    expect(missingEditorPrototypes(MODDED_ENTITY_TABLE)).toEqual([]);
    const withoutLamp = tableOf((all) => all.filter((record) => record.name !== "small-lamp" && record.name !== "decider-combinator"));
    expect(missingEditorPrototypes(withoutLamp)).toEqual(["decider-combinator", "small-lamp"]);
    expect(() => setEntityTable(withoutLamp)).toThrow("The entity table of Factorio 2.1.25 has no decider-combinator");
    // A standard name a mod made something else of is not the prototype the editor needs.
    const retyped = tableOf((all) => all.map((record) => (record.name === "small-lamp" ? { ...record, type: "container" } : record.name === "programmable-speaker" ? { ...record, type: "lamp" } : record)));
    expect(missingEditorPrototypes(retyped)).toEqual(["small-lamp", "programmable-speaker"]);
    expect(PROTOTYPE_NAMES).toEqual(standardNames);
  });

  it("are all there is of their kinds in the standard game, which wires no loader of one tile", () => {
    expect(ENTITY_KINDS.filter((kind) => kind !== "entity").map((kind) => prototypesOf(kind).length)).toEqual([1, 1, 1, 1, 1, 4, 1]);
    expect(STANDARD_ENTITY_TABLE.entities.filter((prototype) => prototype.type === "loader-1x1")).toEqual([]);
    expect(isPrototypeName("mod-lamp")).toBe(false);
  });
});
