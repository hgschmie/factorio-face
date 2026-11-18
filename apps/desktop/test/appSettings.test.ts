import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SETTINGS_FILE_NAME, AppSettingsStore, gameDirectoryFromEnv, gameDirectorySource, locateGame } from "../src/appSettings.ts";
import type { Host } from "../src/gameInstallation.ts";
import { LIMITS } from "../src/ipc.ts";
import { ValidationError } from "../src/validation.ts";
import { writeGameData } from "./support/fakeGame.ts";
import { useScratch } from "./support/scratch.ts";

const scratch = useScratch("app-settings");
const CATALOG = "2.1.25";
const DEFAULTS = { gameDirectory: null, hidden: [] };

describe("settings file", () => {
  it("reads as the defaults when the file is missing", async () => {
    const store = new AppSettingsStore(scratch("missing", APP_SETTINGS_FILE_NAME));
    expect(await store.get()).toEqual(DEFAULTS);
    expect(await readdir(scratch()).then((names) => names.includes("missing"))).toBe(false);
  });

  it.each([
    ["no JSON", "{ gameDirectory"],
    ["an empty file", ""],
    ["a list", "[]"],
    ["null", "null"],
    ["another version", JSON.stringify({ version: 2, gameDirectory: "/games/factorio" })],
    ["no version", JSON.stringify({ gameDirectory: "/games/factorio" })],
    ["a relative folder", JSON.stringify({ version: 1, gameDirectory: "games/factorio" })],
    ["a folder that is not normalized", JSON.stringify({ version: 1, gameDirectory: "/games/../factorio" })],
    ["a folder that is no text", JSON.stringify({ version: 1, gameDirectory: 42 })],
    ["an empty folder name", JSON.stringify({ version: 1, gameDirectory: "" })],
  ])("reads as the defaults when the file holds %s", async (name, content) => {
    const file = scratch(`tolerant-${name.replaceAll(" ", "-")}.json`);
    await writeFile(file, content);
    expect(await new AppSettingsStore(file).get()).toEqual(DEFAULTS);
  });

  it("keeps a chosen folder and ignores fields it does not know", async () => {
    const file = scratch("known.json");
    await writeFile(file, JSON.stringify({ version: 1, gameDirectory: "/Applications/factorio.app", theme: "dark" }));
    expect(await new AppSettingsStore(file).get()).toEqual({ gameDirectory: "/Applications/factorio.app", hidden: [] });
  });

  it("writes the choice as a whole file and reads it back", async () => {
    const directory = scratch("profile", "nested");
    const file = join(directory, APP_SETTINGS_FILE_NAME);
    const store = new AppSettingsStore(file);
    expect(await store.setGameDirectory("/Applications/factorio.app")).toEqual({ gameDirectory: "/Applications/factorio.app", hidden: [] });
    expect(await readFile(file, "utf8")).toBe('{\n  "version": 1,\n  "gameDirectory": "/Applications/factorio.app"\n}\n');
    expect(await store.get()).toEqual({ gameDirectory: "/Applications/factorio.app", hidden: [] });
    expect(await new AppSettingsStore(file).get()).toEqual({ gameDirectory: "/Applications/factorio.app", hidden: [] });
    await store.setGameDirectory(null);
    expect(await readFile(file, "utf8")).toBe('{\n  "version": 1,\n  "gameDirectory": null\n}\n');
    expect(await new AppSettingsStore(file).get()).toEqual(DEFAULTS);
    // The temporary file of the atomic write is gone.
    expect(await readdir(directory)).toEqual([APP_SETTINGS_FILE_NAME]);
  });

  it("refuses a folder that is not an absolute, normalized path and leaves the file alone", async () => {
    const file = scratch("refused.json");
    const store = new AppSettingsStore(file);
    await store.setGameDirectory("/games/factorio");
    for (const folder of ["games/factorio", "/games/../factorio", "", "/games/fac\0torio"]) await expect(store.setGameDirectory(folder)).rejects.toThrow(ValidationError);
    await expect(store.setGameDirectory(42 as unknown as string)).rejects.toThrow(ValidationError);
    expect(await store.get()).toEqual({ gameDirectory: "/games/factorio", hidden: [] });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, gameDirectory: "/games/factorio" });
  });

  it("keeps the previous settings when the file cannot be written", async () => {
    await writeFile(scratch("blocker"), "a file where the folder should be");
    const store = new AppSettingsStore(scratch("blocker", APP_SETTINGS_FILE_NAME));
    await expect(store.setGameDirectory("/games/factorio")).rejects.toThrow();
    expect(await store.get()).toEqual(DEFAULTS);
  });
});

describe("hidden signals and entities in the settings file", () => {
  const BASE = { module: "base", signals: ["item:wooden-chest", "virtual:signal-A"], entities: ["wooden-chest"] };
  const MOD = { module: "some-mod", signals: [], entities: ["mod-crate"] };
  const stored = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));

  it("stores what is hidden per module, beside the game folder, and reads it back", async () => {
    const file = scratch("hidden", APP_SETTINGS_FILE_NAME);
    const store = new AppSettingsStore(file);
    expect((await store.setHiddenItems(BASE)).hidden).toEqual([BASE]);
    expect(await store.setHiddenItems(MOD)).toEqual({ gameDirectory: null, hidden: [BASE, MOD] });
    expect(await stored(file)).toEqual({ version: 1, gameDirectory: null, hidden: [BASE, MOD] });
    // The game folder and what is hidden do not touch each other.
    await store.setGameDirectory("/games/factorio");
    expect(await stored(file)).toEqual({ version: 1, gameDirectory: "/games/factorio", hidden: [BASE, MOD] });
    expect(await new AppSettingsStore(file).get()).toEqual({ gameDirectory: "/games/factorio", hidden: [BASE, MOD] });
    expect(await readdir(scratch("hidden"))).toEqual([APP_SETTINGS_FILE_NAME]);
  });

  it("replaces the entry of the one module, in its place, and drops an entry that hides nothing", async () => {
    const file = scratch("replace.json");
    const store = new AppSettingsStore(file);
    await store.setHiddenItems(BASE);
    await store.setHiddenItems(MOD);
    const fewer = { module: "base", signals: ["virtual:signal-A"], entities: [] };
    expect((await store.setHiddenItems(fewer)).hidden).toEqual([fewer, MOD]);
    expect((await store.setHiddenItems({ module: "base", signals: [], entities: [] })).hidden).toEqual([MOD]);
    // Nothing is stored for a module with nothing hidden, and no list when nothing is hidden at all.
    expect((await store.setHiddenItems({ module: "never-hidden", signals: [], entities: [] })).hidden).toEqual([MOD]);
    await store.setHiddenItems({ module: MOD.module, signals: [], entities: [] });
    expect(await stored(file)).toEqual({ version: 1, gameDirectory: null });
  });

  it("keeps the entries of modules it knows nothing about", async () => {
    const file = scratch("unknown-modules.json");
    const absent = { module: "a-mod-that-is-not-installed-today", signals: ["item:its-thing"], entities: ["its-machine"] };
    await writeFile(file, JSON.stringify({ version: 1, gameDirectory: null, hidden: [absent] }));
    const store = new AppSettingsStore(file);
    expect((await store.get()).hidden).toEqual([absent]);
    await store.setHiddenItems(BASE);
    await store.setGameDirectory("/games/factorio");
    expect(await stored(file)).toEqual({ version: 1, gameDirectory: "/games/factorio", hidden: [absent, BASE] });
  });

  it("drops the malformed parts of the file and keeps the rest", async () => {
    const file = scratch("damaged-hidden.json");
    const hidden = [
      BASE,
      "no entry",
      null,
      { module: "", signals: ["item:a"], entities: [] },
      { module: 7, signals: ["item:a"], entities: [] },
      { module: "base", signals: ["item:twice"], entities: [] },
      { module: "partly", signals: ["item:kept", "no-kind", "nonsense:name", "item:", 5, "item:kept", "item:line\nbreak", `item:${"x".repeat(LIMITS.hiddenItemLength)}`], entities: "none" },
      { module: "empty", signals: [], entities: [] },
      { module: "entities", entities: ["crate", "", null, "crate", "x".repeat(LIMITS.hiddenItemLength + 1)] },
    ];
    await writeFile(file, JSON.stringify({ version: 1, gameDirectory: "not/absolute", hidden }));
    expect(await new AppSettingsStore(file).get()).toEqual({ gameDirectory: null, hidden: [BASE, { module: "partly", signals: ["item:kept"], entities: [] }, { module: "entities", signals: [], entities: ["crate"] }] });
    // A list that is no list reads as nothing hidden, and the folder beside it is kept.
    await writeFile(file, JSON.stringify({ version: 1, gameDirectory: "/games/factorio", hidden: { base: BASE } }));
    expect(await new AppSettingsStore(file).get()).toEqual({ gameDirectory: "/games/factorio", hidden: [] });
  });

  it("refuses a request that is malformed or out of bounds and leaves the file alone", async () => {
    const file = scratch("refused-hidden.json");
    const store = new AppSettingsStore(file);
    await store.setHiddenItems(BASE);
    const refused: unknown[] = [
      undefined,
      null,
      "base",
      [BASE],
      { signals: [], entities: [] },
      { module: "", signals: [], entities: [] },
      { module: "x".repeat(LIMITS.identifierLength + 1), signals: [], entities: [] },
      { module: "base", signals: "item:a", entities: [] },
      { module: "base", signals: [], entities: undefined },
      { module: "base", signals: ["wooden-chest"], entities: [] },
      { module: "base", signals: ["nonsense:wooden-chest"], entities: [] },
      { module: "base", signals: [42], entities: [] },
      { module: "base", signals: [], entities: [""] },
      { module: "base", signals: [], entities: ["a\u0000b"] },
      { module: "base", signals: [], entities: ["x".repeat(LIMITS.hiddenItemLength + 1)] },
      { module: "base", signals: [], entities: Array.from({ length: LIMITS.hiddenItems + 1 }, (_, index) => `e${index}`) },
    ];
    for (const value of refused) await expect(store.setHiddenItems(value), JSON.stringify(value)?.slice(0, 80)).rejects.toThrow(ValidationError);
    expect((await store.get()).hidden).toEqual([BASE]);
    expect(await stored(file)).toEqual({ version: 1, gameDirectory: null, hidden: [BASE] });
  });

  it("bounds what all modules hide together", async () => {
    const store = new AppSettingsStore(scratch("bounds.json"));
    const many = (module: string, count: number) => ({ module, signals: [], entities: Array.from({ length: count }, (_, index) => `e${index}`) });
    await store.setHiddenItems(many("first", LIMITS.hiddenItems - 1));
    await store.setHiddenItems(many("second", 1));
    await expect(store.setHiddenItems(many("third", 1))).rejects.toThrow(/Too many hidden signals and entities/);
    // Fewer of a module that is there fit.
    expect((await store.setHiddenItems(many("first", 2))).hidden.map((entry) => [entry.module, entry.entities.length])).toEqual([["first", 2], ["second", 1]]);
  });

  it("names a signal or an entity once and takes only the fields it knows", async () => {
    const store = new AppSettingsStore(scratch("once.json"));
    const settings = await store.setHiddenItems({ module: "base", signals: ["item:a", "item:b", "item:a"], entities: ["x", "x"], comment: "ignored" });
    expect(settings.hidden).toEqual([{ module: "base", signals: ["item:a", "item:b"], entities: ["x"] }]);
  });

  it("writes changes one after the other, so that none is lost", async () => {
    const file = scratch("queue.json");
    const store = new AppSettingsStore(file);
    const modules = Array.from({ length: 8 }, (_, index) => ({ module: `mod-${index}`, signals: [`item:thing-${index}`], entities: [] }));
    await Promise.all([...modules.map((entry) => store.setHiddenItems(entry)), store.setGameDirectory("/games/factorio")]);
    expect(await stored(file)).toEqual({ version: 1, gameDirectory: "/games/factorio", hidden: modules });
    // A change that is refused does not hold up the ones behind it.
    const [bad, good] = await Promise.allSettled([store.setHiddenItems({ module: "" }), store.setHiddenItems({ module: "mod-0", signals: [], entities: [] })]);
    expect([bad.status, good.status]).toEqual(["rejected", "fulfilled"]);
    expect((await store.get()).hidden).toEqual(modules.slice(1));
  });

  it("keeps the previous settings when the file cannot be written", async () => {
    await writeFile(scratch("hidden-blocker"), "a file where the folder should be");
    const store = new AppSettingsStore(scratch("hidden-blocker", APP_SETTINGS_FILE_NAME));
    await expect(store.setHiddenItems(BASE)).rejects.toThrow();
    expect(await store.get()).toEqual(DEFAULTS);
  });
});

describe("where to look for the game", () => {
  it("reads FACE_GAME_DIR like the other path variables", () => {
    expect(gameDirectoryFromEnv({})).toBeUndefined();
    expect(gameDirectoryFromEnv({ FACE_GAME_DIR: "" })).toBeUndefined();
    expect(gameDirectoryFromEnv({ FACE_GAME_DIR: "/games/x/../factorio" })).toBe("/games/factorio");
    expect(() => gameDirectoryFromEnv({ FACE_GAME_DIR: "games/factorio" })).toThrow(/absolute/);
  });

  it("lets a stored choice win, then FACE_GAME_DIR, then the usual places", () => {
    expect(gameDirectorySource({ gameDirectory: "/chosen" }, {})).toEqual({ kind: "chosen", folder: "/chosen" });
    expect(gameDirectorySource({ gameDirectory: "/chosen" }, { FACE_GAME_DIR: "/from-env" })).toEqual({ kind: "chosen", folder: "/chosen" });
    expect(gameDirectorySource({ gameDirectory: null }, { FACE_GAME_DIR: "/from-env" })).toEqual({ kind: "detect", folders: ["/from-env"] });
    expect(gameDirectorySource({ gameDirectory: null }, {})).toEqual({ kind: "detect" });
  });
});

describe("the installation in use", () => {
  const host = (home: string, env: Host["env"] = {}): Host => ({ platform: "linux", env, home });

  it("uses the chosen folder", async () => {
    const data = await writeGameData(scratch("chosen/factorio/data"));
    const elsewhere = await writeGameData(scratch("chosen/elsewhere/data"), { version: "2.1.30" });
    const location = await locateGame({ gameDirectory: scratch("chosen/factorio") }, host(scratch("chosen/home"), { FACE_GAME_DIR: elsewhere }), CATALOG);
    expect(location).toMatchObject({ status: "chosen", folder: scratch("chosen/factorio"), installation: { dataDirectory: data, version: "2.1.25", versionMatch: "equal" } });
  });

  it("reports a chosen folder that has vanished and does not switch to another installation", async () => {
    const home = scratch("vanished/home");
    const found = await writeGameData(join(home, "factorio/data"));
    const override = await writeGameData(scratch("vanished/override/data"));
    const chosen = scratch("vanished/volume/factorio");
    await writeGameData(join(chosen, "data"));
    const settings = { gameDirectory: chosen };
    expect(await locateGame(settings, host(home, { FACE_GAME_DIR: override }), CATALOG)).toMatchObject({ status: "chosen" });
    await rm(scratch("vanished/volume"), { recursive: true });
    const unusable = { status: "chosen-unusable", folder: chosen, problem: "not-found", message: `This folder does not exist or cannot be read: ${chosen}` };
    expect(await locateGame(settings, host(home, { FACE_GAME_DIR: override }), CATALOG)).toEqual(unusable);
    expect(await locateGame(settings, host(home), CATALOG)).toMatchObject({ status: "chosen-unusable", folder: chosen });
    // Only without a choice does the app look around.
    expect(await locateGame({ gameDirectory: null }, host(home), CATALOG)).toMatchObject({ status: "detected", installation: { dataDirectory: found } });
  });

  it("reports a chosen folder that holds the data without images", async () => {
    const data = await writeGameData(scratch("data-only/factorio-data"), { images: false });
    expect(await locateGame({ gameDirectory: data }, host(scratch("data-only/home")), CATALOG)).toMatchObject({ status: "chosen-unusable", folder: data, problem: "no-images" });
  });

  it("looks only at FACE_GAME_DIR when it is set", async () => {
    const home = scratch("override/home");
    await writeGameData(join(home, "factorio/data"));
    const override = await writeGameData(scratch("override/game/data"), { version: "2.0.72" });
    expect(await locateGame({ gameDirectory: null }, host(home, { FACE_GAME_DIR: scratch("override/game") }), CATALOG)).toEqual({
      status: "detected",
      installation: { dataDirectory: override, version: "2.0.72", versionMatch: "different", modules: expect.any(Array) as unknown },
    });
    await mkdir(scratch("override/nothing"));
    expect(await locateGame({ gameDirectory: null }, host(home, { FACE_GAME_DIR: scratch("override/nothing") }), CATALOG)).toEqual({ status: "none" });
    expect(await locateGame({ gameDirectory: null }, host(scratch("override/no-home")), CATALOG)).toEqual({ status: "none" });
  });
});
