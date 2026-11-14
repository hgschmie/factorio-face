import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const FAKE_GAME_VERSION = { version: "2.1.24", build: 87808, variant: "mac-arm64, full, space-age" };

export interface CannedDump {
  /** What the game says it loaded; `base` with the game's version unless given. */
  readonly activeMods?: Readonly<Record<string, string>>;
  readonly gameVersion?: string;
  /**
   * A game the editor can work with: the ten prototypes it has a kind of its own for, the signal A, and what only a mod has, a
   * crate a wire connects to (`mod-crate`, with a mod's icon) and a virtual signal (`mod-signal`).
   */
  readonly editor?: boolean;
  /** With `editor`: prototypes the game lacks after all (a mod removed them). */
  readonly without?: readonly string[];
}

/** What only the mod of an `editor` dump has. */
export const MOD_ENTITY = "mod-crate";
export const MOD_SIGNAL = "mod-signal";

interface WiredEntity {
  readonly name: string;
  readonly type: string;
  readonly label: string;
  readonly size: readonly [number, number];
  readonly turns?: boolean;
  /** An electric pole's one distance for all its wires. */
  readonly poleReach?: number;
  readonly module?: string;
}

const EDITOR_ENTITIES: readonly WiredEntity[] = [
  { name: "constant-combinator", type: "constant-combinator", label: "Constant combinator", size: [1, 1], turns: true },
  { name: "arithmetic-combinator", type: "arithmetic-combinator", label: "Arithmetic combinator", size: [1, 2], turns: true },
  { name: "decider-combinator", type: "decider-combinator", label: "Decider combinator", size: [1, 2], turns: true },
  { name: "selector-combinator", type: "selector-combinator", label: "Selector combinator", size: [1, 2], turns: true },
  { name: "small-lamp", type: "lamp", label: "Lamp", size: [1, 1] },
  { name: "small-electric-pole", type: "electric-pole", label: "Small electric pole", size: [1, 1], poleReach: 7.5 },
  { name: "medium-electric-pole", type: "electric-pole", label: "Medium electric pole", size: [1, 1], poleReach: 9 },
  { name: "big-electric-pole", type: "electric-pole", label: "Big electric pole", size: [2, 2], poleReach: 32 },
  { name: "substation", type: "electric-pole", label: "Substation", size: [2, 2], poleReach: 18 },
  { name: "programmable-speaker", type: "programmable-speaker", label: "Programmable speaker", size: [1, 1] },
  { name: MOD_ENTITY, type: "container", label: "Mod crate", size: [2, 2], module: "some-mod" },
];

/**
 * Writes the files the three dump commands leave below `script-output`, for a game with two items (one with a mod's icon),
 * a lamp a wire connects to and one item group; with `editor` also what the editor needs of a game. Small, and complete
 * enough for the tables to be built from it.
 */
export async function writeCannedDump(directory: string, { activeMods = { base: "2.1.24" }, gameVersion = "2.1.24", editor = false, without = [] }: CannedDump = {}): Promise<string> {
  const signal = (name: string, type: string): object => ({ name, type, order: name, group: "g", subgroup: "s", hidden: false, parameter: false });
  const wired = editor ? EDITOR_ENTITIES.filter((entity) => !without.includes(entity.name)) : [];
  const iconOf = (entity: WiredEntity): string => `__${entity.module ?? "base"}__/graphics/icons/${entity.name}.png`;
  const boxOf = ([width, height]: readonly [number, number], inset: number): number[][] => [[-width / 2 + inset, -height / 2 + inset], [width / 2 - inset, height / 2 - inset]];
  const byType: Record<string, Record<string, object>> = {};
  for (const entity of wired) {
    const reach = entity.poleReach === undefined ? { circuit_wire_max_distance: 9 } : { maximum_wire_distance: entity.poleReach };
    const sounds = entity.type === "programmable-speaker" ? { maximum_polyphony: 10, instruments: [{ name: "alarms", notes: [{ name: "alarm-1" }, { name: "alarm-2" }] }] } : {};
    (byType[entity.type] ??= {})[entity.name] = { name: entity.name, icon: iconOf(entity), collision_box: boxOf(entity.size, 0.15), selection_box: boxOf(entity.size, 0), ...reach, ...sounds };
  }
  const virtual = editor ? { "signal-A": { icon: "__base__/graphics/icons/signal/signal_A.png" }, [MOD_SIGNAL]: { icon: "__some-mod__/graphics/icons/mod-signal.png" } } : {};
  const raw = {
    ...byType,
    item: { plate: { icon: "__base__/graphics/icons/plate.png" }, gadget: { icon: "__some-mod__/graphics/gadget.png" }, lamp: { icon: "__base__/graphics/icons/lamp.png" }, ...Object.fromEntries(wired.map((entity) => [entity.name, { icon: iconOf(entity) }])) },
    lamp: { ...byType.lamp, lamp: { name: "lamp", icon: "__base__/graphics/icons/lamp.png", collision_box: [[-0.35, -0.35], [0.35, 0.35]], selection_box: [[-0.5, -0.5], [0.5, 0.5]], circuit_wire_max_distance: 9 } },
    "virtual-signal": virtual,
    "item-group": { g: { icon: "__base__/graphics/g.png", icon_size: 128 } },
    "utility-constants": { default: { default_item_weight: 100, default_rocket_lift_weight: 1000 } },
  };
  const fact = (name: string, type: string, [width, height]: readonly [number, number], turns: boolean, poleReach?: number): object => ({
    name, type, supports_direction: turns, tile_width: width, tile_height: height, flags: {}, circuit_wire_distance: { normal: poleReach === undefined ? 9 : 0 }, wire_distance: { normal: poleReach ?? 0 }, optional: {}, default_signals: {},
  });
  const runtime = {
    game_version: gameVersion,
    active_mods: activeMods,
    item: ["plate", "gadget", "lamp", ...wired.map((entity) => entity.name)].map((name) => ({ ...signal(name, "item"), stack_size: 50, weight: 100 })),
    fluid: [], virtual_signal: Object.keys(virtual).map((name) => signal(name, "virtual-signal")), recipe: [], space_location: [], asteroid_chunk: [], quality: [],
    entity: [{ ...signal("lamp", "lamp"), items_to_place_this: ["lamp"] }, ...wired.map((entity) => ({ ...signal(entity.name, entity.type), items_to_place_this: [entity.name] }))],
    item_group: [{ name: "g", order: "a" }],
    item_subgroup: [{ name: "s", group: "g", order: "a" }],
    utility_constants: { default_item_weight: 100 },
    rocket_silos: {},
    circuit_entities: [fact("lamp", "lamp", [1, 1], false), ...wired.map((entity) => fact(entity.name, entity.type, entity.size, entity.turns === true, entity.poleReach))],
  };
  const labels = Object.fromEntries(wired.map((entity) => [entity.name, entity.label]));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "data-raw-dump.json"), JSON.stringify(raw));
  await writeFile(join(directory, "face-runtime-dump.json"), JSON.stringify(runtime));
  await writeFile(join(directory, "item-locale.json"), JSON.stringify({ names: { plate: "Plate", gadget: "Gadget", lamp: "Lamp", ...labels }, descriptions: {} }));
  await writeFile(join(directory, "entity-locale.json"), JSON.stringify({ names: { lamp: "Lamp", ...labels } }));
  await writeFile(join(directory, "item-group-locale.json"), JSON.stringify({ names: { g: "Group" } }));
  if (editor) await writeFile(join(directory, "virtual-signal-locale.json"), JSON.stringify({ names: { "signal-A": "Signal A", [MOD_SIGNAL]: "Mod signal" } }));
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
  /** How long every start takes before it ends, in milliseconds. */
  readonly delayMs?: number;
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
