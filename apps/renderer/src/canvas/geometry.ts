// Card and pin geometry in canvas (world) units. Pure.
import { DEFAULT_FACING, type Direction, type Entity, type Point, type TerminalSide, type WireColor } from "@face/model";
import { opposite } from "../entities/facing.ts";

export const GRID = 20;

export const CARD = {
  width: 184,
  height: 128,
  /** Pins on the left and right edge, measured from the top of the card, as a card facing east has them: red above green, both on the grid. */
  pinY: { red: 60, green: 80 },
  /** Pins on the top and bottom edge, measured from the left of the card, as a card facing north has them: red left of green, both on the grid. */
  pinX: { red: 80, green: 100 },
} as const;

/** Distance between the red and the green pin of one terminal. */
export const PIN_SPACING = CARD.pinY.green - CARD.pinY.red;
export const PIN_RADIUS = 6;

/** One step in `direction` on the canvas, where y grows downwards. */
export const DIRECTION_VECTOR: Readonly<Record<Direction, Point>> = { east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 }, north: { x: 0, y: -1 } };

/** SVG path of a triangle around (x, y) that points along `forward` (a `DIRECTION_VECTOR`): 9 units long and 10 wide, times `scale`. */
export function arrowPath(x: number, y: number, forward: Point, scale = 1): string {
  const [tip, back, half] = [5 * scale, 4 * scale, 5 * scale];
  const base = { x: x - forward.x * back, y: y - forward.y * back };
  return `M ${x + forward.x * tip} ${y + forward.y * tip} L ${base.x + forward.y * half} ${base.y - forward.x * half} L ${base.x - forward.y * half} ${base.y + forward.x * half} Z`;
}

/** The side a terminal is drawn and routed as: an output, or an input, which is also where the one point of a pole sits for now. */
export function drawnSide(side: TerminalSide): "in" | "out" {
  return side === "out" ? "out" : "in";
}

export type CardEdge = "left" | "right" | "top" | "bottom";

const EDGE_TOWARDS: Readonly<Record<Direction, CardEdge>> = { east: "right", south: "bottom", west: "left", north: "top" };
const OTHER_COLOR: Readonly<Record<WireColor, WireColor>> = { red: "green", green: "red" };

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
 * The direction in which a wire leaves a terminal: an output points where its entity faces, an input the other way. The one
 * point of a pole (`io`) is drawn where an input is; package H gives it a place of its own.
 */
export function pinHeading(side: TerminalSide, facing: Direction = DEFAULT_FACING): Direction {
  // Everything but an output: `in` and `io`.
  return side === "out" ? facing : opposite(facing);
}

/** The edge of the card that carries the pins of a terminal. */
export function pinEdge(side: TerminalSide, facing: Direction = DEFAULT_FACING): CardEdge {
  return EDGE_TOWARDS[pinHeading(side, facing)];
}

/**
 * Center of the connection pin for one wire color on one terminal side; a wire of that color starts and ends exactly here.
 * An entity facing east has its inputs on the left edge and its outputs on the right, red above green. The pins turn with the
 * entity as one rigid figure, clockwise from east to south, west and north: facing south the outputs are on the bottom edge with
 * red right of green, facing west on the left edge with red below green, facing north on the top edge with red left of green.
 */
export function pinPoint(position: Point, side: TerminalSide, color: WireColor, facing: Direction = DEFAULT_FACING): Point {
  const far = side === "out";
  switch (facing) {
    case "east":
      return { x: position.x + (far ? CARD.width : 0), y: position.y + CARD.pinY[color] };
    case "west":
      return { x: position.x + (far ? 0 : CARD.width), y: position.y + CARD.pinY[OTHER_COLOR[color]] };
    case "north":
      return { x: position.x + CARD.pinX[color], y: position.y + (far ? 0 : CARD.height) };
    case "south":
      return { x: position.x + CARD.pinX[OTHER_COLOR[color]], y: position.y + (far ? CARD.height : 0) };
  }
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
