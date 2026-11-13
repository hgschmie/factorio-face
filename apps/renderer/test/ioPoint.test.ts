// The one connection point of an entity that has no input and no output (`io`: a pole). On a card it is drawn on the left
// and on the right edge as one and the same point, and a wire attaches where it is nearer to its other end.
import { analyze } from "@face/language";
import { TERMINALS, WIRE_COLORS, type Entity, type Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { CARD, pinEdge, pinEdges, pinPlaces, pinPoint, type PinPlace } from "../src/canvas/geometry.ts";
import { editLayout } from "../src/canvas/layout.ts";
import { routeWire, wirePlaces, type WireEnd, type WireRoute } from "../src/canvas/wireRouting.ts";

const at = (x: number, y: number): Point => ({ x, y });
const end = (position: Point, side: WireEnd["side"]): WireEnd => ({ position, side, facing: "east" });
const length = (route: WireRoute): number => route.reduce((sum, point, index) => (index === 0 ? 0 : sum + Math.abs(point.x - route[index - 1]!.x) + Math.abs(point.y - route[index - 1]!.y)), 0);

describe("where a connection point is drawn", () => {
  it("has one place for an input and for an output and both for a point without a direction", () => {
    expect(pinPlaces("in")).toEqual(["in"]);
    expect(pinPlaces("out")).toEqual(["out"]);
    expect(pinPlaces("io")).toEqual(["in", "out"]);
  });

  it("puts the point of a pole on the left and on the right edge, an input and an output where they were", () => {
    expect(pinEdges(TERMINALS.pole)).toEqual(["left", "right"]);
    expect(pinEdges(TERMINALS.lamp)).toEqual(["left"]);
    expect(pinEdges(TERMINALS.speaker)).toEqual(["left"]);
    expect(pinEdges(TERMINALS.constant)).toEqual(["right"]);
    expect(pinEdges(TERMINALS.decider)).toEqual(["left", "right"]);
    expect(pinEdges(TERMINALS.decider, "south")).toEqual(["top", "bottom"]);
    // The two places are level: red above green on both edges, as for an input and an output.
    for (const color of WIRE_COLORS) expect(pinPoint(at(0, 0), "in", color).y).toBe(pinPoint(at(0, 0), "out", color).y);
    expect(pinEdge("in")).toBe("left");
    expect(pinEdge("out")).toBe("right");
  });
});

describe("where a wire attaches", () => {
  const A = at(0, 0);
  const places = (a: WireEnd, b: WireEnd): readonly [PinPlace, PinPlace] => wirePlaces(a, b, false);

  it("leaves an input and an output where they are", () => {
    expect(places(end(A, "out"), end(at(300, 0), "in"))).toEqual(["out", "in"]);
    expect(places(end(A, "in"), end(at(-300, 200), "in"))).toEqual(["in", "in"]);
  });

  it("takes the edge of a pole that faces the other end", () => {
    // From an output on its left, to an input on its right.
    expect(places(end(A, "out"), end(at(300, 0), "io"))).toEqual(["out", "in"]);
    expect(places(end(A, "io"), end(at(300, 0), "in"))).toEqual(["out", "in"]);
    // The other way round the nearer edges are the outer ones: both ends on the right of the left card would loop around.
    expect(places(end(at(300, 0), "out"), end(A, "io"))).toEqual(["out", "out"]);
    expect(places(end(at(300, 0), "io"), end(A, "in"))).toEqual(["in", "in"]);
    // Up and down make no difference to the edge while the cards are side by side.
    for (const y of [-400, -140, 140, 400]) expect(places(end(A, "out"), end(at(300, y), "io")), String(y)).toEqual(["out", "in"]);
  });

  it("wires two poles from the right edge of the left one to the left edge of the right one", () => {
    for (const y of [-300, 0, 60, 300]) {
      expect(places(end(A, "io"), end(at(260, y), "io")), String(y)).toEqual(["out", "in"]);
      expect(places(end(at(260, y), "io"), end(A, "io")), String(y)).toEqual(["in", "out"]);
    }
  });

  it("wires a point straight above or below another on the side they share", () => {
    // An output above a pole, a pole above an input: no detour around a card.
    expect(places(end(A, "out"), end(at(0, 200), "io"))).toEqual(["out", "out"]);
    expect(places(end(A, "io"), end(at(0, 200), "in"))).toEqual(["in", "in"]);
    // Two poles in a column: either side is as near, the left one is taken, whichever end is named first.
    expect(places(end(A, "io"), end(at(0, 200), "io"))).toEqual(["in", "in"]);
    expect(places(end(at(0, 200), "io"), end(A, "io"))).toEqual(["in", "in"]);
  });

  it("gives red and green the same edges and does not depend on the order of the ends", () => {
    let seed = 7;
    const random = (range: number): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % (2 * range + 1)) - range;
    for (let index = 0; index < 300; index++) {
      const target = at(20 * random(25), 20 * random(20));
      for (const [sideA, sideB] of [["io", "io"], ["out", "io"], ["io", "in"]] as const) {
        const [a, b] = [end(A, sideA), end(target, sideB)];
        const [placeA, placeB] = places(a, b);
        if (target.x !== 0 || target.y !== 0) expect(places(b, a), `${sideA} ${sideB} ${target.x},${target.y}`).toEqual([placeB, placeA]);
        for (const color of WIRE_COLORS) {
          const route = routeWire(color, a, b, false);
          const pins = [pinPoint(A, placeA, color), pinPoint(target, placeB, color)];
          expect([route[0], route.at(-1)], `${color} ${sideA} ${sideB} ${target.x},${target.y}`).toEqual(expect.arrayContaining(pins));
          // The same line whichever end is named first; which end it starts from is not part of the contract.
          expect([route, route.toReversed()]).toContainEqual(routeWire(color, b, a, false));
          for (let i = 1; i < route.length; i++) expect(route[i]!.x === route[i - 1]!.x || route[i]!.y === route[i - 1]!.y).toBe(true);
        }
      }
    }
  });

  it("is never longer than the wire to the other edge would be", () => {
    for (const target of [at(300, 0), at(-300, 0), at(0, 200), at(0, -200), at(100, 240), at(-100, 240), at(200, 140), at(-260, -160)]) {
      const [a, b] = [end(A, "out"), end(target, "io")];
      const chosen = length(routeWire("red", a, b, false));
      for (const place of pinPlaces("io")) expect(chosen, `${target.x},${target.y} ${place}`).toBeLessThanOrEqual(length(routeWire("red", a, end(target, place), false)));
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

  it("runs from left to right in straight lines, without a loop around a card", () => {
    for (const wire of circuit.wires) {
      const [a, b] = [byId.get(wire.a.entity)!, byId.get(wire.b.entity)!];
      const [left, right] = a.position.x < b.position.x ? [a, b] : [b, a];
      const y = pinPoint(left.position, "out", wire.color).y;
      // One segment from the right edge of the left card to the left edge of the right one.
      expect(layout.route(wire, a, b).path).toBe(`M ${left.position.x + CARD.width} ${y} L ${right.position.x} ${y}`);
    }
  });

  it("gives the pin of a pole that is nearer to a point, the left one without a point", () => {
    const pole = named("p1");
    const [left, right] = [pinPoint(pole.position, "in", "red"), pinPoint(pole.position, "out", "red")];
    expect(layout.pin(pole, "io", "red")).toEqual(left);
    expect(layout.pin(pole, "io", "red", at(0, 0))).toEqual(left);
    expect(layout.pin(pole, "io", "red", at(900, 400))).toEqual(right);
    expect(layout.pin(pole, "io", "red", at(pole.position.x + CARD.width / 2 + 1, 0))).toEqual(right);
    // An input has its one pin wherever the pointer is.
    expect(layout.pin(named("light"), "in", "green", at(2000, 0))).toEqual(pinPoint(named("light").position, "in", "green"));
  });
});
