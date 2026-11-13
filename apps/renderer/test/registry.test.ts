// The entity selector as data: the groups of the palette and their entries, the keys, the place tool that carries a
// prototype, and the open state of the groups that is remembered on this machine.
import { PROTOTYPE_NAMES, PROTOTYPES } from "@face/model";
import { describe, expect, it } from "vitest";
import { KEYED_KINDS, keyedKindOf, PALETTE_ENTRIES, PALETTE_GROUPS, paletteGroupOf, prototypeIconId } from "../src/entities/registry.ts";
import { placeFacing, sameTool, SELECT_TOOL, turnedTool, type PlaceTool } from "../src/workbench/controller.ts";
import { CIRCUIT_LIST_KEY, defaultOpenGroups, OPEN_GROUPS_KEY, readCircuitListOpen, readOpenGroups, writeCircuitListOpen, writeOpenGroups, type KeyValueStore } from "../src/workbench/paletteGroups.ts";

describe("palette registry", () => {
  it("keeps the combinators pinned and puts the other entities into groups, in this order", () => {
    expect(PALETTE_GROUPS.map(({ id, label, pinned, open, entries }) => [id, label, pinned, open, entries.map((entry) => entry.prototype)])).toEqual([
      ["combinators", "Combinators", true, true, ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"]],
      ["lights-and-sound", "Lights and sound", false, true, ["small-lamp", "programmable-speaker"]],
      ["power-poles", "Power poles", false, false, ["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"]],
    ]);
    expect(new Set(PALETTE_GROUPS.map((group) => group.id)).size).toBe(PALETTE_GROUPS.length);
  });

  it("offers every prototype the model has exactly once, with the data of the model", () => {
    expect(PALETTE_ENTRIES.map((entry) => entry.prototype).sort()).toEqual([...PROTOTYPE_NAMES].sort());
    for (const entry of PALETTE_ENTRIES) {
      expect(entry.kind).toBe(PROTOTYPES[entry.prototype].kind);
      expect(entry.label.toLowerCase()).toBe(PROTOTYPES[entry.prototype].label);
      expect(entry.description.length).toBeGreaterThan(0);
    }
    expect(PALETTE_ENTRIES).toHaveLength(10);
  });

  it("says what sets an entry apart: the tiles and the reach of a pole, nothing for a lamp", () => {
    const facts = Object.fromEntries(PALETTE_ENTRIES.map((entry) => [entry.prototype, [entry.label, entry.facts]]));
    expect(facts).toEqual({
      "constant-combinator": ["Constant combinator", ""],
      "arithmetic-combinator": ["Arithmetic combinator", ""],
      "decider-combinator": ["Decider combinator", ""],
      "selector-combinator": ["Selector combinator", ""],
      "small-lamp": ["Lamp", ""],
      "programmable-speaker": ["Programmable speaker", ""],
      "small-electric-pole": ["Small electric pole", "1 tile, wire reach 7.5"],
      "medium-electric-pole": ["Medium electric pole", "1 tile, wire reach 9"],
      "big-electric-pole": ["Big electric pole", "2 x 2 tiles, wire reach 32"],
      substation: ["Substation", "2 x 2 tiles, wire reach 18"],
    });
  });

  it("finds the group of an entity and the icon of a prototype", () => {
    expect(paletteGroupOf({ kind: "lamp" })?.id).toBe("lights-and-sound");
    expect(paletteGroupOf({ kind: "speaker" })?.id).toBe("lights-and-sound");
    expect(paletteGroupOf({ kind: "pole" })?.id).toBe("power-poles");
    expect(paletteGroupOf({ kind: "pole", prototype: "substation" })?.id).toBe("power-poles");
    expect(paletteGroupOf({ kind: "decider" })?.pinned).toBe(true);
    expect(PROTOTYPE_NAMES.map(prototypeIconId)).toEqual(PROTOTYPE_NAMES.map((name) => `item/${name}`));
  });

  it("keeps the digit keys to the four combinators and the lamp", () => {
    expect(KEYED_KINDS).toEqual(["constant", "arithmetic", "decider", "selector", "lamp"]);
    expect(PALETTE_ENTRIES.map((entry) => keyedKindOf(entry) ?? null)).toEqual(["constant", "arithmetic", "decider", "selector", "lamp", null, null, null, null, null]);
  });
});

describe("place tool", () => {
  const pole = (prototype?: "small-electric-pole" | "big-electric-pole"): PlaceTool => ({ type: "place", kind: "pole", ...(prototype && { prototype }) });

  it("is the same tool for the same prototype, said or not, and another one for another prototype", () => {
    expect(sameTool(pole(), pole("small-electric-pole"))).toBe(true);
    expect(sameTool(pole("big-electric-pole"), pole("big-electric-pole"))).toBe(true);
    expect(sameTool(pole(), pole("big-electric-pole"))).toBe(false);
    expect(sameTool({ type: "place", kind: "lamp" }, { type: "place", kind: "lamp", prototype: "small-lamp" })).toBe(true);
    expect(sameTool({ type: "place", kind: "lamp" }, { type: "place", kind: "speaker" })).toBe(false);
    expect(sameTool({ type: "place", kind: "decider", facing: "south" }, { type: "place", kind: "decider", prototype: "decider-combinator" })).toBe(true);
    expect(sameTool(pole(), SELECT_TOOL)).toBe(false);
  });

  it("does not turn what cannot rotate: a pole and a speaker face east like a lamp", () => {
    const fixed: readonly PlaceTool[] = [pole(), pole("big-electric-pole"), { type: "place", kind: "speaker" }, { type: "place", kind: "lamp" }];
    for (const tool of fixed) {
      expect(turnedTool(tool, "clockwise")).toBeUndefined();
      expect(placeFacing({ ...tool, facing: "south" })).toBe("east");
    }
    expect(turnedTool({ type: "place", kind: "decider", prototype: "decider-combinator" }, "clockwise")).toEqual({ type: "place", kind: "decider", prototype: "decider-combinator", facing: "south" });
  });
});

describe("open groups", () => {
  const store = (initial?: string): KeyValueStore & { value: string | null } => ({
    value: initial ?? null,
    getItem(key) {
      return key === OPEN_GROUPS_KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === OPEN_GROUPS_KEY) this.value = value;
    },
  });
  const refusing: KeyValueStore = {
    getItem() {
      throw new Error("storage is switched off");
    },
    setItem() {
      throw new Error("storage is full");
    },
  };
  const START = { "lights-and-sound": true, "power-poles": false };

  it("starts with lights and sound open and the poles closed; the pinned group has no state", () => {
    expect(defaultOpenGroups()).toEqual(START);
    expect(readOpenGroups(undefined)).toEqual(START);
    expect(readOpenGroups(store())).toEqual(START);
  });

  it("reads back what was written", () => {
    const kept = store();
    writeOpenGroups(kept, { "lights-and-sound": false, "power-poles": true });
    expect(JSON.parse(kept.value!)).toEqual({ "lights-and-sound": false, "power-poles": true });
    expect(readOpenGroups(kept)).toEqual({ "lights-and-sound": false, "power-poles": true });
  });

  it("takes from the store only what it understands: known groups with a true or a false", () => {
    expect(readOpenGroups(store('{"power-poles":true}'))).toEqual({ "lights-and-sound": true, "power-poles": true });
    expect(readOpenGroups(store('{"power-poles":"yes","lights-and-sound":0,"belts":true,"combinators":false}'))).toEqual(START);
    for (const garbage of ["", "not json", "null", "true", "[true,false]", '"power-poles"', "{"]) expect(readOpenGroups(store(garbage)), garbage).toEqual(START);
    // A group that is added later starts as it is defined, whatever an older state says about the others.
    const groups = [...PALETTE_GROUPS, { id: "belts", label: "Belts", pinned: false, open: true, entries: [] }];
    expect(readOpenGroups(store('{"power-poles":true}'), groups)).toEqual({ "lights-and-sound": true, "power-poles": true, belts: true });
  });

  it("works without storage and with storage that refuses", () => {
    expect(readOpenGroups(refusing)).toEqual(START);
    expect(() => writeOpenGroups(refusing, START)).not.toThrow();
    expect(() => writeOpenGroups(undefined, START)).not.toThrow();
  });
});

describe("the list of the circuit's entities", () => {
  const memory = (): KeyValueStore & { readonly values: Map<string, string> } => {
    const values = new Map<string, string>();
    return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
  };
  const refusing: KeyValueStore = {
    getItem() {
      throw new Error("storage is switched off");
    },
    setItem() {
      throw new Error("storage is full");
    },
  };

  it("starts open, without storage, with storage that refuses and with anything but a stored false", () => {
    expect(readCircuitListOpen(undefined)).toBe(true);
    expect(readCircuitListOpen(refusing)).toBe(true);
    const store = memory();
    expect(readCircuitListOpen(store)).toBe(true);
    for (const garbage of ["", "0", "no", "null", "{}"]) {
      store.setItem(CIRCUIT_LIST_KEY, garbage);
      expect(readCircuitListOpen(store), garbage).toBe(true);
    }
  });

  it("reads back what was written, under its own key and apart from the groups", () => {
    const store = memory();
    writeOpenGroups(store, { "lights-and-sound": false, "power-poles": true });
    writeCircuitListOpen(store, false);
    expect(store.values.get(CIRCUIT_LIST_KEY)).toBe("false");
    expect(readCircuitListOpen(store)).toBe(false);
    expect(readOpenGroups(store)).toEqual({ "lights-and-sound": false, "power-poles": true });
    writeCircuitListOpen(store, true);
    expect(readCircuitListOpen(store)).toBe(true);
    expect(() => writeCircuitListOpen(refusing, false)).not.toThrow();
  });
});
