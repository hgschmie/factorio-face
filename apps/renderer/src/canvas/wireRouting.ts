// Wire routes. Pure geometry; rendering turns a route into SVG path data.
import { DEFAULT_FACING, type Direction, type Point, type TerminalSide, type WireColor } from "@face/model";
import { CLOCKWISE } from "../entities/facing.ts";
import { boundsOfPoints, CARD, cardRect, DIRECTION_VECTOR, expandRect, GRID, PIN_SPACING, pinHeading, pinPoint, type Rect } from "./geometry.ts";

/**
 * How far a feedback loop stays away from its card. The loop passes the side of the card on which the red pins sit (the top of a
 * card facing east), so red is the inner loop and green runs one pin spacing further out. Detours and same-side wires keep 10
 * and 30 units, so they never share a line with a loop next to one card.
 */
export const FEEDBACK_CLEARANCE: Readonly<Record<WireColor, number>> = { red: 20, green: 20 + PIN_SPACING };
/** Radius of a rounded corner where the adjacent segments leave room for it. */
export const CORNER_RADIUS = 14;

export interface WireEnd {
  /** Top-left position of the entity card. */
  readonly position: Point;
  readonly side: TerminalSide;
  /** The direction the entity faces, which decides the edge its pins are on; east when absent. */
  readonly facing?: Direction;
}

/** The corners of an axis-aligned line from pin to pin, drawn with rounded corners. No two neighbors coincide and no point lies inside a straight run. */
export type WireRoute = readonly Point[];

/** Half the distance between the two colors of one pair; each runs this far from their common center line. */
const HALF_SPACING = PIN_SPACING / 2;
/** Distance between the center line of a pair and the card side it runs along (detours and same-side wires). */
const SIDE_CLEARANCE = 20;
/** Distance below the lower card when a doubling-back wire cannot pass between the two cards. */
const DETOUR_BELOW = 30;
/** Closest a vertical leg in a narrow gap between two cards comes to either of them. */
const LEG_MARGIN = 3;

/** -1 for red, +1 for green: seen along a wire that leaves an output, red runs on the left (above green on the way east). */
function colorSign(color: WireColor): number {
  return color === "red" ? -1 : 1;
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

// Two entities that face the same way, and the two terminals of one entity. The rules are written for entities facing east
// (inputs left, outputs right, red above green). For another direction the same rules run in a frame turned so that the
// entities face east in it, which turns the whole figure with them: a card there has other measures, nothing else differs.

/** A card as the rules for entities facing east see it: its size and how far below its top edge the pins of a color sit. */
interface Frame {
  readonly facing: Direction;
  readonly width: number;
  readonly height: number;
  readonly pinY: Readonly<Record<WireColor, number>>;
  /** An output-to-input wire runs forward while the input is at least this far to the right of the output: the gap that cards one grid step apart leave (16 units between cards facing east). */
  readonly minForwardGap: number;
}

/** `point` after `quarters` quarter turns clockwise around the origin (y grows downwards). `+ 0` keeps negative zeros out of the routes. */
function turned(point: Point, quarters: number): Point {
  switch (quarters & 3) {
    case 1:
      return { x: -point.y + 0, y: point.x };
    case 2:
      return { x: -point.x + 0, y: -point.y + 0 };
    case 3:
      return { x: point.y, y: -point.x + 0 };
    default:
      return point;
  }
}

/** Canvas coordinates to the frame in which an entity facing `facing` faces east, and back. */
function toFrame(point: Point, facing: Direction): Point {
  return turned(point, 4 - CLOCKWISE.indexOf(facing));
}

function fromFrame(point: Point, facing: Direction): Point {
  return turned(point, CLOCKWISE.indexOf(facing));
}

/** Top-left corner, in the frame of `facing`, of the card at `position`. */
function framePosition(position: Point, facing: Direction): Point {
  const [a, b] = [toFrame(position, facing), toFrame({ x: position.x + CARD.width, y: position.y + CARD.height }, facing)];
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
}

const ORIGIN: Point = { x: 0, y: 0 };

function frameOf(facing: Direction): Frame {
  const upright = facing === "east" || facing === "west";
  const top = framePosition(ORIGIN, facing).y;
  const pinY = (color: WireColor): number => toFrame(pinPoint(ORIGIN, "out", color, facing), facing).y - top;
  const width = upright ? CARD.width : CARD.height;
  return { facing, width, height: upright ? CARD.height : CARD.width, pinY: { red: pinY("red"), green: pinY("green") }, minForwardGap: Math.ceil(width / GRID) * GRID - width };
}

const FRAMES: Readonly<Record<Direction, Frame>> = { east: frameOf("east"), south: frameOf("south"), west: frameOf("west"), north: frameOf("north") };

function framePin(frame: Frame, position: Point, side: TerminalSide, color: WireColor): Point {
  return { x: position.x + (side === "out" ? frame.width : 0), y: position.y + frame.pinY[color] };
}

/** The point halfway between the two pins of a terminal. */
function frameCenter(frame: Frame, position: Point, side: TerminalSide): Point {
  const red = framePin(frame, position, side, "red");
  const green = framePin(frame, position, side, "green");
  return { x: (red.x + green.x) / 2, y: (red.y + green.y) / 2 };
}

/**
 * Distance between the vertical legs of the two colors in a gap of this width: a pin spacing where there is room, less where
 * both legs would not stay off the cards. Zero only for cards that touch or overlap, where the colors may share a line.
 */
function legSpacing(gap: number): number {
  return Math.max(0, Math.min(PIN_SPACING, gap - 2 * LEG_MARGIN));
}

/** A connection between the two terminals of one card: leaves through the output pin, passes over the top and re-enters at the input pin. */
function feedbackRoute(frame: Frame, position: Point, color: WireColor): WireRoute {
  const clearance = FEEDBACK_CLEARANCE[color];
  const out = framePin(frame, position, "out", color);
  const input = framePin(frame, position, "in", color);
  const right = position.x + frame.width + clearance;
  const left = position.x - clearance;
  const top = position.y - clearance;
  return [out, { x: right, y: out.y }, { x: right, y: top }, { x: left, y: top }, { x: left, y: input.y }, input];
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
function detourRoute(frame: Frame, color: WireColor, out: Point, input: Point): WireRoute {
  const from = frameCenter(frame, out, "out");
  const to = frameCenter(frame, input, "in");
  const upper = out.y <= input.y ? out : input;
  const lower = upper === out ? input : out;
  const gap = lower.y - (upper.y + frame.height);
  const between = gap >= 2 * SIDE_CLEARANCE;
  const crossing = between ? upper.y + frame.height + gap / 2 : lower.y + frame.height + DETOUR_BELOW;
  let right = from.x + SIDE_CLEARANCE;
  let left = to.x - SIDE_CLEARANCE;
  if (!between) {
    // On the way below both cards, the vertical run beside the upper card also has to clear the lower one.
    if (lower === input) right = Math.max(right, to.x + frame.width + SIDE_CLEARANCE);
    else left = Math.min(left, from.x - frame.width - SIDE_CLEARANCE);
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
function sameSideRoute(frame: Frame, color: WireColor, side: TerminalSide, a: Point, b: Point): WireRoute {
  const outward = side === "out" ? 1 : -1;
  // `front` is the terminal further out, the lower one of two in a column, so the route does not depend on the order of the ends.
  const swap = ((a.x - b.x) * outward || a.y - b.y) > 0;
  const [back, front] = swap ? [b, a] : [a, b];
  const start = framePin(frame, back, side, color);
  const end = framePin(frame, front, side, color);
  const level = frameCenter(frame, back, side).y;
  const blocked = start.x !== end.x && level > front.y - SIDE_CLEARANCE && level < front.y + frame.height + SIDE_CLEARANCE;
  const above = blocked && level < frameCenter(frame, front, side).y;
  // +1 for the color on the inner line, -1 for the outer one. Red is outside unless the wire passes above the front card: the crossing is then at the far corner of the lane, away from the pins.
  const inward = (above ? -1 : 1) * colorSign(color);
  const frontLeg = end.x + outward * (SIDE_CLEARANCE - inward * HALF_SPACING);
  if (!blocked) return tidy([start, { x: frontLeg, y: start.y }, { x: frontLeg, y: end.y }, end]);
  const gap = (end.x - start.x) * outward - frame.width;
  const backLeg = start.x + outward * (Math.max(0, Math.min(SIDE_CLEARANCE, gap / 2)) - (inward * legSpacing(gap)) / 2);
  // The lane keeps its clearance from the card and is at least a pin spacing away from the level of the back terminal, which leaves room for two corners.
  const laneCenter = above ? Math.min(front.y - SIDE_CLEARANCE, level - PIN_SPACING) : Math.max(front.y + frame.height + SIDE_CLEARANCE, level + PIN_SPACING);
  const lane = laneCenter + colorSign(color) * HALF_SPACING;
  return tidy([start, { x: backLeg, y: start.y }, { x: backLeg, y: lane }, { x: frontLeg, y: lane }, { x: frontLeg, y: end.y }, end]);
}

/** The route between two terminals of entities that both face `facing`, or between the two terminals of one such entity. */
function alignedRoute(color: WireColor, facing: Direction, a: WireEnd, b: WireEnd, sameEntity: boolean): WireRoute {
  const frame = FRAMES[facing];
  const [first, second] = [framePosition(a.position, facing), framePosition(b.position, facing)];
  const route = (): WireRoute => {
    if (a.side === b.side) return sameSideRoute(frame, color, a.side, first, second);
    const [out, input] = a.side === "out" ? [first, second] : [second, first];
    if (sameEntity) return feedbackRoute(frame, out, color);
    const start = framePin(frame, out, "out", color);
    const end = framePin(frame, input, "in", color);
    return end.x - start.x < frame.minForwardGap ? detourRoute(frame, color, out, input) : forwardRoute(color, start, end);
  };
  return facing === DEFAULT_FACING ? route() : route().map((point) => fromFrame(point, facing));
}

// Two entities that face different ways. Their pins sit on edges in any combination, so the line is searched on the lanes
// around the two cards instead of being built from a rule per case.

/** One end of a line that is searched: where it attaches, which way it leaves the card, and the card. */
interface Port {
  readonly pin: Point;
  /** Index into `HEADINGS`. */
  readonly heading: number;
  readonly card: Rect;
}

/** The four directions of travel in clockwise order, so that `(heading + 2) % 4` is the way back. */
const HEADINGS: readonly Point[] = CLOCKWISE.map((direction) => DIRECTION_VECTOR[direction]);
/** What a corner costs in units of length: a line with fewer corners wins unless it is this much longer per corner saved. */
const CORNER_COST = 100;
/**
 * Added for a corner onto a lane, by what the lane belongs to; decides between lines that are otherwise equal. The lane midway
 * between the cards comes first, then the lanes of the pins and of the first card, then the others. Two colors that are routed
 * one by one so turn beside the same card where they have the choice, each on its own lane.
 */
const LANE_COST = { middle: 0, near: 0.01, far: 0.02 } as const;

/** How far apart two cards are along the axis that separates them; negative when they overlap. */
function gapBetween(a: Rect, b: Rect): number {
  return Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
}

/** The terminal of `end` as the start of a line: the pin of `color`, or the point halfway between the two pins. */
function portOf(end: WireEnd, color?: WireColor): Port {
  const facing = end.facing ?? DEFAULT_FACING;
  const [first, second] = [pinPoint(end.position, end.side, color ?? "red", facing), pinPoint(end.position, end.side, color ?? "green", facing)];
  return { pin: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, heading: CLOCKWISE.indexOf(pinHeading(end.side, facing)), card: cardRect(end.position) };
}

function ahead(point: Point, heading: number, length: number): Point {
  const unit = HEADINGS[heading]!;
  return { x: point.x + unit.x * length, y: point.y + unit.y * length };
}

/** The extent of a card on one axis. */
type Span = readonly [low: number, high: number];

/** The line midway between two spans that are at least `room` apart, as a list of none or one. */
function midway(a: Span, b: Span, room: number): number[] {
  if (b[0] - a[1] >= room) return [(a[1] + b[0]) / 2];
  return a[0] - b[1] >= room ? [(b[1] + a[0]) / 2] : [];
}

/** True when the axis-aligned segment from `from` to `to` passes through the inside of `rect`; running along its border does not count. */
function passesThrough(rect: Rect, from: Point, to: Point): boolean {
  return Math.max(from.x, to.x) > rect.x && Math.min(from.x, to.x) < rect.x + rect.width && Math.max(from.y, to.y) > rect.y && Math.min(from.y, to.y) < rect.y + rect.height;
}

/**
 * The line with the fewest corners, and among those the shortest, from one terminal to the other. It leaves and enters each
 * pin at a right angle and is straight for at least `reach` there. It runs on a small set of lanes: the lines through the two
 * pins, the lines `reach` beside each card and, with `middle`, the line midway between the cards where they are apart. It
 * stays `keep` away from both cards (not at all when `keep` is undefined). Undefined when the lanes hold no such line.
 */
function searchLine(a: Port, b: Port, reach: number, keep: number | undefined, middle: boolean): Point[] | undefined {
  const from = ahead(a.pin, a.heading, reach);
  const to = ahead(b.pin, b.heading, reach);
  const obstacles = keep === undefined ? [] : [expandRect(a.card, keep), expandRect(b.card, keep)];
  // The piece of a line between its pin and the first lane lies beside its own card, but must not reach into the other one.
  if (obstacles.length > 0 && (passesThrough(obstacles[1]!, a.pin, from) || passesThrough(obstacles[0]!, b.pin, to))) return undefined;

  // The lanes of one axis and what a corner onto each of them costs; a lane with several roles keeps the lowest cost.
  const lanes = (aSpan: Span, bSpan: Span, pins: readonly number[]): Map<number, number> => {
    const beside = ([low, high]: Span): number[] => [low - reach, high + reach];
    const near = [...beside(aSpan), ...pins];
    const inner = [...beside(bSpan), ...near];
    // One more lane on every side, so that a line can always turn around.
    const result = new Map<number, number>([...beside(bSpan), Math.min(...inner) - reach, Math.max(...inner) + reach].map((lane) => [lane, LANE_COST.far]));
    for (const lane of near) result.set(lane, LANE_COST.near);
    if (middle) for (const lane of midway(aSpan, bSpan, 2 * reach)) result.set(lane, LANE_COST.middle);
    return result;
  };
  const laneX = lanes([a.card.x, a.card.x + a.card.width], [b.card.x, b.card.x + b.card.width], [from.x, to.x]);
  const laneY = lanes([a.card.y, a.card.y + a.card.height], [b.card.y, b.card.y + b.card.height], [from.y, to.y]);
  const [xs, ys] = [[...laneX.keys()].sort((p, q) => p - q), [...laneY.keys()].sort((p, q) => p - q)];

  // Dijkstra over (lane crossing, direction of arrival). The grid has a few dozen crossings.
  const state = (xi: number, yi: number, heading: number): number => (xi * ys.length + yi) * 4 + heading;
  const cost = new Float64Array(xs.length * ys.length * 4).fill(Infinity);
  const previous = new Int32Array(cost.length).fill(-1);
  const start = state(xs.indexOf(from.x), ys.indexOf(from.y), a.heading);
  const target = state(xs.indexOf(to.x), ys.indexOf(to.y), 0);
  let goal = -1;
  let goalCost = Infinity;
  cost[start] = 0;
  const open = [start];
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (cost[open[i]!]! < cost[open[best]!]!) best = i;
    const current = open.splice(best, 1)[0]!;
    if (cost[current]! >= goalCost) break;
    const heading = current % 4;
    // `target` is the end of the straight piece in front of the second pin, not the pin. The line may arrive there from any
    // side but the card's own; unless it arrives head-on it turns there, and so always enters the pin at a right angle to its edge.
    if (current - heading === target && heading !== b.heading) {
      const total = cost[current]! + (heading === (b.heading + 2) % 4 ? 0 : CORNER_COST);
      if (total < goalCost) [goal, goalCost] = [current, total];
    }
    const yi = Math.floor(current / 4) % ys.length;
    const xi = Math.floor(current / 4 / ys.length);
    const here = { x: xs[xi]!, y: ys[yi]! };
    for (let next = 0; next < 4; next++) {
      if (next === (heading + 2) % 4) continue;
      const unit = HEADINGS[next]!;
      const [nx, ny] = [xi + unit.x, yi + unit.y];
      if (nx < 0 || ny < 0 || nx >= xs.length || ny >= ys.length) continue;
      const there = { x: xs[nx]!, y: ys[ny]! };
      if (obstacles.some((rect) => passesThrough(rect, here, there))) continue;
      const corner = next === heading ? 0 : CORNER_COST + (unit.x === 0 ? laneX.get(here.x)! : laneY.get(here.y)!);
      const total = cost[current]! + Math.abs(there.x - here.x) + Math.abs(there.y - here.y) + corner;
      const reached = state(nx, ny, next);
      if (total >= cost[reached]!) continue;
      if (cost[reached] === Infinity) open.push(reached);
      cost[reached] = total;
      previous[reached] = current;
    }
  }
  if (goal < 0) return undefined;
  const points = [b.pin];
  for (let current = goal; current >= 0; current = previous[current]!) points.push({ x: xs[Math.floor(current / 4 / ys.length)]!, y: ys[Math.floor(current / 4) % ys.length]! });
  points.push(a.pin);
  return tidy(points.reverse());
}

function dot(aFrom: Point, aTo: Point, bFrom: Point, bTo: Point): number {
  return (aTo.x - aFrom.x) * (bTo.x - bFrom.x) + (aTo.y - aFrom.y) * (bTo.y - bFrom.y);
}

/**
 * A line derived from `center` point by point, tidied, when it is still a line of its shape: no segment points the other way,
 * it leaves and enters its pins, and where a segment shrank to nothing the line does not fold back onto itself.
 */
function derived(points: readonly Point[], center: readonly Point[]): WireRoute | undefined {
  const last = center.length - 2;
  for (let i = 0; i <= last; i++) {
    const along = dot(points[i]!, points[i + 1]!, center[i]!, center[i + 1]!);
    if (along < 0 || (along === 0 && (i === 0 || i === last || dot(center[i - 1]!, center[i]!, center[i + 1]!, center[i + 2]!) < 0))) return undefined;
  }
  return tidy(points);
}

/**
 * Two outputs or two inputs: red is on one side of the line where it leaves and on the other where it arrives, so the colors
 * swap sides at one corner, where they cross at a right angle. The last corner with room for both is taken. Returns the line
 * that starts `startOffset` beside `center`.
 */
function crossedRoute(center: readonly Point[], startOffset: number): WireRoute | undefined {
  const sides = [offsetPolyline(center, startOffset), offsetPolyline(center, -startOffset)] as const;
  for (let corner = center.length - 2; corner >= 1; corner--) {
    const horizontal = center[corner - 1]!.y === center[corner]!.y;
    const [route, other] = [sides, [sides[1], sides[0]] as const].map(([before, after]) => {
      const turn = horizontal ? { x: after[corner]!.x, y: before[corner]!.y } : { x: before[corner]!.x, y: after[corner]!.y };
      return derived([...before.slice(0, corner), turn, ...after.slice(corner + 1)], center);
    });
    if (route && other) return route;
  }
  return undefined;
}

/**
 * Two outputs or two inputs that face each other on one line. Without a corner to swap sides at, red steps over to its side
 * halfway and green passes around that step: it leaves its line next to the first card, runs a pin spacing further out and
 * comes back across red next to the second card. Undefined when the cards are too close for the three legs.
 */
function twistedRoute(color: WireColor, from: Point, to: Point, startOffset: number): WireRoute | undefined {
  const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  if (length < 4 * HALF_SPACING) return undefined;
  const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const at = (distance: number, offset: number): Point => ({ x: from.x + along.x * distance - along.y * offset + 0, y: from.y + along.y * distance + along.x * offset + 0 });
  if (color === "red") return [at(0, startOffset), at(length / 2, startOffset), at(length / 2, -startOffset), at(length, -startOffset)];
  const [near, far] = [SIDE_CLEARANCE - HALF_SPACING, length - (SIDE_CLEARANCE - HALF_SPACING)];
  return [at(0, startOffset), at(near, startOffset), at(near, 3 * startOffset), at(far, 3 * startOffset), at(far, -startOffset), at(length, -startOffset)];
}

/**
 * A wire on lanes of its own, where the cards leave no room for a pair. Green takes the inner lane, as beside a terminal of
 * two entities facing the same way: 10 and 30 units from the cards, in a narrow gap 3 units and what the gap leaves for the
 * other lane (see `legSpacing`). The colors are not a pair here and may cross more than once. The last resort ignores the
 * cards, which then touch or overlap.
 */
function ownRoute(color: WireColor, a: WireEnd, b: WireEnd): WireRoute {
  const [from, to] = [portOf(a, color), portOf(b, color)];
  const inner = color === "green";
  const squeezed = LEG_MARGIN + (inner ? 0 : Math.min(HALF_SPACING, legSpacing(gapBetween(from.card, to.card))));
  return (
    searchLine(from, to, SIDE_CLEARANCE + (inner ? -HALF_SPACING : HALF_SPACING), SIDE_CLEARANCE - HALF_SPACING, false) ??
    searchLine(from, to, squeezed, LEG_MARGIN, false) ??
    // Without cards in the way the lanes are a full grid with a lane beyond every pin, which always holds a line.
    searchLine(from, to, HALF_SPACING, undefined, false)!
  );
}

/**
 * The route between terminals of two entities that face different ways. The line between the centers of the two terminals is
 * searched with room for both colors (20 units from the cards, half the gap between cards 26 to 40 apart), and the colors
 * run 10 units to its sides: as exact parallels from an output to an input, with one crossing between two outputs or two
 * inputs. Where the cards leave no room for that, each color takes lanes of its own.
 */
function laneRoute(color: WireColor, a: WireEnd, b: WireEnd): WireRoute {
  // The search prefers what it finds first, so it always starts from the same end: the output, or the terminal further left (then up).
  const turns = (end: WireEnd): number => CLOCKWISE.indexOf(end.facing ?? DEFAULT_FACING);
  const swap = a.side === b.side ? (a.position.x - b.position.x || a.position.y - b.position.y || turns(a) - turns(b)) > 0 : a.side === "in";
  const [first, second] = swap ? [b, a] : [a, b];
  const [from, to] = [portOf(first), portOf(second)];
  // Between cards less than 40 apart the pair keeps half the gap from them, as long as that leaves both colors off the cards.
  const halfGap = gapBetween(from.card, to.card) / 2;
  const clearance = halfGap >= HALF_SPACING + LEG_MARGIN ? Math.min(SIDE_CLEARANCE, halfGap) : SIDE_CLEARANCE;
  const center = searchLine(from, to, clearance, clearance, true);
  if (center) {
    // Red is on the left of a wire that leaves an output and of one that enters an input.
    const offset = colorSign(color) * HALF_SPACING * (first.side === "out" ? 1 : -1);
    const route =
      first.side !== second.side ? derived(offsetPolyline(center, offset), center) : center.length === 2 ? twistedRoute(color, center[0]!, center[1]!, offset) : crossedRoute(center, offset);
    if (route) return route;
  }
  return ownRoute(color, first, second);
}

/**
 * Routes one wire from pin to pin. `sameEntity` must be true when both ends belong to the same entity (the positions
 * alone cannot tell, two cards may overlap). The route does not depend on the order of the two ends. Red and green
 * between the same pair of terminals get separate routes that never touch, except for the one crossing between two
 * inputs or two outputs (see `sameSideRoute` and `crossedRoute`) and where two cards leave no room (see `ownRoute`).
 */
export function routeWire(color: WireColor, a: WireEnd, b: WireEnd, sameEntity: boolean): WireRoute {
  const facing = a.facing ?? DEFAULT_FACING;
  return sameEntity || facing === (b.facing ?? DEFAULT_FACING) ? alignedRoute(color, facing, a, b, sameEntity) : laneRoute(color, a, b);
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
