import { wireKey, type Circuit, type Wire } from "@face/model";
import { describe, expect, it } from "vitest";
import { EXAMPLE_SOURCE } from "./fixtures/example.ts";
import { countLabel, entityNames, selectedItems, selectionStatus, wireEndsLabel } from "../src/workbench/selectionText.ts";
import { createSession } from "./session/helpers.ts";

const circuit: Circuit = createSession(EXAMPLE_SOURCE).session.state.circuit;
const [source, gate, twice, light] = circuit.entities.map((entity) => entity.id) as [string, string, string, string];
const wire = (color: Wire["color"], from: string, to: string): Wire => circuit.wires.find((candidate) => candidate.color === color && candidate.a.entity === from && candidate.b.entity === to)!;
const red = wire("red", source, gate);
const loop = wire("green", gate, gate);
const status = (ids: readonly string[], wires: readonly Wire[]): string => selectionStatus(circuit, selectedItems(circuit, ids, wires.map(wireKey)));

describe("selection text", () => {
  it("counts entities and wires", () => {
    expect(countLabel(0, 0)).toBe("");
    expect(countLabel(1, 0)).toBe("1 entity");
    expect(countLabel(3, 0)).toBe("3 entities");
    expect(countLabel(0, 1)).toBe("1 wire");
    expect(countLabel(0, 2)).toBe("2 wires");
    expect(countLabel(1, 2)).toBe("1 entity and 2 wires");
    expect(countLabel(2, 1)).toBe("2 entities and 1 wire");
  });

  it("names the ends of a wire as the source does", () => {
    const names = entityNames(circuit);
    expect(wireEndsLabel(red, names)).toBe("source.out <-> gate.in");
    expect([wireEndsLabel(loop, names), "gate.out <-> gate.in"]).toContain("gate.in <-> gate.out");
    expect(wireEndsLabel({ color: "red", a: { entity: "gone", side: "out" }, b: red.b }, names)).toBe("gone.out <-> gate.in");
  });

  it("picks the selected entities and wires in circuit order and leaves out what does not exist", () => {
    const items = selectedItems(circuit, [light, "nope", source], [wireKey(loop), "red|x.out|y.in", wireKey(red)]);
    expect(items.entities.map((entity) => entity.name)).toEqual(["source", "light"]);
    expect(items.wires).toEqual([red, loop]);
    expect(selectedItems(circuit, [], [])).toEqual({ entities: [], wires: [] });
  });

  it("describes the selection for the status bar", () => {
    expect(status([], [])).toBe("No selection");
    expect(status([gate], [])).toBe("gate");
    expect(status([source, gate, twice, light], [])).toBe("source, gate, twice, light");
    expect(status([], [red])).toBe("red wire source.out <-> gate.in");
    expect(status([], [red, loop])).toBe("2 wires selected");
    expect(status([gate], [red])).toBe("1 entity and 1 wire selected");
    expect(status([gate, light], [red, loop])).toBe("2 entities and 2 wires selected");
  });

  it("counts a selection of more than four entities", () => {
    const five = { ...circuit, entities: [...circuit.entities, { ...circuit.entities[3]!, id: "extra", name: "extra" }] };
    expect(selectionStatus(five, selectedItems(five, five.entities.map((entity) => entity.id), []))).toBe("5 entities selected");
  });
});
