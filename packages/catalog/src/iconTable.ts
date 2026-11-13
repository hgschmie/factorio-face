// The icon table: which image files of the game make up each catalog icon. The app reads these files from the user's
// installation; an icon id that is not a key of the table is never looked up. The generator writes the table with
// `iconTableFile` and the app reads it with `parseIconTable`; the table itself is in standardIconTable.ts, so that neither
// the generator nor the renderer bundle loads it. Exported as `@face/catalog/icons`.

/** The game's own modules. A layer may only name a file inside one of them. */
export const GAME_MODULES = ["base", "core", "space-age", "quality", "elevated-rails", "recycler"] as const;
export type GameModuleName = (typeof GAME_MODULES)[number];

export const ICON_TABLE_SCHEMA = 1;
/** Edge of the first mip level of a layer, and the icon size a prototype expects, unless stated otherwise. */
export const DEFAULT_ICON_SIZE = 64;

/** One layer of an icon, as the game's IconData describes it. `icon` is a path such as `__base__/graphics/icons/small-lamp.png`. */
export interface IconLayer {
  readonly icon: string;
  /** Edge of the first mip level in the file, in pixels. */
  readonly size: number;
  readonly scale?: number;
  readonly shift?: readonly [number, number];
  /** Red, green, blue, alpha in 0..1. */
  readonly tint?: readonly [number, number, number, number];
  readonly floating?: boolean;
}

export interface IconEntry {
  /** The icon size the prototype expects: 64, or 128 for item groups. */
  readonly expected: number;
  readonly layers: readonly IconLayer[];
}

export interface IconTableGame {
  readonly version: string;
  readonly build?: number;
}

export interface IconTable {
  readonly game: IconTableGame;
  readonly icons: ReadonlyMap<string, IconEntry>;
}

/** A layer in the file: only the path when the size is 64 and nothing modifies the layer. */
export type IconTableFileLayer = string | IconLayer;

/** The table as JSON. An entry is a plain layer list when the expected size is 64. */
export interface IconTableFile {
  readonly schema: typeof ICON_TABLE_SCHEMA;
  readonly game: IconTableGame;
  readonly icons: Readonly<Record<string, readonly IconTableFileLayer[] | { readonly expected: number; readonly layers: readonly IconTableFileLayer[] }>>;
}

export class IconTableError extends Error {
  override readonly name = "IconTableError";
}

export const ICON_TABLE_LIMITS = { icons: 20_000, idLength: 200, pathLength: 300, layers: 16, pixels: 1024, minScale: 0.001, maxScale: 16, shift: 1024 } as const;

const ICON_ID = /^[a-z-]+\/[A-Za-z0-9_.~+-]+$/;
const ICON_PATH = /^__([a-z-]+)__\/([A-Za-z0-9_/.-]+\.png)$/;
const GAME_VERSION = /^\d+\.\d+\.\d+$/;
const LAYER_FIELDS: ReadonlySet<string> = new Set(["icon", "size", "scale", "shift", "tint", "floating"]);

function fail(message: string): never {
  throw new IconTableError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Where a layer's file is: the module directory and the path segments below it. Undefined for anything but a plain path into a known module. */
export function iconFileLocation(icon: string): { readonly module: GameModuleName; readonly segments: readonly string[] } | undefined {
  if (icon.length > ICON_TABLE_LIMITS.pathLength) return undefined;
  const match = ICON_PATH.exec(icon);
  const module = GAME_MODULES.find((name) => name === match?.[1]);
  const segments = match?.[2]?.split("/") ?? [];
  // The pattern admits dots, so "." and ".." segments are refused here, as are empty segments and hidden files.
  if (!module || segments.some((segment) => segment === "" || segment.startsWith("."))) return undefined;
  return { module, segments };
}

function parseNumber(value: unknown, what: string, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fail(`${what} must be a number in ${min}..${max}`);
}

function parsePixels(value: unknown, what: string): number {
  return Number.isInteger(value) ? parseNumber(value, what, 1, ICON_TABLE_LIMITS.pixels) : fail(`${what} must be a whole number`);
}

function parseTuple(value: unknown, what: string, length: number, min: number, max: number): number[] {
  if (!Array.isArray(value) || value.length !== length) fail(`${what} must be a list of ${length} numbers`);
  return value.map((item) => parseNumber(item, what, min, max));
}

function parseLayer(value: unknown, id: string): IconLayer {
  const what = `Layer of icon ${JSON.stringify(id)}`;
  const fields = typeof value === "string" ? { icon: value, size: DEFAULT_ICON_SIZE } : value;
  if (!isRecord(fields)) fail(`${what} must be a path or an object`);
  const unknown = Object.keys(fields).find((key) => !LAYER_FIELDS.has(key));
  if (unknown !== undefined) fail(`${what} has an unknown field ${JSON.stringify(unknown)}`);
  const { icon, size, scale, shift, tint, floating } = fields;
  if (typeof icon !== "string" || !iconFileLocation(icon)) fail(`${what} does not name an image file of the game: ${JSON.stringify(icon)}`);
  if (floating !== undefined && floating !== true) fail(`${what}: floating must be true when present`);
  const limits = ICON_TABLE_LIMITS;
  return {
    icon,
    size: parsePixels(size, `${what}: size`),
    ...(scale === undefined ? {} : { scale: parseNumber(scale, `${what}: scale`, limits.minScale, limits.maxScale) }),
    ...(shift === undefined ? {} : { shift: parseTuple(shift, `${what}: shift`, 2, -limits.shift, limits.shift) as [number, number] }),
    ...(tint === undefined ? {} : { tint: parseTuple(tint, `${what}: tint`, 4, 0, 1) as [number, number, number, number] }),
    ...(floating ? { floating } : {}),
  };
}

function parseEntry(value: unknown, id: string): IconEntry {
  const entry = Array.isArray(value) ? { expected: DEFAULT_ICON_SIZE, layers: value } : value;
  const what = `Icon ${JSON.stringify(id)}`;
  if (!isRecord(entry) || !Array.isArray(entry.layers) || Object.keys(entry).some((key) => key !== "expected" && key !== "layers")) fail(`${what} must be a layer list or { expected, layers }`);
  if (entry.layers.length === 0 || entry.layers.length > ICON_TABLE_LIMITS.layers) fail(`${what} must have 1..${ICON_TABLE_LIMITS.layers} layers`);
  return { expected: parsePixels(entry.expected, `${what}: expected size`), layers: entry.layers.map((layer) => parseLayer(layer, id)) };
}

/** Validates the content of an icon table file. Throws IconTableError; a table that fails here is a defect of the build, not of the user's machine. */
export function parseIconTable(value: unknown): IconTable {
  if (!isRecord(value) || value.schema !== ICON_TABLE_SCHEMA) fail(`Not an icon table of schema ${ICON_TABLE_SCHEMA}`);
  const { game, icons } = value;
  if (!isRecord(game) || typeof game.version !== "string" || !GAME_VERSION.test(game.version)) fail("Icon table without a game version");
  const build = game.build === undefined || Number.isSafeInteger(game.build) ? game.build : fail("Icon table with a malformed game build number");
  if (!isRecord(icons)) fail("Icon table without icons");
  const ids = Object.keys(icons);
  if (ids.length > ICON_TABLE_LIMITS.icons) fail(`Icon table has too many icons (limit ${ICON_TABLE_LIMITS.icons})`);
  const entries = new Map<string, IconEntry>();
  for (const id of ids) {
    if (id.length > ICON_TABLE_LIMITS.idLength || !ICON_ID.test(id) || id.includes("..")) fail(`Malformed icon id ${JSON.stringify(id.slice(0, 80))}`);
    entries.set(id, parseEntry(icons[id], id));
  }
  return { game: { version: game.version, ...(typeof build === "number" ? { build } : {}) }, icons: entries };
}

function fileLayer({ icon, size, scale, shift, tint, floating }: IconLayer): IconTableFileLayer {
  const plain = size === DEFAULT_ICON_SIZE && scale === undefined && shift === undefined && tint === undefined && !floating;
  // Fields in a fixed order, so the file does not depend on how a layer object was built.
  return plain ? icon : { icon, size, ...(scale === undefined ? {} : { scale }), ...(shift ? { shift } : {}), ...(tint ? { tint } : {}), ...(floating ? { floating } : {}) };
}

/** The JSON form of a table, in the compact notation `parseIconTable` reads back. */
export function iconTableFile(table: IconTable): IconTableFile {
  const icons: IconTableFile["icons"] = Object.fromEntries([...table.icons].map(([id, { expected, layers }]) => {
    const compact = layers.map(fileLayer);
    return [id, expected === DEFAULT_ICON_SIZE ? compact : { expected, layers: compact }];
  }));
  return { schema: ICON_TABLE_SCHEMA, game: table.game, icons };
}
