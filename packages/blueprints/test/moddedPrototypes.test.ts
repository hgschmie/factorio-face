// Blueprints with the entity table of a modded game: a game name becomes the kind of its prototype type and the prototype, the
// name written is the prototype, and a loader of one tile has the control behaviour of the loader.
import { printCircuit } from "@face/language";
import { prototypeOf, setEntityTable, STANDARD_ENTITY_TABLE } from "@face/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODDED_ENTITY_TABLE } from "../../../tests/fixtures/game/moddedEntities.ts";
import { A, B, blueprintOf, circuitOf, exported, imported, importedEntity } from "./helpers.ts";

const SOURCE = `
  constant c { prototype = mod-constant virtual:signal-A = 1 }
  arithmetic a facing south { prototype = mod-arithmetic description = "doubles" virtual:signal-B = virtual:signal-A * 2 }
  decider d facing north { prototype = mod-decider when virtual:signal-A > 0 output virtual:signal-A = 1 }
  selector s { prototype = mod-selector operation = count output = virtual:signal-C }
  lamp l { prototype = mod-lamp when virtual:signal-A > 0 always-on = true }
  lamp f { prototype = "5d-lamp" }
  pole p { prototype = mod-pole }
  entity m facing west { prototype = mod-loader read-transfers = true when virtual:signal-A > 0 }
  arithmetic plain { virtual:signal-B = virtual:signal-A + 1 }
  wire red c.out <-> a.in
  wire green a.out <-> d.in
  wire red d.out <-> p
  wire red p <-> l.in
  wire green m <-> s.in
`;

describe("blueprints of a modded game", () => {
  beforeAll(() => setEntityTable(MODDED_ENTITY_TABLE));
  afterAll(() => setEntityTable(STANDARD_ENTITY_TABLE));

  it("writes the prototype as the name of the entity, with the settings of its kind", () => {
    const { entities } = exported(circuitOf(SOURCE)).blueprint;
    expect(entities.map((entity) => entity.name)).toEqual(["mod-constant", "mod-arithmetic", "mod-decider", "mod-selector", "mod-lamp", "5d-lamp", "mod-pole", "mod-loader", "arithmetic-combinator"]);
    const [constant, arithmetic, decider, , lamp, , pole, loader] = entities as unknown as Record<string, unknown>[];
    // A constant combinator that does not turn has no direction; a combinator of one tile turns in place.
    expect(constant).not.toHaveProperty("direction");
    expect(arithmetic).toMatchObject({ direction: 8, player_description: "doubles", control_behavior: { arithmetic_conditions: { first_signal: A, second_constant: 2, operation: "*", output_signal: B } } });
    expect(decider).toMatchObject({ control_behavior: { decider_conditions: { conditions: [{ first_signal: A, comparator: ">" }] } } });
    expect(decider).not.toHaveProperty("direction");
    expect(lamp).toMatchObject({ always_on: true, control_behavior: { circuit_enabled: true } });
    expect(Object.keys(pole!).sort()).toEqual(["entity_number", "name", "position"]);
    expect(loader).toMatchObject({ direction: 12, control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: A, comparator: ">" }, circuit_read_transfers: true } });
  });

  it("reads a game name as the kind of its prototype type and the prototype", () => {
    const blueprint = blueprintOf([
      { entity_number: 1, name: "mod-arithmetic", position: { x: 0.5, y: 0.5 }, direction: 4, control_behavior: { arithmetic_conditions: { first_signal: A, second_constant: 2, operation: "*", output_signal: B } } },
      { entity_number: 2, name: "mod-lamp", position: { x: 4, y: 1 }, always_on: true },
      { entity_number: 3, name: "mod-pole", position: { x: 8, y: 1 } },
      { entity_number: 4, name: "mod-loader", position: { x: 10.5, y: 0.5 }, direction: 4, type: "output", control_behavior: { circuit_read_transfers: true } },
      { entity_number: 5, name: "small-lamp", position: { x: 12.5, y: 0.5 } },
      { entity_number: 6, name: "mod-speaker", position: { x: 14.5, y: 0.5 } },
      { entity_number: 7, name: "mod-constant", position: { x: 16.5, y: 0.5 }, direction: 8 },
    ], [[1, 3, 3, 1], [3, 1, 2, 1], [4, 2, 2, 2], [6, 1, 5, 1]]);
    const { circuit, report } = imported(blueprint);
    expect(circuit.entities.map((entity) => [entity.name, entity.kind, entity.prototype, prototypeOf(entity)])).toEqual([
      ["arithmetic1", "arithmetic", "mod-arithmetic", "mod-arithmetic"],
      ["lamp1", "lamp", "mod-lamp", "mod-lamp"],
      ["pole1", "pole", "mod-pole", "mod-pole"],
      ["mod_loader1", "entity", "mod-loader", "mod-loader"],
      // The first of its kind holds no prototype.
      ["lamp2", "lamp", undefined, "small-lamp"],
      ["constant1", "constant", "mod-constant", "mod-constant"],
    ]);
    expect(circuit.entities[0]).toMatchObject({ operation: "*", output: { kind: "virtual", name: "signal-B" }, placement: { tile: { x: 0.5, y: 0.5 } } });
    expect(circuit.entities[3]).toMatchObject({ settings: { "read-transfers": true }, blueprintData: '{"type":"output"}' });
    // The constant combinator of the mod does not turn: its direction is not one of the entity.
    expect(circuit.entities[5]!.placement).toEqual({ tile: { x: 16.5, y: 0.5 } });
    // A modded speaker has no kind: it is dropped with its wire, like every entity the editor does not have.
    expect(report.dropped).toEqual([{ name: "mod-speaker", count: 1, reason: "unknown" }]);
    expect(report.wires).toMatchObject({ imported: 3, toDropped: 1 });
    expect(printCircuit(circuit)).toContain("    arithmetic arithmetic1 at (0, 0) tile (0.5, 0.5) {\n        prototype = mod-arithmetic\n        virtual:signal-B = virtual:signal-A * 2\n    }");
  });

  it("keeps a circuit of modded prototypes through a blueprint and back, and the blueprint through the editor", () => {
    const first = exported(circuitOf(SOURCE));
    const back = imported(first).circuit;
    expect(back.entities.map((entity) => [entity.kind, prototypeOf(entity), entity.placement?.direction])).toEqual([
      ["constant", "mod-constant", undefined], ["arithmetic", "mod-arithmetic", "south"], ["decider", "mod-decider", "north"], ["selector", "mod-selector", undefined], ["lamp", "mod-lamp", undefined], ["lamp", "5d-lamp", undefined],
      ["pole", "mod-pole", undefined], ["entity", "mod-loader", "west"], ["arithmetic", "arithmetic-combinator", undefined],
    ]);
    expect(back.wires).toHaveLength(5);
    expect(exported(back)).toEqual(first);
    // The source of what came back reads as the same circuit.
    expect(exported(circuitOf(printCircuit(back).replace(/^circuit "t" \{\n|\}\n$/g, "")))).toEqual(first);
  });

  it("resets a modded entity the language cannot say to a new one of the same prototype", () => {
    // A wildcard where the game takes none: the settings go, the prototype stays.
    const { entity, notes } = importedEntity("mod-lamp", { position: { x: 1, y: 1 }, control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: { type: "virtual", name: "signal-each" }, comparator: ">", constant: 1 } } });
    expect(entity).toMatchObject({ kind: "lamp", prototype: "mod-lamp" });
    expect(entity).not.toHaveProperty("condition");
    expect(notes).toEqual(["reset control_behavior"]);
  });
});

describe("blueprints of a modded game, read with the standard game data", () => {
  it("drops the entities of the mod as unknown", () => {
    const blueprint = blueprintOf([{ entity_number: 1, name: "mod-lamp", position: { x: 1, y: 1 } }, { entity_number: 2, name: "mod-loader", position: { x: 4.5, y: 0.5 } }, { entity_number: 3, name: "small-lamp", position: { x: 6.5, y: 0.5 } }]);
    const { circuit, report } = imported(blueprint);
    expect(circuit.entities.map((entity) => entity.kind)).toEqual(["lamp"]);
    expect(report.dropped).toEqual([{ name: "mod-lamp", count: 1, reason: "unknown" }, { name: "mod-loader", count: 1, reason: "unknown" }]);
  });
});
