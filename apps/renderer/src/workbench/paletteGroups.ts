// Which groups of the palette are open. It is a preference of the person at this machine, not part of a project: kept in the
// browser storage of the app's profile, so it is the same for every project and survives a restart. Storage may be missing,
// refuse access or hold anything; the palette works without it. Pure apart from `browserStore`.
import { PALETTE_GROUPS, type PaletteGroup } from "../entities/registry.ts";

export const OPEN_GROUPS_KEY = "face.palette.openGroups";

/** Group id to whether it is open, for every group that can be closed. */
export type OpenGroups = Readonly<Record<string, boolean>>;

/** The part of `Storage` that is used. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The storage of the page, or undefined where there is none or it may not be touched. */
export function browserStore(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The groups as they start. */
export function defaultOpenGroups(groups: readonly PaletteGroup[] = PALETTE_GROUPS): OpenGroups {
  return Object.fromEntries(groups.filter((group) => !group.pinned).map((group) => [group.id, group.open]));
}

/** What the store says about the groups that exist, and how the others start. Anything unreadable counts as nothing stored. */
export function readOpenGroups(store: KeyValueStore | undefined, groups: readonly PaletteGroup[] = PALETTE_GROUPS): OpenGroups {
  const open = { ...defaultOpenGroups(groups) };
  try {
    const stored: unknown = JSON.parse(store?.getItem(OPEN_GROUPS_KEY) ?? "null");
    if (typeof stored !== "object" || stored === null) return open;
    for (const id of Object.keys(open)) {
      const value = (stored as Readonly<Record<string, unknown>>)[id];
      if (typeof value === "boolean") open[id] = value;
    }
  } catch {
    // Not JSON, or the store refused: the groups start as they are defined.
  }
  return open;
}

/** Remembers the state. A store that refuses (full, switched off) is ignored: the state then lasts as long as the window. */
export function writeOpenGroups(store: KeyValueStore | undefined, open: OpenGroups): void {
  try {
    store?.setItem(OPEN_GROUPS_KEY, JSON.stringify(open));
  } catch {
    // Nothing to do about it.
  }
}
