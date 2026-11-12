// Where the bubble of the selected entity goes on the blueprint board, in screen pixels of the canvas. Pure.
import { rectsIntersect, type Rect } from "./geometry.ts";
import type { Size } from "./viewport.ts";

export const BUBBLE_SIDES = ["right", "left", "below", "above"] as const;
/** The side of the entity the bubble is on. */
export type BubbleSide = (typeof BUBBLE_SIDES)[number];

export interface BubblePlacement {
  /** Top-left corner of the bubble. */
  readonly x: number;
  readonly y: number;
  readonly side: BubbleSide;
  /** Where the pointer sits on the edge that faces the entity, measured from the left or the top of the bubble. */
  readonly pointer: number;
}

/** Between the entity and the bubble; the pointer bridges it. */
export const BUBBLE_GAP = 14;
/** Kept free between the bubble and the edge of the canvas. */
export const BUBBLE_MARGIN = 8;
/** The pointer stays this far from the corners of the bubble. */
const POINTER_INSET = 14;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Puts a bubble of `size` next to `anchor`, the rectangle of its entity, inside a canvas of `view`. It goes to the first side
 * on which it fits completely (right, left, below, above), otherwise to the side with the most room, and is then moved along
 * the entity so that it stays inside the canvas; the pointer keeps aiming at the middle of the entity as far as the bubble
 * reaches. Undefined when the entity is out of sight: a bubble without its entity would point at nothing.
 */
export function placeBubble(anchor: Rect, size: Size, view: Size): BubblePlacement | undefined {
  if (!rectsIntersect(anchor, { x: 0, y: 0, width: view.width, height: view.height })) return undefined;
  const room: Readonly<Record<BubbleSide, number>> = {
    right: view.width - BUBBLE_MARGIN - (anchor.x + anchor.width + BUBBLE_GAP) - size.width,
    left: anchor.x - BUBBLE_GAP - BUBBLE_MARGIN - size.width,
    below: view.height - BUBBLE_MARGIN - (anchor.y + anchor.height + BUBBLE_GAP) - size.height,
    above: anchor.y - BUBBLE_GAP - BUBBLE_MARGIN - size.height,
  };
  const side = BUBBLE_SIDES.find((candidate) => room[candidate] >= 0) ?? BUBBLE_SIDES.reduce((best, candidate) => (room[candidate] > room[best] ? candidate : best));
  const beside = side === "right" || side === "left";
  const wanted = {
    x: side === "right" ? anchor.x + anchor.width + BUBBLE_GAP : side === "left" ? anchor.x - BUBBLE_GAP - size.width : anchor.x + anchor.width / 2 - size.width / 2,
    y: side === "below" ? anchor.y + anchor.height + BUBBLE_GAP : side === "above" ? anchor.y - BUBBLE_GAP - size.height : anchor.y + anchor.height / 2 - size.height / 2,
  };
  // A canvas smaller than the bubble keeps its top-left corner in view.
  const x = clamp(wanted.x, BUBBLE_MARGIN, Math.max(BUBBLE_MARGIN, view.width - BUBBLE_MARGIN - size.width));
  const y = clamp(wanted.y, BUBBLE_MARGIN, Math.max(BUBBLE_MARGIN, view.height - BUBBLE_MARGIN - size.height));
  const pointer = beside ? clamp(anchor.y + anchor.height / 2 - y, POINTER_INSET, size.height - POINTER_INSET) : clamp(anchor.x + anchor.width / 2 - x, POINTER_INSET, size.width - POINTER_INSET);
  return { x, y, side, pointer };
}
