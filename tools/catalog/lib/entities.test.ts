// Tests for the entity table of the generator: the pure build on made-up module sets, and on the dumps of the last generator
// run where they exist. The .mjs libraries are loaded dynamically and given their types here, as in lib.test.ts.
import { STANDARD_CATALOG_VERSION } from "@face/catalog";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Proto = Record<string, unknown> & { name: string };
type Raw = Record<string, Record<string, Proto>>;
type Fact = Record<string, unknown> & { name: string };
interface GameSet { id: string; mods: string[]; raw: Raw; runtime: { entity: object[]; circuit_entities?: Fact[] | object; circuit_entities_error?: string }; locale: Record<string, Record<string, string>> }
type Row = Record<string, unknown> & { name: string; type: string };
interface Table { schema: number; game: object; runtimeChecked: boolean; defaults: Record<string, unknown>; entities: Row[] }
interface ModuleInfo { name: string; requires: string[]; recommends: string[] }

const load = (file: string): Promise<unknown> => import(/* @vite-ignore */ new URL(file, import.meta.url).href);
const lib = (await load("./entities.mjs")) as {
  PROVISIONAL_ROTATION: Record<string, boolean | ((proto: Proto, size: { width: number; height: number }) => boolean)>;
  wireReachOf(type: string, proto: object): number;
  circuitEntities(raw: Raw): { type: string; proto: Proto }[];
  buildEntityTable(input: { sets: GameSet[]; modules: object[]; game: object }): { table: Table; notes: string[] };
  entityTableText(table: Table): string;
};
const dump = (await load("./dump.mjs")) as { locateGame(): { dataDir: string }; readModuleInfos(dataDir: string): ModuleInfo[]; validModSets(infos: ModuleInfo[]): string[][] };
const sets = (await load("./sets.mjs")) as {
  completeDumps(dumpRoot: string, modules: ModuleInfo[]): { game: { version: string; build: number } } | undefined;
  buildFromDumps(input: object): { entities: { table: Table; notes: string[] } };
};

const ROOT = resolve(import.meta.dirname, "../../..");
const modules = [{ name: "base", title: "Base", version: "1", requires: [], recommends: [], featureFlags: [] }, { name: "extra", title: "Extra", version: "1", requires: ["base"], recommends: [], featureFlags: [] }];
const game = { version: "1", build: 7 };
const square = (half: number): number[][] => [[-half, -half], [half, half]];
const wired = (name: string, more: object = {}): Proto => ({ name, collision_box: square(0.35), circuit_wire_max_distance: 9, flags: ["placeable-player"], ...more });

/** A module set from prototypes by type; every one is an entity of the game, placed by the item of its name unless `placing` says otherwise. */
function makeSet(mods: string[], byType: Record<string, Proto[]>, more: { placing?: Record<string, string[]>; hidden?: string[]; facts?: Fact[] } = {}): GameSet {
  const protos = Object.values(byType).flat();
  return {
    id: mods.join("+"),
    mods,
    raw: Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, Object.fromEntries(list.map((proto) => [proto.name, proto]))])),
    runtime: {
      // The game writes an empty list as {}.
      entity: protos.map(({ name }) => ({ name, hidden: more.hidden?.includes(name) ?? false, items_to_place_this: more.placing?.[name] ?? (more.placing ? {} : [name]) })),
      ...(more.facts && { circuit_entities: more.facts }),
    },
    locale: { entity: Object.fromEntries(protos.map(({ name }) => [name, name.replace(/^./, (letter) => letter.toUpperCase())])) },
  };
}

const BASE: Record<string, Proto[]> = {
  lamp: [wired("lamp", { default_red_signal: { type: "virtual", name: "signal-red" }, default_rgb_signal: { type: "virtual", name: "signal-white" } })],
  "electric-pole": [{ name: "pole", collision_box: square(0.65), maximum_wire_distance: 32, flags: {} }, { name: "dead-pole", collision_box: square(0.15), maximum_wire_distance: 0 }],
  "power-switch": [{ name: "switch", collision_box: { left_top: { x: -0.7, y: -0.7 }, right_bottom: { x: 0.7, y: 0.7 } }, wire_max_distance: 10 }],
  "decider-combinator": [wired("gate", { collision_box: [[-0.35, -0.65], [0.35, 0.65]] })],
  "assembling-machine": [wired("press", { collision_box: square(1.2) }), wired("plant", { collision_box: square(1.2), fluid_boxes: [{}, {}] }), wired("crusher", { collision_box: [[-0.7, -1.2], [0.7, 1.2]], fluid_boxes: {} })],
  "storage-tank": [wired("tank", { collision_box: square(1.3), two_direction_only: true })],
  "rail-signal": [wired("signal", { flags: ["building-direction-16-way"] })],
  "fluid-turret": [wired("flamer", { flags: ["building-direction-8-way"], collision_box: [[-0.72, -1.2], [0.72, 1.2]] })],
  "train-stop": [wired("stop", { collision_box: square(0.5), tile_width: 2, tile_height: 2 })],
  "ammo-turret": [wired("railgun", { collision_box: [[-1.41, -1.9], [1.41, 2.1]], tile_height: 5 })],
  "land-mine": [wired("mine", { flags: ["placeable-off-grid"], hidden: true })],
  container: [wired("chest"), { name: "crate", collision_box: square(0.35) }],
  // Not an entity a wire connects to, although it has a wire distance: only a pole's counts under that name.
  generator: [{ name: "engine", collision_box: square(1.2), maximum_wire_distance: 5 }],
};
const base = (more?: Parameters<typeof makeSet>[2]): GameSet => makeSet(["base"], BASE, { hidden: ["mine"], ...more });
const build = (...gameSets: GameSet[]): Table => lib.buildEntityTable({ sets: gameSets, modules, game }).table;
const rows = (table: Table): Record<string, Row> => Object.fromEntries(table.entities.map((row) => [row.name, row]));

/** What the scenario would write for a prototype that agrees with the derivation. */
const fact = (name: string, type: string, more: object = {}): Fact => ({ name, type, supports_direction: false, tile_width: 1, tile_height: 1, flags: ["placeable-player"], circuit_wire_distance: { normal: 9 }, wire_distance: { normal: 0 }, optional: {}, default_signals: {}, ...more });

describe("entity table build", () => {
  it("selects what a circuit wire connects to: a circuit distance, a pole's or a power switch's wire distance", () => {
    expect(lib.wireReachOf("lamp", { circuit_wire_max_distance: 9 })).toBe(9);
    expect(lib.wireReachOf("electric-pole", { maximum_wire_distance: 7.5 })).toBe(7.5);
    expect(lib.wireReachOf("power-switch", { wire_max_distance: 10 })).toBe(10);
    expect(lib.wireReachOf("generator", { maximum_wire_distance: 5, wire_max_distance: 5 })).toBe(0);
    expect(lib.wireReachOf("lamp", { circuit_wire_max_distance: 0 })).toBe(0);
    expect(lib.wireReachOf("lamp", {})).toBe(0);
    expect(lib.circuitEntities(base().raw).map(({ proto }) => proto.name).sort()).toEqual(["chest", "crusher", "flamer", "gate", "lamp", "mine", "plant", "pole", "press", "railgun", "signal", "stop", "switch", "tank"]);
  });

  it("writes one sorted record per prototype with the defaults left out", () => {
    const table = build(base());
    expect(table).toMatchObject({ schema: 1, game, runtimeChecked: false, defaults: { width: 1, height: 1, directions: 1, wireReach: 9, modules: ["base"] } });
    expect(table.entities.map((row) => row.name)).toEqual([...table.entities.map((row) => row.name)].sort());
    expect(rows(table)).toEqual({
      chest: { name: "chest", type: "container", displayName: "Chest" },
      crusher: { name: "crusher", type: "assembling-machine", displayName: "Crusher", width: 2, height: 3, directions: 4 },
      flamer: { name: "flamer", type: "fluid-turret", displayName: "Flamer", width: 2, height: 3, directions: 8 },
      gate: { name: "gate", type: "decider-combinator", displayName: "Gate", height: 2, directions: 4 },
      lamp: { name: "lamp", type: "lamp", displayName: "Lamp", signals: { red: "virtual:signal-red", rgb: "virtual:signal-white" } },
      mine: { name: "mine", type: "land-mine", displayName: "Mine", hidden: true, offGrid: true },
      plant: { name: "plant", type: "assembling-machine", displayName: "Plant", width: 3, height: 3, directions: 4 },
      pole: { name: "pole", type: "electric-pole", displayName: "Pole", width: 2, height: 2, wireReach: 32 },
      press: { name: "press", type: "assembling-machine", displayName: "Press", width: 3, height: 3 },
      railgun: { name: "railgun", type: "ammo-turret", displayName: "Railgun", width: 3, height: 5, directions: 4, collisionBox: [-1.41, -1.9, 1.41, 2.1] },
      signal: { name: "signal", type: "rail-signal", displayName: "Signal", directions: 16 },
      stop: { name: "stop", type: "train-stop", displayName: "Stop", width: 2, height: 2, directions: 4, collisionBox: [-0.5, -0.5, 0.5, 0.5] },
      switch: { name: "switch", type: "power-switch", displayName: "Switch", width: 2, height: 2, wireReach: 10 },
      tank: { name: "tank", type: "storage-tank", displayName: "Tank", width: 3, height: 3, directions: 2 },
    });
    // The order of the fields is part of the file.
    expect(Object.keys(rows(table).railgun!)).toEqual(["name", "type", "displayName", "width", "height", "directions", "collisionBox"]);
  });

  it("rounds the size of the collision box up to whole tiles", () => {
    const sized = (box: number[][]) => rows(build(makeSet(["base"], { lamp: [wired("lamp", { collision_box: box })] }))).lamp;
    expect(sized([[-0.5, -1], [0.5, 1]])).toMatchObject({ height: 2 });
    expect(sized([[-0.5, -1], [0.5, 1]])?.width).toBeUndefined();
    expect(sized([[-0.3, -0.5], [0.7, 0.5]])?.width).toBeUndefined();
    expect(sized([[-0.51, -0.5], [0.5, 0.5]])).toMatchObject({ width: 2 });
    expect(() => sized([])).toThrow("lamp: no collision box");
  });

  it("names the items that place an entity where they are not the item of its name", () => {
    const table = build(base({ placing: { chest: [], pole: ["pole"], lamp: ["lamp", "old-lamp"] } }));
    expect(rows(table).chest).toMatchObject({ placedBy: [] });
    expect(rows(table).lamp).toMatchObject({ placedBy: ["lamp", "old-lamp"] });
    expect(rows(table).pole?.placedBy).toBeUndefined();
  });

  it("says which modules add a prototype", () => {
    const extra = makeSet(["base", "extra"], { ...BASE, lamp: [...BASE.lamp!, wired("beacon")] }, { hidden: ["mine"] });
    const table = build(extra, base());
    expect(rows(table).beacon).toEqual({ name: "beacon", type: "lamp", displayName: "Beacon", modules: ["extra"] });
    expect(rows(table).lamp?.modules).toBeUndefined();
    expect(table.entities).toHaveLength(15);
  });

  it("fails when a module set has another record for a prototype", () => {
    const wider = makeSet(["base", "extra"], { ...BASE, container: [wired("chest", { collision_box: square(0.9), circuit_wire_max_distance: 12 })] }, { hidden: ["mine"] });
    expect(() => build(base(), wider)).toThrow("entity chest: width is 1 in base and 2 in base+extra; height is 1 in base and 2 in base+extra; wireReach is 9 in base and 12 in base+extra");
  });

  it("fails for a prototype type without a rotation rule unless the game says whether it turns", () => {
    const odd = { "odd-type": [wired("odd", { collision_box: [[-0.4, -0.9], [0.4, 0.9]] })] };
    expect(() => build(makeSet(["base"], odd))).toThrow("odd: no rotation rule for prototype type odd-type");
    const table = build(makeSet(["base"], odd, { facts: [fact("odd", "odd-type", { supports_direction: true, tile_height: 2 })] }));
    expect(table.runtimeChecked).toBe(true);
    expect(rows(table).odd).toEqual({ name: "odd", type: "odd-type", displayName: "Odd", height: 2, directions: 4 });
  });

  it("fails for a prototype that is no entity of the game", () => {
    const set = base();
    set.runtime.entity = set.runtime.entity.filter((entry) => (entry as { name: string }).name !== "lamp");
    expect(() => build(set)).toThrow("lamp (lamp) takes a circuit wire in data.raw of base, but the game has no entity of that name");
  });
});

describe("entity table against the runtime dump", () => {
  const FACTS: Record<string, Fact> = {
    chest: fact("chest", "container"),
    crusher: fact("crusher", "assembling-machine", { supports_direction: true, tile_width: 2, tile_height: 3 }),
    flamer: fact("flamer", "fluid-turret", { supports_direction: true, tile_width: 2, tile_height: 3, flags: ["building-direction-8-way", "placeable-player"], optional: { turret_base_has_direction: true } }),
    gate: fact("gate", "decider-combinator", { supports_direction: true, tile_height: 2 }),
    // A default signal the scenario got no answer for is not in its dump: the lamp's rgb signal here.
    lamp: fact("lamp", "lamp", { default_signals: { default_red_signal: { type: "virtual", name: "signal-red" } } }),
    mine: fact("mine", "land-mine", { flags: ["placeable-off-grid", "placeable-player"] }),
    plant: fact("plant", "assembling-machine", { supports_direction: true, tile_width: 3, tile_height: 3 }),
    // Whatever the game says of a pole's circuit distance, its wire distance is its reach.
    pole: fact("pole", "electric-pole", { tile_width: 2, tile_height: 2, flags: {}, circuit_wire_distance: { normal: 9, legendary: 9 }, wire_distance: { normal: 32, legendary: 42 } }),
    press: fact("press", "assembling-machine", { tile_width: 3, tile_height: 3 }),
    railgun: fact("railgun", "ammo-turret", { supports_direction: true, tile_width: 3, tile_height: 5 }),
    signal: fact("signal", "rail-signal", { supports_direction: true, flags: ["building-direction-16-way"] }),
    stop: fact("stop", "train-stop", { supports_direction: true, tile_width: 2, tile_height: 2 }),
    switch: fact("switch", "power-switch", { tile_width: 2, tile_height: 2, flags: {}, circuit_wire_distance: { normal: 0 }, wire_distance: { normal: 10 } }),
    tank: fact("tank", "storage-tank", { supports_direction: true, tile_width: 3, tile_height: 3, optional: { two_direction_only: true } }),
  };
  const checkedSet = (changes: Record<string, object | undefined> = {}, mods = ["base"]): GameSet => {
    const facts = Object.values({ ...FACTS, ...Object.fromEntries(Object.entries(changes).map(([name, change]) => [name, change && { ...(FACTS[name] ?? fact(name, "tree")), ...change }])) });
    return makeSet(mods, BASE, { hidden: ["mine"], facts: facts.filter((entry): entry is Fact => entry !== undefined) });
  };

  it("is the same table once the game confirms it, and says so", () => {
    const { table, notes } = lib.buildEntityTable({ sets: [checkedSet()], modules, game });
    expect(table).toEqual({ ...build(base()), runtimeChecked: true });
    expect(notes).toEqual(["the wire reach of 1 prototypes grows with quality (pole: normal 32, legendary 42); the entity table has the reach at normal quality"]);
    expect(lib.buildEntityTable({ sets: [base()], modules, game }).notes).toEqual([expect.stringContaining("rotation is from the provisional table")]);
  });

  it("fails with every point in which the game contradicts the derivation", () => {
    const contradicting = checkedSet({
      chest: { supports_direction: true },
      press: { tile_width: 4 },
      pole: { wire_distance: { normal: 30 } },
      lamp: { default_signals: { default_red_signal: { type: "virtual", name: "signal-pink" }, default_green_signal: { name: "plate" } } },
      mine: { flags: ["placeable-player"] },
      tank: { optional: { two_direction_only: false } },
      signal: { supports_direction: false },
      gate: { type: "combinator" },
      switch: undefined,
      tree: { circuit_wire_distance: { normal: 3 } },
    });
    const message = (() => {
      try {
        build(contradicting);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message.split("\n")).toEqual([
      "The game contradicts the entity table (tools/catalog/lib/entities.mjs) in 12 point(s):",
      "  chest: supports_direction is true at run time, the provisional rotation table says false for type container",
      "  gate: type is combinator at run time, decider-combinator as derived from data.raw",
      "  lamp: default_green_signal is item:plate at run time, absent as derived from data.raw",
      "  lamp: default_red_signal is virtual:signal-pink at run time, virtual:signal-red as derived from data.raw",
      "  mine: flag placeable-off-grid is false at run time, true as derived from data.raw",
      "  pole: wire reach is 30 at run time, 32 as derived from data.raw",
      "  press: tile size is 4 x 3 at run time, 3 x 3 as derived from data.raw",
      "  signal: has the flag building-direction-16-way, but supports_direction is false at run time",
      "  signal: supports_direction is false at run time, the provisional rotation table says true for type rail-signal",
      "  switch: takes a circuit wire by data.raw (reach 10), but has no wire reach at run time",
      "  tank: two_direction_only is false at run time, true as derived from data.raw",
      "  tree: has a wire reach at run time, but the selection rule on data.raw does not find it",
    ]);
  });

  it("names the module sets a contradiction is in when it is not in all", () => {
    expect(() => build(checkedSet(), checkedSet({ press: { supports_direction: true } }, ["base", "extra"]))).toThrow(
      "  press: supports_direction is true at run time, the provisional rotation table says false for type assembling-machine (base+extra)",
    );
  });

  it("refuses dumps of which only some have the facts, and a scenario that failed to read them", () => {
    expect(() => build(base(), checkedSet({}, ["base", "extra"]))).toThrow("Only some runtime dumps have circuit_entities (base+extra); dump all module sets again");
    const failed = base();
    failed.runtime.circuit_entities_error = "LuaEntityPrototype doesn't contain key x";
    expect(() => build(failed)).toThrow("base: the runtime scenario (tools/catalog/runtime-dump/control.lua) could not read the wired entities: LuaEntityPrototype doesn't contain key x");
  });
});

describe("entity table file", () => {
  it("has the head pretty-printed and one record per line, the same text for the same table", () => {
    const table = build(base());
    const text = lib.entityTableText(table);
    expect(JSON.parse(text)).toEqual(table);
    const lines = text.split("\n");
    expect(lines.slice(0, 7)).toEqual([
      "{",
      '  "schema": 1,',
      '  "game": {"version":"1","build":7},',
      '  "generator": "tools/catalog/generate.mjs",',
      '  "runtimeChecked": false,',
      '  "defaults": {"width":1,"height":1,"directions":1,"wireReach":9,"modules":["base"]},',
      '  "entities": [',
    ]);
    expect(lines[7]).toBe('    {"name":"chest","type":"container","displayName":"Chest"},');
    expect(lines).toHaveLength(7 + table.entities.length + 3);
    expect(text.endsWith("\n  ]\n}\n")).toBe(true);
    expect(lib.entityTableText(build(base()))).toBe(text);
  });
});

// Local only: needs the game's data directory and the dumps of the last generator run, both outside the repository's history.
const local = (() => {
  try {
    const { dataDir } = dump.locateGame();
    const infos = dump.readModuleInfos(dataDir);
    const dumpRoot = resolve(ROOT, ".runtime/factorio-dump");
    const dumped = sets.completeDumps(dumpRoot, infos)?.game;
    return dumped?.version === STANDARD_CATALOG_VERSION ? { dumpRoot, dataDir, modules: infos, game: dumped } : undefined;
  } catch {
    return undefined;
  }
})();

describe.skipIf(!local)("entity table of the dumps", () => {
  const rawOf = (mods: string[]): Raw => JSON.parse(readFileSync(resolve(local!.dumpRoot, "sets", mods.join("+"), "script-output/data-raw-dump.json"), "utf8")) as Raw;

  it("selects 79 prototypes with base alone, 80 with the recycler and 98 with Space Age, in every module set", () => {
    const counts = Object.fromEntries(dump.validModSets(local!.modules).map((mods) => [mods.join("+"), lib.circuitEntities(rawOf(mods)).length]));
    expect(counts).toEqual({
      base: 79,
      "base+elevated-rails": 79,
      "base+recycler": 80,
      "base+elevated-rails+recycler": 80,
      "base+recycler+quality": 80,
      "base+elevated-rails+recycler+quality": 80,
      "base+elevated-rails+recycler+space-age": 98,
      "base+elevated-rails+recycler+quality+space-age": 98,
    });
  }, 60_000);

  it("has a rotation rule for exactly the prototype types it selects", () => {
    const types = new Set(lib.circuitEntities(rawOf(dump.validModSets(local!.modules).at(-1)!)).map(({ type }) => type));
    expect(Object.keys(lib.PROVISIONAL_ROTATION).sort()).toEqual([...types].sort());
    expect(types.size).toBe(48);
  });

  it("builds the committed table, the module sets agreeing on every record", () => {
    // `buildFromDumps` throws where a module set disagrees with another or the game with the derivation.
    const { table } = sets.buildFromDumps(local!).entities;
    const file = resolve(ROOT, `packages/model/data/entities-${STANDARD_CATALOG_VERSION}.json`);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(lib.entityTableText(table));
    expect(table.entities).toHaveLength(98);
  }, 60_000);
});
