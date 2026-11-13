// Display metadata per entity kind, shared by palette, canvas and inspector, and the names an entity goes by.
import { prototypeData, prototypesOf, withArticle, type EntityKind, type EntityShape } from "@face/model";

export interface KindInfo {
  readonly label: string;
  readonly description: string;
  /** Category line shown above the label in the inspector. */
  readonly category: string;
  /** False where the game has no "Add description" for the entity: its description is then a note of the project (docs/dsl.md). */
  readonly describedInGame: boolean;
}

export const KIND_INFO: Readonly<Record<EntityKind, KindInfo>> = {
  constant: { label: "Constant", description: "Emit steady signals", category: "Combinator", describedInGame: true },
  arithmetic: { label: "Arithmetic", description: "Transform your signals", category: "Combinator", describedInGame: true },
  decider: { label: "Decider", description: "Compare and decide", category: "Combinator", describedInGame: true },
  selector: { label: "Selector", description: "Pick, count and sort signals", category: "Combinator", describedInGame: true },
  lamp: { label: "Lamp", description: "See a condition light up", category: "Condition indicator", describedInGame: false },
  pole: { label: "Pole", description: "Relay signals over a distance", category: "Signal relay", describedInGame: false },
  speaker: { label: "Speaker", description: "Sound an alert on a condition", category: "Condition indicator", describedInGame: false },
};

export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The name of the entity in the game: "Big electric pole", "Decider combinator", "Lamp". */
export function prototypeLabel(entity: EntityShape): string {
  return capitalized(prototypeData(entity).label);
}

/**
 * What an entity is called on its card and in the inspector: the kind where that says it all ("Decider", "Lamp"), the game's
 * name where a kind has several entities ("Big electric pole").
 */
export function entityTitle(entity: EntityShape): string {
  return prototypesOf(entity.kind).length > 1 ? prototypeLabel(entity) : KIND_INFO[entity.kind].label;
}

/** The same inside a sentence, with its article: "a decider", "a big electric pole". */
export function entityNoun(entity: EntityShape): string {
  return withArticle(entityTitle(entity).toLowerCase());
}

/**
 * The size and the wire reach that set a prototype apart, where it has a reach of its own: "2 x 2 tiles, wire reach 32", "1 tile,
 * wire reach 7.5". Empty for every other entity: its tiles show on the board and its reach is the project's.
 */
export function prototypeFacts(entity: EntityShape): string {
  const { width, height, wireReach } = prototypeData(entity);
  return wireReach === undefined ? "" : `${width * height > 1 ? `${width} x ${height} tiles` : "1 tile"}, wire reach ${wireReach}`;
}
