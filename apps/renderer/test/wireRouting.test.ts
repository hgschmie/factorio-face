import type { Point, TerminalSide, WireColor } from "@face/model";
import { describe, expect, it } from "vitest";
import { CARD, cardRect, GRID, PIN_SPACING, pinPoint, type Rect } from "../src/canvas/geometry.ts";
import { CORNER_RADIUS, cornerRadii, FEEDBACK_CLEARANCE, offsetPolyline, routeBounds, routePath, routeWire, sampleRoute, type WireRoute } from "../src/canvas/wireRouting.ts";

const A: Point = { x: 40, y: 80 };
const B: Point = { x: 300, y: 80 };
const COLORS = ["red", "green"] as const;
const SIDES = ["in", "out"] as const;
/** Width of the dark casing a wire is drawn with: two wires closer than this touch. */
const CASING_WIDTH = 7;

function strictlyInside(rect: Rect, point: Point): boolean {
  return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
}

function segments(route: WireRoute): [Point, Point][] {
  return route.slice(1).map((point, index) => [route[index]!, point]);
}

function length([from, to]: [Point, Point]): number {
  return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
}

/** Exact distance between two axis-aligned segments. */
function segmentDistance([a, b]: [Point, Point], [c, d]: [Point, Point]): number {
  const gap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.max(Math.min(a1, a2), Math.min(b1, b2)) - Math.min(Math.max(a1, a2), Math.max(b1, b2)));
  return Math.hypot(gap(a.x, b.x, c.x, d.x), gap(a.y, b.y, c.y, d.y));
}

function routeDistance(a: WireRoute, b: WireRoute): number {
  return Math.min(...segments(a).flatMap((s) => segments(b).map((t) => segmentDistance(s, t))));
}

function route(color: WireColor, from: Point, fromSide: TerminalSide, to: Point, toSide: TerminalSide): WireRoute {
  return routeWire(color, { position: from, side: fromSide }, { position: to, side: toSide }, from === to);
}

function pair(from: Point, fromSide: TerminalSide, to: Point, toSide: TerminalSide): [WireRoute, WireRoute] {
  return [route("red", from, fromSide, to, toSide), route("green", from, fromSide, to, toSide)];
}

function insideCards(wire: WireRoute, ...cards: Point[]): Point[] {
  return sampleRoute(wire, 40).filter((point) => cards.some((card) => strictlyInside(cardRect(card), point)));
}

/** Every position on the grid around A where a second card does not overlap the card at A. */
function placements(reach = 400): Point[] {
  const result: Point[] = [];
  for (let dx = -reach; dx <= reach; dx += GRID) {
    for (let dy = -reach; dy <= reach; dy += GRID) if (Math.abs(dx) >= CARD.width || Math.abs(dy) >= CARD.height) result.push({ x: A.x + dx, y: A.y + dy });
  }
  return result;
}

describe("every wire", () => {
  // All four combinations of sides for every placement, plus the feedback loop of A itself.
  const cases = [...placements().flatMap((target) => SIDES.flatMap((a) => SIDES.map((b) => ({ target, a, b })))), { target: A, a: "out" as const, b: "in" as const }];

  it("consists of horizontal and vertical segments that turn at every corner", () => {
    for (const { target, a, b } of cases) {
      for (const color of COLORS) {
        const wire = route(color, A, a, target, b);
        const horizontal = segments(wire).map(([from, to]) => {
          expect(from.x === to.x).not.toBe(from.y === to.y);
          return from.y === to.y;
        });
        horizontal.slice(1).forEach((value, index) => expect(value).not.toBe(horizontal[index]));
        // A wire leaves and enters its pins horizontally.
        expect([horizontal[0], horizontal.at(-1)]).toEqual([true, true]);
      }
    }
  });

  it("starts and ends in the pins of its color", () => {
    for (const { target, a, b } of cases) {
      for (const color of COLORS) {
        const wire = route(color, A, a, target, b);
        expect([[wire[0], wire.at(-1)], [wire.at(-1), wire[0]]]).toContainEqual([pinPoint(A, a, color), pinPoint(target, b, color)]);
        // It leaves and enters each pin on the outward side of the card; between an output and an input it starts at the output.
        expect(Math.sign(wire[1]!.x - wire[0]!.x)).toBe(a === "in" && b === "in" ? -1 : 1);
        expect(Math.sign(wire.at(-2)!.x - wire.at(-1)!.x)).toBe(a === "out" && b === "out" ? 1 : -1);
      }
    }
  });

  it("is the same route whichever end it was started from", () => {
    for (const { target, a, b } of cases) {
      for (const color of COLORS) {
        const sameEntity = target === A;
        expect(routeWire(color, { position: target, side: b }, { position: A, side: a }, sameEntity)).toEqual(routeWire(color, { position: A, side: a }, { position: target, side: b }, sameEntity));
      }
    }
  });

  it("has corner radii that fit the adjacent segments, so the rounded line has no kinks and never overshoots", () => {
    for (const { target, a, b } of cases) {
      for (const color of COLORS) {
        const wire = route(color, A, a, target, b);
        const radii = cornerRadii(wire);
        expect(radii).toHaveLength(wire.length - 2);
        for (const radius of radii) {
          expect(radius).toBeGreaterThan(0);
          expect(radius).toBeLessThanOrEqual(CORNER_RADIUS);
        }
        // The two rounded corners at the ends of a segment do not overlap.
        segments(wire).forEach((segment, index) => expect((radii[index - 1] ?? 0) + (radii[index] ?? 0)).toBeLessThanOrEqual(length(segment)));
      }
    }
  });

  it("rounds evenly wherever the cards are not crammed together", () => {
    for (const target of placements().filter((target) => Math.abs(target.x - A.x) >= 240)) {
      // A line 10 units beside a card and a leg of one grid step between two corners leave room for a radius of 10, everything else for the full one.
      for (const a of SIDES) for (const b of SIDES) expect(Math.min(...pair(A, a, target, b).flatMap(cornerRadii), CORNER_RADIUS)).toBeGreaterThanOrEqual(10);
      if (target.x > A.x && Math.abs(target.y - A.y) >= 2 * GRID) expect(pair(A, "out", target, "in").map(cornerRadii)).toEqual([[CORNER_RADIUS, CORNER_RADIUS], [CORNER_RADIUS, CORNER_RADIUS]]);
    }
  });

  it("stays off its own two cards", () => {
    for (const { target, a, b } of cases) {
      for (const color of COLORS) expect(insideCards(route(color, A, a, target, b), A, target)).toEqual([]);
    }
  });

  it("keeps red and green between an output and an input apart: a pin spacing, less only in a gap too narrow for two legs", () => {
    // Cards one grid step apart leave 16 units for two legs: 10 apart, which still shows a gap between the casings.
    const narrow = 10;
    expect(narrow).toBeGreaterThan(CASING_WIDTH);
    for (const target of placements()) expect(routeDistance(...pair(A, "out", target, "in"))).toBe(target.x - A.x === 200 && target.y !== A.y ? narrow : PIN_SPACING);
    expect(routeDistance(...pair(A, "out", A, "in"))).toBe(PIN_SPACING);
  });

  it("crosses red and green between two terminals of the same side exactly once, at a right angle and away from every corner", () => {
    for (const target of placements()) {
      for (const side of SIDES) {
        const [red, green] = pair(A, side, target, side);
        const close = segments(red).flatMap((s) => segments(green).filter((t) => segmentDistance(s, t) < 10).map((t) => [s, t] as const));
        expect(close).toHaveLength(1);
        const [[s, t]] = close as [(typeof close)[number]];
        const [horizontal, vertical] = s[0].y === s[1].y ? [s, t] : [t, s];
        expect(horizontal[0].y).toBe(horizontal[1].y);
        expect(vertical[0].x).toBe(vertical[1].x);
        const crossing = { x: vertical[0].x, y: horizontal[0].y };
        for (const end of [...horizontal, ...vertical]) expect(Math.hypot(end.x - crossing.x, end.y - crossing.y)).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("stays well-formed for cards off the grid, touching or on top of each other", () => {
    let seed = 7;
    const random = (range: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % (2 * range + 1)) - range;
    const scattered = Array.from({ length: 400 }, () => ({ x: A.x + random(420), y: A.y + random(300) }));
    const targets = [A, { x: A.x + CARD.width, y: A.y }, { x: A.x, y: A.y + CARD.height }, { x: A.x + 190, y: A.y + 7 }, ...scattered];
    for (const target of targets) {
      for (const a of SIDES) for (const b of SIDES) for (const color of COLORS) {
        const wire = routeWire(color, { position: A, side: a }, { position: target, side: b }, false);
        expect([[wire[0], wire.at(-1)], [wire.at(-1), wire[0]]]).toContainEqual([pinPoint(A, a, color), pinPoint(target, b, color)]);
        for (const [from, to] of segments(wire)) expect(from.x === to.x).not.toBe(from.y === to.y);
        const radii = cornerRadii(wire);
        segments(wire).forEach((segment, index) => expect((radii[index - 1] ?? 0) + (radii[index] ?? 0)).toBeLessThanOrEqual(length(segment) + 1e-9));
        expect(routePath(wire)).toMatch(/^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+)*( L [-\d.]+ [-\d.]+)?$/);
      }
    }
  });

  it("produces rounded path data and bounds that contain it", () => {
    const wire = route("red", A, "out", { x: 300, y: 260 }, "in");
    expect(routePath(wire)).toBe("M 224 140 L 258 140 Q 272 140 272 154 L 272 306 Q 272 320 286 320 L 300 320");
    expect(routePath(route("green", A, "out", B, "in"))).toBe("M 224 160 L 300 160");
    for (const { target, a, b } of cases) {
      const candidate = route("green", A, a, target, b);
      const path = routePath(candidate);
      expect(path).toMatch(/^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+)* L [-\d.]+ [-\d.]+$/);
      const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
      const bounds = routeBounds(candidate);
      for (let i = 0; i < numbers.length; i += 2) {
        expect(numbers[i]!).toBeGreaterThanOrEqual(bounds.x);
        expect(numbers[i]!).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(numbers[i + 1]!).toBeGreaterThanOrEqual(bounds.y);
        expect(numbers[i + 1]!).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
    }
  });
});

describe("wires from an output to an input on its right", () => {
  it("is a straight line between level pins", () => {
    for (const color of COLORS) expect(route(color, A, "out", B, "in")).toEqual([pinPoint(A, "out", color), pinPoint(B, "in", color)]);
  });

  it("has one vertical leg midway between the two cards, the colors as exact parallels around it", () => {
    const middle = (A.x + CARD.width + B.x) / 2;
    const [down, up] = [{ x: B.x, y: 260 }, { x: B.x, y: -100 }];
    // The color on the outside of the first bend takes the far leg.
    expect(pair(A, "out", down, "in").map((wire) => [wire.length, wire[1]!.x, wire[2]!.x])).toEqual([[4, middle + 10, middle + 10], [4, middle - 10, middle - 10]]);
    expect(pair(A, "out", up, "in").map((wire) => [wire.length, wire[1]!.x, wire[2]!.x])).toEqual([[4, middle - 10, middle - 10], [4, middle + 10, middle + 10]]);
    const centerLine = [{ x: A.x + CARD.width, y: A.y + 70 }, { x: middle, y: A.y + 70 }, { x: middle, y: down.y + 70 }, { x: down.x, y: down.y + 70 }];
    expect(pair(A, "out", down, "in")).toEqual([offsetPolyline(centerLine, -PIN_SPACING / 2), offsetPolyline(centerLine, PIN_SPACING / 2)]);
  });

  it("moves the legs together and shrinks the corners when the cards are one or two grid steps apart", () => {
    const side = A.x + CARD.width;
    // Two grid steps, a 36 unit gap: still a pin spacing apart, 8 units from the cards.
    const two = pair(A, "out", { x: A.x + 220, y: 260 }, "in");
    expect(two.map((wire) => wire[1]!.x - side)).toEqual([28, 8]);
    expect(two.map(cornerRadii)).toEqual([[CORNER_RADIUS, 8], [8, CORNER_RADIUS]]);
    // One grid step, a 16 unit gap: 10 apart and 3 from the cards.
    const one = pair(A, "out", { x: A.x + 200, y: -100 }, "in");
    expect(one.map((wire) => wire[1]!.x - side)).toEqual([3, 13]);
    expect(one.map(cornerRadii)).toEqual([[3, 13], [13, 3]]);
    // A single grid step of height difference: two corners share a 20 unit leg.
    expect(cornerRadii(route("red", A, "out", { x: B.x, y: A.y + GRID }, "in"))).toEqual([10, 10]);
  });
});

describe("wires that double back", () => {
  // The input of `target` is not to the right of the output of A, so the wire cannot run forward.
  const cases = [
    { name: "target below with a gap", target: { x: 40, y: 300 } },
    { name: "target above and to the left", target: { x: -300, y: -260 } },
    { name: "target level and to the left (no gap between the cards)", target: { x: -260, y: 100 } },
    { name: "target just below and to the right (no gap between the cards)", target: { x: 140, y: 220 } },
    { name: "target just above and to the left (no gap between the cards)", target: { x: -60, y: -60 } },
  ];

  for (const { name, target } of cases) {
    it(`routes around both cards with parallel colors: ${name}`, () => {
      const [red, green] = pair(A, "out", target, "in");
      expect([red.length, green.length]).toEqual([6, 6]);
      expect([red[0], red.at(-1)]).toEqual([pinPoint(A, "out", "red"), pinPoint(target, "in", "red")]);
      expect([green[0], green.at(-1)]).toEqual([pinPoint(A, "out", "green"), pinPoint(target, "in", "green")]);
      // Exactly parallel: the colors are one pin spacing apart everywhere and never cross.
      expect(routeDistance(red, green)).toBe(PIN_SPACING);
      for (const wire of [red, green]) expect(insideCards(wire, A, target)).toEqual([]);
    });
  }

  it("crosses between the cards when there is room and below both otherwise", () => {
    const between = route("red", A, "out", { x: 40, y: 300 }, "in");
    expect(between[2]!.y).toBeGreaterThan(A.y + CARD.height);
    expect(between[2]!.y).toBeLessThan(300);
    const below = route("red", A, "out", { x: -260, y: 100 }, "in");
    expect(below[2]!.y).toBeGreaterThan(100 + CARD.height);
  });

  it("offsets a polyline to the right of its direction of travel", () => {
    const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(offsetPolyline(path, 2)).toEqual([{ x: 0, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 0, y: 8 }]);
    expect(offsetPolyline(path, -2)).toEqual([{ x: 0, y: -2 }, { x: 12, y: -2 }, { x: 12, y: 12 }, { x: 0, y: 12 }]);
  });
});

describe("feedback wires on one entity", () => {
  const card = cardRect(B);
  const red = routeWire("red", { position: B, side: "out" }, { position: B, side: "in" }, true);
  const green = routeWire("green", { position: B, side: "in" }, { position: B, side: "out" }, true);

  it("never crosses the inside of its own card", () => {
    for (const wire of [red, green]) expect(insideCards(wire, B)).toEqual([]);
  });

  it("starts at the output pin and ends at the input pin, whichever end the gesture started from", () => {
    for (const [wire, color] of [[red, "red"], [green, "green"]] as const) expect([wire[0], wire.at(-1)]).toEqual([pinPoint(B, "out", color), pinPoint(B, "in", color)]);
  });

  it("passes above the card with a separate clearance per color", () => {
    const redBounds = routeBounds(red);
    const greenBounds = routeBounds(green);
    expect(redBounds.y).toBe(card.y - FEEDBACK_CLEARANCE.red);
    expect(greenBounds.y).toBe(card.y - FEEDBACK_CLEARANCE.green);
    expect(redBounds.x).toBe(card.x - FEEDBACK_CLEARANCE.red);
    expect(greenBounds.x + greenBounds.width).toBe(card.x + card.width + FEEDBACK_CLEARANCE.green);
    expect(FEEDBACK_CLEARANCE.green - FEEDBACK_CLEARANCE.red).toBe(PIN_SPACING);
  });

  it("nests the two loops of one card a pin spacing apart, all corners with the same radius", () => {
    expect(routeDistance(red, green)).toBe(PIN_SPACING);
    expect([red, green].map(cornerRadii)).toEqual([Array(4).fill(CORNER_RADIUS), Array(4).fill(CORNER_RADIUS)]);
    expect(routePath(red).match(/Q /g)).toHaveLength(4);
  });

  it("runs loops and other wires beside one card on separate lines", () => {
    // Distance of each vertical run from the output side of the card.
    const runs = (wires: WireRoute[]) => wires.map((wire) => wire[1]!.x - (card.x + card.width)).sort((a, b) => a - b);
    for (const target of [{ x: B.x, y: B.y - 300 }, { x: B.x, y: B.y + 300 }]) {
      expect(runs([red, green, ...pair(B, "out", target, "in")])).toEqual([10, 20, 30, 40]);
      expect(runs([red, green, ...pair(B, "out", target, "out")])).toEqual([10, 20, 30, 40]);
    }
  });
});

describe("wires between two terminals of the same side", () => {
  const below = { x: A.x, y: 300 };

  it("leaves on that side, runs beside the terminal further out and comes back, red on the outer line", () => {
    for (const [side, edge, outward] of [["out", A.x + CARD.width, 1], ["in", A.x, -1]] as const) {
      for (const target of [below, { x: A.x - outward * 100, y: 300 }, { x: A.x - outward * 400, y: -200 }]) {
        const [red, green] = pair(A, side, target, side);
        expect([red, green].map((wire) => [wire.length, (wire[1]!.x - edge) * outward, (wire[2]!.x - edge) * outward])).toEqual([[4, 30, 30], [4, 10, 10]]);
      }
    }
  });

  it("passes below a card that is in the way, or above it when the other terminal is higher", () => {
    const bottom = B.y + CARD.height;
    // Level cards side by side: out of A, down between the cards, below B, up beyond its output and back in.
    const level = pair(A, "out", B, "out");
    expect(level.map((wire) => wire.map((point) => point.y))).toEqual([[140, 140, bottom + 10, bottom + 10, 140, 140], [160, 160, bottom + 30, bottom + 30, 160, 160]]);
    expect(level.map((wire) => [wire[1]!.x - (A.x + CARD.width), wire[4]!.x - (B.x + CARD.width)])).toEqual([[30, 30], [10, 10]]);
    // A is 60 higher than B: over the top of B, green outside.
    const higher = pair({ x: A.x, y: B.y - 60 }, "out", B, "out");
    expect(higher.map((wire) => [wire.length, wire[2]!.y, wire[4]!.x - (B.x + CARD.width)])).toEqual([[6, B.y - 30, 10], [6, B.y - 10, 30]]);
    // Inputs mirror this: the card in the way is the one on the left.
    const inputs = pair(B, "in", A, "in");
    expect(inputs.map((wire) => [wire[0], wire.at(-1)])).toEqual(COLORS.map((color) => [pinPoint(B, "in", color), pinPoint(A, "in", color)]));
    expect(inputs.map((wire) => [B.x - wire[1]!.x, wire[2]!.y - (A.y + CARD.height), A.x - wire[4]!.x])).toEqual([[30, 10, 30], [10, 30, 10]]);
  });

  it("squeezes the legs between two cards one grid step apart", () => {
    const near = { x: A.x + 200, y: A.y };
    expect(pair(A, "out", near, "out").map((wire) => wire[1]!.x - (A.x + CARD.width))).toEqual([13, 3]);
    expect(routeDistance(route("red", A, "out", near, "out").slice(0, 3), route("green", A, "out", near, "out").slice(0, 3))).toBe(10);
  });
});
