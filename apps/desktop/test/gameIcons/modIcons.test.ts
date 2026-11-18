// Icons with image files of the user's mods: from a mod's archive, its folder or a link to its folder, in the version the
// game had loaded, and nothing for whatever is not there, not that mod or no image the app reads.
import { parseIconTable, type IconLayer } from "@face/catalog/icons";
import { zipSync, strToU8 } from "fflate";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { GameIcons, MAX_SOURCE_FILE_BYTES } from "../../src/gameIcons/gameIcons.ts";
import { iconSource, renderIcon } from "../../src/gameIcons/iconRenderer.ts";
import { ModFiles } from "../../src/gameIcons/modFiles.ts";
import { decodePng, encodePng, MAX_PNG_DIMENSION, PngError, type RgbaImage } from "../../src/gameIcons/png.ts";
import { useScratch } from "../support/scratch.ts";
import { treeSnapshot } from "../support/treeSnapshot.ts";

const scratch = useScratch("mod-icons");

function strip(color: readonly number[], size = 64, width = size * 2 - size / 8): RgbaImage {
  const data = new Uint8Array(width * size * 4);
  for (let i = 0; i < width * size; i++) data.set(color, i * 4);
  return { width, height: size, data };
}
const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], GREEN = [0, 255, 0, 255], YELLOW = [255, 255, 0, 255], GRAY = [90, 90, 90, 255];
const png = (color: readonly number[]): Uint8Array => encodePng(strip(color));
/** A valid image with one byte of its header changed: the bit depth (offset 24) or the interlace method (offset 28). */
const withHeader = (offset: number, value: number): Uint8Array => {
  const bytes = Uint8Array.from(png(RED));
  bytes[offset] = value;
  return bytes;
};
const padded = (): Uint8Array => {
  const bytes = new Uint8Array(MAX_SOURCE_FILE_BYTES + 1);
  bytes.set(png(RED));
  return bytes;
};
const info = (name: string, version: string): Uint8Array => strToU8(JSON.stringify({ name, version, title: name, factorio_version: "2.1" }));
const archive = (name: string, version: string, files: Readonly<Record<string, Uint8Array>>, folder = `${name}_${version}`): Uint8Array =>
  zipSync({ [`${folder}/info.json`]: info(name, version), ...Object.fromEntries(Object.entries(files).map(([file, bytes]) => [`${folder}/${file}`, bytes])) }, { level: 1 });

const many = Array.from({ length: 40 }, (_, index) => `graphics/many/icon-${index}.png`);
const overlay: IconLayer = { icon: "__folder__/graphics/icons/b.png", size: 64, scale: 0.25, shift: [8, 8] };
const table = parseIconTable({
  schema: 1,
  game: { version: "2.1.25" },
  icons: {
    "item/red": ["__base__/graphics/icons/red.png"],
    "item/zipped": ["__zipped__/graphics/icons/a.png"],
    "item/zipped-stored": ["__zipped__/graphics/icons/stored.png"],
    "item/layered": ["__base__/graphics/icons/red.png", overlay],
    "item/two-mods": ["__zipped__/graphics/icons/a.png", overlay],
    "item/folder": ["__folder__/graphics/icons/b.png"],
    "item/folder-linked": ["__folder__/graphics/icons/linked.png"],
    "item/folder-escape": ["__folder__/graphics/icons/escape.png"],
    "item/folder-escape-directory": ["__folder__/graphics/escaping/secret.png"],
    "item/folder-disguised": ["__folder__/graphics/icons/disguised.png"],
    "item/dev": ["__dev-mod__/graphics/icon.png"],
    "item/dev-inside": ["__dev-mod__/graphics/inside.png"],
    "item/dev-escape": ["__dev-mod__/graphics/escape.png"],
    "item/dev-sibling": ["__dev-mod__/graphics/sibling.png"],
    "item/spaced": ["__Spaced Mod__/graphics/my icon.png"],
    "item/unnamed": ["__unnamed__/a.png"],
    "item/gone": ["__gone__/a.png"],
    "item/updated": ["__updated__/a.png"],
    "item/renamed": ["__renamed__/a.png"],
    "item/not-loaded": ["__not-loaded__/a.png"],
    "item/no-archive": ["__no-archive__/a.png"],
    "item/no-file": ["__zipped__/graphics/icons/none.png"],
    "item/other-top": ["__zipped__/graphics/icons/elsewhere.png"],
    "item/half": ["__base__/graphics/icons/red.png", "__gone__/a.png"],
    "item/big": ["__zipped__/graphics/big.png"],
    "item/big-folder": ["__folder__/graphics/big.png"],
    "item/wide": ["__zipped__/graphics/wide.png"],
    "item/deep": ["__zipped__/graphics/deep.png"],
    "item/one-bit": ["__zipped__/graphics/one-bit.png"],
    "item/interlaced": ["__zipped__/graphics/interlaced.png"],
    "item/not-png": ["__zipped__/graphics/not.png"],
    "item/small": [{ icon: "__zipped__/graphics/icons/a.png", size: 256 }],
    ...Object.fromEntries(many.map((file, index) => [`item/many-${index}`, [`__zipped__/${file}`]])),
  },
});
/** What the game had loaded when the table's data was read. `not-loaded` is in the mod directory and not among them. */
const LOADED = [["base", "2.1.25"], ["zipped", "1.2.3"], ["folder", "0.1.0"], ["dev-mod", "0.0.1"], ["Spaced Mod", "1.0.0"], ["unnamed", "2.0.0"], ["gone", "1.0.0"], ["updated", "2.0.0"], ["renamed", "1.0.0"], ["no-archive", "1.0.0"]].map(([name, version]) => ({ name: name!, version: version! }));

let data = "", mods = "";
const write = async (file: string, content: Uint8Array | string): Promise<void> => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
};
const zipped = (color: readonly number[], version = "1.2.3"): Uint8Array => archive("zipped", version, {
  "graphics/icons/a.png": png(color),
  "graphics/icons/stored.png": png(color),
  "graphics/big.png": padded(),
  "graphics/wide.png": encodePng(strip(RED, 64, MAX_PNG_DIMENSION + 1)),
  "graphics/deep.png": withHeader(24, 16),
  "graphics/one-bit.png": withHeader(24, 1),
  "graphics/interlaced.png": withHeader(28, 1),
  "graphics/not.png": strToU8("not an image"),
  ...Object.fromEntries(many.map((file, index) => [file, png([index * 6, 0, 0, 255])])),
});

beforeAll(async () => {
  data = scratch("game/data");
  mods = scratch("user/mods");
  await write(join(data, "base/graphics/icons/red.png"), png(RED));
  await write(scratch("outside/secret.png"), png(GRAY));
  await write(join(mods, "mod-list.json"), JSON.stringify({ mods: LOADED.map(({ name }) => ({ name, enabled: true })) }));

  // An archive in the version the game loaded, beside an older one of the same mod; a second folder in it is not the mod.
  await write(join(mods, "zipped_1.2.3.zip"), Buffer.concat([zipped(GREEN)]));
  await write(join(mods, "zipped_1.2.0.zip"), archive("zipped", "1.2.0", { "graphics/icons/a.png": png(BLUE) }));
  await write(join(mods, "Spaced Mod_1.0.0.zip"), archive("Spaced Mod", "1.0.0", { "graphics/my icon.png": png(YELLOW) }, "whatever the packer called it"));
  await write(join(mods, "download.zip"), archive("unnamed", "2.0.0", { "a.png": png(BLUE) }));
  await write(join(mods, "not-loaded_1.0.0.zip"), archive("not-loaded", "1.0.0", { "a.png": png(BLUE) }));
  // Another version than the one the data was read with, an archive that is another mod than its name says, and one that is none.
  await write(join(mods, "updated_2.1.0.zip"), archive("updated", "2.1.0", { "a.png": png(BLUE) }));
  await write(join(mods, "renamed_1.0.0.zip"), archive("something-else", "1.0.0", { "a.png": png(BLUE) }));
  await write(join(mods, "no-archive_1.0.0.zip"), "this is no archive");

  // A mod as a folder: with a link that stays inside it, and links that leave it.
  const folder = join(mods, "folder_0.1.0");
  await write(join(folder, "info.json"), info("folder", "0.1.0"));
  await write(join(folder, "graphics/icons/b.png"), png(BLUE));
  await write(join(folder, "graphics/big.png"), padded());
  await symlink(join(folder, "graphics/icons/b.png"), join(folder, "graphics/icons/linked.png"));
  await symlink(scratch("outside/secret.png"), join(folder, "graphics/icons/escape.png"));
  await symlink(scratch("outside"), join(folder, "graphics/escaping"));
  await symlink(join(folder, "info.json"), join(folder, "graphics/icons/disguised.png"));

  // A mod under development: the entry of the mod directory is a link to its folder elsewhere, beside another folder.
  const source = scratch("projects/dev-mod");
  await write(join(source, "info.json"), info("dev-mod", "0.0.1"));
  await write(join(source, "graphics/icon.png"), png(YELLOW));
  await write(scratch("projects/sibling/secret.png"), png(GRAY));
  await symlink(join(source, "graphics/icon.png"), join(source, "graphics/inside.png"));
  await symlink(scratch("outside/secret.png"), join(source, "graphics/escape.png"));
  await symlink(scratch("projects/sibling/secret.png"), join(source, "graphics/sibling.png"));
  await symlink(source, join(mods, "dev-mod"));
});

/** `modDirectory`: null for a game without one. */
const serving = (problems?: Map<string, unknown>, modDirectory: string | null = mods, loaded = LOADED): GameIcons => {
  const icons = new GameIcons(table, { modDirectory: () => Promise.resolve(modDirectory ?? undefined), ...(problems ? { onProblem: (id: string, error: unknown) => void problems.set(id, error) } : {}) }, loaded);
  icons.reset(data);
  return icons;
};
const pixel = (image: RgbaImage, x: number, y: number): number[] => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const decoded = async (icons: GameIcons, id: string): Promise<RgbaImage> => decodePng((await icons.icon(id)) ?? new Uint8Array(0));
const message = (problems: Map<string, unknown>, id: string): string => String(problems.get(id) instanceof Error ? (problems.get(id) as Error).message : problems.get(id));

describe("icons of mods", () => {
  it("draws an icon from the archive of the mod, in the version the game had loaded", async () => {
    const icons = serving();
    const image = await decoded(icons, "item/zipped");
    expect([image.width, image.height]).toEqual([64, 64]);
    expect(image.data.every((value, index) => value === GREEN[index % 4])).toBe(true);
    expect(pixel(await decoded(icons, "item/zipped-stored"), 5, 5)).toEqual(GREEN);
    // With the older version loaded it is the older archive's image.
    const older = serving(undefined, mods, LOADED.map((mod) => (mod.name === "zipped" ? { ...mod, version: "1.2.0" } : mod)));
    expect(pixel(await decoded(older, "item/zipped"), 5, 5)).toEqual(BLUE);
  });

  it("finds a mod whose name has a blank, whose archive has a folder of another name, and one whose file name says nothing", async () => {
    const icons = serving();
    expect(pixel(await decoded(icons, "item/spaced"), 5, 5)).toEqual(YELLOW);
    expect(pixel(await decoded(icons, "item/unnamed"), 5, 5)).toEqual(BLUE);
  });

  it("draws an icon from the folder of a mod, and through a link that stays inside the folder", async () => {
    const icons = serving();
    expect(pixel(await decoded(icons, "item/folder"), 5, 5)).toEqual(BLUE);
    expect(pixel(await decoded(icons, "item/folder-linked"), 5, 5)).toEqual(BLUE);
  });

  it("composites layers of the game and of mods as the renderer does", async () => {
    const icons = serving();
    const image = await decoded(icons, "item/layered");
    expect([pixel(image, 10, 10), pixel(image, 48, 48)]).toEqual([RED, BLUE]);
    const expected = renderIcon(table.icons.get("item/layered")!.layers, [iconSource(strip(RED), 64), iconSource(strip(BLUE), 64)]);
    expect([...image.data]).toEqual([...expected.data]);
    const both = await decoded(icons, "item/two-mods");
    expect([pixel(both, 10, 10), pixel(both, 48, 48)]).toEqual([GREEN, BLUE]);
  });

  it("follows the link that a mod under development is, and a link inside the folder it points to", async () => {
    const icons = serving();
    expect(pixel(await decoded(icons, "item/dev"), 5, 5)).toEqual(YELLOW);
    expect(pixel(await decoded(icons, "item/dev-inside"), 5, 5)).toEqual(YELLOW);
  });

  it("reads nothing that leaves a mod's folder through a link", async () => {
    const problems = new Map<string, unknown>();
    const icons = serving(problems);
    for (const id of ["item/folder-escape", "item/folder-escape-directory", "item/dev-escape", "item/dev-sibling"]) {
      expect(await icons.icon(id), id).toBeUndefined();
      expect(message(problems, id), id).toMatch(/^Not an image file inside the folder of the mod (folder|dev-mod): /);
    }
    // Nor a file inside it that is no image by its name.
    expect(await icons.icon("item/folder-disguised")).toBeUndefined();
    expect(message(problems, "item/folder-disguised")).toMatch(/Not an image file inside the folder of the mod folder/);
    expect(problems.size).toBe(5);
  });

  it("has no icon for a mod that is gone, of another version, another mod than its file says, no archive, or not among the loaded ones", async () => {
    const problems = new Map<string, unknown>();
    const icons = serving(problems);
    const reasons: Readonly<Record<string, RegExp>> = {
      "item/gone": /^The mod gone 1\.0\.0 is not in the mod directory$/,
      "item/updated": /^The mod updated 2\.0\.0 is not in the mod directory$/,
      "item/renamed": /^The mod renamed 1\.0\.0 is not in the mod directory$/,
      "item/no-archive": /^The mod no-archive 1\.0\.0 is not in the mod directory$/,
      "item/not-loaded": /^The game had no mod not-loaded loaded$/,
      "item/no-file": /^The mod zipped has no image file graphics\/icons\/none\.png$/,
      "item/other-top": /^The mod zipped has no image file graphics\/icons\/elsewhere\.png$/,
      "item/half": /^The mod gone 1\.0\.0 is not in the mod directory$/,
    };
    for (const [id, reason] of Object.entries(reasons)) {
      expect(await icons.icon(id), id).toBeUndefined();
      expect(message(problems, id), id).toMatch(reason);
    }
    // Each icon is its own answer: the others of the same mods and of the game are drawn.
    expect(pixel(await decoded(icons, "item/zipped"), 5, 5)).toEqual(GREEN);
    expect(pixel(await decoded(icons, "item/red"), 5, 5)).toEqual(RED);
    expect(problems.size).toBe(Object.keys(reasons).length);
  });

  it("has no icon for an image over the limits or of a form the decoder does not read, and says why", async () => {
    const problems = new Map<string, unknown>();
    const icons = serving(problems);
    for (const id of ["item/big", "item/big-folder", "item/wide", "item/deep", "item/one-bit", "item/interlaced", "item/not-png", "item/small"]) expect(await icons.icon(id), id).toBeUndefined();
    expect(message(problems, "item/big")).toMatch(new RegExp(`an entry of more than ${MAX_SOURCE_FILE_BYTES} bytes`));
    expect(message(problems, "item/big-folder")).toMatch(new RegExp(`File is larger than ${MAX_SOURCE_FILE_BYTES} bytes`));
    expect(message(problems, "item/wide")).toMatch(/PNG dimensions 1025x64 are outside 1\.\.1024/);
    expect(message(problems, "item/deep")).toMatch(/Unsupported PNG format \(colour type 6, depth 16\)/);
    expect(message(problems, "item/one-bit")).toMatch(/Unsupported PNG format \(colour type 6, depth 1\)/);
    expect(message(problems, "item/interlaced")).toMatch(/Interlaced PNGs are not supported/);
    expect(message(problems, "item/not-png")).toMatch(/Not a PNG file/);
    expect(message(problems, "item/small")).toMatch(/smaller than icon size 256/);
    for (const id of ["item/wide", "item/deep", "item/one-bit", "item/interlaced", "item/not-png"]) expect(problems.get(id), id).toBeInstanceOf(PngError);
    expect(pixel(await decoded(icons, "item/zipped"), 5, 5)).toEqual(GREEN);
  });

  it("says which icons have a file of a mod, whether or not they can be drawn", () => {
    const icons = serving();
    expect(["item/red", "item/zipped", "item/layered", "item/gone", "item/unknown"].map((id) => [icons.covers(id), icons.ofMod(id)])).toEqual([[true, false], [true, true], [true, true], [true, true], [false, false]]);
  });

  it("reads no file of a mod when it is not told where the mods are, or when they are not there", async () => {
    const without = new GameIcons(table, {}, LOADED);
    without.reset(data);
    expect(await without.icon("item/zipped")).toBeUndefined();
    expect(pixel(await decoded(without, "item/red"), 5, 5)).toEqual(RED);
    const problems = new Map<string, unknown>();
    expect(await serving(problems, null).icon("item/zipped")).toBeUndefined();
    expect(message(problems, "item/zipped")).toBe("There is no mod directory");
    expect(await serving(problems, scratch("no-such-folder")).icon("item/folder")).toBeUndefined();
    expect(message(problems, "item/folder")).toBe("The mod folder 0.1.0 is not in the mod directory");
    // The table of the build has no mods: nothing of a mod directory is drawn for it.
    expect(await serving(undefined, mods, []).icon("item/zipped")).toBeUndefined();
    // And without an installation there are no icons at all.
    expect(await new GameIcons(table, { modDirectory: () => Promise.resolve(mods) }, LOADED).icon("item/zipped")).toBeUndefined();
  });

  it("reads the directory of an archive once for all its icons, however many are asked for at once", async () => {
    const icons = serving();
    expect(icons.indexedArchives).toEqual({ archives: 0, bytes: 0 });
    const images = await Promise.all(many.map((_, index) => decoded(icons, `item/many-${index}`)));
    expect(images.map((image) => pixel(image, 5, 5))).toEqual(many.map((_, index) => [index * 6, 0, 0, 255]));
    expect(icons.indexedArchives.archives).toBe(1);
    await Promise.all(["item/spaced", "item/unnamed", "item/folder", "item/dev"].map((id) => icons.icon(id)));
    // The archives of the two mods that were asked for, and the one without a name that had to be asked which mod it is. No folder, no other archive.
    expect(icons.indexedArchives.archives).toBe(3);
    expect(icons.indexedArchives.bytes).toBeGreaterThan(0);
    expect(icons.indexedArchives.bytes).toBeLessThan(64 * 1024);
  });

  it("writes nothing into the mod directory and extracts nothing", async () => {
    const before = await treeSnapshot(scratch("user"));
    const icons = serving();
    await Promise.all([...table.icons.keys()].map((id) => icons.icon(id)));
    expect(await treeSnapshot(scratch("user"))).toEqual(before);
  });

  it("looks at the mods again when the data in use changes, and forgets what it drew and indexed", async () => {
    const own = scratch("changing/mods");
    await write(join(own, "zipped_1.2.3.zip"), zipped(GREEN));
    const icons = serving(undefined, own);
    expect(pixel(await decoded(icons, "item/zipped"), 5, 5)).toEqual(GREEN);
    // The archive is replaced: what was drawn stays, and an icon not asked for yet comes from the archive as it is now.
    await write(join(own, "zipped_1.2.3.zip"), zipped(YELLOW));
    expect(pixel(await decoded(icons, "item/zipped"), 5, 5)).toEqual(GREEN);
    expect(pixel(await decoded(icons, "item/zipped-stored"), 5, 5)).toEqual(YELLOW);
    // The mod goes away: an icon not asked for yet has no image any more.
    await rm(join(own, "zipped_1.2.3.zip"));
    expect(await icons.icon("item/many-0")).toBeUndefined();
    // Data read anew, with the mod in another version that is there.
    await write(join(own, "zipped_1.3.0.zip"), zipped(BLUE, "1.3.0"));
    const before = icons.revision;
    icons.setTable(table, LOADED.map((mod) => (mod.name === "zipped" ? { ...mod, version: "1.3.0" } : mod)));
    expect(icons.revision).toBe(before + 1);
    expect(icons.indexedArchives).toEqual({ archives: 0, bytes: 0 });
    expect(pixel(await decoded(icons, "item/zipped"), 5, 5)).toEqual(BLUE);
    expect(pixel(await decoded(icons, "item/many-0"), 5, 5)).toEqual([0, 0, 0, 255]);
    // The table of the build again: no mods, and no icon of one.
    icons.setTable(table);
    expect(await icons.icon("item/zipped")).toBeUndefined();
    expect(pixel(await decoded(icons, "item/red"), 5, 5)).toEqual(RED);
  });
});

describe("the files of mods", () => {
  it("gives the bytes of an image of a loaded mod and rejects for everything else", async () => {
    const files = new ModFiles(() => Promise.resolve(mods), LOADED);
    expect(decodePng(await files.read("zipped", ["graphics", "icons", "a.png"], MAX_SOURCE_FILE_BYTES)).width).toBe(120);
    expect(decodePng(await files.read("folder", ["graphics", "icons", "b.png"], MAX_SOURCE_FILE_BYTES)).width).toBe(120);
    // Of an archive only images are indexed: the mod's other files are not there to be read.
    await expect(files.read("zipped", ["info.json"], MAX_SOURCE_FILE_BYTES)).rejects.toThrow(/has no image file info\.json/);
    await expect(files.read("folder", ["info.json"], MAX_SOURCE_FILE_BYTES)).rejects.toThrow(/Not an image file inside the folder/);
    await expect(files.read("folder", ["..", "zipped_1.2.3.zip"], MAX_SOURCE_FILE_BYTES)).rejects.toThrow(/Not an image file inside the folder/);
    await expect(files.read("folder", ["graphics", "icons", "missing.png"], MAX_SOURCE_FILE_BYTES)).rejects.toThrow(/ENOENT/);
    await expect(files.read("zipped", ["graphics", "icons", "a.png"], 10)).rejects.toThrow(/an entry of more than 10 bytes/);
    await expect(files.read("base", ["graphics", "icons", "red.png"], MAX_SOURCE_FILE_BYTES)).rejects.toThrow(/The mod base 2\.1\.25 is not in the mod directory/);
  });
});
