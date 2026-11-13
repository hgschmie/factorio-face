// Installations of the game for the tests: the files the app looks at (the info file of each module) and a few icon images
// in one colour each, written with the app's own PNG encoder. Nothing of the game itself is used.
import type { ElectronApplication } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { decodePng, encodePng } from "../../apps/desktop/src/gameIcons/png.ts";
import { GAMES_DIR } from "./app.ts";

export type Color = readonly [number, number, number, number];

export const RED: Color = [220, 40, 40, 255];
export const BLUE: Color = [40, 80, 220, 255];
export const ORANGE: Color = [240, 150, 20, 255];
export const VIOLET: Color = [150, 60, 200, 255];

/** An icon file as the game ships them: the 64 pixel icon and its smaller copies side by side. */
export function iconStrip(color: Color): Uint8Array {
  const width = 120, height = 64;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return encodePng({ width, height, data });
}

export interface FakeGameOptions {
  readonly version?: string;
  /** Modules besides `base` and `core`. */
  readonly modules?: readonly string[];
  /** Icon files by their path below the data directory. `base/graphics/icons/signal/signal_A.png`, which marks an installation with images, is always written (red unless given). */
  readonly icons?: Readonly<Record<string, Color>>;
  /** The game folder is `factorio.app` with its data in `Contents/data`, as on macOS. */
  readonly bundle?: boolean;
}

export interface FakeGame {
  /** The folder a user would choose: the game folder, or the application bundle. */
  readonly folder: string;
  readonly dataDirectory: string;
}

export const SIGNAL_A_FILE = "base/graphics/icons/signal/signal_A.png";

let gameCount = 0;

/** Writes an installation into a new folder under .runtime/e2e-games. */
export async function writeFakeGame({ version = "2.1.24", modules = ["space-age", "quality", "elevated-rails", "recycler"], icons = {}, bundle = false }: FakeGameOptions = {}): Promise<FakeGame> {
  const parent = resolve(GAMES_DIR, `game-${process.pid}-${++gameCount}`);
  const folder = bundle ? join(parent, "factorio.app") : join(parent, "factorio");
  const dataDirectory = bundle ? join(folder, "Contents", "data") : join(folder, "data");
  const write = async (file: string, content: string | Uint8Array): Promise<void> => {
    await mkdir(dirname(join(dataDirectory, file)), { recursive: true });
    await writeFile(join(dataDirectory, file), content);
  };
  await write("core/info.json", JSON.stringify({ name: "core", title: "Core Factorio Data", dependencies: [] }));
  for (const name of ["base", ...modules]) await write(`${name}/info.json`, JSON.stringify({ name, version, title: name, dependencies: [] }));
  for (const [file, color] of Object.entries({ [SIGNAL_A_FILE]: RED, ...icons })) await write(file, iconStrip(color));
  return { folder, dataDirectory };
}

/** A folder under .runtime/e2e-games that exists and is empty: no game, or no bundled icons. */
export async function emptyFolder(): Promise<string> {
  const folder = resolve(GAMES_DIR, `empty-${process.pid}-${++gameCount}`);
  await mkdir(folder, { recursive: true });
  return folder;
}

export interface FetchedAsset {
  readonly status: number;
  readonly contentType: string | null;
  readonly sniffing: string | null;
  readonly bytes: Uint8Array;
}

/** Fetches a URL of the app's asset scheme in the main process: the page itself may load such a URL as an image only. */
export async function fetchAsset(app: ElectronApplication, url: string): Promise<FetchedAsset> {
  const answer = await app.evaluate(async ({ net }, target) => {
    const response = await net.fetch(target);
    const { status, headers } = response;
    return { status, contentType: headers.get("content-type"), sniffing: headers.get("x-content-type-options"), bytes: [...new Uint8Array(await response.arrayBuffer())] };
  }, url);
  return { ...answer, bytes: new Uint8Array(answer.bytes) };
}

/** Size and the colour in the middle of a PNG. */
export function pngFacts(bytes: Uint8Array): { readonly size: readonly [number, number]; readonly center: Color } {
  const image = decodePng(bytes);
  const at = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
  return { size: [image.width, image.height], center: [image.data[at]!, image.data[at + 1]!, image.data[at + 2]!, image.data[at + 3]!] };
}
