// Game data per entity prototype: one row per prototype of the game that the editor has. A kind (`EntityKind`) is a family of
// behaviour; a prototype is one member of it as the game names it in a blueprint (`name`). Adding an entity of an existing
// family is a row here. Sources: docs/factorio-audit.md 3.1 (combinators, lamp), 3.9 (electric poles), 3.10 (speaker).

import type { EntityKind } from "./circuit.ts";

export interface PrototypeData {
  readonly kind: EntityKind;
  /** The game's English name in lower case, for messages: "a small electric pole". */
  readonly label: string;
  /** Tiles the entity covers when it faces north: width (west to east) x height (north to south). */
  readonly width: number;
  readonly height: number;
  /** Whether the entity can be turned. One that cannot always stands as `width` x `height` say. */
  readonly rotatable: boolean;
  /** Its own wire reach in tiles (an electric pole's `maximum_wire_distance`). Absent: the wire reach of the project applies. */
  readonly wireReach?: number;
}

/** Keyed by the game's prototype name. The first prototype of a kind is the one an entity of that kind is without saying which. */
export const PROTOTYPES = {
  "constant-combinator": { kind: "constant", label: "constant combinator", width: 1, height: 1, rotatable: true },
  "arithmetic-combinator": { kind: "arithmetic", label: "arithmetic combinator", width: 1, height: 2, rotatable: true },
  "decider-combinator": { kind: "decider", label: "decider combinator", width: 1, height: 2, rotatable: true },
  "selector-combinator": { kind: "selector", label: "selector combinator", width: 1, height: 2, rotatable: true },
  "small-lamp": { kind: "lamp", label: "lamp", width: 1, height: 1, rotatable: false },
  "small-electric-pole": { kind: "pole", label: "small electric pole", width: 1, height: 1, rotatable: false, wireReach: 7.5 },
  "medium-electric-pole": { kind: "pole", label: "medium electric pole", width: 1, height: 1, rotatable: false, wireReach: 9 },
  "big-electric-pole": { kind: "pole", label: "big electric pole", width: 2, height: 2, rotatable: false, wireReach: 32 },
  // 18 is from the game's data dump; the recording F-24 does not have the substation yet (tools/game-probe/wire-reach.mjs asks for it).
  substation: { kind: "pole", label: "substation", width: 2, height: 2, rotatable: false, wireReach: 18 },
  "programmable-speaker": { kind: "speaker", label: "programmable speaker", width: 1, height: 1, rotatable: false },
} as const satisfies Readonly<Record<string, PrototypeData>>;

export type PrototypeName = keyof typeof PROTOTYPES;
export const PROTOTYPE_NAMES = Object.keys(PROTOTYPES) as readonly PrototypeName[];

/** The prototypes of one kind. */
export type PrototypeOfKind<K extends EntityKind> = { [N in PrototypeName]: (typeof PROTOTYPES)[N]["kind"] extends K ? N : never }[PrototypeName];

/** What decides the game prototype of an entity: its kind and, for a kind with several prototypes, which one. Every `Entity` is one. */
export interface EntityShape {
  readonly kind: EntityKind;
  readonly prototype?: PrototypeName;
}

export function isPrototypeName(value: string): value is PrototypeName {
  return Object.hasOwn(PROTOTYPES, value);
}

const BY_KIND = new Map<EntityKind, PrototypeName[]>();
for (const name of PROTOTYPE_NAMES) BY_KIND.set(PROTOTYPES[name].kind, [...(BY_KIND.get(PROTOTYPES[name].kind) ?? []), name]);

/** The prototypes of a kind in table order; the first is the default. */
export function prototypesOf<K extends EntityKind>(kind: K): readonly PrototypeOfKind<K>[] {
  // The map is filled by kind, which the compiler cannot follow for a generic K.
  return (BY_KIND.get(kind) ?? []) as readonly PrototypeName[] as readonly PrototypeOfKind<K>[];
}

/** The game prototype of an entity: the one it names if that is of its kind, else the first of its kind. */
export function prototypeOf(entity: EntityShape): PrototypeName {
  const named = entity.prototype;
  return named !== undefined && isPrototypeName(named) && PROTOTYPES[named].kind === entity.kind ? named : prototypesOf(entity.kind)[0]!;
}

export function prototypeData(entity: EntityShape): PrototypeData {
  return PROTOTYPES[prototypeOf(entity)];
}

/** "a lamp", "an arithmetic combinator". */
export function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}
