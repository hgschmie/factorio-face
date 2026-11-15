// The entity selector as data: which entities can be placed, in which group and in which order. It is a function of the game
// data: the signal catalog says in which item group and subgroup an entity is and where in it, the entity table which entities
// there are, and the enabled modules which of them the project has. No prototype is named here: a further entity of the game is
// its record in the two tables. The palette, its count, the digit keys and the icon probes read it. Pure.
import { isAvailable, pickerTree, type Catalog } from "@face/catalog";
import { entityTable, PROTOTYPES, prototypeData, prototypesOf, type EntityKind, type EntityShape, type EntityTable, type PrototypeName } from "@face/model";
import { entityDescription, prototypeFacts, prototypeLabel } from "./kindInfo.ts";

/**
 * The icon of a prototype below the catalog icon root, without extension: `item/big-electric-pole`. It is the icon of the item
 * that places the entity, which for all but a few has the entity's name (`placedBy` of the entity table). A prototype without
 * such an item (four chests of the game's editor) gets an id nothing is served for and keeps its pictogram.
 */
export function prototypeIconId(prototype: PrototypeName): string {
  return `item/${entityTable().byName.get(prototype)?.placedBy[0] ?? prototype}`;
}

/** One entity the palette offers. */
export interface PaletteEntry {
  readonly kind: EntityKind;
  readonly prototype: PrototypeName;
  /** The name of the entity in the game: "Big electric pole". */
  readonly label: string;
  /** What the entity is on a circuit for: of its kind, or of its prototype type. */
  readonly description: string;
  /** Its tiles and, where it has one of its own, its wire reach: "2 x 2 tiles, wire reach 32", "1 tile". */
  readonly facts: string;
}

/** A subgroup of the game's items: one block of rows in a tab. It has no name in the game. */
export interface PaletteSubgroup {
  readonly name: string;
  readonly entries: readonly PaletteEntry[];
}

/** An item group of the game that has entities to place: one tab. */
export interface PaletteGroup {
  readonly name: string;
  /** The name of the group in the game: "Logistics". */
  readonly label: string;
  /** Catalog icon id of the group: `group/logistics`. */
  readonly icon: string;
  readonly subgroups: readonly PaletteSubgroup[];
}

/** The prototype of the game itself among those of a kind with its own behaviour: `small-lamp` of the lamps, whatever a mod adds. */
export function standardPrototype(kind: Exclude<EntityKind, "entity">): PrototypeName {
  return prototypesOf(kind)[0]!;
}

/**
 * The kinds that are always on show above everything else, in this order: a decision of the user (the combinators stay in view).
 * Shown is the standard prototype of each; all their prototypes are also in their subgroup of the game, like every other entity.
 */
export const PINNED_KINDS = ["constant", "arithmetic", "decider", "selector"] as const satisfies readonly EntityKind[];

/** What the selector offers for one set of modules. */
export interface EntityRegistry {
  /** The first row: always on show. */
  readonly pinned: readonly PaletteEntry[];
  /** The tabs in the game's order, each with its subgroups and their entries in the game's order. Hidden prototypes are in none. */
  readonly groups: readonly PaletteGroup[];
  /** Every entry that is offered, once: the pinned ones, then the others in the order of the groups. */
  readonly entries: readonly PaletteEntry[];
  /** The entry of a prototype the editor has, offered or not (a hidden one, one of a module that is off); undefined for a name it does not have. */
  entry(prototype: PrototypeName): PaletteEntry | undefined;
  /** Whether the selector offers the prototype: it exists for the modules and the game does not hide it. */
  offers(prototype: PrototypeName): boolean;
  /** The name of the group whose tab holds the tile of a prototype. */
  groupOf(prototype: PrototypeName): string | undefined;
  /** Where a prototype comes in the game's order of everything, offered or not; the ones the catalog does not have for these modules last, by name. */
  position(prototype: PrototypeName): number;
}

function entryOf(prototype: PrototypeName): PaletteEntry {
  const shape = { prototype };
  return { kind: prototypeData(shape).kind, prototype, label: prototypeLabel(shape), description: entityDescription(shape), facts: prototypeFacts(shape) };
}

/**
 * The selector for the modules `enabled`. The game sorts what can be built as it sorts the items that build it: by item group,
 * subgroup and order string, which the catalog has for every entity (its signals of kind `entity`; `pickerTree` puts them in
 * that order with the changes a module makes, as it does for the signal picker). Of those the entity table says which ones a
 * circuit wire connects to, which the game hides (the chests of its editor, the loaders) and which module adds them.
 * A module set the catalog cannot order (a hand-edited project file) leaves the groups empty; the pinned row stays.
 */
export function entityRegistry(catalog: Catalog, table: EntityTable, enabled: Iterable<string>): EntityRegistry {
  const active = new Set(enabled);
  const has = (name: string): boolean => Object.hasOwn(PROTOTYPES, name) && table.byName.has(name);
  const byPrototype = new Map<PrototypeName, PaletteEntry>();
  const entry = (prototype: PrototypeName): PaletteEntry | undefined => {
    if (!has(prototype)) return undefined;
    let found = byPrototype.get(prototype);
    if (!found) byPrototype.set(prototype, (found = entryOf(prototype)));
    return found;
  };
  let tree: ReturnType<typeof pickerTree> = [];
  try {
    tree = pickerTree(catalog, active, { kinds: ["entity"], hidden: true, wildcards: false });
  } catch {
    // Signals without their group: nothing consistent to order by.
  }
  const positions = new Map<PrototypeName, number>();
  const tabs = new Map<PrototypeName, string>();
  const groups: PaletteGroup[] = [];
  for (const { group, subgroups } of tree) {
    const shown: PaletteSubgroup[] = [];
    for (const { subgroup, signals } of subgroups) {
      const entries: PaletteEntry[] = [];
      for (const { name } of signals) {
        const game = table.byName.get(name);
        if (!game || !has(name) || !isAvailable(game, active)) continue;
        positions.set(name, positions.size);
        if (game.hidden) continue;
        entries.push(entry(name)!);
        tabs.set(name, group.name);
      }
      if (entries.length > 0) shown.push({ name: subgroup.name, entries });
    }
    if (shown.length > 0) groups.push({ name: group.name, label: group.displayName, icon: group.icon, subgroups: shown });
  }
  const pinned = PINNED_KINDS.map((kind) => entry(standardPrototype(kind))!);
  const grouped = groups.flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.entries));
  const unordered = table.entities.map((game) => game.name).filter((name) => !positions.has(name));
  return {
    pinned,
    groups,
    entries: [...pinned, ...grouped.filter((candidate) => !pinned.includes(candidate))],
    entry,
    offers: (prototype) => tabs.has(prototype),
    groupOf: (prototype) => tabs.get(prototype),
    position: (prototype) => positions.get(prototype) ?? positions.size + unordered.indexOf(prototype),
  };
}

/**
 * "Entities in use": the entries of the entities a circuit contains, one per game prototype, in the game's order (so an entry
 * keeps its place whatever the order of the circuit). The pinned entries are left out: they are always on show. A prototype the
 * selector does not offer (a hidden one from a blueprint, one of a module that is off) is among them: the circuit has it.
 */
export function entriesInUse(registry: EntityRegistry, entities: readonly EntityShape[]): readonly PaletteEntry[] {
  const used = [...new Set(entities.map((entity) => entity.prototype))].flatMap((prototype) => registry.entry(prototype) ?? []);
  return used.filter((entry) => !registry.pinned.includes(entry)).sort((a, b) => registry.position(a.prototype) - registry.position(b.prototype));
}

/**
 * The groups with the entries a search finds: those whose name in the game or whose prototype name contains the text, whatever
 * its case. Groups and subgroups without a match are left out; an empty text finds everything.
 */
export function searchEntries(groups: readonly PaletteGroup[], text: string): readonly PaletteGroup[] {
  const query = text.trim().toLowerCase();
  if (query === "") return groups;
  const matches = (entry: PaletteEntry): boolean => entry.label.toLowerCase().includes(query) || entry.prototype.includes(query);
  return groups.flatMap((group) => {
    const subgroups = group.subgroups.map((subgroup) => ({ ...subgroup, entries: subgroup.entries.filter(matches) })).filter((subgroup) => subgroup.entries.length > 0);
    return subgroups.length > 0 ? [{ ...group, subgroups }] : [];
  });
}

/**
 * The kinds the digit keys place, `1` for the first. A decision of the user: the four combinators and the lamp, as before the
 * palette had groups. Entities added later get no key.
 */
export const KEYED_KINDS = ["constant", "arithmetic", "decider", "selector", "lamp"] as const satisfies readonly EntityKind[];
export type KeyedKind = (typeof KEYED_KINDS)[number];

/** The kind whose key also places `entity`: the key of a kind places the standard prototype of it. */
export function keyedKindOf(entity: EntityShape): KeyedKind | undefined {
  return KEYED_KINDS.find((kind) => standardPrototype(kind) === entity.prototype);
}
