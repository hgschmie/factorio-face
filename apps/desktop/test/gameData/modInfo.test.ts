// The `info.json` of the loaded mods, read from a mod directory as a player has it: archives and folders, several versions,
// files that say nothing or something else than their name, and files that are not what they seem.
import { strToU8, zipSync } from "fflate";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readModInfos } from "../../src/gameData/modInfo.ts";
import { USER_MOD_LIMITS, readUserMods } from "../../src/gameData/userMods.ts";
import { modArchive } from "../support/cannedDump.ts";
import { useScratch } from "../support/scratch.ts";
import { treeSnapshot } from "../support/treeSnapshot.ts";

const scratch = useScratch("mod-info");

async function write(file: string, content: string | Uint8Array): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

const info = (name: string, version: string, more: object = {}) => ({ name, version, title: `The ${name}`, dependencies: ["base"], ...more });
const loaded = (mods: Readonly<Record<string, string>>) => Object.entries(mods).map(([name, version]) => ({ name, version }));

async function read(directory: string, mods: Readonly<Record<string, string>>): Promise<Record<string, unknown>> {
  const { files } = await readUserMods(directory);
  return Object.fromEntries(await readModInfos(directory, files, loaded(mods)));
}

describe("readModInfos", () => {
  it("reads the info.json of each loaded mod from its archive or folder, in the version the game loaded", async () => {
    const root = scratch("player"), mods = join(root, "mods");
    await write(join(mods, "mod-list.json"), "{}");
    await write(join(mods, "alpha_1.2.0.zip"), modArchive(info("alpha", "1.2.0", { title: "The older alpha" })));
    await write(join(mods, "alpha_1.10.0.zip"), modArchive(info("alpha", "1.10.0")));
    // The inner folder has any name; the file name of this one writes the version another way than the game does.
    await write(join(mods, "beta_0.03.1.zip"), modArchive(info("beta", "0.3.1"), "whatever"));
    await write(join(mods, "folder-mod_3.0.0", "info.json"), JSON.stringify(info("folder-mod", "3.0.0")));
    await write(join(root, "development", "dev-mod", "info.json"), `﻿${JSON.stringify(info("dev-mod", "0.5.0"))}`);
    await symlink(join(root, "development", "dev-mod"), join(mods, "dev-mod"));
    // An archive whose name says nothing is asked what it is.
    await write(join(mods, "download.zip"), modArchive(info("unnamed", "2.0.0")));
    await write(join(mods, "not-loaded_1.0.0.zip"), modArchive(info("not-loaded", "1.0.0")));
    const before = await treeSnapshot(root);

    const infos = await read(mods, { alpha: "1.10.0", beta: "0.3.1", "folder-mod": "3.0.0", "dev-mod": "0.5.0", unnamed: "2.0.0", "gone-mod": "1.0.0" });
    expect(Object.keys(infos).sort()).toEqual(["alpha", "beta", "dev-mod", "folder-mod", "unnamed"]);
    expect(infos.alpha).toEqual(info("alpha", "1.10.0"));
    expect(infos.beta).toMatchObject({ title: "The beta" });
    expect(infos["dev-mod"]).toMatchObject({ title: "The dev-mod", dependencies: ["base"] });
    expect(await treeSnapshot(root)).toEqual(before);
    // Another version loaded: the other archive.
    expect((await read(mods, { alpha: "1.2.0" })).alpha).toMatchObject({ title: "The older alpha" });
    expect(await read(mods, { alpha: "1.3.0" })).toEqual({});
  });

  it("leaves out a mod whose file is not what its name says, cannot be read or says nothing usable", async () => {
    const mods = scratch("odd", "mods");
    const packed = (files: Readonly<Record<string, string>>): Uint8Array => zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
    await write(join(mods, "text_1.0.0.zip"), "a mod");
    await write(join(mods, "empty_1.0.0.zip"), "");
    await write(join(mods, "no-info_1.0.0.zip"), packed({ "no-info/data.lua": "-- data" }));
    // Only directly inside the one folder: not at the top, not deeper.
    await write(join(mods, "top_1.0.0.zip"), packed({ "info.json": JSON.stringify(info("top", "1.0.0")) }));
    await write(join(mods, "deep_1.0.0.zip"), packed({ "deep/locale/info.json": JSON.stringify(info("deep", "1.0.0")) }));
    await write(join(mods, "other-name_1.0.0.zip"), modArchive(info("victim", "1.0.0")));
    await write(join(mods, "other-version_1.0.0.zip"), modArchive(info("other-version", "1.0.1")));
    await write(join(mods, "no-version_1.0.0.zip"), modArchive({ name: "no-version", version: "one" }));
    await write(join(mods, "not-json_1.0.0.zip"), packed({ "not-json/info.json": "{ name: no-json }" }));
    await write(join(mods, "a-list_1.0.0.zip"), packed({ "a-list/info.json": "[1, 2]" }));
    await write(join(mods, "not-text_1.0.0.zip"), zipSync({ "not-text/info.json": new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]) }));
    await write(join(mods, "large_1.0.0.zip"), modArchive(info("large", "1.0.0", { description: "x".repeat(USER_MOD_LIMITS.infoBytes) })));
    await write(join(mods, "large-folder_1.0.0", "info.json"), JSON.stringify(info("large-folder", "1.0.0", { description: "x".repeat(USER_MOD_LIMITS.infoBytes) })));
    await write(join(mods, "bare-folder_1.0.0", "data.lua"), "-- no info.json");
    await write(join(mods, "fine_1.0.0.zip"), modArchive(info("fine", "1.0.0")));
    const names = ["text", "empty", "no-info", "top", "deep", "other-name", "victim", "other-version", "no-version", "not-json", "a-list", "not-text", "large", "large-folder", "bare-folder", "fine"];
    expect(Object.keys(await read(mods, Object.fromEntries(names.map((name) => [name, "1.0.0"]))))).toEqual(["fine"]);
  });

  it("answers with nothing for a mod directory that is not there or has no mods", async () => {
    expect(await readModInfos(scratch("missing", "mods"), [{ fileName: "ghost_1.0.0.zip", kind: "zip", name: "ghost", version: "1.0.0" }, { fileName: "ghost-folder", kind: "directory" }], loaded({ ghost: "1.0.0" }))).toEqual(new Map());
    expect(await readModInfos(scratch("missing", "mods"), [], loaded({ ghost: "1.0.0" }))).toEqual(new Map());
  });
});
