import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SETTINGS_FILE_NAME, AppSettingsStore, gameDirectoryFromEnv, gameDirectorySource, locateGame } from "../src/appSettings.ts";
import type { Host } from "../src/gameInstallation.ts";
import { ValidationError } from "../src/validation.ts";
import { writeGameData } from "./support/fakeGame.ts";
import { useScratch } from "./support/scratch.ts";

const scratch = useScratch("app-settings");
const CATALOG = "2.1.24";

describe("settings file", () => {
  it("reads as the defaults when the file is missing", async () => {
    const store = new AppSettingsStore(scratch("missing", APP_SETTINGS_FILE_NAME));
    expect(await store.get()).toEqual({ gameDirectory: null });
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
    expect(await new AppSettingsStore(file).get()).toEqual({ gameDirectory: null });
  });

  it("keeps a chosen folder and ignores fields it does not know", async () => {
    const file = scratch("known.json");
    await writeFile(file, JSON.stringify({ version: 1, gameDirectory: "/Applications/factorio.app", theme: "dark" }));
    expect(await new AppSettingsStore(file).get()).toEqual({ gameDirectory: "/Applications/factorio.app" });
  });

  it("writes the choice as a whole file and reads it back", async () => {
    const directory = scratch("profile", "nested");
    const file = join(directory, APP_SETTINGS_FILE_NAME);
    const store = new AppSettingsStore(file);
    expect(await store.setGameDirectory("/Applications/factorio.app")).toEqual({ gameDirectory: "/Applications/factorio.app" });
    expect(await readFile(file, "utf8")).toBe('{\n  "version": 1,\n  "gameDirectory": "/Applications/factorio.app"\n}\n');
    expect(await store.get()).toEqual({ gameDirectory: "/Applications/factorio.app" });
    expect(await new AppSettingsStore(file).get()).toEqual({ gameDirectory: "/Applications/factorio.app" });
    await store.setGameDirectory(null);
    expect(await readFile(file, "utf8")).toBe('{\n  "version": 1,\n  "gameDirectory": null\n}\n');
    expect(await new AppSettingsStore(file).get()).toEqual({ gameDirectory: null });
    // The temporary file of the atomic write is gone.
    expect(await readdir(directory)).toEqual([APP_SETTINGS_FILE_NAME]);
  });

  it("refuses a folder that is not an absolute, normalized path and leaves the file alone", async () => {
    const file = scratch("refused.json");
    const store = new AppSettingsStore(file);
    await store.setGameDirectory("/games/factorio");
    for (const folder of ["games/factorio", "/games/../factorio", "", "/games/fac\0torio"]) await expect(store.setGameDirectory(folder)).rejects.toThrow(ValidationError);
    await expect(store.setGameDirectory(42 as unknown as string)).rejects.toThrow(ValidationError);
    expect(await store.get()).toEqual({ gameDirectory: "/games/factorio" });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, gameDirectory: "/games/factorio" });
  });

  it("keeps the previous settings when the file cannot be written", async () => {
    await writeFile(scratch("blocker"), "a file where the folder should be");
    const store = new AppSettingsStore(scratch("blocker", APP_SETTINGS_FILE_NAME));
    await expect(store.setGameDirectory("/games/factorio")).rejects.toThrow();
    expect(await store.get()).toEqual({ gameDirectory: null });
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
    expect(location).toMatchObject({ status: "chosen", folder: scratch("chosen/factorio"), installation: { dataDirectory: data, version: "2.1.24", versionMatch: "equal" } });
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
