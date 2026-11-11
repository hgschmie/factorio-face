// Snap and drag math. Pure: a drop is computed from the press and release coordinates alone, never from rendered preview state.
import type { EntityId, Point } from "@face/model";
import { CARD, GRID } from "./geometry.ts";

export const DRAG_THRESHOLD_PX = 3;

export interface EntityPosition {
  readonly id: EntityId;
  readonly position: Point;
}

export function snapToGrid(value: number, grid = GRID): number {
  // `+ 0` turns a negative zero from Math.round into a plain zero.
  return Math.round(value / grid) * grid + 0;
}

export function snapPoint(point: Point, grid = GRID): Point {
  return { x: snapToGrid(point.x, grid), y: snapToGrid(point.y, grid) };
}

/** True once the pointer travelled far enough from the press position to count as a drag instead of a click. */
export function exceedsDragThreshold(press: Point, current: Point): boolean {
  return Math.abs(current.x - press.x) + Math.abs(current.y - press.y) > DRAG_THRESHOLD_PX;
}

/** Pointer travel in screen pixels converted to world units. */
export function worldDelta(press: Point, current: Point, zoom: number): Point {
  return { x: (current.x - press.x) / zoom, y: (current.y - press.y) / zoom };
}

/**
 * New positions for a group drag. The grabbed entity snaps to the grid; the others move by the same amount, so the
 * group keeps its shape even when some members were off-grid before.
 */
export function dragPositions(origins: readonly EntityPosition[], grabbedId: EntityId, delta: Point, grid = GRID): EntityPosition[] {
  const grabbed = origins.find((origin) => origin.id === grabbedId) ?? origins[0];
  if (!grabbed) return [];
  const target = snapPoint({ x: grabbed.position.x + delta.x, y: grabbed.position.y + delta.y }, grid);
  const shift = { x: target.x - grabbed.position.x, y: target.y - grabbed.position.y };
  return origins.map(({ id, position }) => ({ id, position: { x: position.x + shift.x, y: position.y + shift.y } }));
}

/** Entries of `next` whose position differs from `origins`; an empty result means the drop is a no-op. */
export function changedPositions(origins: readonly EntityPosition[], next: readonly EntityPosition[]): EntityPosition[] {
  const before = new Map(origins.map((origin) => [origin.id, origin.position]));
  return next.filter(({ id, position }) => {
    const previous = before.get(id);
    return !previous || previous.x !== position.x || previous.y !== position.y;
  });
}

/** Top-left position for a new card centered on the pointer, snapped to the grid. */
export function placementPosition(pointer: Point, grid = GRID): Point {
  return snapPoint({ x: pointer.x - CARD.width / 2, y: pointer.y - CARD.height / 2 }, grid);
}
