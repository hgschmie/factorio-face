// The prototypes of the game that the editor has: which family of behaviour (`EntityKind`) each of them is, and its game data
// (size, rotation, wire reach, name) from the entity table of the game (`entityTable.ts`), which has every prototype a circuit
// wire connects to. A kind is a family of behaviour; a prototype is one member of it as the game names it in a blueprint (`name`).
// Six prototype types of the game have a kind of their own (`KIND_OF_TYPE`: the combinators, the lamp, the electric pole), so every
// prototype of such a type has it, a modded one like a standard one. The speaker has its kind by name: its instruments are data
// of the one prototype. Every other prototype of the table is of the kind `entity` when its prototype type has a row of settings
// (`ENTITY_SETTINGS`). No list of names decides what there is, so a table of another game brings its own.

import type { EntityKind, EntitySettings } from "./circuit.ts";
import { ENTITY_SETTINGS, normalizeSettings, type SettingSpec } from "./entitySettings.ts";
import { hasOwnWireReach, STANDARD_ENTITY_TABLE, type BoxEdges, type EntityPrototype, type EntityTable } from "./entityTable.ts";

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
  /** The game's selection box around the center, facing north, where it is not the tiles the entity covers (`selectionBox` in footprint.ts). */
  readonly selectionBox?: BoxEdges;
}

/** The prototype types whose every prototype has a kind of its own: the behaviour is the type's, whatever a mod names or sizes it. */
const KIND_OF_TYPE: Readonly<Record<string, EntityKind>> = {
  "constant-combinator": "constant",
  "arithmetic-combinator": "arithmetic",
  "decider-combinator": "decider",
  "selector-combinator": "selector",
  lamp: "lamp",
  "electric-pole": "pole",
};

/** The one prototype type whose kind goes by name: the instruments and notes of a speaker are those of the standard prototype, which the entity table does not have per prototype. */
const SPEAKER = { type: "programmable-speaker", name: "programmable-speaker" } as const;

/**
 * The standard prototypes with a kind of their own, which every table has to have. The first of a kind is the one an entity of
 * that kind is without saying which, in a table with further prototypes of the kind as well.
 */
const STANDARD_KIND = {
  "constant-combinator": "constant",
  "arithmetic-combinator": "arithmetic",
  "decider-combinator": "decider",
  "selector-combinator": "selector",
  "small-lamp": "lamp",
  "small-electric-pole": "pole",
  "medium-electric-pole": "pole",
  "big-electric-pole": "pole",
  substation: "pole",
  [SPEAKER.name]: "speaker",
} as const satisfies Readonly<Record<string, EntityKind>>;

const STANDARD_NAMES: readonly string[] = Object.keys(STANDARD_KIND);

/** The game's name of a prototype. A string: which names there are is data of the entity table (`isPrototypeName`). */
export type PrototypeName = string;

/** The kind of a prototype of the table: the one of its type, or `entity` when its type has settings; undefined for one the editor has nothing for. */
function kindOf(prototype: EntityPrototype): EntityKind | undefined {
  if (Object.hasOwn(KIND_OF_TYPE, prototype.type)) return KIND_OF_TYPE[prototype.type];
  if (prototype.type === SPEAKER.type) return prototype.name === SPEAKER.name ? "speaker" : undefined;
  return Object.hasOwn(ENTITY_SETTINGS, prototype.type) ? "entity" : undefined;
}

/**
 * The standard prototypes with a kind of their own that a table lacks, or has as something else: none for a table the editor
 * can work with. `setEntityTable` throws for any other one, so whoever takes a table from elsewhere (a user's own game) asks
 * here first.
 */
export function missingEditorPrototypes(table: EntityTable): string[] {
  return STANDARD_NAMES.filter((name) => {
    const game = table.byName.get(name);
    return !game || kindOf(game) !== STANDARD_KIND[name as keyof typeof STANDARD_KIND];
  });
}

/**
 * The rows of `PROTOTYPES` from a table: the ten standard ones with a kind of their own first, then the others by name, so the
 * standard prototype is the first of its kind. Throws when the table lacks one of the ten.
 */
function rowsOf(table: EntityTable): [PrototypeName, PrototypeData][] {
  const [missing] = missingEditorPrototypes(table);
  if (missing !== undefined) throw new Error(`The entity table of Factorio ${table.game.version} has no ${missing}`);
  const others = table.entities.filter((prototype) => !Object.hasOwn(STANDARD_KIND, prototype.name) && kindOf(prototype) !== undefined).map((prototype) => prototype.name);
  return [...STANDARD_NAMES, ...others].map((name): [PrototypeName, PrototypeData] => {
    const game = table.byName.get(name)!;
    const { displayName, width, height, directions, wireReach, offGrid, selectionBox } = game;
    const optional = { ...(directions === 2 && { twoWay: true as const }), ...(offGrid && { offGrid: true as const }), ...(hasOwnWireReach(game) && { wireReach }), ...(selectionBox && { selectionBox }) };
    return [name, { kind: kindOf(game)!, label: displayName.toLowerCase(), width, height, rotatable: directions > 1, ...optional }];
  });
}

let table: EntityTable = STANDARD_ENTITY_TABLE;

/** The prototypes the editor has, keyed by the game's prototype name. Game data as in `entityTable()`. */
export const PROTOTYPES: Readonly<Record<PrototypeName, PrototypeData>> = {};
/** Their names: the ten standard ones with a kind of their own in the order of their kinds, then the others by name. */
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
 * the standard prototypes that have a kind of their own.
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
export function prototypesOf(kind: EntityKind): readonly PrototypeName[] {
  return BY_KIND.get(kind) ?? [];
}

/** The game prototype of an entity: the one it names if that is of its kind, else the first of its kind. */
export function prototypeOf(entity: EntityShape): PrototypeName {
  const named = entity.prototype;
  return named !== undefined && isPrototypeName(named) && PROTOTYPES[named]!.kind === entity.kind ? named : prototypesOf(entity.kind)[0]!;
}

/**
 * What an entity of `kind` holds as its `prototype` when it is the game prototype `name`: the name, and nothing for the first of
 * a kind, which goes without saying. A pole and a generic entity always say which one they are.
 */
export function heldPrototype(kind: EntityKind, name: PrototypeName): PrototypeName | undefined {
  return kind === "pole" || kind === "entity" || name !== prototypesOf(kind)[0] ? name : undefined;
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
 * What a new entity is called before its number: the kind (`constant1`, `pole2`) whichever prototype of it, and for a generic
 * entity its prototype, which says what it is: `fast_inserter1`, `steel_chest2`; a tier number at the end goes
 * (`assembling_machine1` for assembling-machine-2).
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
