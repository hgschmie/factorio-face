import { DIRECTIONS, type Direction, type Point, type WireColor } from "@face/model";
import { describe, expect, it } from "vitest";
import { CARD, cardRect, DIRECTION_VECTOR, GRID, PIN_SPACING, pinHeading, pinPoint, type PinPlace, type Rect } from "../src/canvas/geometry.ts";
import { CORNER_RADIUS, cornerRadii, FEEDBACK_CLEARANCE, routeBounds, routePath, routeWire, type WireEnd, type WireRoute } from "../src/canvas/wireRouting.ts";

const A: Point = { x: 40, y: 80 };
const COLORS = ["red", "green"] as const;
const SIDES = ["in", "out"] as const;

function strictlyInside(rect: Rect, point: Point): boolean {
  return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
}

function segments(route: WireRoute): [Point, Point][] {
  return route.slice(1).map((point, index) => [route[index]!, point]);
}

function length([from, to]: [Point, Point]): number {
  return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
}

function heading([from, to]: [Point, Point]): Point {
  return { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
}

/** Exact distance between two axis-aligned segments. */
function segmentDistance([a, b]: [Point, Point], [c, d]: [Point, Point]): number {
  const gap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.max(Math.min(a1, a2), Math.min(b1, b2)) - Math.min(Math.max(a1, a2), Math.max(b1, b2)));
  return Math.hypot(gap(a.x, b.x, c.x, d.x), gap(a.y, b.y, c.y, d.y));
}

function routeDistance(a: WireRoute, b: WireRoute): number {
  return Math.min(...segments(a).flatMap((s) => segments(b).map((t) => segmentDistance(s, t))));
}

/** How far two parallel segments run on one line (0 when they only touch or lie on different lines). */
function sharedLength([a, b]: [Point, Point], [c, d]: [Point, Point]): number {
  const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)));
  if (a.y === b.y && c.y === d.y && a.y === c.y) return overlap(a.x, b.x, c.x, d.x);
  return a.x === b.x && c.x === d.x && a.x === c.x ? overlap(a.y, b.y, c.y, d.y) : 0;
}

/** The places where two routes cross at a right angle, strictly inside both segments. */
function crossings(a: WireRoute, b: WireRoute): Point[] {
  const result: Point[] = [];
  for (const s of segments(a)) {
    for (const t of segments(b)) {
      const [horizontal, vertical] = s[0].y === s[1].y ? [s, t] : [t, s];
      if (horizontal[0].y !== horizontal[1].y || vertical[0].x !== vertical[1].x) continue;
      const point = { x: vertical[0].x, y: horizontal[0].y };
      const within = (value: number, p: number, q: number) => value > Math.min(p, q) && value < Math.max(p, q);
      if (within(point.x, horizontal[0].x, horizontal[1].x) && within(point.y, vertical[0].y, vertical[1].y)) result.push(point);
    }
  }
  return result;
}

/** An end at an input or an output: these tests are about the edges, not about a point that has two of them. */
type PlacedEnd = WireEnd & { readonly side: PinPlace };

function end(position: Point, side: PinPlace, facing: Direction): PlacedEnd {
  return { position, side, facing };
}

/** True when a segment of the route passes through the inside of one of the cards. */
function crossesCard(wire: WireRoute, ...cards: Point[]): boolean {
  return segments(wire).some(([from, to]) =>
    cards.map(cardRect).some((rect) => Math.max(from.x, to.x) > rect.x && Math.min(from.x, to.x) < rect.x + rect.width && Math.max(from.y, to.y) > rect.y && Math.min(from.y, to.y) < rect.y + rect.height),
  );
}

/** How far two cards are apart along the axis that separates them. */
function gap(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x) - CARD.width, Math.abs(a.y - b.y) - CARD.height);
}

/** Positions on the grid around A where a second card does not overlap the card at A. The step keeps the sweep over all directions fast. */
function placements(reach = 400, step = 2 * GRID): Point[] {
  const result: Point[] = [];
  for (let dx = -reach; dx <= reach; dx += step) {
    for (let dy = -reach; dy <= reach; dy += step) if (Math.abs(dx) >= CARD.width || Math.abs(dy) >= CARD.height) result.push({ x: A.x + dx, y: A.y + dy });
  }
  return result;
}

interface Case {
  readonly a: PlacedEnd;
  readonly b: PlacedEnd;
  readonly sameEntity: boolean;
  readonly red: WireRoute;
  readonly green: WireRoute;
}

function routed(a: PlacedEnd, b: PlacedEnd, sameEntity = false): Case {
  return { a, b, sameEntity, red: routeWire("red", a, b, sameEntity), green: routeWire("green", a, b, sameEntity) };
}

/**
 * All 16 combinations of directions with all four combinations of sides (both same-side cases among them), over a coarse grid
 * of placements and a fine one for cards close to each other, and the feedback loop in every direction.
 */
const CASES: Case[] = [
  ...DIRECTIONS.flatMap((facingA) =>
    DIRECTIONS.flatMap((facingB) => [...placements(400, 2 * GRID), ...placements(220, GRID).filter((target) => (target.x - A.x) % (2 * GRID) !== 0 || (target.y - A.y) % (2 * GRID) !== 0)].flatMap((target) => SIDES.flatMap((sideA) => SIDES.map((sideB) => routed(end(A, sideA, facingA), end(target, sideB, facingB))))),
    ),
  ),
  ...DIRECTIONS.map((facing) => routed(end(A, "out", facing), end(A, "in", facing), true)),
];

function describeCase({ a, b }: Case, color?: WireColor): string {
  return `${color ?? "pair"} ${a.facing}.${a.side} (${a.position.x}, ${a.position.y}) <-> ${b.facing}.${b.side} (${b.position.x}, ${b.position.y})`;
}

/** The cases, each with both colors, for which `broken` holds; a test expects none. Checking in plain code keeps the sweep fast. */
function failures(broken: (wire: WireRoute, testCase: Case, color: WireColor) => boolean, cases: readonly Case[] = CASES): string[] {
  return cases.flatMap((testCase) => COLORS.filter((color) => broken(testCase[color], testCase, color)).map((color) => describeCase(testCase, color))).slice(0, 5);
}

const same = (p: Point, q: Point): boolean => p.x === q.x && p.y === q.y;

describe("every wire between entities facing any way", () => {
  it("covers every combination of directions and sides", () => {
    expect(new Set(CASES.map(({ a, b }) => `${a.facing} ${a.side} ${b.facing} ${b.side}`)).size).toBe(4 * 4 * 2 * 2);
    expect(CASES.length).toBeGreaterThan(30_000);
  });

  it("consists of horizontal and vertical segments that turn at every corner", () => {
    expect(
      failures((wire) => {
        const horizontal = segments(wire).map(([from, to]) => from.y === to.y);
        return wire.length < 2 || segments(wire).some(([from, to]) => (from.x === to.x) === (from.y === to.y)) || horizontal.some((value, index) => index > 0 && value === horizontal[index - 1]);
      }),
    ).toEqual([]);
  });

  it("starts and ends in the pin centers of its color", () => {
    expect(
      failures((wire, { a, b }, color) => {
        const [first, last] = [pinPoint(a.position, a.side, color, a.facing), pinPoint(b.position, b.side, color, b.facing)];
        return !(same(wire[0]!, first) && same(wire.at(-1)!, last)) && !(same(wire[0]!, last) && same(wire.at(-1)!, first));
      }),
    ).toEqual([]);
  });

  it("leaves and enters each pin at a right angle to its edge, away from the card", () => {
    expect(
      failures((wire, { a, b }, color) => {
        const forward = same(wire[0]!, pinPoint(a.position, a.side, color, a.facing)) ? wire : [...wire].reverse();
        return !same(heading([forward[0]!, forward[1]!]), DIRECTION_VECTOR[pinHeading(a.side, a.facing)]) || !same(heading([forward.at(-1)!, forward.at(-2)!]), DIRECTION_VECTOR[pinHeading(b.side, b.facing)]);
      }),
    ).toEqual([]);
  });

  it("is the same route whichever end it was started from", () => {
    expect(failures((wire, { a, b, sameEntity }, color) => JSON.stringify(routeWire(color, b, a, sameEntity)) !== JSON.stringify(wire))).toEqual([]);
  }, 30_000);

  it("stays off its own two cards", () => {
    expect(failures((wire, { a, b }) => crossesCard(wire, a.position, b.position))).toEqual([]);
  });

  it("has corner radii that fit the adjacent segments, so the rounded line has no kinks and never overshoots", () => {
    expect(
      failures((wire) => {
        const radii = cornerRadii(wire);
        return radii.length !== wire.length - 2 || radii.some((radius) => radius <= 0 || radius > CORNER_RADIUS) || segments(wire).some((segment, index) => (radii[index - 1] ?? 0) + (radii[index] ?? 0) > length(segment));
      }),
    ).toEqual([]);
  });

  it("produces rounded path data and bounds that contain it, without a negative zero", () => {
    const shape = /^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+)* L [-\d.]+ [-\d.]+$/;
    expect(
      failures((wire) => {
        const bounds = routeBounds(wire);
        const outside = wire.some((point) => point.x < bounds.x || point.x > bounds.x + bounds.width || point.y < bounds.y || point.y > bounds.y + bounds.height);
        return outside || !shape.test(routePath(wire)) || routePath(wire).includes("-0 ") || wire.some((point) => Object.is(point.x, -0) || Object.is(point.y, -0));
      }),
    ).toEqual([]);
  });

  it("stays well-formed for cards off the grid, touching or on top of each other", () => {
    let seed = 11;
    const random = (range: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % (2 * range + 1)) - range;
    const targets = [A, { x: A.x + CARD.width, y: A.y }, { x: A.x, y: A.y + CARD.height }, { x: A.x + 190, y: A.y + 7 }, { x: A.x + 3, y: A.y - 131 }, ...Array.from({ length: 150 }, () => ({ x: A.x + random(420), y: A.y + random(300) }))];
    const cases = DIRECTIONS.flatMap((facingA) => DIRECTIONS.flatMap((facingB) => targets.flatMap((target) => SIDES.flatMap((sideA) => SIDES.map((sideB) => routed(end(A, sideA, facingA), end(target, sideB, facingB)))))));
    expect(
      failures((wire, { a, b }, color) => {
        const radii = cornerRadii(wire);
        const ends = [pinPoint(a.position, a.side, color, a.facing), pinPoint(b.position, b.side, color, b.facing)];
        return (
          !ends.every((pin) => same(pin, wire[0]!) || same(pin, wire.at(-1)!)) ||
          segments(wire).some(([from, to]) => (from.x === to.x) === (from.y === to.y)) ||
          segments(wire).some((segment, index) => (radii[index - 1] ?? 0) + (radii[index] ?? 0) > length(segment) + 1e-9)
        );
      }, cases),
    ).toEqual([]);
  });
});

describe("red and green between the same two terminals of entities facing different ways", () => {
  const mixed = CASES.filter(({ a, b, sameEntity }) => !sameEntity && a.facing !== b.facing);
  const roomy = mixed.filter(({ a, b }) => gap(a.position, b.position) >= 2 * GRID);

  it("run as exact parallels a pin spacing apart from an output to an input, wherever the cards are at least 40 apart", () => {
    const cases = roomy.filter(({ a, b }) => a.side !== b.side);
    expect(cases.length).toBeGreaterThan(5_000);
    expect(cases.filter(({ red, green }) => red.length !== green.length || routeDistance(red, green) !== PIN_SPACING || crossings(red, green).length > 0).map((testCase) => describeCase(testCase)).slice(0, 5)).toEqual([]);
  });

  it("cross exactly once, at a right angle, between two outputs or two inputs, and share no stretch of a line", () => {
    const cases = roomy.filter(({ a, b }) => a.side === b.side);
    expect(cases.length).toBeGreaterThan(5_000);
    const shared = ({ red, green }: Case): number => Math.max(...segments(red).flatMap((s) => segments(green).map((t) => sharedLength(s, t))));
    expect(cases.filter((testCase) => crossings(testCase.red, testCase.green).length !== 1 || shared(testCase) > 0).map((testCase) => describeCase(testCase)).slice(0, 5)).toEqual([]);
  });

  it("stay parallel in a gap of 26 to 40 units as well, which is just wide enough for the pair", () => {
    // East output above the top input of a card facing south, two grid steps to its right: the pair turns down in the 36 unit gap.
    const { red, green } = routed(end(A, "out", "east"), end({ x: A.x + 220, y: A.y + 200 }, "in", "south"));
    expect([red.length, green.length, routeDistance(red, green)]).toEqual([3, 3, PIN_SPACING]);
    // Two cards a grid step apart have no room for a pair between them; the wires take lanes of their own, 3 and 13 units from the cards.
    const tight = routed(end(A, "out", "east"), end({ x: A.x + 200, y: A.y - 40 }, "in", "north"));
    expect(crossesCard(tight.red, A, tight.b.position) || crossesCard(tight.green, A, tight.b.position)).toBe(false);
    expect([tight.red[1]!.x, tight.green[1]!.x].map((x) => x - (A.x + CARD.width))).toEqual([13, 3]);
    expect(Math.max(...segments(tight.red).flatMap((s) => segments(tight.green).map((t) => sharedLength(s, t))))).toBe(0);
  });
});

describe("routes of rotated entities, by example", () => {
  const points = (wire: WireRoute): number[][] => wire.map((point) => [point.x, point.y]);

  it("connects a column of entities facing south with straight vertical lines, red right of green", () => {
    const below = { x: A.x, y: A.y + 180 };
    const { red, green } = routed(end(A, "out", "south"), end(below, "in", "south"));
    expect(points(red)).toEqual([[A.x + 100, A.y + CARD.height], [A.x + 100, below.y]]);
    expect(points(green)).toEqual([[A.x + 80, A.y + CARD.height], [A.x + 80, below.y]]);
    // Facing north the chain runs upwards, facing west to the left.
    expect(points(routed(end(below, "out", "north"), end(A, "in", "north")).red)).toEqual([[A.x + 80, below.y], [A.x + 80, A.y + CARD.height]]);
    expect(points(routed(end({ x: 300, y: A.y }, "out", "west"), end(A, "in", "west")).red)).toEqual([[300, A.y + 80], [A.x + CARD.width, A.y + 80]]);
  });

  it("gives entities that face the same way the routes of entities facing east, turned with them", () => {
    // One leg midway between two cards that are not in line: for cards facing south the leg is horizontal.
    const target = { x: A.x + 260, y: A.y + 260 };
    const { red, green } = routed(end(A, "out", "south"), end(target, "in", "south"));
    const middle = (A.y + CARD.height + target.y) / 2;
    expect(points(red)).toEqual([[A.x + 100, A.y + CARD.height], [A.x + 100, middle - 10], [target.x + 100, middle - 10], [target.x + 100, target.y]]);
    expect(points(green)).toEqual([[A.x + 80, A.y + CARD.height], [A.x + 80, middle + 10], [target.x + 80, middle + 10], [target.x + 80, target.y]]);
    expect(routeDistance(red, green)).toBe(PIN_SPACING);
    // Two outputs of cards facing west: a leg 10 (green) and 30 (red) beyond the terminal further left.
    const outputs = routed(end(A, "out", "west"), end({ x: A.x + 100, y: A.y + 300 }, "out", "west"));
    expect([outputs.red, outputs.green].map((wire) => [wire.length, A.x - wire[1]!.x])).toEqual([[4, 30], [4, 10]]);
  });

  it("loops a feedback wire around the side of the card on which the red pins sit, red inside", () => {
    const card = cardRect(A);
    const loops = Object.fromEntries(DIRECTIONS.map((facing) => [facing, routed(end(A, "out", facing), end(A, "in", facing), true)])) as Record<Direction, Case>;
    for (const facing of DIRECTIONS) {
      const { red, green } = loops[facing];
      expect([red.length, green.length, routeDistance(red, green)]).toEqual([6, 6, PIN_SPACING]);
      expect([red, green].map(cornerRadii)).toEqual([Array(4).fill(CORNER_RADIUS), Array(4).fill(CORNER_RADIUS)]);
      for (const color of COLORS) expect([loops[facing][color][0], loops[facing][color].at(-1)]).toEqual([pinPoint(A, "out", color, facing), pinPoint(A, "in", color, facing)]);
    }
    const reach = (facing: Direction, color: WireColor) => routeBounds(loops[facing][color]);
    for (const color of COLORS) {
      const clearance = FEEDBACK_CLEARANCE[color];
      expect(reach("east", color)).toMatchObject({ y: card.y - clearance, height: CARD.pinY[color] + clearance });
      expect(reach("south", color)).toMatchObject({ x: card.x + CARD.pinX[color === "red" ? "green" : "red"], width: CARD.width - CARD.pinX[color === "red" ? "green" : "red"] + clearance });
      expect(reach("west", color)).toMatchObject({ y: card.y + CARD.pinY[color === "red" ? "green" : "red"], height: CARD.height - CARD.pinY[color === "red" ? "green" : "red"] + clearance });
      expect(reach("north", color)).toMatchObject({ x: card.x - clearance, width: CARD.pinX[color] + clearance });
      // Whatever the direction, a loop stays within 40 units of its card, which is what Fit to Content allows for.
      for (const facing of DIRECTIONS) {
        const bounds = reach(facing, color);
        expect([card.x - bounds.x, card.y - bounds.y, bounds.x + bounds.width - card.x - card.width, bounds.y + bounds.height - card.y - card.height].every((beyond) => beyond <= FEEDBACK_CLEARANCE.green)).toBe(true);
      }
    }
  });

  it("turns once from an output on the right into an input on a top edge below it, the colors nested", () => {
    const target = { x: A.x + 300, y: A.y + 200 };
    const { red, green } = routed(end(A, "out", "east"), end(target, "in", "south"));
    expect(points(red)).toEqual([[A.x + CARD.width, A.y + 60], [target.x + 100, A.y + 60], [target.x + 100, target.y]]);
    expect(points(green)).toEqual([[A.x + CARD.width, A.y + 80], [target.x + 80, A.y + 80], [target.x + 80, target.y]]);
  });

  it("puts the leg of a longer way around midway between the two cards, 20 units from them where it passes one", () => {
    // The input on the top edge is higher than the output: right, up between the cards, over the card and down into it.
    const target = { x: A.x + 300, y: A.y - 100 };
    const { red, green } = routed(end(A, "out", "east"), end(target, "in", "south"));
    const middle = (A.x + CARD.width + target.x) / 2;
    expect(points(red)).toEqual([[A.x + CARD.width, A.y + 60], [middle - 10, A.y + 60], [middle - 10, target.y - 30], [target.x + 100, target.y - 30], [target.x + 100, target.y]]);
    expect(points(green)).toEqual([[A.x + CARD.width, A.y + 80], [middle + 10, A.y + 80], [middle + 10, target.y - 10], [target.x + 80, target.y - 10], [target.x + 80, target.y]]);
  });

  it("crosses the colors at a corner between two outputs on different edges", () => {
    const target = { x: A.x + 300, y: A.y - 300 };
    const { red, green } = routed(end(A, "out", "east"), end(target, "out", "south"));
    expect(points(red)).toEqual([[A.x + CARD.width, A.y + 60], [target.x + 100, A.y + 60], [target.x + 100, target.y + CARD.height]]);
    expect(points(green)).toEqual([[A.x + CARD.width, A.y + 80], [target.x + 80, A.y + 80], [target.x + 80, target.y + CARD.height]]);
    expect(crossings(red, green)).toEqual([{ x: target.x + 80, y: A.y + 60 }]);
  });

  it("lets green pass around the step of red between two outputs that face each other on one line", () => {
    const target = { x: A.x + 260, y: A.y };
    const { red, green } = routed(end(A, "out", "east"), end(target, "out", "west"));
    const [left, right] = [A.x + CARD.width, target.x];
    expect(points(red)).toEqual([[left, A.y + 60], [(left + right) / 2, A.y + 60], [(left + right) / 2, A.y + 80], [right, A.y + 80]]);
    expect(points(green)).toEqual([[left, A.y + 80], [left + 10, A.y + 80], [left + 10, A.y + 100], [right - 10, A.y + 100], [right - 10, A.y + 60], [right, A.y + 60]]);
    expect(crossings(red, green)).toEqual([{ x: right - 10, y: A.y + 80 }]);
    // The same between a card facing south and one facing north below it.
    const below = routed(end(A, "out", "south"), end({ x: A.x, y: A.y + 220 }, "out", "north"));
    expect([below.red.length, below.green.length, crossings(below.red, below.green).length]).toEqual([4, 6, 1]);
  });
});

describe("routes between two entities facing east", () => {
  const pinned: { name: string; color: WireColor; a: PinPlace; target: Point; b: PinPlace; sameEntity: boolean; route: number[][] }[] = [
    { name: "forward", color: "red", a: "out", target: { x: 300, y: 260 }, b: "in", sameEntity: false, route: [[224, 140], [272, 140], [272, 320], [300, 320]] },
    { name: "forward", color: "green", a: "out", target: { x: 300, y: 260 }, b: "in", sameEntity: false, route: [[224, 160], [252, 160], [252, 340], [300, 340]] },
    { name: "narrow", color: "red", a: "out", target: { x: 240, y: -100 }, b: "in", sameEntity: false, route: [[224, 140], [227, 140], [227, -40], [240, -40]] },
    { name: "narrow", color: "green", a: "out", target: { x: 240, y: -100 }, b: "in", sameEntity: false, route: [[224, 160], [237, 160], [237, -20], [240, -20]] },
    { name: "detour between", color: "red", a: "out", target: { x: 40, y: 300 }, b: "in", sameEntity: false, route: [[224, 140], [254, 140], [254, 264], [30, 264], [30, 360], [40, 360]] },
    { name: "detour between", color: "green", a: "out", target: { x: 40, y: 300 }, b: "in", sameEntity: false, route: [[224, 160], [234, 160], [234, 244], [10, 244], [10, 380], [40, 380]] },
    { name: "detour below", color: "red", a: "out", target: { x: -260, y: 100 }, b: "in", sameEntity: false, route: [[224, 140], [254, 140], [254, 268], [-290, 268], [-290, 160], [-260, 160]] },
    { name: "detour below", color: "green", a: "out", target: { x: -260, y: 100 }, b: "in", sameEntity: false, route: [[224, 160], [234, 160], [234, 248], [-270, 248], [-270, 180], [-260, 180]] },
    { name: "feedback", color: "red", a: "out", target: { x: 40, y: 80 }, b: "in", sameEntity: true, route: [[224, 140], [244, 140], [244, 60], [20, 60], [20, 140], [40, 140]] },
    { name: "feedback", color: "green", a: "out", target: { x: 40, y: 80 }, b: "in", sameEntity: true, route: [[224, 160], [264, 160], [264, 40], [0, 40], [0, 160], [40, 160]] },
    { name: "same side blocked", color: "red", a: "out", target: { x: 300, y: 80 }, b: "out", sameEntity: false, route: [[224, 140], [254, 140], [254, 218], [514, 218], [514, 140], [484, 140]] },
    { name: "same side blocked", color: "green", a: "out", target: { x: 300, y: 80 }, b: "out", sameEntity: false, route: [[224, 160], [234, 160], [234, 238], [494, 238], [494, 160], [484, 160]] },
    { name: "same side", color: "red", a: "in", target: { x: -60, y: 300 }, b: "in", sameEntity: false, route: [[40, 140], [-90, 140], [-90, 360], [-60, 360]] },
    { name: "same side", color: "green", a: "in", target: { x: -60, y: 300 }, b: "in", sameEntity: false, route: [[40, 160], [-70, 160], [-70, 380], [-60, 380]] },
  ];

  it("are what they were before entities could be rotated (points recorded from that version)", () => {
    for (const { name, color, a, target, b, sameEntity, route } of pinned) {
      const wire = routeWire(color, { position: A, side: a }, { position: target, side: b }, sameEntity);
      expect(wire.map((point) => [point.x, point.y]), `${name} ${color}`).toEqual(route);
    }
  });

  it("do not depend on whether the direction is written out", () => {
    const targets = [...placements(), A];
    for (const target of targets) {
      for (const a of SIDES) for (const b of SIDES) for (const color of COLORS) {
        const implied = routeWire(color, { position: A, side: a }, { position: target, side: b }, target === A);
        if (JSON.stringify(routeWire(color, end(A, a, "east"), end(target, b, "east"), target === A)) !== JSON.stringify(implied)) throw new Error(`east differs from the default at (${target.x}, ${target.y})`);
        if (JSON.stringify(routeWire(color, end(A, a, "east"), { position: target, side: b }, target === A)) !== JSON.stringify(implied)) throw new Error(`a mixed spelling differs at (${target.x}, ${target.y})`);
      }
    }
  });
});
