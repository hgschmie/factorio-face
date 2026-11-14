// The prototypes of the game that the editor has: which family of behaviour (`EntityKind`) each of them is, by hand, and its
// game data (size, rotation, wire reach, name) from the entity table of the game (`entityTable.ts`), which has every prototype a
// circuit wire connects to. A kind is a family of behaviour; a prototype is one member of it as the game names it in a blueprint
// (`name`). Adding an entity of an existing family is a line in `KIND_OF`.

import type { EntityKind } from "./circuit.ts";
import { hasOwnWireReach, STANDARD_ENTITY_TABLE, type EntityTable } from "./entityTable.ts";

export interface PrototypeData {
  readonly kind: EntityKind;
  /** The game's English name in lower case, for messages: "a small electric pole". */
  readonly label: string;
  /** Tiles the entity covers when it faces north: width (west to east) x height (north to south). */
  readonly width: number;
  readonly height: number;
  /** Whether the entity can be turned. One that cannot always stands as `width` x `height` say. */
  readonly rotatable: boolean;
  /** Its own wire reach in tiles (`hasOwnWireReach`: an electric pole's `maximum_wire_distance`). Absent: the wire reach of the project applies. */
  readonly wireReach?: number;
}

/** The kind of every prototype the editor has, keyed by the game's prototype name. The first prototype of a kind is the one an entity of that kind is without saying which. */
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

export type PrototypeName = keyof typeof KIND_OF;
export const PROTOTYPE_NAMES = Object.keys(KIND_OF) as readonly PrototypeName[];

/** The prototypes of one kind. */
export type PrototypeOfKind<K extends EntityKind> = { [N in PrototypeName]: (typeof KIND_OF)[N] extends K ? N : never }[PrototypeName];

type PrototypeRows = { readonly [N in PrototypeName]: PrototypeData & { readonly kind: (typeof KIND_OF)[N] } };

/** The rows of `PROTOTYPES` from a table. Throws when the table lacks a prototype the editor has. */
function rowsOf(table: EntityTable): PrototypeRows {
  const rows = PROTOTYPE_NAMES.map((name): [PrototypeName, PrototypeData] => {
    const game = table.byName.get(name);
    if (!game) throw new Error(`The entity table of Factorio ${table.game.version} has no ${name}`);
    const { displayName, width, height, directions, wireReach } = game;
    return [name, { kind: KIND_OF[name], label: displayName.toLowerCase(), width, height, rotatable: directions > 1, ...(hasOwnWireReach(game) && { wireReach }) }];
  });
  // Built name by name, which the compiler cannot follow to the kind of each row.
  return Object.fromEntries(rows) as unknown as PrototypeRows;
}

let table: EntityTable = STANDARD_ENTITY_TABLE;

/** The prototypes the editor has, keyed by the game's prototype name, in the order of their kinds. Game data as in `entityTable()`. */
export const PROTOTYPES: PrototypeRows = rowsOf(table);

/** The game data the editor works with: every prototype a circuit wire connects to, also those the editor has no kind for yet. */
export function entityTable(): EntityTable {
  return table;
}

/**
 * Replaces the game data, for a table read from the user's own game (`parseEntityTable`) in place of the standard one. The rows
 * of `PROTOTYPES` are replaced with it, so call it at start, before a circuit is loaded: sizes and reaches already taken from a
 * row do not follow. Throws, and changes nothing, when the table lacks a prototype the editor has.
 */
export function setEntityTable(next: EntityTable): void {
  Object.assign(PROTOTYPES, rowsOf(next));
  table = next;
}

/** What decides the game prototype of an entity: its kind and, for a kind with several prototypes, which one. Every `Entity` is one. */
export interface EntityShape {
  readonly kind: EntityKind;
  readonly prototype?: PrototypeName;
}

export function isPrototypeName(value: string): value is PrototypeName {
  return Object.hasOwn(KIND_OF, value);
}

const BY_KIND = new Map<EntityKind, PrototypeName[]>();
for (const name of PROTOTYPE_NAMES) BY_KIND.set(KIND_OF[name], [...(BY_KIND.get(KIND_OF[name]) ?? []), name]);

/** The prototypes of a kind in table order; the first is the default. */
export function prototypesOf<K extends EntityKind>(kind: K): readonly PrototypeOfKind<K>[] {
  // The map is filled by kind, which the compiler cannot follow for a generic K.
  return (BY_KIND.get(kind) ?? []) as readonly PrototypeName[] as readonly PrototypeOfKind<K>[];
}

/** The game prototype of an entity: the one it names if that is of its kind, else the first of its kind. */
export function prototypeOf(entity: EntityShape): PrototypeName {
  const named = entity.prototype;
  return named !== undefined && isPrototypeName(named) && KIND_OF[named] === entity.kind ? named : prototypesOf(entity.kind)[0]!;
}

export function prototypeData(entity: EntityShape): PrototypeData {
  return PROTOTYPES[prototypeOf(entity)];
}

/** "a lamp", "an arithmetic combinator". */
export function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}
