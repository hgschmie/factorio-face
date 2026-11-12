// Wire routes. Pure geometry; rendering turns a route into SVG path data.
import type { Point, TerminalSide, WireColor } from "@face/model";
import { boundsOfPoints, CARD, PIN_SPACING, pinPoint, type Rect } from "./geometry.ts";

/**
 * How far a feedback loop stays away from its card. The red pins sit above the green ones, so red is the inner loop and
 * green runs one pin spacing further out. Detours and same-side wires keep 10 and 30 units, so they never share a line with a loop next to one card.
 */
export const FEEDBACK_CLEARANCE: Readonly<Record<WireColor, number>> = { red: 20, green: 20 + PIN_SPACING };
/** Radius of a rounded corner where the adjacent segments leave room for it. */
export const CORNER_RADIUS = 14;

export interface WireEnd {
  /** Top-left position of the entity card. */
  readonly position: Point;
  readonly side: TerminalSide;
}

/** The corners of an axis-aligned line from pin to pin, drawn with rounded corners. No two neighbors coincide and no point lies inside a straight run. */
export type WireRoute = readonly Point[];

/** Half the distance between the two colors of one pair; each runs this far from their common center line. */
const HALF_SPACING = PIN_SPACING / 2;
/** Distance between the center line of a pair and the card side it runs along (detours and same-side wires). */
const SIDE_CLEARANCE = 20;
/** Distance below the lower card when a doubling-back wire cannot pass between the two cards. */
const DETOUR_BELOW = 30;
/** An output-to-input wire runs forward while the input is at least this far to the right of the output: cards one grid step apart leave a 16 unit gap. */
const MIN_FORWARD_GAP = 16;
/** Closest a vertical leg in a narrow gap between two cards comes to either of them. */
const LEG_MARGIN = 3;

/** -1 for red, +1 for green: red runs above green on a horizontal stretch. */
function colorSign(color: WireColor): number {
  return color === "red" ? -1 : 1;
}

/** The point halfway between the two pins of a terminal. */
function terminalCenter(position: Point, side: TerminalSide): Point {
  const red = pinPoint(position, side, "red");
  const green = pinPoint(position, side, "green");
  return { x: (red.x + green.x) / 2, y: (red.y + green.y) / 2 };
}

/** Drops repeated points and points inside a straight run (a wire between two level terminals is one segment). */
function tidy(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const [before, last] = [result.at(-2), result.at(-1)];
    if (before && last && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))) result.pop();
    const end = result.at(-1);
    if (!end || end.x !== point.x || end.y !== point.y) result.push(point);
  }
  return result;
}

/**
 * Distance between the vertical legs of the two colors in a gap of this width: a pin spacing where there is room, less where
 * both legs would not stay off the cards. Zero only for cards that touch or overlap, where the colors may share a line.
 */
function legSpacing(gap: number): number {
  return Math.max(0, Math.min(PIN_SPACING, gap - 2 * LEG_MARGIN));
}

/** A connection between the two terminals of one card: leaves through the output pin, passes over the top and re-enters at the input pin. */
function feedbackRoute(position: Point, color: WireColor): WireRoute {
  const clearance = FEEDBACK_CLEARANCE[color];
  const out = pinPoint(position, "out", color);
  const input = pinPoint(position, "in", color);
  const right = position.x + CARD.width + clearance;
  const left = position.x - clearance;
  const top = position.y - clearance;
  return [out, { x: right, y: out.y }, { x: right, y: top }, { x: left, y: top }, { x: left, y: input.y }, input];
}

/**
 * Shifts an axis-aligned polyline sideways: positive `offset` moves it to the right of the direction of travel.
 * At a corner the two shifted segments are joined, so the result is an exact parallel of the input.
 */
export function offsetPolyline(points: readonly Point[], offset: number): Point[] {
  const rightNormal = (from: Point, to: Point): Point => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  };
  return points.map((point, index) => {
    const before = index > 0 ? rightNormal(points[index - 1]!, point) : undefined;
    const after = index < points.length - 1 ? rightNormal(point, points[index + 1]!) : undefined;
    const normal = before && after ? { x: before.x + after.x * (1 - Math.abs(before.x)), y: before.y + after.y * (1 - Math.abs(before.y)) } : (before ?? after ?? { x: 0, y: 0 });
    return { x: point.x + offset * normal.x, y: point.y + offset * normal.y };
  });
}

/**
 * An output whose target input is to its right: out, one vertical leg midway between the two cards, into the input; a
 * straight line when the pins are level. The color on the outside of the first bend takes the far leg, which makes the two
 * colors exact parallels one pin spacing apart. In a gap too narrow for that the legs move together, see `legSpacing`.
 */
function forwardRoute(color: WireColor, start: Point, end: Point): WireRoute {
  const legX = (start.x + end.x) / 2 - (colorSign(color) * Math.sign(end.y - start.y) * legSpacing(end.x - start.x)) / 2;
  return tidy([start, { x: legX, y: start.y }, { x: legX, y: end.y }, end]);
}

/**
 * An output whose target input is not to its right: out to the right, across between the two cards (or below and around
 * both when there is no room between them), and into the input from the left. The colors are exact parallels of the line
 * between the two terminal centers, one pin spacing apart, so each ends in its own pin and never passes the pin of the other color.
 */
function detourRoute(color: WireColor, out: Point, input: Point): WireRoute {
  const from = terminalCenter(out, "out");
  const to = terminalCenter(input, "in");
  const upper = out.y <= input.y ? out : input;
  const lower = upper === out ? input : out;
  const gap = lower.y - (upper.y + CARD.height);
  const between = gap >= 2 * SIDE_CLEARANCE;
  const crossing = between ? upper.y + CARD.height + gap / 2 : lower.y + CARD.height + DETOUR_BELOW;
  let right = from.x + SIDE_CLEARANCE;
  let left = to.x - SIDE_CLEARANCE;
  if (!between) {
    // On the way below both cards, the vertical run beside the upper card also has to clear the lower one.
    if (lower === input) right = Math.max(right, to.x + CARD.width + SIDE_CLEARANCE);
    else left = Math.min(left, from.x - CARD.width - SIDE_CLEARANCE);
  }
  const centerLine = [from, { x: right, y: from.y }, { x: right, y: crossing }, { x: left, y: crossing }, { x: left, y: to.y }, to];
  return tidy(offsetPolyline(centerLine, colorSign(color) * HALF_SPACING));
}

/**
 * Two inputs or two outputs: out on their side, a vertical leg beyond the terminal that lies further out, and back in. When
 * the card of that terminal is in the way of the other one, the wire first passes below it, or above it when the other
 * terminal is higher. Red starts and ends above green on a path that turns back, so the colors cannot be parallels all the
 * way: one of them takes the outer line on every leg and crosses the other once, at a right angle.
 */
function sameSideRoute(color: WireColor, a: WireEnd, b: WireEnd): WireRoute {
  const side = a.side;
  const outward = side === "out" ? 1 : -1;
  // `front` is the terminal further out, the lower one of two in a column, so the route does not depend on the order of the ends.
  const swap = ((a.position.x - b.position.x) * outward || a.position.y - b.position.y) > 0;
  const [back, front] = swap ? [b.position, a.position] : [a.position, b.position];
  const start = pinPoint(back, side, color);
  const end = pinPoint(front, side, color);
  const level = terminalCenter(back, side).y;
  const blocked = start.x !== end.x && level > front.y - SIDE_CLEARANCE && level < front.y + CARD.height + SIDE_CLEARANCE;
  const above = blocked && level < terminalCenter(front, side).y;
  // +1 for the color on the inner line, -1 for the outer one. Red is outside unless the wire passes above the front card: the crossing is then at the far corner of the lane, away from the pins.
  const inward = (above ? -1 : 1) * colorSign(color);
  const frontLeg = end.x + outward * (SIDE_CLEARANCE - inward * HALF_SPACING);
  if (!blocked) return tidy([start, { x: frontLeg, y: start.y }, { x: frontLeg, y: end.y }, end]);
  const gap = (end.x - start.x) * outward - CARD.width;
  const backLeg = start.x + outward * (Math.max(0, Math.min(SIDE_CLEARANCE, gap / 2)) - (inward * legSpacing(gap)) / 2);
  // The lane keeps its clearance from the card and is at least a pin spacing away from the level of the back terminal, which leaves room for two corners.
  const laneCenter = above ? Math.min(front.y - SIDE_CLEARANCE, level - PIN_SPACING) : Math.max(front.y + CARD.height + SIDE_CLEARANCE, level + PIN_SPACING);
  const lane = laneCenter + colorSign(color) * HALF_SPACING;
  return tidy([start, { x: backLeg, y: start.y }, { x: backLeg, y: lane }, { x: frontLeg, y: lane }, { x: frontLeg, y: end.y }, end]);
}

/**
 * Routes one wire from pin to pin. `sameEntity` must be true when both ends belong to the same entity (the positions
 * alone cannot tell, two cards may overlap). The route does not depend on the order of the two ends. Red and green
 * between the same pair of terminals get separate routes that never touch, except for the one crossing between two
 * inputs or two outputs (see `sameSideRoute`).
 */
export function routeWire(color: WireColor, a: WireEnd, b: WireEnd, sameEntity: boolean): WireRoute {
  if (a.side === b.side) return sameSideRoute(color, a, b);
  const [out, input] = a.side === "out" ? [a.position, b.position] : [b.position, a.position];
  if (sameEntity) return feedbackRoute(out, color);
  const start = pinPoint(out, "out", color);
  const end = pinPoint(input, "in", color);
  return end.x - start.x < MIN_FORWARD_GAP ? detourRoute(color, out, input) : forwardRoute(color, start, end);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Radius of each corner (every point but the first and the last): the common radius, less where a segment is too short.
 * A segment between two corners is shared by both, so the rounded line has no kinks and never overshoots.
 */
export function cornerRadii(route: WireRoute): number[] {
  const room = (segment: number): number => distance(route[segment]!, route[segment + 1]!) / (segment === 0 || segment === route.length - 2 ? 1 : 2);
  return route.slice(1, -1).map((_, index) => Math.min(CORNER_RADIUS, room(index), room(index + 1)));
}

function format(point: Point): string {
  return `${Math.round(point.x * 100) / 100} ${Math.round(point.y * 100) / 100}`;
}

/** The point `length` away from `from` on the way to `to`. */
function toward(from: Point, to: Point, length: number): Point {
  const ratio = length / (distance(from, to) || 1);
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

export function routePath(route: WireRoute): string {
  const radii = cornerRadii(route);
  return route
    .map((point, index) => {
      const previous = route[index - 1];
      const next = route[index + 1];
      if (!previous) return `M ${format(point)}`;
      if (!next) return `L ${format(point)}`;
      const radius = radii[index - 1]!;
      return `L ${format(toward(point, previous, radius))} Q ${format(point)} ${format(toward(point, next, radius))}`;
    })
    .join(" ");
}

/** A box that contains the whole route. Used for culling. */
export function routeBounds(route: WireRoute): Rect {
  return boundsOfPoints(route);
}

/** Points along the route (corners are not rounded), for geometry checks. */
export function sampleRoute(route: WireRoute, steps = 24): Point[] {
  const points: Point[] = route.slice(0, 1);
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1]!;
    const to = route[i]!;
    for (let step = 1; step <= steps; step++) points.push({ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps });
  }
  return points;
}
