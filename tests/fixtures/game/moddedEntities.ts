// The entity table of a game with mods, for tests: the standard one, and for every prototype type that has a kind of its own a
// modded prototype in another size than the standard one, a loader of one tile (which only mods wire), and what stays without
// a kind. As a table read from the user's game has them (`parseEntityTable`); no real mod is involved.
import standard from "../../../packages/model/data/entities-2.1.25.json" with { type: "json" };
import { parseEntityTable, setEntityTable, STANDARD_ENTITY_TABLE, type EntityTable } from "../../../packages/model/src/index.ts";

/** The records a mod adds, as the generator writes them: what is left out is the default (one tile, no direction, reach 9, module base). */
export const MODDED_RECORDS = [
  { name: "mod-constant", type: "constant-combinator", displayName: "Tiny constant combinator" },
  { name: "mod-arithmetic", type: "arithmetic-combinator", displayName: "Tiny arithmetic combinator", directions: 4 },
  { name: "mod-decider", type: "decider-combinator", displayName: "Wide decider combinator", width: 2, height: 2, directions: 4 },
  { name: "mod-selector", type: "selector-combinator", displayName: "Tiny selector combinator", directions: 4 },
  { name: "mod-lamp", type: "lamp", displayName: "Big lamp", width: 2, height: 2 },
  // A name the language has to quote: it does not read as one word.
  { name: "5d-lamp", type: "lamp", displayName: "Fifth lamp" },
  { name: "mod-hidden-lamp", type: "lamp", displayName: "Hidden lamp", hidden: true },
  { name: "mod-pole", type: "electric-pole", displayName: "Huge electric pole", width: 2, height: 2, wireReach: 48 },
  { name: "mod-loader", type: "loader-1x1", displayName: "Miniloader", directions: 4 },
  // Without a kind: the instruments of a speaker are those of the standard prototype, and the editor has nothing for a type it does not know.
  { name: "mod-speaker", type: "programmable-speaker", displayName: "Loud speaker" },
  { name: "mod-oddity", type: "simple-entity-with-owner", displayName: "Oddity" },
] as const;

export type ModdedName = (typeof MODDED_RECORDS)[number]["name"];

/** The data of the table, as a file read from the game has it. */
export function moddedEntityData(): unknown {
  return { ...standard, entities: [...standard.entities, ...MODDED_RECORDS] };
}

export const MODDED_ENTITY_TABLE: EntityTable = parseEntityTable(moddedEntityData());

/** Runs `body` with the modded table as the game data of the editor and brings the standard one back, whatever happens. */
export function withModdedTable<T>(body: () => T): T {
  setEntityTable(MODDED_ENTITY_TABLE);
  try {
    return body();
  } finally {
    setEntityTable(STANDARD_ENTITY_TABLE);
  }
}
