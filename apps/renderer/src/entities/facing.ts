// Quarter turns and mirror images of the direction an entity faces (`facingOf` in the model). Pure.
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

/** A flip mirrors left and right (`horizontal`) or top and bottom (`vertical`), as the game flips what is in hand. */
export const FLIP_AXES = ["horizontal", "vertical"] as const;
export type FlipAxis = (typeof FLIP_AXES)[number];

/** `facing` after a flip: a horizontal one turns east into west and west into east, a vertical one north into south and south into north. */
export function flipped(facing: Direction, axis: FlipAxis): Direction {
  const along = axis === "horizontal" ? facing === "east" || facing === "west" : facing === "north" || facing === "south";
  return along ? opposite(facing) : facing;
}
