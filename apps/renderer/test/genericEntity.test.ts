// The generic entities of the game (kind `entity`: chests, inserters, belts, machines, ...) in the renderer, as far as it has them
// before the entity package: what their cards say, how the session simulates their enable condition, their footprints and their
// one connection point on both canvases, and that a blueprint of them imports with nothing dropped.
import { encodeBlueprintString } from "@face/blueprints";
import { tileSize, type Entity } from "@face/model";
import { describe, expect, it } from "vitest";
import { arrangeBoard } from "../src/canvas/board.ts";
import { blueprintLayout, editLayout } from "../src/canvas/layout.ts";
import { entityNoun, entityTitle, KIND_INFO, prototypeFacts } from "../src/entities/kindInfo.ts";
import { prototypeIconId } from "../src/entities/registry.ts";
import { summaryLines } from "../src/entities/summary.ts";
import { readBlueprint } from "../src/session/blueprints.ts";
import { checkDraft, normalizeEntity } from "../src/session/drafts.ts";
import { createSession, entityNamed, errorsOf, idOf } from "./session/helpers.ts";

const SOURCE = `circuit "Factory" {
    constant source at (40, 80) tile (0.5, 0.5) {
        item:iron-plate = 40
    }

    entity box at (280, 80) tile (2.5, 0.5) {
        prototype = iron-chest
        read-empty-slots = true
    }

    entity feeder at (520, 80) tile (4.5, 0.5) facing north {
        prototype = fast-inserter
        when item:iron-plate < 100
        read-hand = pulse
    }

    entity belt at (760, 80) tile (6.5, 0.5) {
        prototype = transport-belt
    }

    entity heat at (40, 300) tile (1, 4.5) {
        prototype = boiler
    }

    entity silo at (280, 300) tile (8.5, 8.5) {
        prototype = rocket-silo
    }

    entity tank at (520, 300) tile (15.5, 5.5) facing south {
        prototype = storage-tank
    }

    entity station at (760, 300) tile (20, 1) {
        prototype = train-stop
        blueprint-data = "{\\"station\\":\\"Iron\\"}"
    }

    wire red source.out <-> box
    wire red box <-> feeder
    wire green feeder <-> belt
}
`;

describe("what a generic entity is called and says", () => {
  const { session } = createSession(SOURCE);
  const byName = (name: string): Entity => entityNamed(session, name);

  it("goes by the game's name of its prototype and has the icon of the item that places it", () => {
    expect(errorsOf(session)).toEqual([]);
    expect(KIND_INFO.entity.describedInGame).toBe(false);
    expect(["box", "feeder", "belt", "heat", "silo", "tank", "station"].map((name) => entityTitle(byName(name)))).toEqual(["Iron chest", "Fast inserter", "Transport belt", "Boiler", "Rocket silo", "Storage tank", "Train stop"]);
    expect(entityNoun(byName("feeder"))).toBe("a fast inserter");
    expect(prototypeIconId("fast-inserter")).toBe("item/fast-inserter");
    // Only a prototype with a reach of its own says so.
    expect(prototypeFacts(byName("silo"))).toBe("");
    expect(prototypeFacts({ kind: "entity", prototype: "power-switch" })).toBe("2 x 2 tiles, wire reach 10");
    expect(prototypeFacts({ kind: "entity", prototype: "agricultural-tower" })).toBe("3 x 3 tiles, wire reach 30");
  });

  it("sums up its enable condition where its type has one, else how many settings it has", () => {
    expect(summaryLines(byName("feeder"))).toEqual(["iron-plate < 100"]);
    expect(summaryLines(byName("belt"))).toEqual(["no condition"]);
    expect(summaryLines(byName("box"))).toEqual(["1 setting"]);
    expect(summaryLines(byName("silo"))).toEqual(["default settings"]);
  });

  it("is written by the language as it is: nothing to normalize and no draft", () => {
    for (const entity of session.state.circuit.entities) {
      expect(normalizeEntity(entity)).toBe(entity);
      expect(checkDraft(entity)).toEqual({ ok: true });
    }
  });
});

describe("session", () => {
  it("shows whether the enable condition of a wired entity holds, and nothing for one without a condition or a wire", () => {
    const { session } = createSession(SOURCE);
    const status = (name: string) => session.state.simulation.entityStatus.get(idOf(session, name))!;
    expect(session.state.simulation.available).toBe(true);
    expect(status("feeder")).toMatchObject({ label: "enabled", active: false, enabled: true, input: { red: { wired: true, signals: [expect.objectContaining({ value: 40 })] }, green: { wired: true, signals: [] } } });
    // A chest has no condition, a silo no wire: both say nothing, like a pole.
    expect(status("box")).toMatchObject({ label: "", active: false, input: { red: { wired: true } } });
    expect(status("box").enabled).toBeUndefined();
    expect(status("silo")).toEqual({ label: "", active: false, input: { red: { wired: false, signals: [] }, green: { wired: false, signals: [] } } });
    // Nothing of them is traced: they send nothing.
    expect(session.state.simulation.traces.map((row) => row.label)).toEqual(["source iron-plate"]);
    session.commands.setSource(SOURCE.replace("item:iron-plate = 40", "item:iron-plate = 100"));
    expect(status("feeder")).toMatchObject({ label: "disabled", enabled: false });
    // Without its wires the condition is not applied.
    session.commands.setSource(SOURCE.replace("    wire red box <-> feeder\n", "").replace("    wire green feeder <-> belt\n", ""));
    expect(status("feeder").label).toBe("");
  });

  it("wires, renames and turns a generic entity like any other", () => {
    const { session } = createSession(SOURCE);
    session.commands.addWire({ color: "green", a: { entity: idOf(session, "source"), side: "out" }, b: { entity: idOf(session, "silo"), side: "io" } });
    session.commands.addWire({ color: "red", a: { entity: idOf(session, "silo"), side: "io" }, b: { entity: idOf(session, "tank"), side: "io" } });
    expect(session.document.text).toContain("    wire green source.out <-> silo\n    wire red silo <-> tank\n");
    session.commands.renameEntity(idOf(session, "silo"), "launch");
    expect(session.document.text).toContain("    wire green source.out <-> launch\n    wire red launch <-> tank\n");
    // A boiler covers 3 x 2 tiles and turns: its top-left tile stays, the half tile moves to the other axis.
    session.commands.rotateEntities([idOf(session, "heat")], "clockwise");
    expect(session.document.text).toContain("entity heat at (40, 300) tile (1.5, 4) facing south {");
    // A chest and a silo do not turn.
    const before = session.document.text;
    session.commands.rotateEntities([idOf(session, "box"), idOf(session, "launch")], "clockwise");
    expect(session.document.text).toBe(before);
    expect(session.state.error).toBeNull();
    expect(errorsOf(session)).toEqual([]);
  });
});

describe("canvases", () => {
  const { session } = createSession(SOURCE);
  const entities = session.state.circuit.entities;
  const byName = (name: string): Entity => entityNamed(session, name);

  it("routes every wire on the edit canvas, from and to the one connection point", () => {
    const edit = editLayout(entities);
    expect(session.state.circuit.wires).toHaveLength(3);
    for (const wire of session.state.circuit.wires) {
      const route = edit.route(wire, entities.find((entity) => entity.id === wire.a.entity)!, entities.find((entity) => entity.id === wire.b.entity)!);
      expect(route.path.startsWith("M ")).toBe(true);
      expect(Number.isFinite(route.bounds.width + route.bounds.height)).toBe(true);
    }
    // The pins of the connection point are on the top edge of the card, red left of green, as on a pole.
    const [red, green] = [edit.pin(byName("feeder"), "io", "red"), edit.pin(byName("feeder"), "io", "green")];
    expect(red.y).toBe(byName("feeder").position.y);
    expect(green.y).toBe(red.y);
    expect(green.x).toBeGreaterThan(red.x);
  });

  it("stands every entity on the tiles the game gives it, turned where it is not square", () => {
    const placed = arrangeBoard(entities);
    const footprint = (name: string) => {
      const { origin, size, conflict } = placed.get(byName(name).id)!;
      return [origin.x, origin.y, size.width, size.height, conflict];
    };
    expect(footprint("box")).toEqual([2, 0, 1, 1, false]);
    expect(footprint("feeder")).toEqual([4, 0, 1, 1, false]);
    // 3 x 2 tiles facing north; facing east (no clause) it stands 2 wide and 3 high.
    expect(footprint("heat")).toEqual([0, 3, 2, 3, false]);
    expect(tileSize(byName("heat"), "north")).toEqual({ width: 3, height: 2 });
    expect(footprint("silo")).toEqual([4, 4, 9, 9, false]);
    // A storage tank is built facing north or east only; its tiles are the same either way.
    expect(footprint("tank")).toEqual([14, 4, 3, 3, false]);
    expect(footprint("station")).toEqual([19, 0, 2, 2, false]);
    const board = blueprintLayout(entities);
    expect(board.rect(byName("silo"))).toEqual({ x: 320, y: 320, width: 720, height: 720 });
    // The connection point is in the middle of the top end of the footprint, whatever its size.
    expect(board.pin(byName("silo"), "io", "red")).toEqual({ x: 670, y: 332 });
    expect(board.pin(byName("silo"), "io", "green")).toEqual({ x: 690, y: 332 });
    expect(board.pin(byName("box"), "io", "red")).toEqual({ x: 190, y: 12 });
    for (const wire of session.state.circuit.wires) {
      const route = board.route(wire, entities.find((entity) => entity.id === wire.a.entity)!, entities.find((entity) => entity.id === wire.b.entity)!);
      expect(route.path.startsWith("M ")).toBe(true);
    }
    // One empty tile between the chest and the inserter, whose selection box is smaller than its tile: 0.4 around its center, in the game's 1/256 of a tile.
    expect(board.wireSpan(byName("box"), byName("feeder"), 9)).toEqual({ reach: 9, of: "project", distance: 1 + (0.5 - 0.3984375), measure: "boxes", tooLong: false });
  });
});

describe("a blueprint of generic entities", () => {
  it("is read with nothing dropped and with what the editor does not model kept in the source", () => {
    const data = {
      blueprint: {
        item: "blueprint",
        version: 562954249109504,
        entities: [
          { entity_number: 1, name: "steel-chest", position: { x: 0.5, y: 0.5 }, bar: 12 },
          { entity_number: 2, name: "inserter", position: { x: 1.5, y: 0.5 }, direction: 4, control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: { name: "iron-plate" }, constant: 5, comparator: ">" } } },
          { entity_number: 3, name: "assembling-machine-2", position: { x: 4.5, y: 1.5 }, recipe: "iron-gear-wheel" },
        ],
        wires: [[1, 1, 2, 1]],
      },
    };
    const reading = readBlueprint(encodeBlueprintString(data), []);
    if (reading.kind !== "blueprint") throw new Error(JSON.stringify(reading));
    expect(reading.blueprint).toMatchObject({ entities: 3, total: 3, report: null });
    const { session } = createSession(reading.blueprint.source);
    expect(errorsOf(session)).toEqual([]);
    expect(session.state.circuit.entities.map((entity) => [entity.name, entity.kind === "entity" ? entity.prototype : entity.kind, entity.kind === "entity" ? entity.blueprintData : undefined])).toEqual([
      ["steel_chest1", "steel-chest", '{"bar":12}'],
      ["inserter1", "inserter", undefined],
      ["assembling_machine1", "assembling-machine-2", '{"recipe":"iron-gear-wheel"}'],
    ]);
    expect(summaryLines(entityNamed(session, "inserter1"))).toEqual(["iron-plate > 5"]);
    // Wired, with nothing on the network: 0 > 5 does not hold.
    expect(session.state.simulation.entityStatus.get(idOf(session, "inserter1"))).toMatchObject({ label: "disabled", enabled: false });
  });
});
