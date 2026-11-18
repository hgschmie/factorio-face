// The dialog of a module in which the user hides its signals and entities, as view logic: what its two lists hold, what is
// selected in a list and how the mouse and the keys change that, and what is stored after a move. A name is what the game or a
// mod calls a thing: it is shown as text. Pure.
import type { HiddenModuleItems } from "../../../desktop/src/ipc.ts";
import type { ModuleItem, ModuleItems, ModuleView } from "../workbench/controller.ts";

export const SIDES = ["signals", "entities"] as const;
/** What the dialog shows: the signals of the module or its entities. */
export type Side = (typeof SIDES)[number];
export const SIDE_LABELS: Readonly<Record<Side, string>> = { signals: "Signals", entities: "Entities" };

/** The two lists of a side: what is offered, on the left, and what the user hid, on the right. */
export type ListName = "shown" | "hidden";
export const LIST_LABELS: Readonly<Record<ListName, string>> = { shown: "Shown", hidden: "Hidden" };

export const APPLIES_NOTE = "What you hide is not offered any more, in every project on this machine. A project that uses it keeps it, and anything new is shown.";
export const CLOSE_LABEL = "Close signals and entities";
export const FILTER_LABEL = "Filter by name";

/** The accessible name of the button of a row that opens the dialog; the title is cut where a mod's own text is long. */
export function openLabel(module: Pick<ModuleView, "title">): string {
  return `Signals and entities of ${module.title.length > 60 ? `${module.title.slice(0, 60)}...` : module.title}`;
}

/** The side the dialog opens with: the signals, or the entities of a module without signals. */
export function firstSide(items: ModuleItems): Side {
  return items.signals.length === 0 && items.entities.length > 0 ? "entities" : "signals";
}

export interface ItemLists {
  /** In the order of the picker or the selector, narrowed by the filter. */
  readonly shown: readonly ModuleItem[];
  readonly hidden: readonly ModuleItem[];
  /** How many each list has without the filter. */
  readonly counts: Readonly<Record<ListName, number>>;
}

/**
 * The lists of one side: `items` split by what is stored as hidden, each part in the order of `items`. With a filter a list has
 * the items whose name in the game, or whose internal name, contains the text, whatever its case.
 */
export function itemLists(items: readonly ModuleItem[], hidden: readonly string[], filter = ""): ItemLists {
  const stored = new Set(hidden);
  const query = filter.trim().toLowerCase();
  const matches = (item: ModuleItem): boolean => query === "" || item.label.toLowerCase().includes(query) || item.key.toLowerCase().includes(query);
  const all = { shown: items.filter((item) => !stored.has(item.key)), hidden: items.filter((item) => stored.has(item.key)) };
  return { shown: all.shown.filter(matches), hidden: all.hidden.filter(matches), counts: { shown: all.shown.length, hidden: all.hidden.length } };
}

/** What the switch says beside the name of a side: "771", "771, 3 hidden". */
export function sideCount(items: readonly ModuleItem[], hidden: readonly string[]): string {
  const { counts } = itemLists(items, hidden);
  return counts.hidden > 0 ? `${items.length}, ${counts.hidden} hidden` : String(items.length);
}

/** The count in the heading of a list: all of it, or what the filter leaves of it ("5 of 12"). */
export function listCount(listed: number, total: number): string {
  return listed === total ? String(total) : `${listed} of ${total}`;
}

/** What a list says in its own room while it has no row. */
export function emptyNote(list: ListName, side: Side, total: number): string {
  if (total > 0) return "Nothing matches the filter.";
  return list === "hidden" ? `No ${side === "signals" ? "signal" : "entity"} is hidden.` : `Every ${side === "signals" ? "signal" : "entity"} is hidden.`;
}

/** What is stored after hiding `keys`: they come last, each once. Whatever else is stored stays, also what the data in use does not have. */
export function hideItems(stored: readonly string[], keys: readonly string[]): readonly string[] {
  return [...new Set([...stored, ...keys])];
}

/** What is stored after showing `keys` again. */
export function showItems(stored: readonly string[], keys: readonly string[]): readonly string[] {
  const shown = new Set(keys);
  return stored.filter((key) => !shown.has(key));
}

/** The stored entry of a module after moving `keys` of one side into `to`. */
export function moveItems(stored: HiddenModuleItems, side: Side, to: ListName, keys: readonly string[]): HiddenModuleItems {
  return { ...stored, [side]: to === "hidden" ? hideItems(stored[side], keys) : showItems(stored[side], keys) };
}

/** The selection of one list. */
export interface ListSelection {
  readonly keys: ReadonlySet<string>;
  /** Where a range begins: the row that was chosen last without Shift. */
  readonly anchor: string | null;
  /** The row the keys move from; it need not be selected. */
  readonly active: string | null;
}

export const NO_SELECTION: ListSelection = { keys: new Set(), anchor: null, active: null };

const indexOf = (list: readonly ModuleItem[], key: string | null): number => (key === null ? -1 : list.findIndex((item) => item.key === key));

/** The rows from the anchor to `key`, both included; `key` alone when the anchor is not in the list. */
function range(list: readonly ModuleItem[], anchor: string | null, key: string): ListSelection {
  const [from, to] = [indexOf(list, anchor), indexOf(list, key)];
  if (from < 0) return { keys: new Set([key]), anchor: key, active: key };
  return { keys: new Set(list.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.key)), anchor, active: key };
}

/**
 * The selection after a click on a row: the row alone; with `toggle` (Cmd or Ctrl) the row is added or taken out; with `extend`
 * (Shift) everything from the anchor to the row is selected in place of what was. A key the list does not have changes nothing.
 */
export function pickItem(list: readonly ModuleItem[], selection: ListSelection, key: string, how: "only" | "toggle" | "extend" = "only"): ListSelection {
  if (indexOf(list, key) < 0) return selection;
  if (how === "extend") return range(list, selection.anchor ?? selection.active, key);
  if (how === "only") return { keys: new Set([key]), anchor: key, active: key };
  const keys = new Set(selectedKeys(list, selection));
  if (!keys.delete(key)) keys.add(key);
  return { keys, anchor: key, active: key };
}

/**
 * The selection after an arrow key, Home or End: the active row moves and is selected alone; with `extend` (Shift) everything
 * from the anchor to it is. From no active row the keys go to the first row, End and the up arrow to the last one.
 */
export function stepItem(list: readonly ModuleItem[], selection: ListSelection, to: "previous" | "next" | "first" | "last", extend = false): ListSelection {
  if (list.length === 0) return selection;
  const from = indexOf(list, selection.active);
  const last = list.length - 1;
  const index = to === "first" ? 0 : to === "last" ? last : from < 0 ? (to === "next" ? 0 : last) : Math.max(0, Math.min(last, from + (to === "next" ? 1 : -1)));
  return pickItem(list, selection, list[index]!.key, extend ? "extend" : "only");
}

/** Every row of the list selected. */
export function selectAllItems(list: readonly ModuleItem[], selection: ListSelection): ListSelection {
  const active = indexOf(list, selection.active) >= 0 ? selection.active : (list[0]?.key ?? null);
  return { keys: new Set(list.map((item) => item.key)), anchor: active, active };
}

/** The selected rows the list has, in its order: a row the filter took away is not acted on. */
export function selectedKeys(list: readonly ModuleItem[], selection: ListSelection): readonly string[] {
  return list.filter((item) => selection.keys.has(item.key)).map((item) => item.key);
}

/** What Enter moves across: the selected rows, or the active one while none is selected. */
export function keysToMove(list: readonly ModuleItem[], selection: ListSelection): readonly string[] {
  const selected = selectedKeys(list, selection);
  return selected.length > 0 || indexOf(list, selection.active) < 0 ? selected : [selection.active!];
}

/**
 * The selection of the list rows left: none is selected, and the active row is the one that follows the first row that left
 * (the one before it at the end of the list), so that the keys go on from there.
 */
export function afterLeaving(list: readonly ModuleItem[], moved: readonly string[]): ListSelection {
  const gone = new Set(moved);
  const first = list.findIndex((item) => gone.has(item.key));
  const next = list.slice(first + 1).find((item) => !gone.has(item.key)) ?? list.slice(0, Math.max(first, 0)).findLast((item) => !gone.has(item.key));
  return { ...NO_SELECTION, active: first < 0 ? null : (next?.key ?? null) };
}

/** The selection of the list rows arrived in: they are selected, so the other arrow takes them back. */
export function afterArriving(moved: readonly string[]): ListSelection {
  return { keys: new Set(moved), anchor: moved[0] ?? null, active: moved[0] ?? null };
}
