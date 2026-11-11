// DEMO ONLY. The built-in circuits of the demo session: the example from docs/dsl.md extended with a selector, a
// feedback pair in both colors and one red/green pair between the same terminals, plus a generated grid for scale tests.
import { BOTH_NETWORKS, DEFAULT_ENTITY, normalizeWire, signal, type Circuit, type Entity, type Wire, type WireColor } from "@face/model";

const A = signal("virtual", "signal-A");
const B = signal("virtual", "signal-B");
const I = signal("virtual", "signal-I");

function wire(color: WireColor, from: string, to: string): Wire {
  const end = (text: string) => {
    const [entity = "", side] = text.split(".");
    return { entity, side: side === "in" ? ("in" as const) : ("out" as const) };
  };
  return normalizeWire({ color, a: end(from), b: end(to) });
}

export function createDemoCircuit(): Circuit {
  const entities: Entity[] = [
    { id: "e1", name: "source", position: { x: 40, y: 80 }, kind: "constant", enabled: true, sections: [{ active: true, multiplier: 1, filters: [{ signal: A, count: 1 }] }] },
    {
      id: "e2",
      name: "gate",
      position: { x: 300, y: 80 },
      kind: "decider",
      conditions: [{ join: "and", first: A, firstNetworks: BOTH_NETWORKS, comparator: "<", second: { type: "constant", value: 10 } }],
      outputs: [{ signal: A, copyCountFromInput: true, constant: 1, networks: BOTH_NETWORKS }],
      elseOutputs: [],
    },
    { id: "e3", name: "twice", position: { x: 300, y: 260 }, kind: "arithmetic", first: { type: "signal", signal: A, networks: { red: true, green: false } }, operation: "*", second: { type: "constant", value: 2 }, output: B },
    { id: "e4", name: "pick", position: { x: 560, y: 260 }, kind: "selector", mode: { operation: "select", max: false, index: { type: "signal", signal: I, networks: BOTH_NETWORKS }, indexComparator: "=" } },
    { id: "e5", name: "light", position: { x: 560, y: 80 }, ...DEFAULT_ENTITY.lamp, condition: { first: B, comparator: ">", second: { type: "constant", value: 8 } } },
  ];
  const wires = [
    wire("red", "e1.out", "e2.in"),
    wire("green", "e1.out", "e2.in"),
    wire("red", "e2.out", "e2.in"),
    wire("green", "e2.out", "e2.in"),
    wire("red", "e2.out", "e3.in"),
    wire("green", "e3.out", "e5.in"),
    wire("red", "e3.out", "e4.in"),
  ];
  return { name: "Feedback example", entities, wires };
}

/** A chain of `count` arithmetic combinators laid out in rows, each wired to the next. Used to measure canvas performance. */
export function createGridCircuit(count: number, columns = 40): Circuit {
  const entities: Entity[] = [];
  const wires: Wire[] = [];
  for (let i = 0; i < count; i++) {
    entities.push({ id: `g${i}`, name: `node${i}`, position: { x: (i % columns) * 240, y: Math.floor(i / columns) * 180 }, ...DEFAULT_ENTITY.arithmetic, output: A });
    if (i > 0) wires.push(wire(i % 2 === 0 ? "red" : "green", `g${i - 1}.out`, `g${i}.in`));
  }
  return { name: `Grid of ${count}`, entities, wires };
}
