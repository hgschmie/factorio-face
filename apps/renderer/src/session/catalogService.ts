// Catalog services for one set of enabled modules: signal status for the language, display data for the views, the picker
// tree and the module list of the project settings. Instances are immutable; a module change creates a new one.
import {
  availableQualities, availableSignals, dependentModules, disableModule, enableModule, findSignal, isAvailable, pickerTree, resolveModules, speakerInstruments,
  type Catalog, type PickerGroup, type SpeakerInstrumentInfo,
} from "@face/catalog";
import type { SignalResolver } from "@face/language";
import { NORMAL_QUALITY, signalKey, type SignalId, type SpeakerInstrument } from "@face/model";
import type { CatalogView, ModuleView, QualityOption, SignalInfo, SignalStatus } from "../workbench/controller.ts";

export class CatalogService implements CatalogView, SignalResolver {
  readonly gameVersion: string;
  /** Enabled modules the catalog knows, in catalog order. */
  readonly enabled: readonly string[];
  readonly unknownModules: readonly string[];
  readonly modules: readonly ModuleView[];
  readonly qualities: readonly QualityOption[];
  /** The instruments of the speaker with their notes for these modules: with display names, and by name only as the language takes them. */
  readonly speakerInstruments: readonly SpeakerInstrumentInfo[];
  readonly instruments: readonly SpeakerInstrument[];
  private readonly active: ReadonlySet<string>;
  private readonly infos = new Map<string, SignalInfo>();
  private tree: readonly PickerGroup[] | undefined;

  /** `requested` is the module list of the project file; unknown names are reported, never dropped by this class. */
  constructor(readonly catalog: Catalog, readonly requested: readonly string[]) {
    const resolution = resolveModules(catalog.modules, requested);
    this.gameVersion = catalog.game.version;
    this.enabled = resolution.enabled;
    this.unknownModules = resolution.unknown;
    this.active = new Set(resolution.enabled);
    const selectable = availableQualities(catalog, this.active).filter((quality) => !quality.hidden);
    // Without the quality module only "normal" exists, and a choice of one is no choice.
    this.qualities = selectable.length > 1 ? selectable.map(({ name, displayName, icon, color }) => ({ name, displayName, icon, color })) : [];
    this.speakerInstruments = speakerInstruments(catalog, this.active);
    this.instruments = this.speakerInstruments.map((instrument) => ({ name: instrument.name, notes: instrument.notes.map((note) => note.name) }));
    this.modules = catalog.modules.map((module): ModuleView => {
      const enabled = this.active.has(module.name);
      return {
        name: module.name,
        title: module.title,
        version: module.version,
        enabled,
        canDisable: module.requires.length > 0,
        enables: enabled ? [] : enableModule(catalog.modules, this.active, module.name, { withRecommended: true }).changed.filter((name) => name !== module.name),
        disables: enabled ? dependentModules(catalog.modules, this.active, module.name) : [],
        missing: resolution.missing.find((entry) => entry.module === module.name)?.requires ?? [],
        signalCount: catalog.signals.filter((entry) => entry.visibility === "normal" && entry.modules.includes(module.name)).length,
      };
    });
  }

  /** The module list after switching one module, with its dependencies or dependents. Unknown names are kept at the end. */
  withModule(name: string, enabled: boolean): readonly string[] | undefined {
    const module = this.catalog.modules.find((candidate) => candidate.name === name);
    if (!module || enabled === this.active.has(name) || (!enabled && module.requires.length === 0)) return undefined;
    const change = enabled ? enableModule(this.catalog.modules, this.active, name, { withRecommended: true }) : disableModule(this.catalog.modules, this.active, name);
    return [...change.enabled, ...this.unknownModules];
  }

  /** `SignalResolver` of the language: signals of disabled modules and signals the catalog does not contain become warnings. */
  status(id: SignalId): SignalStatus {
    return this.describe(id).status;
  }

  describe(id: SignalId): SignalInfo {
    const key = signalKey(id);
    let info = this.infos.get(key);
    if (!info) {
      info = this.lookup(id);
      this.infos.set(key, info);
    }
    return info;
  }

  private lookup(id: SignalId): SignalInfo {
    const stored = findSignal(this.catalog, id);
    if (!stored) return { status: "unknown" };
    // With these modules the signal may be absent (its module is off, or another module removes it) or have other attributes.
    const entry = findSignal(this.catalog, id, this.active);
    const named = id.quality !== undefined && id.quality !== NORMAL_QUALITY;
    const quality = named ? this.catalog.qualities.find((candidate) => candidate.name === id.quality) : undefined;
    const status: SignalStatus = !entry ? "disabled" : !named ? "known" : !quality ? "unknown" : isAvailable(quality, this.active) ? "known" : "disabled";
    const shown = entry ?? stored;
    return { status, displayName: quality ? `${shown.displayName} (${quality.displayName})` : shown.displayName, icon: shown.icon };
  }

  picker(): readonly PickerGroup[] {
    if (!this.tree) {
      try {
        this.tree = pickerTree(this.catalog, this.active, { wildcards: true });
      } catch (error) {
        // A module set the game would not accept (hand-edited project file) can leave signals without their group. The
        // settings panel shows what is missing; until that is fixed there is nothing consistent to pick from.
        console.error("[face] no signal picker for modules", this.enabled, error);
        this.tree = [];
      }
    }
    return this.tree;
  }

  /** Signals a completion list may offer: everything the picker shows except the wildcards, which are keywords in the language. */
  selectableSignals(): readonly { readonly id: SignalId; readonly displayName: string }[] {
    return availableSignals(this.catalog, this.active, { visibility: ["normal"] }).map((entry) => ({ id: entry.id, displayName: entry.displayName }));
  }
}
