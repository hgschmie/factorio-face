// The layout of a display mode: the edit layout is the card geometry and the wire routing as they were, the blueprint layout
// puts footprints on tiles and draws straight wires.
import { analyze } from "@face/language";
import { facingOf, TERMINALS, WIRE_COLORS, type Circuit, type Entity, type Wire } from "@face/model";
import { describe, expect, it } from "vitest";
import { TILE } from "../src/canvas/board.ts";
import { cardRect, entitiesBounds, GRID, pinPoint, rectsIntersect } from "../src/canvas/geometry.ts";
import { blueprintLayout, editLayout, layoutFor, SELF_WIRE_SAG } from "../src/canvas/layout.ts";
import { FEEDBACK_CLEARANCE, routeBounds, routePath, routeWire } from "../src/canvas/wireRouting.ts";
import { STARTER_SOURCE } from "../src/session/starter.ts";

function circuitOf(source: string): Circuit {
  const result = analyze(source);
  if (!result.circuit) throw new Error(JSON.stringify(result.diagnostics));
  return result.circuit;
}

const BOARD = `circuit "Board" {
    constant source at (40, 80) tile (0.5, 0.5) { virtual:signal-A = 1 }
    decider gate at (300, 80) tile (3, 0.5) { }
    arithmetic down at (300, 260) tile (5.5, 1) facing south { }
    lamp light at (560, 80) tile (7.5, 0.5) { }
    selector loose at (184, 276) { }
    wire red source.out <-> gate.in
    wire green gate.out <-> gate.in
    wire red gate.out <-> gate.in
    wire green down.out <-> light.in
}
`;

function named(circuit: Circuit, name: string): Entity {
  return circuit.entities.find((entity) => entity.name === name)!;
}

function ends(circuit: Circuit, wire: Wire): [Entity, Entity] {
  return [circuit.entities.find((entity) => entity.id === wire.a.entity)!, circuit.entities.find((entity) => entity.id === wire.b.entity)!];
}

describe("edit layout", () => {
  const circuit = circuitOf(STARTER_SOURCE.replace("gate at (300, 80)", "gate at (300, 80) facing south"));

  it("is the card geometry: rectangles, pins, bounds, the grid", () => {
    const layout = editLayout(circuit.entities);
    expect(layout).toMatchObject({ mode: "edit", step: GRID, fitMargin: FEEDBACK_CLEARANCE.green });
    for (const entity of circuit.entities) {
      expect(layout.rect(entity)).toEqual(cardRect(entity.position));
      for (const side of TERMINALS[entity.kind]) for (const color of WIRE_COLORS) expect(layout.pin(entity, side, color)).toEqual(pinPoint(entity.position, side, color, facingOf(entity)));
    }
    expect(layout.bounds()).toEqual(entitiesBounds(circuit.entities));
    expect(editLayout([]).bounds()).toBeUndefined();
  });

  it("routes wires as the canvas always did, the feedback wire included", () => {
    const layout = editLayout(circuit.entities);
    for (const wire of circuit.wires) {
      const [a, b] = ends(circuit, wire);
      const route = routeWire(wire.color, { position: a.position, side: wire.a.side, facing: facingOf(a) }, { position: b.position, side: wire.b.side, facing: facingOf(b) }, a.id === b.id);
      expect(layout.route(wire, a, b)).toEqual({ path: routePath(route), bounds: routeBounds(route) });
    }
  });

  it("takes the positions of a drag in progress for rectangles, pins and wires", () => {
    const gate = named(circuit, "gate");
    const moved = { x: 500, y: -60 };
    const layout = editLayout(circuit.entities, new Map([[gate.id, moved]]));
    expect(layout.rect(gate)).toEqual(cardRect(moved));
    expect(layout.pin(gate, "out", "red")).toEqual(pinPoint(moved, "out", "red", "south"));
    expect(layout.rect(named(circuit, "source"))).toEqual(cardRect({ x: 40, y: 80 }));
    const wire = circuit.wires[0]!;
    const [a, b] = ends(circuit, wire);
    expect(layout.route(wire, a, b)).not.toEqual(editLayout(circuit.entities).route(wire, a, b));
  });
});

describe("blueprint layout", () => {
  const circuit = circuitOf(BOARD);
  const layout = blueprintLayout(circuit.entities);

  it("gives every entity the rectangle of its tiles", () => {
    expect(layout).toMatchObject({ mode: "blueprint", step: TILE });
    expect(layout.rect(named(circuit, "source"))).toEqual({ x: 0, y: 0, width: TILE, height: TILE });
    expect(layout.rect(named(circuit, "gate"))).toEqual({ x: 2 * TILE, y: 0, width: 2 * TILE, height: TILE });
    expect(layout.rect(named(circuit, "down"))).toEqual({ x: 5 * TILE, y: 0, width: TILE, height: 2 * TILE });
    expect(layout.rect(named(circuit, "light"))).toEqual({ x: 7 * TILE, y: 0, width: TILE, height: TILE });
    // No tile in the source: (184, 276) scales to the tile (2, 3).
    expect(layout.rect(named(circuit, "loose"))).toEqual({ x: 2 * TILE, y: 3 * TILE, width: 2 * TILE, height: TILE });
    expect(layout.placement(named(circuit, "loose"))).toMatchObject({ placed: false, conflict: false });
    expect(layout.placement(named(circuit, "gate"))).toMatchObject({ origin: { x: 2, y: 0 }, placed: true, facing: "east" });
  });

  it("puts the pins inside the rectangle of their entity", () => {
    for (const entity of circuit.entities) {
      const rect = layout.rect(entity);
      for (const side of TERMINALS[entity.kind]) {
        for (const color of WIRE_COLORS) {
          const pin = layout.pin(entity, side, color);
          expect(pin.x > rect.x && pin.x < rect.x + rect.width && pin.y > rect.y && pin.y < rect.y + rect.height, `${entity.name} ${side} ${color}`).toBe(true);
        }
      }
    }
    expect(layout.pin(named(circuit, "gate"), "in", "red")).toEqual({ x: 2 * TILE + 12, y: 30 });
    expect(layout.pin(named(circuit, "down"), "out", "green")).toEqual({ x: 5 * TILE + 30, y: 2 * TILE - 12 });
  });

  it("draws a wire as the straight line between its two pins", () => {
    const wire = circuit.wires.find((candidate) => candidate.color === "green" && candidate.a.entity !== candidate.b.entity)!;
    const [a, b] = ends(circuit, wire);
    const from = layout.pin(a, wire.a.side, "green");
    const to = layout.pin(b, wire.b.side, "green");
    const route = layout.route(wire, a, b);
    expect(route.path).toBe(`M ${from.x} ${from.y} L ${to.x} ${to.y}`);
    expect(route.bounds).toEqual({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y) });
  });

  it("bends the wire from an output to the input of the same entity around it, each color on its own side", () => {
    const gate = named(circuit, "gate");
    const rect = layout.rect(gate);
    const feedback = circuit.wires.filter((wire) => wire.a.entity === gate.id && wire.b.entity === gate.id);
    expect(feedback.map((wire) => wire.color).sort()).toEqual(["green", "red"]);
    for (const wire of feedback) {
      const from = layout.pin(gate, wire.a.side, wire.color);
      const to = layout.pin(gate, wire.b.side, wire.color);
      const route = layout.route(wire, gate, gate);
      const control = /^M \S+ \S+ Q (\S+) (\S+) \S+ \S+$/.exec(route.path)!.slice(1).map(Number) as [number, number];
      // The arc reaches halfway to its control point: past the long edge of the entity on the side of its pins.
      const apex = (from.y + control[1]) / 2;
      expect(control[0]).toBe((from.x + to.x) / 2);
      expect(Math.abs(apex - from.y)).toBe(SELF_WIRE_SAG);
      if (wire.color === "red") expect(apex).toBeLessThan(rect.y);
      else expect(apex).toBeGreaterThan(rect.y + rect.height);
      expect(rectsIntersect(route.bounds, { x: from.x, y: apex, width: 0, height: 0 })).toBe(true);
    }
  });

  it("bounds all footprints, derived ones included, and nothing for an empty circuit", () => {
    expect(layout.bounds()).toEqual({ x: 0, y: 0, width: 8 * TILE, height: 4 * TILE });
    expect(blueprintLayout([]).bounds()).toBeUndefined();
  });

  it("shows an entity that is being dragged on the tile nearest to its preview position", () => {
    const gate = named(circuit, "gate");
    const dragged = blueprintLayout(circuit.entities, new Map([[gate.id, { x: 3 * TILE + 30, y: -TILE - 10 }]]));
    expect(dragged.rect(gate)).toEqual({ x: 3 * TILE, y: -TILE, width: 2 * TILE, height: TILE });
    expect(dragged.rect(named(circuit, "source"))).toEqual(layout.rect(named(circuit, "source")));
  });

  it("is what layoutFor gives for the mode", () => {
    expect(layoutFor("blueprint", circuit.entities).rect(named(circuit, "gate"))).toEqual(layout.rect(named(circuit, "gate")));
    expect(layoutFor("edit", circuit.entities).rect(named(circuit, "gate"))).toEqual(cardRect({ x: 300, y: 80 }));
    expect(layoutFor("edit", circuit.entities).detailZoom).toBeLessThan(layoutFor("blueprint", circuit.entities).detailZoom);
  });
});
