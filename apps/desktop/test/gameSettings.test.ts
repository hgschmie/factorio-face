// The game installation in use while the app runs: found at start, changed through the chooser, reset to auto-detection,
// and what the renderer is told about it.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SETTINGS_FILE_NAME, AppSettingsStore, type GameLocation } from "../src/appSettings.ts";
import type { GameInstallation, Host } from "../src/gameInstallation.ts";
import { appSettingsState, gameFolderDialogOptions, GameSettings } from "../src/gameSettings.ts";
import type { AppSettingsState } from "../src/ipc.ts";
import { ValidationError } from "../src/validation.ts";
import { writeGameData } from "./support/fakeGame.ts";
import { useScratch } from "./support/scratch.ts";

const scratch = useScratch("game-settings");
const CATALOG = "2.1.24";
const ALL_MODULES = ["base", "core", "space-age", "quality", "elevated-rails", "recycler"];
const present = (...missing: string[]) => ALL_MODULES.map((name) => ({ name, present: !missing.includes(name) }));
const NO_GAME = { chosenFolder: null, dataDirectory: null, source: "none", gameVersion: null, versionMatch: null, modules: [], problem: null } as const;
const NONE: AppSettingsState = { ...NO_GAME, catalogVersion: CATALOG, iconRevision: 0 };

interface Setup {
  readonly settings: GameSettings;
  readonly store: AppSettingsStore;
  readonly file: string;
  /** The data directories the icons were pointed at, in order. */
  readonly resets: (string | undefined)[];
  readonly changes: AppSettingsState[];
}

/** Settings with a profile of their own in `name`; auto-detection looks only at `detect` (FACE_GAME_DIR) when given, and finds nothing otherwise. */
function setup(name: string, detect?: string): Setup {
  const file = scratch(name, "profile", APP_SETTINGS_FILE_NAME);
  const store = new AppSettingsStore(file);
  const resets: (string | undefined)[] = [];
  const changes: AppSettingsState[] = [];
  const host: Host = { platform: "linux", env: { FACE_GAME_DIR: detect ?? scratch(name, "no-game") }, home: scratch(name, "home") };
  const settings = new GameSettings({ store, icons: { reset: (dataDirectory) => void resets.push(dataDirectory) }, host, catalogVersion: CATALOG, onChange: (state) => void changes.push(state) });
  return { settings, store, file, resets, changes };
}

const stored = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));

describe("what the renderer is told", () => {
  const installed = [{ name: "base", version: "2.1.30" }, { name: "core" }, { name: "quality", version: "2.1.30" }] as const;
  const installation: GameInstallation = { dataDirectory: "/games/factorio/data", version: "2.1.30", versionMatch: "same-minor", modules: installed };
  const facts = { dataDirectory: installation.dataDirectory, gameVersion: "2.1.30", versionMatch: "same-minor", modules: present("space-age", "elevated-rails", "recycler") } as const;
  const gone = "This folder does not exist or cannot be read: /gone";

  it.each<[string, GameLocation, Partial<AppSettingsState>]>([
    ["nothing found", { status: "none" }, {}],
    ["an installation found", { status: "detected", installation }, { ...facts, source: "detected" }],
    ["a chosen installation", { status: "chosen", folder: "/games/factorio", installation }, { ...facts, chosenFolder: "/games/factorio", source: "chosen" }],
    ["a chosen folder that cannot be used", { status: "chosen-unusable", folder: "/gone", problem: "not-found", message: gone }, { chosenFolder: "/gone", source: "chosen", problem: gone }],
  ])("for %s", (_name, location, expected) => {
    expect(appSettingsState(location, CATALOG, 3)).toEqual({ ...NONE, iconRevision: 3, ...expected });
  });
});

describe("the folder chooser", () => {
  it("offers the application bundle as well as folders on macOS", () => {
    const options = gameFolderDialogOptions("darwin", null);
    expect(options.properties).toEqual(["openFile", "openDirectory"]);
    expect(options.filters).toEqual([{ name: "Applications", extensions: ["app"] }]);
    expect(options.defaultPath).toBe("/Applications");
    expect(gameFolderDialogOptions("darwin", "/Volumes/Games/factorio.app").defaultPath).toBe("/Volumes/Games/factorio.app");
  });

  it.each(["linux", "win32"] as const)("offers folders on %s", (platform) => {
    const options = gameFolderDialogOptions(platform, null);
    expect(options.properties).toEqual(["openDirectory"]);
    expect(options.filters).toBeUndefined();
    expect(options.defaultPath).toBeUndefined();
    expect(gameFolderDialogOptions(platform, "/opt/factorio").defaultPath).toBe("/opt/factorio");
  });

  it("never lets the user create or pick several folders", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      for (const property of ["multiSelections", "createDirectory", "promptToCreate"] as const) expect(gameFolderDialogOptions(platform, null).properties).not.toContain(property);
    }
  });
});

describe("at start", () => {
  it("finds nothing without a game, with revision 0 and without an event", async () => {
    const { settings, resets, changes } = setup("start-none");
    expect(await settings.state()).toEqual(NONE);
    expect([resets, changes]).toEqual([[undefined], []]);
  });

  it("finds the game by itself and points the icons at it before it is ready", async () => {
    const data = await writeGameData(scratch("start-found/game/data"), { modules: ["quality"] });
    const { settings, resets, changes, file } = setup("start-found", scratch("start-found/game"));
    expect(resets).toEqual([]);
    await settings.ready();
    expect(resets).toEqual([data]);
    const modules = present("space-age", "elevated-rails", "recycler");
    expect(await settings.state()).toEqual({ ...NONE, dataDirectory: data, source: "detected", gameVersion: "2.1.24", versionMatch: "equal", modules });
    expect(changes).toEqual([]);
    // Looking for the game writes nothing.
    await expect(readFile(file)).rejects.toThrow();
  });

  it("keeps a chosen folder that has vanished and reports why, instead of using another installation", async () => {
    await writeGameData(scratch("start-vanished/other/data"));
    const { store } = setup("start-vanished");
    await store.setGameDirectory(scratch("start-vanished/volume/factorio"));
    const { settings, resets } = setup("start-vanished", scratch("start-vanished/other"));
    const folder = scratch("start-vanished/volume/factorio");
    expect(await settings.state()).toEqual({ ...NONE, chosenFolder: folder, source: "chosen", problem: `This folder does not exist or cannot be read: ${folder}` });
    expect(resets).toEqual([undefined]);
  });

  it("reports a damaged settings file as no choice", async () => {
    const { store, file } = setup("start-damaged");
    await store.setGameDirectory("/games/factorio");
    await writeFile(file, '{ "version": 1, "gameDirectory": "../../etc" }');
    expect(await setup("start-damaged").settings.state()).toEqual(NONE);
  });
});

describe("choosing a folder", () => {
  it("stores it, points the icons at it and tells the renderer once, with the next revision", async () => {
    const data = await writeGameData(scratch("choose/game/data"), { version: "2.0.72" });
    const { settings, resets, changes, file } = setup("choose");
    const chosenFolder = scratch("choose/game");
    const expected: AppSettingsState = { ...NONE, chosenFolder, dataDirectory: data, source: "chosen", gameVersion: "2.0.72", versionMatch: "different", modules: present(), iconRevision: 1 };
    expect(await settings.choose(scratch("choose/game"))).toEqual(expected);
    expect(await settings.state()).toEqual(expected);
    expect([resets, changes]).toEqual([[undefined, data], [expected]]);
    expect(await stored(file)).toEqual({ version: 1, gameDirectory: scratch("choose/game") });

    // The same profile later: the choice is still there, as the installation of the start.
    const again = setup("choose");
    expect(await again.settings.state()).toEqual({ ...expected, iconRevision: 0 });
  });

  it.each([
    ["the data directory", "game/data"],
    ["the folder around an application bundle", "bundle"],
    ["the application bundle", "bundle/factorio.app"],
  ])("accepts %s", async (_name, folder) => {
    const data = await writeGameData(scratch("accept/game/data"));
    const bundled = await writeGameData(scratch("accept/bundle/factorio.app/Contents/data"));
    const { settings } = setup(`accept-${folder.replaceAll("/", "-")}`);
    const state = await settings.choose(scratch("accept", folder));
    expect([state.chosenFolder, state.dataDirectory]).toEqual([scratch("accept", folder), folder.startsWith("bundle") ? bundled : data]);
  });

  it("refuses a folder without the game with its reason, and stores nothing", async () => {
    const data = await writeGameData(scratch("refuse/game/data"));
    await writeGameData(scratch("refuse/headless/data"), { images: false });
    await mkdir(scratch("refuse/empty"));
    const { settings, resets, changes, file } = setup("refuse", scratch("refuse/game"));
    const before = await settings.state();
    const refused: [unknown, string][] = [
      [scratch("refuse/empty"), `This folder does not contain the game's data: ${scratch("refuse/empty")}`],
      [scratch("refuse/nowhere"), `This folder does not exist or cannot be read: ${scratch("refuse/nowhere")}`],
      [scratch("refuse/headless"), `This folder has the game's data but no images (a headless build, or a copy of the data alone): ${scratch("refuse/headless/data")}`],
      ["relative/folder", "Game folder must be absolute"],
      [`${scratch("refuse/game")}/../game`, "Game folder must be normalized"],
      [42, "Game folder must be a non-empty string"],
    ];
    for (const [folder, message] of refused) {
      const failure = await settings.choose(folder).catch((error: unknown) => error);
      expect(failure, String(folder)).toBeInstanceOf(ValidationError);
      expect((failure as Error).message).toBe(message);
    }
    expect(await settings.state()).toEqual(before);
    expect([resets, changes]).toEqual([[data], []]);
    await expect(readFile(file)).rejects.toThrow();
  });

  it("keeps the installation in use when the choice cannot be written", async () => {
    const data = await writeGameData(scratch("unwritable/game/data"));
    const { settings, file, changes } = setup("unwritable", scratch("unwritable/game"));
    await settings.ready();
    // A file where the profile folder should be.
    await mkdir(scratch("unwritable"), { recursive: true });
    await writeFile(scratch("unwritable/profile"), "in the way");
    await expect(settings.choose(scratch("unwritable/game"))).rejects.toThrow();
    expect(await settings.state()).toMatchObject({ chosenFolder: null, dataDirectory: data, iconRevision: 0 });
    expect(changes).toEqual([]);
    await expect(readFile(file)).rejects.toThrow();
  });
});

describe("the native chooser", () => {
  it("is asked with the current state and its answer becomes the choice", async () => {
    const data = await writeGameData(scratch("ask/game/data"));
    const { settings } = setup("ask");
    const asked: AppSettingsState[] = [];
    const state = await settings.chooseWith(async (current) => (asked.push(current), scratch("ask/game")));
    expect(asked).toEqual([NONE]);
    expect(state).toMatchObject({ chosenFolder: scratch("ask/game"), dataDirectory: data, iconRevision: 1 });
  });

  it("changes nothing when it is cancelled", async () => {
    const { settings, changes, file } = setup("cancel");
    expect(await settings.chooseWith(async () => undefined)).toBeNull();
    expect(changes).toEqual([]);
    await expect(readFile(file)).rejects.toThrow();
  });

  it("is open once: a second request is ignored until the first has ended", async () => {
    await writeGameData(scratch("twice/game/data"));
    const { settings } = setup("twice");
    let answer = (_folder: string | undefined): void => undefined;
    let opened = 0;
    const ask = (): Promise<string | undefined> => (opened++, new Promise((resolve) => (answer = resolve)));
    const first = settings.chooseWith(ask);
    await settings.ready();
    expect(await settings.chooseWith(ask)).toBeNull();
    expect(opened).toBe(1);
    answer(scratch("twice/game"));
    expect(await first).toMatchObject({ chosenFolder: scratch("twice/game") });
    // Afterwards it opens again, also after a choice that was refused.
    const refused = settings.chooseWith(ask);
    await Promise.resolve();
    await Promise.resolve();
    answer(scratch("twice/nowhere"));
    await expect(refused).rejects.toThrow(ValidationError);
    const third = settings.chooseWith(ask);
    await Promise.resolve();
    await Promise.resolve();
    answer(undefined);
    expect(await third).toBeNull();
    expect(opened).toBe(3);
  });
});

describe("resetting to auto-detection", () => {
  it("forgets the choice and uses what the app finds", async () => {
    const found = await writeGameData(scratch("reset/found/data"));
    const chosen = await writeGameData(scratch("reset/chosen/data"), { version: "2.1.30" });
    const { settings, resets, changes, file } = setup("reset", scratch("reset/found"));
    await settings.choose(scratch("reset/chosen"));
    const state = await settings.reset();
    expect(state).toEqual({ ...NONE, dataDirectory: found, source: "detected", gameVersion: "2.1.24", versionMatch: "equal", modules: present(), iconRevision: 2 });
    expect(resets).toEqual([found, chosen, found]);
    expect(changes.map((change) => [change.source, change.iconRevision])).toEqual([["chosen", 1], ["detected", 2]]);
    expect(await stored(file)).toEqual({ version: 1, gameDirectory: null });
  });

  it("gets rid of a chosen folder that has vanished", async () => {
    await writeGameData(scratch("reset-vanished/volume/factorio/data"));
    const { settings } = setup("reset-vanished");
    await settings.choose(scratch("reset-vanished/volume/factorio"));
    await rm(scratch("reset-vanished/volume"), { recursive: true });
    // Looked at again, the choice is still the choice, with its problem.
    const { settings: later } = setup("reset-vanished");
    expect(await later.state()).toMatchObject({ source: "chosen", dataDirectory: null, problem: expect.stringContaining("does not exist") as unknown });
    expect(await later.reset()).toEqual({ ...NONE, iconRevision: 1 });
  });

  it("applies changes one after the other", async () => {
    const first = await writeGameData(scratch("order/first/data"));
    const second = await writeGameData(scratch("order/second/data"));
    const { settings, resets, changes } = setup("order");
    const results = await Promise.all([settings.choose(scratch("order/first")), settings.choose(scratch("order/second")), settings.reset(), settings.choose(join(scratch("order/first"), "data"))]);
    expect(results.map((state) => [state.dataDirectory, state.iconRevision])).toEqual([[first, 1], [second, 2], [null, 3], [first, 4]]);
    expect(resets).toEqual([undefined, first, second, undefined, first]);
    expect(changes).toEqual(results);
  });
});
