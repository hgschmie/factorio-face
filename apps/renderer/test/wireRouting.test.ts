import type { Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { CARD, cardRect, wireAnchor, type Rect } from "../src/canvas/geometry.ts";
import { FEEDBACK_CLEARANCE, offsetPolyline, routeBounds, routePath, routeWire, sampleRoute, type WireRoute } from "../src/canvas/wireRouting.ts";

const A: Point = { x: 40, y: 80 };
const B: Point = { x: 300, y: 80 };

function strictlyInside(rect: Rect, point: Point): boolean {
  return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
}

function polyline(route: WireRoute): readonly Point[] {
  if (route.kind !== "polyline") throw new Error("expected a polyline");
  return route.points;
}

function minimumDistance(a: readonly Point[], b: readonly Point[]): number {
  let minimum = Infinity;
  for (const p of a) for (const q of b) minimum = Math.min(minimum, Math.hypot(p.x - q.x, p.y - q.y));
  return minimum;
}

describe("wires between two entities", () => {
  it("attaches red above and green below the terminal center", () => {
    expect(wireAnchor(A, "out", "red")).toEqual({ x: A.x + CARD.width, y: A.y + CARD.terminalY - CARD.wireOffset });
    expect(wireAnchor(A, "out", "green")).toEqual({ x: A.x + CARD.width, y: A.y + CARD.terminalY + CARD.wireOffset });
    expect(wireAnchor(A, "in", "red").x).toBe(A.x);
  });

  it("keeps red and green apart along the whole route when both connect the same pair", () => {
    const red = routeWire("red", { position: A, side: "out" }, { position: B, side: "in" }, false);
    const green = routeWire("green", { position: A, side: "out" }, { position: B, side: "in" }, false);
    expect(routePath(red)).not.toBe(routePath(green));
    expect(minimumDistance(sampleRoute(red, 60), sampleRoute(green, 60))).toBeGreaterThanOrEqual(2 * CARD.wireOffset - 0.01);
  });

  it("keeps the colors apart on steep curves, where a plain vertical shift would make them coincide", () => {
    for (const target of [{ x: 300, y: 260 }, { x: 240, y: 400 }, { x: 200, y: 600 }, { x: 400, y: -500 }, { x: 600, y: 140 }]) {
      const red = sampleRoute(routeWire("red", { position: A, side: "out" }, { position: target, side: "in" }, false), 200);
      const green = sampleRoute(routeWire("green", { position: A, side: "out" }, { position: target, side: "in" }, false), 200);
      expect(minimumDistance(red, green)).toBeGreaterThan(4.5);
    }
  });

  it("leaves each terminal on its outward side", () => {
    const forward = routeWire("red", { position: A, side: "out" }, { position: B, side: "in" }, false);
    if (forward.kind !== "curve") throw new Error("expected a curve");
    expect(forward.control1.x).toBeGreaterThan(forward.start.x);
    expect(forward.control2.x).toBeLessThan(forward.end.x);
    expect(forward.control1.y).toBe(forward.start.y);

  });

  it("does not depend on which end the wire was started from", () => {
    for (const target of [B, { x: -300, y: 200 }]) {
      const forward = routeWire("red", { position: A, side: "out" }, { position: target, side: "in" }, false);
      const backward = routeWire("red", { position: target, side: "in" }, { position: A, side: "out" }, false);
      expect(backward).toEqual(forward);
    }
  });

  it("produces path data and bounds that contain the route", () => {
    const route = routeWire("red", { position: A, side: "out" }, { position: { x: 300, y: 260 }, side: "in" }, false);
    expect(routePath(route)).toMatch(/^M [-\d.]+ [-\d.]+ C [-\d.]+ [-\d.]+, [-\d.]+ [-\d.]+, [-\d.]+ [-\d.]+$/);
    const bounds = routeBounds(route);
    for (const point of sampleRoute(route)) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.x - 1e-9);
      expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(bounds.y - 1e-9);
      expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-9);
    }
  });
});

describe("wires that double back", () => {
  // The input of `target` is not to the right of the output of A, so the wire cannot be a simple left-to-right curve.
  const cases = [
    { name: "target below with a gap", target: { x: 40, y: 300 } },
    { name: "target above and to the left", target: { x: -300, y: -260 } },
    { name: "target level and to the left (no gap between the cards)", target: { x: -260, y: 100 } },
  ];

  for (const { name, target } of cases) {
    it(`routes around both cards with parallel colors: ${name}`, () => {
      const red = routeWire("red", { position: A, side: "out" }, { position: target, side: "in" }, false);
      const green = routeWire("green", { position: A, side: "out" }, { position: target, side: "in" }, false);
      expect(polyline(red)[0]).toEqual(wireAnchor(A, "out", "red"));
      expect(polyline(red).at(-1)).toEqual(wireAnchor(target, "in", "red"));
      expect(polyline(green)[0]).toEqual(wireAnchor(A, "out", "green"));
      expect(polyline(green).at(-1)).toEqual(wireAnchor(target, "in", "green"));
      // Exactly parallel: the colors are 10 units apart everywhere and never cross.
      expect(minimumDistance(sampleRoute(red, 40), sampleRoute(green, 40))).toBeCloseTo(2 * CARD.wireOffset, 6);
      for (const route of [red, green]) {
        const inside = sampleRoute(route, 40).filter((point) => strictlyInside(cardRect(A), point) || strictlyInside(cardRect(target), point));
        expect(inside).toEqual([]);
        // Only axis-aligned segments.
        const points = polyline(route);
        for (let i = 1; i < points.length; i++) expect(points[i]!.x === points[i - 1]!.x || points[i]!.y === points[i - 1]!.y).toBe(true);
      }
    });
  }

  it("crosses between the cards when there is room and below both otherwise", () => {
    const between = polyline(routeWire("red", { position: A, side: "out" }, { position: { x: 40, y: 300 }, side: "in" }, false));
    expect(between[2]!.y).toBeGreaterThan(A.y + CARD.height);
    expect(between[2]!.y).toBeLessThan(300);
    const below = polyline(routeWire("red", { position: A, side: "out" }, { position: { x: -260, y: 100 }, side: "in" }, false));
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
    for (const route of [red, green]) {
      expect(route.kind).toBe("polyline");
      expect(sampleRoute(route, 20).filter((point) => strictlyInside(card, point))).toEqual([]);
    }
  });

  it("starts at the output anchor and ends at the input anchor, whichever end the gesture started from", () => {
    for (const [route, color] of [[red, "red"], [green, "green"]] as const) {
      expect(polyline(route)[0]).toEqual(wireAnchor(B, "out", color));
      expect(polyline(route).at(-1)).toEqual(wireAnchor(B, "in", color));
    }
  });

  it("passes above the card with a separate clearance per color", () => {
    const redBounds = routeBounds(red);
    const greenBounds = routeBounds(green);
    expect(redBounds.y).toBe(card.y - FEEDBACK_CLEARANCE.red);
    expect(greenBounds.y).toBe(card.y - FEEDBACK_CLEARANCE.green);
    expect(redBounds.x).toBe(card.x - FEEDBACK_CLEARANCE.red);
    expect(greenBounds.x + greenBounds.width).toBe(card.x + card.width + FEEDBACK_CLEARANCE.green);
    expect(FEEDBACK_CLEARANCE.green - FEEDBACK_CLEARANCE.red).toBeGreaterThanOrEqual(10);
  });

  it("keeps the two loops of one card apart", () => {
    expect(minimumDistance(sampleRoute(red, 20), sampleRoute(green, 20))).toBeGreaterThanOrEqual(2 * CARD.wireOffset - 0.01);
  });

  it("draws rounded corners without leaving the loop's bounds", () => {
    const path = routePath(red);
    expect(path.startsWith("M ")).toBe(true);
    expect(path.match(/Q /g)).toHaveLength(4);
    const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const bounds = routeBounds(red);
    for (let i = 0; i < numbers.length; i += 2) {
      expect(numbers[i]!).toBeGreaterThanOrEqual(bounds.x);
      expect(numbers[i]!).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(numbers[i + 1]!).toBeGreaterThanOrEqual(bounds.y);
      expect(numbers[i + 1]!).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });

  it("routes two terminals of the same side as a curve that leaves and arrives on that side", () => {
    const inputs = routeWire("green", { position: A, side: "in" }, { position: { x: 40, y: 300 }, side: "in" }, false);
    if (inputs.kind !== "curve") throw new Error("expected a curve");
    expect(inputs.control1.x).toBeLessThan(inputs.start.x);
    expect(inputs.control2.x).toBeLessThan(inputs.end.x);
    const outputs = routeWire("red", { position: A, side: "out" }, { position: { x: 40, y: 300 }, side: "out" }, false);
    if (outputs.kind !== "curve") throw new Error("expected a curve");
    expect(outputs.control1.x).toBeGreaterThan(outputs.start.x);
    expect(outputs.control2.x).toBeGreaterThan(outputs.end.x);
  });
});
