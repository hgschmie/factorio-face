// What the editor has to say about a generic entity (kind `entity`) in the inspector: what it does not edit and what it leaves
// out of a blueprint. Per prototype type of the game, like the settings (`ENTITY_SETTINGS` of @face/model). Pure.
import { entityTable, type PrototypeName } from "@face/model";

/** What the inspector adds about a type: what the editor keeps of it without showing it. */
const TYPE_NOTES: Readonly<Record<string, string>> = {
  "display-panel": "The messages of this entity are kept from a blueprint and not edited here.",
  lab: "The research conditions of this entity are kept from a blueprint and not edited here.",
};

/** The notes of the inspector for a generic prototype: of its type, and that the game takes an entity no item builds into no blueprint. */
export function prototypeNotes(prototype: PrototypeName): readonly string[] {
  const game = entityTable().byName.get(prototype);
  if (!game) return [];
  const notes = TYPE_NOTES[game.type] === undefined ? [] : [TYPE_NOTES[game.type]!];
  if (game.placedBy.length === 0) notes.push("No item of the game builds this entity, and the game takes it into no blueprint: an export leaves it out, with its wires.");
  return notes;
}
