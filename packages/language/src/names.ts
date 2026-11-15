// What an entity declaration says about its word when the game data in use has no such entity. Pure but for the entity table in use.

import { entityTable, isPrototypeName, PROTOTYPE_NAMES, PROTOTYPES, withArticle, type EntityKind, type EntityTable } from "@face/model";

/** Names offered in one hint. */
const MAX_HINTS = 3;
/** Hints kept per entity table; every word that is typed at the start of a member asks for one. */
const MAX_KEPT = 1000;

/** The edit distance of two words, or anything above `limit` once it is clear that they are further apart. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    if (Math.min(...row) > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * The names of `candidates` nearest to `name`, the nearest first: those a typing error away (a letter or two, more for a long
 * name), then those that contain it or are contained in it (`lamp` in `small-lamp`). None when nothing is near.
 */
function nearestNames(name: string, candidates: readonly string[]): string[] {
  const word = name.toLowerCase();
  const allowed = Math.max(1, Math.min(3, Math.floor(word.length / 4)));
  const scored = candidates.flatMap((candidate) => {
    const distance = editDistance(word, candidate, allowed);
    if (distance <= allowed) return [{ candidate, score: distance }];
    return word.length >= 3 && (candidate.includes(word) || word.includes(candidate)) ? [{ candidate, score: allowed + 1 }] : [];
  });
  // A stable sort: among equally near names the order of the candidates decides.
  return scored.sort((a, b) => a.score - b.score).slice(0, MAX_HINTS).map((entry) => entry.candidate);
}

export type DeclaredPrototype = { readonly kind: EntityKind } | { readonly problem: "unknown" | "unsupported"; readonly message: string };

let hints: { readonly table: EntityTable; readonly byName: Map<string, string> } | undefined;

/** The hint is the same for every declaration of a name, and a project made with other game data may have many of them. */
function unknownMessage(name: string): string {
  const table = entityTable();
  if (hints?.table !== table || hints.byName.size >= MAX_KEPT) hints = { table, byName: new Map() };
  let message = hints.byName.get(name);
  if (message === undefined) {
    const near = nearestNames(name, PROTOTYPE_NAMES);
    const none = ": the game data in use has no entity of this name (the names are the game's, as a blueprint has them: constant-combinator, small-lamp, steel-chest)";
    message = `Unknown entity '${name}'${near.length ? `; did you mean ${near.join(", ")}?` : none}`;
    hints.byName.set(name, message);
  }
  return message;
}

/**
 * What the word of an entity declaration names in the game data in use: a prototype the editor has, with its kind, or a problem.
 * `unsupported` is a prototype of the game that the editor gives no kind (a programmable speaker of a mod, a prototype type
 * without settings); `unknown` is a name the data does not have.
 */
export function declaredPrototype(name: string): DeclaredPrototype {
  if (isPrototypeName(name)) return { kind: PROTOTYPES[name]!.kind };
  const game = entityTable().byName.get(name);
  if (!game) return { problem: "unknown", message: unknownMessage(name) };
  const speaker = "is a programmable speaker of its own, and the editor has the instruments of 'programmable-speaker' only";
  const what = game.type === "programmable-speaker" ? speaker : `is ${withArticle(game.type)}, for which the editor has no settings`;
  return { problem: "unsupported", message: `'${name}' (${game.displayName}) is not supported: it ${what}` };
}
