// Quarter turns of the direction an entity faces (`facingOf` in the model). Pure.
import type { Direction } from "@face/model";

/** The directions in the order a clockwise rotation goes through them. */
export const CLOCKWISE: readonly Direction[] = ["east", "south", "west", "north"];

export type RotationTurn = "clockwise" | "counterclockwise";

/** `facing` after a quarter turn. */
export function rotated(facing: Direction, turn: RotationTurn): Direction {
  return CLOCKWISE[(CLOCKWISE.indexOf(facing) + (turn === "clockwise" ? 1 : 3)) % 4]!;
}

export function opposite(facing: Direction): Direction {
  return CLOCKWISE[(CLOCKWISE.indexOf(facing) + 2) % 4]!;
}
