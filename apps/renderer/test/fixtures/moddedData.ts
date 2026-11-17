// Game data as the main process hands it to a window after the game was read: the standard game with one mod, which adds a
// crate a wire connects to and a virtual signal. Made from the built-in tables, so the tests need no game. The icons the app
// can draw are those of the standard game: the mod's own are in no icon table. As in data that was read, the mod is in the
// catalog's head with its title and what it requires, and what it created names it as its module.
import type { CatalogData } from "@face/catalog";
import type { GameDataInUse, GameMod } from "../../../desktop/src/ipc.ts";
import catalog from "../../../../packages/catalog/data/catalog-2.1.25.json" with { type: "json" };
import icons from "../../../../packages/catalog/data/icons-2.1.25.json" with { type: "json" };
import entities from "../../../../packages/model/data/entities-2.1.25.json" with { type: "json" };
import { MANY_MODS, manyModsCatalog, manyModsEntities } from "../../../../tests/fixtures/game/moddedCatalog.ts";

export const MOD = "some-mod";
export const MOD_ENTITY = "mod-crate";
export const MOD_SIGNAL = "mod-signal";
export const MOD_MODULE = { name: MOD, title: "Some Mod", version: "1.2.3", requires: ["base"], recommends: [], featureFlags: [] } as const;
/** The module list of a project that has everything of this game on: the mod is off in a new one. */
export const MODDED_MODULES: readonly string[] = [...catalog.modules.map((module) => module.name), MOD];
export const MODDED_MODS: readonly GameMod[] = [...catalog.modules.map(({ name, version }) => ({ name, version })), { name: MOD, version: "1.2.3" }];
export const MODDED_SOURCE = { kind: "game", version: "2.1.25", build: 88022, readAt: "2026-11-14T12:00:00.000Z", mods: 1 } as const;
/** The ids of the standard icon table: what the main process says it can draw, for the built-in data and for this game. */
export const STANDARD_ICONS: readonly string[] = Object.keys(icons.icons);

/** `without`: prototypes the game lacks after all. */
export function moddedData(without: readonly string[] = []): GameDataInUse {
  const data = catalog as unknown as CatalogData;
  return {
    source: MODDED_SOURCE,
    problem: null,
    mods: MODDED_MODS,
    catalog: {
      ...data,
      modules: [...data.modules, MOD_MODULE],
      signals: {
        ...data.signals,
        virtual: [...data.signals.virtual!, { name: MOD_SIGNAL, displayName: "Mod signal", order: "zz", subgroup: "virtual-signal", modules: [MOD] }],
        entity: [...data.signals.entity!, { name: MOD_ENTITY, displayName: "Mod crate", order: "zz", subgroup: "storage", prototype: "container", visibility: "hidden", placedBy: [MOD_ENTITY], modules: [MOD] }],
      },
    },
    entities: { ...entities, entities: [...entities.entities.filter((entity) => !without.includes(entity.name)), { name: MOD_ENTITY, type: "container", displayName: "Mod crate", width: 2, height: 2, modules: [MOD] }] },
    icons: STANDARD_ICONS,
  };
}

/** The game with the many mods of tests/fixtures/game/moddedCatalog.ts, as a window gets it. */
export function manyModsData(): GameDataInUse {
  const mods = [...catalog.modules, ...MANY_MODS].map(({ name, version }) => ({ name, version }));
  return { source: { ...MODDED_SOURCE, mods: MANY_MODS.length }, problem: null, mods, catalog: manyModsCatalog(), entities: manyModsEntities(), icons: STANDARD_ICONS };
}
