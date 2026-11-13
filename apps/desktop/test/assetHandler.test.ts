// What the private schemes answer: files of one directory, and for catalog icons the installation first, then the bundled
// file, then the placeholder.
import { parseIconTable } from "@face/catalog/icons";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { assetHandler, fileHandler, type InstallationIcons } from "../src/assetHandler.ts";
import { BUNDLE_CONTENT_TYPES, IMAGE_CONTENT_TYPES, type ServedRoot } from "../src/assetPath.ts";
import { GameIcons } from "../src/gameIcons/gameIcons.ts";
import { placeholderIcon } from "../src/gameIcons/placeholder.ts";
import { decodePng, encodePng, type RgbaImage } from "../src/gameIcons/png.ts";
import { useScratch } from "./support/scratch.ts";

const scratch = useScratch("asset-handler");

function solid(width: number, height: number, color: readonly number[]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return { width, height, data };
}

const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255];
/** As plain bytes: the encoder answers with a Buffer, which compares as another type. */
const plain = (content: Uint8Array): Uint8Array => new Uint8Array(content);
const BUNDLED = plain(encodePng(solid(2, 2, BLUE)));
const RENDERED = plain(encodePng(solid(64, 64, RED)));
const PLACEHOLDER = plain(placeholderIcon());
const table = parseIconTable({
  schema: 1,
  game: { version: "2.1.24" },
  icons: {
    "item/red": ["__base__/graphics/icons/red.png"],
    "item/gone": ["__space-age__/graphics/icons/gone.png"],
    "item/escape": ["__base__/graphics/icons/escape.png"],
    "item/both": ["__base__/graphics/icons/both.png"],
  },
});

let root = "";
let served: ServedRoot;
const write = async (file: string, content: Uint8Array | string): Promise<void> => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
};

beforeAll(async () => {
  root = scratch("root");
  served = { scheme: "face-asset", host: "catalog", directory: root, contentTypes: IMAGE_CONTENT_TYPES };
  await write(join(root, "icons/item/bundled.png"), BUNDLED);
  await write(join(root, "icons/item/both.png"), BUNDLED);
  await write(join(root, "icons/item/gone.png"), BUNDLED);
  await write(join(root, "icons/custom.webp"), "webp");
  await write(join(root, "notes.txt"), "not an image");
  await write(scratch("secret.png"), BUNDLED);
  await symlink(scratch("secret.png"), join(root, "icons/link.png"));
  await mkdir(join(root, "icons/folder.png"));
});

const url = (path: string): string => `face-asset://catalog/${path}`;
const get = (path: string) => ({ method: "GET", url: url(path) });
const bytes = async (response: Response): Promise<Uint8Array> => new Uint8Array(await response.arrayBuffer());

/** Icons of an installation that renders `rendered` for the ids it is given and has every id of `known`. */
function icons(rendered: Readonly<Record<string, Uint8Array>>, known = Object.keys(rendered), ready: Promise<unknown> = Promise.resolve()): InstallationIcons & { readonly asked: string[] } {
  const asked: string[] = [];
  return { asked, ready: () => ready, covers: (id) => known.includes(id), icon: async (id) => (asked.push(id), rendered[id]) };
}

describe("files of a served directory", () => {
  it("answers with the file, its content type and the headers that keep the answer what it is", async () => {
    const response = await fileHandler(served, { "x-extra": "1" })(get("icons/item/bundled.png"));
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({ "content-type": "image/png", "cache-control": "no-cache", "x-content-type-options": "nosniff", "x-extra": "1" });
    expect(await bytes(response)).toEqual(BUNDLED);
    expect((await fileHandler(served)(get("icons/custom.webp?r=3#x"))).headers.get("content-type")).toBe("image/webp");
  });

  it("serves the renderer bundle with its own content types", async () => {
    await write(scratch("bundle/index.html"), "<!doctype html>");
    const bundle: ServedRoot = { scheme: "face-app", host: "bundle", directory: scratch("bundle"), contentTypes: BUNDLE_CONTENT_TYPES };
    const response = await fileHandler(bundle, { "content-security-policy": "default-src 'none'" })({ method: "GET", url: "face-app://bundle/index.html" });
    expect([response.status, response.headers.get("content-type"), response.headers.get("content-security-policy")]).toEqual([200, "text/html; charset=utf-8", "default-src 'none'"]);
  });

  it.each(["POST", "HEAD", "PUT", "DELETE", "OPTIONS"])("refuses %s", async (method) => {
    for (const handler of [fileHandler(served), assetHandler(served), assetHandler(served, icons({ "item/red": RENDERED }))]) {
      const response = await handler({ method, url: url("icons/item/red.png") });
      expect(response.status).toBe(405);
    }
  });

  it.each([
    ["a missing file", "icons/item/missing.png"],
    ["a file that is no image", "notes.txt"],
    ["a link that leaves the root", "icons/link.png"],
    ["a folder with an image name", "icons/folder.png"],
    ["a path above the root", "../secret.png"],
    ["an encoded path above the root", "icons/%2e%2e/%2e%2e/secret.png"],
    ["another host", "//other/icons/item/bundled.png"],
  ])("answers 404 for %s", async (_name, path) => {
    const request = path.startsWith("//") ? { method: "GET", url: `face-asset:${path}` } : get(path);
    for (const handler of [fileHandler(served), assetHandler(served), assetHandler(served, icons({}))]) {
      const response = await handler(request);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });
});

describe("catalog icons", () => {
  it("come from the installation first", async () => {
    const installation = icons({ "item/both": RENDERED, "item/red": RENDERED });
    const handler = assetHandler(served, installation);
    for (const path of ["icons/item/both.png", "icons/item/red.png", "icons/item/red.png?r=2"]) {
      const response = await handler(get(path));
      expect(Object.fromEntries(response.headers)).toEqual({ "content-type": "image/png", "cache-control": "no-cache", "x-content-type-options": "nosniff" });
      expect(await bytes(response)).toEqual(RENDERED);
    }
    expect(installation.asked).toEqual(["item/both", "item/red", "item/red"]);
  });

  it("come from the bundled files when the installation does not have the id, or cannot render it", async () => {
    const installation = icons({}, ["item/gone"]);
    const handler = assetHandler(served, installation);
    expect(await bytes(await handler(get("icons/item/bundled.png")))).toEqual(BUNDLED);
    expect(await bytes(await handler(get("icons/item/gone.png")))).toEqual(BUNDLED);
    // An id the table does not have is never asked of the installation.
    expect(installation.asked).toEqual(["item/gone"]);
  });

  it("are the placeholder when the installation should have the icon and neither it nor the bundle does", async () => {
    const handler = assetHandler(served, icons({}, ["item/red"]));
    const response = await handler(get("icons/item/red.png"));
    expect([response.status, response.headers.get("content-type"), response.headers.get("x-content-type-options")]).toEqual([200, "image/png", "nosniff"]);
    expect(await bytes(response)).toEqual(PLACEHOLDER);
  });

  it("are 404 when nothing has them: without an installation, and for an id outside the table", async () => {
    expect((await assetHandler(served)(get("icons/item/red.png"))).status).toBe(404);
    const installation = icons({}, ["item/red"]);
    const handler = assetHandler(served, installation);
    const paths = ["icons/item/unknown.png", "icons/item/red.webp", "icons/item/red", "icons/.png", "icons/item/../../notes.png", "item/red.png"];
    for (const path of paths) expect((await handler(get(path))).status, path).toBe(404);
    expect(installation.asked).toEqual([]);
  });

  it("wait for the search for the installation, and for nothing else", async () => {
    let found = (): void => undefined;
    const installation = icons({ "item/red": RENDERED }, ["item/red"], new Promise<void>((resolve) => (found = resolve)));
    const handler = assetHandler(served, installation);
    let answered = false;
    const pending = handler(get("icons/item/red.png")).then((response) => ((answered = true), response));
    // A file that is no icon does not depend on the installation.
    expect((await handler(get("notes.txt"))).status).toBe(404);
    expect((await handler(get("icons/custom.webp"))).status).toBe(200);
    expect([answered, installation.asked]).toEqual([false, []]);
    found();
    expect(await bytes(await pending)).toEqual(RENDERED);
  });

  it("do not wait for an installation that does not answer", async () => {
    const hanging: InstallationIcons = { ready: () => Promise.resolve(), covers: () => true, icon: () => new Promise(() => undefined) };
    const handler = assetHandler(served, hanging, 20);
    expect(await bytes(await handler(get("icons/item/both.png")))).toEqual(BUNDLED);
    expect(await bytes(await handler(get("icons/item/red.png")))).toEqual(PLACEHOLDER);
  });

  it("is a neutral placeholder: a gray tile in the size of an icon", () => {
    const image = decodePng(placeholderIcon());
    expect([image.width, image.height]).toEqual([64, 64]);
    const pixels = Array.from({ length: 64 * 64 }, (_, index) => [...image.data.subarray(index * 4, index * 4 + 4)]);
    expect(pixels.every(([r, g, b]) => r === g && g === b)).toBe(true);
    expect(pixels[0]![3]).toBe(0);
    expect(pixels[32 * 64 + 32]![3]).toBeGreaterThan(0);
    expect(placeholderIcon()).toBe(placeholderIcon());
  });
});

describe("catalog icons of a game folder", () => {
  it("are rendered from its files, stay as they are when served, and never come from outside the folder", async () => {
    const data = scratch("game/data");
    await write(join(data, "base/graphics/icons/red.png"), encodePng(solid(120, 64, RED)));
    await write(scratch("game/outside.png"), encodePng(solid(120, 64, BLUE)));
    await symlink(scratch("game/outside.png"), join(data, "base/graphics/icons/escape.png"));
    const problems: string[] = [];
    const gameIcons = new GameIcons(table, { onProblem: (id) => void problems.push(id) });
    const handler = assetHandler(served, { ready: () => Promise.resolve(), covers: (id) => gameIcons.covers(id), icon: (id) => gameIcons.icon(id) });

    // No installation yet: the bundled files alone.
    expect((await handler(get("icons/item/red.png"))).status).toBe(404);
    expect(await bytes(await handler(get("icons/item/both.png")))).toEqual(BUNDLED);

    gameIcons.reset(data);
    const cached = (await gameIcons.icon("item/red"))!;
    const before = plain(cached);
    for (let round = 0; round < 2; round++) {
      const served64 = await bytes(await handler(get("icons/item/red.png")));
      expect(served64).toEqual(before);
      // What a reader of the answer does with it does not reach the icon that is kept.
      served64.fill(0);
    }
    expect(plain(cached)).toEqual(before);
    const image = decodePng(cached);
    expect([image.width, image.height, ...image.data.subarray(0, 4)]).toEqual([64, 64, ...RED]);

    // A link out of the data directory and a module that is not installed: the placeholder, or the bundled file when there is one.
    expect(await bytes(await handler(get("icons/item/escape.png")))).toEqual(PLACEHOLDER);
    expect(await bytes(await handler(get("icons/item/gone.png")))).toEqual(BUNDLED);
    expect(await bytes(await handler(get("icons/item/both.png")))).toEqual(BUNDLED);
    expect(problems.sort()).toEqual(["item/both", "item/escape", "item/gone"]);

    // The folder goes away: what was rendered is still served, the rest falls back.
    gameIcons.reset(data);
    await gameIcons.icon("item/red");
    await rm(scratch("game"), { recursive: true });
    expect(await bytes(await handler(get("icons/item/red.png")))).toEqual(before);
    expect(await bytes(await handler(get("icons/item/escape.png")))).toEqual(PLACEHOLDER);
  });
});
