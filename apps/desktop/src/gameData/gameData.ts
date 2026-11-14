// The data the editor works with when it was read from the user's own game instead of coming with the build: the signal
// catalog, the icon table and the entity table of one dump, and what state of the game they belong to. Pure.
import type { CatalogData } from "@face/catalog";
import { iconTableFile, parseIconTable, type IconTable, type IconTableFile } from "@face/catalog/icons";
import { parseEntityTable, type EntityTable } from "@face/model";
import { createHash } from "node:crypto";
import { STANDARD_MODULES } from "../../../../tools/catalog/lib/commands.ts";
import type { GameDataSource, GameMod } from "../ipc.ts";
import { ValidationError } from "../validation.ts";
import { parseCatalogData } from "./catalogData.ts";
import type { EnabledMod } from "./userMods.ts";

export const GAME_DATA_LIMITS = { mods: 2000, nameLength: 200, notes: 500, noteLength: 500, entities: 50_000, textLength: 2000 } as const;

export type { GameDataSource };

/**
 * The state of the game that data was read from, as the files say it without starting the game: the version of the
 * installation, the mods the game loads with their versions (`enabledMods`), and the hash of the mod settings. The build
 * number is only known from a run.
 */
export interface GameDataKey {
  readonly version: string;
  readonly build?: number;
  /** Sorted by name. */
  readonly mods: readonly EnabledMod[];
  /** SHA-256 of `mod-settings.dat`, null without the file. */
  readonly modSettings: string | null;
}

export type LoadedMod = GameMod;

export interface GameData {
  readonly key: GameDataKey;
  /** When the game was read, ISO 8601. */
  readonly readAt: string;
  /** What the game had loaded, by its own account: its modules, then the mods. */
  readonly mods: readonly LoadedMod[];
  /** As `packages/catalog/data/catalog-<version>.json`. */
  readonly catalog: CatalogData;
  /** As `packages/catalog/data/icons-<version>.json`. */
  readonly icons: IconTableFile;
  /** As `packages/model/data/entities-<version>.json`; `parseEntityTable` reads it. */
  readonly entities: Readonly<Record<string, unknown>>;
  /** Wired entities that were left out, and why. */
  readonly notes: readonly string[];
  /** How many icons the catalog refers to that the icon table lacks (icons of mods). */
  readonly skippedIcons: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= GAME_DATA_LIMITS.nameLength && !/[\u0000-\u001f\u007f]/.test(value);
const isVersion = (value: unknown): value is string => typeof value === "string" && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value);

function fail(message: string): never {
  throw new ValidationError(`Game data: ${message}`);
}

function parseMods<V extends string | null>(value: unknown, what: string, validVersion: (version: unknown) => version is V): { name: string; version: V }[] {
  if (!Array.isArray(value) || value.length > GAME_DATA_LIMITS.mods) fail(`${what} are not a list of mods`);
  const mods = (value as unknown[]).map((mod) => (isRecord(mod) && isName(mod.name) && validVersion(mod.version) ? { name: mod.name, version: mod.version } : fail(`${what} have a malformed entry`)));
  if (new Set(mods.map((mod) => mod.name)).size !== mods.length) fail(`${what} name a mod twice`);
  return mods;
}

export function parseGameDataKey(value: unknown): GameDataKey {
  if (!isRecord(value) || !isVersion(value.version)) return fail("the key has no game version");
  const { version, build, modSettings } = value;
  if (build !== undefined && !(Number.isSafeInteger(build) && (build as number) >= 0)) fail("the key has a malformed build number");
  if (modSettings !== null && !(typeof modSettings === "string" && /^[0-9a-f]{64}$/.test(modSettings))) fail("the key has a malformed hash of the mod settings");
  const mods = parseMods(value.mods, "the key's mods", (candidate): candidate is string | null => candidate === null || isVersion(candidate));
  return { version, ...(build === undefined ? {} : { build: build as number }), mods, modSettings: modSettings as string | null };
}

/** One string for a key: the same for the same state of the game, whatever order its fields were written in. */
export function gameDataKeyId(key: GameDataKey): string {
  const mods = [...key.mods].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((mod) => [mod.name, mod.version]);
  return createHash("sha256").update(JSON.stringify([key.version, key.build ?? null, mods, key.modSettings])).digest("hex");
}

/** Whether two keys name the same state of the game. A key read from the files has no build number; it then does not count. */
export function sameGameState(a: GameDataKey, b: GameDataKey): boolean {
  const build = a.build !== undefined && b.build !== undefined ? {} : { build: 0 };
  return gameDataKeyId({ ...a, ...build }) === gameDataKeyId({ ...b, ...build });
}

/**
 * Reads game data, from a build or back from the cache file, through the parsers the app reads the built-in data with: the
 * catalog's loader, `parseIconTable` and `parseEntityTable`. Throws ValidationError for anything they refuse and when the
 * three tables are not of the game the key names. The icon table comes back parsed, for the icon renderer.
 */
export function parseGameData(value: unknown): { data: GameData; iconTable: IconTable } {
  if (!isRecord(value)) return fail("not a record");
  const key = parseGameDataKey(value.key);
  const { readAt, notes, skippedIcons, entities } = value;
  if (typeof readAt !== "string" || readAt.length > 40 || !Number.isFinite(Date.parse(readAt))) fail("no time of reading");
  const mods = parseMods(value.mods, "the loaded mods", isVersion);
  if (!Array.isArray(notes) || notes.length > GAME_DATA_LIMITS.notes || !notes.every((note) => typeof note === "string" && note.length <= GAME_DATA_LIMITS.noteLength)) fail("the notes are malformed");
  if (!(Number.isSafeInteger(skippedIcons) && (skippedIcons as number) >= 0)) fail("the number of skipped icons is malformed");
  const catalog = parseCatalogData(value.catalog);
  let iconTable: IconTable;
  let entityTable: EntityTable;
  try {
    iconTable = parseIconTable(value.icons);
    entityTable = parseEntityTable(entities);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  // The table's own reader checks what the editor computes with; what it shows as text is bounded here.
  if (entityTable.entities.length > GAME_DATA_LIMITS.entities) fail(`more than ${GAME_DATA_LIMITS.entities} entities`);
  const unbounded = entityTable.entities.find((entity) => !isName(entity.name) || !isName(entity.type) || entity.displayName.length > GAME_DATA_LIMITS.textLength || ![...entity.placedBy, ...entity.modules].every(isName));
  if (unbounded) fail(`the entity ${JSON.stringify(unbounded.name.slice(0, 80))} has a name that is too long or has control characters`);
  const versions = [catalog.game.version, iconTable.game.version, entityTable.game.version];
  if (versions.some((version) => version !== key.version)) fail(`the tables are of ${versions.join(", ")}, the key is of ${key.version}`);
  const data: GameData = { key, readAt: readAt as string, mods, catalog, icons: iconTableFile(iconTable), entities: entities as Record<string, unknown>, notes: notes as string[], skippedIcons: skippedIcons as number };
  return { data, iconTable };
}

export { describeGameDataSource } from "./source.ts";

/** The game's own modules among what a game loaded are not its mods. */
export const isGameModule = (name: string): boolean => STANDARD_MODULES.includes(name);

export function gameDataSource(data: GameData): GameDataSource {
  const mods = data.mods.filter((mod) => !isGameModule(mod.name)).length;
  return { kind: "game", version: data.key.version, ...(data.key.build === undefined ? {} : { build: data.key.build }), readAt: data.readAt, mods };
}
