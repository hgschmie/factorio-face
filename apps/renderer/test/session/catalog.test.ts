// Catalog integration: signal status per module set, module settings, the picker data, completion and the simulation environment.
import { loadStandardCatalog } from "@face/catalog";
import { analyze, completionContext } from "@face/language";
import { signal, wildcardSignal } from "@face/model";
import { compile, createSimulation } from "@face/simulation";
import { describe, expect, it } from "vitest";
import { CatalogService } from "../../src/session/catalogService.ts";
import { completionCandidates } from "../../src/session/completion.ts";
import { createCatalogEnvironment, environmentData, rocketCapacityOf, rocketLiftWeight, UNLIMITED_LIFT_WEIGHT } from "../../src/session/environment.ts";
import { createSession, idOf } from "./helpers.ts";

const catalog = loadStandardCatalog();
const ALL = ["base", "elevated-rails", "recycler", "quality", "space-age"];

const SPACE = `circuit "Space" {
    // carbon fiber is a Space Age item
    constant stock at (0, 0) {
        item:carbon-fiber = 5
        item:iron-plate@rare = 2
        virtual:signal-A = 1
        item:no-such-thing = 1
    }
}
`;

describe("signal status and module settings", () => {
  it("knows signals of enabled modules, wildcards and qualities", () => {
    const service = new CatalogService(catalog, ALL);
    expect(service.status(signal("item", "carbon-fiber"))).toBe("known");
    expect(service.status(signal("item", "iron-plate", "legendary"))).toBe("known");
    expect(service.status(wildcardSignal("each"))).toBe("known");
    expect(service.status(signal("item", "no-such-thing"))).toBe("unknown");
    expect(service.status(signal("item", "iron-plate", "mythic"))).toBe("unknown");
    expect(service.status(signal("custom", "mine"))).toBe("unknown");
    expect(service.describe(signal("item", "carbon-fiber"))).toEqual({ status: "known", displayName: "Carbon fiber", icon: "item/carbon-fiber" });
    expect(service.describe(signal("item", "iron-plate", "rare")).displayName).toBe("Iron plate (Rare)");
    // Space Age removes the satellite: it exists in the catalog but not for this module set.
    expect(service.status(signal("item", "satellite"))).toBe("disabled");
    expect(new CatalogService(catalog, ["base"]).status(signal("item", "satellite"))).toBe("known");
  });

  it("disabling a module produces warnings and keeps the text; enabling it clears them", () => {
    const { session } = createSession(SPACE);
    const codes = (): string[] => session.state.diagnostics.map((diagnostic) => `${diagnostic.severity}:${diagnostic.code}:${diagnostic.line}`);
    expect(codes()).toEqual(["warning:unknown-signal:7"]);
    const version = session.document.version;

    session.commands.setModuleEnabled("space-age", false);
    expect(codes()).toEqual(["warning:disabled-signal:4", "warning:unknown-signal:7"]);
    expect(session.state.diagnostics[0]!.message).toContain("carbon-fiber");
    expect(session.state).toMatchObject({ source: SPACE, editable: true, canUndo: false });
    expect(session.document.version).toBe(version);
    expect(session.state.circuit.entities).toHaveLength(1);
    expect(session.state.catalog.modules.map((module) => [module.name, module.enabled])).toEqual([["base", true], ["elevated-rails", true], ["recycler", true], ["quality", true], ["space-age", false]]);
    expect(session.state.catalog.describe(signal("item", "carbon-fiber"))).toMatchObject({ status: "disabled", displayName: "Carbon fiber" });
    expect(session.state.project.dirty).toBe(true);

    // Recycler takes Quality with it: the rare iron plate is now flagged too. Nothing is deleted.
    session.commands.setModuleEnabled("recycler", false);
    expect(session.state.catalog.modules.filter((module) => module.enabled).map((module) => module.name)).toEqual(["base", "elevated-rails"]);
    expect(codes()).toEqual(["warning:disabled-signal:4", "warning:disabled-signal:5", "warning:unknown-signal:7"]);
    expect(session.state.catalog.qualities).toEqual([]);
    expect(session.state.source).toBe(SPACE);

    // Space Age brings back what it needs and the recommended Quality.
    session.commands.setModuleEnabled("space-age", true);
    expect(session.state.catalog.modules.every((module) => module.enabled)).toBe(true);
    expect(codes()).toEqual(["warning:unknown-signal:7"]);
    expect(session.state.catalog.qualities.map((quality) => quality.name)).toEqual(["normal", "uncommon", "rare", "epic", "legendary"]);
    expect(session.state.project.dirty).toBe(false);
    expect(session.state.canUndo).toBe(false);
  });

  it("describes what switching a module does and refuses to switch off the base module", () => {
    const { session } = createSession(SPACE);
    const module = (name: string) => session.state.catalog.modules.find((candidate) => candidate.name === name)!;
    expect(module("base")).toMatchObject({ title: "Base Mod", canDisable: false, enabled: true });
    expect(module("recycler")).toMatchObject({ canDisable: true, disables: ["quality", "space-age"], enables: [] });
    expect(module("space-age").signalCount).toBeGreaterThan(200);
    const before = session.state.catalog;
    session.commands.setModuleEnabled("base", false);
    session.commands.setModuleEnabled("space-age", true);
    session.commands.setModuleEnabled("no-such-module", true);
    expect(session.state.catalog).toBe(before);

    session.commands.setModuleEnabled("recycler", false);
    expect(module("space-age")).toMatchObject({ enabled: false, enables: ["recycler", "quality"] });
    expect(module("quality")).toMatchObject({ enabled: false, enables: ["recycler"] });
  });

  it("keeps unknown module names and reports missing dependencies of a hand-edited list", () => {
    const service = new CatalogService(catalog, ["space-age", "my-mod", "base"]);
    expect(service.enabled).toEqual(["base", "space-age"]);
    expect(service.unknownModules).toEqual(["my-mod"]);
    expect(service.modules.find((module) => module.name === "space-age")!.missing).toEqual(["elevated-rails", "recycler"]);
    expect(service.withModule("quality", true)).toEqual(["base", "recycler", "quality", "space-age", "my-mod"]);
    expect(service.withModule("space-age", true)).toBeUndefined();
    // Whatever the catalog makes of such a set, the views get a tree (possibly empty) and an environment, never an exception.
    for (const modules of [["space-age"], ["quality"], ["space-age", "base"], []]) {
      expect(Array.isArray(new CatalogService(catalog, modules).picker())).toBe(true);
      expect(createCatalogEnvironment(catalog, modules).stackSize(signal("item", "no-such-thing"))).toBeUndefined();
      expect(createSession(SPACE, { project: { path: null, data: { manifest: { formatVersion: 1, name: "Odd", gameVersion: "2.1.24", modules, customSignalGroups: [], circuits: ["main.face"] }, files: [{ name: "main.face", source: SPACE }] } } }).session.state.editable).toBe(true);
    }
  });

  it("resets the simulation when the environment changes with the modules", () => {
    const { session } = createSession(SPACE);
    session.commands.step();
    session.commands.step();
    session.commands.setModuleEnabled("space-age", false);
    expect(session.state.simulation.tick).toBe(0);
  });
});

describe("picker data and completion", () => {
  it("offers the picker tree of the enabled modules in game order", () => {
    const all = new CatalogService(catalog, ALL).picker();
    const base = new CatalogService(catalog, ["base"]).picker();
    expect(all.map((group) => group.group.name)).toEqual(["logistics", "production", "intermediate-products", "space", "combat", "fluids", "signals", "enemies", "environment", "other"]);
    expect(base.map((group) => group.group.name)).not.toContain("space");
    const names = (tree: typeof all): Set<string> => new Set(tree.flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.map((entry) => entry.key))));
    expect(names(all).has("item:carbon-fiber")).toBe(true);
    expect(names(base).has("item:carbon-fiber")).toBe(false);
    // The wildcards are part of the tree; the picker filters them per slot.
    expect(all.flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals)).filter((entry) => entry.wildcard).map((entry) => entry.wildcard).sort()).toEqual(["anything", "each", "everything"]);
  });

  it("completes keywords, properties, enum values, terminals and catalog signals of enabled modules", () => {
    const labels = (source: string, marker: string, modules: readonly string[] = ALL): string[] => {
      const offset = source.indexOf(marker) + marker.length;
      return completionCandidates(completionContext(analyze(source), offset), new CatalogService(catalog, modules)).map((candidate) => candidate.label);
    };
    const inConstant = labels('circuit "c" {\n  constant a at (0, 0) {\n    it\n  }\n}\n', "    it");
    expect(inConstant.slice(0, 3)).toEqual(["section", "description", "enabled"]);
    expect(inConstant).toEqual(expect.arrayContaining(["item:iron-plate", "item:carbon-fiber", "virtual:signal-A"]));
    expect(inConstant).not.toContain("each");
    expect(labels('circuit "c" {\n  constant a at (0, 0) {\n    it\n  }\n}\n', "    it", ["base"])).not.toContain("item:carbon-fiber");

    expect(labels('circuit "c" {\n  selector s at (0, 0) {\n    operation = \n  }\n}\n', "operation = ")).toEqual(expect.arrayContaining(["select", "count", "quality-filter"]));
    expect(labels('circuit "c" {\n  decider d at (0, 0) {\n    when \n  }\n}\n', "when ")).toEqual(expect.arrayContaining(["each", "anything", "everything", "virtual:signal-A"]));
    expect(labels('circuit "c" {\n  constant a at (0, 0) { }\n  lamp b at (0, 0) { }\n  wire red \n}\n', "wire red ")).toEqual(["a.out", "b.in"]);
    expect(labels('circuit "c" {\n  lamp b at (0, 0) { }\n  \n}\n', "{ }\n  ")).toEqual(expect.arrayContaining(["constant", "lamp", "wire"]));
    expect(labels('circuit "c" {\n  selector s at (0, 0) {\n    operation = quality-filter\n    quality = \n  }\n}\n', "quality = ")).toEqual(expect.arrayContaining(["uncommon", "legendary"]));
    expect(labels('circuit "c" {\n  // comment \n}\n', "comment")).toEqual([]);
  });
});

describe("simulation environment from the catalog", () => {
  it("orders signals by group, subgroup, order string and name, and quality variants by level", () => {
    const environment = createCatalogEnvironment(catalog, ALL);
    const ordered = (...keys: string[]): string[] => keys.map((key) => { const [kind, name, quality] = key.split(/[:@]/); return signal(kind as "item", name!, quality); }).sort((a, b) => environment.compareSignals(a, b)).map((id) => `${id.kind}:${id.name}${id.quality ? `@${id.quality}` : ""}`);
    // logistics < production < intermediate products < ... < signals (virtual).
    expect(ordered("virtual:signal-A", "item:iron-plate", "item:transport-belt", "item:assembling-machine-1")).toEqual(["item:transport-belt", "item:assembling-machine-1", "item:iron-plate", "virtual:signal-A"]);
    // Same subgroup: by order string, not by name (copper plate sorts after iron plate in the game).
    expect(ordered("item:copper-plate", "item:iron-plate")).toEqual(["item:iron-plate", "item:copper-plate"]);
    expect(ordered("virtual:signal-B", "virtual:signal-A", "virtual:signal-1", "virtual:signal-0")).toEqual(["virtual:signal-0", "virtual:signal-1", "virtual:signal-A", "virtual:signal-B"]);
    // Legendary is level 5, above epic (3); the same signal sorts by quality level.
    expect(ordered("item:iron-plate@legendary", "item:iron-plate@epic", "item:iron-plate", "item:iron-plate@uncommon")).toEqual(["item:iron-plate", "item:iron-plate@uncommon", "item:iron-plate@epic", "item:iron-plate@legendary"]);
    // Signals the catalog does not know come last, by key.
    expect(ordered("item:zzz", "item:aaa", "virtual:signal-A")).toEqual(["virtual:signal-A", "item:aaa", "item:zzz"]);
    expect(environment.qualities).toEqual(expect.arrayContaining([{ name: "normal", level: 0 }, { name: "legendary", level: 5 }]));
    // The order follows the picker for every signal of the enabled modules.
    const data = environmentData(catalog, ALL);
    const picked = new CatalogService(catalog, ALL).picker().flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.map((entry) => entry.key)));
    const position = new Map(data.signalOrder!.map((key, index) => [key, index]));
    expect(picked.map((key) => position.get(key)!).every((value, index, list) => index === 0 || list[index - 1]! < value)).toBe(true);
  });

  it("provides stack sizes for the module set", () => {
    const withSpaceAge = createCatalogEnvironment(catalog, ALL);
    const base = createCatalogEnvironment(catalog, ["base"]);
    expect(withSpaceAge.stackSize(signal("item", "iron-plate"))).toBe(100);
    expect(withSpaceAge.stackSize(signal("item", "iron-plate", "rare"))).toBe(100);
    // Space Age changes the stack size of the space science pack.
    expect(base.stackSize(signal("item", "space-science-pack"))).toBe(2000);
    expect(withSpaceAge.stackSize(signal("item", "space-science-pack"))).toBe(200);
    expect(withSpaceAge.stackSize(signal("fluid", "water"))).toBeUndefined();
    expect(withSpaceAge.stackSize(signal("item", "no-such-thing"))).toBeUndefined();
    expect(base.stackSize(signal("item", "carbon-fiber"))).toBeUndefined();
  });

  it("derives rocket capacity from item weight and lift weight, and guards the unlimited value", () => {
    const enabled = new Set(ALL);
    expect(rocketLiftWeight(catalog, enabled)).toBe(1_000_000);
    // Without Space Age the engine reports 2^48: there is no capacity to compute.
    expect(catalog.constants.rocketSilos[0]!.liftWeight).toBe(UNLIMITED_LIFT_WEIGHT);
    expect(rocketLiftWeight(catalog, new Set(["base"]))).toBeUndefined();

    expect(rocketCapacityOf(1000, 1_000_000)).toBe(1000);
    expect(rocketCapacityOf(3000, 1_000_000)).toBe(333);
    expect(rocketCapacityOf(10_000_000, 1_000_000)).toBe(0);
    expect(rocketCapacityOf(0, 1_000_000)).toBeUndefined();
    expect(rocketCapacityOf(undefined, 1_000_000)).toBeUndefined();
    expect(rocketCapacityOf(1000, undefined)).toBeUndefined();

    const withSpaceAge = createCatalogEnvironment(catalog, ALL);
    expect(withSpaceAge.rocketCapacity(signal("item", "iron-plate"))).toBe(1000);
    expect(withSpaceAge.rocketCapacity(signal("item", "carbon-fiber"))).toBe(500);
    expect(withSpaceAge.rocketCapacity(signal("item", "rocket-silo"))).toBe(0);
    // Weightless items (remotes, wires) get no number instead of infinity.
    expect(withSpaceAge.rocketCapacity(signal("item", "copper-wire"))).toBeUndefined();
    expect(withSpaceAge.rocketCapacity(signal("virtual", "signal-A"))).toBeUndefined();
    const base = createCatalogEnvironment(catalog, ["base"]);
    expect(base.rocketCapacity(signal("item", "iron-plate"))).toBeUndefined();
    expect(Object.values(environmentData(catalog, ["base"]).rocketCapacities!)).toEqual([]);
    expect(Object.values(environmentData(catalog, ALL).rocketCapacities!).every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
  });

  it("feeds the selector's stack-size and rocket-capacity modes through the session", () => {
    const source = (operation: string): string => `circuit "c" {\n  constant c at (0, 0) { item:iron-plate = 7  item:space-science-pack = 1 }\n  selector s at (300, 0) { operation = ${operation} }\n  wire red c.out <-> s.in\n}\n`;
    const output = (operation: string, modules?: readonly string[]): string | undefined => {
      const { session } = createSession(source(operation));
      for (const name of ["space-age", "quality", "recycler", "elevated-rails"]) if (modules && !modules.includes(name)) session.commands.setModuleEnabled(name, false);
      session.commands.step();
      return session.state.simulation.entityStatus.get(idOf(session, "s"))?.label;
    };
    expect(output("stack-size")).toBe("iron-plate 100, space-science-pack 200");
    expect(output("stack-size", ["base"])).toBe("iron-plate 100, space-science-pack 2000");
    expect(output("rocket-capacity")).toBe("iron-plate 1000, space-science-pack 1000");
    expect(output("rocket-capacity", ["base"])).toBe("no output");
  });

  it("is the environment the engine accepts", () => {
    const environment = createCatalogEnvironment(catalog, ["base", "space-age"]);
    const circuit = analyze('circuit "c" {\n  constant c at (0, 0) { item:iron-plate = 1 }\n}\n').circuit!;
    const simulation = createSimulation(compile(circuit, environment), { environment });
    expect(simulation.snapshot().entities[circuit.entities[0]!.id]!.output).toMatchObject([{ key: "item:iron-plate", value: 1 }]);
  });
});
