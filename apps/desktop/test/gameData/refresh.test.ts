// The whole way from an installation to accepted game data and into the cache, with the fake game in place of the real one.
import { STANDARD_CATALOG_VERSION, availableSignals, createCatalog, loadStandardCatalog } from "@face/catalog";
import { missingEditorPrototypes, parseEntityTable, PROTOTYPES, prototypesOf, setEntityTable, STANDARD_ENTITY_TABLE } from "@face/model";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { GameInstallation, Host } from "../../src/gameInstallation.ts";
import { inspectDataDirectory } from "../../src/gameInstallation.ts";
import { GameDataCache, GAME_DATA_FILE_NAME, GAME_DATA_FILE_VERSION, OUTDATED_GAME_DATA } from "../../src/gameData/cache.ts";
import { describeGameDataSource, gameDataKeyId, gameDataSource, parseGameData, parseGameDataKey, sameGameState, type GameData, type GameDataKey } from "../../src/gameData/gameData.ts";
import { planGameRead, readGameData, skippedIconsWarning, userDataLocation, type RefreshOptions } from "../../src/gameData/refresh.ts";
import { GameIcons } from "../../src/gameIcons/gameIcons.ts";
import { decodePng } from "../../src/gameIcons/png.ts";
import { ValidationError } from "../../src/validation.ts";
import { fakeGameStarts, MOD_ICON_COLOR, MODDED_KINDS, modArchive, SOME_MOD_INFO, someModArchive, writeCannedDump, writeFakeGame, type CannedDump, type FakeGameControl } from "../support/cannedDump.ts";
import { writeGameData } from "../support/fakeGame.ts";
import { useScratch } from "../support/scratch.ts";
import { treeSnapshot } from "../support/treeSnapshot.ts";

const scratch = useScratch("game-refresh");
const SETTINGS_HASH = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";

interface Setup {
  readonly options: RefreshOptions;
  readonly control: FakeGameControl;
  readonly home: string;
  readonly mods: string;
}

/** A Linux-style installation in the scratch folder whose program is the fake game, and a home directory for its user. */
async function setup(name: string, dump: CannedDump = {}, behaviour: Partial<FakeGameControl> = {}): Promise<Setup> {
  const root = scratch(name, "factorio"), home = scratch(name, "home");
  const dataDirectory = await writeGameData(join(root, "data"), { modules: ["quality"] });
  await mkdir(join(root, "bin", "x64"), { recursive: true });
  const control: FakeGameControl = { record: scratch(name, "record.jsonl"), dump: await writeCannedDump(scratch(name, "dump"), dump), ...behaviour };
  await writeFakeGame(join(root, "bin", "x64", "factorio"), control);
  const inspection = await inspectDataDirectory(dataDirectory, "2.1.25");
  if (!inspection.ok) throw new Error(inspection.message);
  const host: Host = { platform: "linux", env: {}, home };
  const options: RefreshOptions = { installation: inspection.installation, host, confirmedExecutable: join(root, "bin", "x64", "factorio"), runsDirectory: scratch(name, "user-data", "game-data-runs"), scenarioSource: "-- scenario\n", generator: "face test", sandbox: "off", now: () => new Date("2026-11-14T12:00:00Z") };
  return { options, control, home, mods: join(home, ".factorio", "mods") };
}

async function userMods(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "mod-list.json"), JSON.stringify({ mods: [{ name: "base", enabled: true }, { name: "quality", enabled: false }, { name: "some-mod", enabled: true }, { name: "off", enabled: false }] }));
  await writeFile(join(directory, "mod-settings.dat"), new Uint8Array([1, 2, 3, 4]));
  await writeFile(join(directory, "some-mod_1.2.3.zip"), someModArchive());
  await writeFile(join(directory, "some-mod_1.2.0.zip"), modArchive({ ...SOME_MOD_INFO, version: "1.2.0", title: "The older Some Mod" }));
  await writeFile(join(directory, "off_0.1.0.zip"), modArchive({ name: "off", version: "0.1.0", title: "Switched off" }));
}

describe("readGameData", () => {
  it("reads a game without mods: the tables of the dump, accepted, and the folder of the run removed", async () => {
    const { options, control } = await setup("plain");
    const result = await readGameData(options);
    expect(result).toMatchObject({ ok: true, sandboxed: false, changed: [] });
    if (!result.ok) return;
    // The game says nothing of the mod whose image one item has for its icon.
    expect(result.warnings).toEqual(["1 icon is not shown: it names an image the app cannot read, such as a file of a mod that was not loaded."]);
    const { data } = result;
    expect(data.key).toEqual({ version: "2.1.25", build: 88022, mods: [{ name: "base", version: "2.1.25" }, { name: "quality", version: "2.1.25" }], modSettings: null });
    expect(data).toMatchObject({ readAt: "2026-11-14T12:00:00.000Z", mods: [{ name: "base", version: "2.1.25" }], notes: [], skippedIcons: 1 });
    expect(data.catalog).toMatchObject({ schema: 1, game: { version: "2.1.25", build: 88022 }, provenance: { generator: "face test", generatedAt: "2026-11-14T12:00:00.000Z", modSets: ["base"] } });
    expect(data.catalog.modules).toEqual([{ name: "base", title: "base", version: "2.1.25", requires: [], recommends: [], featureFlags: [] }]);
    // Every record is of the module that created it: here the one the game has.
    expect(availableSignals(createCatalog(data.catalog), ["base"]).map((signal) => `${signal.key}=${signal.displayName}`).sort()).toEqual(["entity:lamp=Lamp", "item:gadget=Gadget", "item:lamp=Lamp", "item:plate=Plate"]);
    expect(availableSignals(createCatalog(data.catalog), [])).toEqual([]);
    expect([...data.catalog.groups, ...data.catalog.subgroups].map((record) => record.modules)).toEqual([["base"], ["base"]]);
    expect([...result.iconTable.icons.keys()]).toEqual(["group/g", "item/lamp", "item/plate"]);
    expect(Object.keys(data.icons.icons)).toEqual(["group/g", "item/lamp", "item/plate"]);
    expect(parseEntityTable(data.entities).entities).toMatchObject([{ name: "lamp", displayName: "Lamp", wireReach: 9, modules: ["base"] }]);
    expect(data.entities).toMatchObject({ generator: "face test", runtimeChecked: true, mods: { base: "2.1.25" } });
    expect(gameDataSource(data)).toEqual({ kind: "game", version: "2.1.25", build: 88022, readAt: "2026-11-14T12:00:00.000Z", mods: 0 });
    expect((await fakeGameStarts(control)).map((start) => start.command)).toEqual(["data", "locale", "runtime"]);
    expect(await readdir(options.runsDirectory)).toEqual([]);
  });

  it("includes the user's mods through a private mod directory and leaves the user's own untouched", async () => {
    const { options, control, home, mods } = await setup("modded", { activeMods: { base: "2.1.25", "some-mod": "1.2.3" } });
    await userMods(mods);
    const before = await treeSnapshot(home);
    const seen: string[][] = [];
    const result = await readGameData({ ...options, onProgress: ({ step, state }) => void (step === "collect" && state === "started" && seen.push(["collect"])) });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    if (!result.ok) return;
    // The icon of the mod's item is in the table, as the file of the mod.
    expect(result.data.skippedIcons).toBe(0);
    expect(result.data.icons.icons).toMatchObject({ "item/gadget": ["__some-mod__/graphics/gadget.png"], "item/plate": ["__base__/graphics/icons/plate.png"] });
    expect(result.iconTable.icons.get("item/gadget")).toEqual({ expected: 64, layers: [{ icon: "__some-mod__/graphics/gadget.png", size: 64 }] });
    expect(result.data.key).toEqual({ version: "2.1.25", build: 88022, mods: [{ name: "base", version: "2.1.25" }, { name: "some-mod", version: "1.2.3" }], modSettings: SETTINGS_HASH });
    expect(result.data.mods).toEqual([{ name: "base", version: "2.1.25" }, { name: "some-mod", version: "1.2.3" }]);
    // The mod as its own info.json describes it, read from the archive of the version the game loaded; of what it depends on, the hard ones that are loaded.
    expect(result.data.catalog.modules).toEqual([
      { name: "base", title: "base", version: "2.1.25", requires: [], recommends: [], featureFlags: [] },
      { name: "some-mod", title: "Some Mod", version: "1.2.3", requires: ["base"], recommends: [], featureFlags: [] },
    ]);
    // What the mod created is the mod's, the rest the game's.
    const catalog = createCatalog(result.data.catalog);
    expect(catalog.signalsByKey.get("item:gadget")!.modules).toEqual(["some-mod"]);
    expect(catalog.signalsByKey.get("item:plate")!.modules).toEqual(["base"]);
    expect(availableSignals(catalog, ["base"]).map((signal) => signal.key).sort()).toEqual(["entity:lamp", "item:lamp", "item:plate"]);
    expect(describeGameDataSource(gameDataSource(result.data), () => "14 November 2026")).toBe("Read from your game on 14 November 2026: 2.1.25 with 1 mod");
    const [start] = await fakeGameStarts(control);
    expect(start!.args[3]).toBe(join(start!.cwd, "mods"));
    expect(start!.args[3]).not.toContain(home);
    expect(seen).toEqual([["collect"]]);
    expect(await treeSnapshot(home)).toEqual(before);
    // What the files say now is what the data was read for, until they change.
    const current = await planGameRead(options.installation, options.host);
    expect(current).toMatchObject({ ok: true, plan: { executable: options.confirmedExecutable, steam: false, modDirectory: mods, problems: [] } });
    if (!current.ok) return;
    expect(current.plan.key).toEqual({ version: "2.1.25", mods: result.data.key.mods, modSettings: SETTINGS_HASH });
    expect(sameGameState(result.data.key, current.plan.key)).toBe(true);
    await writeFile(join(mods, "some-mod_1.3.0.zip"), "newer");
    const changed = await planGameRead(options.installation, options.host);
    expect(changed.ok && sameGameState(result.data.key, changed.plan.key)).toBe(false);
  });

  it("makes data whose icons of mods the icon service draws from the user's mod directory, as that is then", async () => {
    const { options, mods } = await setup("mod-icons", { editor: true, activeMods: { base: "2.1.25", "some-mod": "1.2.3" } });
    await userMods(mods);
    const result = await readGameData(options);
    expect(result).toMatchObject({ ok: true, warnings: [], data: { skippedIcons: 0 } });
    if (!result.ok) return;
    const service = (host: Host): GameIcons => {
      const icons = new GameIcons(result.iconTable, { modDirectory: async (dataDirectory) => (await userDataLocation(dataDirectory, host))?.modDirectory }, result.data.mods);
      icons.reset(options.installation.dataDirectory);
      return icons;
    };
    const icons = service(options.host);
    for (const id of ["item/gadget", "virtual/mod-signal", "item/mod-crate"]) {
      expect(icons.ofMod(id), id).toBe(true);
      const image = decodePng((await icons.icon(id))!);
      expect([image.width, image.height, ...image.data.subarray(0, 4)], id).toEqual([64, 64, ...MOD_ICON_COLOR]);
    }
    // The mod directory of a test run stands in for the user's; one without the mod has no image for its icons.
    const elsewhere = scratch("mod-icons", "other-mods");
    await mkdir(elsewhere, { recursive: true });
    expect(await service({ ...options.host, env: { FACE_GAME_MODS_DIR: mods } }).icon("item/gadget")).toBeDefined();
    expect(await service({ ...options.host, env: { FACE_GAME_MODS_DIR: elsewhere } }).icon("item/gadget")).toBeUndefined();
    // The mod is updated after the game was read: its icons are gone until the game is read again.
    await rename(join(mods, "some-mod_1.2.3.zip"), join(mods, "some-mod_1.2.4.zip"));
    expect(await service(options.host).icon("item/gadget")).toBeUndefined();
    expect([skippedIconsWarning(1), skippedIconsWarning(12)]).toEqual([
      "1 icon is not shown: it names an image the app cannot read, such as a file of a mod that was not loaded.",
      "12 icons are not shown: they name images the app cannot read, such as a file of a mod that was not loaded.",
    ]);
  });

  it("lists a mod whose info.json cannot be read by its name and says so once", async () => {
    const { options, mods } = await setup("unread", { activeMods: { base: "2.1.25", "some-mod": "1.2.3", "b-mod": "0.1.0", "c-mod": "1.0.0" } });
    await userMods(mods);
    await writeFile(join(mods, "some-mod_1.2.3.zip"), "no archive");
    await writeFile(join(mods, "b-mod_0.1.0.zip"), modArchive({ name: "b-mod", version: "0.1.0", dependencies: "base" }));
    await writeFile(join(mods, "c-mod_1.0.0.zip"), modArchive({ name: "c-mod", version: "1.0.0", title: "The C", dependencies: ["? base", "b-mod", "some-mod >= 1"] }));
    const result = await readGameData(options);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.warnings).toEqual([
      "The info.json of 2 mods could not be read (b-mod, some-mod): they are listed by name, without what they depend on.",
    ]);
    expect(result.data.catalog.modules.slice(1)).toEqual([
      { name: "b-mod", title: "b-mod", version: "0.1.0", requires: [], recommends: [], featureFlags: [] },
      { name: "c-mod", title: "The C", version: "1.0.0", requires: ["b-mod", "some-mod"], recommends: [], featureFlags: [] },
      { name: "some-mod", title: "some-mod", version: "1.2.3", requires: [], recommends: [], featureFlags: [] },
    ]);
    // Without a mod directory at all (a game whose mods are elsewhere) every mod is listed that way.
    const bare = await setup("unread-bare", { activeMods: { base: "2.1.25", "some-mod": "1.2.3" } });
    expect(await readGameData(bare.options)).toMatchObject({ ok: true, warnings: ["The info.json of 1 mod could not be read (some-mod): it is listed by name, without what it depends on."] });
  });

  it("keeps a record the game names no loaded creator for, with no module, and says how many there are", async () => {
    const { options, control } = await setup("untagged", { activeMods: { base: "2.1.25" } });
    const file = join(control.dump, "face-runtime-dump.json");
    const runtime = JSON.parse(await readFile(file, "utf8")) as { item: { name: string; created?: string }[]; item_subgroup: { created?: string }[] };
    delete runtime.item.find((item) => item.name === "gadget")!.created;
    runtime.item_subgroup[0]!.created = "a-mod-that-is-not-loaded";
    await writeFile(file, JSON.stringify(runtime));
    const result = await readGameData(options);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.warnings).toEqual(["The game did not say which mod 2 of its signals and entities come from (item gadget, subgroup s): they are kept and belong to no mod.", "1 icon is not shown: it names an image the app cannot read, such as a file of a mod that was not loaded."]);
    expect(availableSignals(createCatalog(result.data.catalog), []).map((signal) => signal.key)).toEqual(["item:gadget"]);
    expect(result.data.catalog.subgroups).toMatchObject([{ name: "s", modules: [] }]);
  });

  it("has what a mod adds to the kinds of the editor in the entity table, a loader of one tile among it, and the editor gives each its kind", async () => {
    const { options } = await setup("modded-kinds", { editor: true, activeMods: { base: "2.1.25", "some-mod": "1.2.3" }, entities: MODDED_KINDS });
    const result = await readGameData(options);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    // Nothing was left out: the game says of each whether it turns, also of a type the rotation table has for mods only.
    expect(result.data.notes).toEqual([]);
    const table = parseEntityTable(result.data.entities);
    expect(table.entities.filter((entity) => entity.name.startsWith("mod-") && entity.name !== "mod-crate")).toMatchObject([
      { name: "mod-arithmetic", type: "arithmetic-combinator", displayName: "Tiny arithmetic combinator", width: 1, height: 1, directions: 4, wireReach: 9 },
      { name: "mod-decider", type: "decider-combinator", width: 2, height: 2, directions: 4 },
      { name: "mod-lamp", type: "lamp", width: 2, height: 2, directions: 1 },
      { name: "mod-loader", type: "loader-1x1", width: 1, height: 1, directions: 4 },
      { name: "mod-pole", type: "electric-pole", width: 2, height: 2, directions: 1, wireReach: 48 },
      { name: "mod-speaker", type: "programmable-speaker", width: 1, height: 1, directions: 1 },
    ]);
    expect(missingEditorPrototypes(table)).toEqual([]);
    setEntityTable(table);
    try {
      const kinds = Object.fromEntries(MODDED_KINDS.map(({ name }) => [name, PROTOTYPES[name]?.kind]));
      expect(kinds).toEqual({ "mod-arithmetic": "arithmetic", "mod-decider": "decider", "mod-lamp": "lamp", "mod-pole": "pole", "mod-loader": "entity", "mod-speaker": undefined });
      expect(prototypesOf("arithmetic")).toEqual(["arithmetic-combinator", "mod-arithmetic"]);
    } finally {
      setEntityTable(STANDARD_ENTITY_TABLE);
    }
  });

  it("starts only the program that was agreed to", async () => {
    const { options, control } = await setup("confirmed");
    expect(await planGameRead(options.installation, options.host)).toMatchObject({ ok: true, plan: { executable: options.confirmedExecutable, modDirectory: null, key: { modSettings: null } } });
    expect(await readGameData({ ...options, confirmedExecutable: scratch("confirmed", "another-program") })).toMatchObject({ ok: false, failure: "not-confirmed" });
    expect(await fakeGameStarts(control)).toEqual([]);
  });

  it("refuses an installation without the program, and one that is too old, without starting anything", async () => {
    const { options, control } = await setup("refused");
    const dataOnly: GameInstallation = { ...options.installation, dataDirectory: await writeGameData(scratch("refused", "copy", "data")) };
    expect(await readGameData({ ...options, installation: dataOnly })).toMatchObject({ ok: false, failure: "no-executable", log: "" });
    expect(await planGameRead(dataOnly, options.host)).toMatchObject({ ok: false, failure: "no-executable" });
    const old = await readGameData({ ...options, installation: { ...options.installation, version: "2.0.72" } });
    expect(old).toMatchObject({ ok: false, failure: "unsupported-version", message: "Reading the game needs Factorio 2.1.24 or newer; this installation is 2.0.72" });
    expect(await fakeGameStarts(control)).toEqual([]);
  });

  it("reports a game that fails, with its output, and a dump that cannot be used, with the reason", async () => {
    const failing = await setup("failing", {}, { mode: "fail", at: "runtime" });
    const failed = await readGameData(failing.options);
    expect(failed).toMatchObject({ ok: false, failure: "exit", message: "The game ended with exit code 3" });
    expect(failed.ok ? "" : failed.log).toContain("Failed to load mods");
    expect(await readdir(failing.options.runsDirectory)).toEqual([]);

    // Where the game's log names the mod that failed, the message does too, before what it said without.
    const error = [
      "   4.307 Error RunTest.cpp:67: Error loading scenario: The mod Some Mod (1.2.3) caused a non-recoverable error.",
      "Please report this error to the mod author.",
      "",
      "Error while running event some-mod::on_init()",
      "__some-mod__/control.lua:26: assertion failed!",
      "   4.355 Goodbye",
      "",
    ].join("\n");
    const blaming = await setup("failing-mod", {}, { mode: "fail", at: "runtime", error });
    const blamed = await readGameData(blaming.options);
    expect(blamed).toMatchObject({ ok: false, failure: "exit", message: "The mod Some Mod 1.2.3 (some-mod) failed while the game started, and the game cannot be read with it enabled. The game ended with exit code 3" });
    expect(blamed.ok ? "" : blamed.log).toContain("__some-mod__/control.lua:26: assertion failed!");

    const other = await setup("other-version", { gameVersion: "2.1.30" });
    expect(await readGameData(other.options)).toMatchObject({ ok: false, failure: "invalid-dump", message: 'The runtime dump is from "2.1.30", the game is 2.1.25' });
    const damaged = await setup("damaged");
    await writeFile(join(damaged.control.dump, "data-raw-dump.json"), "{ not json");
    expect(await readGameData(damaged.options)).toMatchObject({ ok: false, failure: "invalid-dump", message: "The game's data dump is not JSON" });
    const hostile = await setup("hostile", { activeMods: { base: "2.1.25", "../evil": "1.0.0" } });
    expect(await readGameData(hostile.options)).toMatchObject({ ok: false, failure: "invalid-dump", message: 'The runtime dump lists a malformed mod: "../evil"' });
  });

  it("can be cancelled", async () => {
    const { options, control } = await setup("cancelled", {}, { mode: "hang", at: "locale" });
    const controller = new AbortController();
    const reading = readGameData({ ...options, signal: controller.signal });
    while ((await fakeGameStarts(control)).length < 2) await new Promise((done) => setTimeout(done, 20));
    controller.abort();
    expect(await reading).toMatchObject({ ok: false, failure: "cancelled" });
    expect(await readdir(options.runsDirectory)).toEqual([]);
  });
});

describe("game data key and source", () => {
  const key: GameDataKey = { version: "2.1.25", build: 88022, mods: [{ name: "base", version: "2.1.25" }, { name: "odd", version: null }], modSettings: SETTINGS_HASH };

  it("is one id for one state of the game", () => {
    expect(gameDataKeyId(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(gameDataKeyId({ modSettings: SETTINGS_HASH, mods: [...key.mods].reverse(), build: 88022, version: "2.1.25" })).toBe(gameDataKeyId(key));
    for (const other of [{ ...key, version: "2.1.26" }, { ...key, build: 87809 }, { ...key, modSettings: null }, { ...key, mods: [{ name: "base", version: "2.1.25" }] }, { ...key, mods: [key.mods[0]!, { name: "odd", version: "1.0.0" }] }]) {
      expect(gameDataKeyId(other)).not.toBe(gameDataKeyId(key));
      expect(sameGameState(key, other)).toBe(false);
    }
    // A key read from the files has no build number, which then does not count.
    const { build: _build, ...fromFiles } = key;
    expect(gameDataKeyId(fromFiles)).not.toBe(gameDataKeyId(key));
    expect(sameGameState(key, fromFiles)).toBe(true);
    expect(sameGameState(fromFiles, { ...fromFiles, version: "2.1.26" })).toBe(false);
  });

  it("reads a key back and refuses a malformed one", () => {
    expect(parseGameDataKey(JSON.parse(JSON.stringify(key)))).toEqual(key);
    for (const bad of [null, {}, { ...key, version: "2.1" }, { ...key, build: -1 }, { ...key, modSettings: "abc" }, { ...key, mods: "none" }, { ...key, mods: [{ name: "", version: null }] }, { ...key, mods: [{ name: "a", version: 1 }] }, { ...key, mods: [key.mods[0], key.mods[0]] }]) {
      expect(() => parseGameDataKey(bad)).toThrow(ValidationError);
    }
  });

  it("says where the data comes from", () => {
    expect(describeGameDataSource({ kind: "built-in", version: "2.1.25" })).toBe("Built in, Factorio 2.1.25");
    const game = { kind: "game", version: "2.1.25", build: 88022, readAt: "2026-11-14T12:00:00.000Z" } as const;
    expect(describeGameDataSource({ ...game, mods: 0 }, () => "<date>")).toBe("Read from your game on <date>: 2.1.25 without mods");
    expect(describeGameDataSource({ ...game, mods: 12 }, () => "<date>")).toBe("Read from your game on <date>: 2.1.25 with 12 mods");
    expect(describeGameDataSource({ ...game, mods: 1 })).toMatch(/^Read from your game on .*2026.*: 2\.1\.25 with 1 mod$/);
  });
});

describe("game data cache", () => {
  async function read(name: string): Promise<GameData> {
    const { options, mods } = await setup(name, { activeMods: { base: "2.1.25", "some-mod": "1.2.3" } });
    await userMods(mods);
    const result = await readGameData(options);
    if (!result.ok) throw new Error(result.message);
    return result.data;
  }

  it("has nothing at first, keeps what is stored, and returns to the built-in data when it is discarded", async () => {
    const cache = new GameDataCache(scratch("cache", "user-data", GAME_DATA_FILE_NAME));
    expect(await cache.load()).toEqual({ status: "none" });
    expect(await cache.discard()).toBe(false);
    const data = await read("cache-source");
    await cache.store(data);
    expect(await readdir(scratch("cache", "user-data"))).toEqual([GAME_DATA_FILE_NAME]);
    const loaded = await new GameDataCache(scratch("cache", "user-data", GAME_DATA_FILE_NAME)).load();
    expect(loaded).toMatchObject({ status: "ok" });
    if (loaded.status !== "ok") return;
    expect(loaded.data).toEqual(data);
    // The icon of the mod's item comes back as the file of the mod it is.
    expect([...loaded.iconTable.icons.keys()]).toEqual(["group/g", "item/gadget", "item/lamp", "item/plate"]);
    expect(loaded.iconTable.icons.get("item/gadget")!.layers).toEqual([{ icon: "__some-mod__/graphics/gadget.png", size: 64 }]);
    expect(describeGameDataSource(gameDataSource(loaded.data), () => "<date>")).toBe("Read from your game on <date>: 2.1.25 with 1 mod");
    expect(await cache.discard()).toBe(true);
    expect(await cache.load()).toEqual({ status: "none" });
    expect(await readdir(scratch("cache", "user-data"))).toEqual([]);
  });

  it("ignores a damaged file and says why, whatever is wrong with it", async () => {
    const file = scratch("damaged-cache", GAME_DATA_FILE_NAME);
    await mkdir(dirname(file), { recursive: true });
    const cache = new GameDataCache(file);
    const data = await read("damaged-cache-source");
    await cache.store(data);
    const stored = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown> & { catalog: Record<string, unknown>; entities: Record<string, unknown>; icons: { icons: Record<string, unknown> }; key: GameDataKey };
    const cases: [string | Uint8Array, RegExp][] = [
      ["", /cannot be used/],
      [(await readFile(file, "utf8")).slice(0, 2000), /cannot be used/],
      [new Uint8Array([0xff, 0xfe, 0x00]), /cannot be used/],
      ["[]", /another format/],
      [JSON.stringify({ ...stored, version: GAME_DATA_FILE_VERSION + 1 }), /another format/],
      [JSON.stringify({ ...stored, version: "1" }), /another format/],
      [JSON.stringify({ ...stored, version: 0 }), /another format/],
      [JSON.stringify({ ...stored, keyId: "0".repeat(64) }), /does not belong to the game it names/],
      [JSON.stringify({ ...stored, key: { ...stored.key, version: "2.1.26" } }), /the tables are of 2\.1\.25, 2\.1\.25, 2\.1\.25, the key is of 2\.1\.26/],
      [JSON.stringify({ ...stored, catalog: { ...stored.catalog, signals: { item: [{ name: "plate" }] } } }), /Catalog data: item signal plate: modules is undefined/],
      [JSON.stringify({ ...stored, icons: { ...stored.icons, icons: { "item/plate": ["__some-mod__/../../secret.png"] } } }), /does not name an image file of the game/],
      [JSON.stringify({ ...stored, entities: { ...stored.entities, entities: [{ name: "lamp", type: "lamp", displayName: "Lamp", width: 0 }] } }), /Entity table: lamp: width is 0/],
      [JSON.stringify({ ...stored, readAt: "yesterday" }), /no time of reading/],
    ];
    for (const [content, message] of cases) {
      await writeFile(file, content);
      const loaded = await cache.load();
      expect(loaded.status, String(message)).toBe("damaged");
      expect(loaded.status === "damaged" ? loaded.message : "").toMatch(message);
      expect(loaded.status === "damaged" ? loaded.message : "").toMatch(/^The data read from your game cannot be used: /);
    }
    // Storing over a damaged file repairs it, and discarding removes it.
    await writeFile(file, "damaged");
    await cache.store(data);
    expect(await cache.load()).toMatchObject({ status: "ok" });
    await writeFile(file, "damaged");
    expect(await cache.discard()).toBe(true);
    expect(await cache.load()).toEqual({ status: "none" });
  });

  it("asks to read the game again for a file of an earlier format, which lacks mods on its records", async () => {
    const file = scratch("outdated-cache", GAME_DATA_FILE_NAME);
    const cache = new GameDataCache(file);
    const data = await read("outdated-cache-source");
    await cache.store(data);
    const stored = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    expect(stored.version).toBe(4);
    expect(GAME_DATA_FILE_VERSION).toBe(4);
    // Whatever else it holds: a file of such a version is not looked into. Versions 2 and 3 have the same fields as this one.
    for (const content of [{ ...stored, version: 1 }, { ...stored, version: 2 }, { ...stored, version: 3 }, { version: 1 }, { ...stored, version: 1, catalog: "damaged" }]) {
      await writeFile(file, JSON.stringify(content));
      expect(await cache.load()).toEqual({ status: "damaged", message: OUTDATED_GAME_DATA });
    }
    expect(OUTDATED_GAME_DATA).toBe("The data read from your game was stored by an earlier version of this app and cannot be used by this one. Read the game again to work with your game's data");
    // It is discarded like a damaged one, and reading the game again replaces it.
    await cache.store(data);
    expect(await cache.load()).toMatchObject({ status: "ok" });
    await writeFile(file, JSON.stringify({ ...stored, version: 1 }));
    expect(await cache.discard()).toBe(true);
    expect(await cache.load()).toEqual({ status: "none" });
  });

  it("stores nothing that would not be accepted when read back", async () => {
    const file = scratch("refusing-cache", GAME_DATA_FILE_NAME);
    const cache = new GameDataCache(file);
    const data = await read("refusing-cache-source");
    await expect(cache.store({ ...data, entities: { schema: 1 } })).rejects.toThrow(/Entity table/);
    await expect(cache.store({ ...data, readAt: "" })).rejects.toThrow(ValidationError);
    expect(await cache.load()).toEqual({ status: "none" });
    expect(() => parseGameData({ ...data, mods: [{ name: "base" }] })).toThrow(/the loaded mods have a malformed entry/);
  });
});

// Local only: the fake game hands out the generator's dump of the full standard game, in front of the real game's data directory.
const DUMP = resolve(import.meta.dirname, "../../../../.runtime/factorio-dump/sets/base+elevated-rails+recycler+quality+space-age/script-output");
const REAL_DATA = "/Applications/factorio.app/Contents/data";
const local = existsSync(join(DUMP, "face-runtime-dump.json")) && existsSync(join(REAL_DATA, "space-age", "info.json")) && (JSON.parse(await readFile(join(REAL_DATA, "base", "info.json"), "utf8")) as { version: string }).version === STANDARD_CATALOG_VERSION;

describe.skipIf(!local)("readGameData with the dump of the standard game", () => {
  it("builds the tables of the standard game with all its modules, within the limits", async () => {
    const root = scratch("standard", "factorio.app", "Contents");
    await mkdir(join(root, "MacOS"), { recursive: true });
    await symlink(REAL_DATA, join(root, "data"));
    const dump = scratch("standard", "dump");
    await cp(DUMP, dump, { recursive: true });
    const control: FakeGameControl = { record: scratch("standard", "record.jsonl"), dump };
    await writeFakeGame(join(root, "MacOS", "factorio"), control);
    const inspection = await inspectDataDirectory(join(root, "data"), STANDARD_CATALOG_VERSION);
    if (!inspection.ok) throw new Error(inspection.message);
    const result = await readGameData({ installation: inspection.installation, host: { platform: "darwin", env: {}, home: scratch("standard", "home") }, confirmedExecutable: join(root, "MacOS", "factorio"), runsDirectory: scratch("standard", "runs"), scenarioSource: "-- scenario\n", generator: "face test", sandbox: "off" });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    if (!result.ok) return;
    const enabled = ["base", "elevated-rails", "recycler", "quality", "space-age"];
    expect(result.data.mods.map((mod) => mod.name)).toEqual(enabled);
    expect(result.data.catalog.modules).toEqual(loadStandardCatalog().modules);
    expect(availableSignals(createCatalog(result.data.catalog), enabled).map((signal) => signal.key)).toEqual(availableSignals(loadStandardCatalog(), enabled).map((signal) => signal.key));
    // What the tables say is compared with the standard ones in tools/catalog/lib/single.test.ts; here it is the way through the app.
    expect(result.iconTable.icons.size).toBeGreaterThan(1000);
    expect(result.data.skippedIcons).toBe(0);
    expect(parseEntityTable(result.data.entities).entities.map((entity) => entity.name)).toEqual(STANDARD_ENTITY_TABLE.entities.map((entity) => entity.name));
    const cache = new GameDataCache(scratch("standard", GAME_DATA_FILE_NAME));
    await cache.store(result.data);
    expect(await cache.load()).toMatchObject({ status: "ok", data: { key: result.data.key } });
  }, 60_000);
});
