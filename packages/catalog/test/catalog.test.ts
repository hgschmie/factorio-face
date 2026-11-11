import { STANDARD_SIGNAL_KINDS, parseSignalKey, signal, signalKey, wildcardOf, wildcardSignal } from "@face/model";
import { describe, expect, it } from "vitest";
import {
  STANDARD_MODULES,
  availableQualities,
  availableSignals,
  catalogKey,
  dependentModules,
  disableModule,
  enableModule,
  findSignal,
  iconPath,
  isAvailable,
  loadStandardCatalog,
  pickerTree,
  requiredModules,
  resolveModules,
  resolveSignal,
  type CatalogSignal,
} from "../src/index.ts";

const catalog = loadStandardCatalog();
const ALL = [...STANDARD_MODULES];

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

function pickerSignals(enabled: readonly string[], options?: Parameters<typeof pickerTree>[2]): CatalogSignal[] {
  return pickerTree(catalog, enabled, options).flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals));
}

describe("standard catalog data (pinned to Factorio 2.1.24)", () => {
  it("records the game and the five modules with their dependencies", () => {
    expect(catalog.game.version).toBe("2.1.24");
    expect(catalog.modules.map((m) => m.name)).toEqual(ALL);
    expect(catalog.modules.every((m) => m.version === "2.1.24")).toBe(true);
    expect(Object.fromEntries(catalog.modules.map((m) => [m.name, m.requires]))).toEqual({
      base: [],
      "elevated-rails": ["base"],
      recycler: ["base"],
      quality: ["base", "recycler"],
      "space-age": ["base", "elevated-rails", "recycler"],
    });
    expect(catalog.modules.find((m) => m.name === "space-age")?.recommends).toEqual(["quality"]);
    expect(catalog.provenance.modSets).toHaveLength(8);
    expect(catalog.provenance.commands.join(" ")).toContain("--dump-data");
  });

  it("has the pinned number of signals per kind", () => {
    expect(catalog.signals).toHaveLength(2252);
    expect(countBy(catalog.signals, (s) => s.kind)).toEqual({ item: 343, fluid: 33, virtual: 155, entity: 1028, recipe: 664, "space-location": 8, "asteroid-chunk": 15, quality: 6 });
    expect(new Set(catalog.signals.map((s) => s.kind))).toEqual(new Set(STANDARD_SIGNAL_KINDS));
  });

  it("has the pinned number of signals per introducing module", () => {
    expect(countBy(catalog.signals, (s) => s.modules.join("+"))).toEqual({ base: 1218, "elevated-rails": 18, recycler: 229, quality: 14, "space-age": 771, "elevated-rails+recycler": 2 });
    expect(catalog.signals.filter((s) => s.removedBy).map((s) => s.key)).toEqual(["item:satellite", "recipe:satellite", "recipe:satellite-recycling"]);
  });

  it("has the pinned number of signals per module set", () => {
    const total = (enabled: string[]) => availableSignals(catalog, enabled).length;
    expect(total(["base"])).toBe(1218);
    expect(total(["base", "elevated-rails"])).toBe(1236);
    expect(total(["base", "recycler"])).toBe(1447);
    expect(total(["base", "recycler", "quality"])).toBe(1461);
    expect(total(["base", "elevated-rails", "recycler", "space-age"])).toBe(2235);
    expect(total(ALL)).toBe(2249);
    expect(countBy(availableSignals(catalog, ALL), (s) => s.kind)).toEqual({ item: 342, fluid: 33, virtual: 155, entity: 1028, recipe: 662, "space-location": 8, "asteroid-chunk": 15, quality: 6 });
    expect(countBy(availableSignals(catalog, ["base"]), (s) => s.kind)).toEqual({ item: 252, fluid: 19, virtual: 154, entity: 571, recipe: 217, "space-location": 2, "asteroid-chunk": 1, quality: 2 });
  });

  it("contains well-known signals of every module", () => {
    const expected: Record<string, string[]> = {
      base: ["item:iron-plate", "fluid:water", "virtual:signal-A", "virtual:signal-dot", "entity:small-biter", "recipe:advanced-oil-processing", "space-location:nauvis", "quality:normal"],
      "elevated-rails": ["item:rail-ramp", "item:rail-support", "entity:elevated-straight-rail"],
      recycler: ["item:recycler", "entity:recycler", "recipe:iron-gear-wheel-recycling"],
      quality: ["item:quality-module-3", "quality:legendary", "virtual:signal-any-quality"],
      "space-age": ["item:tungsten-plate", "item:carbon-fiber", "fluid:lava", "entity:big-demolisher", "recipe:scrap-recycling", "space-location:vulcanus", "asteroid-chunk:metallic-asteroid-chunk"],
    };
    for (const [module, keys] of Object.entries(expected)) {
      for (const key of keys) expect(catalog.signalsByKey.get(key)?.modules, key).toEqual([module]);
    }
    expect(catalog.signalsByKey.get("recipe:rail-ramp-recycling")?.modules).toEqual(["elevated-rails", "recycler"]);
  });

  it("gives every signal a unique canonical key, a display name, an icon and an existing subgroup", () => {
    expect(new Set(catalog.signals.map((s) => s.key)).size).toBe(catalog.signals.length);
    for (const entry of catalog.signals) {
      expect(entry.key).toBe(signalKey(entry.id));
      expect(parseSignalKey(entry.key), entry.key).toEqual(entry.id);
      expect(entry.displayName.length, entry.key).toBeGreaterThan(0);
      expect(entry.icon, entry.key).toMatch(/^[a-z-]+\/[A-Za-z0-9_.~+-]+$/);
      expect(entry.origin).toBe("standard");
      const subgroup = catalog.subgroupsByName.get(entry.subgroup);
      expect(subgroup, entry.key).toBeDefined();
      expect(catalog.groupsByName.has(subgroup?.group ?? ""), entry.key).toBe(true);
    }
    expect(catalog.groups.every((group) => group.displayName.length > 0 && group.icon === `group/${group.name}`)).toBe(true);
  });

  it("flags wildcards, special signals, parameters and placeholders", () => {
    const wildcards = catalog.signals.filter((s) => s.wildcard);
    expect(wildcards.map((s) => s.key).sort()).toEqual(["virtual:signal-anything", "virtual:signal-each", "virtual:signal-everything"]);
    for (const entry of catalog.signals) expect(entry.wildcard, entry.key).toBe(wildcardOf(entry.id));
    expect(findSignal(catalog, wildcardSignal("each"))).toMatchObject({ visibility: "wildcard", special: true, hidden: false, subgroup: "virtual-signal-special" });

    expect(catalog.signals.filter((s) => s.special).map((s) => s.name).sort()).toEqual(
      ["signal-anything", "signal-each", "signal-everything", "signal-fluid-parameter", "signal-fuel-parameter", "signal-item-parameter", "signal-signal-parameter", "signal-unknown"]);
    expect(countBy(catalog.signals, (s) => s.visibility)).toEqual({ normal: 879, hidden: 1316, parameter: 54, wildcard: 3 });
    expect(countBy(catalog.signals.filter((s) => s.parameter), (s) => s.kind)).toEqual({ item: 10, fluid: 10, entity: 10, recipe: 10, "asteroid-chunk": 10 });
    expect(catalog.signals.filter((s) => s.parameter).every((s) => /^parameter-\d$/.test(s.name) && s.visibility === "parameter")).toBe(true);
    for (const key of ["item:item-unknown", "fluid:fluid-unknown", "virtual:signal-unknown", "entity:entity-unknown", "recipe:recipe-unknown", "space-location:space-location-unknown", "asteroid-chunk:asteroid-chunk-unknown", "quality:quality-unknown"]) {
      expect(findSignal(catalog, key), key).toMatchObject({ hidden: true, visibility: "hidden" });
    }
  });

  it("keeps non-selectable signals with the reason they are not offered", () => {
    expect(findSignal(catalog, "entity:assembling-machine-1")).toMatchObject({ visibility: "hidden", hidden: false, placedBy: ["assembling-machine-1"], icon: "item/assembling-machine-1", prototype: "assembling-machine" });
    expect(findSignal(catalog, "recipe:iron-plate")).toMatchObject({ visibility: "hidden", hideFromSignalGui: true, icon: "item/iron-plate" });
    expect(findSignal(catalog, "recipe:advanced-oil-processing")).toMatchObject({ visibility: "normal", icon: "recipe/advanced-oil-processing" });
    expect(findSignal(catalog, "asteroid-chunk:metallic-asteroid-chunk")).toMatchObject({ visibility: "hidden", hideFromSignalGui: true, itemAlias: "metallic-asteroid-chunk" });
    expect(findSignal(catalog, "entity:small-biter")).toMatchObject({ visibility: "normal", prototype: "unit", subgroup: "enemies" });
  });

  it("records stack size and weight for every item", () => {
    const items = catalog.signals.filter((s) => s.kind === "item");
    for (const item of items) {
      expect(Number.isInteger(item.stackSize) && (item.stackSize ?? 0) >= 1, item.key).toBe(true);
      expect(typeof item.weight === "number" && item.weight >= 0, item.key).toBe(true);
    }
    expect(catalog.signals.some((s) => s.kind !== "item" && (s.stackSize !== undefined || s.weight !== undefined))).toBe(false);
    expect(findSignal(catalog, "item:iron-plate")).toMatchObject({ stackSize: 100, weight: 1000 });
    expect(findSignal(catalog, "item:electronic-circuit")).toMatchObject({ stackSize: 200, weight: 500 });
    expect(catalog.constants).toMatchObject({ defaultItemWeight: 100, rocketLiftWeight: 1000000 });
    expect(catalog.constants.rocketSilos.map((silo) => silo.name)).toEqual(["rocket-silo"]);
  });

  it("lists the qualities in game order with levels", () => {
    expect(catalog.qualities.map((q) => [q.name, q.level])).toEqual([["normal", 0], ["uncommon", 1], ["rare", 2], ["epic", 3], ["legendary", 5], ["quality-unknown", 0]]);
    expect(availableQualities(catalog, ALL).filter((q) => !q.hidden).map((q) => q.next)).toEqual(["uncommon", "rare", "epic", "legendary", undefined]);
    expect(availableQualities(catalog, ["base"]).map((q) => [q.name, q.hidden])).toEqual([["normal", true], ["quality-unknown", true]]);
    expect(catalog.qualities.every((q) => /^#[0-9a-f]{6}$/.test(q.color) && q.icon === `quality/${q.name}`)).toBe(true);
    expect(findSignal(catalog, "quality:legendary")).toMatchObject({ level: 5, subgroup: "qualities" });
  });
});

describe("lookup", () => {
  it("finds signals by id or key and ignores quality", () => {
    const plate = findSignal(catalog, signal("item", "iron-plate"));
    expect(plate?.displayName).toBe("Iron plate");
    expect(findSignal(catalog, "item:iron-plate@legendary")).toBe(plate);
    expect(findSignal(catalog, signal("item", "iron-plate", "rare"))).toBe(plate);
    expect(catalogKey("item:iron-plate@rare")).toBe("item:iron-plate");
    expect(findSignal(catalog, "item:no-such-thing")).toBeUndefined();
    expect(findSignal(catalog, "not a key")).toBeUndefined();
    expect(findSignal(catalog, "custom:mine")).toBeUndefined();
  });

  it("applies the enabled modules when given", () => {
    expect(findSignal(catalog, "item:tungsten-plate", ["base"])).toBeUndefined();
    expect(findSignal(catalog, "item:tungsten-plate", ALL)?.modules).toEqual(["space-age"]);
    expect(findSignal(catalog, "item:satellite", ["base"])?.displayName).toBe("Satellite");
    expect(findSignal(catalog, "item:satellite", ALL)).toBeUndefined();
  });

  it("resolves attributes that Space Age and Quality change on base signals", () => {
    expect(findSignal(catalog, "item:space-science-pack", ["base"])?.stackSize).toBe(2000);
    expect(findSignal(catalog, "item:space-science-pack", ALL)?.stackSize).toBe(200);
    expect(findSignal(catalog, "item:rocket-silo", ["base"])?.subgroup).toBe("space-related");
    expect(findSignal(catalog, "item:rocket-silo", ALL)?.subgroup).toBe("space-interactors");
    expect(findSignal(catalog, "space-location:nauvis", ALL)?.subgroup).toBe("planets");
    expect(findSignal(catalog, "quality:normal", ["base"])).toMatchObject({ hidden: true, visibility: "hidden" });
    const normal = findSignal(catalog, "quality:normal", ["base", "recycler", "quality"]);
    expect(normal).toMatchObject({ hidden: false, visibility: "normal", next: "uncommon" });
    const stored = catalog.signalsByKey.get("quality:normal");
    expect(stored && resolveSignal(stored, ["base"])).toBe(stored);
  });

  it("resolves icon paths relative to an icon root", () => {
    const plate = findSignal(catalog, "item:iron-plate");
    expect(plate && iconPath(plate)).toBe("item/iron-plate.png");
    expect(plate && iconPath(plate, "assets/icons/")).toBe("assets/icons/item/iron-plate.png");
    expect(iconPath("group/logistics", "icons")).toBe("icons/group/logistics.png");
  });
});

describe("module enablement", () => {
  const modules = catalog.modules;

  it("resolves transitive requirements", () => {
    expect(requiredModules(modules, "space-age")).toEqual(["base", "elevated-rails", "recycler", "space-age"]);
    expect(requiredModules(modules, "space-age", true)).toEqual(ALL);
    expect(requiredModules(modules, "quality")).toEqual(["base", "recycler", "quality"]);
    expect(() => requiredModules(modules, "krastorio")).toThrow(/Unknown module/);
  });

  it("reports missing dependencies, unknown names and disabled recommendations", () => {
    expect(resolveModules(modules, ALL)).toEqual({ enabled: ALL, unknown: [], missing: [], recommended: [], valid: true });
    expect(resolveModules(modules, ["space-age", "base"])).toEqual({
      enabled: ["base", "space-age"],
      unknown: [],
      missing: [{ module: "space-age", requires: ["elevated-rails", "recycler"] }],
      recommended: [{ module: "space-age", recommends: ["quality"] }],
      valid: false,
    });
    expect(resolveModules(modules, ["quality"]).missing).toEqual([{ module: "quality", requires: ["base", "recycler"] }]);
    expect(resolveModules(modules, ["base", "krastorio", "base"])).toMatchObject({ enabled: ["base"], unknown: ["krastorio"], valid: false });
    expect(resolveModules(modules, ["base", "elevated-rails", "recycler", "space-age"])).toMatchObject({ valid: true, recommended: [{ module: "space-age", recommends: ["quality"] }] });
  });

  it("enables a module with its dependencies", () => {
    expect(enableModule(modules, ["base"], "space-age")).toEqual({ enabled: ["base", "elevated-rails", "recycler", "space-age"], changed: ["elevated-rails", "recycler", "space-age"] });
    expect(enableModule(modules, [], "space-age", { withRecommended: true })).toEqual({ enabled: ALL, changed: ALL });
    expect(enableModule(modules, ALL, "quality")).toEqual({ enabled: ALL, changed: [] });
  });

  it("reports and removes dependents when disabling", () => {
    expect(dependentModules(modules, ALL, "recycler")).toEqual(["quality", "space-age"]);
    expect(dependentModules(modules, ALL, "quality")).toEqual([]);
    expect(dependentModules(modules, ["base", "elevated-rails"], "base")).toEqual(["elevated-rails"]);
    expect(disableModule(modules, ALL, "recycler")).toEqual({ enabled: ["base", "elevated-rails"], changed: ["recycler", "quality", "space-age"] });
    expect(disableModule(modules, ALL, "quality")).toEqual({ enabled: ["base", "elevated-rails", "recycler", "space-age"], changed: ["quality"] });
    expect(disableModule(modules, ["base"], "quality")).toEqual({ enabled: ["base"], changed: [] });
  });

  it("yields a valid module set after every enable and disable", () => {
    for (const name of ALL) {
      expect(resolveModules(modules, enableModule(modules, [], name).enabled).valid, `enable ${name}`).toBe(true);
      expect(resolveModules(modules, disableModule(modules, ALL, name).enabled).valid, `disable ${name}`).toBe(true);
    }
  });

  it("derives availability from module provenance", () => {
    const satellite = catalog.signalsByKey.get("item:satellite");
    expect(satellite && isAvailable(satellite, new Set(["base"]))).toBe(true);
    expect(satellite && isAvailable(satellite, new Set(ALL))).toBe(false);
    expect(availableSignals(catalog, []).length).toBe(0);
    expect(availableSignals(catalog, ALL, { kinds: ["fluid"] })).toHaveLength(33);
    expect(availableSignals(catalog, ["base"], { visibility: ["wildcard"] }).map((s) => s.name)).toEqual(["signal-anything", "signal-each", "signal-everything"]);
  });
});

describe("picker tree", () => {
  it("orders groups like the in-game dialog and drops empty ones", () => {
    expect(pickerTree(catalog, ALL).map((g) => g.group.name)).toEqual(["logistics", "production", "intermediate-products", "space", "combat", "fluids", "signals", "enemies", "environment", "other"]);
    expect(pickerTree(catalog, ["base"]).map((g) => g.group.name)).toEqual(["logistics", "production", "intermediate-products", "combat", "fluids", "signals", "enemies", "environment", "other"]);
    expect(pickerTree(catalog, ALL).find((g) => g.group.name === "other")?.group.displayName).toBe("Unsorted");
  });

  it("contains exactly the selectable signals of the module set", () => {
    expect(pickerSignals(ALL)).toHaveLength(882);
    expect(pickerSignals(["base"])).toHaveLength(578);
    expect(pickerSignals(ALL).every((s) => s.visibility === "normal" || s.visibility === "wildcard")).toBe(true);
    expect(pickerSignals(ALL, { wildcards: false })).toHaveLength(879);
    expect(pickerSignals(ALL, { parameters: true })).toHaveLength(882 + 54);
    expect(pickerSignals(ALL, { parameters: true, hidden: true })).toHaveLength(2249);
    expect(pickerSignals(ALL, { kinds: ["fluid"] }).map((s) => s.kind)).toEqual(Array(22).fill("fluid"));
    expect(new Set(pickerSignals(ALL).map((s) => s.key)).size).toBe(882);
  });

  it("sorts subgroups and signals by their order strings", () => {
    for (const group of pickerTree(catalog, ALL, { parameters: true, hidden: true })) {
      const subgroupOrders = group.subgroups.map((s) => s.subgroup.order);
      expect(subgroupOrders, group.group.name).toEqual([...subgroupOrders].sort());
      for (const { subgroup, signals } of group.subgroups) {
        expect(subgroup.group).toBe(group.group.name);
        const orders = signals.map((s) => s.order);
        expect(orders, subgroup.name).toEqual([...orders].sort());
      }
    }
  });

  it("lays out the signals tab as in the game", () => {
    const signals = pickerTree(catalog, ALL).find((g) => g.group.name === "signals");
    expect(signals?.subgroups.map((s) => s.subgroup.name)).toEqual(
      ["virtual-signal-special", "virtual-signal-number", "virtual-signal-letter", "virtual-signal-punctuation", "virtual-signal-math", "virtual-signal-color", "virtual-signal", "shapes", "arrows", "arrows-misc", "pictographs"]);
    const names = (subgroup: string) => signals?.subgroups.find((s) => s.subgroup.name === subgroup)?.signals.map((s) => s.name);
    expect(names("virtual-signal-special")).toEqual(["signal-everything", "signal-each", "signal-anything"]);
    expect(names("virtual-signal-number")).toEqual(["signal-0", "signal-1", "signal-2", "signal-3", "signal-4", "signal-5", "signal-6", "signal-7", "signal-8", "signal-9"]);
    expect(names("virtual-signal-letter")?.slice(0, 26).join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `signal-${letter}`).join(""));
    expect(names("virtual-signal-color")).toEqual(["signal-red", "signal-green", "signal-blue", "signal-yellow", "signal-pink", "signal-cyan", "signal-white", "signal-grey", "signal-black"]);
  });

  it("places module content into the tree", () => {
    const tree = pickerTree(catalog, ALL);
    const names = (group: string, subgroup: string) => tree.find((g) => g.group.name === group)?.subgroups.find((s) => s.subgroup.name === subgroup)?.signals.map((s) => s.key);
    expect(names("space", "planets")).toEqual(["nauvis", "vulcanus", "gleba", "fulgora", "aquilo", "solar-system-edge", "shattered-planet"].map((name) => `space-location:${name}`));
    expect(names("other", "qualities")).toEqual(["quality:normal", "quality:uncommon", "quality:rare", "quality:epic", "quality:legendary", "virtual:signal-any-quality"]);
    expect(names("fluids", "fluid")?.slice(0, 3)).toEqual(["fluid:water", "fluid:steam", "fluid:crude-oil"]);
    expect(names("production", "module")).toContain("item:quality-module");
    expect(pickerSignals(["base"]).some((s) => s.kind === "quality")).toBe(false);
    expect(pickerSignals(ALL, { parameters: true }).filter((s) => s.subgroup === "parameters")).toHaveLength(54);
  });
});
