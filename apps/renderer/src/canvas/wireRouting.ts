// Wire routes. Pure geometry; rendering turns a route into SVG path data.
import type { Point, TerminalSide, WireColor } from "@face/model";
import { boundsOfPoints, CARD, terminalPoint, wireAnchor, type Rect } from "./geometry.ts";

/** How far a feedback loop stays away from its card. The colors differ so both loops of one card remain visible. */
export const FEEDBACK_CLEARANCE: Readonly<Record<WireColor, number>> = { red: 30, green: 48 };
export const FEEDBACK_CORNER_RADIUS = 14;

export interface WireEnd {
  /** Top-left position of the entity card. */
  readonly position: Point;
  readonly side: TerminalSide;
}

export type WireRoute =
  /** Cubic bezier, used when the input lies to the right of the output (and between two terminals of the same side). */
  | { readonly kind: "curve"; readonly start: Point; readonly control1: Point; readonly control2: Point; readonly end: Point }
  /** Axis-aligned polyline with rounded corners: feedback loops and wires that have to double back. */
  | { readonly kind: "polyline"; readonly points: readonly Point[]; readonly cornerRadius: number };

/** Distance between the center line of a doubling-back wire and the card sides it passes. */
const DETOUR_CLEARANCE = 18;
/** Distance below the lower card when a doubling-back wire cannot pass between the two cards. */
const DETOUR_BELOW = 30;
/** An output-to-input wire is drawn as a curve while the input is at least this far to the right of the output. */
const MIN_FORWARD_DISTANCE = 2 * DETOUR_CLEARANCE - 20;
/** Largest sideways shift of a curve's control points, in multiples of the wire offset. */
const MAX_CONTROL_SHIFT = 3;

/** -1 for red, +1 for green: red runs above green on a wire that travels to the right. */
function colorSign(color: WireColor): number {
  return color === "red" ? -1 : 1;
}

/** A connection between the two terminals of one card: leaves through the output, passes over the top and re-enters at the input. */
function feedbackRoute(position: Point, color: WireColor): WireRoute {
  const clearance = FEEDBACK_CLEARANCE[color];
  const out = wireAnchor(position, "out", color);
  const input = wireAnchor(position, "in", color);
  const right = position.x + CARD.width + clearance;
  const left = position.x - clearance;
  const top = position.y - clearance;
  return {
    kind: "polyline",
    points: [out, { x: right, y: out.y }, { x: right, y: top }, { x: left, y: top }, { x: left, y: input.y }, input],
    cornerRadius: FEEDBACK_CORNER_RADIUS,
  };
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
 * An output whose target input is not to its right: out to the right, across between the two cards (or below both when
 * they overlap vertically), and into the input from the left. The colors are exact parallels of one center line.
 */
function detourRoute(color: WireColor, out: Point, input: Point): WireRoute {
  const from = terminalPoint(out, "out");
  const to = terminalPoint(input, "in");
  const upper = out.y <= input.y ? out : input;
  const lower = upper === out ? input : out;
  const gap = lower.y - (upper.y + CARD.height);
  const crossing = gap >= 2 * DETOUR_CLEARANCE ? upper.y + CARD.height + gap / 2 : lower.y + CARD.height + DETOUR_BELOW;
  const right = from.x + DETOUR_CLEARANCE;
  const left = to.x - DETOUR_CLEARANCE;
  const centerLine = [from, { x: right, y: from.y }, { x: right, y: crossing }, { x: left, y: crossing }, { x: left, y: to.y }, to];
  return { kind: "polyline", points: offsetPolyline(centerLine, colorSign(color) * CARD.wireOffset), cornerRadius: FEEDBACK_CORNER_RADIUS };
}

/**
 * Horizontal shift of both control points of a left-to-right curve that keeps the two colors of one pair apart.
 *
 * The colors attach `CARD.wireOffset` above and below the terminal center. Moving the whole curve by that amount is
 * enough while it runs horizontally, but on a steep stretch two vertically shifted curves almost coincide. Shifting the
 * control points sideways as well offsets the middle leg of the control polygon perpendicular to itself, which is the
 * usual control-polygon approximation of a parallel curve.
 */
function controlShift(color: WireColor, middleLeg: Point): number {
  const length = Math.hypot(middleLeg.x, middleLeg.y);
  if (length === 0 || Math.abs(middleLeg.y / length) < 1e-6) return 0;
  const shift = (CARD.wireOffset * (middleLeg.x / length - 1)) / (colorSign(color) * (middleLeg.y / length));
  const limit = MAX_CONTROL_SHIFT * CARD.wireOffset;
  return Math.max(-limit, Math.min(limit, shift));
}

function curve(start: Point, startDirection: number, end: Point, endDirection: number, shift: (middleLeg: Point) => number): WireRoute {
  const reach = Math.max(35, Math.min(130, Math.abs(end.x - start.x) * 0.5));
  const control1 = { x: start.x + startDirection * reach, y: start.y };
  const control2 = { x: end.x + endDirection * reach, y: end.y };
  const dx = shift({ x: control2.x - control1.x, y: control2.y - control1.y });
  return { kind: "curve", start, control1: { x: control1.x + dx, y: control1.y }, control2: { x: control2.x + dx, y: control2.y }, end };
}

/**
 * Routes one wire. `sameEntity` must be true when both ends belong to the same entity (the positions alone cannot tell,
 * two cards may overlap). The route does not depend on the order of the two ends. Red and green between the same pair
 * of terminals get separate routes; only between two inputs or two outputs, where the wire turns back on itself, the
 * colors have to cross once.
 */
export function routeWire(color: WireColor, a: WireEnd, b: WireEnd, sameEntity: boolean): WireRoute {
  if (a.side === b.side) {
    const direction = a.side === "out" ? 1 : -1;
    return curve(wireAnchor(a.position, a.side, color), direction, wireAnchor(b.position, b.side, color), direction, () => 0);
  }
  const [out, input] = a.side === "out" ? [a.position, b.position] : [b.position, a.position];
  if (sameEntity) return feedbackRoute(out, color);
  const start = wireAnchor(out, "out", color);
  const end = wireAnchor(input, "in", color);
  if (end.x - start.x < MIN_FORWARD_DISTANCE) return detourRoute(color, out, input);
  return curve(start, 1, end, -1, (middleLeg) => controlShift(color, middleLeg));
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function polylinePath(points: readonly Point[], cornerRadius: number): string {
  const first = points[0];
  if (!first) return "";
  const commands = [`M ${format(first.x)} ${format(first.y)}`];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!;
    const corner = points[i]!;
    const next = points[i + 1];
    if (!next) {
      commands.push(`L ${format(corner.x)} ${format(corner.y)}`);
      break;
    }
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(cornerRadius, incoming / 2, outgoing / 2);
    const enter = { x: corner.x - ((corner.x - previous.x) / incoming) * radius, y: corner.y - ((corner.y - previous.y) / incoming) * radius };
    const leave = { x: corner.x + ((next.x - corner.x) / outgoing) * radius, y: corner.y + ((next.y - corner.y) / outgoing) * radius };
    commands.push(`L ${format(enter.x)} ${format(enter.y)}`, `Q ${format(corner.x)} ${format(corner.y)} ${format(leave.x)} ${format(leave.y)}`);
  }
  return commands.join(" ");
}

export function routePath(route: WireRoute): string {
  if (route.kind === "polyline") return polylinePath(route.points, route.cornerRadius);
  const { start, control1, control2, end } = route;
  return `M ${format(start.x)} ${format(start.y)} C ${format(control1.x)} ${format(control1.y)}, ${format(control2.x)} ${format(control2.y)}, ${format(end.x)} ${format(end.y)}`;
}

/** A box that contains the whole route (the control polygon bounds a bezier). Used for culling. */
export function routeBounds(route: WireRoute): Rect {
  return boundsOfPoints(route.kind === "polyline" ? route.points : [route.start, route.control1, route.control2, route.end]);
}

/** Points along the route (corners of a polyline are not rounded), for geometry checks. */
export function sampleRoute(route: WireRoute, steps = 24): Point[] {
  const points: Point[] = [];
  if (route.kind === "polyline") {
    for (let i = 1; i < route.points.length; i++) {
      const from = route.points[i - 1]!;
      const to = route.points[i]!;
      for (let step = i === 1 ? 0 : 1; step <= steps; step++) points.push({ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps });
    }
    return points;
  }
  const { start, control1, control2, end } = route;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u ** 3 * start.x + 3 * u * u * t * control1.x + 3 * u * t * t * control2.x + t ** 3 * end.x,
      y: u ** 3 * start.y + 3 * u * u * t * control1.y + 3 * u * t * t * control2.y + t ** 3 * end.y,
    });
  }
  return points;
}
