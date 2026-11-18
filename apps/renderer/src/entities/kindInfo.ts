// Display metadata per entity kind, shared by palette, canvas and inspector, and the names an entity goes by.
import { gamePrototype, prototypeData, prototypesOf, withArticle, type EntityKind, type EntityShape, type PrototypeName } from "@face/model";

export interface KindInfo {
  readonly label: string;
  /** False where the game has no "Add description" for the entity: its description is then a note of the project (docs/dsl.md). */
  readonly describedInGame: boolean;
}

export const KIND_INFO: Readonly<Record<EntityKind, KindInfo>> = {
  constant: { label: "Constant", describedInGame: true },
  arithmetic: { label: "Arithmetic", describedInGame: true },
  decider: { label: "Decider", describedInGame: true },
  selector: { label: "Selector", describedInGame: true },
  lamp: { label: "Lamp", describedInGame: false },
  pole: { label: "Pole", describedInGame: false },
  speaker: { label: "Speaker", describedInGame: false },
  // Every other entity of the game. Its label is the prototype's (`entityTitle`).
  entity: { label: "Entity", describedInGame: false },
};

const GAME_COMBINATORS: ReadonlySet<PrototypeName> = new Set(["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"]);
const COMBINATOR_KINDS: ReadonlySet<EntityKind> = new Set(["constant", "arithmetic", "decider", "selector"]);

/**
 * Whether the inspector has a settings form for a prototype. A mod's prototype of a combinator type is often something else
 * than the type says (a controller built on a constant combinator), and the form of the type is wrong for it: of the four
 * combinator kinds only the game's own prototypes have their form. The settings of the others are in the source only.
 */
export function hasSettingsForm(prototype: PrototypeName): boolean {
  return GAME_COMBINATORS.has(prototype) || !COMBINATOR_KINDS.has(prototypeData({ prototype }).kind);
}

export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The name of the entity in the game, as the game writes it: "Big electric pole", "Decider combinator", "Lamp", and a mod's
 * "LTN Combinator". For where the name stands by itself: a title, a tile, a field. Inside a sentence it is the lower-case
 * `label` of the prototype (`entityNoun`).
 */
export function prototypeLabel(entity: EntityShape): string {
  return gamePrototype(entity).displayName;
}

/**
 * What an entity is called on its card and in the inspector: the kind where that says it all ("Decider", "Lamp"), the game's
 * name where a kind has several entities ("Big electric pole").
 */
export function entityTitle(entity: EntityShape): string {
  const { kind } = prototypeData(entity);
  return prototypesOf(kind).length > 1 ? prototypeLabel(entity) : KIND_INFO[kind].label;
}

/** The same inside a sentence, with its article: "a decider", "a big electric pole". */
export function entityNoun(entity: EntityShape): string {
  return withArticle(entityTitle(entity).toLowerCase());
}

/** The tiles a prototype covers when it faces north, width by height: "1 tile", "1 x 2 tiles", "9 x 9 tiles". */
export function prototypeTiles(entity: EntityShape): string {
  const { width, height } = prototypeData(entity);
  return width * height > 1 ? `${width} x ${height} tiles` : "1 tile";
}

/**
 * The size of a prototype and, where it has one of its own, its wire reach: "2 x 2 tiles, wire reach 32", "1 tile, wire reach
 * 7.5", "3 x 3 tiles". An entity without a reach of its own has the project's, which is not said.
 */
export function prototypeFacts(entity: EntityShape): string {
  const { wireReach } = prototypeData(entity);
  return `${prototypeTiles(entity)}${wireReach === undefined ? "" : `, wire reach ${wireReach}`}`;
}
