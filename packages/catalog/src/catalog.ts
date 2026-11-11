// Catalog construction from stored data, lookups, module-dependent views and the signal picker tree.

import { STANDARD_SIGNAL_KINDS, parseSignalKey, signal, signalKey, type SignalId, type SignalKind } from "@face/model";
import { isAvailable } from "./modules.ts";
import type { Catalog, CatalogData, CatalogGroup, CatalogSignal, CatalogSubgroup, ModuleScoped, QualityInfo, SignalVisibility, Variant } from "./types.ts";

const PROTOTYPE_OF_KIND: Readonly<Record<string, string>> = { virtual: "virtual-signal" };
const KIND_INDEX = new Map<string, number>(STANDARD_SIGNAL_KINDS.map((kind, index) => [kind, index]));

/** Factorio compares order strings bytewise; all catalog strings are ASCII, so code unit order is equivalent. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareOrdered(a: { order: string; name: string }, b: { order: string; name: string }): number {
  return compareText(a.order, b.order) || compareText(a.name, b.name);
}

/** Catalog key of a signal: kind and name without quality. Accepts an id or a `kind:name[@quality]` key. */
export function catalogKey(id: SignalId | string): string | undefined {
  const parsed = typeof id === "string" ? parseSignalKey(id) : id;
  return parsed && signalKey({ kind: parsed.kind, name: parsed.name });
}

function signalDefaults(kind: SignalKind, name: string): Pick<CatalogSignal, "prototype" | "visibility" | "hidden" | "parameter" | "special" | "icon"> {
  return { prototype: PROTOTYPE_OF_KIND[kind] ?? kind, visibility: "normal", hidden: false, parameter: false, special: false, icon: `${kind}/${name}` };
}

/** Expands stored catalog data (defaults omitted) into a catalog with lookup indexes. */
export function createCatalog(data: CatalogData): Catalog {
  if (data.schema !== 1) throw new Error(`Unsupported catalog schema ${data.schema}`);
  const signals: CatalogSignal[] = [];
  for (const [kindName, records] of Object.entries(data.signals)) {
    const kind = kindName as SignalKind;
    for (const record of records) {
      const id = signal(kind, record.name);
      signals.push({ origin: "standard", kind, id, key: signalKey(id), ...signalDefaults(kind, record.name), ...record });
    }
  }
  const groups = data.groups.map((group): CatalogGroup => ({ origin: "standard", icon: `group/${group.name}`, ...group }));
  const subgroups = data.subgroups.map((subgroup): CatalogSubgroup => ({ origin: "standard", ...subgroup }));
  const qualities = data.qualities.map((quality): QualityInfo => ({ hidden: false, icon: `quality/${quality.name}`, ...quality }));
  return {
    game: data.game,
    provenance: data.provenance,
    modules: data.modules,
    constants: data.constants,
    groups,
    subgroups,
    qualities,
    signals,
    signalsByKey: new Map(signals.map((entry) => [entry.key, entry])),
    groupsByName: new Map(groups.map((entry) => [entry.name, entry])),
    subgroupsByName: new Map(subgroups.map((entry) => [entry.name, entry])),
  };
}

type WithVariants<A> = ModuleScoped & { readonly variants?: readonly Variant<A>[] };

/**
 * The entry as it is with the given modules enabled: variants whose `when` modules are all enabled are applied in order.
 * `defaults` supplies the value a `null` override falls back to.
 */
function applyVariants<A, T extends A & WithVariants<A>>(entry: T, enabled: ReadonlySet<string>, defaults: Partial<A> = {}): T {
  const applicable = entry.variants?.filter((variant) => variant.when.every((name) => enabled.has(name)));
  if (!applicable?.length) return entry;
  const out = { ...entry } as Record<string, unknown>;
  for (const { when: _when, ...patch } of applicable) {
    for (const [field, value] of Object.entries(patch)) {
      if (value !== null) out[field] = value;
      else if (field in defaults) out[field] = (defaults as Record<string, unknown>)[field];
      else delete out[field];
    }
  }
  return out as T;
}

function enabledSet(enabled: Iterable<string>): ReadonlySet<string> {
  return enabled instanceof Set ? enabled : new Set(enabled);
}

/** The signal as defined for the given enabled modules (e.g. Space Age moves and restacks some base signals). */
export function resolveSignal(entry: CatalogSignal, enabled: Iterable<string>): CatalogSignal {
  return applyVariants(entry, enabledSet(enabled), signalDefaults(entry.kind, entry.name));
}

/**
 * Looks a signal up by id or key; quality is ignored because it is not part of a catalog entry. With `enabled`, the
 * result is undefined unless the signal exists for these modules, and module-dependent attributes are resolved.
 */
export function findSignal(catalog: Catalog, id: SignalId | string, enabled?: Iterable<string>): CatalogSignal | undefined {
  const key = catalogKey(id);
  const entry = key === undefined ? undefined : catalog.signalsByKey.get(key);
  if (!entry || enabled === undefined) return entry;
  const active = enabledSet(enabled);
  return isAvailable(entry, active) ? resolveSignal(entry, active) : undefined;
}

export interface SignalFilter {
  readonly kinds?: readonly SignalKind[];
  /** Defaults to every visibility, because blueprint import must resolve hidden signals too. */
  readonly visibility?: readonly SignalVisibility[];
}

/** All signals that exist with the given modules enabled, with module-dependent attributes resolved. */
export function availableSignals(catalog: Catalog, enabled: Iterable<string>, filter: SignalFilter = {}): CatalogSignal[] {
  const active = enabledSet(enabled);
  const out: CatalogSignal[] = [];
  for (const entry of catalog.signals) {
    if (filter.kinds && !filter.kinds.includes(entry.kind)) continue;
    if (!isAvailable(entry, active)) continue;
    const resolved = resolveSignal(entry, active);
    if (!filter.visibility || filter.visibility.includes(resolved.visibility)) out.push(resolved);
  }
  return out;
}

/** Qualities that exist with the given modules enabled, lowest first. Without the quality module only hidden ones remain. */
export function availableQualities(catalog: Catalog, enabled: Iterable<string>): QualityInfo[] {
  const active = enabledSet(enabled);
  return catalog.qualities.filter((quality) => isAvailable(quality, active)).map((quality) => applyVariants(quality, active, { hidden: false }));
}

export interface PickerOptions {
  /** Include signal-everything / -anything / -each. Default true; turn off for slots that do not accept wildcards. */
  readonly wildcards?: boolean;
  /** Include blueprint and interrupt parameters. Default false. */
  readonly parameters?: boolean;
  /** Include signals the game never offers. Default false. */
  readonly hidden?: boolean;
  readonly kinds?: readonly SignalKind[];
}

export interface PickerSubgroup {
  readonly subgroup: CatalogSubgroup;
  readonly signals: readonly CatalogSignal[];
}

export interface PickerGroup {
  readonly group: CatalogGroup;
  readonly subgroups: readonly PickerSubgroup[];
}

/**
 * The signal picker for a module set, organised like the in-game dialog: groups (tabs), subgroups (row blocks) and
 * signals, each level in game order. Groups and subgroups without signals are omitted.
 */
export function pickerTree(catalog: Catalog, enabled: Iterable<string>, options: PickerOptions = {}): PickerGroup[] {
  const active = enabledSet(enabled);
  const visibility: SignalVisibility[] = ["normal"];
  if (options.wildcards ?? true) visibility.push("wildcard");
  if (options.parameters) visibility.push("parameter");
  if (options.hidden) visibility.push("hidden");

  const bySubgroup = new Map<string, CatalogSignal[]>();
  for (const entry of availableSignals(catalog, active, { visibility, kinds: options.kinds })) {
    const list = bySubgroup.get(entry.subgroup);
    if (list) list.push(entry);
    else bySubgroup.set(entry.subgroup, [entry]);
  }
  const byGroup = new Map<string, PickerSubgroup[]>();
  for (const [name, signals] of bySubgroup) {
    const stored = catalog.subgroupsByName.get(name);
    if (!stored || !isAvailable(stored, active)) throw new Error(`Signals reference subgroup "${name}", which does not exist for the enabled modules`);
    const subgroup = applyVariants(stored, active);
    signals.sort((a, b) => compareText(a.order, b.order) || (KIND_INDEX.get(a.kind) ?? 99) - (KIND_INDEX.get(b.kind) ?? 99) || compareText(a.name, b.name));
    const list = byGroup.get(subgroup.group);
    if (list) list.push({ subgroup, signals });
    else byGroup.set(subgroup.group, [{ subgroup, signals }]);
  }
  const tree: PickerGroup[] = [];
  for (const [name, subgroups] of byGroup) {
    const stored = catalog.groupsByName.get(name);
    if (!stored || !isAvailable(stored, active)) throw new Error(`Subgroups reference group "${name}", which does not exist for the enabled modules`);
    subgroups.sort((a, b) => compareOrdered(a.subgroup, b.subgroup));
    tree.push({ group: applyVariants(stored, active), subgroups });
  }
  return tree.sort((a, b) => compareOrdered(a.group, b.group));
}

/**
 * Path of an icon file below the generated icon root (`packages/catalog/generated/icons` at build time), e.g.
 * `iconPath(signal, "icons")` -> "icons/item/iron-plate.png". Accepts an entry with an `icon` id or the id itself.
 */
export function iconPath(icon: string | { readonly icon: string }, root = ""): string {
  const file = `${typeof icon === "string" ? icon : icon.icon}.png`;
  return root === "" ? file : `${root.replace(/\/+$/, "")}/${file}`;
}
