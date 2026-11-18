// What the user hid of the modules, on this machine and for every project: the settings of the application hold it per module
// (`HiddenModuleItems`), and the editor does not offer what is in it. Only what is offered changes: a hidden signal or entity
// that a project uses is as valid as any other. Pure apart from `loadHiddenItems`.
import type { FaceApi, HiddenModuleItems } from "../../../desktop/src/ipc.ts";

/** A record of the game data that says which modules it is of. The first one is the module whose list it is in. */
interface Owned {
  readonly modules: readonly string[];
}

/** The rule the offers are filtered by, and the stored entries it was made from. */
export interface HiddenItems {
  /** As stored: also modules, signals and entities the data in use does not have. */
  readonly entries: readonly HiddenModuleItems[];
  /** Whether the user hid a signal of the catalog. A signal with a quality is hidden with the signal. */
  signal(entry: Owned & { readonly key: string }): boolean;
  /** Whether the user hid an entity of the entity table. */
  entity(game: Owned & { readonly name: string }): boolean;
  /** What is stored for a module; two empty lists for one with nothing hidden. */
  of(module: string): HiddenModuleItems;
}

export function hiddenItems(entries: readonly HiddenModuleItems[]): HiddenItems {
  const byModule = new Map(entries.map((entry) => [entry.module, { entry, signals: new Set(entry.signals), entities: new Set(entry.entities) }]));
  return {
    entries,
    signal: (entry) => byModule.get(entry.modules[0] ?? "")?.signals.has(entry.key) ?? false,
    entity: (game) => byModule.get(game.modules[0] ?? "")?.entities.has(game.name) ?? false,
    of: (module) => byModule.get(module)?.entry ?? { module, signals: [], entities: [] },
  };
}

export const NOTHING_HIDDEN: HiddenItems = hiddenItems([]);

/** The entries with those of one module replaced: as the settings file has them after the change. A module with nothing hidden has no entry. */
export function withHiddenModule(entries: readonly HiddenModuleItems[], items: HiddenModuleItems): readonly HiddenModuleItems[] {
  if (items.signals.length + items.entities.length === 0) return entries.filter((entry) => entry.module !== items.module);
  return entries.some((entry) => entry.module === items.module) ? entries.map((entry) => (entry.module === items.module ? items : entry)) : [...entries, items];
}

const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/** The entries as they came over IPC; anything that is not one is left out. */
export function parseHiddenItems(value: unknown): readonly HiddenModuleItems[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown): HiddenModuleItems[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { module, signals, entities } = entry as Record<string, unknown>;
    return typeof module === "string" && isNames(signals) && isNames(entities) ? [{ module, signals, entities }] : [];
  });
}

/** Asks the main process what is hidden, before the window offers anything. Never rejects: nothing is hidden when it cannot be said. */
export async function loadHiddenItems(api: FaceApi | undefined): Promise<readonly HiddenModuleItems[]> {
  if (!api) return [];
  try {
    const result = await api.getHiddenItems();
    if (result.ok) return parseHiddenItems(result.value);
    console.error("[face] the hidden signals and entities could not be loaded:", result.error);
  } catch (error) {
    console.error("[face] the hidden signals and entities could not be loaded:", error);
  }
  return [];
}
