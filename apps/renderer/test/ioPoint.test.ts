// The one connection point of an entity that has no input and no output (`io`: a pole). On a card it is one pair of pins in
// the middle of the top edge, red left of green, and its wires arrive from above.
import { analyze } from "@face/language";
import { DIRECTIONS, TERMINALS, WIRE_COLORS, type Entity, type Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { CARD, cardRect, PIN_SPACING, pinEdge, pinEdges, pinHeading, pinPoint } from "../src/canvas/geometry.ts";
import { editLayout } from "../src/canvas/layout.ts";
import { routeWire, type WireEnd, type WireRoute } from "../src/canvas/wireRouting.ts";

const at = (x: number, y: number): Point => ({ x, y });
const end = (position: Point, side: WireEnd["side"]): WireEnd => ({ position, side, facing: "east" });
const segments = (route: WireRoute): [Point, Point][] => route.slice(1).map((point, index) => [route[index]!, point]);

/** True when a segment of the route passes through the inside of one of the cards. */
function crossesCard(route: WireRoute, ...cards: Point[]): boolean {
  return segments(route).some(([from, to]) =>
    cards.map(cardRect).some((rect) => Math.max(from.x, to.x) > rect.x && Math.min(from.x, to.x) < rect.x + rect.width && Math.max(from.y, to.y) > rect.y && Math.min(from.y, to.y) < rect.y + rect.height),
  );
}

/** How often two axis-aligned routes cross at a right angle. */
function crossings(a: WireRoute, b: WireRoute): number {
  const within = (value: number, p: number, q: number): boolean => value > Math.min(p, q) && value < Math.max(p, q);
  let count = 0;
  for (const [a1, a2] of segments(a)) {
    for (const [b1, b2] of segments(b)) {
      const [horizontal, vertical] = a1.y === a2.y ? [[a1, a2], [b1, b2]] : [[b1, b2], [a1, a2]];
      if (horizontal![0]!.y !== horizontal![1]!.y || vertical![0]!.x !== vertical![1]!.x) continue;
      if (within(vertical![0]!.x, horizontal![0]!.x, horizontal![1]!.x) && within(horizontal![0]!.y, vertical![0]!.y, vertical![1]!.y)) count++;
    }
  }
  return count;
}

describe("where a connection point is drawn", () => {
  it("is one pair of pins in the middle of the top edge, red left of green, whatever the entity faces", () => {
    for (const facing of DIRECTIONS) {
      expect(pinPoint(at(40, 80), "io", "red", facing)).toEqual(at(40 + CARD.pinX.red, 80));
      expect(pinPoint(at(40, 80), "io", "green", facing)).toEqual(at(40 + CARD.pinX.green, 80));
      expect(pinEdge("io", facing)).toBe("top");
      expect(pinHeading("io", facing)).toBe("north");
    }
    // Side by side on the two grid lines around the middle of the card, one pin spacing apart: where an entity facing north has its output.
    expect([CARD.pinX.red, CARD.pinX.green]).toEqual([80, 100]);
    expect(CARD.pinX.green - CARD.pinX.red).toBe(PIN_SPACING);
    for (const color of WIRE_COLORS) expect(pinPoint(at(0, 0), "io", color)).toEqual(pinPoint(at(0, 0), "out", color, "north"));
  });

  it("gives a pole the top edge only and leaves an input and an output where they were", () => {
    expect(pinEdges(TERMINALS.pole)).toEqual(["top"]);
    expect(pinEdges(TERMINALS.lamp)).toEqual(["left"]);
    expect(pinEdges(TERMINALS.speaker)).toEqual(["left"]);
    expect(pinEdges(TERMINALS.constant)).toEqual(["right"]);
    expect(pinEdges(TERMINALS.decider)).toEqual(["left", "right"]);
    expect(pinEdges(TERMINALS.decider, "south")).toEqual(["top", "bottom"]);
  });
});

describe("a wire to a connection point", () => {
  const A = at(0, 0);

  it("arrives from above: the last segment is vertical and ends in the pin on the top edge", () => {
    for (const target of [at(300, 0), at(-300, 0), at(0, 200), at(0, -200), at(100, 240), at(-100, 240), at(200, 140), at(-260, -160)]) {
      for (const side of ["out", "in", "io"] as const) {
        for (const color of WIRE_COLORS) {
          const route = routeWire(color, end(A, side), end(target, "io"), false);
          const pin = pinPoint(target, "io", color);
          const atPole = route[0]!.x === pin.x && route[0]!.y === pin.y ? route : route.toReversed();
          expect(atPole[0], `${side} ${color} ${target.x},${target.y}`).toEqual(pin);
          expect(atPole[1]!.x, `${side} ${color} ${target.x},${target.y}`).toBe(pin.x);
          expect(atPole[1]!.y, `${side} ${color} ${target.x},${target.y}`).toBeLessThan(pin.y);
        }
      }
    }
  });

  it("is routed as the output of an entity facing north is", () => {
    for (const target of [at(300, 0), at(0, 200), at(-260, -160), at(200, 140)]) {
      for (const color of WIRE_COLORS) {
        expect(routeWire(color, end(A, "out"), end(target, "io"), false)).toEqual(routeWire(color, end(A, "out"), { position: target, side: "out", facing: "north" }, false));
        expect(routeWire(color, end(A, "io"), end(target, "io"), false)).toEqual(routeWire(color, { position: A, side: "out", facing: "north" }, { position: target, side: "out", facing: "north" }, false));
      }
    }
  });

  it("is an axis-aligned line through no card that does not depend on the order of the ends", () => {
    let seed = 7;
    const random = (range: number): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % (2 * range + 1)) - range;
    for (let index = 0; index < 300; index++) {
      const target = at(20 * random(25), 20 * random(20));
      // Cards that overlap or leave less than a grid step between them have no room for a line around them.
      const apart = Math.abs(target.x) >= CARD.width + 20 || Math.abs(target.y) >= CARD.height + 20;
      for (const [sideA, sideB] of [["io", "io"], ["out", "io"], ["io", "in"]] as const) {
        const [a, b] = [end(A, sideA), end(target, sideB)];
        for (const color of WIRE_COLORS) {
          const route = routeWire(color, a, b, false);
          const label = `${color} ${sideA} ${sideB} ${target.x},${target.y}`;
          expect([route[0], route.at(-1)], label).toEqual(expect.arrayContaining([pinPoint(A, sideA, color), pinPoint(target, sideB, color)]));
          // The same line whichever end is named first; which end it starts from is not part of the contract.
          expect([route, route.toReversed()], label).toContainEqual(routeWire(color, b, a, false));
          for (const [from, to] of segments(route)) expect(from.x === to.x || from.y === to.y, label).toBe(true);
          if (apart) expect(crossesCard(route, A, target), label).toBe(false);
        }
      }
    }
  });
});

describe("a chain through poles on the edit canvas", () => {
  const circuit = analyze(`circuit "Chain" {
    constant source at (40, 80) { virtual:signal-A = 1 }
    pole p1 at (300, 80) { }
    pole p2 at (560, 80) { prototype = big-electric-pole }
    lamp light at (820, 80) { when virtual:signal-A > 0 }
    wire red source.out <-> p1
    wire red p1 <-> p2
    wire red p2 <-> light.in
    wire green p1 <-> p2
}`).circuit!;
  const layout = editLayout(circuit.entities);
  const byId = new Map(circuit.entities.map((entity) => [entity.id, entity]));
  const named = (name: string): Entity => circuit.entities.find((entity) => entity.name === name)!;
  const pathOf = (color: "red" | "green", a: string, b: string): string => {
    const wire = circuit.wires.find((candidate) => candidate.color === color && byId.get(candidate.a.entity)!.name === a && byId.get(candidate.b.entity)!.name === b)!;
    return layout.route(wire, named(a), named(b)).path;
  };
  const corners = (path: string): number => path.split(" Q ").length - 1;

  it("has one pin of a color on a pole, where the pending wire starts too", () => {
    expect(layout.pin(named("p1"), "io", "red")).toEqual(at(380, 80));
    expect(layout.pin(named("p1"), "io", "green")).toEqual(at(400, 80));
    expect(layout.pin(named("light"), "in", "green")).toEqual(pinPoint(named("light").position, "in", "green"));
  });

  it("runs above the cards from pole to pole and comes down into each point", () => {
    // Red is the outer line, 30 units above the cards, green the inner one, 10 above.
    expect(pathOf("red", "p1", "p2")).toBe("M 380 80 L 380 64 Q 380 50 394 50 L 626 50 Q 640 50 640 64 L 640 80");
    expect(pathOf("green", "p1", "p2")).toBe("M 400 80 L 400 80 Q 400 70 410 70 L 650 70 Q 660 70 660 80 L 660 80");
    // From the output up between the cards and over to the pole; from the pole over and down in front of the input.
    expect(pathOf("red", "source", "p1")).toBe("M 224 140 L 238 140 Q 252 140 252 126 L 252 64 Q 252 50 266 50 L 366 50 Q 380 50 380 64 L 380 80");
    expect(pathOf("red", "p2", "light")).toBe("M 640 80 L 640 64 Q 640 50 654 50 L 796 50 Q 810 50 810 64 L 810 130 Q 810 140 820 140 L 820 140");
    // No loop: every line of the chain has the fewest corners its two edges allow.
    expect(circuit.wires.map((wire) => corners(layout.route(wire, byId.get(wire.a.entity)!, byId.get(wire.b.entity)!).path))).toEqual([3, 2, 3, 2]);
  });

  it("joins the lines of one color at a pole: they leave the pin on the same vertical", () => {
    const starts = [pathOf("red", "source", "p1"), pathOf("red", "p1", "p2")];
    expect(starts[0]!.endsWith("L 380 80")).toBe(true);
    expect(starts[1]!.startsWith("M 380 80 L 380 64")).toBe(true);
  });
});

describe("poles above and below each other", () => {
  const [upper, lower] = [at(300, 80), at(300, 280)];

  it("pass the upper card on one side and come down into its point, red outside green", () => {
    const [red, green] = WIRE_COLORS.map((color) => routeWire(color, end(upper, "io"), end(lower, "io"), false));
    expect(red).toEqual([at(380, 280), at(380, 250), at(494, 250), at(494, 50), at(380, 50), at(380, 80)]);
    expect(green).toEqual([at(400, 280), at(400, 270), at(514, 270), at(514, 70), at(400, 70), at(400, 80)]);
    for (const route of [red!, green!]) expect(crossesCard(route, upper, lower)).toBe(false);
    // Two points on the same edge: the colors cross once, at a right angle.
    expect(crossings(red!, green!)).toBe(1);
  });

  it("pass on the side the lower pole is shifted to", () => {
    const side = (shift: number): number => Math.sign(routeWire("red", end(upper, "io"), end(at(300 + shift, 280), "io"), false)[2]!.x - (300 + CARD.width / 2));
    expect([-60, 0, 60].map(side)).toEqual([-1, 1, 1]);
  });

  it("cross once between an output and a point and not at all between a point and an input", () => {
    for (const target of [at(300, 0), at(0, 200), at(-300, 60), at(200, -200)]) {
      const pair = (a: WireEnd, b: WireEnd): number => crossings(routeWire("red", a, b, false), routeWire("green", a, b, false));
      expect(pair(end(at(0, 0), "out"), end(target, "io")), `${target.x},${target.y}`).toBe(1);
      expect(pair(end(at(0, 0), "io"), end(target, "in")), `${target.x},${target.y}`).toBe(0);
    }
  });
});
