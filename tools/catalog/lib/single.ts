// The single-set mode: one dump of the game as its user has it, mods included, becomes a catalog, an icon table and an entity
// table in the formats the generator writes from its eight standard module sets. The app runs this on the dump it takes of
// the user's installation (apps/desktop/src/gameData); the records are built by the generator's own code (build.mjs,
// entities.mjs). Free of `import.meta` and of syntax that Node's type stripping cannot run.
//
// What one dump cannot say is which module adds a record, so every record is there with any modules enabled (`modules: []`,
// no `removedBy`, no `variants`), and the head lists what the game had loaded. Icons that are not made of image files of the
// game's own modules (a mod's) are left out of the icon table: the app has nowhere to read them from, and an icon id the table
// lacks is answered like any unknown icon.
import type { CatalogData, ModuleInfo } from "@face/catalog";
import { iconTableFile, parseIconTable, type IconEntry } from "@face/catalog/icons";
import { parseEntityTable } from "@face/model";
import { LOCALE_SECTIONS, SPEAKER_LOCALE_SECTIONS, buildCatalog, type DumpSet } from "./build.mjs";
import { DUMP_COMMANDS, STANDARD_MODULES, gameArguments, modSetId, readModuleInfos, type DumpCommand } from "./commands.ts";
import { buildEntityTable, type EntityTableFile } from "./entities.mjs";
import { readLocaleSections } from "./locale.mjs";

export interface ActiveMod {
  readonly name: string;
  readonly version: string;
}

export const SINGLE_SET_LIMITS = { mods: 2000, modNameLength: 100 } as const;
const MOD_VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;

type Fields = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

/** The file below `script-output` with the display names of one locale section, as `--dump-prototype-locale` writes it. */
export const localeDumpFile = (section: string): string => `${section}-locale.json`;
/** The sections whose files the build reads. */
export const LOCALE_DUMP_SECTIONS: readonly string[] = LOCALE_SECTIONS;

/**
 * What the game had loaded, by its own account (`active_mods` of the runtime dump): its modules in their usual order, then
 * the mods by name. Throws for anything that is not such a list.
 */
export function activeMods(runtime: unknown): ActiveMod[] {
  const active = isRecord(runtime) ? runtime.active_mods : undefined;
  if (!isRecord(active)) throw new Error("The runtime dump does not say which mods were loaded");
  const names = Object.keys(active);
  if (names.length === 0 || names.length > SINGLE_SET_LIMITS.mods) throw new Error(`The runtime dump lists ${names.length} mods`);
  const mods = names.map((name) => {
    const version = active[name];
    if (name.length > SINGLE_SET_LIMITS.modNameLength || !/^[A-Za-z0-9_ .-]+$/.test(name) || typeof version !== "string" || !MOD_VERSION.test(version)) throw new Error(`The runtime dump lists a malformed mod: ${JSON.stringify(name.slice(0, 120))}`);
    return { name, version };
  });
  const rank = (name: string): number => (STANDARD_MODULES.includes(name) ? STANDARD_MODULES.indexOf(name) : STANDARD_MODULES.length);
  return mods.sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The head of the catalog for these mods: the game's own modules as their `info.json` below `dataDir` describes them, a mod
 * by name and version alone (its `info.json` is inside its archive, which is not read).
 */
export function singleSetModules(dataDir: string, mods: readonly ActiveMod[]): ModuleInfo[] {
  const own = new Map(readModuleInfos(dataDir, mods.map((mod) => mod.name).filter((name) => STANDARD_MODULES.includes(name))).map((info) => [info.name, info]));
  return mods.map(({ name, version }) => own.get(name) ?? { name, title: name, version, requires: [], recommends: [], featureFlags: [] });
}

/**
 * The display names the build needs: per section the `names` of the file the game dumped (`dumped`: the parsed files by
 * section, absent ones left out), and for the speaker's instruments and notes, which are no prototypes, the locale files of
 * the game's own modules below `dataDir`. A mod's instruments keep their prototype names.
 */
export function singleSetLocale(dataDir: string, mods: readonly ActiveMod[], dumped: Readonly<Record<string, unknown>>): Record<string, Record<string, string>> {
  const locale = readLocaleSections(dataDir, mods.map((mod) => mod.name).filter((name) => STANDARD_MODULES.includes(name)), SPEAKER_LOCALE_SECTIONS);
  for (const section of LOCALE_DUMP_SECTIONS) {
    const file = dumped[section];
    const names = isRecord(file) ? file.names : undefined;
    if (isRecord(names)) locale[section] = Object.fromEntries(Object.entries(names).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }
  return locale;
}

export interface SingleSetInput {
  /** `data-raw-dump.json`, parsed. */
  readonly raw: unknown;
  /** `face-runtime-dump.json`, parsed. */
  readonly runtime: unknown;
  /** As `singleSetLocale` returns it. */
  readonly locale: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** As `singleSetModules` returns it. */
  readonly modules: readonly ModuleInfo[];
  readonly game: { readonly version: string; readonly build: number };
  /** What the heads name as their origin. */
  readonly generator: string;
  /** ISO time for the catalog's provenance. */
  readonly generatedAt: string;
}

export interface SingleSet {
  readonly catalog: CatalogData;
  /** The icon table's content: every icon the catalog refers to that is made of the game's own image files. */
  readonly icons: Map<string, IconEntry>;
  /** Icon ids the catalog refers to and the icon table lacks, sorted. */
  readonly skippedIcons: string[];
  /** The entity table as its file has it, with the loaded mods and their versions in the head. */
  readonly entities: EntityTableFile & { readonly mods: Readonly<Record<string, string>> };
  /** Remarks for the user: wired entities that were left out and why. */
  readonly notes: string[];
  readonly mods: ActiveMod[];
}

/** How entities.mjs begins the note for a wired entity it left out; its other notes are for the generator's log. */
const LEFT_OUT = "left out: ";
const commandTemplate = (command: DumpCommand): string => ["factorio", ...gameArguments("<run>/game/config/config.ini", "<run>/game/mods", DUMP_COMMANDS[command])].join(" ");

/**
 * Builds the three tables from one dump. Throws when the dump is not what the three commands write for one and the same
 * game, with the reason; a wired entity that cannot be derived, or that the game contradicts, is left out and named in `notes`.
 */
export function buildSingleSet({ raw, runtime, locale, modules, game, generator, generatedAt }: SingleSetInput): SingleSet {
  if (!isRecord(raw) || !Object.values(raw).every(isRecord)) throw new Error("The data dump is not a table of prototypes by type");
  if (!isRecord(runtime)) throw new Error("The runtime dump is not a table");
  const mods = activeMods(runtime);
  if (runtime.game_version !== game.version) throw new Error(`The runtime dump is from ${JSON.stringify(runtime.game_version)}, the game is ${game.version}`);
  if (modSetId(modules.map((module) => module.name)) !== modSetId(mods.map((mod) => mod.name))) throw new Error("The modules of the head are not the mods the game loaded");

  // No module of its own and no module algebra: every record is then present "with no module required".
  const set: DumpSet = { id: "the dump", mods: [], raw: raw as DumpSet["raw"], runtime, locale };
  const input = { sets: [set], modules: [], game: { version: game.version, build: game.build } };
  const built = buildCatalog(input);
  const catalog: CatalogData = {
    ...built.catalog,
    modules,
    // The quality list drops empty fields, the module list among them.
    qualities: built.catalog.qualities.map((quality) => ({ ...quality, modules: [] })),
    provenance: {
      generator,
      generatedAt,
      locale: "en",
      commands: (Object.keys(DUMP_COMMANDS) as DumpCommand[]).map(commandTemplate),
      modSets: [modSetId(mods.map((mod) => mod.name))],
      icons: "the icon table names the image files of the game that each icon is composited from; icons of mods are not in it",
    },
  };

  const icons = new Map<string, IconEntry>();
  const skippedIcons: string[] = [];
  for (const [id, entry] of [...built.icons].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    try {
      // Through the app's own parser, one icon at a time: what it would refuse is left out, not the whole table.
      parseIconTable(iconTableFile({ game: input.game, icons: new Map([[id, entry]]) }));
      icons.set(id, entry);
    } catch {
      skippedIcons.push(id);
    }
  }

  const entities = buildEntityTable(input, { lenient: true, generator });
  const { entities: derived, ...head } = entities.table;
  const notes = entities.notes.filter((note) => note.startsWith(LEFT_OUT));
  // Through the app's own reader, one record at a time, like the icons: what it would refuse (a default signal whose name is
  // none the editor can hold) is left out and named, not the whole table.
  const records = derived.filter((record) => {
    try {
      parseEntityTable({ ...head, entities: [record] });
      return true;
    } catch (error) {
      notes.push(`${LEFT_OUT}${error instanceof Error ? error.message.replace(/^Entity table: /, "") : String(error)}`);
      return false;
    }
  });
  return { catalog, icons, skippedIcons, entities: { ...head, mods: Object.fromEntries(mods.map((mod) => [mod.name, mod.version])), entities: records }, notes, mods };
}
