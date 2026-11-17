// The signal catalog and the entity table of a game with many mods, for tests of the module list: the standard tables, and
// mods as data read from a game names them. Every record names the mod that created it as its module, a mod's dependencies name
// mods of the list, and what one mod adds may sit in a subgroup that another one created. No real mod is involved.
//
//   a-lib        adds nothing; `c-ore` requires it
//   b-tabs       creates an item group and a subgroup and no signal: not a module a project switches
//   c-ore        an item in the subgroup of `b-tabs`, which it does not require; its recycling recipe is the recycler's as well
//   d-glue       adds nothing; requires `c-ore`
//   e-machines   a crate with its item; requires `d-glue` (and so `c-ore`, through a mod that is not listed), recommends `g-filler-1`
//   f-unread     its info could not be read: the title is the name, no dependencies; adds one hidden signal
//   g-filler-N   six mods with a virtual signal each, so that the list is long
import type { CatalogData, ModuleInfo } from "../../../packages/catalog/src/index.ts";
import catalog from "../../../packages/catalog/data/catalog-2.1.25.json" with { type: "json" };
import entities from "../../../packages/model/data/entities-2.1.25.json" with { type: "json" };

const mod = (name: string, title: string, requires: readonly string[], recommends: readonly string[] = []): ModuleInfo => ({ name, title, version: "1.0.0", requires, recommends, featureFlags: [] });

export const FILLERS: readonly string[] = Array.from({ length: 6 }, (_, index) => `g-filler-${index + 1}`);
export const ORE = "c-ore";
export const MACHINES = "e-machines";
export const UNREAD = "f-unread";
/** A title as a mod may write it: it is text, whatever it looks like. */
export const MACHINES_TITLE = "Machines & <i>More</i>";

/** The mods in the order of the catalog's head: by name, after the game's own modules. */
export const MANY_MODS: readonly ModuleInfo[] = [
  mod("a-lib", "A Library", ["base"]),
  mod("b-tabs", "Tabs", ["base"]),
  mod(ORE, "Ore Mod", ["base", "a-lib"]),
  mod("d-glue", "Glue", [ORE]),
  mod(MACHINES, MACHINES_TITLE, ["base", "d-glue"], [FILLERS[0]!]),
  mod(UNREAD, UNREAD, []),
  ...FILLERS.map((name, index) => mod(name, `Filler ${index + 1}`, ["base"])),
];

/** The mods a project switches, and the ones it does not: they add neither a signal nor a wired entity. */
export const LISTED_MODS: readonly string[] = [ORE, MACHINES, UNREAD, ...FILLERS];
export const UNLISTED_MODS: readonly string[] = ["a-lib", "b-tabs", "d-glue"];

export const ORE_ITEM = "mod-ore";
export const ORE_RECYCLING = "mod-ore-recycling";
export const MACHINE_CRATE = "machine-crate";
export const UNREAD_SIGNAL = "unread-signal";
/** Signals of `base` in a subgroup that Space Age created, and in a subgroup of its own in the group that Space Age created. */
export const BASE_IN_SPACE_AGE_ROW = "base-in-space-age-row";
export const BASE_IN_SPACE_TAB = "base-in-space-tab";
export const fillerSignal = (module: string): string => `${module}-signal`;

export function manyModsCatalog(): CatalogData {
  const data = catalog as unknown as CatalogData;
  return {
    ...data,
    modules: [...data.modules, ...MANY_MODS],
    groups: [...data.groups, { name: "mod-tab", displayName: "Mod tab", order: "zz", modules: ["b-tabs"] }],
    subgroups: [...data.subgroups, { name: "mod-row", group: "mod-tab", order: "a", modules: ["b-tabs"] }, { name: "base-row", group: "space", order: "zz", modules: ["base"] }],
    signals: {
      ...data.signals,
      item: [
        ...data.signals.item!,
        { name: ORE_ITEM, displayName: "Mod ore", order: "a", subgroup: "mod-row", stackSize: 50, weight: 2000, modules: [ORE] },
        { name: MACHINE_CRATE, displayName: "Machine crate", order: "zz", subgroup: "storage", stackSize: 50, weight: 20000, modules: [MACHINES] },
      ],
      recipe: [...data.signals.recipe!, { name: ORE_RECYCLING, displayName: "Mod ore recycling", order: "b", subgroup: "mod-row", modules: ["recycler", ORE] }],
      entity: [
        ...data.signals.entity!,
        { name: MACHINE_CRATE, displayName: "Machine crate", order: "zz", subgroup: "storage", prototype: "container", visibility: "hidden", placedBy: [MACHINE_CRATE], modules: [MACHINES] },
      ],
      virtual: [
        ...data.signals.virtual!,
        { name: UNREAD_SIGNAL, displayName: "Unread signal", order: "zy", subgroup: "virtual-signal", visibility: "hidden", hidden: true, modules: [UNREAD] },
        { name: BASE_IN_SPACE_AGE_ROW, displayName: "Base in a Space Age row", order: "zz", subgroup: "agriculture", modules: ["base"] },
        { name: BASE_IN_SPACE_TAB, displayName: "Base in the Space tab", order: "zz", subgroup: "base-row", modules: ["base"] },
        ...FILLERS.map((module) => ({ name: fillerSignal(module), displayName: `Signal of ${module}`, order: `zx-${module}`, subgroup: "virtual-signal", modules: [module] })),
      ],
    },
  };
}

/** The data of the entity table, as a file read from the game has it. */
export function manyModsEntities(): Readonly<Record<string, unknown>> & { readonly entities: readonly { readonly modules?: readonly string[] }[] } {
  return { ...entities, entities: [...entities.entities, { name: MACHINE_CRATE, type: "container", displayName: "Machine crate", width: 2, height: 2, modules: [MACHINES] }] };
}
