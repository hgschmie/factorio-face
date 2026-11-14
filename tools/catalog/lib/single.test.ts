// Tests for the single-set mode: on a made-up dump, and on the dumps of the last generator run where they exist, where one
// module set built alone has to say what the standard tables say for that set.
import { STANDARD_CATALOG_VERSION, availableQualities, availableSignals, createCatalog, isAvailable, loadStandardCatalog, pickerTree, speakerInstruments, type Catalog, type CatalogSignal } from "@face/catalog";
import { iconTableFile, parseIconTable, type IconEntry } from "@face/catalog/icons";
import { loadStandardIconTable } from "@face/catalog/icons/standard";
import { STANDARD_ENTITY_TABLE, parseEntityTable } from "@face/model";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DUMP_OUTPUTS, RUNTIME_DUMP_FILE, parseGameVersion } from "./commands.ts";
import { LOCALE_DUMP_SECTIONS, activeMods, buildSingleSet, localeDumpFile, singleSetLocale, singleSetModules, type SingleSet } from "./single.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "face-single-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const GAME = { version: "2.1.24", build: 87808 };
const HEAD = { game: GAME, generator: "test", generatedAt: "2026-11-14T00:00:00Z" };

describe("single-set build of a made-up dump", () => {
  const dataDir = join(scratch, "data");
  for (const [name, more] of Object.entries({ base: {}, quality: { dependencies: ["base >= 2.1.0"], quality_required: true } })) {
    mkdirSync(join(dataDir, name, "locale", "en"), { recursive: true });
    writeFileSync(join(dataDir, name, "info.json"), JSON.stringify({ name, version: "2.1.24", title: `The ${name}`, ...more }));
  }
  writeFileSync(join(dataDir, "base", "locale", "en", "base.cfg"), "[programmable-speaker-instrument]\nkit=Drumkit\n");

  const signal = (name: string, type: string) => ({ name, type, order: name, group: "g", subgroup: "s", hidden: false, parameter: false });
  const wired = (name: string, more: object = {}) => ({ name, icon: `__base__/graphics/icons/${name}.png`, collision_box: [[-0.35, -0.35], [0.35, 0.35]], selection_box: [[-0.5, -0.5], [0.5, 0.5]], circuit_wire_max_distance: 9, ...more });
  const fact = (name: string, type: string, more: object = {}) => ({ name, type, supports_direction: false, tile_width: 1, tile_height: 1, flags: {}, circuit_wire_distance: { normal: 9 }, wire_distance: { normal: 0 }, optional: {}, default_signals: {}, ...more });
  const raw = {
    item: { plate: { icon: "__base__/graphics/icons/plate.png" }, gadget: { icon: "__some-mod__/graphics/gadget.png" }, lamp: { icon: "__base__/graphics/icons/lamp.png" } },
    lamp: { lamp: wired("lamp"), "odd-lamp": wired("odd-lamp"), "ghost-lamp": wired("ghost-lamp") },
    "item-group": { g: { icon: "__base__/graphics/g.png", icon_size: 128 } },
    "utility-constants": { default: { default_item_weight: 100, default_rocket_lift_weight: 1000 } },
  };
  const runtime = {
    game_version: "2.1.24",
    active_mods: { "some-mod": "1.2.3", quality: "2.1.24", base: "2.1.24" },
    item: ["plate", "gadget", "lamp"].map((name) => ({ ...signal(name, "item"), stack_size: 50, weight: 100 })),
    fluid: [], virtual_signal: [], recipe: [], space_location: [], asteroid_chunk: [], quality: [],
    entity: ["lamp", "odd-lamp", "ghost-lamp"].map((name) => ({ ...signal(name, "lamp"), items_to_place_this: name === "lamp" ? ["lamp"] : {} })),
    item_group: [{ name: "g", order: "a" }],
    item_subgroup: [{ name: "s", group: "g", order: "a" }],
    utility_constants: { default_item_weight: 100 },
    rocket_silos: {},
    // The game has another size for one lamp and no wire reach for another.
    circuit_entities: [fact("lamp", "lamp"), fact("odd-lamp", "lamp", { tile_width: 2 })],
  };
  const mods = activeMods(runtime);
  const modules = singleSetModules(dataDir, mods);
  const locale = singleSetLocale(dataDir, mods, { item: { names: { plate: "Plate", gadget: "Gadget", broken: 7 } }, entity: { names: { lamp: "Lamp" } }, "item-group": "damaged" });
  const built = buildSingleSet({ raw, runtime, locale, modules, ...HEAD });

  it("lists what the game loaded: its modules first and as their info.json has them, a mod by name and version", () => {
    expect(mods).toEqual([{ name: "base", version: "2.1.24" }, { name: "quality", version: "2.1.24" }, { name: "some-mod", version: "1.2.3" }]);
    expect(modules).toEqual([
      { name: "base", title: "The base", version: "2.1.24", requires: [], recommends: [], featureFlags: [] },
      { name: "quality", title: "The quality", version: "2.1.24", requires: ["base"], recommends: [], featureFlags: ["quality"] },
      { name: "some-mod", title: "some-mod", version: "1.2.3", requires: [], recommends: [], featureFlags: [] },
    ]);
    expect(built.mods).toEqual(mods);
    expect(built.catalog.modules).toEqual(modules);
    expect(built.catalog.provenance).toMatchObject({ generator: "test", generatedAt: "2026-11-14T00:00:00Z", modSets: ["base+quality+some-mod"] });
    expect(built.catalog.provenance.commands[0]).toBe("factorio --config <run>/game/config/config.ini --mod-directory <run>/game/mods --no-log-rotation --dump-data");
    expect(built.entities.mods).toEqual({ base: "2.1.24", quality: "2.1.24", "some-mod": "1.2.3" });
    expect(built.entities).toMatchObject({ schema: 1, game: GAME, generator: "test", runtimeChecked: true });
  });

  it("takes the names from the dumped locale files and the speaker's from the game's own modules", () => {
    expect(locale).toEqual({ item: { plate: "Plate", gadget: "Gadget" }, entity: { lamp: "Lamp" }, "programmable-speaker-instrument": { kit: "Drumkit" }, "programmable-speaker-note": {} });
  });

  it("has every record with no module required, in the catalog's own format", () => {
    const records = [...Object.values(built.catalog.signals).flat(), ...built.catalog.groups, ...built.catalog.subgroups];
    expect(records.length).toBe(8);
    for (const record of [...records, ...built.catalog.qualities, ...built.catalog.constants.rocketSilos]) expect(record).toMatchObject({ modules: [] });
    expect(records.some((record) => "removedBy" in record || "variants" in record)).toBe(false);
    const catalog = createCatalog(built.catalog);
    expect(availableSignals(catalog, []).map((entry) => entry.key).sort()).toEqual(["entity:ghost-lamp", "entity:lamp", "entity:odd-lamp", "item:gadget", "item:lamp", "item:plate"]);
    expect(catalog.signalsByKey.get("item:plate")).toMatchObject({ displayName: "Plate", stackSize: 50, icon: "item/plate" });
    expect(catalog.signalsByKey.get("entity:lamp")).toMatchObject({ icon: "item/lamp", visibility: "hidden" });
  });

  it("leaves icons of mods out of the icon table and names them", () => {
    expect(built.skippedIcons).toEqual(["item/gadget"]);
    expect([...built.icons.keys()]).toEqual(["entity/ghost-lamp", "entity/odd-lamp", "group/g", "item/lamp", "item/plate"]);
    expect(parseIconTable(iconTableFile({ game: GAME, icons: built.icons })).icons.size).toBe(5);
  });

  it("leaves out the wired entities the game contradicts and says why, instead of failing", () => {
    const table = parseEntityTable(built.entities);
    expect(table.entities.map((entity) => entity.name)).toEqual(["lamp"]);
    expect(table.entities[0]).toMatchObject({ displayName: "Lamp", wireReach: 9, directions: 1, modules: [], placedBy: ["lamp"] });
    expect(built.notes).toEqual([
      "left out: odd-lamp: tile size is 2 x 1 at run time, 1 x 1 as derived from data.raw",
      "left out: ghost-lamp: takes a circuit wire by data.raw (reach 9), but has no wire reach at run time",
    ]);
  });

  it("refuses a dump that is not one", () => {
    const input = { raw, runtime, locale, modules, ...HEAD };
    expect(() => buildSingleSet({ ...input, raw: [] })).toThrow(/data dump is not a table/);
    expect(() => buildSingleSet({ ...input, raw: { item: 1 } })).toThrow(/data dump is not a table/);
    expect(() => buildSingleSet({ ...input, runtime: { ...runtime, game_version: "2.0.1" } })).toThrow(/runtime dump is from "2.0.1"/);
    expect(() => buildSingleSet({ ...input, modules: modules.slice(0, 2) })).toThrow(/not the mods the game loaded/);
    expect(() => buildSingleSet({ ...input, raw: { ...raw, item: { plate: raw.item.plate } } })).toThrow(/item:gadget \(item\) is missing from data.raw of the dump/);
    expect(() => activeMods({})).toThrow(/does not say which mods/);
    expect(() => activeMods({ active_mods: { base: 2 } })).toThrow(/malformed mod: "base"/);
    expect(() => activeMods({ active_mods: { "a/b": "1.0.0" } })).toThrow(/malformed mod/);
    expect(() => activeMods({ active_mods: {} })).toThrow(/lists 0 mods/);
  });
});

describe("game version", () => {
  it("is read from the answer to --version and from the first line of a log", () => {
    expect(parseGameVersion("Version: 2.1.24 (build 87808, mac-arm64, full)\nBinary version: 64\n")).toEqual({ version: "2.1.24", build: 87808, variant: "mac-arm64, full" });
    expect(parseGameVersion("   0.000 2026-11-11 14:26:41; Factorio 2.1.24 (build 87808, mac-arm64, full, space-age)\n   0.002 Operating system")).toEqual({ version: "2.1.24", build: 87808, variant: "mac-arm64, full, space-age" });
    expect(parseGameVersion("Factorio 2.1 (build x)")).toBeUndefined();
    expect(parseGameVersion("")).toBeUndefined();
  });
});

// Local only: needs the game's data directory and the dumps of the last generator run, both outside the repository's history.
const load = (file: string): Promise<unknown> => import(/* @vite-ignore */ new URL(file, import.meta.url).href);
const dump = (await load("./dump.mjs")) as { locateGame(): { dataDir: string }; readModuleInfos(dataDir: string): object[] };
const sets = (await load("./sets.mjs")) as { completeDumps(dumpRoot: string, modules: object[]): { game: { version: string; build: number } } | undefined };
const local = (() => {
  try {
    const { dataDir } = dump.locateGame();
    const dumpRoot = resolve(ROOT, ".runtime/factorio-dump");
    const game = sets.completeDumps(dumpRoot, dump.readModuleInfos(dataDir))?.game;
    return game?.version === STANDARD_CATALOG_VERSION ? { dumpRoot, dataDir, game: { version: game.version, build: game.build } } : undefined;
  } catch {
    return undefined;
  }
})();

describe.skipIf(!local)("single-set build of the generator's dumps", () => {
  const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
  function build(setId: string): SingleSet {
    const output = resolve(local!.dumpRoot, "sets", setId, "script-output");
    const runtime = readJson(join(output, RUNTIME_DUMP_FILE));
    const mods = activeMods(runtime);
    // The game writes no file for a section without prototypes (asteroid chunks without Space Age).
    const dumped = Object.fromEntries(LOCALE_DUMP_SECTIONS.filter((section) => existsSync(join(output, localeDumpFile(section)))).map((section) => [section, readJson(join(output, localeDumpFile(section)))]));
    return buildSingleSet({ raw: readJson(join(output, DUMP_OUTPUTS.data)), runtime, locale: singleSetLocale(local!.dataDir, mods, dumped), modules: singleSetModules(local!.dataDir, mods), game: local!.game, generator: "test", generatedAt: HEAD.generatedAt });
  }
  const standard = loadStandardCatalog();
  const standardIcons = loadStandardIconTable();
  const plain = ({ modules: _modules, removedBy: _removedBy, variants: _variants, icon: _icon, origin: _origin, ...rest }: Record<string, unknown>): Record<string, unknown> => rest;
  const tree = (catalog: Catalog, enabled: readonly string[]) => pickerTree(catalog, enabled, { parameters: true, hidden: true }).map(({ group, subgroups }) => ({
    group: plain({ ...group }),
    subgroups: subgroups.map(({ subgroup, signals }) => ({ subgroup: plain({ ...subgroup }), signals: signals.map((entry) => entry.key) })),
  }));

  it.each([["base", 0], ["base+elevated-rails+recycler+quality+space-age", 0]])("says for %s what the standard tables say for that set", (setId) => {
    const enabled = setId.split("+");
    const built = build(setId);
    expect(built.mods.map((mod) => mod.name)).toEqual(standard.modules.map((module) => module.name).filter((name) => enabled.includes(name)));
    expect(built.catalog.modules).toEqual(standard.modules.filter((module) => enabled.includes(module.name)));
    expect(built.skippedIcons).toEqual([]);
    expect(built.notes).toEqual([]);

    // Signals: the same ones, each with the attributes the standard catalog resolves for these modules and the same picture.
    const catalog = createCatalog(built.catalog);
    const icons = parseIconTable(iconTableFile({ game: local!.game, icons: built.icons })).icons;
    const expected = new Map(availableSignals(standard, enabled).map((entry) => [entry.key, entry]));
    const actual = new Map(availableSignals(catalog, []).map((entry) => [entry.key, entry]));
    expect([...actual.keys()]).toEqual([...expected.keys()]);
    expect(actual.size).toBe(catalog.signals.length);
    const picture = (table: ReadonlyMap<string, IconEntry>, entry: CatalogSignal | { icon: string }): IconEntry | undefined => table.get(entry.icon);
    // One dump has no other to borrow a name from: without the quality module the game has none for the quality "normal", which it hides.
    const unnamed: Record<string, string> = setId === "base" ? { "quality:normal": "Normal" } : {};
    const named = <T extends { readonly displayName: string }>(key: string, entry: T): T => (key in unnamed ? { ...entry, displayName: unnamed[key]! } : entry);
    for (const [key, entry] of actual) {
      if (key in unnamed) expect(entry.displayName, key).toBe(entry.name);
      expect(plain({ ...named(key, entry) }), key).toEqual(plain({ ...expected.get(key)! }));
      expect(picture(icons, entry), `icon of ${key}`).toEqual(picture(standardIcons.icons, expected.get(key)!));
      expect(picture(icons, entry), `icon of ${key}`).toBeDefined();
    }

    // Groups and subgroups as the picker shows them, qualities, the speaker and the constants.
    expect(tree(catalog, [])).toEqual(tree(standard, enabled));
    for (const { group } of pickerTree(catalog, [], { hidden: true, parameters: true })) expect(picture(icons, group), `icon of group ${group.name}`).toEqual(picture(standardIcons.icons, standard.groupsByName.get(group.name)!));
    const qualities = (of: Catalog, modules: readonly string[]) => availableQualities(of, modules).map((quality) => plain({ ...named(`quality:${quality.name}`, quality) }));
    expect(qualities(catalog, [])).toEqual(qualities(standard, enabled));
    expect(speakerInstruments(catalog, [])).toEqual(speakerInstruments(standard, enabled));
    expect(speakerInstruments(catalog, []).length).toBeGreaterThan(0);
    const { rocketSilos, ...constants } = catalog.constants;
    expect(constants).toEqual({ defaultItemWeight: standard.constants.defaultItemWeight, rocketLiftWeight: standard.constants.rocketLiftWeight });
    expect(rocketSilos.map((silo) => silo.name)).toEqual(standard.constants.rocketSilos.filter((silo) => isAvailable(silo, new Set(enabled))).map((silo) => silo.name));

    // Wired entities: the records of the standard table that these modules have.
    const table = parseEntityTable(built.entities);
    const wired = STANDARD_ENTITY_TABLE.entities.filter((entity) => isAvailable(entity, new Set(enabled)));
    expect(table.entities.map((entity) => plain({ ...entity }))).toEqual(wired.map((entity) => plain({ ...entity })));
    expect(table.entities.length).toBe(setId === "base" ? 79 : 98);
    expect(table.runtimeChecked).toBe(STANDARD_ENTITY_TABLE.runtimeChecked);
  }, 60_000);
});
