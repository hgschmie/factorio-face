import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const FAKE_GAME_VERSION = { version: "2.1.24", build: 87808, variant: "mac-arm64, full, space-age" };

export interface CannedDump {
  /** What the game says it loaded; `base` with the game's version unless given. */
  readonly activeMods?: Readonly<Record<string, string>>;
  readonly gameVersion?: string;
}

/**
 * Writes the files the three dump commands leave below `script-output`, for a game with two items (one with a mod's icon),
 * a lamp a wire connects to and one item group. Small, and complete enough for the tables to be built from it.
 */
export async function writeCannedDump(directory: string, { activeMods = { base: "2.1.24" }, gameVersion = "2.1.24" }: CannedDump = {}): Promise<string> {
  const signal = (name: string, type: string): object => ({ name, type, order: name, group: "g", subgroup: "s", hidden: false, parameter: false });
  const raw = {
    item: { plate: { icon: "__base__/graphics/icons/plate.png" }, gadget: { icon: "__some-mod__/graphics/gadget.png" }, lamp: { icon: "__base__/graphics/icons/lamp.png" } },
    lamp: { lamp: { name: "lamp", icon: "__base__/graphics/icons/lamp.png", collision_box: [[-0.35, -0.35], [0.35, 0.35]], circuit_wire_max_distance: 9 } },
    "item-group": { g: { icon: "__base__/graphics/g.png", icon_size: 128 } },
    "utility-constants": { default: { default_item_weight: 100, default_rocket_lift_weight: 1000 } },
  };
  const runtime = {
    game_version: gameVersion,
    active_mods: activeMods,
    item: ["plate", "gadget", "lamp"].map((name) => ({ ...signal(name, "item"), stack_size: 50, weight: 100 })),
    fluid: [], virtual_signal: [], recipe: [], space_location: [], asteroid_chunk: [], quality: [],
    entity: [{ ...signal("lamp", "lamp"), items_to_place_this: ["lamp"] }],
    item_group: [{ name: "g", order: "a" }],
    item_subgroup: [{ name: "s", group: "g", order: "a" }],
    utility_constants: { default_item_weight: 100 },
    rocket_silos: {},
    circuit_entities: [{ name: "lamp", type: "lamp", supports_direction: false, tile_width: 1, tile_height: 1, flags: {}, circuit_wire_distance: { normal: 9 }, wire_distance: { normal: 0 }, optional: {}, default_signals: {} }],
  };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "data-raw-dump.json"), JSON.stringify(raw));
  await writeFile(join(directory, "face-runtime-dump.json"), JSON.stringify(runtime));
  await writeFile(join(directory, "item-locale.json"), JSON.stringify({ names: { plate: "Plate", gadget: "Gadget", lamp: "Lamp" }, descriptions: {} }));
  await writeFile(join(directory, "entity-locale.json"), JSON.stringify({ names: { lamp: "Lamp" } }));
  await writeFile(join(directory, "item-group-locale.json"), JSON.stringify({ names: { g: "Group" } }));
  return directory;
}

export interface FakeGameControl {
  /** Where every start of the fake game is recorded, one JSON line each. */
  readonly record: string;
  /** The directory `writeCannedDump` filled. */
  readonly dump: string;
  readonly mode?: "fail" | "hang" | "flood" | "no-output" | "lua-error" | "quiet" | "noisy" | "escape" | "linger";
  /** The command the mode applies to; every command without it. */
  readonly at?: "data" | "locale" | "runtime";
  readonly outside?: string;
}

export interface FakeGameStart {
  readonly pid: number;
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly escaped?: boolean | string;
}

/**
 * Writes the fake game's program to `file`: a launcher that hands its arguments to fakeFactorio.mjs under this Node, the way
 * the runner starts the real program, without relying on anything in the environment.
 */
export async function writeFakeGame(file: string, control: FakeGameControl): Promise<string> {
  const controlFile = `${file}.control.json`;
  await writeFile(controlFile, JSON.stringify(control));
  await writeFile(control.record, "", { flag: "a" });
  const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
  await writeFile(file, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve(import.meta.dirname, "fakeFactorio.mjs"))} ${quote(controlFile)} "$@"\n`);
  await chmod(file, 0o755);
  return file;
}

export async function fakeGameStarts(control: FakeGameControl): Promise<FakeGameStart[]> {
  return (await readFile(control.record, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as FakeGameStart);
}
