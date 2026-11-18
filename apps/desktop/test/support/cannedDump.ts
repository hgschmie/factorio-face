import { strToU8, zipSync } from "fflate";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { encodePng } from "../../src/gameIcons/png.ts";

export const FAKE_GAME_VERSION = { version: "2.1.25", build: 88022, variant: "mac-arm64, full, space-age" };

export interface CannedDump {
  /** What the game says it loaded; `base` with the game's version unless given. */
  readonly activeMods?: Readonly<Record<string, string>>;
  readonly gameVersion?: string;
  /**
   * A game the editor can work with: the ten prototypes it has a kind of its own for, the signal A, and what only a mod has, a
   * crate a wire connects to (`mod-crate`, with a mod's icon) and a virtual signal (`mod-signal`). The mod's icons are files
   * of `some-mod` (`someModImages`), whether or not the game says it loaded that mod.
   */
  readonly editor?: boolean;
  /** With `editor`: prototypes the game lacks after all (a mod removed them). */
  readonly without?: readonly string[];
  /** With `editor`: further prototypes a wire connects to, as a mod adds them (`MODDED_KINDS`). */
  readonly entities?: readonly WiredEntity[];
}

/** The mod of the canned dumps as its `info.json` describes it: what it cannot do without, what it can do with, and what it refuses. */
export const SOME_MOD_INFO = { name: "some-mod", version: "1.2.3", title: "Some Mod", author: "nobody", factorio_version: "2.1", dependencies: ["base >= 2.1", "? quality", "! not-there", "missing-lib >= 1.0"] };

export type Color = readonly [number, number, number, number];

/** An icon file as the game and its mods ship them: the 64 pixel icon and its smaller copies side by side, here in one colour. */
export function iconStrip(color: Color): Uint8Array {
  const width = 120, height = 64;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return encodePng({ width, height, data });
}

/**
 * The bytes of a mod's archive: one folder with its `info.json` and a file of code, as the mod portal packs them, and
 * `images` by their path inside the mod.
 */
export function modArchive(info: { readonly name: string; readonly version: string } & Readonly<Record<string, unknown>>, folder = `${info.name}_${info.version}`, images: Readonly<Record<string, Uint8Array>> = {}): Uint8Array {
  const files = Object.fromEntries(Object.entries(images).map(([file, bytes]) => [`${folder}/${file}`, bytes]));
  return zipSync({ [`${folder}/control.lua`]: strToU8("-- nothing\n"), [`${folder}/info.json`]: strToU8(JSON.stringify(info, null, 2)), ...files });
}

/** What only the mod of an `editor` dump has. */
export const MOD_ENTITY = "mod-crate";
export const MOD_SIGNAL = "mod-signal";
/** The one colour of every image of the canned dumps' mod. */
export const MOD_ICON_COLOR: Color = [20, 160, 150, 255];

export interface WiredEntity {
  readonly name: string;
  readonly type: string;
  readonly label: string;
  readonly size: readonly [number, number];
  readonly turns?: boolean;
  /** An electric pole's one distance for all its wires. */
  readonly poleReach?: number;
  readonly module?: string;
  /** Hidden in the game, with the item that builds it, as the helper entities of a mod are: it is in the data, and nothing offers it. */
  readonly hidden?: boolean;
  /** What is wrong with it, as with a mod's helper entities: the game's data gives it no collision box, or the running game no size. A read leaves it out. */
  readonly flaw?: "no-collision-box" | "no-size";
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
 * What a mod adds to the kinds of the editor: a prototype of a type with a kind of its own in another size than the standard
 * one, a pole with its own reach, a loader of one tile, and a speaker, which stays without a kind.
 */
export const MODDED_KINDS: readonly WiredEntity[] = [
  { name: "mod-arithmetic", type: "arithmetic-combinator", label: "Tiny arithmetic combinator", size: [1, 1], turns: true, module: "some-mod" },
  { name: "mod-decider", type: "decider-combinator", label: "Wide decider combinator", size: [2, 2], turns: true, module: "some-mod" },
  { name: "mod-lamp", type: "lamp", label: "Big lamp", size: [2, 2], module: "some-mod" },
  { name: "mod-pole", type: "electric-pole", label: "Huge electric pole", size: [2, 2], poleReach: 48, module: "some-mod" },
  { name: "mod-loader", type: "loader-1x1", label: "Miniloader", size: [1, 1], turns: true, module: "some-mod" },
  { name: "mod-speaker", type: "programmable-speaker", label: "Loud speaker", size: [1, 1], module: "some-mod" },
];

/** Helper entities as mods have them, which a read leaves out for two reasons: two without a collision box, one without a size in the running game. */
export const FLAWED_ENTITIES: readonly WiredEntity[] = [
  { name: "mod-helper-b", type: "constant-combinator", label: "Helper B", size: [1, 1], turns: true, module: "some-mod", flaw: "no-collision-box" },
  { name: "mod-helper-a", type: "constant-combinator", label: "Helper A", size: [1, 1], turns: true, module: "some-mod", flaw: "no-collision-box" },
  { name: "mod-hidden-lamp", type: "lamp", label: "Hidden lamp", size: [1, 1], module: "some-mod", flaw: "no-size" },
];

/** The images of the canned dumps' mod by their path inside it: the icon of everything a dump can say the mod has. */
export function someModImages(): Record<string, Uint8Array> {
  const icon = iconStrip(MOD_ICON_COLOR);
  const entities = [MOD_ENTITY, ...[...MODDED_KINDS, ...FLAWED_ENTITIES].map((entity) => entity.name)];
  return Object.fromEntries(["graphics/gadget.png", `graphics/icons/${MOD_SIGNAL}.png`, ...entities.map((name) => `graphics/icons/${name}.png`)].map((file) => [file, icon]));
}

/** The archive of the canned dumps' mod: what `modArchive` packs, with the images its prototypes name as their icons. */
export function someModArchive(info: { readonly name: string; readonly version: string } & Readonly<Record<string, unknown>> = SOME_MOD_INFO): Uint8Array {
  return modArchive(info, undefined, someModImages());
}

/**
 * Writes the files the three dump commands leave below `script-output`, for a game with two items (one with a mod's icon),
 * a lamp a wire connects to and one item group; with `editor` also what the editor needs of a game. Small, and complete
 * enough for the tables to be built from it. Every prototype says which mod created it, as the game does: `some-mod` what is
 * the mod's when the game loaded it, `base` everything else, and `core` the item group.
 */
export async function writeCannedDump(directory: string, { activeMods = { base: "2.1.25" }, gameVersion = "2.1.25", editor = false, without = [], entities = [] }: CannedDump = {}): Promise<string> {
  const createdBy = (module?: string): string => (module !== undefined && module in activeMods ? module : "base");
  const signal = (name: string, type: string, module?: string, hidden = false): object => ({ name, type, created: createdBy(module), order: name, group: "g", subgroup: "s", hidden, parameter: false });
  const wired = editor ? [...EDITOR_ENTITIES, ...entities].filter((entity) => !without.includes(entity.name)) : [];
  const iconOf = (entity: WiredEntity): string => `__${entity.module ?? "base"}__/graphics/icons/${entity.name}.png`;
  const boxOf = ([width, height]: readonly [number, number], inset: number): number[][] => [[-width / 2 + inset, -height / 2 + inset], [width / 2 - inset, height / 2 - inset]];
  const byType: Record<string, Record<string, object>> = {};
  for (const entity of wired) {
    const reach = entity.poleReach === undefined ? { circuit_wire_max_distance: 9 } : { maximum_wire_distance: entity.poleReach };
    const sounds = entity.type === "programmable-speaker" ? { maximum_polyphony: 10, instruments: [{ name: "alarms", notes: [{ name: "alarm-1" }, { name: "alarm-2" }] }] } : {};
    const collision = entity.flaw === "no-collision-box" ? {} : { collision_box: boxOf(entity.size, 0.15) };
    (byType[entity.type] ??= {})[entity.name] = { name: entity.name, icon: iconOf(entity), ...(entity.hidden && { hidden: true }), ...collision, selection_box: boxOf(entity.size, 0), ...reach, ...sounds };
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
    item: [{ name: "plate" }, { name: "gadget", module: "some-mod" }, { name: "lamp" }, ...wired].map(({ name, module, hidden }: Partial<WiredEntity> & { readonly name: string }) => ({ ...signal(name, "item", module, hidden), stack_size: 50, weight: 100 })),
    virtual_signal: Object.keys(virtual).map((name) => signal(name, "virtual-signal", name === MOD_SIGNAL ? "some-mod" : undefined)),
    fluid: [], recipe: [], space_location: [], asteroid_chunk: [], quality: [],
    entity: [{ ...signal("lamp", "lamp"), items_to_place_this: ["lamp"] }, ...wired.map((entity) => ({ ...signal(entity.name, entity.type, entity.module, entity.hidden), items_to_place_this: [entity.name] }))],
    item_group: [{ name: "g", order: "a", created: "core" }],
    item_subgroup: [{ name: "s", group: "g", order: "a", created: "base" }],
    utility_constants: { default_item_weight: 100 },
    rocket_silos: {},
    circuit_entities: [fact("lamp", "lamp", [1, 1], false), ...wired.map((entity) => fact(entity.name, entity.type, entity.flaw === "no-size" ? [0, 0] : entity.size, entity.turns === true, entity.poleReach))],
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
  /** What the mode "fail" prints in place of its own error, which names no mod. */
  readonly error?: string;
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
