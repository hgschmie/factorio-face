// The dialog that hides signals and entities of a module, as view logic: what its lists hold, the selection of a list under
// the mouse and the keys, what a move stores, and the words around the lists.
import { describe, expect, it } from "vitest";
import {
  afterArriving, afterLeaving, emptyNote, firstSide, hideItems, itemLists, keysToMove, listCount, moveItems, NO_SELECTION, openLabel, pickItem, selectAllItems, selectedKeys, showItems, sideCount,
  stepItem,
  type ListSelection,
} from "../src/settings/moduleItems.ts";
import type { ModuleItem } from "../src/workbench/controller.ts";

const item = (key: string, label: string): ModuleItem => ({ key, label });
// In the order of the picker, which is not the order of the names.
const ITEMS = [item("item:wooden-chest", "Wooden chest"), item("item:iron-chest", "Iron chest"), item("item:steel-chest", "Steel chest"), item("fluid:water", "Water"), item("virtual:signal-A", "Signal A")];
const KEYS = ITEMS.map((entry) => entry.key);
const keys = (list: readonly ModuleItem[]): string[] => list.map((entry) => entry.key);
const selected = (selection: ListSelection): string[] => [...selection.keys];

describe("the two lists of a side", () => {
  it("split what the module has by what is hidden, each in the order of the picker", () => {
    expect(itemLists(ITEMS, [])).toEqual({ shown: ITEMS, hidden: [], counts: { shown: 5, hidden: 0 } });
    // Stored in the order it was hidden in: the list has the game's order all the same.
    const lists = itemLists(ITEMS, ["virtual:signal-A", "item:iron-chest"]);
    expect(keys(lists.shown)).toEqual(["item:wooden-chest", "item:steel-chest", "fluid:water"]);
    expect(keys(lists.hidden)).toEqual(["item:iron-chest", "virtual:signal-A"]);
    expect(lists.counts).toEqual({ shown: 3, hidden: 2 });
  });

  it("list nothing for what is stored but is not of the module's data", () => {
    const lists = itemLists(ITEMS, ["item:gone-with-the-mod", "fluid:water"]);
    expect(keys(lists.hidden)).toEqual(["fluid:water"]);
    expect(lists.counts).toEqual({ shown: 4, hidden: 1 });
  });

  it("are narrowed by a filter on the name in the game or the internal name, whatever the case", () => {
    const lists = itemLists(ITEMS, ["item:steel-chest"], "  CHEST ");
    expect([keys(lists.shown), keys(lists.hidden)]).toEqual([["item:wooden-chest", "item:iron-chest"], ["item:steel-chest"]]);
    // The counts are those of the whole lists.
    expect(lists.counts).toEqual({ shown: 4, hidden: 1 });
    expect(keys(itemLists(ITEMS, [], "signal-a").shown)).toEqual(["virtual:signal-A"]);
    expect(keys(itemLists(ITEMS, [], "fluid:").shown)).toEqual(["fluid:water"]);
    expect(itemLists(ITEMS, KEYS, "no such thing")).toMatchObject({ shown: [], hidden: [], counts: { shown: 0, hidden: 5 } });
    expect(itemLists(ITEMS, [], "   ").shown).toEqual(ITEMS);
  });

  it("say how many they have, and how many of them the filter leaves", () => {
    expect([listCount(12, 12), listCount(5, 12), listCount(0, 12), listCount(0, 0)]).toEqual(["12", "5 of 12", "0 of 12", "0"]);
    expect([sideCount(ITEMS, []), sideCount(ITEMS, ["fluid:water", "item:gone"]), sideCount([], [])]).toEqual(["5", "5, 1 hidden", "0"]);
  });

  it("say why a list is empty", () => {
    expect(emptyNote("hidden", "signals", 0)).toBe("No signal is hidden.");
    expect(emptyNote("hidden", "entities", 0)).toBe("No entity is hidden.");
    expect(emptyNote("shown", "signals", 0)).toBe("Every signal is hidden.");
    expect(emptyNote("shown", "entities", 0)).toBe("Every entity is hidden.");
    expect(emptyNote("shown", "entities", 3)).toBe("Nothing matches the filter.");
  });

  it("open with the signals, or with the entities of a module that has no signal", () => {
    expect(firstSide({ signals: ITEMS, entities: [] })).toBe("signals");
    expect(firstSide({ signals: ITEMS, entities: ITEMS })).toBe("signals");
    expect(firstSide({ signals: [], entities: ITEMS })).toBe("entities");
    expect(firstSide({ signals: [], entities: [] })).toBe("signals");
  });

  it("name the module on the button that opens them", () => {
    expect(openLabel({ title: "Space Age" })).toBe("Signals and entities of Space Age");
    expect(openLabel({ title: "x".repeat(200) })).toBe(`Signals and entities of ${"x".repeat(60)}...`);
  });
});

describe("moving between the lists", () => {
  it("stores what is hidden, each once, and keeps what the data does not have", () => {
    expect(hideItems(["item:gone"], ["fluid:water", "item:iron-chest"])).toEqual(["item:gone", "fluid:water", "item:iron-chest"]);
    expect(hideItems(["fluid:water"], ["fluid:water", "item:iron-chest", "item:iron-chest"])).toEqual(["fluid:water", "item:iron-chest"]);
    expect(showItems(["item:gone", "fluid:water", "item:iron-chest"], ["fluid:water", "item:not-hidden"])).toEqual(["item:gone", "item:iron-chest"]);
    expect(showItems([], ["fluid:water"])).toEqual([]);
  });

  it("changes one side of the module's entry and leaves the other alone", () => {
    const stored = { module: "base", signals: ["item:gone"], entities: ["wooden-chest"] };
    expect(moveItems(stored, "signals", "hidden", ["fluid:water"])).toEqual({ module: "base", signals: ["item:gone", "fluid:water"], entities: ["wooden-chest"] });
    expect(moveItems(stored, "entities", "shown", ["wooden-chest"])).toEqual({ module: "base", signals: ["item:gone"], entities: [] });
    expect(moveItems(stored, "entities", "hidden", ["iron-chest"])).toEqual({ module: "base", signals: ["item:gone"], entities: ["wooden-chest", "iron-chest"] });
    expect(stored).toEqual({ module: "base", signals: ["item:gone"], entities: ["wooden-chest"] });
  });

  it("hides and shows all that a filter leaves, and nothing else", () => {
    const filtered = itemLists(ITEMS, ["item:steel-chest", "fluid:water"], "chest");
    const hiddenAll = hideItems(["item:steel-chest", "fluid:water"], keys(filtered.shown));
    expect(hiddenAll).toEqual(["item:steel-chest", "fluid:water", "item:wooden-chest", "item:iron-chest"]);
    expect(keys(itemLists(ITEMS, hiddenAll).shown)).toEqual(["virtual:signal-A"]);
    const shownAll = showItems(hiddenAll, keys(itemLists(ITEMS, hiddenAll, "chest").hidden));
    expect(shownAll).toEqual(["fluid:water"]);
  });

  it("leaves the list they left without a selection, with the next row as the active one", () => {
    expect(afterLeaving(ITEMS, ["item:iron-chest"])).toEqual({ keys: new Set(), anchor: null, active: "item:steel-chest" });
    expect(afterLeaving(ITEMS, ["item:iron-chest", "item:steel-chest", "virtual:signal-A"]).active).toBe("fluid:water");
    // At the end of the list the row before; none when the list is empty then.
    expect(afterLeaving(ITEMS, ["fluid:water", "virtual:signal-A"]).active).toBe("item:steel-chest");
    expect(afterLeaving(ITEMS, KEYS).active).toBeNull();
    expect(afterLeaving(ITEMS, [])).toEqual(NO_SELECTION);
  });

  it("selects them in the list they arrive in", () => {
    expect(afterArriving(["item:iron-chest", "fluid:water"])).toEqual({ keys: new Set(["item:iron-chest", "fluid:water"]), anchor: "item:iron-chest", active: "item:iron-chest" });
    expect(afterArriving([])).toEqual(NO_SELECTION);
  });
});

describe("the selection of a list", () => {
  const one = pickItem(ITEMS, NO_SELECTION, "item:iron-chest");

  it("is the row that is clicked", () => {
    expect(one).toEqual({ keys: new Set(["item:iron-chest"]), anchor: "item:iron-chest", active: "item:iron-chest" });
    expect(selected(pickItem(ITEMS, one, "fluid:water"))).toEqual(["fluid:water"]);
    expect(pickItem(ITEMS, one, "item:not-in-the-list")).toBe(one);
  });

  it("gets or loses a row with Cmd or Ctrl", () => {
    const two = pickItem(ITEMS, one, "fluid:water", "toggle");
    expect(two).toEqual({ keys: new Set(["item:iron-chest", "fluid:water"]), anchor: "fluid:water", active: "fluid:water" });
    expect(selected(pickItem(ITEMS, two, "item:iron-chest", "toggle"))).toEqual(["fluid:water"]);
    expect(selected(pickItem(ITEMS, pickItem(ITEMS, two, "fluid:water", "toggle"), "item:iron-chest", "toggle"))).toEqual([]);
  });

  it("extends from the row chosen last to the row clicked with Shift, in either direction", () => {
    const down = pickItem(ITEMS, one, "fluid:water", "extend");
    expect(down).toEqual({ keys: new Set(["item:iron-chest", "item:steel-chest", "fluid:water"]), anchor: "item:iron-chest", active: "fluid:water" });
    // The anchor stays: another Shift-click replaces the range.
    expect(selected(pickItem(ITEMS, down, "item:wooden-chest", "extend"))).toEqual(["item:wooden-chest", "item:iron-chest"]);
    expect(selected(pickItem(ITEMS, pickItem(ITEMS, one, "virtual:signal-A", "toggle"), "item:steel-chest", "extend"))).toEqual(["item:steel-chest", "fluid:water", "virtual:signal-A"]);
    // Without a row to extend from, the row alone.
    expect(pickItem(ITEMS, NO_SELECTION, "fluid:water", "extend")).toEqual({ keys: new Set(["fluid:water"]), anchor: "fluid:water", active: "fluid:water" });
  });

  it("moves with the arrow keys, Home and End, and stops at the ends", () => {
    expect(stepItem(ITEMS, one, "next")).toEqual({ keys: new Set(["item:steel-chest"]), anchor: "item:steel-chest", active: "item:steel-chest" });
    expect(stepItem(ITEMS, one, "previous").active).toBe("item:wooden-chest");
    expect(stepItem(ITEMS, stepItem(ITEMS, one, "previous"), "previous").active).toBe("item:wooden-chest");
    expect(stepItem(ITEMS, one, "last").active).toBe("virtual:signal-A");
    expect(stepItem(ITEMS, stepItem(ITEMS, one, "last"), "next").active).toBe("virtual:signal-A");
    expect(stepItem(ITEMS, one, "first").active).toBe("item:wooden-chest");
    // From no active row: into the list at its top, or at its end with the up arrow.
    expect(stepItem(ITEMS, NO_SELECTION, "next").active).toBe("item:wooden-chest");
    expect(stepItem(ITEMS, NO_SELECTION, "previous").active).toBe("virtual:signal-A");
    expect(stepItem([], one, "next")).toBe(one);
  });

  it("extends with Shift and an arrow key from where it began", () => {
    const two = stepItem(ITEMS, one, "next", true);
    const three = stepItem(ITEMS, two, "next", true);
    expect(three).toEqual({ keys: new Set(["item:iron-chest", "item:steel-chest", "fluid:water"]), anchor: "item:iron-chest", active: "fluid:water" });
    expect(selected(stepItem(ITEMS, three, "previous", true))).toEqual(["item:iron-chest", "item:steel-chest"]);
    expect(selected(stepItem(ITEMS, one, "first", true))).toEqual(["item:wooden-chest", "item:iron-chest"]);
    expect(selected(stepItem(ITEMS, one, "last", true))).toEqual(["item:iron-chest", "item:steel-chest", "fluid:water", "virtual:signal-A"]);
  });

  it("goes on from the active row after rows left the list", () => {
    const left = afterLeaving(ITEMS, ["item:iron-chest"]);
    const rest = ITEMS.filter((entry) => entry.key !== "item:iron-chest");
    expect(keysToMove(rest, left)).toEqual(["item:steel-chest"]);
    expect(selected(stepItem(rest, left, "next"))).toEqual(["fluid:water"]);
  });

  it("is all of the list with Cmd or Ctrl+A", () => {
    expect(selectAllItems(ITEMS, one)).toEqual({ keys: new Set(KEYS), anchor: "item:iron-chest", active: "item:iron-chest" });
    expect(selectAllItems(ITEMS, NO_SELECTION)).toEqual({ keys: new Set(KEYS), anchor: "item:wooden-chest", active: "item:wooden-chest" });
    expect(selectAllItems([], NO_SELECTION)).toEqual(NO_SELECTION);
    // Of a filtered list: what the filter leaves.
    const chests = itemLists(ITEMS, [], "chest").shown;
    expect(selected(selectAllItems(chests, one))).toEqual(["item:wooden-chest", "item:iron-chest", "item:steel-chest"]);
  });

  it("acts on the rows the list has: a selected row the filter took away stays where it is", () => {
    const all = selectAllItems(ITEMS, NO_SELECTION);
    const chests = itemLists(ITEMS, [], "chest").shown;
    expect(selectedKeys(chests, all)).toEqual(["item:wooden-chest", "item:iron-chest", "item:steel-chest"]);
    expect(selectedKeys(ITEMS, pickItem(ITEMS, pickItem(ITEMS, NO_SELECTION, "virtual:signal-A"), "item:wooden-chest", "toggle"))).toEqual(["item:wooden-chest", "virtual:signal-A"]);
    expect(selectedKeys(itemLists(ITEMS, [], "water").shown, one)).toEqual([]);
  });

  it("moves with Enter what is selected, or the active row while none is", () => {
    expect(keysToMove(ITEMS, pickItem(ITEMS, one, "fluid:water", "toggle"))).toEqual(["item:iron-chest", "fluid:water"]);
    expect(keysToMove(ITEMS, { ...NO_SELECTION, active: "fluid:water" })).toEqual(["fluid:water"]);
    expect(keysToMove(ITEMS, NO_SELECTION)).toEqual([]);
    expect(keysToMove(ITEMS, { ...NO_SELECTION, active: "item:not-in-the-list" })).toEqual([]);
    // A selection the filter took away is not moved, and neither is an active row that is not in the list.
    expect(keysToMove(itemLists(ITEMS, [], "water").shown, one)).toEqual([]);
  });
});
