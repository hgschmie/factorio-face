// Game data as a window gets it after a game with mods was read, for the prototypes a mod adds to the kinds of the editor: the
// entity table of tests/fixtures/game/moddedEntities.ts (a modded prototype of every type with a kind of its own, a loader of
// one tile, and two without a kind) and a catalog that has each of them in an item subgroup of the game.
import type { CatalogData } from "@face/catalog";
import type { GameDataInUse } from "../../../desktop/src/ipc.ts";
import catalog from "../../../../packages/catalog/data/catalog-2.1.24.json" with { type: "json" };
import entities from "../../../../packages/model/data/entities-2.1.24.json" with { type: "json" };
import { MODDED_RECORDS, type ModdedName } from "../../../../tests/fixtures/game/moddedEntities.ts";
import { MOD, MOD_MODULE, MODDED_MODS, MODDED_SOURCE, STANDARD_ICONS } from "./moddedData.ts";

/** Where the game sorts each of them: its item subgroup and its order string. One lamp comes before the lamp of the game. */
const PLACE: Readonly<Record<ModdedName, readonly [subgroup: string, order: string]>> = {
  "mod-constant": ["circuit-network", "z-c[combinators]-e[mod-constant]"],
  "mod-arithmetic": ["circuit-network", "z-c[combinators]-a[arithmetic-combinator]-b"],
  "mod-decider": ["circuit-network", "z-c[combinators]-b[decider-combinator]-b"],
  "mod-selector": ["circuit-network", "z-c[combinators]-c[selector-combinator]-b"],
  "mod-lamp": ["circuit-network", "z-a[light]-b[mod-lamp]"],
  "5d-lamp": ["circuit-network", "z-a[light]-0[5d-lamp]"],
  "mod-hidden-lamp": ["circuit-network", "z-a[light]-z"],
  "mod-pole": ["energy-pipe-distribution", "z-a[energy]-e[mod-pole]"],
  "mod-loader": ["belt", "z-d[loader]-e[mod-loader]"],
  "mod-speaker": ["circuit-network", "z-d[other]-c[mod-speaker]"],
  "mod-oddity": ["circuit-network", "z-z"],
};

/** `names`: what the game calls some of them instead, as a mod writes its names ("LTN Combinator"). */
export function moddedKindsData(names: Partial<Readonly<Record<ModdedName, string>>> = {}): GameDataInUse {
  const data = catalog as unknown as CatalogData;
  const records = MODDED_RECORDS.map((record) => ({ ...record, displayName: names[record.name] ?? record.displayName }));
  const signals = records.map(({ name, type, displayName }) => ({ name, displayName, order: PLACE[name][1], subgroup: PLACE[name][0], prototype: type, visibility: "hidden" as const, placedBy: [name], modules: [MOD] }));
  return {
    source: MODDED_SOURCE,
    problem: null,
    mods: MODDED_MODS,
    catalog: {
      ...data,
      modules: [...data.modules, MOD_MODULE],
      signals: { ...data.signals, entity: [...data.signals.entity!, ...signals] },
    },
    entities: { ...entities, entities: [...entities.entities, ...records.map((record) => ({ ...record, modules: [MOD] }))] },
    // The icons of the mod's prototypes are images of the mod: in no icon table.
    icons: STANDARD_ICONS,
  };
}
