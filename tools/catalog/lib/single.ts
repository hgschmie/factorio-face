// The single-set mode: one dump of the game as its user has it, mods included, becomes a catalog, an icon table and an entity
// table in the formats the generator writes from its eight standard module sets. The app runs this on the dump it takes of
// the user's installation (apps/desktop/src/gameData); the records are built by the generator's own code (build.mjs,
// entities.mjs). Free of `import.meta` and of syntax that Node's type stripping cannot run.
//
// One dump cannot say what a record would be with fewer mods, so there is no `removedBy` and there are no `variants`: a record
// is as it is with everything loaded. Which mod adds it, the game says (`created` of the runtime dump, from
// `prototypes.get_history`): every record has that one mod as its `modules`. Two rules beside that. `core`, the engine's own
// data, is no module of the catalog and no game is without it: its records count as `base`'s. And a record whose creator is
// not among what the game had loaded (the game did not say, or a game without `base`) has `modules: []`: it is there whatever
// is enabled, so nothing is lost and nothing names a module the head does not have. `untagged` names those.
//
// For a recipe the creator is not enough: the recycler makes a recycling recipe for every item of every mod, and `base` the
// barrel recipes of every fluid. Such a recipe is there only with the mod of its item, so a recipe names, after its creator,
// the modules of what it consumes and produces (`recipeModules`). The same holds for an item that its creator makes of
// another mod's things, as `base` makes the barrel of every fluid: an item names, after its creator, what every recipe of
// that creator needs that produces it (`itemModules`). Every other record has its creator alone.
//
// An icon is in the icon table when every layer of it is an image file of the game's own modules or of a mod the game had
// loaded, named the way the table's parser takes it; the app reads a mod's file from the user's mod directory. Any other
// icon (a file of a mod that was not loaded, a path the table cannot hold) is left out and counted: an icon id the table
// lacks is answered like any unknown icon.
import type { CatalogData, ModuleInfo } from "@face/catalog";
import { iconTableFile, modFileLocation, parseIconTable, type IconEntry } from "@face/catalog/icons";
import { parseEntityTable } from "@face/model";
import { KINDS, LOCALE_SECTIONS, SPEAKER_LOCALE_SECTIONS, buildCatalog, type DumpSet } from "./build.mjs";
import { DUMP_COMMANDS, STANDARD_MODULES, gameArguments, modSetId, moduleInfo, readModuleInfos, type DumpCommand } from "./commands.ts";
import { buildEntityTable, type EntityTableFile } from "./entities.mjs";
import { readLocaleSections } from "./locale.mjs";

export interface ActiveMod {
  readonly name: string;
  readonly version: string;
}

export const SINGLE_SET_LIMITS = { mods: 2000, modNameLength: 100, modTitleLength: 200 } as const;
/** The engine's own data: what it creates counts as created by `base`. */
const CORE = "core";
const BASE = "base";
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
 * The head of the catalog for these mods: the game's own modules as their `info.json` below `dataDir` describes them, and a
 * mod as its own `info.json` does (`modInfos`: the parsed file by mod name, read by the caller and not trusted). A mod
 * without one, or with one that cannot be made sense of, is there by name and version alone, without dependencies, and is
 * named in `unread`. `requires` and `recommends` name loaded mods only: the lists are what the module list switches by.
 */
export function singleSetModules(dataDir: string, mods: readonly ActiveMod[], modInfos: ReadonlyMap<string, unknown> = new Map()): { modules: ModuleInfo[]; unread: string[] } {
  const own = new Map(readModuleInfos(dataDir, mods.map((mod) => mod.name).filter((name) => STANDARD_MODULES.includes(name))).map((info) => [info.name, info]));
  const loaded = new Set(mods.map((mod) => mod.name));
  const unread: string[] = [];
  const described = ({ name, version }: ActiveMod): ModuleInfo => {
    const info = modInfos.get(name);
    try {
      if (!isRecord(info)) throw new Error("no info");
      const module = moduleInfo(name, version, info);
      return { ...module, title: module.title.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim().slice(0, SINGLE_SET_LIMITS.modTitleLength) || name };
    } catch {
      unread.push(name);
      return { name, title: name, version, requires: [], recommends: [], featureFlags: [] };
    }
  };
  const modules = mods.map((mod) => own.get(mod.name) ?? described(mod)).map((module) => {
    const known = (names: readonly string[]): string[] => [...new Set(names)].filter((name) => name !== module.name && loaded.has(name));
    return { ...module, requires: known(module.requires), recommends: known(module.recommends) };
  });
  return { modules, unread };
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
  /** The icon table's content: every icon the catalog refers to that is made of image files of the game and of the loaded mods. */
  readonly icons: Map<string, IconEntry>;
  /** Icon ids the catalog refers to and the icon table lacks, sorted: a layer of each is no file the table can name. */
  readonly skippedIcons: string[];
  /** The entity table as its file has it, with the loaded mods and their versions in the head. */
  readonly entities: EntityTableFile & { readonly mods: Readonly<Record<string, string>> };
  /** Remarks for the user: wired entities that were left out and why. */
  readonly notes: string[];
  /** Records without a creator among the loaded mods, as "item iron-plate", sorted: they have `modules: []`. */
  readonly untagged: string[];
  readonly mods: ActiveMod[];
}

/** How entities.mjs begins the note for a wired entity it left out; its other notes are for the generator's log. */
const LEFT_OUT = "left out: ";
const commandTemplate = (command: DumpCommand): string => ["factorio", ...gameArguments("<run>/game/config/config.ini", "<run>/game/mods", DUMP_COMMANDS[command])].join(" ");

/**
 * What gives the records made from one list of the runtime dump their `modules`: the mod that created the prototype of the
 * record's name, by the rules at the top of this file. `untagged` collects what has none, under `label`.
 */
function tagger(runtime: Fields, loaded: ReadonlySet<string>, untagged: Set<string>) {
  return (section: string, label: string) => {
    const created = new Map(entries(runtime[section]).map((entry) => [entry.name, entry.created === CORE ? BASE : entry.created]));
    return <T extends { readonly name: string }>(record: T): T & { modules: string[] } => {
      const creator = created.get(record.name);
      if (typeof creator === "string" && loaded.has(creator)) return { ...record, modules: [creator] };
      untagged.add(`${label} ${record.name}`);
      return { ...record, modules: [] };
    };
  };
}

/** A record with the modules it is of. */
interface Tagged {
  readonly name: string;
  readonly modules: readonly string[];
}

/** The entries of a list of the runtime dump that are records; none for anything else (the game writes an empty list as `{}`). */
const entries = (list: unknown): Fields[] => (Array.isArray(list) ? list.filter(isRecord) : []);

/**
 * The recipes with the modules of their parts: after its creator a recipe names the module of every item and fluid among its
 * `ingredients` and `products` (`parts`: the modules by "item <name>" and "fluid <name>"), each once. `base` adds nothing, no
 * game is without it. Neither does a mod that changed the recipe after its creation (`changed`): the game does not say what the
 * recipe was before, and a recipe of `base` that Space Age gives another ingredient is there without Space Age. A recipe of a
 * dump without these lists keeps its creator alone.
 */
function recipeModules<T extends Tagged>(recipes: readonly T[], runtime: Fields, parts: ReadonlyMap<string, readonly string[]>): T[] {
  const facts = new Map(entries(runtime.recipe).map((entry) => [entry.name, entry]));
  return recipes.map((recipe) => {
    const fact = facts.get(recipe.name);
    const changed = Array.isArray(fact?.changed) ? fact.changed : [];
    const of = [...entries(fact?.ingredients), ...entries(fact?.products)].flatMap((part) => parts.get(`${String(part.type)} ${String(part.name)}`) ?? []);
    const added = of.filter((name) => name !== BASE && !changed.includes(name));
    return added.length === 0 ? recipe : { ...recipe, modules: [...new Set([...recipe.modules, ...added])] };
  });
}

/**
 * The items with the modules of the recipes that make them: after its creator an item names every module that all the recipes
 * of that same creator need which have it among their `products` (`recipes`: the recipes as `recipeModules` left them). So
 * the barrel that `base` makes for a mod's fluid is there only with the mod. What other mods make of an item says nothing
 * about it (the recycler has a recipe for every item, with the item among its products), and an item without a recipe of its
 * creator keeps its creator alone, as does one without a creator.
 */
function itemModules<T extends Tagged>(items: readonly T[], runtime: Fields, recipes: readonly Tagged[]): T[] {
  const needed = new Map(recipes.map((recipe) => [recipe.name, recipe.modules]));
  /** By the name of an item: the creator and the modules of every recipe that produces it. */
  const makers = new Map<unknown, { readonly creator: unknown; readonly modules: readonly string[] }[]>();
  for (const fact of entries(runtime.recipe)) {
    const maker = { creator: fact.created === CORE ? BASE : fact.created, modules: needed.get(String(fact.name)) ?? [] };
    for (const product of entries(fact.products)) {
      if (product.type !== "item") continue;
      const list = makers.get(product.name);
      if (list) list.push(maker);
      else makers.set(product.name, [maker]);
    }
  }
  return items.map((item) => {
    const [creator] = item.modules;
    const own = creator === undefined ? [] : (makers.get(item.name) ?? []).filter((maker) => maker.creator === creator);
    const added = own.length === 0 ? [] : own[0]!.modules.filter((name) => name !== creator && name !== BASE && own.every((maker) => maker.modules.includes(name)));
    return added.length === 0 ? item : { ...item, modules: [...item.modules, ...added] };
  });
}

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

  // No module of its own and no module algebra: the generator's code then has every record present "with no module
  // required", and each gets the mod that created it afterwards.
  const set: DumpSet = { id: "the dump", mods: [], raw: raw as DumpSet["raw"], runtime, locale };
  const input = { sets: [set], modules: [], game: { version: game.version, build: game.build } };
  const built = buildCatalog(input);
  const untagged = new Set<string>();
  const tagged = tagger(runtime, new Set(mods.map((mod) => mod.name)), untagged);
  // A speaker and a rocket silo are entities, and so is every record of the entity table.
  const ofEntity = tagged("entity", "entity");
  const signals = Object.fromEntries(KINDS.map(({ kind, section }) => [kind, (built.catalog.signals[kind] ?? []).map(tagged(section, kind))]));
  const parts = () => new Map(["item", "fluid"].flatMap((kind) => signals[kind]!.map((signal): [string, readonly string[]] => [`${kind} ${signal.name}`, signal.modules])));
  signals.recipe = recipeModules(signals.recipe!, runtime, parts());
  signals.item = itemModules(signals.item!, runtime, signals.recipe);
  // Once more with what the items gained: the recycling recipe of such a barrel needs the mod as the barrel does.
  signals.recipe = recipeModules(signals.recipe, runtime, parts());
  const catalog: CatalogData = {
    ...built.catalog,
    modules,
    constants: { ...built.catalog.constants, rocketSilos: built.catalog.constants.rocketSilos.map(ofEntity) },
    groups: built.catalog.groups.map(tagged("item_group", "group")),
    subgroups: built.catalog.subgroups.map(tagged("item_subgroup", "subgroup")),
    qualities: built.catalog.qualities.map(tagged("quality", "quality")),
    speakers: built.catalog.speakers?.map(ofEntity),
    signals,
    provenance: {
      generator,
      generatedAt,
      locale: "en",
      commands: (Object.keys(DUMP_COMMANDS) as DumpCommand[]).map(commandTemplate),
      modSets: [modSetId(mods.map((mod) => mod.name))],
      icons: "the icon table names the image files of the game and of the loaded mods that each icon is composited from",
    },
  };

  const icons = new Map<string, IconEntry>();
  const skippedIcons: string[] = [];
  const loaded = new Set(mods.map((mod) => mod.name));
  for (const [id, entry] of [...built.icons].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    try {
      // Through the app's own parser, one icon at a time: what it would refuse is left out, not the whole table.
      const [parsed] = parseIconTable(iconTableFile({ game: input.game, icons: new Map([[id, entry]]) })).icons.values();
      // The parser takes a file of any mod; an icon can only be drawn from the mods the game was read with.
      const named = parsed!.layers.flatMap(({ icon }) => modFileLocation(icon)?.mod ?? []);
      if (!named.every((mod) => loaded.has(mod))) throw new Error("a file of a mod that was not loaded");
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
  // As the file has it: a record of the table's default module does not say so.
  const usual = JSON.stringify(head.defaults.modules);
  const entityRecords = records.map(ofEntity).map(({ modules: creator, ...record }) => (JSON.stringify(creator) === usual ? record : { ...record, modules: creator }));
  const table = { ...head, mods: Object.fromEntries(mods.map((mod) => [mod.name, mod.version])), entities: entityRecords };
  return { catalog, icons, skippedIcons, entities: table, notes, untagged: [...untagged].sort(), mods };
}
