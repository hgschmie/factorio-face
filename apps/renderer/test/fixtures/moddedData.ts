// Game data as the main process hands it to a window after the game was read: the standard game with one mod, which adds a
// crate a wire connects to and a virtual signal. Made from the built-in tables, so the tests need no game.
import type { CatalogData } from "@face/catalog";
import type { GameDataInUse, GameMod } from "../../../desktop/src/ipc.ts";
import catalog from "../../../../packages/catalog/data/catalog-2.1.24.json" with { type: "json" };
import entities from "../../../../packages/model/data/entities-2.1.24.json" with { type: "json" };

export const MOD = "some-mod";
export const MOD_ENTITY = "mod-crate";
export const MOD_SIGNAL = "mod-signal";
export const MODDED_MODS: readonly GameMod[] = [...catalog.modules.map(({ name, version }) => ({ name, version })), { name: MOD, version: "1.2.3" }];
export const MODDED_SOURCE = { kind: "game", version: "2.1.24", build: 87808, readAt: "2026-11-14T12:00:00.000Z", mods: 1 } as const;

/** `without`: prototypes the game lacks after all. */
export function moddedData(without: readonly string[] = []): GameDataInUse {
  const data = catalog as unknown as CatalogData;
  return {
    source: MODDED_SOURCE,
    problem: null,
    mods: MODDED_MODS,
    catalog: {
      ...data,
      modules: [...data.modules, { name: MOD, title: MOD, version: "1.2.3", requires: [], recommends: [], featureFlags: [] }],
      signals: {
        ...data.signals,
        virtual: [...data.signals.virtual!, { name: MOD_SIGNAL, displayName: "Mod signal", order: "zz", subgroup: "virtual-signal", modules: [] }],
        entity: [...data.signals.entity!, { name: MOD_ENTITY, displayName: "Mod crate", order: "zz", subgroup: "storage", prototype: "container", visibility: "hidden", placedBy: [MOD_ENTITY], modules: [] }],
      },
    },
    entities: { ...entities, entities: [...entities.entities.filter((entity) => !without.includes(entity.name)), { name: MOD_ENTITY, type: "container", displayName: "Mod crate", width: 2, height: 2, modules: [] }] },
  };
}
