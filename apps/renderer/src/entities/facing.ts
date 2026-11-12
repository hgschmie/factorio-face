// The direction an entity faces and its quarter turns. Pure.
import { DEFAULT_FACING } from "@face/language";
import type { Direction, Entity } from "@face/model";

/** The directions in the order a clockwise rotation goes through them. */
export const CLOCKWISE: readonly Direction[] = ["east", "south", "west", "north"];

export type RotationTurn = "clockwise" | "counterclockwise";

/** The direction the output of an entity points to: east unless its declaration says otherwise. */
export function facingOf(entity: Pick<Entity, "placement">): Direction {
  return entity.placement?.direction ?? DEFAULT_FACING;
}

/** `facing` after a quarter turn. */
export function rotated(facing: Direction, turn: RotationTurn): Direction {
  return CLOCKWISE[(CLOCKWISE.indexOf(facing) + (turn === "clockwise" ? 1 : 3)) % 4]!;
}

export function opposite(facing: Direction): Direction {
  return CLOCKWISE[(CLOCKWISE.indexOf(facing) + 2) % 4]!;
}
