// What the palette remembers: which tab of the entity groups is on show, what is searched for, and which of its sections are
// open. It is a preference of the person at this machine, not part of a project: kept in the browser storage of the app's
// profile, so it is the same for every project. The tab and the sections survive a restart (`browserStore`); the search lasts as
// long as the window (`windowStore`), so the app does not start with a filtered list. Storage may be missing, refuse access or
// hold anything; the palette works without it. Pure apart from the two stores.

/** The part of `Storage` that is used. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The storage of the profile, or undefined where there is none or it may not be touched. */
export function browserStore(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The storage of the window: gone when the app is closed. */
export function windowStore(): KeyValueStore | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export const TAB_KEY = "face.palette.tab";
export const SEARCH_KEY = "face.palette.search";
/** A search text is what a person types into one line. */
const SEARCH_MAX_LENGTH = 80;

/** What a store holds under a key; nothing where it refuses. */
function readText(store: KeyValueStore | undefined, key: string): string | undefined {
  try {
    return store?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** A store that refuses (full, switched off) is ignored: the state then lasts as long as the view. */
function writeText(store: KeyValueStore | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Nothing to do about it.
  }
}

/** The tab that was on show last, if it is one of `groups` (the names of the groups there are now); the first of them otherwise. */
export function readTab(store: KeyValueStore | undefined, groups: readonly string[]): string | undefined {
  const stored = readText(store, TAB_KEY);
  return stored !== undefined && groups.includes(stored) ? stored : groups[0];
}

export function writeTab(store: KeyValueStore | undefined, tab: string): void {
  writeText(store, TAB_KEY, tab);
}

/** The text of the search field as it was left. */
export function readSearch(store: KeyValueStore | undefined): string {
  return (readText(store, SEARCH_KEY) ?? "").slice(0, SEARCH_MAX_LENGTH);
}

export function writeSearch(store: KeyValueStore | undefined, text: string): void {
  writeText(store, SEARCH_KEY, text.slice(0, SEARCH_MAX_LENGTH));
}

export const CIRCUIT_LIST_KEY = "face.palette.circuitListOpen";
export const IN_USE_KEY = "face.palette.inUseOpen";

/** Whether a section with a key of its own is open. It starts open; anything but a stored "false" reads as open. */
export function readSectionOpen(store: KeyValueStore | undefined, key: string): boolean {
  return readText(store, key) !== "false";
}

export function writeSectionOpen(store: KeyValueStore | undefined, key: string, open: boolean): void {
  writeText(store, key, String(open));
}

/** Whether the list of the circuit's entities under the groups is open. */
export function readCircuitListOpen(store: KeyValueStore | undefined): boolean {
  return readSectionOpen(store, CIRCUIT_LIST_KEY);
}

export function writeCircuitListOpen(store: KeyValueStore | undefined, open: boolean): void {
  writeSectionOpen(store, CIRCUIT_LIST_KEY, open);
}
