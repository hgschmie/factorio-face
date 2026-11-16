// Prototypes a mod adds to the kinds of the editor, in the renderer: the selector, the choice of the prototype in the inspector,
// the names, the footprints and pins on the board, placing and changing an entity in a session, and completion.
import { createCatalog } from "@face/catalog";
import { analyze, completionContext } from "@face/language";
import { PROTOTYPE_NAMES, prototypeData, type Entity } from "@face/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { arrangeBoard, boardPinOffset } from "../src/canvas/board.ts";
import { blueprintLayout } from "../src/canvas/layout.ts";
import { alternativePrototypes, withPrototype } from "../src/entities/genericSettings.ts";
import { capitalized, entityDescription, entityNoun, entityTitle, prototypeFacts, prototypeLabel } from "../src/entities/kindInfo.ts";
import { entriesInUse, keyedKindOf, searchEntries, type EntityRegistry } from "../src/entities/registry.ts";
import { TYPE_DESCRIPTIONS } from "../src/entities/typeInfo.ts";
import { applyData } from "../src/gameData/dataInUse.ts";
import { CatalogService } from "../src/session/catalogService.ts";
import { completionCandidates } from "../src/session/completion.ts";
import { sameTool } from "../src/workbench/controller.ts";
import { MODDED_MODULES } from "./fixtures/moddedData.ts";
import { moddedKindsData } from "./fixtures/moddedKinds.ts";
import { createSession, EMPTY_SOURCE, entityNamed, project, type TestSession } from "./session/helpers.ts";

const COMBINATORS = ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"];

const SOURCE = `circuit "Modded kinds" {
    mod-constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 3
    }

    mod-arithmetic double at (280, 80) tile (2.5, 0.5) {
        virtual:signal-A = virtual:signal-A * 2
    }

    mod-decider gate at (520, 80) tile (5, 1) facing north {
        when virtual:signal-A > 5
        output virtual:signal-A = 1
    }

    mod-pole relay at (760, 80) tile (9, 1) {
    }

    mod-lamp light at (1000, 80) tile (13, 1) {
        when virtual:signal-A > 0
    }

    small-lamp small at (1000, 300) tile (16.5, 0.5) {
        when virtual:signal-A > 0
    }

    mod-loader feed at (1240, 80) tile (18.5, 0.5) {
        when virtual:signal-A > 0
    }

    wire red source.out <-> double.in
    wire red double.out <-> gate.in
    wire green gate.out <-> relay
    wire green relay <-> light.in
    wire green relay <-> small.in
    wire green relay <-> feed
}
`;

const reset = (): unknown => applyData({ source: { kind: "built-in", version: "2.1.24" }, problem: null, mods: [], catalog: null, entities: null, icons: [] });
/** A session on the modded data, which is applied as a window does at start, with a project that has the mod switched on. */
const modded = (source = EMPTY_SOURCE): TestSession => createSession(source, { data: applyData(moddedKindsData()), project: project(source, { modules: MODDED_MODULES }) });

describe("modded prototypes of the kinds of the editor", () => {
  let registry: EntityRegistry;
  beforeAll(() => {
    registry = modded().session.state.catalog.entities();
  });
  afterAll(reset);

  const row = (group: string, subgroup: string): string[] => registry.groups.find((candidate) => candidate.name === group)!.subgroups.find((candidate) => candidate.name === subgroup)!.entries.map((entry) => entry.prototype);

  it("are in the tabs of the selector by their item group, in the game's order, each with its kind", () => {
    expect(row("logistics", "circuit-network")).toEqual([
      "5d-lamp", "small-lamp", "mod-lamp", "arithmetic-combinator", "mod-arithmetic", "decider-combinator", "mod-decider", "selector-combinator", "mod-selector", "constant-combinator", "mod-constant", "power-switch",
      "programmable-speaker", "display-panel",
    ]);
    expect(row("logistics", "energy-pipe-distribution").slice(0, 5)).toEqual(["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation", "mod-pole"]);
    // The loader of one tile is the only loader the selector has: the game hides its own.
    expect(row("logistics", "belt").filter((name) => name.includes("loader"))).toEqual(["mod-loader"]);
    const kinds = Object.fromEntries(["mod-constant", "mod-arithmetic", "mod-decider", "mod-selector", "mod-lamp", "5d-lamp", "mod-pole", "mod-loader"].map((name) => [name, registry.entry(name)!.kind]));
    expect(kinds).toEqual({ "mod-constant": "constant", "mod-arithmetic": "arithmetic", "mod-decider": "decider", "mod-selector": "selector", "mod-lamp": "lamp", "5d-lamp": "lamp", "mod-pole": "pole", "mod-loader": "entity" });
    expect(registry.groupOf("mod-arithmetic")).toBe("logistics");
    // What has no kind is not there at all; what the game hides has an entry and no tile.
    expect([registry.entry("mod-speaker"), registry.entry("mod-oddity")]).toEqual([undefined, undefined]);
    expect([registry.offers("mod-hidden-lamp"), registry.entry("mod-hidden-lamp")?.kind]).toEqual([false, "lamp"]);
  });

  it("leaves the pinned row and the digit keys to the standard combinators and the lamp of the game", () => {
    expect(registry.pinned.map((entry) => entry.prototype)).toEqual(COMBINATORS);
    expect(registry.entries.slice(0, 4)).toEqual(registry.pinned);
    expect(registry.entries.filter((entry) => keyedKindOf(entry) !== undefined).map((entry) => entry.prototype)).toEqual([...COMBINATORS, "small-lamp"]);
    expect([keyedKindOf({ prototype: "mod-lamp" }), keyedKindOf({ prototype: "small-lamp" }), keyedKindOf({ prototype: "mod-arithmetic" })]).toEqual([undefined, "lamp", undefined]);
    // The place tool of a modded prototype is another tool than the one of the kind.
    expect(sameTool({ type: "place", prototype: "arithmetic-combinator" }, { type: "place", prototype: "arithmetic-combinator" })).toBe(true);
    expect(sameTool({ type: "place", prototype: "arithmetic-combinator" }, { type: "place", prototype: "mod-arithmetic" })).toBe(false);
  });

  it("have an entry with the name, the tiles and the reach of the game, and the line of their kind or type", () => {
    const facts = (prototype: string): string[] => [registry.entry(prototype)!.label, registry.entry(prototype)!.facts, registry.entry(prototype)!.description];
    expect(facts("mod-arithmetic")).toEqual(["Tiny arithmetic combinator", "1 tile", "Transform your signals"]);
    expect(facts("arithmetic-combinator")).toEqual(["Arithmetic combinator", "1 x 2 tiles", "Transform your signals"]);
    expect(facts("mod-decider")).toEqual(["Wide decider combinator", "2 x 2 tiles", "Compare and decide"]);
    expect(facts("mod-lamp")).toEqual(["Big lamp", "2 x 2 tiles", "See a condition light up"]);
    expect(facts("mod-pole")).toEqual(["Huge electric pole", "2 x 2 tiles, wire reach 48", "Relay signals over a distance"]);
    expect(facts("mod-loader")).toEqual(["Miniloader", "1 tile", TYPE_DESCRIPTIONS.loader]);
    expect(entityDescription({ prototype: "mod-loader" })).toBe(TYPE_DESCRIPTIONS["loader-1x1"]);
    expect(searchEntries(registry.groups, "tiny").flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.entries.map((entry) => entry.prototype)))).toEqual(["mod-arithmetic", "mod-selector", "mod-constant"]);
  });

  it("names an entity by its prototype where the game data has several of its kind", () => {
    expect(entityTitle({ prototype: "mod-arithmetic" })).toBe("Tiny arithmetic combinator");
    expect(entityTitle({ prototype: "arithmetic-combinator" })).toBe("Arithmetic combinator");
    expect(entityTitle({ prototype: "mod-lamp" })).toBe("Big lamp");
    expect(entityNoun({ prototype: "mod-pole" })).toBe("a huge electric pole");
    // The speaker has one prototype, with mods as without.
    expect(entityTitle({ prototype: "programmable-speaker" })).toBe("Speaker");
    expect(prototypeFacts({ prototype: "mod-lamp" })).toBe("2 x 2 tiles");
  });

  it("lists the entities in use by their prototype, the modded ones among them", () => {
    const { session } = modded(SOURCE);
    expect(session.state.diagnostics).toEqual([]);
    expect(entriesInUse(registry, session.state.circuit.entities).map((entry) => entry.prototype)).toEqual(["mod-loader", "mod-pole", "small-lamp", "mod-lamp", "mod-arithmetic", "mod-decider", "mod-constant"]);
    // A standard combinator is pinned and therefore not among them; a modded one of the same kind is.
    expect(entriesInUse(registry, [{ prototype: "arithmetic-combinator" }, { prototype: "mod-arithmetic" }]).map((entry) => entry.prototype)).toEqual(["mod-arithmetic"]);
  });

  describe("the choice of the prototype in the inspector", () => {
    it("is among the prototypes of the kind that the selector offers, in the game's order, and always has the one the entity is", () => {
      const choices = (prototype: string): readonly string[] => alternativePrototypes(prototype, registry.offers, registry.position);
      expect(choices("arithmetic-combinator")).toEqual(["arithmetic-combinator", "mod-arithmetic"]);
      expect(choices("mod-constant")).toEqual(["constant-combinator", "mod-constant"]);
      expect(choices("small-lamp")).toEqual(["5d-lamp", "small-lamp", "mod-lamp"]);
      expect(choices("mod-hidden-lamp")).toEqual(["5d-lamp", "small-lamp", "mod-lamp", "mod-hidden-lamp"]);
      expect(choices("substation")).toEqual(["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation", "mod-pole"]);
      // One prototype: nothing to choose, so the inspector shows no field.
      expect(choices("programmable-speaker")).toEqual(["programmable-speaker"]);
      expect(choices("mod-loader")).toEqual(["mod-loader"]);
      // Without the registry: the standard one of the kind first, the others by name.
      expect(alternativePrototypes("mod-lamp")).toEqual(["small-lamp", "5d-lamp", "mod-lamp"]);
    });

    it("makes the entity another prototype of its kind and keeps its settings", () => {
      const { session } = modded(SOURCE);
      const light = entityNamed(session, "light");
      expect(withPrototype(light, "5d-lamp")).toEqual({ ...light, prototype: "5d-lamp" });
      expect(withPrototype(light, "small-lamp")).toEqual({ ...light, prototype: "small-lamp" });
      expect(withPrototype(entityNamed(session, "small"), "mod-lamp")).toMatchObject({ kind: "lamp", prototype: "mod-lamp", condition: { comparator: ">" } });
      expect(withPrototype(entityNamed(session, "relay"), "small-electric-pole")).toMatchObject({ kind: "pole", prototype: "small-electric-pole" });
    });
  });

  describe("on the board", () => {
    it("stand on the tiles of their prototype", () => {
      const { session } = modded(SOURCE);
      const { entities } = session.state.circuit;
      const board = arrangeBoard(entities);
      const standing = Object.fromEntries(entities.map((entity) => [entity.name, [board.get(entity.id)!.origin, board.get(entity.id)!.size, board.get(entity.id)!.conflict]]));
      expect(standing).toEqual({
        source: [{ x: 0, y: 0 }, { width: 1, height: 1 }, false],
        double: [{ x: 2, y: 0 }, { width: 1, height: 1 }, false],
        gate: [{ x: 4, y: 0 }, { width: 2, height: 2 }, false],
        relay: [{ x: 8, y: 0 }, { width: 2, height: 2 }, false],
        light: [{ x: 12, y: 0 }, { width: 2, height: 2 }, false],
        small: [{ x: 16, y: 0 }, { width: 1, height: 1 }, false],
        feed: [{ x: 18, y: 0 }, { width: 1, height: 1 }, false],
      });
      expect(blueprintLayout(entities).rect(entityNamed(session, "gate"))).toEqual({ x: 320, y: 0, width: 160, height: 160 });
      // A combinator without a `tile` takes the tiles of its prototype at its derived place too.
      const derived = arrangeBoard(modded('circuit "t" {\n    mod-arithmetic a at (0, 0) {\n    }\n\n    arithmetic-combinator b at (0, 0) {\n    }\n}\n').session.state.circuit.entities);
      expect([...derived.values()].map((placement) => placement.size)).toEqual([{ width: 1, height: 1 }, { width: 2, height: 1 }]);
    });

    it("have their pins at the two ends of one tile, and on the halves of a combinator of two by two tiles across its facing", () => {
      const tiny = { kind: "arithmetic", prototype: "mod-arithmetic" } as const;
      // One tile: the input at the end behind, the output at the end in front, red on the left seen along the facing.
      expect([boardPinOffset(tiny, "east", "in", "red"), boardPinOffset(tiny, "east", "in", "green")]).toEqual([{ x: 12, y: 30 }, { x: 12, y: 50 }]);
      expect([boardPinOffset(tiny, "east", "out", "red"), boardPinOffset(tiny, "east", "out", "green")]).toEqual([{ x: 68, y: 30 }, { x: 68, y: 50 }]);
      expect([boardPinOffset(tiny, "north", "out", "red"), boardPinOffset(tiny, "north", "in", "red")]).toEqual([{ x: 30, y: 12 }, { x: 30, y: 68 }]);
      // Two by two: each half is two tiles wide across the facing, with its pins in the middle of its outer end.
      const wide = { kind: "decider", prototype: "mod-decider" } as const;
      expect([boardPinOffset(wide, "east", "in", "red"), boardPinOffset(wide, "east", "out", "green")]).toEqual([{ x: 12, y: 70 }, { x: 148, y: 90 }]);
      expect([boardPinOffset(wide, "north", "in", "red"), boardPinOffset(wide, "north", "out", "red")]).toEqual([{ x: 70, y: 148 }, { x: 70, y: 12 }]);
      expect([boardPinOffset(wide, "south", "in", "red"), boardPinOffset(wide, "south", "out", "red")]).toEqual([{ x: 90, y: 12 }, { x: 90, y: 148 }]);
      // A lamp of two by two has its input in the middle of its left end, a modded pole its point in the middle of the top end.
      expect(boardPinOffset({ prototype: "mod-lamp" }, "east", "in", "red")).toEqual({ x: 12, y: 70 });
      expect(boardPinOffset({ prototype: "mod-pole" }, "east", "io", "green")).toEqual({ x: 90, y: 12 });
      // The standard combinator keeps its pins.
      expect(boardPinOffset({ prototype: "decider-combinator" }, "east", "out", "green")).toEqual({ x: 148, y: 50 });
    });
  });

  describe("in a session", () => {
    it("simulates a circuit of modded prototypes as one of the standard ones", () => {
      const { session } = modded(SOURCE);
      for (let tick = 0; tick < 4; tick++) session.commands.step();
      const status = (name: string) => session.state.simulation.entityStatus.get(entityNamed(session, name).id)!;
      expect(status("double").output).toEqual([expect.objectContaining({ key: "virtual:signal-A", value: 6 })]);
      expect(status("light").active).toBe(true);
      expect(status("small").active).toBe(true);
      expect(status("feed").enabled).toBe(true);
    });

    it("places an entity of the prototype of its tool, on the cards and on the tiles of the prototype", () => {
      const { session } = modded();
      session.commands.placeEntity("mod-arithmetic", { x: 40, y: 40 });
      session.commands.placeEntity("arithmetic-combinator", { x: 280, y: 40 });
      session.commands.placeEntity("5d-lamp", { x: 520, y: 40 });
      expect(session.document.text).toBe(
        'circuit "Untitled circuit" {\n    mod-arithmetic arithmetic1 at (40, 40) {\n    }\n\n    arithmetic-combinator arithmetic2 at (280, 40) {\n    }\n\n    "5d-lamp" lamp1 at (520, 40) {\n    }\n}\n',
      );
      session.commands.setDisplayMode("blueprint");
      // One tile for the modded combinator, facing north; two by two for the big lamp.
      session.commands.placeEntityOnTile("mod-arithmetic", { x: 10.5, y: 10.5 }, "north");
      session.commands.placeEntityOnTile("mod-lamp", { x: 13, y: 11 });
      expect(session.state.error).toBeNull();
      expect(entityNamed(session, "arithmetic3")).toMatchObject({ prototype: "mod-arithmetic", placement: { tile: { x: 10.5, y: 10.5 }, direction: "north" } });
      expect(entityNamed(session, "lamp2")).toMatchObject({ prototype: "mod-lamp", placement: { tile: { x: 13, y: 11 } } });
      expect(session.state.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    });

    it("changes the prototype of an entity: it keeps its top-left tile, and a change onto a taken tile is refused", () => {
      const { session } = modded(SOURCE);
      session.commands.setDisplayMode("blueprint");
      const named = (name: string): Entity => entityNamed(session, name);
      // The lamp of one tile becomes the big one: from its top-left tile (16, 0) it then covers (16..17, 0..1).
      session.commands.updateEntity(withPrototype(named("small"), "mod-lamp"));
      expect(session.state.error).toBeNull();
      expect(named("small")).toMatchObject({ prototype: "mod-lamp", placement: { tile: { x: 17, y: 1 } } });
      expect(session.document.text).toContain("    mod-lamp small at (1000, 300) tile (17, 1) {\n        when virtual:signal-A > 0\n    }");
      // And back: the word of the declaration is the lamp of the game again.
      session.commands.updateEntity(withPrototype(named("small"), "small-lamp"));
      expect(session.document.text).toContain("    small-lamp small at (1000, 300) tile (16.5, 0.5) {\n        when virtual:signal-A > 0\n    }");
      expect(named("small")).toMatchObject({ kind: "lamp", placement: { tile: { x: 16.5, y: 0.5 } } });
      expect(named("small").prototype).toBe("small-lamp");
      // The standard arithmetic combinator is two tiles long: the tiny one at (2, 0) would reach onto (3, 0), which is free, ...
      session.commands.updateEntity(withPrototype(named("double"), "arithmetic-combinator"));
      expect(named("double")).toMatchObject({ kind: "arithmetic", placement: { tile: { x: 3, y: 0.5 } } });
      expect(named("double").prototype).toBe("arithmetic-combinator");
      // ... but a lamp on the tile left of the lamp `small` cannot grow into it.
      session.commands.placeEntityOnTile("small-lamp", { x: 15.5, y: 0.5 });
      session.commands.updateEntity(withPrototype(named("lamp1"), "mod-lamp"));
      expect(session.state.error).toBe("Not changed: lamp1 would stand on a tile of small.");
      expect(named("lamp1").prototype).toBe("small-lamp");
    });
  });

  it("offers the entities of the game data at the start of a member, as the source writes them and with their names in the game", () => {
    const data = moddedKindsData();
    applyData(data);
    const service = new CatalogService(createCatalog(data.catalog!), data.mods.map((mod) => mod.name));
    const at = (text: string) => completionCandidates(completionContext(analyze(text.replace("|", "")), text.indexOf("|")), service);
    const members = at('circuit "t" {\n    small-lamp l {\n    }\n    |\n}\n');
    expect(members[0]).toEqual({ label: "wire", type: "keyword" });
    expect(members.slice(1).map((candidate) => candidate.type)).toEqual(PROTOTYPE_NAMES.map(() => "entity"));
    const entity = (label: string) => members.find((candidate) => candidate.label === label);
    expect(entity("small-lamp")).toEqual({ label: "small-lamp", type: "entity", detail: "Lamp" });
    expect(entity("mod-arithmetic")).toEqual({ label: "mod-arithmetic", type: "entity", detail: "Tiny arithmetic combinator" });
    expect(entity("steel-chest")).toEqual({ label: "steel-chest", type: "entity", detail: "Steel chest" });
    // A name that does not read as one word is offered in its quotes, and one the editor does not support not at all.
    expect(entity('"5d-lamp"')).toEqual({ label: '"5d-lamp"', type: "entity", detail: "Fifth lamp" });
    expect(entity("5d-lamp") ?? entity("mod-speaker")).toBeUndefined();
    // No property says which entity it is.
    for (const body of ["small-lamp l", "small-electric-pole p", "mod-loader m"]) expect(at(`circuit "t" {\n    ${body} {\n        |\n    }\n}\n`).map((candidate) => candidate.label)).not.toContain("prototype");
  });
});

describe("the name a mod gives its prototype", () => {
  afterAll(reset);

  it("is shown as the game writes it where it stands by itself, and in lower case inside a sentence", () => {
    const { session } = createSession(EMPTY_SOURCE, { data: applyData(moddedKindsData({ "mod-constant": "LTN Combinator", "mod-loader": "AAI Loader (Mk2)" })), project: project(EMPTY_SOURCE, { modules: MODDED_MODULES }) });
    const registry = session.state.catalog.entities();
    const ltn = { kind: "constant", prototype: "mod-constant" } as const;
    // The tile of the selector and its popup, the Type field of the inspector, the title of the inspector and the heading of the card.
    expect(registry.entry("mod-constant")!.label).toBe("LTN Combinator");
    expect(prototypeLabel(ltn)).toBe("LTN Combinator");
    expect(entityTitle(ltn)).toBe("LTN Combinator");
    expect(entityTitle({ prototype: "mod-loader" })).toBe("AAI Loader (Mk2)");
    // The standard prototype of the kind beside it keeps its name.
    expect(entityTitle({ prototype: "constant-combinator" })).toBe("Constant combinator");
    // In a sentence the name is a noun like any other.
    expect(prototypeData(ltn).label).toBe("ltn combinator");
    expect(entityNoun(ltn)).toBe("a ltn combinator");
    // The search of the selector does not mind the case.
    const found = (query: string): string[] => searchEntries(registry.groups, query).flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.entries.map((entry) => entry.prototype)));
    expect([found("ltn comb"), found("LTN"), found("mk2")]).toEqual([["mod-constant"], ["mod-constant"], ["mod-loader"]]);
  });

  it("leaves every name of the standard game as it was: the first letter in capitals, the rest as the game has it", () => {
    reset();
    expect(PROTOTYPE_NAMES.length).toBeGreaterThan(90);
    for (const prototype of PROTOTYPE_NAMES) {
      const shape = { prototype };
      expect(prototypeLabel(shape), prototype).toBe(capitalized(prototypeData(shape).label));
    }
    expect(["small-lamp", "big-electric-pole", "programmable-speaker", "decider-combinator"].map((prototype) => prototypeLabel({ prototype }))).toEqual(["Lamp", "Big electric pole", "Programmable speaker", "Decider combinator"]);
  });
});

describe("with the built-in data", () => {
  it("has one prototype of every kind but the pole, so the inspector shows the choice for a pole only", () => {
    reset();
    const { session } = createSession(EMPTY_SOURCE);
    const registry = session.state.catalog.entities();
    const choices = (prototype: string): readonly string[] => alternativePrototypes(prototype, registry.offers, registry.position);
    expect(["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator", "small-lamp", "programmable-speaker"].map((name) => choices(name).length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(choices("big-electric-pole")).toEqual(["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"]);
    expect(entityTitle({ prototype: "arithmetic-combinator" })).toBe("Arithmetic");
  });
});
