import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { GameIcons, MAX_SOURCE_FILE_BYTES } from "../../src/gameIcons/gameIcons.ts";
import { iconSource, renderIcon } from "../../src/gameIcons/iconRenderer.ts";
import { parseIconTable, type IconLayer } from "../../src/gameIcons/iconTable.ts";
import { decodePng, encodePng, type RgbaImage } from "../../src/gameIcons/png.ts";
import { useScratch } from "../support/scratch.ts";

const scratch = useScratch("game-icons");

/** A source image as the game ships them: the icon and its mip levels side by side, in one colour. */
function strip(size: number, color: readonly number[]): RgbaImage {
  const width = size * 2 - size / 8;
  const data = new Uint8Array(width * size * 4);
  for (let i = 0; i < width * size; i++) data.set(i % width < size ? color : [0, 0, 0, 0], i * 4);
  return { width, height: size, data };
}

const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], GREEN = [0, 255, 0, 255];
const path = (name: string, module = "base"): string => `__${module}__/graphics/icons/${name}.png`;
const overlay: IconLayer = { icon: path("overlay", "quality"), size: 64, scale: 0.25, shift: [8, 8] };
const many = Array.from({ length: 40 }, (_, index) => `many-${index}`);

const table = parseIconTable({
  schema: 1,
  game: { version: "2.1.24" },
  icons: {
    "item/red": [path("red")],
    "recipe/red-recycling": [path("red"), overlay],
    "group/logistics": { expected: 128, layers: [{ icon: "__base__/graphics/item-group/logistics.png", size: 128 }] },
    "item/linked": [path("linked")],
    "item/missing": [path("missing")],
    "item/half-missing": [path("red"), path("missing")],
    "item/escape": [path("escape")],
    "item/escape-directory": [path("escaping/secret")],
    "item/oversize": [path("oversize")],
    "item/damaged": [path("damaged")],
    "item/folder": [path("folder")],
    "item/too-small": [{ icon: path("red"), size: 128 }],
    "item/disguised": [path("disguised")],
    ...Object.fromEntries(many.map((name) => [`item/${name}`, [path(name), overlay]])),
  },
});

let data = "";
const write = async (root: string, file: string, content: Uint8Array | string): Promise<void> => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), content);
};

beforeAll(async () => {
  data = scratch("game/data");
  await write(data, "base/graphics/icons/red.png", encodePng(strip(64, RED)));
  await write(data, "quality/graphics/icons/overlay.png", encodePng(strip(64, BLUE)));
  await write(data, "base/graphics/item-group/logistics.png", encodePng(strip(128, GREEN)));
  for (const [index, name] of many.entries()) await write(data, `base/graphics/icons/${name}.png`, encodePng(strip(64, [index * 6, 0, 0, 255])));
  await symlink(join(data, "base/graphics/icons/red.png"), join(data, "base/graphics/icons/linked.png"));
  // Outside the data directory: a readable image, and a folder with one.
  await write(scratch("outside"), "secret.png", encodePng(strip(64, GREEN)));
  await symlink(scratch("outside/secret.png"), join(data, "base/graphics/icons/escape.png"));
  await symlink(scratch("outside"), join(data, "base/graphics/icons/escaping"));
  // A valid image followed by padding: only its size is wrong.
  const padded = new Uint8Array(MAX_SOURCE_FILE_BYTES + 1);
  padded.set(encodePng(strip(64, RED)));
  await write(data, "base/graphics/icons/oversize.png", padded);
  await write(data, "base/graphics/icons/damaged.png", "not an image");
  await mkdir(join(data, "base/graphics/icons/folder.png"));
  // A link inside the data directory to a file that is no png by name.
  await write(data, "base/info.json", encodePng(strip(64, RED)));
  await symlink(join(data, "base/info.json"), join(data, "base/graphics/icons/disguised.png"));
});

const serving = (directory: string = data, problems?: Map<string, unknown>): GameIcons => {
  const icons = new GameIcons(table, problems ? { onProblem: (id, error) => problems.set(id, error) } : {});
  icons.reset(directory);
  return icons;
};
const pixel = (image: RgbaImage, x: number, y: number): number[] => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const decoded = async (icons: GameIcons, id: string): Promise<RgbaImage> => decodePng((await icons.icon(id)) ?? new Uint8Array(0));

describe("game icons", () => {
  it("renders an icon of the table from the installation", async () => {
    const image = await decoded(serving(), "item/red");
    expect([image.width, image.height]).toEqual([64, 64]);
    expect(image.data.every((value, index) => value === RED[index % 4])).toBe(true);
  });

  it("composites layers from different modules as the renderer does", async () => {
    const image = await decoded(serving(), "recipe/red-recycling");
    expect(pixel(image, 10, 10)).toEqual(RED);
    expect(pixel(image, 48, 48)).toEqual(BLUE);
    const layers = table.icons.get("recipe/red-recycling")!.layers;
    const expected = renderIcon(layers, [iconSource(strip(64, RED), 64), iconSource(strip(64, BLUE), 64)]);
    expect([...image.data]).toEqual([...expected.data]);
  });

  it("renders a group icon from its 128 pixel source at 64 pixels", async () => {
    const image = await decoded(serving(), "group/logistics");
    expect([image.width, image.height]).toEqual([64, 64]);
    expect(image.data.every((value, index) => value === GREEN[index % 4])).toBe(true);
  });

  it("follows a link that stays inside the data directory", async () => {
    expect(pixel(await decoded(serving(), "item/linked"), 5, 5)).toEqual(RED);
  });

  it("resolves a data directory that is itself a link", async () => {
    await symlink(scratch("game"), scratch("game-link"));
    expect(pixel(await decoded(serving(scratch("game-link/data")), "item/red"), 5, 5)).toEqual(RED);
  });

  it("knows no icon outside the table", async () => {
    const icons = serving();
    const unknown = ["item/unknown", "", "red", "item/red.png", "item/../item/red", "../outside/secret", "constructor", "__proto__", "toString", "base/graphics/icons/red", path("red")];
    for (const id of unknown) expect(await icons.icon(id), id).toBeUndefined();
  });

  it("has no icons without an installation", async () => {
    const problems = new Map<string, unknown>();
    expect(await new GameIcons(table).icon("item/red")).toBeUndefined();
    const unset = serving();
    unset.reset(undefined);
    expect(await unset.icon("item/red")).toBeUndefined();
    expect(await serving(scratch("no-such-folder"), problems).icon("item/red")).toBeUndefined();
    expect(String(problems.get("item/red"))).toMatch(/cannot be resolved/);
  });

  it.each([
    ["item/missing", /ENOENT/],
    ["item/half-missing", /ENOENT/],
    ["item/escape", /inside the game's data directory/],
    ["item/escape-directory", /inside the game's data directory/],
    ["item/disguised", /inside the game's data directory/],
    ["item/oversize", /larger than/],
    ["item/damaged", /Not a PNG/],
    ["item/folder", /Not a regular file|EISDIR/],
    ["item/too-small", /smaller than icon size/],
  ])("has no icon for %s and says why", async (id, reason) => {
    const problems = new Map<string, unknown>();
    const icons = serving(data, problems);
    expect(await icons.icon(id)).toBeUndefined();
    expect(String(problems.get(id))).toMatch(reason);
    // The failure is the answer until the installation changes; nothing is read again.
    problems.clear();
    expect(await icons.icon(id)).toBeUndefined();
    expect(problems.size).toBe(0);
  });

  it("answers repeated and simultaneous requests with one rendering", async () => {
    const icons = serving();
    const [first, second] = [icons.icon("item/red"), icons.icon("item/red")];
    expect(second).toBe(first);
    expect(await second).toBe(await first);
    expect(icons.icon("item/red")).toBe(first);
  });

  it("renders many icons at once", async () => {
    const icons = serving();
    const ids = [...many.map((name) => `item/${name}`), "item/red", "recipe/red-recycling", "item/missing", "group/logistics"];
    const rendered = await Promise.all(ids.map((id) => icons.icon(id)));
    expect(rendered.filter((bytes) => bytes === undefined)).toHaveLength(1);
    for (const [index] of many.entries()) expect(pixel(decodePng(rendered[index]!), 5, 5)).toEqual([index * 6, 0, 0, 255]);
    // Again in another order, now that the cache of source images has turned over.
    const again = serving();
    const reversed = await Promise.all([...ids].reverse().map((id) => again.icon(id)));
    expect(reversed.reverse().map((bytes) => bytes && [...bytes])).toEqual(rendered.map((bytes) => bytes && [...bytes]));
  });

  it("keeps what it rendered until the installation is set again", async () => {
    const root = scratch("changing/data");
    await write(root, "base/graphics/icons/red.png", encodePng(strip(64, RED)));
    const icons = serving(root);
    const before = icons.revision;
    const first = await icons.icon("item/red");
    await rm(join(root, "base/graphics/icons/red.png"));
    expect(await icons.icon("item/red")).toBe(first);
    expect(icons.revision).toBe(before);

    icons.reset(root);
    expect(icons.revision).toBe(before + 1);
    expect(await icons.icon("item/red")).toBeUndefined();

    await write(root, "base/graphics/icons/red.png", encodePng(strip(64, BLUE)));
    expect(await icons.icon("item/red")).toBeUndefined();
    icons.reset(root);
    expect(pixel(await decoded(icons, "item/red"), 5, 5)).toEqual(BLUE);

    icons.reset(data);
    expect(pixel(await decoded(icons, "item/red"), 5, 5)).toEqual(RED);
    icons.reset(undefined);
    expect(await icons.icon("item/red")).toBeUndefined();
    expect(icons.revision).toBe(before + 4);
  });

  it("does not let a rendering that was under way leak into the next installation", async () => {
    const other = scratch("other/data");
    await write(other, "base/graphics/icons/red.png", encodePng(strip(64, BLUE)));
    const icons = serving(data);
    const pending = icons.icon("item/red");
    icons.reset(other);
    expect(pixel(await decoded(icons, "item/red"), 5, 5)).toEqual(BLUE);
    expect(pixel(decodePng((await pending)!), 5, 5)).toEqual(RED);
    expect(pixel(await decoded(icons, "item/red"), 5, 5)).toEqual(BLUE);
  });

  it("starts at revision 0 and counts every change", () => {
    const icons = new GameIcons(table);
    expect(icons.revision).toBe(0);
    icons.reset(data);
    icons.reset(data);
    expect(icons.revision).toBe(2);
  });
});
