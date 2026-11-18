// The entity and signal data this window works with: the one that comes with the build, or the one the main process read
// from the user's game. It is applied once, before the first circuit is read: the model's entity table and the catalog are
// what everything else looks things up in.
import { createCatalog, loadStandardCatalog, setCatalog, STANDARD_CATALOG_VERSION } from "@face/catalog";
import { parseEntityTable, setEntityTable, STANDARD_ENTITY_TABLE } from "@face/model";
import type { FaceApi, GameDataInUse, GameDataSource, GameMod } from "../../../desktop/src/ipc.ts";

export interface DataInUse {
  readonly source: GameDataSource;
  /** What the game of the data had loaded, its own modules and its mods; for the built-in data the modules of the catalog. */
  readonly mods: readonly GameMod[];
  /** Why data read from the game is not in use although there is some. */
  readonly problem: string | null;
  /**
   * The ids of the icons the main process has in its icon table; no other one is asked for. A game with mods can have
   * signals, groups and entities whose icon is not among them, and an icon of a mod that is among them may not load when the
   * mod is gone. Null when the main process did not say: every icon is then asked for.
   */
  readonly icons: ReadonlySet<string> | null;
}

export function builtInData(problem: string | null = null, icons: ReadonlySet<string> | null = null): DataInUse {
  const mods = loadStandardCatalog().modules.map(({ name, version }) => ({ name, version }));
  return { source: { kind: "built-in", version: STANDARD_CATALOG_VERSION }, mods, problem, icons };
}

/** The icon ids as they came over IPC; null for anything but a list of strings. */
export function parseIconIds(value: unknown): ReadonlySet<string> | null {
  return Array.isArray(value) && value.every((id) => typeof id === "string") ? new Set<string>(value) : null;
}

const FALLBACK = "The built-in data is in use.";

/**
 * Makes the given data the one the editor works with. Data the editor cannot work with after all (the main process checked
 * it, so this is a defect or a file changed under it) leaves the built-in data in place, with the reason.
 */
export function applyData(given: GameDataInUse): DataInUse {
  // Whatever tables the editor ends up with, the main process draws the icons of the data it handed over.
  const icons = parseIconIds(given.icons);
  if (given.catalog === null || given.entities === null) {
    setEntityTable(STANDARD_ENTITY_TABLE);
    setCatalog(undefined);
    return builtInData(given.problem, icons);
  }
  try {
    const catalog = createCatalog(given.catalog);
    // Throws, and changes nothing, for a table without one of the editor's own prototypes.
    setEntityTable(parseEntityTable(given.entities));
    setCatalog(catalog);
    return { source: given.source, mods: given.mods, problem: given.problem, icons };
  } catch (error) {
    setEntityTable(STANDARD_ENTITY_TABLE);
    setCatalog(undefined);
    return builtInData(`The data read from your game cannot be used: ${error instanceof Error ? error.message : String(error)}. ${FALLBACK}`, icons);
  }
}

/** Asks the main process for the data of this window and applies it. Never rejects; without the desktop app the built-in data applies. */
export async function loadDataInUse(api: FaceApi | undefined): Promise<DataInUse> {
  if (!api) return builtInData();
  const result = await api.getGameData().catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
  return result.ok ? applyData(result.value) : builtInData(`The data of the game could not be loaded: ${result.error}. ${FALLBACK}`);
}
