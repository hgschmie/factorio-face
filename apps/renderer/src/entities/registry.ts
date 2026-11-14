// The entity selector as data: which entities can be placed, in which group and in which order. The palette, its count, the
// digit keys and the icon probes read it; a further entity of the game is a name in a group here (and its row in `PROTOTYPES`
// of @face/model), a further category a group. Pure.
import { PROTOTYPES, prototypeOf, type EntityKind, type EntityShape, type PrototypeName } from "@face/model";
import { KIND_INFO, prototypeFacts, prototypeLabel } from "./kindInfo.ts";

interface GroupSpec {
  readonly id: string;
  readonly label: string;
  /** Always on show above the other groups, as full rows; it has no header and cannot be closed. */
  readonly pinned?: true;
  /** Whether the group is open until the user says otherwise. */
  readonly open?: boolean;
  /** Game prototype names, in the order of the palette. */
  readonly prototypes: readonly PrototypeName[];
}

/** In the order of the palette. The ids are stored with the open state of the groups, so they stay as they are. */
const GROUPS: readonly GroupSpec[] = [
  { id: "combinators", label: "Combinators", pinned: true, prototypes: ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"] },
  { id: "lights-and-sound", label: "Lights and sound", open: true, prototypes: ["small-lamp", "programmable-speaker"] },
  { id: "power-poles", label: "Power poles", open: false, prototypes: ["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"] },
];

/** Catalog icon ids of the prototypes whose icon is not the one of the item of the same name. */
const ICON_IDS: Readonly<Partial<Record<PrototypeName, string>>> = {};

/** The icon of a prototype below the catalog icon root, without extension: `item/big-electric-pole`. */
export function prototypeIconId(prototype: PrototypeName): string {
  return ICON_IDS[prototype] ?? `item/${prototype}`;
}

/** One entity the palette offers. */
export interface PaletteEntry {
  readonly kind: EntityKind;
  readonly prototype: PrototypeName;
  /** The name of the entity in the game: "Big electric pole". */
  readonly label: string;
  /** What the kind is for, as the full rows say it. */
  readonly description: string;
  /** The tiles and the wire reach of an entity that has a reach of its own: "2 x 2 tiles, wire reach 32"; empty otherwise. */
  readonly facts: string;
}

export interface PaletteGroup {
  readonly id: string;
  readonly label: string;
  readonly pinned: boolean;
  /** Open until the user says otherwise. A pinned group is always open. */
  readonly open: boolean;
  readonly entries: readonly PaletteEntry[];
}

function entryOf(prototype: PrototypeName): PaletteEntry {
  const shape = { kind: PROTOTYPES[prototype].kind, prototype };
  return { ...shape, label: prototypeLabel(shape), description: KIND_INFO[shape.kind].description, facts: prototypeFacts(shape) };
}

export const PALETTE_GROUPS: readonly PaletteGroup[] = GROUPS.map(({ id, label, pinned = false, open = false, prototypes }) => ({ id, label, pinned, open: pinned || open, entries: prototypes.map(entryOf) }));

export const PALETTE_ENTRIES: readonly PaletteEntry[] = PALETTE_GROUPS.flatMap((group) => group.entries);

/** The group that offers an entity, if any does. */
export function paletteGroupOf(entity: EntityShape): PaletteGroup | undefined {
  const prototype = prototypeOf(entity);
  return PALETTE_GROUPS.find((group) => group.entries.some((entry) => entry.prototype === prototype));
}

/**
 * "Entities in use": the entries of the entities a circuit contains, one per game prototype, in the order of the palette (so
 * an entry keeps its place whatever the order of the circuit). The pinned entries are left out: they are always on show.
 */
export function entriesInUse(entities: readonly EntityShape[]): readonly PaletteEntry[] {
  const used = new Set(entities.map(prototypeOf));
  return PALETTE_GROUPS.filter((group) => !group.pinned).flatMap((group) => group.entries.filter((entry) => used.has(entry.prototype)));
}

/**
 * The kinds the digit keys place, `1` for the first. A decision of the user: the four combinators and the lamp, as before the
 * palette had groups. Entities added later get no key.
 */
export const KEYED_KINDS = ["constant", "arithmetic", "decider", "selector", "lamp"] as const satisfies readonly EntityKind[];
export type KeyedKind = (typeof KEYED_KINDS)[number];

/** The kind whose key also places `entity`: the key of a kind places the first prototype of it. */
export function keyedKindOf(entity: EntityShape): KeyedKind | undefined {
  return KEYED_KINDS.find((kind) => kind === entity.kind && prototypeOf({ kind }) === prototypeOf(entity));
}
