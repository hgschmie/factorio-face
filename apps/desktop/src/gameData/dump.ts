// From the files one dump of the game leaves below `script-output` to game data. The files come from a program the app does
// not control, running mods the app knows nothing about: each is read with a size limit, parsed as JSON and nothing else,
// and what the build makes of them is accepted only through `parseGameData`. The build itself is the catalog generator's
// single-set mode (tools/catalog/lib/single.ts): every record of it names the mod that created it, and the head describes
// each mod by its own `info.json` (modInfo.ts).
import { iconTableFile, type IconTable } from "@face/catalog/icons";
import { join } from "node:path";
import { DUMP_OUTPUTS, RUNTIME_DUMP_FILE } from "../../../../tools/catalog/lib/commands.ts";
import { LOCALE_DUMP_SECTIONS, activeMods, buildSingleSet, localeDumpFile, singleSetLocale, singleSetModules, type ActiveMod } from "../../../../tools/catalog/lib/single.ts";
import { readRegularFile } from "../regularFile.ts";
import { GAME_DATA_LIMITS, parseGameData, type GameData, type GameDataKey } from "./gameData.ts";

/** `data.raw` of the standard game is 30 MB; a large mod pack has several times that. Above the limit the text could not be parsed anyway. */
export const DUMP_LIMITS = { dataBytes: 384 * 1024 * 1024, runtimeBytes: 64 * 1024 * 1024, localeBytes: 16 * 1024 * 1024 } as const;

export interface RawDump {
  readonly raw: unknown;
  readonly runtime: unknown;
  /** The parsed locale files by section; a section the game wrote no file for is absent. */
  readonly locale: Readonly<Record<string, unknown>>;
}

/** The JSON of a file; undefined for an `optional` one that is not there. Throws with the file's role for one that is missing, too large or not JSON. */
async function readJson(file: string, maxBytes: number, what: string, optional = false): Promise<unknown> {
  let bytes: Uint8Array;
  try {
    bytes = await readRegularFile(file, maxBytes);
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`${what} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${what} is not JSON`);
  }
}

/** Reads the dump files of a run. */
export async function readDump(scriptOutput: string): Promise<RawDump> {
  const raw = await readJson(join(scriptOutput, DUMP_OUTPUTS.data), DUMP_LIMITS.dataBytes, "The game's data dump");
  const runtime = await readJson(join(scriptOutput, RUNTIME_DUMP_FILE), DUMP_LIMITS.runtimeBytes, "The game's runtime dump");
  const locale: Record<string, unknown> = {};
  for (const section of LOCALE_DUMP_SECTIONS) {
    // The game writes no file for a section without prototypes.
    const names = await readJson(join(scriptOutput, localeDumpFile(section)), DUMP_LIMITS.localeBytes, `The game's names of section ${section}`, true);
    if (names !== undefined) locale[section] = names;
  }
  return { raw, runtime, locale };
}

export interface BuildOptions {
  /** The game's `data` directory: the `info.json` and the locale files of its own modules are read from it. */
  readonly dataDirectory: string;
  readonly game: { readonly version: string; readonly build: number };
  /** The state of the game as the files said it before the run; the build number is added here. */
  readonly key: GameDataKey;
  readonly readAt: string;
  /** What the tables name as their origin: the application and its version. */
  readonly generator: string;
  /** The parsed `info.json` of the loaded mods by name, as `readModInfos` returns it; a mod without one is listed by its name alone. */
  readonly modInfos?: ReadonlyMap<string, unknown>;
}

export interface BuiltGameData {
  readonly data: GameData;
  readonly iconTable: IconTable;
  /** Loaded mods whose `info.json` was not there or made no sense: they have no title and no dependencies. */
  readonly unreadMods: readonly string[];
  /** Records the game named no creator for, as "item iron-plate": they are there whatever modules are enabled. */
  readonly untagged: readonly string[];
}

/** What the game says it loaded; throws for a runtime dump that does not say. */
export const loadedMods = (dump: RawDump): ActiveMod[] => activeMods(dump.runtime);

/** Builds the three tables from a dump and has them accepted. Throws with the reason when the dump is not usable. */
export function buildGameData(dump: RawDump, { dataDirectory, game, key, readAt, generator, modInfos }: BuildOptions): BuiltGameData {
  const mods = loadedMods(dump);
  const { modules, unread } = singleSetModules(dataDirectory, mods, modInfos);
  const built = buildSingleSet({
    raw: dump.raw,
    runtime: dump.runtime,
    locale: singleSetLocale(dataDirectory, mods, dump.locale),
    modules,
    game: { version: game.version, build: game.build },
    generator,
    generatedAt: readAt,
  });
  const notes = built.notes.slice(0, GAME_DATA_LIMITS.notes).map((note) => note.slice(0, GAME_DATA_LIMITS.noteLength));
  const accepted = parseGameData({
    key: { ...key, version: game.version, build: game.build },
    readAt,
    mods,
    // Through JSON once: what is accepted is exactly what a file would hold.
    catalog: JSON.parse(JSON.stringify(built.catalog)) as unknown,
    icons: iconTableFile({ game: { version: game.version, build: game.build }, icons: built.icons }),
    entities: JSON.parse(JSON.stringify(built.entities)) as unknown,
    notes,
    skippedIcons: built.skippedIcons.length,
  });
  return { ...accepted, unreadMods: unread, untagged: built.untagged };
}
