// Card and pin geometry in canvas (world) units. Pure.
import type { Entity, Point, TerminalSide, WireColor } from "@face/model";

export const GRID = 20;

export const CARD = {
  width: 184,
  height: 128,
  /** Vertical position of the connection pins, measured from the top of the card: red above green, both on the grid. */
  pinY: { red: 60, green: 80 },
} as const;

/** Distance between the red and the green pin of one terminal. */
export const PIN_SPACING = CARD.pinY.green - CARD.pinY.red;
export const PIN_RADIUS = 6;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function cardRect(position: Point): Rect {
  return { x: position.x, y: position.y, width: CARD.width, height: CARD.height };
}

/**
 * Center of the connection pin for one wire color on one terminal side; a wire of that color starts and ends exactly here.
 * Every entity faces right: inputs on the left edge, outputs on the right, red above green. Entity rotation hooks in here.
 */
export function pinPoint(position: Point, side: TerminalSide, color: WireColor): Point {
  return { x: position.x + (side === "out" ? CARD.width : 0), y: position.y + CARD.pinY[color] };
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
