// Card and terminal geometry in canvas (world) units. Pure.
import type { Entity, Point, TerminalSide, WireColor } from "@face/model";

export const GRID = 20;

export const CARD = {
  width: 184,
  height: 128,
  /** Vertical position of both terminals, measured from the top of the card. */
  terminalY: 80,
  /** Red and green wires attach this far above and below the terminal center, so parallel wires never overlap. */
  wireOffset: 5,
} as const;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function cardRect(position: Point): Rect {
  return { x: position.x, y: position.y, width: CARD.width, height: CARD.height };
}

export function terminalPoint(position: Point, side: TerminalSide): Point {
  return { x: position.x + (side === "out" ? CARD.width : 0), y: position.y + CARD.terminalY };
}

/** Where a wire of the given color meets the terminal. */
export function wireAnchor(position: Point, side: TerminalSide, color: WireColor): Point {
  const terminal = terminalPoint(position, side);
  return { x: terminal.x, y: terminal.y + (color === "red" ? -CARD.wireOffset : CARD.wireOffset) };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function expandRect(rect: Rect, margin: number): Rect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + 2 * margin, height: rect.height + 2 * margin };
}

export function boundsOfPoints(points: readonly Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Bounding box of all cards, or undefined for an empty circuit. */
export function entitiesBounds(entities: readonly Pick<Entity, "position">[]): Rect | undefined {
  if (entities.length === 0) return undefined;
  const corners = entities.flatMap(({ position }) => [position, { x: position.x + CARD.width, y: position.y + CARD.height }]);
  return boundsOfPoints(corners);
}
