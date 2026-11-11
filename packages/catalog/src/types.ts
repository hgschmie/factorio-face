// Catalog data model. The standard catalog is generated from the game (tools/catalog); the types stay open for
// user-defined ("custom") signals and groups, which are not part of the generated data.

import type { SignalId, SignalKind, Wildcard } from "@face/model";

export const STANDARD_MODULES = ["base", "elevated-rails", "recycler", "quality", "space-age"] as const;
export type StandardModule = (typeof STANDARD_MODULES)[number];

/** Edge length in pixels of every generated icon. */
export const ICON_SIZE = 64;

export interface ModuleInfo {
  readonly name: string;
  readonly title: string;
  readonly version: string;
  /** Hard dependencies: the module cannot be enabled without them. */
  readonly requires: readonly string[];
  /** Factorio's "+" dependencies: enabled by default together with the module, but may be turned off. */
  readonly recommends: readonly string[];
  /** Engine feature flags the module switches on (from the `*_required` keys of its info.json). */
  readonly featureFlags: readonly string[];
}

/** Where a catalog entry comes from. Only "standard" entries are generated; "custom" is reserved for user definitions. */
export type CatalogOrigin = "standard" | "custom";

/** Module provenance: an entry exists when every module in `modules` is enabled and none in `removedBy` is. */
export interface ModuleScoped {
  readonly modules: readonly string[];
  readonly removedBy?: readonly string[];
}

/** Field overrides that apply when all modules in `when` are enabled; `null` resets a field to its default. */
export type Variant<T> = { readonly when: readonly string[] } & { readonly [K in keyof T]?: T[K] | null };

/**
 * How the game's signal selection GUI treats a signal:
 * - `normal`: offered in every signal slot
 * - `wildcard`: everything / anything / each, offered only where the slot semantics allow them
 * - `parameter`: blueprint parameters (`parameter-0`..`9` of each kind) and the train interrupt parameter signals
 * - `hidden`: never offered (hidden prototypes, placeholders, recipes and entities represented by their item);
 *   such signals still occur in blueprints and must resolve
 */
export type SignalVisibility = "normal" | "wildcard" | "parameter" | "hidden";

export interface SignalAttributes {
  readonly displayName: string;
  /** Factorio order string; compared bytewise. */
  readonly order: string;
  readonly subgroup: string;
  /** Prototype type, e.g. "item", "ammo", "unit", "planet". */
  readonly prototype: string;
  readonly visibility: SignalVisibility;
  readonly hidden: boolean;
  readonly parameter: boolean;
  /** Virtual signals the engine treats specially: the wildcards, the interrupt parameters and signal-unknown. */
  readonly special: boolean;
  readonly wildcard?: Wildcard;
  /** Icon id relative to the icon root, without extension (see `iconPath`). Several signals may share one icon. */
  readonly icon: string;
  /** Recipes and asteroid chunks: the engine's own "hide from signal GUI" decision. */
  readonly hideFromSignalGui?: boolean;
  /** Entities: the items that build this entity; the signal GUI shows those instead of the entity. */
  readonly placedBy?: readonly string[];
  /** Asteroid chunks: the item signal the engine uses in place of this chunk signal. */
  readonly itemAlias?: string;
  /** Items only. */
  readonly stackSize?: number;
  /** Items only: weight as used for rocket capacity (`rocketLiftWeight / weight`). */
  readonly weight?: number;
  /** Quality signals only. */
  readonly level?: number;
  readonly next?: string;
  readonly color?: string;
}

export interface CatalogSignal extends SignalAttributes, ModuleScoped {
  readonly origin: CatalogOrigin;
  readonly kind: SignalKind;
  readonly name: string;
  /** Identity without quality. */
  readonly id: SignalId;
  /** `signalKey(id)`, e.g. "item:iron-plate". */
  readonly key: string;
  readonly variants?: readonly Variant<SignalAttributes>[];
}

export interface GroupAttributes {
  readonly displayName: string;
  readonly order: string;
  readonly icon: string;
}

/** An item group: one tab of the signal picker. */
export interface CatalogGroup extends GroupAttributes, ModuleScoped {
  readonly origin: CatalogOrigin;
  readonly name: string;
  readonly variants?: readonly Variant<GroupAttributes>[];
}

export interface SubgroupAttributes {
  readonly group: string;
  readonly order: string;
}

/** An item subgroup: one row block inside a picker tab. Subgroups have no display name in the game. */
export interface CatalogSubgroup extends SubgroupAttributes, ModuleScoped {
  readonly origin: CatalogOrigin;
  readonly name: string;
  readonly variants?: readonly Variant<SubgroupAttributes>[];
}

export interface QualityAttributes {
  readonly displayName: string;
  readonly level: number;
  readonly order: string;
  /** "#rrggbb" */
  readonly color: string;
  /** Next higher quality, if any. */
  readonly next?: string;
  readonly hidden: boolean;
  readonly icon: string;
}

export interface QualityInfo extends QualityAttributes, ModuleScoped {
  readonly name: string;
  readonly variants?: readonly Variant<QualityAttributes>[];
}

export interface RocketSiloAttributes {
  /** Weight one rocket lifts; 2^48 means "unlimited" (no Space Age). */
  readonly liftWeight: number;
  readonly rocketPartsRequired: number;
}

export interface RocketSiloInfo extends RocketSiloAttributes, ModuleScoped {
  readonly name: string;
  readonly variants?: readonly Variant<RocketSiloAttributes>[];
}

export interface CatalogConstants {
  /** Weight of items for which the engine could not derive one. */
  readonly defaultItemWeight: number;
  /** Utility constant `default_rocket_lift_weight`; the selector combinator's rocket capacity is this divided by the item weight. */
  readonly rocketLiftWeight: number;
  readonly rocketSilos: readonly RocketSiloInfo[];
}

export interface GameInfo {
  readonly version: string;
  readonly build: number;
}

export interface CatalogProvenance {
  readonly generator: string;
  readonly generatedAt: string;
  readonly locale: string;
  readonly commands: readonly string[];
  readonly modSets: readonly string[];
  readonly icons: string;
}

export interface Catalog {
  readonly game: GameInfo;
  readonly provenance: CatalogProvenance;
  readonly modules: readonly ModuleInfo[];
  readonly constants: CatalogConstants;
  readonly groups: readonly CatalogGroup[];
  readonly subgroups: readonly CatalogSubgroup[];
  /** In game order (lowest first); also present as signals of kind "quality". */
  readonly qualities: readonly QualityInfo[];
  /** Every signal of every module, including hidden ones, ordered by kind and name. */
  readonly signals: readonly CatalogSignal[];
  readonly signalsByKey: ReadonlyMap<string, CatalogSignal>;
  readonly groupsByName: ReadonlyMap<string, CatalogGroup>;
  readonly subgroupsByName: ReadonlyMap<string, CatalogSubgroup>;
}

type Stored<Attributes, Required extends keyof Attributes> = { readonly name: string } & Pick<Attributes, Required> & Partial<Attributes> & ModuleScoped & { readonly variants?: readonly Variant<Attributes>[] };

/** Shape of `data/catalog-<version>.json`: defaults (false flags, "normal" visibility, default icon ids) are omitted. */
export interface CatalogData {
  readonly schema: number;
  readonly game: GameInfo;
  readonly provenance: CatalogProvenance;
  readonly modules: readonly ModuleInfo[];
  readonly constants: CatalogConstants;
  readonly groups: readonly Stored<GroupAttributes, "displayName" | "order">[];
  readonly subgroups: readonly Stored<SubgroupAttributes, "group" | "order">[];
  readonly qualities: readonly Stored<QualityAttributes, "displayName" | "level" | "order" | "color">[];
  readonly signals: Readonly<Record<string, readonly Stored<SignalAttributes, "displayName" | "order" | "subgroup">[]>>;
}
