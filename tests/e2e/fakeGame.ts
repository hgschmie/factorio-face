// Installations of the game for the tests: the files the app looks at (the info file of each module) and a few icon images
// in one colour each, written with the app's own PNG encoder. Nothing of the game itself is used.
import type { ElectronApplication } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { executablePath } from "../../apps/desktop/src/gameData/executable.ts";
import { decodePng } from "../../apps/desktop/src/gameIcons/png.ts";
import { iconStrip, modArchive, someModArchive, writeCannedDump, writeFakeGame as writeFakeProgram, type CannedDump, type Color, type FakeGameControl } from "../../apps/desktop/test/support/cannedDump.ts";
import { GAMES_DIR } from "./app.ts";

export { iconStrip, MOD_ICON_COLOR, type Color } from "../../apps/desktop/test/support/cannedDump.ts";

export const RED: Color = [220, 40, 40, 255];
export const BLUE: Color = [40, 80, 220, 255];
export const ORANGE: Color = [240, 150, 20, 255];
export const VIOLET: Color = [150, 60, 200, 255];

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
export async function writeFakeGame({ version = "2.1.25", modules = ["space-age", "quality", "elevated-rails", "recycler"], icons = {}, bundle = false }: FakeGameOptions = {}): Promise<FakeGame> {
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

/** A further mod of the user: what its `info.json` says. The game loads it, and the dump says what it created (`CannedDump.entities`). */
export interface FakeMod {
  readonly name: string;
  readonly version: string;
  readonly title: string;
  readonly dependencies?: readonly string[];
}

export interface FakeProgram {
  /** The program beside the installation's data: what the app starts when it reads the game. */
  readonly executable: string;
  /** What the program does; `setFakeProgram` changes it between runs. */
  readonly control: FakeGameControl;
  /** The mod directory to launch the app with (FACE_GAME_MODS_DIR): one mod, `some-mod` 1.2.3, enabled; its archive has the `info.json` the app reads its title and dependencies from, and the images of its icons, each in `MOD_ICON_COLOR`. */
  readonly modDirectory: string;
}

/**
 * Gives an installation its program: the stand-in of the unit tests (apps/desktop/test/support/fakeFactorio.mjs), which
 * writes a canned dump of a game the editor can work with and one mod, each prototype with the mod that created it. Nothing of
 * the real game is started. `mods` are further mods of the user, each with its archive: the game says it loaded them too.
 */
export async function addFakeProgram(game: FakeGame, dump: CannedDump = {}, behaviour: Partial<FakeGameControl> = {}, mods: readonly FakeMod[] = []): Promise<FakeProgram> {
  const executable = executablePath(game.dataDirectory, process.platform);
  if (executable === undefined) throw new Error(`The game has no program on ${process.platform}`);
  const parent = dirname(game.folder);
  const control: FakeGameControl = { record: join(parent, "starts.jsonl"), dump: await writeCannedDump(join(parent, "dump"), { editor: true, activeMods: { base: "2.1.25", "some-mod": "1.2.3", ...Object.fromEntries(mods.map((mod) => [mod.name, mod.version])) }, ...dump }), ...behaviour };
  await mkdir(dirname(executable), { recursive: true });
  await writeFakeProgram(executable, control);
  const modDirectory = join(parent, "user", "mods");
  await mkdir(modDirectory, { recursive: true });
  await writeFile(join(modDirectory, "mod-list.json"), JSON.stringify({ mods: ["base", "some-mod", ...mods.map((mod) => mod.name)].map((name) => ({ name, enabled: true })) }));
  await writeFile(join(modDirectory, "some-mod_1.2.3.zip"), someModArchive());
  for (const mod of mods) await writeFile(join(modDirectory, `${mod.name}_${mod.version}.zip`), modArchive({ author: "nobody", factorio_version: "2.1", dependencies: ["base >= 2.1"], ...mod }));
  return { executable, control, modDirectory };
}

/** Changes what the program does from its next start on. */
export async function setFakeProgram(program: FakeProgram, behaviour: Partial<FakeGameControl>): Promise<void> {
  await writeFile(`${program.executable}.control.json`, JSON.stringify({ record: program.control.record, dump: program.control.dump, ...behaviour }));
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
