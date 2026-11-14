// Blueprint strings that the game itself wrote and ships in its data (tests/fixtures/blueprints/shipped-2.1.24.json). They are
// the only real strings at hand until the game probe has recorded F-01: one small circuit, lamps, poles with copper wires.
import { existsSync, readFileSync } from "node:fs";
import { printCircuit } from "@face/language";
import { describe, expect, it } from "vitest";
import { decodeBlueprintString, exportBlueprint, importBlueprintString, inspectBlueprint } from "../src/index.ts";
import { INSTRUMENTS } from "./samples.ts";

interface Shipped {
  readonly id: string;
  readonly file: string;
  readonly version: string;
  readonly string: string;
}

// The strings are Wube's, so the file is not committed (it is git-ignored); without it these tests are skipped.
const FIXTURE = new URL("../../../tests/fixtures/blueprints/shipped-2.1.24.json", import.meta.url);
const present = existsSync(FIXTURE);
const fixture = (present ? JSON.parse(readFileSync(FIXTURE, "utf8")) : { strings: [] }) as { strings: readonly Shipped[] };
const shipped = (id: string): Shipped => fixture.strings.find((entry) => entry.id === id)!;

/** The blueprint as the game wrote it. */
function original(id: string): { entities: Record<string, unknown>[]; wires: number[][]; version: number } {
  const decoded = decodeBlueprintString(shipped(id).string);
  if (!decoded.ok) throw new Error(`${id}: ${decoded.message}`);
  return decoded.data.blueprint as { entities: Record<string, unknown>[]; wires: number[][]; version: number };
}

function importOf(id: string) {
  const result = importBlueprintString(shipped(id).string, { instruments: INSTRUMENTS });
  if (!result.ok) throw new Error(`${id}: ${result.message}`);
  return result;
}

describe.skipIf(!present)("blueprint strings shipped with the game (local only: the fixture is not committed)", () => {
  it("decodes every one of them and finds the version the game wrote", () => {
    for (const entry of fixture.strings) {
      const decoded = decodeBlueprintString(entry.string);
      expect(decoded.ok, entry.id).toBe(true);
      if (decoded.ok) expect(inspectBlueprint(decoded.data)).toMatchObject({ kind: "blueprint", version: entry.version });
    }
  });

  it("imports the circuit of the game's own example: a constant combinator on the input of a selector", () => {
    const { circuit, report } = importOf("circuit");
    expect(printCircuit(circuit)).toBe(`circuit "" {
    constant constant1 at (0, 0) tile (6.5, -22.5) facing north {
        item:bulk-inserter = 1
        item:spidertron = 1
        item:refined-hazard-concrete = 1
        item:programmable-speaker = 1
        item:repair-pack = 1
        item:electric-furnace = 1
        item:pumpjack = 1
        item:iron-gear-wheel = 1
        item:iron-ore = 1
        item:battery = 1
        item:raw-fish = 1
        recipe:empty-heavy-oil-barrel = 1
        item:piercing-rounds-magazine = 1
        item:night-vision-equipment = 1
        fluid:water = 1
        virtual:signal-check = 1
        entity:behemoth-biter = 1
        entity:character = 1
        item:green-wire = 1
        entity:entity-ghost = 1
    }

    selector selector1 at (0, 100) tile (6.5, -21) facing south {
        operation = random
        interval = 15
    }

    pole pole1 at (100, 100) tile (8, -21) {
        prototype = substation
    }

    entity display_panel1 at (280, 560) tile (9.5, -16.5) {
        prototype = display-panel
        blueprint-data = "{\\"control_behavior\\":{\\"parameters\\":[{\\"condition\\":{\\"first_signal\\":{\\"type\\":\\"virtual\\",\\"name\\":\\"signal-anything\\"},\\"constant\\":1,\\"comparator\\":\\"=\\"},\\"icon\\":{\\"type\\":\\"virtual\\",\\"name\\":\\"signal-anything\\"}}]},\\"icon\\":{\\"name\\":\\"repair-pack\\"}}"
    }

    wire red constant1.out <-> selector1.in
    wire red selector1.out <-> display_panel1
}
`);
    expect(report).toEqual({
      version: "1.2.10.23",
      entities: 4,
      // The display panel is a generic entity: its messages and its icon are kept for the blueprint, unread.
      dropped: [{ name: "electric-energy-interface", count: 1, reason: "unknown" }],
      wires: { imported: 2, copper: 0, toDropped: 0, invalid: 0 },
      settings: [{ prototype: "substation", field: "quality", kind: "ignored", message: "is something the editor does not have", count: 1, entities: ["pole1"] }],
      ignored: ["icons"],
      warnings: ["The blueprint is from a pre-release of Factorio 2.0 (1.2.10.23)"],
    });
  });

  it("exports that circuit with the filters, the positions and the wire as the game wrote them", () => {
    const result = exportBlueprint(importOf("circuit").circuit, { instruments: INSTRUMENTS });
    if (!result.ok) throw new Error("export failed");
    const [constant, selector, pole, panel] = result.data.blueprint.entities;
    // The constant combinator is byte for byte what the game wrote: section and filter shape, explicit quality and comparator.
    expect(constant).toEqual(original("circuit").entities[0]);
    expect(selector).toEqual({ entity_number: 2, name: "selector-combinator", position: { x: 6.5, y: -21 }, direction: 8, control_behavior: { operation: "random", random_update_interval: 15 } });
    expect(pole).toEqual({ entity_number: 3, name: "substation", position: { x: 8, y: -21 } });
    // The display panel is what the game wrote, messages and icon included, under its new number.
    expect(panel).toEqual({ ...original("circuit").entities[4], entity_number: 4 });
    expect(JSON.stringify(panel)).toBe(JSON.stringify({ ...original("circuit").entities[4], entity_number: 4 }));
    expect(result.data.blueprint.wires).toEqual([original("circuit").wires[0], [2, 3, 4, 1]]);
  });

  it("imports lamps that are always on, in the row the game has them in", () => {
    const { circuit, report } = importOf("lamps");
    expect(circuit.entities).toHaveLength(16);
    expect(circuit.entities.every((entity) => entity.kind === "lamp" && entity.alwaysOn && entity.placement?.tile?.y === 35.5)).toBe(true);
    expect(circuit.entities.map((entity) => entity.position.x).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, index) => Math.round((index * 92) / 20) * 20));
    expect(report).toMatchObject({ entities: 16, dropped: [], settings: [], wires: { imported: 0, copper: 0, toDropped: 0, invalid: 0 } });
    const result = exportBlueprint(circuit);
    expect(result.ok && result.data.blueprint.entities).toEqual(original("lamps").entities);
  });

  it("imports belts, inserters, chests and machines as generic entities, and drops what no circuit wire connects to and the copper wires between poles", () => {
    const poles = importOf("poles");
    expect(poles.circuit.entities.map((entity) => (entity.kind === "entity" ? entity.prototype : entity.kind))).toEqual(["pole", "pole", "pole", "pole", "pole", "pole", ...Array.from({ length: 4 }, () => "assembling-machine-2")]);
    expect(poles.circuit.entities.map((entity) => entity.kind === "entity" && entity.blueprintData).filter(Boolean)).toEqual(['{"recipe":"iron-gear-wheel"}']);
    expect(poles.circuit.wires).toEqual([]);
    expect(poles.report).toMatchObject({ dropped: [{ name: "electric-energy-interface", count: 1, reason: "unknown" }], wires: { imported: 0, copper: 5, toDropped: 0, invalid: 0 }, settings: [] });
    const mixed = importOf("poles-and-lamps");
    expect(mixed.report.entities).toBe(37);
    expect(mixed.report.wires).toEqual({ imported: 0, copper: 3, toDropped: 0, invalid: 0 });
    expect(mixed.report.dropped).toEqual([{ name: "electric-energy-interface", count: 1, reason: "unknown" }]);
    expect(mixed.report.settings).toEqual([]);
    // Every entity that came in goes out as the game wrote it, but for its number.
    const kept = original("poles-and-lamps").entities.filter((entity) => entity.name !== "electric-energy-interface");
    const result = exportBlueprint(mixed.circuit);
    expect(result.ok && result.data.blueprint.entities).toEqual(kept.map((entity, index) => ({ ...entity, entity_number: index + 1 })));
  });

  it("imports the 2 x 2 poles on the whole coordinates the game gives them", () => {
    expect(importOf("big-pole").circuit.entities).toMatchObject([{ kind: "pole", prototype: "big-electric-pole", placement: { tile: { x: -12, y: 224 } } }]);
    expect(importOf("substation").circuit.entities).toMatchObject([{ kind: "pole", prototype: "substation", placement: { tile: { x: -8, y: 232 } } }]);
    for (const id of ["big-pole", "substation"]) {
      const result = exportBlueprint(importOf(id).circuit);
      // But for the version, the game's own blueprint: icons, entity, item.
      expect(result.ok && { ...result.data.blueprint, version: 0 }).toEqual({ ...original(id), version: 0 });
    }
  });

  it("takes the label as the name, also when nothing else is left", () => {
    const { circuit, report } = importOf("label");
    expect(circuit).toEqual({ name: "r", entities: [], wires: [] });
    expect(report.dropped).toEqual([{ name: "straight-rail", count: 1, reason: "unknown" }]);
  });

  it("refuses a string of Factorio 1.1", () => {
    expect(importBlueprintString(shipped("factorio-1.1").string)).toEqual({ ok: false, code: "unsupported-version", message: "This blueprint is from Factorio 1.1, which stored circuits differently. Import it into Factorio 2 and export it again" });
  });
});
