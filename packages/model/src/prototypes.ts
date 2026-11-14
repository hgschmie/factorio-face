// The prototypes of the game that the editor has: which family of behaviour (`EntityKind`) each of them is, and its game data
// (size, rotation, wire reach, name) from the entity table of the game (`entityTable.ts`), which has every prototype a circuit
// wire connects to. A kind is a family of behaviour; a prototype is one member of it as the game names it in a blueprint (`name`).
// Ten prototypes have a kind of their own, by hand (`KIND_OF`). Every other prototype of the table is of the kind `entity` when
// its prototype type has a row of settings (`ENTITY_SETTINGS`): no list of names is involved, so a table of another game brings
// its own.

import type { EntityKind, EntitySettings } from "./circuit.ts";
import { ENTITY_SETTINGS, normalizeSettings, type SettingSpec } from "./entitySettings.ts";
import { hasOwnWireReach, STANDARD_ENTITY_TABLE, type EntityPrototype, type EntityTable } from "./entityTable.ts";

export interface PrototypeData {
  readonly kind: EntityKind;
  /** The game's English name in lower case, for messages: "a small electric pole". */
  readonly label: string;
  /** Tiles the entity covers when it faces north: width (west to east) x height (north to south). */
  readonly width: number;
  readonly height: number;
  /** Whether the entity can be turned. One that cannot always stands as `width` x `height` say. */
  readonly rotatable: boolean;
  /** It is built facing north or east only (the storage tank): south is north and west is east (`facingOf`). */
  readonly twoWay?: true;
  /** It stands anywhere, not on the tile grid (the land mine): every center is a place for it (`isTileCenter`). */
  readonly offGrid?: true;
  /** Its own wire reach in tiles (`hasOwnWireReach`: an electric pole's `maximum_wire_distance`). Absent: the wire reach of the project applies. */
  readonly wireReach?: number;
}

/** The kind of the prototypes that have one of their own, keyed by the game's prototype name. The first prototype of a kind is the one an entity of that kind is without saying which. */
const KIND_OF = {
  "constant-combinator": "constant",
  "arithmetic-combinator": "arithmetic",
  "decider-combinator": "decider",
  "selector-combinator": "selector",
  "small-lamp": "lamp",
  "small-electric-pole": "pole",
  "medium-electric-pole": "pole",
  "big-electric-pole": "pole",
  substation: "pole",
  "programmable-speaker": "speaker",
} as const satisfies Readonly<Record<string, EntityKind>>;

type DedicatedName = keyof typeof KIND_OF;
const DEDICATED_NAMES = Object.keys(KIND_OF) as readonly DedicatedName[];

/** The game's name of a prototype. A string: which names there are is data of the entity table (`isPrototypeName`). */
export type PrototypeName = string;

/** The prototypes of one kind: the names of the table above for a kind of its own, any name of the entity table for `entity`. */
export type PrototypeOfKind<K extends EntityKind> = K extends "entity" ? string : { [N in DedicatedName]: (typeof KIND_OF)[N] extends K ? N : never }[DedicatedName];

type PrototypeRows = { readonly [N in DedicatedName]: PrototypeData & { readonly kind: (typeof KIND_OF)[N] } } & Readonly<Record<string, PrototypeData>>;

/** The kind of a prototype of the table: its own, or `entity` when its type has settings; undefined for one the editor has nothing for. */
function kindOf(prototype: EntityPrototype): EntityKind | undefined {
  if (Object.hasOwn(KIND_OF, prototype.name)) return KIND_OF[prototype.name as DedicatedName];
  return Object.hasOwn(ENTITY_SETTINGS, prototype.type) ? "entity" : undefined;
}

/** The rows of `PROTOTYPES` from a table: the ten with a kind of their own first, then the others by name. Throws when the table lacks one of the ten. */
function rowsOf(table: EntityTable): [PrototypeName, PrototypeData][] {
  for (const name of DEDICATED_NAMES) if (!table.byName.has(name)) throw new Error(`The entity table of Factorio ${table.game.version} has no ${name}`);
  const generic = table.entities.filter((prototype) => kindOf(prototype) === "entity").map((prototype) => prototype.name);
  return [...DEDICATED_NAMES, ...generic].map((name): [PrototypeName, PrototypeData] => {
    const game = table.byName.get(name)!;
    const { displayName, width, height, directions, wireReach, offGrid } = game;
    return [name, { kind: kindOf(game)!, label: displayName.toLowerCase(), width, height, rotatable: directions > 1, ...(directions === 2 && { twoWay: true }), ...(offGrid && { offGrid: true }), ...(hasOwnWireReach(game) && { wireReach }) }];
  });
}

let table: EntityTable = STANDARD_ENTITY_TABLE;

/** The prototypes the editor has, keyed by the game's prototype name. Game data as in `entityTable()`. */
export const PROTOTYPES = {} as PrototypeRows;
/** Their names: the ten with a kind of their own in the order of their kinds, then the generic ones by name. */
export const PROTOTYPE_NAMES: readonly PrototypeName[] = [];
const BY_KIND = new Map<EntityKind, PrototypeName[]>();

function install(next: EntityTable): void {
  const rows = rowsOf(next);
  const store = PROTOTYPES as Record<string, PrototypeData>;
  for (const name of Object.keys(store)) delete store[name];
  BY_KIND.clear();
  for (const [name, data] of rows) {
    store[name] = data;
    BY_KIND.set(data.kind, [...(BY_KIND.get(data.kind) ?? []), name]);
  }
  (PROTOTYPE_NAMES as PrototypeName[]).splice(0, PROTOTYPE_NAMES.length, ...rows.map(([name]) => name));
  table = next;
}
install(table);

/** The game data the editor works with: every prototype a circuit wire connects to. */
export function entityTable(): EntityTable {
  return table;
}

/**
 * Replaces the game data, for a table read from the user's own game (`parseEntityTable`) in place of the standard one. The rows
 * of `PROTOTYPES`, and with them which generic prototypes there are, are replaced with it, so call it at start, before a circuit
 * is loaded: sizes and reaches already taken from a row do not follow. Throws, and changes nothing, when the table lacks one of
 * the prototypes that have a kind of their own.
 */
export function setEntityTable(next: EntityTable): void {
  install(next);
}

/** What decides the game prototype of an entity: its kind and, for a kind with several prototypes, which one. Every `Entity` is one. */
export interface EntityShape {
  readonly kind: EntityKind;
  readonly prototype?: PrototypeName;
}

/** Whether the editor has a prototype of this name. */
export function isPrototypeName(value: string): boolean {
  return Object.hasOwn(PROTOTYPES, value);
}

/** The prototypes of a kind; the first is the default, except for `entity`, which always says which one it is. */
export function prototypesOf<K extends EntityKind>(kind: K): readonly PrototypeOfKind<K>[] {
  // The map is filled by kind, which the compiler cannot follow for a generic K.
  return (BY_KIND.get(kind) ?? []) as readonly PrototypeName[] as readonly PrototypeOfKind<K>[];
}

/** The game prototype of an entity: the one it names if that is of its kind, else the first of its kind. */
export function prototypeOf(entity: EntityShape): PrototypeName {
  const named = entity.prototype;
  return named !== undefined && isPrototypeName(named) && PROTOTYPES[named]!.kind === entity.kind ? named : prototypesOf(entity.kind)[0]!;
}

export function prototypeData(entity: EntityShape): PrototypeData {
  return PROTOTYPES[prototypeOf(entity)]!;
}

/** The record of the entity table for an entity's prototype. */
export function gamePrototype(entity: EntityShape): EntityPrototype {
  return table.byName.get(prototypeOf(entity))!;
}

/** The circuit settings a prototype has, by its type (`ENTITY_SETTINGS`). None for a prototype with a kind of its own or one the editor does not have. */
export function settingSpecsOf(prototype: PrototypeName): readonly SettingSpec[] {
  const game = isPrototypeName(prototype) && PROTOTYPES[prototype]!.kind === "entity" ? table.byName.get(prototype) : undefined;
  return game ? ENTITY_SETTINGS[game.type]!.settings : [];
}

/** `normalizeSettings` for a prototype by name: its settings without defaults, in the order of its specs. */
export function normalizedSettings(prototype: PrototypeName, settings: EntitySettings): EntitySettings {
  const game = table.byName.get(prototype);
  return game ? normalizeSettings(settingSpecsOf(prototype), game, settings) : {};
}

/**
 * What a new entity is called before its number: the kind (`constant1`, `pole2`), and for a generic entity its prototype, which
 * says what it is: `fast_inserter1`, `steel_chest2`; a tier number at the end goes (`assembling_machine1` for assembling-machine-2).
 */
export function entityNameBase(entity: EntityShape): string {
  if (entity.kind !== "entity") return entity.kind;
  const base = prototypeOf(entity).replace(/-\d+$/, "").replace(/[^A-Za-z0-9_]/g, "_");
  // A name of another game's table may start with a digit, which an entity name cannot.
  return /^[0-9]/.test(base) ? `_${base}` : base;
}

/** "a lamp", "an arithmetic combinator". */
export function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}
