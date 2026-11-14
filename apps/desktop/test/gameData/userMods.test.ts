import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GameModule, Host } from "../../src/gameInstallation.ts";
import {
  buildPrivateModDirectory, enabledMods, iniValue, locateUserData, readUserMods, removePrivateModDirectory, systemWriteData, watchedUserFiles, MOD_LIST_FILE, MOD_SETTINGS_FILE,
} from "../../src/gameData/userMods.ts";
import { useScratch } from "../support/scratch.ts";
import { treeSnapshot } from "../support/treeSnapshot.ts";

const scratch = useScratch("user-mods");

async function write(file: string, content: string | Uint8Array): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

const GAME_MODULES: GameModule[] = [{ name: "core" }, { name: "base", version: "2.1.24" }, { name: "quality", version: "2.1.24" }, { name: "space-age", version: "2.1.24" }];
const modList = (mods: object[]): string => JSON.stringify({ mods }, null, 2);

/** A mod directory as a player has it: archives in several versions, a mod under development as a link, a disabled mod, the two files the game rewrites. */
async function playerMods(root: string): Promise<string> {
  const mods = join(root, "mods");
  await write(join(mods, MOD_LIST_FILE), modList([
    { name: "base", enabled: true }, { name: "quality", enabled: false }, { name: "space-age", enabled: true },
    { name: "alpha", enabled: true }, { name: "beta", enabled: false }, { name: "pinned", enabled: true, version: "1.0.0" }, { name: "gone", enabled: true }, { name: "dev-mod", enabled: true },
  ]));
  await write(join(mods, MOD_SETTINGS_FILE), new Uint8Array([1, 2, 3, 4]));
  for (const name of ["alpha_1.2.0.zip", "alpha_1.10.0.zip", "alpha_1.9.9.zip", "beta_0.1.0.zip", "pinned_1.0.0.zip", "pinned_2.0.0.zip", "new-mod_0.0.1.zip", "Odd Name.zip", "notes.txt", ".DS_Store"]) await write(join(mods, name), `content of ${name}`);
  await write(join(mods, "folder-mod_3.0.0", "info.json"), "{}");
  await write(join(root, "development", "dev-mod", "info.json"), JSON.stringify({ name: "dev-mod", version: "0.5.0" }));
  await write(join(root, "development", "dev-mod", "data.lua"), "-- data");
  await symlink(join(root, "development", "dev-mod"), join(mods, "dev-mod"));
  await write(join(mods, "unnamed", "readme.txt"), "no info.json");
  return mods;
}

describe("iniValue", () => {
  const text = "; version=13\nconfig-path=__PATH__executable__/../../config\n[path]\n;write-data=/commented\nread-data=/read\r\nwrite-data= /write \n[other]\nwrite-data=/wrong\n";
  it("reads a key of a section, or of the part before the first one", () => {
    expect(iniValue(text, "path", "write-data")).toBe("/write");
    expect(iniValue(text, "path", "read-data")).toBe("/read");
    expect(iniValue(text, undefined, "config-path")).toBe("__PATH__executable__/../../config");
    expect(iniValue(text, undefined, "write-data")).toBeUndefined();
    expect(iniValue(text, "absent", "write-data")).toBeUndefined();
  });
});

describe("locateUserData", () => {
  const mac: Host = { platform: "darwin", env: {}, home: "/Users/someone" };

  it("names the system's folder per platform", () => {
    expect(systemWriteData(mac)).toBe("/Users/someone/Library/Application Support/factorio");
    expect(systemWriteData({ platform: "linux", env: {}, home: "/home/someone" })).toBe("/home/someone/.factorio");
    expect(systemWriteData({ platform: "win32", env: { APPDATA: "D:\\Roaming" }, home: "C:\\Users\\someone" })).toBe("D:\\Roaming\\Factorio");
    expect(systemWriteData({ platform: "win32", env: {}, home: "C:\\Users\\someone" })).toBe("C:\\Users\\someone\\AppData\\Roaming\\Factorio");
    expect(systemWriteData({ platform: "freebsd", env: {}, home: "/home/someone" })).toBeUndefined();
  });

  it("uses the system's folder when nothing says otherwise", async () => {
    const home = scratch("plain-home");
    const data = scratch("plain", "factorio.app", "Contents", "data");
    expect(await locateUserData(data, { ...mac, home })).toEqual({ writeData: join(home, "Library", "Application Support", "factorio"), modDirectory: join(home, "Library", "Application Support", "factorio", "mods"), decidedBy: "default" });
    expect(await locateUserData(data, { platform: "freebsd", env: {}, home })).toBeUndefined();
  });

  it("follows the write-data of the config.ini in the system's folder, placeholders resolved", async () => {
    const home = scratch("configured-home");
    const config = await write(join(home, ".factorio", "config", "config.ini"), "[path]\nread-data=__PATH__system-read-data__\nwrite-data=__PATH__system-write-data__/../factorio_21\n");
    const location = await locateUserData(scratch("configured", "factorio", "data"), { platform: "linux", env: {}, home });
    expect(location).toEqual({ writeData: join(home, "factorio_21"), modDirectory: join(home, "factorio_21", "mods"), decidedBy: config });
    expect(watchedUserFiles(location!)).toEqual([
      join(home, "factorio_21", "factorio-current.log"), join(home, "factorio_21", "player-data.json"), join(home, "factorio_21", "config", "config.ini"),
      join(home, "factorio_21", "mods"), join(home, "factorio_21", "mods", "mod-list.json"), join(home, "factorio_21", "mods", "mod-settings.dat"),
    ]);
  });

  it("follows config-path.cfg beside the data directory: a portable installation keeps everything in its own folder", async () => {
    const home = scratch("portable-home");
    const root = scratch("portable", "factorio");
    await write(join(root, "config-path.cfg"), "config-path=__PATH__executable__/../../config\nuse-system-read-write-data-directories=false\n");
    expect(await locateUserData(join(root, "data"), { platform: "linux", env: {}, home })).toEqual({ writeData: root, modDirectory: join(root, "mods"), decidedBy: "default" });
    const config = await write(join(root, "config", "config.ini"), "[path]\nwrite-data=__PATH__executable__/../../user\n");
    expect(await locateUserData(join(root, "data"), { platform: "linux", env: {}, home })).toEqual({ writeData: join(root, "user"), modDirectory: join(root, "user", "mods"), decidedBy: config });
  });

  it("falls back to the default for a write-data it cannot resolve", async () => {
    const home = scratch("odd-home");
    for (const value of ["relative/folder", "__PATH__unknown__/x", ""]) {
      await write(join(home, ".factorio", "config", "config.ini"), `[path]\nwrite-data=${value}\n`);
      expect(await locateUserData(scratch("odd", "factorio", "data"), { platform: "linux", env: {}, home })).toMatchObject({ writeData: join(home, ".factorio"), decidedBy: "default" });
    }
  });
});

describe("readUserMods", () => {
  it("reads the list, the settings' hash and the mods by file", async () => {
    const directory = await playerMods(scratch("read"));
    const mods = await readUserMods(directory);
    expect(mods).toMatchObject({ directory, exists: true, problems: [], settingsHash: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a" });
    expect(mods.list).toContainEqual({ name: "pinned", enabled: true, version: "1.0.0" });
    expect(mods.list).toContainEqual({ name: "quality", enabled: false });
    expect(mods.files).toEqual([
      { fileName: "Odd Name.zip", kind: "zip" },
      { fileName: "alpha_1.10.0.zip", kind: "zip", name: "alpha", version: "1.10.0" },
      { fileName: "alpha_1.2.0.zip", kind: "zip", name: "alpha", version: "1.2.0" },
      { fileName: "alpha_1.9.9.zip", kind: "zip", name: "alpha", version: "1.9.9" },
      { fileName: "beta_0.1.0.zip", kind: "zip", name: "beta", version: "0.1.0" },
      { fileName: "dev-mod", kind: "directory", name: "dev-mod", version: "0.5.0" },
      { fileName: "folder-mod_3.0.0", kind: "directory", name: "folder-mod", version: "3.0.0" },
      { fileName: "new-mod_0.0.1.zip", kind: "zip", name: "new-mod", version: "0.0.1" },
      { fileName: "pinned_1.0.0.zip", kind: "zip", name: "pinned", version: "1.0.0" },
      { fileName: "pinned_2.0.0.zip", kind: "zip", name: "pinned", version: "2.0.0" },
      { fileName: "unnamed", kind: "directory" },
    ]);
  });

  it("says what the game will load: enabled and new mods, the pinned version or the highest", async () => {
    const mods = await readUserMods(await playerMods(scratch("enabled")));
    expect(enabledMods(mods, GAME_MODULES)).toEqual([
      { name: "alpha", version: "1.10.0" }, { name: "base", version: "2.1.24" }, { name: "dev-mod", version: "0.5.0" }, { name: "folder-mod", version: "3.0.0" },
      { name: "new-mod", version: "0.0.1" }, { name: "pinned", version: "1.0.0" }, { name: "space-age", version: "2.1.24" },
    ]);
  });

  it("is a game without mods when there is no mod directory, with the game's modules all enabled", async () => {
    const mods = await readUserMods(scratch("absent", "mods"));
    expect(mods).toEqual({ directory: scratch("absent", "mods"), exists: false, list: undefined, files: [], settingsHash: null, problems: [] });
    expect(enabledMods(mods, GAME_MODULES)).toEqual([{ name: "base", version: "2.1.24" }, { name: "quality", version: "2.1.24" }, { name: "space-age", version: "2.1.24" }]);
  });

  it("reports a list it cannot read and treats every mod as enabled", async () => {
    const directory = scratch("damaged", "mods");
    await write(join(directory, MOD_LIST_FILE), "{ not json");
    await write(join(directory, "beta_0.1.0.zip"), "zip");
    const mods = await readUserMods(directory);
    expect(mods.list).toBeUndefined();
    expect(mods.problems).toEqual(["mod-list.json cannot be read; the game decides which mods it enables"]);
    expect(enabledMods(mods, [{ name: "base", version: "2.1.24" }])).toEqual([{ name: "base", version: "2.1.24" }, { name: "beta", version: "0.1.0" }]);
  });
});

describe("private mod directory", () => {
  it("copies the two files the game rewrites and links the mods the list does not switch off", async () => {
    const source = await playerMods(scratch("private"));
    const target = scratch("private", "run", "mods");
    await mkdir(dirname(target), { recursive: true });
    const built = await buildPrivateModDirectory(await readUserMods(source), target, process.platform);
    expect(built).toEqual({ directory: target, mods: 10, copied: [] });
    expect((await readdir(target)).sort()).toEqual([
      "Odd Name.zip", "alpha_1.10.0.zip", "alpha_1.2.0.zip", "alpha_1.9.9.zip", "dev-mod", "folder-mod_3.0.0", "mod-list.json", "mod-settings.dat", "new-mod_0.0.1.zip", "pinned_1.0.0.zip", "pinned_2.0.0.zip", "unnamed",
    ]);
    for (const name of [MOD_LIST_FILE, MOD_SETTINGS_FILE]) {
      expect((await lstat(join(target, name))).isFile()).toBe(true);
      expect(Buffer.compare(await readFile(join(target, name)), await readFile(join(source, name)))).toBe(0);
    }
    for (const name of ["alpha_1.10.0.zip", "dev-mod", "folder-mod_3.0.0"]) expect((await lstat(join(target, name))).isSymbolicLink()).toBe(true);
    // The game reads through the links: the archive, and the folder a link in the user's directory leads to.
    expect(await readFile(join(target, "alpha_1.10.0.zip"), "utf8")).toBe("content of alpha_1.10.0.zip");
    expect(await readFile(join(target, "dev-mod", "data.lua"), "utf8")).toBe("-- data");
  });

  it("never writes into the user's directory: not when it is built, not when the game rewrites its files, not when it is removed", async () => {
    const root = scratch("untouched");
    const source = await playerMods(root);
    const before = await treeSnapshot(root);
    const target = scratch("untouched-run", "mods");
    await mkdir(dirname(target), { recursive: true });
    await buildPrivateModDirectory(await readUserMods(source), target, process.platform);
    // What the game does with the mod directory it is given.
    await writeFile(join(target, MOD_LIST_FILE), modList([{ name: "base", enabled: true }]));
    await writeFile(join(target, MOD_SETTINGS_FILE), new Uint8Array(64));
    await removePrivateModDirectory(target);
    expect(await lstat(target).catch(() => undefined)).toBeUndefined();
    expect(await treeSnapshot(root)).toEqual(before);
  });

  it("is empty for a game without mods, and refuses a directory that exists", async () => {
    const target = scratch("empty-run", "mods");
    await mkdir(dirname(target), { recursive: true });
    expect(await buildPrivateModDirectory(await readUserMods(scratch("nowhere", "mods")), target, process.platform)).toEqual({ directory: target, mods: 0, copied: [] });
    expect(await readdir(target)).toEqual([]);
    await expect(buildPrivateModDirectory(undefined, target, process.platform)).rejects.toThrow(/EEXIST/);
    await rm(target, { recursive: true });
    expect(await buildPrivateModDirectory(undefined, target, process.platform)).toEqual({ directory: target, mods: 0, copied: [] });
    await removePrivateModDirectory(target);
    await removePrivateModDirectory(target);
  });
});
