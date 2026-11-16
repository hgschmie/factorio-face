// Catalog services for one set of enabled modules: signal status for the language, display data for the views, the picker
// tree and the module list of the project settings. Instances are immutable; a module change creates a new one.
//
// The enabled modules are the project's list, whatever data is in use: the built-in data has the game's five modules, data
// read from the user's game has the modules of that game and its mods. `base` is on in any case.
import {
  availableQualities, availableSignals, BASE_MODULE, dependentModules, disableModule, enableModule, findSignal, isAvailable, isGameModule, listedModules, namedModules, pickerTree, resolveModules,
  speakerInstruments,
  type Catalog, type ModuleInfo, type PickerGroup, type SpeakerInstrumentInfo,
} from "@face/catalog";
import { disabledPrototypeMessage, type PrototypeResolver, type SignalResolver } from "@face/language";
import { entityTable, isPrototypeName, NORMAL_QUALITY, signalKey, type PrototypeName, type SignalId, type SpeakerInstrument } from "@face/model";
import { entityRegistry, type EntityRegistry } from "../entities/registry.ts";
import type { CatalogView, ModuleView, QualityOption, SignalInfo, SignalStatus } from "../workbench/controller.ts";

const NONE: readonly string[] = [];

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
  private tree: readonly PickerGroup[] | undefined;
  private registry: EntityRegistry | undefined;

  /** `requested` is the module list of the project file; names the list of the data does not have are reported, never dropped by this class. */
  constructor(readonly catalog: Catalog, readonly requested: readonly string[]) {
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
    const selectable = availableQualities(catalog, this.active).filter((quality) => !quality.hidden);
    // Without the quality module only "normal" exists, and a choice of one is no choice.
    this.qualities = selectable.length > 1 ? selectable.map(({ name, displayName, icon, color }) => ({ name, displayName, icon, color })) : [];
    this.speakerInstruments = speakerInstruments(catalog, this.active);
    this.instruments = this.speakerInstruments.map((instrument) => ({ name: instrument.name, notes: instrument.notes.map((note) => note.name) }));
    const count = (records: Iterable<{ readonly modules: readonly string[] }>): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const record of records) for (const name of new Set(record.modules)) counts.set(name, (counts.get(name) ?? 0) + 1);
      return counts;
    };
    const signals = count(catalog.signals.filter((entry) => entry.visibility === "normal"));
    const entities = count(table.entities.filter((game) => !game.hidden && isPrototypeName(game.name)));
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
      };
    });
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

  /** Whether an entity is offered: the data has it for these modules. One of a module that is off stays in a source, with a warning. */
  offersPrototype(prototype: string): boolean {
    const game = entityTable().byName.get(prototype);
    return game !== undefined && isAvailable(game, this.active);
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

  picker(): readonly PickerGroup[] {
    if (!this.tree) {
      try {
        this.tree = pickerTree(this.catalog, this.active, { wildcards: true });
      } catch (error) {
        // No set of modules does this: the data has a signal whose subgroup, or a subgroup whose group, it lacks. There is
        // then nothing consistent to pick from.
        console.error("[face] no signal picker for modules", this.enabled, error);
        this.tree = [];
      }
    }
    return this.tree;
  }

  entities(): EntityRegistry {
    return (this.registry ??= entityRegistry(this.catalog, entityTable(), this.active));
  }

  /** Signals a completion list may offer: everything the picker shows except the wildcards, which are keywords in the language. */
  selectableSignals(): readonly { readonly id: SignalId; readonly displayName: string }[] {
    return availableSignals(this.catalog, this.active, { visibility: ["normal"] }).map((entry) => ({ id: entry.id, displayName: entry.displayName }));
  }
}
