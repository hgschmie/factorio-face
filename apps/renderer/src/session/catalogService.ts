// Catalog services for one set of enabled modules: signal status for the language, display data for the views, the picker
// tree and the module list of the project settings. Instances are immutable; a module change creates a new one.
//
// What is offered follows two rules, applied side by side in one place per offer (`picker`, `selectableSignals`, `entities`,
// `offersPrototype`): the modules of the project, and what the user hid of a module in the settings of the application
// (`HiddenItems`). The second one changes nothing but the offers: status, names, icons and warnings do not know it.
//
// The enabled modules are the project's list, whatever data is in use: the built-in data has the game's five modules, data
// read from the user's game has the modules of that game and its mods. `base` is on in any case.
import {
  availableQualities, availableSignals, BASE_MODULE, dependentModules, disableModule, enableModule, findSignal, isAvailable, isGameModule, listedModules, namedModules, pickerTree, resolveModules,
  resolveSignal, speakerInstruments,
  type Catalog, type CatalogSignal, type ModuleInfo, type PickerGroup, type SpeakerInstrumentInfo,
} from "@face/catalog";
import { disabledPrototypeMessage, type PrototypeResolver, type SignalResolver } from "@face/language";
import { entityTable, isPrototypeName, NORMAL_QUALITY, signalKey, type EntityPrototype, type PrototypeName, type SignalId, type SpeakerInstrument } from "@face/model";
import type { HiddenModuleItems } from "../../../desktop/src/ipc.ts";
import { entityRegistry, PINNED_KINDS, standardPrototype, type EntityRegistry } from "../entities/registry.ts";
import { NOTHING_HIDDEN, type HiddenItems } from "../settings/hiddenItems.ts";
import type { CatalogView, ModuleItem, ModuleItems, ModuleView, NotOfferedSignal, QualityOption, SignalInfo, SignalStatus } from "../workbench/controller.ts";

const NONE: readonly string[] = [];
const NO_ITEMS: ModuleItems = { signals: [], entities: [] };

interface Lookup {
  readonly info: SignalInfo;
  /** The modules of the signal, and of the quality it names, that are switched off. */
  readonly off: readonly string[];
}

export class CatalogService implements CatalogView, SignalResolver {
  readonly gameVersion: string;
  /** Enabled modules of the list, in catalog order. */
  readonly enabled: readonly string[];
  readonly unknownModules: readonly string[];
  readonly modules: readonly ModuleView[];
  readonly otherMods: number;
  readonly qualities: readonly QualityOption[];
  /** The instruments of the speaker with their notes for these modules: with display names, and by name only as the language takes them. */
  readonly speakerInstruments: readonly SpeakerInstrumentInfo[];
  readonly instruments: readonly SpeakerInstrument[];
  /** `PrototypeResolver` of the language: an entity of a module that is switched off gets a warning that names the module. */
  readonly prototypes: PrototypeResolver = { switchedOff: (prototype) => this.prototypeModulesOff(prototype).map((name) => this.titleOf(name)) };
  /** What the project switches (`listedModules`): the game's modules and the mods that add a signal or a wired entity. */
  private readonly listed: readonly ModuleInfo[];
  /** Names of the project file that are not in that list, kept at its end: what the catalog does not know, and a mod that adds nothing. */
  private readonly kept: readonly string[];
  private readonly active: ReadonlySet<string>;
  private readonly titles: ReadonlyMap<string, string>;
  private readonly lookups = new Map<string, Lookup>();
  /**
   * What does not depend on what the user hid, so that `withHidden` hands it on: the picker and the selector of the modules, the signals of the modules that are
   * switched off, and what the dialog of a module lists.
   */
  private made: { tree?: readonly PickerGroup[]; registry?: EntityRegistry; switchedOff?: readonly NotOfferedSignal[]; readonly listings: Map<string, ModuleItems> } = {
    listings: new Map(),
  };
  private offered: readonly PickerGroup[] | undefined;
  private unoffered: readonly NotOfferedSignal[] | undefined;
  private registry: EntityRegistry | undefined;
  /** The four entities of the selector's first row: always offered, so the user's rule passes them over. */
  private readonly pinned: ReadonlySet<string> = new Set(PINNED_KINDS.map(standardPrototype));

  /**
   * `requested` is the module list of the project file; names the list of the data does not have are reported, never dropped by this class.
   * `hidden` is what the user hid on this machine.
   */
  constructor(readonly catalog: Catalog, readonly requested: readonly string[], readonly hidden: HiddenItems = NOTHING_HIDDEN) {
    const table = entityTable();
    this.listed = listedModules(catalog.modules, namedModules(table.entities, namedModules(catalog.signals)));
    const base = this.listed.some((module) => module.name === BASE_MODULE);
    const resolution = resolveModules(this.listed, base ? [BASE_MODULE, ...requested] : requested);
    this.gameVersion = catalog.game.version;
    this.enabled = resolution.enabled;
    this.kept = resolution.unknown;
    this.titles = new Map(catalog.modules.map((module) => [module.name, module.title]));
    this.unknownModules = this.kept.filter((name) => !this.titles.has(name));
    this.otherMods = catalog.modules.length - this.listed.length;
    this.active = new Set(resolution.enabled);
    const qualities = availableQualities(catalog, this.active).filter((quality) => !quality.hidden);
    // Without the quality module only "normal" exists, and a choice of one is no choice.
    this.qualities = qualities.length > 1 ? qualities.map(({ name, displayName, icon, color }) => ({ name, displayName, icon, color })) : [];
    this.speakerInstruments = speakerInstruments(catalog, this.active);
    this.instruments = this.speakerInstruments.map((instrument) => ({ name: instrument.name, notes: instrument.notes.map((note) => note.name) }));
    const count = (records: Iterable<{ readonly modules: readonly string[] }>): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const record of records) for (const name of new Set(record.modules)) counts.set(name, (counts.get(name) ?? 0) + 1);
      return counts;
    };
    const selectable = catalog.signals.filter((entry) => entry.visibility === "normal");
    const placeable = table.entities.filter((game) => !game.hidden && isPrototypeName(game.name));
    const signals = count(selectable);
    const entities = count(placeable);
    // A record is in the dialog of its first module only. Roughly which modules have one to list: the lists themselves are made when asked for.
    const own = new Set([...selectable, ...placeable.filter((game) => !this.pinned.has(game.name))].flatMap((record) => record.modules.slice(0, 1)));
    this.modules = this.listed.map((module): ModuleView => {
      const enabled = this.active.has(module.name);
      return {
        name: module.name,
        title: module.title,
        version: module.version,
        game: isGameModule(module.name),
        enabled,
        canDisable: module.name !== BASE_MODULE,
        enables: enabled ? [] : enableModule(this.listed, this.active, module.name, { withRecommended: true }).changed.filter((name) => name !== module.name),
        disables: enabled ? dependentModules(this.listed, this.active, module.name) : [],
        missing: resolution.missing.find((entry) => entry.module === module.name)?.requires ?? [],
        signalCount: signals.get(module.name) ?? 0,
        entityCount: entities.get(module.name) ?? 0,
        hasItems: own.has(module.name),
      };
    });
  }

  /** The same services with other things hidden: what the user changed in the settings of the application. */
  withHidden(hidden: HiddenItems): CatalogService {
    const next = new CatalogService(this.catalog, this.requested, hidden);
    next.made = this.made;
    return next;
  }

  /** The module list after switching one module, with its dependencies or dependents. Names that are not in the list are kept at the end. */
  withModule(name: string, enabled: boolean): readonly string[] | undefined {
    const module = this.listed.find((candidate) => candidate.name === name);
    if (!module || enabled === this.active.has(name) || (!enabled && name === BASE_MODULE)) return undefined;
    const change = enabled ? enableModule(this.listed, this.active, name, { withRecommended: true }) : disableModule(this.listed, this.active, name);
    return [...change.enabled, ...this.kept];
  }

  /**
   * The module list with every one of `names` switched on, each with what it requires and nothing it only recommends: what a
   * source needs to lose its warnings. Undefined when that changes nothing; a name that is not in the list is passed over.
   */
  withModulesOn(names: Iterable<string>): readonly string[] | undefined {
    let enabled = this.enabled;
    for (const name of names) if (this.listed.some((module) => module.name === name)) enabled = enableModule(this.listed, enabled, name).enabled;
    return enabled.length === this.enabled.length ? undefined : [...enabled, ...this.kept];
  }

  /** What the game calls a module; its name for one the catalog does not have. */
  titleOf(name: string): string {
    return this.titles.get(name) ?? name;
  }

  /** `SignalResolver` of the language: signals of modules that are switched off and signals the catalog does not contain become warnings. */
  status(id: SignalId): SignalStatus {
    return this.lookup(id).info.status;
  }

  /** `SignalResolver`: the titles of the switched-off modules a disabled signal is of. */
  switchedOff(id: SignalId): readonly string[] {
    return this.lookup(id).info.switchedOff ?? NONE;
  }

  describe(id: SignalId): SignalInfo {
    return this.lookup(id).info;
  }

  /** The modules a signal is of that are switched off, by name: its own, and those of the quality it names. None for a signal that is known, unknown, or removed by a module. */
  signalModulesOff(id: SignalId): readonly string[] {
    return this.lookup(id).off;
  }

  /** The same for an entity of the game data. */
  prototypeModulesOff(prototype: string): readonly string[] {
    const game = entityTable().byName.get(prototype);
    return game ? this.off(game.modules) : NONE;
  }

  entityWarning(prototype: PrototypeName): string | undefined {
    const off = this.prototypeModulesOff(prototype);
    const game = entityTable().byName.get(prototype);
    return game && off.length > 0 ? disabledPrototypeMessage(prototype, game.displayName, off.map((name) => this.titleOf(name))) : undefined;
  }

  /** Whether an entity is offered: the data has it for these modules and the user did not hide it. One that is not offered stays in a source; one of a module that is off with a warning. */
  offersPrototype(prototype: string): boolean {
    const game = entityTable().byName.get(prototype);
    return game !== undefined && isAvailable(game, this.active) && !this.hidesEntity(game);
  }

  private hidesEntity(game: EntityPrototype): boolean {
    return !this.pinned.has(game.name) && this.hidden.entity(game);
  }

  /** The wildcards are no signals of a list: the slot decides about them. */
  private hidesSignal(entry: CatalogSignal): boolean {
    return entry.visibility === "normal" && this.hidden.signal(entry);
  }

  /**
   * What the dialog of a module lists: the signals the picker would offer for it and the entities the selector would, were the
   * module switched on beside the modules of the project (with what it requires), in the order the picker and the selector
   * have them. A record that names several modules (a recipe of a mod's item) is in the list of its first one only. Nothing
   * the game hides is in it, no wildcard, and none of the four entities of the selector's first row.
   */
  items(module: string): ModuleItems {
    let found = this.made.listings.get(module);
    if (!found) this.made.listings.set(module, (found = this.listItems(module)));
    return found;
  }

  private listItems(module: string): ModuleItems {
    if (!this.listed.some((candidate) => candidate.name === module)) return NO_ITEMS;
    const on = this.active.has(module);
    const active = on ? this.active : new Set(enableModule(this.listed, this.active, module).enabled);
    const owned = (record: { readonly modules: readonly string[] }): boolean => record.modules[0] === module;
    let tree: readonly PickerGroup[] = [];
    try {
      tree = on ? this.allSignals() : pickerTree(this.catalog, active, { wildcards: false });
    } catch {
      // As in `picker`: nothing consistent to list.
    }
    const signals = tree.flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals.filter((entry) => entry.visibility === "normal" && owned(entry))));
    const table = entityTable();
    const registry = on ? this.allEntities() : entityRegistry(this.catalog, table, active);
    const entities = registry.groups.flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.entries.filter((entry) => !this.pinned.has(entry.prototype) && owned(table.byName.get(entry.prototype)!))));
    return {
      signals: signals.map((entry): ModuleItem => ({ key: entry.key, label: entry.displayName, icon: entry.icon })),
      entities: entities.map((entry): ModuleItem => ({ key: entry.prototype, label: entry.label })),
    };
  }

  /** What is stored as hidden for a module, as it is stored: it may name what the data in use does not have. */
  hiddenOf(module: string): HiddenModuleItems {
    return this.hidden.of(module);
  }

  /** How many of the signals and entities the dialog of a module lists are hidden. */
  hiddenCount(module: string): number {
    const stored = this.hidden.of(module);
    if (stored.signals.length + stored.entities.length === 0) return 0;
    const { signals, entities } = this.items(module);
    const [hiddenSignals, hiddenEntities] = [new Set(stored.signals), new Set(stored.entities)];
    return signals.filter((item) => hiddenSignals.has(item.key)).length + entities.filter((item) => hiddenEntities.has(item.key)).length;
  }

  private off(modules: readonly string[]): readonly string[] {
    return modules.every((name) => this.active.has(name)) ? NONE : modules.filter((name) => !this.active.has(name));
  }

  private lookup(id: SignalId): Lookup {
    const key = signalKey(id);
    let found = this.lookups.get(key);
    if (!found) {
      found = this.resolve(id);
      this.lookups.set(key, found);
    }
    return found;
  }

  private resolve(id: SignalId): Lookup {
    const stored = findSignal(this.catalog, id);
    if (!stored) return { info: { status: "unknown" }, off: NONE };
    // With these modules the signal may be absent (its module is off, or another module removes it) or have other attributes.
    const entry = findSignal(this.catalog, id, this.active);
    const named = id.quality !== undefined && id.quality !== NORMAL_QUALITY;
    const quality = named ? this.catalog.qualities.find((candidate) => candidate.name === id.quality) : undefined;
    const status: SignalStatus = !entry ? "disabled" : !named ? "known" : !quality ? "unknown" : isAvailable(quality, this.active) ? "known" : "disabled";
    const shown = entry ?? stored;
    const off = status === "disabled" ? [...new Set([...this.off(stored.modules), ...(quality ? this.off(quality.modules) : NONE)])] : NONE;
    const switchedOff = off.length > 0 ? { switchedOff: off.map((name) => this.titleOf(name)) } : {};
    return { info: { status, displayName: quality ? `${shown.displayName} (${quality.displayName})` : shown.displayName, icon: shown.icon, ...switchedOff }, off };
  }

  /** The picker of the modules, before the user's rule. */
  private allSignals(): readonly PickerGroup[] {
    if (!this.made.tree) {
      try {
        this.made.tree = pickerTree(this.catalog, this.active, { wildcards: true });
      } catch (error) {
        // No set of modules does this: the data has a signal whose subgroup, or a subgroup whose group, it lacks. There is
        // then nothing consistent to pick from.
        console.error("[face] no signal picker for modules", this.enabled, error);
        this.made.tree = [];
      }
    }
    return this.made.tree;
  }

  /** The signals the modules have, without those the user hid; a subgroup and a group go with their last signal. */
  picker(): readonly PickerGroup[] {
    const tree = this.allSignals();
    if (this.hidden.entries.length === 0) return tree;
    return (this.offered ??= tree.flatMap((group) => {
      const subgroups = group.subgroups.flatMap((subgroup) => {
        const signals = subgroup.signals.filter((entry) => !this.hidesSignal(entry));
        return signals.length > 0 ? [{ ...subgroup, signals }] : [];
      });
      return subgroups.length > 0 ? [{ ...group, subgroups }] : [];
    }));
  }

  /**
   * What the picker does not offer of the signals the game offers, each with the reason: a search of the picker says that it
   * matches them. A signal of modules that are switched off is in it as that, hidden or not; one the user hid, when its modules are on.
   */
  notOffered(): readonly NotOfferedSignal[] {
    const off = this.signalsSwitchedOff();
    if (this.hidden.entries.length === 0) return off;
    const offered = this.allSignals().flatMap((group) => group.subgroups.flatMap((subgroup) => subgroup.signals));
    return (this.unoffered ??= [...off, ...offered.filter((entry) => this.hidesSignal(entry)).map(({ key, name, displayName }) => ({ key, name, displayName, switchedOff: NONE }))]);
  }

  /**
   * The signals the picker would offer were the modules they need switched on, as they would be then. A signal that switching
   * modules on does not bring is not among them: one that a module of the project removes, and one that needs a module the
   * project does not list.
   */
  private signalsSwitchedOff(): readonly NotOfferedSignal[] {
    if (this.made.switchedOff) return this.made.switchedOff;
    const listed = new Set(this.listed.map((module) => module.name));
    return (this.made.switchedOff = this.catalog.signals.flatMap((stored): NotOfferedSignal[] => {
      const off = this.off(stored.modules);
      if (off.length === 0 || !off.every((name) => listed.has(name))) return [];
      const on = new Set([...this.active, ...off]);
      if (!isAvailable(stored, on)) return [];
      const { key, name, displayName, visibility } = resolveSignal(stored, on);
      return visibility === "normal" ? [{ key, name, displayName, switchedOff: off.map((module) => this.titleOf(module)) }] : [];
    }));
  }

  /** The selector of the modules, before the user's rule. */
  private allEntities(): EntityRegistry {
    return (this.made.registry ??= entityRegistry(this.catalog, entityTable(), this.active));
  }

  entities(): EntityRegistry {
    return (this.registry ??= this.hidden.entries.length === 0 ? this.allEntities() : entityRegistry(this.catalog, entityTable(), this.active, (game) => this.hidesEntity(game)));
  }

  /** Signals a completion list may offer: everything the picker shows except the wildcards, which are keywords in the language. */
  selectableSignals(): readonly { readonly id: SignalId; readonly displayName: string }[] {
    return availableSignals(this.catalog, this.active, { visibility: ["normal"] }).filter((entry) => !this.hidesSignal(entry)).map((entry) => ({ id: entry.id, displayName: entry.displayName }));
  }
}
