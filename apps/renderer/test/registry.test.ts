// The entity selector as data: the tabs, subgroups and entries the catalog, the entity table and the modules give, the search,
// the entities in use, the keys, the place tool that carries a prototype, and what the palette remembers on this machine.
import { findSignal, isAvailable, loadStandardCatalog, resolveModules } from "@face/catalog";
import { entityTable, PROTOTYPE_NAMES, PROTOTYPES, STANDARD_ENTITY_TABLE, type EntityTable } from "@face/model";
import { describe, expect, it } from "vitest";
import { entityRegistry, entriesInUse, KEYED_KINDS, keyedKindOf, PINNED_KINDS, prototypeIconId, searchEntries, type EntityRegistry } from "../src/entities/registry.ts";
import { TYPE_DESCRIPTIONS } from "../src/entities/typeInfo.ts";
import { flippedTool, placeFacing, sameTool, SELECT_TOOL, turnedTool, type PlaceTool } from "../src/workbench/controller.ts";
import { CIRCUIT_LIST_KEY, IN_USE_KEY, readCircuitListOpen, readSearch, readSectionOpen, readTab, SEARCH_KEY, TAB_KEY, writeCircuitListOpen, writeSearch, writeSectionOpen, writeTab, type KeyValueStore } from "../src/workbench/paletteGroups.ts";

const catalog = loadStandardCatalog();
const SPACE_AGE = ["base", "elevated-rails", "recycler", "quality", "space-age"];
const registryFor = (modules: readonly string[], table: EntityTable = entityTable()): EntityRegistry => entityRegistry(catalog, table, modules);
const spaceAge = registryFor(SPACE_AGE);
const base = registryFor(["base"]);
const rows = (registry: EntityRegistry, group: string): Record<string, string[]> =>
  Object.fromEntries(registry.groups.find((candidate) => candidate.name === group)!.subgroups.map((subgroup) => [subgroup.name, subgroup.entries.map((entry) => entry.prototype)]));
const COMBINATORS = ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"];

describe("entity registry", () => {
  it("has a tab per item group of the game that has circuit entities, for the modules of the project", () => {
    expect(spaceAge.groups.map((group) => [group.name, group.label, group.icon])).toEqual([
      ["logistics", "Logistics", "group/logistics"],
      ["production", "Production", "group/production"],
      ["space", "Space", "group/space"],
      ["combat", "Combat", "group/combat"],
    ]);
    // Without Space Age the game has no Space group: the rocket silo and the landing pad are in Production.
    expect(base.groups.map((group) => group.label)).toEqual(["Logistics", "Production", "Combat"]);
    expect(Object.keys(rows(base, "production"))).toEqual(["energy", "extraction-machine", "smelting-machine", "production-machine", "space-related"]);
    expect(rows(base, "production")["space-related"]).toEqual(["rocket-silo", "cargo-landing-pad"]);
    expect(rows(spaceAge, "space")).toEqual({ "space-interactors": ["rocket-silo", "cargo-landing-pad"], "space-platform": ["space-platform-hub", "asteroid-collector", "crusher"] });
  });

  it("has the subgroups of a group as rows and the entities of a row in the game's order", () => {
    expect(rows(spaceAge, "logistics")).toEqual({
      storage: ["wooden-chest", "iron-chest", "steel-chest", "storage-tank"],
      belt: ["transport-belt", "fast-transport-belt", "express-transport-belt", "turbo-transport-belt", "splitter", "fast-splitter", "express-splitter", "turbo-splitter"],
      inserter: ["burner-inserter", "inserter", "long-handed-inserter", "fast-inserter", "bulk-inserter", "stack-inserter"],
      "energy-pipe-distribution": ["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation", "pipe", "pipe-to-ground", "pump"],
      "train-transport": ["train-stop", "rail-signal", "rail-chain-signal"],
      "logistic-network": ["active-provider-chest", "passive-provider-chest", "storage-chest", "buffer-chest", "requester-chest", "roboport"],
      "circuit-network": ["small-lamp", "arithmetic-combinator", "decider-combinator", "selector-combinator", "constant-combinator", "power-switch", "programmable-speaker", "display-panel"],
    });
    expect(Object.keys(rows(spaceAge, "production"))).toEqual(["energy", "extraction-machine", "smelting-machine", "agriculture", "production-machine", "environmental-protection"]);
    expect(rows(spaceAge, "combat")).toEqual({
      "defensive-structure": ["stone-wall", "radar", "land-mine"],
      turret: ["gun-turret", "laser-turret", "flamethrower-turret", "artillery-turret", "rocket-turret", "tesla-turret", "railgun-turret"],
    });
  });

  it("follows the catalog: every row is a subgroup of its group and sorted by the order strings of the game", () => {
    for (const modules of [["base"], ["base", "recycler", "quality"], SPACE_AGE]) {
      const active = new Set(resolveModules(catalog.modules, modules).enabled);
      const registry = registryFor(modules);
      const orders: string[] = [];
      for (const group of registry.groups) {
        const stored = catalog.groupsByName.get(group.name)!;
        expect(isAvailable(stored, active), group.name).toBe(true);
        orders.push(stored.order);
        for (const subgroup of group.subgroups) {
          const keys = subgroup.entries.map((entry) => {
            const entity = findSignal(catalog, { kind: "entity", name: entry.prototype }, active)!;
            expect(entity.subgroup, entry.prototype).toBe(subgroup.name);
            return `${entity.order}|${entity.name}`;
          });
          expect(keys, subgroup.name).toEqual([...keys].sort());
        }
      }
      expect(orders).toEqual([...orders].sort());
    }
  });

  it("offers what the modules have and the game does not hide, each prototype once", () => {
    const table = entityTable();
    const offered = (registry: EntityRegistry): string[] => registry.groups.flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.entries.map((entry) => entry.prototype)));
    const expected = (modules: readonly string[]): string[] => table.entities.filter((game) => !game.hidden && isAvailable(game, new Set(modules))).map((game) => game.name);
    expect(offered(spaceAge).sort()).toEqual(expected(SPACE_AGE));
    expect(offered(base).sort()).toEqual(expected(["base"]));
    expect(offered(registryFor(["base", "recycler", "quality"])).sort()).toEqual(expected(["base", "recycler", "quality"]));
    expect([spaceAge.entries.length, base.entries.length, PROTOTYPE_NAMES.length]).toEqual([85, 67, 98]);
    expect(new Set(spaceAge.entries.map((entry) => entry.prototype)).size).toBe(85);
    // The thirteen the game hides (the chests of its editor, the loaders) are in no tab, but the editor has them.
    const hidden = table.entities.filter((game) => game.hidden).map((game) => game.name);
    expect(hidden).toHaveLength(13);
    for (const name of hidden) {
      expect(spaceAge.offers(name), name).toBe(false);
      expect(spaceAge.groupOf(name), name).toBeUndefined();
      expect(spaceAge.entry(name)?.prototype, name).toBe(name);
    }
    expect(base.offers("stack-inserter")).toBe(false);
    expect(base.offers("recycler")).toBe(false);
    expect(registryFor(["base", "recycler", "quality"]).offers("recycler")).toBe(true);
    expect(spaceAge.entry("no-such-entity")).toBeUndefined();
  });

  it("keeps the combinators pinned; they are in their subgroup of the game as well, as the same entries", () => {
    expect(PINNED_KINDS).toEqual(["constant", "arithmetic", "decider", "selector"]);
    for (const registry of [spaceAge, base]) {
      expect(registry.pinned.map((entry) => entry.prototype)).toEqual(COMBINATORS);
      expect(registry.entries.slice(0, 4)).toEqual(registry.pinned);
      const circuit = registry.groups[0]!.subgroups.find((subgroup) => subgroup.name === "circuit-network")!;
      for (const entry of registry.pinned) expect(circuit.entries).toContain(entry);
      expect(registry.groupOf("decider-combinator")).toBe("logistics");
      expect(registry.groupOf("small-lamp")).toBe("logistics");
      expect(registry.groupOf("big-electric-pole")).toBe("logistics");
    }
    expect(spaceAge.groupOf("rocket-silo")).toBe("space");
    expect(base.groupOf("rocket-silo")).toBe("production");
    expect(spaceAge.groupOf("gun-turret")).toBe("combat");
  });

  it("gives every entry the data of the model, a line on what it is for, its tiles and its reach where it has its own", () => {
    for (const entry of spaceAge.entries) {
      expect(entry.kind).toBe(PROTOTYPES[entry.prototype]!.kind);
      expect(entry.label.toLowerCase()).toBe(PROTOTYPES[entry.prototype]!.label);
      expect(entry.description.length, entry.prototype).toBeGreaterThan(8);
      expect(entry.facts, entry.prototype).toMatch(/^(1 tile|\d x \d tiles)(, wire reach [\d.]+)?$/);
    }
    const facts = (prototype: string): [string, string] => [spaceAge.entry(prototype)!.label, spaceAge.entry(prototype)!.facts];
    expect(facts("constant-combinator")).toEqual(["Constant combinator", "1 tile"]);
    expect(facts("decider-combinator")).toEqual(["Decider combinator", "1 x 2 tiles"]);
    expect(facts("small-lamp")).toEqual(["Lamp", "1 tile"]);
    expect(facts("small-electric-pole")).toEqual(["Small electric pole", "1 tile, wire reach 7.5"]);
    expect(facts("substation")).toEqual(["Substation", "2 x 2 tiles, wire reach 18"]);
    expect(facts("stone-wall")).toEqual(["Wall", "1 tile"]);
    expect(facts("splitter")).toEqual(["Splitter", "2 x 1 tiles"]);
    expect(facts("boiler")).toEqual(["Boiler", "3 x 2 tiles"]);
    expect(facts("rocket-silo")).toEqual(["Rocket silo", "9 x 9 tiles"]);
    expect(facts("power-switch")).toEqual(["Power switch", "2 x 2 tiles, wire reach 10"]);
    expect(facts("agricultural-tower")).toEqual(["Agricultural tower", "3 x 3 tiles, wire reach 30"]);
    // The description is the one of the prototype type: the same for every inserter, and a line for every type the table has.
    expect(spaceAge.entry("fast-inserter")!.description).toBe(TYPE_DESCRIPTIONS.inserter);
    expect(spaceAge.entry("stack-inserter")!.description).toBe(TYPE_DESCRIPTIONS.inserter);
    expect(spaceAge.entry("small-lamp")!.description).toBe("See a condition light up");
  });

  it("has the icon of the item that places a prototype", () => {
    const withoutItem = ["blue-chest", "crash-site-chest-1", "crash-site-chest-2", "red-chest"];
    expect(PROTOTYPE_NAMES.filter((name) => entityTable().byName.get(name)!.placedBy.length === 0).sort()).toEqual(withoutItem);
    expect(PROTOTYPE_NAMES.map(prototypeIconId)).toEqual(PROTOTYPE_NAMES.map((name) => `item/${name}`));
  });

  it("keeps the digit keys to the four combinators and the lamp", () => {
    expect(KEYED_KINDS).toEqual(["constant", "arithmetic", "decider", "selector", "lamp"]);
    expect(spaceAge.entries.flatMap((entry) => keyedKindOf(entry) ?? [])).toEqual(["constant", "arithmetic", "decider", "selector", "lamp"]);
  });

  it("is a function of its tables: another entity table gives other tabs, and a module set the catalog cannot order none", () => {
    const fewer: EntityTable = { ...STANDARD_ENTITY_TABLE, entities: STANDARD_ENTITY_TABLE.entities.filter((game) => game.type !== "inserter"), byName: new Map([...STANDARD_ENTITY_TABLE.byName].filter(([, game]) => game.type !== "inserter")) };
    expect(Object.keys(rows(registryFor(SPACE_AGE, fewer), "logistics"))).not.toContain("inserter");
    expect(registryFor(SPACE_AGE, fewer).entries).toHaveLength(79);
    // Space Age without the modules it needs: its subgroups have no group. The pinned row stays.
    const broken = registryFor(["space-age"]);
    expect(broken.groups).toEqual([]);
    expect(broken.pinned.map((entry) => entry.prototype)).toEqual(COMBINATORS);
  });
});

describe("search", () => {
  const found = (registry: EntityRegistry, text: string): [string, string[]][] => searchEntries(registry.groups, text).map((group) => [group.label, group.subgroups.flatMap((subgroup) => subgroup.entries.map((entry) => entry.prototype))]);

  it("looks through every group by the name in the game and by the prototype name, whatever the case", () => {
    expect(found(spaceAge, "chest")).toEqual([["Logistics", ["wooden-chest", "iron-chest", "steel-chest", "active-provider-chest", "passive-provider-chest", "storage-chest", "buffer-chest", "requester-chest"]]]);
    expect(found(spaceAge, "TURRET")).toEqual([["Combat", ["gun-turret", "laser-turret", "flamethrower-turret", "artillery-turret", "rocket-turret", "tesla-turret", "railgun-turret"]]]);
    expect(found(spaceAge, " plant ")).toEqual([["Production", ["chemical-plant", "electromagnetic-plant", "cryogenic-plant"]]]);
    // "Wall" is the stone-wall, "Lamp" the small-lamp: either name finds it.
    expect(found(spaceAge, "wall")).toEqual([["Combat", ["stone-wall"]]]);
    expect(found(spaceAge, "small-lamp")).toEqual([["Logistics", ["small-lamp"]]]);
    expect(found(spaceAge, "pump")).toEqual([["Logistics", ["pump"]], ["Production", ["offshore-pump", "pumpjack"]]]);
    expect(found(spaceAge, "silo")).toEqual([["Space", ["rocket-silo"]]]);
    expect(found(base, "silo")).toEqual([["Production", ["rocket-silo"]]]);
  });

  it("keeps the rows of the game, finds nothing hidden, and everything without a text", () => {
    const [logistics] = searchEntries(spaceAge.groups, "fast");
    expect(logistics!.subgroups.map((subgroup) => [subgroup.name, subgroup.entries.map((entry) => entry.prototype)])).toEqual([["belt", ["fast-transport-belt", "fast-splitter"]], ["inserter", ["fast-inserter"]]]);
    expect(found(spaceAge, "loader")).toEqual([]);
    expect(found(spaceAge, "no such thing")).toEqual([]);
    expect(found(base, "stack")).toEqual([]);
    expect(searchEntries(spaceAge.groups, "  ")).toBe(spaceAge.groups);
  });
});

describe("entities in use", () => {
  const prototypes = (entities: Parameters<typeof entriesInUse>[1], registry = spaceAge): string[] => entriesInUse(registry, entities).map((entry) => entry.prototype);

  it("has one entry per prototype the circuit contains, in the order of the game, without the combinators", () => {
    expect(prototypes([])).toEqual([]);
    expect(prototypes([{ kind: "constant" }, { kind: "decider" }, { kind: "arithmetic" }, { kind: "selector" }])).toEqual([]);
    expect(prototypes([{ kind: "lamp" }, { kind: "decider" }, { kind: "lamp" }])).toEqual(["small-lamp"]);
    // The order is the game's, whatever the order of the circuit; a pole without a prototype is the first of its kind.
    expect(prototypes([{ kind: "pole", prototype: "substation" }, { kind: "speaker" }, { kind: "pole" }, { kind: "lamp" }, { kind: "pole", prototype: "substation" }])).toEqual(["small-electric-pole", "substation", "small-lamp", "programmable-speaker"]);
    expect(prototypes([{ kind: "entity", prototype: "gun-turret" }, { kind: "entity", prototype: "rocket-silo" }, { kind: "entity", prototype: "fast-inserter" }, { kind: "entity", prototype: "iron-chest" }])).toEqual(["iron-chest", "fast-inserter", "rocket-silo", "gun-turret"]);
  });

  it("gives the entries of the selector themselves, so a tile in use is the same entry as the one in its group", () => {
    const [lamp] = entriesInUse(spaceAge, [{ kind: "lamp" }]);
    expect(lamp).toBe(spaceAge.entries.find((entry) => entry.prototype === "small-lamp"));
    expect(keyedKindOf(lamp!)).toBe("lamp");
  });

  it("has what a circuit contains although the selector does not offer it: a hidden prototype, one of a module that is off", () => {
    // A loader and a chest of the game's editor from a blueprint; in a project without Space Age a stack inserter and a biolab.
    expect(prototypes([{ kind: "entity", prototype: "loader" }, { kind: "entity", prototype: "red-chest" }, { kind: "lamp" }])).toEqual(["loader", "small-lamp", "red-chest"]);
    expect(prototypes([{ kind: "entity", prototype: "stack-inserter" }, { kind: "entity", prototype: "biolab" }, { kind: "entity", prototype: "rocket-silo" }, { kind: "lamp" }], base)).toEqual(["small-lamp", "rocket-silo", "biolab", "stack-inserter"]);
    expect(entriesInUse(spaceAge, [{ kind: "entity", prototype: "loader" }])[0]).toMatchObject({ kind: "entity", label: "Loader", facts: "1 x 2 tiles" });
  });

  it("can hold every entry that is not pinned, and no other", () => {
    const all = spaceAge.entries.map(({ kind, prototype }) => ({ kind, prototype }));
    expect(prototypes(all)).toEqual(spaceAge.entries.slice(4).map((entry) => entry.prototype));
  });
});

describe("place tool", () => {
  const pole = (prototype?: "small-electric-pole" | "big-electric-pole"): PlaceTool => ({ type: "place", kind: "pole", ...(prototype && { prototype }) });

  it("is the same tool for the same prototype, said or not, and another one for another prototype", () => {
    expect(sameTool(pole(), pole("small-electric-pole"))).toBe(true);
    expect(sameTool(pole("big-electric-pole"), pole("big-electric-pole"))).toBe(true);
    expect(sameTool(pole(), pole("big-electric-pole"))).toBe(false);
    expect(sameTool({ type: "place", kind: "lamp" }, { type: "place", kind: "lamp", prototype: "small-lamp" })).toBe(true);
    expect(sameTool({ type: "place", kind: "lamp" }, { type: "place", kind: "speaker" })).toBe(false);
    expect(sameTool({ type: "place", kind: "decider", facing: "south" }, { type: "place", kind: "decider", prototype: "decider-combinator" })).toBe(true);
    expect(sameTool(pole(), SELECT_TOOL)).toBe(false);
  });

  it("does not turn what cannot rotate: a pole and a speaker face east like a lamp", () => {
    const fixed: readonly PlaceTool[] = [pole(), pole("big-electric-pole"), { type: "place", kind: "speaker" }, { type: "place", kind: "lamp" }];
    for (const tool of fixed) {
      expect(turnedTool(tool, "clockwise")).toBeUndefined();
      expect(placeFacing({ ...tool, facing: "south" })).toBe("east");
    }
    expect(turnedTool({ type: "place", kind: "decider", prototype: "decider-combinator" }, "clockwise")).toEqual({ type: "place", kind: "decider", prototype: "decider-combinator", facing: "south" });
  });

  it("turns a generic entity as the game builds it: four directions, two for a storage tank, none for a chest", () => {
    const entity = (prototype: string, facing?: PlaceTool["facing"]): PlaceTool => ({ type: "place", kind: "entity", prototype, ...(facing && { facing }) });
    const turns = (tool: PlaceTool, turn: "clockwise" | "counterclockwise", count: number): string[] => {
      const facings: string[] = [];
      let current: PlaceTool = tool;
      for (let step = 0; step < count; step++) facings.push(placeFacing((current = turnedTool(current, turn) as PlaceTool)));
      return facings;
    };
    expect(turns(entity("fast-inserter"), "clockwise", 4)).toEqual(["south", "west", "north", "east"]);
    expect(turns(entity("boiler"), "counterclockwise", 4)).toEqual(["north", "west", "south", "east"]);
    // North and east only: either turn gives the other one.
    expect(turns(entity("storage-tank"), "clockwise", 4)).toEqual(["north", "east", "north", "east"]);
    expect(turns(entity("storage-tank"), "counterclockwise", 3)).toEqual(["north", "east", "north"]);
    expect(placeFacing(entity("storage-tank", "south"))).toBe("north");
    expect(placeFacing(entity("storage-tank", "west"))).toBe("east");
    expect(flippedTool(entity("storage-tank"), "horizontal")).toEqual(entity("storage-tank", "east"));
    expect(flippedTool(entity("fast-inserter"), "horizontal")).toEqual(entity("fast-inserter", "west"));
    expect(flippedTool(entity("fast-inserter", "north"), "vertical")).toEqual(entity("fast-inserter", "south"));
    for (const fixed of ["iron-chest", "rocket-silo", "stone-furnace", "roboport"]) {
      expect(turnedTool(entity(fixed), "clockwise"), fixed).toBeUndefined();
      expect(flippedTool(entity(fixed), "vertical"), fixed).toBeUndefined();
      expect(placeFacing(entity(fixed, "south")), fixed).toBe("east");
    }
    expect(sameTool(entity("fast-inserter", "north"), entity("fast-inserter"))).toBe(true);
    expect(sameTool(entity("fast-inserter"), entity("inserter"))).toBe(false);
  });
});

const memory = (): KeyValueStore & { readonly values: Map<string, string> } => {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
};
const refusing: KeyValueStore = {
  getItem() {
    throw new Error("storage is switched off");
  },
  setItem() {
    throw new Error("storage is full");
  },
};

describe("the tab and the search", () => {
  const TABS = ["logistics", "production", "space", "combat"];

  it("starts on the first tab and reads back the one that was shown, if the project still has it", () => {
    expect(readTab(undefined, TABS)).toBe("logistics");
    expect(readTab(refusing, TABS)).toBe("logistics");
    const store = memory();
    expect(readTab(store, TABS)).toBe("logistics");
    writeTab(store, "space");
    expect(store.values.get(TAB_KEY)).toBe("space");
    expect(readTab(store, TABS)).toBe("space");
    // A project without Space Age has no such tab; one without any group has none at all.
    expect(readTab(store, ["logistics", "production", "combat"])).toBe("logistics");
    expect(readTab(store, [])).toBeUndefined();
    for (const garbage of ["", "Space", "null", "{}"]) {
      store.setItem(TAB_KEY, garbage);
      expect(readTab(store, TABS), garbage).toBe("logistics");
    }
    expect(() => writeTab(refusing, "space")).not.toThrow();
    expect(() => writeTab(undefined, "space")).not.toThrow();
  });

  it("keeps the search text under a key of its own, a line of it at most", () => {
    expect(readSearch(undefined)).toBe("");
    expect(readSearch(refusing)).toBe("");
    const store = memory();
    expect(readSearch(store)).toBe("");
    writeSearch(store, "inserter");
    expect(store.values.get(SEARCH_KEY)).toBe("inserter");
    expect(readSearch(store)).toBe("inserter");
    expect(readTab(store, TABS)).toBe("logistics");
    store.setItem(SEARCH_KEY, "x".repeat(500));
    expect(readSearch(store)).toHaveLength(80);
    expect(() => writeSearch(refusing, "x")).not.toThrow();
  });
});

describe("the list of the circuit's entities", () => {
  it("starts open, without storage, with storage that refuses and with anything but a stored false", () => {
    expect(readCircuitListOpen(undefined)).toBe(true);
    expect(readCircuitListOpen(refusing)).toBe(true);
    const store = memory();
    expect(readCircuitListOpen(store)).toBe(true);
    for (const garbage of ["", "0", "no", "null", "{}"]) {
      store.setItem(CIRCUIT_LIST_KEY, garbage);
      expect(readCircuitListOpen(store), garbage).toBe(true);
    }
  });

  it("keeps the section of the entities in use under a key of its own, with the same rules", () => {
    const store = memory();
    expect(readSectionOpen(store, IN_USE_KEY)).toBe(true);
    expect(readSectionOpen(undefined, IN_USE_KEY)).toBe(true);
    expect(readSectionOpen(refusing, IN_USE_KEY)).toBe(true);
    writeSectionOpen(store, IN_USE_KEY, false);
    expect(store.values.get(IN_USE_KEY)).toBe("false");
    expect(readSectionOpen(store, IN_USE_KEY)).toBe(false);
    // The list of the circuit and the tab know nothing of it.
    expect(readCircuitListOpen(store)).toBe(true);
    expect(readTab(store, ["logistics", "production"])).toBe("logistics");
    expect(() => writeSectionOpen(refusing, IN_USE_KEY, false)).not.toThrow();
    expect(() => writeSectionOpen(undefined, IN_USE_KEY, false)).not.toThrow();
    expect(IN_USE_KEY).not.toBe(CIRCUIT_LIST_KEY);
  });

  it("reads back what was written, under its own key and apart from the tab", () => {
    const store = memory();
    writeTab(store, "production");
    writeCircuitListOpen(store, false);
    expect(store.values.get(CIRCUIT_LIST_KEY)).toBe("false");
    expect(readCircuitListOpen(store)).toBe(false);
    expect(readTab(store, ["logistics", "production"])).toBe("production");
    writeCircuitListOpen(store, true);
    expect(readCircuitListOpen(store)).toBe(true);
    expect(() => writeCircuitListOpen(refusing, false)).not.toThrow();
  });
});
