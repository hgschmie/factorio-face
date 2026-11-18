// What the user hid of a module in the settings of the application: no path offers it (signal picker, completion, entity
// selector with its search, completion of declaration words), and nothing else knows it: a project that uses it is valid,
// without a warning, drawn, simulated and exported, and "Entities in use" lists it. With the built-in data and with data read
// from a game, whose mods have dialogs like the game's own modules.
import { createCatalog, loadStandardCatalog, STANDARD_CATALOG_VERSION, type CatalogData, type PickerGroup } from "@face/catalog";
import { analyze, completionContext } from "@face/language";
import { entityTable, signal } from "@face/model";
import { afterEach, describe, expect, it } from "vitest";
import type { HiddenModuleItems } from "../../../desktop/src/ipc.ts";
import { entriesInUse, searchEntries, type EntityRegistry } from "../../src/entities/registry.ts";
import { applyData } from "../../src/gameData/dataInUse.ts";
import { CatalogService } from "../../src/session/catalogService.ts";
import { completionCandidates } from "../../src/session/completion.ts";
import { hiddenItems } from "../../src/settings/hiddenItems.ts";
import { MOD, MOD_ENTITY, MOD_SIGNAL, MODDED_MODULES, moddedData } from "../fixtures/moddedData.ts";
import { createSession, EMPTY_SOURCE, fakeDesktop, project } from "./helpers.ts";

const catalog = loadStandardCatalog();
const ALL = ["base", "elevated-rails", "recycler", "quality", "space-age"];
const BASE: HiddenModuleItems = { module: "base", signals: ["item:wooden-chest", "virtual:signal-A"], entities: ["wooden-chest", "small-lamp"] };
const SPACE: HiddenModuleItems = { module: "space-age", signals: ["item:carbon-fiber"], entities: ["turbo-transport-belt"] };

const pickerKeys = (tree: readonly PickerGroup[]): string[] => tree.flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.map((entry) => entry.key)));
const tiles = (registry: EntityRegistry): string[] => registry.groups.flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.entries.map((entry) => entry.prototype)));
const found = (registry: EntityRegistry, text: string): string[] => searchEntries(registry.groups, text).flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.entries.map((entry) => entry.prototype)));
const completions = (service: CatalogService, text: string): string[] => completionCandidates(completionContext(analyze(text.replace("|", "")), text.indexOf("|")), service).map((candidate) => candidate.label);
const SIGNAL_SLOT = 'circuit "c" {\n  constant-combinator a at (0, 0) {\n    |\n  }\n}\n';
const CONDITION_SLOT = 'circuit "c" {\n  decider-combinator d at (0, 0) {\n    when |\n  }\n}\n';
const MEMBER_SLOT = 'circuit "c" {\n  small-lamp b at (0, 0) { }\n  |\n}\n';

/** A circuit that uses what `BASE` hides: the chest, the lamp, and both signals. */
const USES_HIDDEN = `circuit "Uses hidden" {
    wooden-chest box at (40, 80) {
    }

    constant-combinator source at (300, 80) {
        item:wooden-chest = 5
        virtual:signal-A = 1
    }

    small-lamp light at (560, 80) {
        when virtual:signal-A > 0
    }

    wire red source.out <-> light.in
}
`;

afterEach(() => applyData({ source: { kind: "built-in", version: STANDARD_CATALOG_VERSION }, problem: null, mods: [], catalog: null, entities: null, icons: [] }));

describe("what is offered, with the built-in data", () => {
  const plain = new CatalogService(catalog, ALL);
  const service = new CatalogService(catalog, ALL, hiddenItems([BASE, SPACE]));

  it("the signal picker leaves out the hidden signals and has every other one, in its order", () => {
    const hidden = new Set([...BASE.signals, ...SPACE.signals]);
    expect(pickerKeys(service.picker())).toEqual(pickerKeys(plain.picker()).filter((key) => !hidden.has(key)));
    expect(pickerKeys(plain.picker())).toEqual(expect.arrayContaining([...hidden]));
    // The same groups and subgroups: none of them lost its last signal.
    expect(service.picker().map((group) => group.subgroups.map((subgroup) => subgroup.subgroup.name))).toEqual(plain.picker().map((group) => group.subgroups.map((subgroup) => subgroup.subgroup.name)));
    expect(service.picker()).toBe(service.picker());
    // After a change of what is hidden the services have the same picker as ones made for it.
    expect(pickerKeys(plain.withHidden(service.hidden).picker())).toEqual(pickerKeys(service.picker()));
  });

  it("a subgroup goes with its last signal, and a group with its last subgroup", () => {
    // "space-rocket" has one signal with these modules; the group "enemies" has one subgroup.
    const enemies = plain.picker().find((group) => group.group.name === "enemies")!.subgroups.flatMap((subgroup) => subgroup.signals);
    expect(enemies.length).toBeGreaterThan(0);
    const of = (module: string): string[] => enemies.filter((entry) => entry.modules[0] === module).map((entry) => entry.key);
    const thinned = new CatalogService(catalog, ALL, hiddenItems([{ module: "space-age", signals: ["item:space-platform-starter-pack", ...of("space-age")], entities: [] }, { module: "base", signals: of("base"), entities: [] }]));
    const subgroups = (tree: readonly PickerGroup[], group: string): string[] => tree.find((candidate) => candidate.group.name === group)?.subgroups.map((subgroup) => subgroup.subgroup.name) ?? [];
    expect(subgroups(plain.picker(), "space")).toContain("space-rocket");
    expect(subgroups(thinned.picker(), "space")).toEqual(subgroups(plain.picker(), "space").filter((name) => name !== "space-rocket"));
    expect(thinned.picker().map((group) => group.group.name)).toEqual(plain.picker().map((group) => group.group.name).filter((name) => name !== "enemies"));
  });

  it("the wildcards are no signals to hide: a settings file that names them changes nothing", () => {
    const wild = new CatalogService(catalog, ALL, hiddenItems([{ module: "base", signals: ["virtual:signal-each", "virtual:signal-anything", "virtual:signal-everything"], entities: [] }]));
    expect(pickerKeys(wild.picker())).toEqual(pickerKeys(plain.picker()));
    expect(completions(wild, CONDITION_SLOT)).toEqual(completions(plain, CONDITION_SLOT));
  });

  it("completion in the source leaves out the hidden signals", () => {
    expect(completions(plain, SIGNAL_SLOT)).toEqual(expect.arrayContaining(["item:wooden-chest", "virtual:signal-A", "item:carbon-fiber", "item:iron-chest"]));
    const offered = completions(service, SIGNAL_SLOT);
    expect(offered).toEqual(completions(plain, SIGNAL_SLOT).filter((label) => !["item:wooden-chest", "virtual:signal-A", "item:carbon-fiber"].includes(label)));
    expect(completions(service, CONDITION_SLOT)).toEqual(expect.arrayContaining(["each", "anything", "everything", "virtual:signal-B"]));
    expect(completions(service, CONDITION_SLOT)).not.toContain("virtual:signal-A");
    expect(service.selectableSignals().map((entry) => `${entry.id.kind}:${entry.id.name}`)).not.toEqual(expect.arrayContaining(["item:wooden-chest"]));
    expect(service.selectableSignals()).toHaveLength(plain.selectableSignals().length - 3);
  });

  it("the entity selector leaves the hidden entities out of its tabs, its count and its search", () => {
    const [registry, all] = [service.entities(), plain.entities()];
    const hidden = [...BASE.entities, ...SPACE.entities];
    expect(tiles(registry)).toEqual(tiles(all).filter((prototype) => !hidden.includes(prototype)));
    expect(tiles(all)).toEqual(expect.arrayContaining(hidden));
    expect(registry.entries).toHaveLength(all.entries.length - hidden.length);
    for (const prototype of hidden) expect([prototype, registry.offers(prototype), registry.groupOf(prototype)]).toEqual([prototype, false, undefined]);
    expect([found(all, "wooden"), found(registry, "wooden")]).toEqual([["wooden-chest"], []]);
    expect([found(all, "chest").includes("iron-chest"), found(registry, "chest").includes("iron-chest"), found(registry, "chest").includes("wooden-chest")]).toEqual([true, true, false]);
    expect(found(registry, "Lamp")).toEqual([]);
    // The tabs are those of the game all the same, and the first row is as it was.
    expect(registry.groups.map((group) => group.name)).toEqual(all.groups.map((group) => group.name));
    expect(registry.pinned).toEqual(all.pinned);
  });

  it("the editor still knows a hidden entity: its entry, its place in the game's order, and that it is in use", () => {
    const registry = service.entities();
    expect(registry.entry("wooden-chest")).toMatchObject({ prototype: "wooden-chest", label: "Wooden chest" });
    expect(registry.position("wooden-chest")).toBe(plain.entities().position("wooden-chest"));
    const used = [{ prototype: "iron-chest" }, { prototype: "small-lamp" }, { prototype: "wooden-chest" }, { prototype: "decider-combinator" }];
    expect(entriesInUse(registry, used).map((entry) => entry.prototype)).toEqual(entriesInUse(plain.entities(), used).map((entry) => entry.prototype));
    expect(entriesInUse(registry, used).map((entry) => entry.prototype)).toEqual(["wooden-chest", "iron-chest", "small-lamp"]);
  });

  it("completion of the word of a declaration leaves out the hidden entities", () => {
    expect(completions(plain, MEMBER_SLOT)).toEqual(expect.arrayContaining(["wooden-chest", "small-lamp", "turbo-transport-belt"]));
    expect(completions(service, MEMBER_SLOT)).toEqual(completions(plain, MEMBER_SLOT).filter((label) => !["wooden-chest", "small-lamp", "turbo-transport-belt"].includes(label)));
    expect([service.offersPrototype("wooden-chest"), service.offersPrototype("iron-chest"), plain.offersPrototype("wooden-chest")]).toEqual([false, true, true]);
  });

  it("the four combinators of the first row are always offered, whatever a settings file says", () => {
    const combinators = ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"];
    const forced = new CatalogService(catalog, ALL, hiddenItems([{ module: "base", signals: [], entities: combinators }]));
    expect(tiles(forced.entities())).toEqual(tiles(plain.entities()));
    expect(forced.entities().pinned.map((entry) => entry.prototype)).toEqual(combinators);
    expect(combinators.map((prototype) => forced.offersPrototype(prototype))).toEqual([true, true, true, true]);
    expect(completions(forced, MEMBER_SLOT)).toEqual(completions(plain, MEMBER_SLOT));
    expect(forced.hiddenCount("base")).toBe(0);
  });

  it("a module's entry hides what is of that module only", () => {
    // Stored under a module the signal and the entity are not of: nothing is hidden.
    const misplaced = new CatalogService(catalog, ALL, hiddenItems([{ module: "quality", signals: ["item:wooden-chest"], entities: ["wooden-chest"] }]));
    expect(pickerKeys(misplaced.picker())).toEqual(pickerKeys(plain.picker()));
    expect(misplaced.offersPrototype("wooden-chest")).toBe(true);
    expect(misplaced.hiddenCount("quality")).toBe(0);
  });

  it("nothing else about a hidden signal or entity changes", () => {
    for (const id of [signal("item", "wooden-chest"), signal("virtual", "signal-A"), signal("item", "carbon-fiber", "rare")]) {
      expect(service.describe(id)).toEqual(plain.describe(id));
      expect(service.status(id)).toBe("known");
      expect(service.signalModulesOff(id)).toEqual([]);
    }
    expect(service.entityWarning("wooden-chest")).toBeUndefined();
    expect(service.prototypes.switchedOff("turbo-transport-belt")).toEqual([]);
    expect(service.modules.map(({ name, signalCount, entityCount, enabled }) => [name, signalCount, entityCount, enabled])).toEqual(plain.modules.map(({ name, signalCount, entityCount, enabled }) => [name, signalCount, entityCount, enabled]));
    expect([service.qualities, service.speakerInstruments]).toEqual([plain.qualities, plain.speakerInstruments]);
  });
});

describe("what the dialog of a module lists", () => {
  const service = new CatalogService(catalog, ALL, hiddenItems([BASE, SPACE]));
  const plain = new CatalogService(catalog, ALL);

  it("has the module's signals as the picker offers them and its entities as the selector does, hidden or not", () => {
    const { signals, entities } = service.items("base");
    const offered = plain.picker().flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals));
    expect(signals.map((item) => item.key)).toEqual(offered.filter((entry) => entry.modules[0] === "base" && !entry.wildcard).map((entry) => entry.key));
    expect(signals.slice(0, 3)).toEqual([
      { key: "item:wooden-chest", label: "Wooden chest", icon: "item/wooden-chest" },
      { key: "item:iron-chest", label: "Iron chest", icon: "item/iron-chest" },
      { key: "item:steel-chest", label: "Steel chest", icon: "item/steel-chest" },
    ]);
    expect(entities.slice(0, 3)).toEqual([{ key: "wooden-chest", label: "Wooden chest" }, { key: "iron-chest", label: "Iron chest" }, { key: "steel-chest", label: "Steel chest" }]);
    const COMBINATORS = ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"];
    expect(entities.map((item) => item.key)).toEqual(tiles(plain.entities()).filter((prototype) => entityTable().byName.get(prototype)!.modules[0] === "base" && !COMBINATORS.includes(prototype)));
    // What is hidden makes no difference to the list, and neither service makes it twice.
    expect(service.items("base")).toEqual(plain.items("base"));
    expect(service.items("base")).toBe(service.items("base"));
  });

  it("has no wildcard, nothing the game hides, and none of the four combinators of the first row", () => {
    const keys = service.items("base").signals.map((item) => item.key);
    for (const key of ["virtual:signal-each", "virtual:signal-anything", "virtual:signal-everything", "quality:quality-unknown", "entity:wooden-chest"]) expect(keys, key).not.toContain(key);
    // The picker offers the normal quality once the Quality module is on, and it is a signal of the base game: the list has it then.
    expect([keys.includes("quality:normal"), new CatalogService(catalog, ["base"]).items("base").signals.some((item) => item.key === "quality:normal")]).toEqual([true, false]);
    const entities = service.items("base").entities.map((item) => item.key);
    for (const prototype of ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"]) expect(entities).not.toContain(prototype);
    expect(entities).toEqual(expect.arrayContaining(["small-lamp", "programmable-speaker", "big-electric-pole"]));
  });

  it("lists every module of the game, and a module that is switched off as if it were on", () => {
    expect(ALL.map((name) => [name, service.items(name).signals.length, service.items(name).entities.length])).toEqual([["base", 576, 63], ["elevated-rails", 5, 0], ["recycler", 2, 1], ["quality", 8, 0], ["space-age", 289, 17]]);
    const baseOnly = new CatalogService(catalog, ["base"], hiddenItems([SPACE]));
    expect(baseOnly.modules.find((module) => module.name === "space-age")).toMatchObject({ enabled: false, hasItems: true });
    expect(baseOnly.items("space-age").signals.map((item) => item.key)).toEqual(service.items("space-age").signals.map((item) => item.key));
    expect(baseOnly.items("space-age").entities.map((item) => item.key)).toEqual(service.items("space-age").entities.map((item) => item.key));
    expect(baseOnly.items("space-age").signals.map((item) => item.key)).toContain("item:carbon-fiber");
    // Hidden while the module is off: it is not offered once the module is on.
    expect(baseOnly.hiddenCount("space-age")).toBe(2);
    expect(pickerKeys(new CatalogService(catalog, ALL, baseOnly.hidden).picker())).not.toContain("item:carbon-fiber");
    expect(service.items("no-such-module")).toEqual({ signals: [], entities: [] });
    expect(service.modules.map((module) => module.hasItems)).toEqual([true, true, true, true, true]);
  });

  it("counts for a row how many of its listed signals and entities are hidden", () => {
    expect([service.hiddenCount("base"), service.hiddenCount("space-age"), service.hiddenCount("quality"), service.hiddenCount("no-such-module")]).toEqual([4, 2, 0, 0]);
    // What is stored but not in the data in use does not count, and stays stored.
    const stale = new CatalogService(catalog, ALL, hiddenItems([{ module: "base", signals: ["item:gone-with-a-mod", "item:iron-chest"], entities: ["gone-machine"] }, { module: "absent-mod", signals: ["item:x"], entities: [] }]));
    expect([stale.hiddenCount("base"), stale.hiddenCount("absent-mod")]).toEqual([1, 0]);
    expect(stale.hiddenOf("base")).toEqual({ module: "base", signals: ["item:gone-with-a-mod", "item:iron-chest"], entities: ["gone-machine"] });
    expect(stale.hiddenOf("quality")).toEqual({ module: "quality", signals: [], entities: [] });
    expect(stale.hidden.entries.map((entry) => entry.module)).toEqual(["base", "absent-mod"]);
  });

  it("is handed on to the services with other things hidden, which have the same modules", () => {
    const listed = plain.items("space-age");
    const next = plain.withHidden(hiddenItems([SPACE]));
    expect(next.items("space-age")).toBe(listed);
    expect([next.enabled, next.requested, next.hiddenCount("space-age")]).toEqual([plain.enabled, plain.requested, 2]);
    expect(pickerKeys(next.picker())).not.toContain("item:carbon-fiber");
    expect(pickerKeys(plain.picker())).toContain("item:carbon-fiber");
  });
});

describe("a project that uses what is hidden", () => {
  it("is valid, has no warning, is simulated and exported, and lists the entities as in use", () => {
    const { session } = createSession(USES_HIDDEN, { hidden: [BASE] });
    const { catalog: view } = session.state;
    expect(session.state).toMatchObject({ diagnostics: [], editable: true, source: USES_HIDDEN });
    expect(session.state.circuit.entities.map((entity) => entity.prototype)).toEqual(["wooden-chest", "constant-combinator", "small-lamp"]);
    expect(view.describe(signal("item", "wooden-chest"))).toEqual({ status: "known", displayName: "Wooden chest", icon: "item/wooden-chest" });
    expect([view.entityWarning("wooden-chest"), view.entityWarning("small-lamp")]).toEqual([undefined, undefined]);
    expect(view.entities().offers("wooden-chest")).toBe(false);
    expect(entriesInUse(view.entities(), session.state.circuit.entities).map((entry) => entry.label)).toEqual(["Wooden chest", "Lamp"]);
    expect(pickerKeys(view.picker())).not.toContain("virtual:signal-A");

    session.commands.step();
    session.commands.step();
    const light = session.state.circuit.entities.find((entity) => entity.name === "light")!;
    expect(session.state.simulation.entityStatus.get(light.id)).toMatchObject({ lamp: { lit: true } });

    // The same circuit without anything hidden gives the same blueprint.
    session.commands.setDisplayMode("blueprint");
    session.commands.placeHere();
    const exported = session.commands.exportBlueprint();
    expect(exported).toMatchObject({ ok: true, warnings: [] });
    const other = createSession(session.state.source).session;
    expect(other.commands.exportBlueprint()).toEqual(exported);
    expect(session.state.diagnostics).toEqual([]);
  });

  it("can still place and edit a hidden entity by a command: only the offers are thinned out", () => {
    const { session } = createSession(EMPTY_SOURCE, { hidden: [BASE] });
    session.commands.placeEntity("wooden-chest", { x: 40, y: 80 });
    expect(session.state.circuit.entities.map((entity) => entity.prototype)).toEqual(["wooden-chest"]);
    expect(session.state.diagnostics).toEqual([]);
  });
});

describe("the setting in a session", () => {
  const view = (session: { readonly state: { readonly catalog: unknown } }): CatalogService => session.state.catalog as CatalogService;

  it("starts with what the settings of the application hold", () => {
    const { session } = createSession(USES_HIDDEN, { hidden: [BASE, SPACE] });
    expect(view(session).hidden.entries).toEqual([BASE, SPACE]);
    expect(view(session).hiddenCount("base")).toBe(4);
    expect(createSession(USES_HIDDEN).session.state.catalog.hiddenCount("base")).toBe(0);
  });

  it("applies a change at once, stores it, and is no change of the project", async () => {
    const desktop = fakeDesktop();
    const { session, notifications } = createSession(USES_HIDDEN, { api: desktop.api });
    const before = session.state;
    const version = session.document.version;
    expect(pickerKeys(before.catalog.picker())).toContain("item:wooden-chest");

    session.commands.setHiddenItems(BASE);
    expect(notifications()).toBe(1);
    expect(session.state.catalog).not.toBe(before.catalog);
    expect(pickerKeys(session.state.catalog.picker())).not.toContain("item:wooden-chest");
    expect(session.state.catalog.entities().offers("wooden-chest")).toBe(false);
    expect(session.state.catalog.hiddenOf("base")).toEqual(BASE);
    // Not part of the project, not undoable, and nothing is analyzed again.
    expect(session.state).toMatchObject({ canUndo: false, error: null, project: { dirty: false } });
    expect([session.document.version, session.state.diagnostics, session.state.circuit, session.state.project]).toEqual([version, before.diagnostics, before.circuit, before.project]);
    expect(session.state.circuit).toBe(before.circuit);
    await Promise.resolve();
    expect(desktop.hidden).toEqual([BASE]);

    // The next change of the module replaces its entry; another module has its own.
    const fewer = { module: "base", signals: ["virtual:signal-A"], entities: [] };
    session.commands.setHiddenItems(fewer);
    session.commands.setHiddenItems(SPACE);
    expect(view(session).hidden.entries).toEqual([fewer, SPACE]);
    expect(pickerKeys(session.state.catalog.picker())).toContain("item:wooden-chest");
    expect(session.state.catalog.entities().offers("wooden-chest")).toBe(true);
    await Promise.resolve();
    expect(desktop.hidden).toEqual([fewer, SPACE]);

    // Showing everything of a module again removes its entry.
    session.commands.setHiddenItems({ module: "base", signals: [], entities: [] });
    expect(view(session).hidden.entries).toEqual([SPACE]);
    await Promise.resolve();
    expect(desktop.hidden).toEqual([SPACE]);
  });

  it("holds for every project of the window: a new one, an opened one, other modules", async () => {
    const desktop = fakeDesktop();
    desktop.disk.set("/projects/other.faceproj", project(USES_HIDDEN, { modules: ["base"] }).data);
    const { session } = createSession(USES_HIDDEN, { api: desktop.api, hidden: [BASE] });
    await session.commands.newProject();
    expect(session.state.project.name).toBe("Untitled circuit");
    expect(pickerKeys(session.state.catalog.picker())).not.toContain("item:wooden-chest");
    expect(session.state.catalog.entities().offers("small-lamp")).toBe(false);
    await session.commands.loadProject("/projects/other.faceproj");
    expect(session.state).toMatchObject({ diagnostics: [], project: { path: "/projects/other.faceproj" } });
    expect(session.state.catalog.entities().offers("wooden-chest")).toBe(false);
    session.commands.setModuleEnabled("space-age", true);
    expect(session.state.catalog.hiddenCount("base")).toBe(4);
    expect(pickerKeys(session.state.catalog.picker())).not.toContain("virtual:signal-A");
  });

  it("keeps the choice for the window and says so when it cannot be stored", async () => {
    const desktop = fakeDesktop();
    desktop.hiddenError = "Too many hidden signals and entities (limit 200000)";
    const { session } = createSession(USES_HIDDEN, { api: desktop.api });
    session.commands.setHiddenItems(BASE);
    expect(session.state.error).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(session.state.error).toBe("What you hid could not be stored, so it holds only until the app is closed: Too many hidden signals and entities (limit 200000)");
    expect(session.state.catalog.hiddenCount("base")).toBe(4);
    expect(desktop.hidden).toEqual([]);
    // Without the desktop app there is nowhere to store it, and nothing to say.
    const browser = createSession(USES_HIDDEN).session;
    browser.commands.setHiddenItems(BASE);
    await Promise.resolve();
    expect(browser.state).toMatchObject({ error: null });
    expect(browser.state.catalog.hiddenCount("base")).toBe(4);
  });
});

describe("with data read from a game", () => {
  const MOD_HIDDEN: HiddenModuleItems = { module: MOD, signals: [`virtual:${MOD_SIGNAL}`], entities: [MOD_ENTITY] };
  const MODDED_CIRCUIT = `circuit "Modded" {\n    ${MOD_ENTITY} crate at (40, 80) {\n    }\n\n    constant-combinator source at (300, 80) {\n        virtual:${MOD_SIGNAL} = 1\n    }\n}\n`;

  it("a mod has a list like a module of the game, on or off", () => {
    const data = applyData(moddedData());
    const { session } = createSession(EMPTY_SOURCE, { data, project: project(EMPTY_SOURCE, { modules: ["base"] }) });
    const { catalog: view } = session.state;
    expect(view.modules.find((module) => module.name === MOD)).toMatchObject({ enabled: false, hasItems: true });
    expect(view.items(MOD)).toEqual({ signals: [{ key: `virtual:${MOD_SIGNAL}`, label: "Mod signal", icon: `virtual/${MOD_SIGNAL}` }], entities: [{ key: MOD_ENTITY, label: "Mod crate" }] });
    expect(view.items("base").signals).toHaveLength(576);
  });

  it("what is hidden of a mod is not offered when the mod is on, and a project that uses it has no warning", async () => {
    const data = applyData(moddedData());
    const desktop = fakeDesktop();
    const { session } = createSession(EMPTY_SOURCE, { data, api: desktop.api, project: project(MODDED_CIRCUIT, { modules: [...MODDED_MODULES] }) });
    const offered = (): unknown[] => {
      const { catalog: view } = session.state;
      return [pickerKeys(view.picker()).includes(`virtual:${MOD_SIGNAL}`), view.entities().offers(MOD_ENTITY), found(view.entities(), "crate"), (view as CatalogService).offersPrototype(MOD_ENTITY), completions(view as CatalogService, SIGNAL_SLOT).includes(`virtual:${MOD_SIGNAL}`)];
    };
    expect(offered()).toEqual([true, true, [MOD_ENTITY], true, true]);
    session.commands.setHiddenItems(MOD_HIDDEN);
    expect(offered()).toEqual([false, false, [], false, false]);
    expect(session.state.catalog.hiddenCount(MOD)).toBe(2);
    expect(session.state).toMatchObject({ diagnostics: [], editable: true, project: { dirty: false, modulesOff: [] } });
    expect(entriesInUse(session.state.catalog.entities(), session.state.circuit.entities).map((entry) => entry.prototype)).toEqual([MOD_ENTITY]);
    expect(session.state.catalog.describe(signal("virtual", MOD_SIGNAL))).toMatchObject({ status: "known", displayName: "Mod signal" });
    await Promise.resolve();
    expect(desktop.hidden).toEqual([MOD_HIDDEN]);

    // Switched off, the mod has its warnings as ever; they are about the module, not about what is hidden.
    session.commands.setModuleEnabled(MOD, false);
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["disabled-prototype", "disabled-signal"]);
    expect(session.state.catalog.hiddenCount(MOD)).toBe(2);
    session.commands.setModuleEnabled(MOD, true);
    session.commands.setHiddenItems({ module: MOD, signals: [], entities: [] });
    expect(offered()).toEqual([true, true, [MOD_ENTITY], true, true]);
  });

  it("a record that names several modules is in the list of its first one only, and hidden by that one's entry", () => {
    const game = moddedData();
    const signals = game.catalog!.signals;
    const shared = [{ name: "mod-first", displayName: "Mod first", order: "zy", subgroup: "virtual-signal", modules: [MOD, "space-age"] }, { name: "mod-second", displayName: "Mod second", order: "zx", subgroup: "virtual-signal", modules: ["space-age", MOD] }];
    const data: CatalogData = { ...game.catalog!, signals: { ...signals, virtual: [...signals.virtual!, ...shared] } };
    applyData({ ...game, catalog: data });
    const everything = [...MODDED_MODULES];
    const service = new CatalogService(createCatalog(data), everything, hiddenItems([{ module: MOD, signals: ["virtual:mod-first", "virtual:mod-second"], entities: [] }]));
    // In the game's order: by the order string, whatever the names are.
    expect(service.items(MOD).signals.map((item) => item.key)).toEqual(["virtual:mod-first", `virtual:${MOD_SIGNAL}`]);
    expect(service.items("space-age").signals.map((item) => item.key)).toContain("virtual:mod-second");
    expect(service.items("space-age").signals.map((item) => item.key)).not.toContain("virtual:mod-first");
    expect(service.hiddenCount(MOD)).toBe(1);
    expect([pickerKeys(service.picker()).includes("virtual:mod-first"), pickerKeys(service.picker()).includes("virtual:mod-second")]).toEqual([false, true]);
    // The row counts say how much a module brings, which is another question: both count for both.
    expect(service.modules.find((module) => module.name === MOD)).toMatchObject({ signalCount: 3 });
  });
});
