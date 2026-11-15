// The settings table of the generic entities against the game's API reference and the entity table: every field of every control
// behaviour the 98 prototypes have is a setting, a flag folded into one, or named as kept only, so that nothing is forgotten silently.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOTH_NETWORKS, canRotate, conditionKey, conditionRole, ENABLE_CONDITION, ENTITY_SETTINGS, entityNameBase, entityTable, facingOf, findTileOverlaps, footprintBox, gamePrototype, isPrototypeName, isSettingValue, isTileCenter,
  normalizedSettings, normalizeSettings, occupiedTiles, parseEntityTable, PROTOTYPE_NAMES, PROTOTYPES, prototypeData, prototypesOf, rotateTile, sameSetting, setEntityTable, settingDefault, settingFields, settingShown, settingSpecsOf,
  signal, STANDARD_ENTITY_TABLE, TERMINALS, tileCenter, tileHalves, tileSize, UNSET_CONDITION, wireReachBetween, wireSpan,
  type Condition, type ConditionSetting, type Direction, type EntityShape, type SettingSpec, type SettingValue,
} from "../src/index.ts";
import standard from "../data/entities-2.1.24.json" with { type: "json" };
import { extractControlBehaviors, type BehaviorField, type ControlBehaviors } from "./controlBehaviors.ts";

const API_REFERENCE = "/Users/henning/factorio/factorio-data/runtime-api.json";
const reference = JSON.parse(readFileSync(new URL("../../../tests/fixtures/game/control-behaviors-2.1.23.json", import.meta.url), "utf8")) as ControlBehaviors;

/** The prototype types that have a kind of their own, with the concept of their control behaviour; the electric pole has none. */
const OWN_TYPES: Readonly<Record<string, string | undefined>> = {
  "constant-combinator": "ConstantCombinatorBlueprintControlBehavior",
  "arithmetic-combinator": "ArithmeticCombinatorBlueprintControlBehavior",
  "decider-combinator": "DeciderCombinatorBlueprintControlBehavior",
  "selector-combinator": "SelectorCombinatorParameters",
  lamp: "LampBlueprintControlBehavior",
  "programmable-speaker": "ProgrammableSpeakerBlueprintControlBehavior",
  "electric-pole": undefined,
};

/** Defaults the reference states and the game has otherwise, as the test below finds them. */
const REFERENCE_DIFFERS: readonly string[] = ["asteroid-collector.include-hands: false by the reference"];

const generic = (prototype: string): EntityShape => ({ prototype });
const types = [...new Set(entityTable().entities.map((prototype) => prototype.type))].sort();
const genericTypes = types.filter((type) => !Object.hasOwn(OWN_TYPES, type));
const fieldsOf = (behavior: string): ReadonlyMap<string, BehaviorField> => new Map((reference.behaviors[behavior] ?? []).map((field) => [field.name, field]));
const A = signal("virtual", "signal-A");
const condition: Condition = { first: A, comparator: ">", second: { type: "constant", value: 5 } };

describe("the API reference", () => {
  const title = "the extract in tests/fixtures/game is what the reference at hand says";
  if (existsSync(API_REFERENCE)) {
    it(title, () => {
      expect(extractControlBehaviors(JSON.parse(readFileSync(API_REFERENCE, "utf8")))).toEqual(reference);
    });
  } else it.skip(`${title}: SKIPPED, no ${API_REFERENCE}`, () => {});

  it("names 38 control behaviours, every one of them of a type the entity table has", () => {
    expect(Object.keys(reference.behaviors)).toHaveLength(38);
    const used = new Set(types.map((type) => reference.types[type]?.behavior ?? ENTITY_SETTINGS[type]?.behavior));
    expect(Object.keys(reference.behaviors).filter((behavior) => !used.has(behavior))).toEqual([]);
  });
});

describe("the settings table", () => {
  it("has a row for every prototype type of the game without a kind of its own, and for nothing else", () => {
    expect(types).toHaveLength(48);
    // And one for the loader of one tile, which only mods wire: the row of the loader itself.
    expect(Object.keys(ENTITY_SETTINGS).sort()).toEqual([...genericTypes, "loader-1x1"].sort());
    expect(ENTITY_SETTINGS["loader-1x1"]).toBe(ENTITY_SETTINGS.loader);
    expect(genericTypes).toHaveLength(41);
    for (const [type, behavior] of Object.entries(OWN_TYPES)) expect(reference.types[type]?.behavior, type).toBe(behavior);
  });

  it("names the control behaviour the reference gives the type; two types the reference gives none are marked as assumed", () => {
    const assumed: string[] = [];
    for (const type of genericTypes) {
      const row = ENTITY_SETTINGS[type]!;
      const stated = reference.types[type]?.behavior;
      if (stated === undefined) assumed.push(type);
      else expect(row.behavior, type).toBe(stated);
      expect(row.assumed === true, type).toBe(stated === undefined);
      expect(reference.behaviors[row.behavior], type).toBeDefined();
    }
    expect(assumed).toEqual(["infinity-pipe", "linked-container"]);
  });

  it("accounts for every field of every control behaviour: a setting, the flag of one, or kept only", () => {
    for (const type of genericTypes) {
      const row = ENTITY_SETTINGS[type]!;
      const modelled = row.settings.flatMap(settingFields);
      const accounted = [...new Set([...modelled, ...(row.kept ?? [])])].sort();
      expect(accounted, `${type}: ${row.behavior}`).toEqual([...fieldsOf(row.behavior).keys()]);
      // A field is one or the other, and no two settings of a type share a word or a field other than a flag.
      expect(modelled.filter((field) => row.kept?.includes(field)), type).toEqual([]);
      expect(new Set(row.settings.map((spec) => spec.key)).size, type).toBe(row.settings.length);
      expect(new Set(row.settings.map((spec) => spec.field)).size, type).toBe(row.settings.length);
    }
  });

  it("keeps only the two structured settings and the blue signal a rail signal does not have", () => {
    expect(Object.fromEntries(genericTypes.flatMap((type) => (ENTITY_SETTINGS[type]!.kept ? [[type, ENTITY_SETTINGS[type]!.kept]] : [])))).toEqual({
      "display-panel": ["parameters"],
      lab: ["conditions"],
      "rail-signal": ["blue_output_signal"],
    });
  });

  it("gives every setting the field type the reference gives its field", () => {
    for (const type of genericTypes) {
      const row = ENTITY_SETTINGS[type]!;
      const fields = fieldsOf(row.behavior);
      const typeOf = (field: string): string => fields.get(field)!.type;
      for (const spec of row.settings) {
        const where = `${type}.${spec.key}`;
        switch (spec.type) {
          case "boolean": expect(typeOf(spec.field), where).toBe("boolean"); break;
          case "signal": expect(typeOf(spec.field), where).toBe("SignalID"); break;
          case "networks": expect(typeOf(spec.field), where).toBe("CircuitNetworkSelection"); break;
          case "condition":
            expect(typeOf(spec.field), where).toBe("CircuitCondition");
            expect(typeOf(spec.flag), where).toBe("boolean");
            break;
          case "enum":
            // The reference types the roboport's mode as a boolean in the blueprint and as a define in the class.
            if (spec.booleans) expect(typeOf(spec.field), where).toBe("boolean");
            else expect(typeOf(spec.field), where).toMatch(/^defines\.control_behavior\./);
            if (spec.flag) expect(typeOf(spec.flag.field), where).toBe("boolean");
            break;
        }
      }
    }
  });

  it("has the defaults the reference states, but for the ones the game itself has otherwise", () => {
    // The table has what the game says (fixture F-01, held against it by packages/blueprints/test/game.test.ts). Where the
    // reference at hand (2.1.23) states another default, the game (2.1.24) wins; these are the differences.
    const differing: string[] = [];
    for (const type of genericTypes) {
      const row = ENTITY_SETTINGS[type]!;
      const fields = fieldsOf(row.behavior);
      for (const spec of row.settings) {
        const where = `${type}.${spec.key}`;
        const stated = fields.get(spec.field)!.default;
        if (spec.type === "boolean" && stated !== undefined && String(spec.default) !== stated) differing.push(`${where}: ${stated} by the reference`);
        if (spec.type === "condition") {
          // The reference states no default for the flag of a wall, which the game has on.
          const flag = fields.get(spec.flag)!.default;
          if (flag === undefined) expect(spec.flagOnByDefault === true, where).toBe(type === "wall");
          else if (flag !== String(spec.flagOnByDefault ?? false)) differing.push(`${where}: ${spec.flag} ${flag} by the reference`);
        }
        if (spec.type === "enum") {
          const flagDefault = spec.flag && fields.get(spec.flag.field)!.default;
          if (spec.flag && flagDefault === "false") expect(spec.default, where).toBe(spec.flag.off);
          if (!spec.flag && stated !== undefined) expect([spec.default, `send-${spec.default}`], where).toContain(stated.replace(/^.*\./, "").replace(/_/g, "-"));
        }
      }
    }
    expect(differing).toEqual(REFERENCE_DIFFERS);
  });

  it("writes the words of an enum as the game names its values", () => {
    for (const type of genericTypes) {
      for (const spec of ENTITY_SETTINGS[type]!.settings) {
        if (spec.type !== "enum") continue;
        const where = `${type}.${spec.key}`;
        const define = fieldsOf(ENTITY_SETTINGS[type]!.behavior).get(spec.field)!.type;
        // The roboport's define is named by the class of the runtime API only.
        const values = reference.defines[spec.booleans ? "defines.control_behavior.roboport.read_items_mode" : define]!;
        const valued = spec.values.filter((entry) => entry.value !== undefined);
        expect(valued, where).toHaveLength(values.length);
        // The fluid box's values are `send_contents` and `send_segment_contents`; the word leaves the verb to the property.
        for (const { word } of valued) expect(values.filter((value) => [word, `send-${word}`].includes(value.replace(/_/g, "-"))), `${where} = ${word}`).toHaveLength(1);
        // The numbers are the game's (fixture F-01): one after the other from 0, the modes of a radar from 1.
        expect(valued.map((entry) => entry.value), where).toEqual(valued.map((_, index) => index + (type === "radar" ? 1 : 0)));
        expect(spec.values.some((entry) => entry.word === spec.default), where).toBe(true);
        expect(spec.values.filter((entry) => entry.value === undefined).map((entry) => entry.word), where).toEqual(spec.flag ? [spec.flag.off] : []);
        if (spec.booleans) for (const word of spec.booleans) expect(spec.values.some((entry) => entry.word === word), where).toBe(true);
      }
    }
  });

  it("takes the default of a signal from the prototype, and uses every default signal a generic prototype has", () => {
    const without: string[] = [];
    for (const name of prototypesOf("entity")) {
      const game = gamePrototype(generic(name));
      const specs = settingSpecsOf(name);
      const used = specs.flatMap((spec) => (spec.type === "signal" && spec.prototypeDefault !== undefined ? [spec.prototypeDefault] : []));
      expect(Object.keys(game.signals).filter((key) => !used.includes(key)), name).toEqual([]);
      for (const spec of specs) if (spec.type === "signal" && spec.prototypeDefault !== undefined && !game.signals[spec.prototypeDefault]) without.push(`${name}.${spec.key}`);
    }
    // The two chests of the crash site are containers without a signal for their empty slots.
    expect(without).toEqual(["crash-site-chest-1.empty-slots-signal", "crash-site-chest-2.empty-slots-signal"]);
    expect(settingDefault(settingSpecsOf("iron-chest").find((spec) => spec.key === "empty-slots-signal")!, gamePrototype(generic("iron-chest")))).toEqual(signal("virtual", "signal-E"));
  });

  it("writes every word as the language can: lower case words joined by hyphens, conditions as 'when' or '<role>-when'", () => {
    const keys = new Set<string>();
    const fields = new Set<string>();
    const byType: Record<string, number> = {};
    for (const row of Object.values(ENTITY_SETTINGS)) {
      for (const spec of row.settings) {
        expect(spec.key).toMatch(/^[a-z]+(-[a-z]+)*$/);
        expect(spec.label).not.toBe("");
        if (spec.type === "condition") {
          expect(spec.key === ENABLE_CONDITION || spec.key.endsWith("-when"), spec.key).toBe(true);
          expect(conditionKey(conditionRole(spec.key))).toBe(spec.key);
        } else expect(spec.key.endsWith("when"), spec.key).toBe(false);
        if (spec.type === "enum") for (const { word } of spec.values) expect(word).toMatch(/^[a-z]+(-[a-z]+)*$/);
        keys.add(spec.key);
        for (const field of settingFields(spec)) fields.add(field);
        byType[spec.type] = (byType[spec.type] ?? 0) + 1;
      }
    }
    expect(conditionRole("when")).toBeUndefined();
    expect([conditionRole("logistic-when"), conditionKey("input-left"), conditionKey(undefined)]).toEqual(["logistic", "input-left-when", "when"]);
    expect({ words: keys.size, fields: fields.size }).toEqual({ words: 77, fields: 90 });
  });
});

describe("setting values", () => {
  const specs = settingSpecsOf("fast-inserter");
  const spec = (key: string, of: readonly SettingSpec[] = specs): SettingSpec => of.find((candidate) => candidate.key === key)!;
  const inserter = gamePrototype(generic("fast-inserter"));

  it("are of the type of their setting", () => {
    const samples: Readonly<Record<string, readonly [SettingValue, unknown]>> = {
      "set-filters": [true, "true"],
      "read-hand": ["hold", "sometimes"],
      networks: [{ red: true, green: false }, "red"],
      "stack-size-signal": [A, { kind: "virtual" }],
      when: [condition, { comparator: ">", second: { type: "constant", value: 5 } }],
    };
    for (const [key, [good, bad]] of Object.entries(samples)) {
      expect(isSettingValue(spec(key), good), key).toBe(true);
      expect(isSettingValue(spec(key), bad), key).toBe(false);
      expect(isSettingValue(spec(key), undefined), key).toBe(false);
      expect(sameSetting(spec(key), good, structuredClone(good)), key).toBe(true);
    }
    expect(sameSetting(spec("when"), condition, { ...condition, comparator: "<" })).toBe(false);
    expect(sameSetting(spec("when"), condition, { ...condition, second: { type: "signal", signal: A } })).toBe(false);
    expect(sameSetting(spec("stack-size-signal"), A, signal("virtual", "signal-A", "normal"))).toBe(true);
    expect(sameSetting(spec("networks"), BOTH_NETWORKS, { red: true, green: false })).toBe(false);
  });

  it("take the unset condition for every condition: in use, without a signal, and equal to nothing but itself", () => {
    expect(UNSET_CONDITION).toBe("unset");
    for (const [type, row] of Object.entries(ENTITY_SETTINGS)) {
      for (const entry of row.settings) {
        if (entry.type === "condition") expect(isSettingValue(entry, UNSET_CONDITION), `${type} ${entry.key}`).toBe(true);
        else if (entry.type !== "enum") expect(isSettingValue(entry, UNSET_CONDITION), `${type} ${entry.key}`).toBe(false);
      }
    }
    const blank = { comparator: "<", second: { type: "constant", value: 0 } } as const;
    expect([sameSetting(spec("when"), UNSET_CONDITION, UNSET_CONDITION), sameSetting(spec("when"), UNSET_CONDITION, condition), sameSetting(spec("when"), condition, UNSET_CONDITION)]).toEqual([true, false, false]);
    // A comparison without its first signal is no value, and not the unset condition either.
    expect(isSettingValue(spec("when"), blank)).toBe(false);
    expect(normalizedSettings("fast-inserter", { when: UNSET_CONDITION, "logistic-when": UNSET_CONDITION })).toEqual({ when: UNSET_CONDITION, "logistic-when": UNSET_CONDITION });
    expect(normalizedSettings("fast-inserter", { when: blank })).toEqual({});
    // Also where the game has a condition of its own for one a blueprint leaves out: unset is not that one.
    const left = settingSpecsOf("splitter").find((entry) => entry.key === "input-left-when") as ConditionSetting;
    expect(sameSetting(left, UNSET_CONDITION, left.gameDefault!)).toBe(false);
    expect(normalizedSettings("splitter", { "input-left-when": UNSET_CONDITION })).toEqual({ "input-left-when": UNSET_CONDITION });
    expect(normalizedSettings("stone-wall", { "open-gate-when": UNSET_CONDITION })).toEqual({ "open-gate-when": UNSET_CONDITION });
  });

  it("have the defaults of the table and of the prototype", () => {
    expect(Object.fromEntries(specs.map((entry) => [entry.key, settingDefault(entry, inserter)]))).toEqual({
      when: undefined, "logistic-when": undefined, networks: BOTH_NETWORKS, "output-networks": BOTH_NETWORKS, "set-filters": false, "read-hand": "none", "set-stack-size": false,
      "stack-size-signal": signal("virtual", "signal-S"),
    });
  });

  it("are held without defaults, in the order of the table, without what the prototype does not have or cannot hold", () => {
    const written = { "set-stack-size": true, "read-hand": "none", networks: BOTH_NETWORKS, when: condition, "stack-size-signal": signal("virtual", "signal-S"), "set-filters": "yes", "read-charge": false, "output-networks": { red: false, green: false } };
    const normalized = normalizeSettings(specs, inserter, written as Record<string, SettingValue>);
    expect(normalized).toEqual({ when: condition, "output-networks": { red: false, green: false }, "set-stack-size": true });
    expect(Object.keys(normalized)).toEqual(["when", "output-networks", "set-stack-size"]);
    expect(normalizedSettings("fast-inserter", written as Record<string, SettingValue>)).toEqual(normalized);
    // A default that is true is absent, the other value is held.
    expect(normalizedSettings("iron-chest", { "read-contents": true, "read-empty-slots": true })).toEqual({ "read-empty-slots": true });
    expect(normalizedSettings("iron-chest", { "read-contents": false })).toEqual({ "read-contents": false });
    // A signal other than the prototype's default is held, and one where the prototype has none.
    expect(normalizedSettings("iron-chest", { "empty-slots-signal": A })).toEqual({ "empty-slots-signal": A });
    expect(normalizedSettings("crash-site-chest-1", { "empty-slots-signal": signal("virtual", "signal-E") })).toEqual({ "empty-slots-signal": signal("virtual", "signal-E") });
    expect(normalizedSettings("small-lamp", { networks: { red: true, green: false } })).toEqual({});
    expect(normalizedSettings("no-such-thing", { "read-contents": false })).toEqual({});
  });
});

describe("settings that belong to another one", () => {
  it("name a switch or a mode of the same row, and every signal belongs to one", () => {
    for (const [type, row] of Object.entries(ENTITY_SETTINGS)) {
      for (const setting of row.settings) {
        if (setting.type === "signal") expect(setting.shownWhile, `${type} ${setting.key}`).toBeDefined();
        if (!setting.shownWhile) continue;
        const owner = row.settings.find((candidate) => candidate.key === setting.shownWhile!.key);
        expect(owner && isSettingValue(owner, setting.shownWhile.is), `${type} ${setting.key}`).toBe(true);
        expect(owner!.shownWhile, `${type} ${setting.key}`).toBeUndefined();
      }
    }
  });

  it("are shown while that one has the value, held or by default", () => {
    const shown = (prototype: string, key: string, settings: Readonly<Record<string, SettingValue>> = {}): boolean => {
      const specs = settingSpecsOf(prototype);
      return settingShown(specs.find((candidate) => candidate.key === key)!, specs, gamePrototype(generic(prototype)), settings);
    };
    expect(shown("iron-chest", "empty-slots-signal")).toBe(false);
    expect(shown("iron-chest", "empty-slots-signal", { "read-empty-slots": true })).toBe(true);
    expect(shown("iron-chest", "read-empty-slots")).toBe(true);
    // The switch of an accumulator and of a rail signal is on in a new entity.
    expect(shown("accumulator", "output-signal")).toBe(true);
    expect(shown("accumulator", "output-signal", { "read-charge": false })).toBe(false);
    expect(shown("rail-signal", "red-signal")).toBe(true);
    expect(shown("radar", "channel")).toBe(false);
    expect(shown("radar", "channel", { mode: "universe" })).toBe(true);
    expect(shown("assembling-machine-2", "include-in-crafting")).toBe(false);
    expect(shown("assembling-machine-2", "include-in-crafting", { "read-contents": true })).toBe(true);
    expect(shown("stone-wall", "output-signal", { "read-sensor": true })).toBe(true);
  });
});

describe("the generic prototypes", () => {
  it("are the 88 of the table without a kind of their own, by name, behind the ten that have one", () => {
    expect(PROTOTYPE_NAMES).toHaveLength(98);
    const names = prototypesOf("entity");
    expect(names).toHaveLength(88);
    expect(PROTOTYPE_NAMES.slice(10)).toEqual(names);
    expect([...names]).toEqual([...names].sort());
    expect(PROTOTYPE_NAMES.slice(0, 10).every((name) => PROTOTYPES[name]!.kind !== "entity")).toBe(true);
    expect(entityTable().entities.filter((prototype) => prototype.hidden && isPrototypeName(prototype.name))).toHaveLength(13);
    for (const name of names) {
      expect(prototypeData(generic(name)).kind).toBe("entity");
      expect(settingSpecsOf(name)).toBe(ENTITY_SETTINGS[gamePrototype(generic(name)).type]!.settings);
    }
    expect(TERMINALS.entity).toEqual(["io"]);
    // A prototype with a kind of its own has no table of settings.
    expect(settingSpecsOf("small-lamp")).toEqual([]);
    expect(settingSpecsOf("toString")).toEqual([]);
    expect(isPrototypeName("gate") || isPrototypeName("straight-rail") || isPrototypeName("__proto__")).toBe(false);
  });

  it("cover the footprints of the game, from one tile to nine by nine", () => {
    const sizes = new Map<string, number>();
    for (const name of PROTOTYPE_NAMES) {
      const { width, height } = tileSize({ prototype: name }, "north");
      sizes.set(`${width}x${height}`, (sizes.get(`${width}x${height}`) ?? 0) + 1);
    }
    expect(Object.fromEntries(sizes)).toEqual({ "1x1": 41, "1x2": 8, "2x1": 4, "2x2": 10, "2x3": 2, "2x4": 1, "3x2": 2, "3x3": 17, "3x5": 1, "4x4": 3, "5x5": 6, "8x8": 2, "9x9": 1 });
  });

  it("stand on whole tiles in every direction they can face, the eighteen that are not square turned", () => {
    const oblong: string[] = [];
    for (const name of prototypesOf("entity")) {
      const shape = generic(name);
      const { width, height } = gamePrototype(shape);
      if (width !== height) {
        oblong.push(name);
        expect(canRotate(shape), name).toBe(true);
      }
      for (const direction of ["north", "east", "south", "west"] as const) {
        const turned = canRotate(shape) && (direction === "east" || direction === "west");
        const size = tileSize(shape, direction);
        expect(size, `${name} ${direction}`).toEqual(turned ? { width: height, height: width } : { width, height });
        const center = tileCenter(shape, direction, { x: -3, y: 7 });
        expect(isTileCenter(shape, direction, center), `${name} ${direction}`).toBe(true);
        expect(footprintBox(shape, direction, center)).toEqual({ x: -3, y: 7, ...size });
        expect(occupiedTiles(shape, direction, center)).toHaveLength(width * height);
        // One connection point: no input and output half.
        expect(tileHalves(shape, direction, center)).toEqual({ input: { x: -3, y: 7, ...size }, output: { x: -3, y: 7, ...size } });
      }
    }
    // The four combinators with two tiles are the other four of the eighteen... of the 98; of the generic ones fifteen are not square.
    expect(oblong).toHaveLength(15);
    expect(tileSize(generic("rocket-silo"))).toEqual({ width: 9, height: 9 });
    expect(tileSize(generic("railgun-turret"), "east")).toEqual({ width: 5, height: 3 });
    expect(tileCenter(generic("boiler"), "north", { x: 0, y: 0 })).toEqual({ x: 1.5, y: 1 });
    // A quarter turn keeps the top-left tile, as for a combinator.
    expect(rotateTile(generic("boiler"), { x: 1.5, y: 1 }, "north", "east")).toEqual({ x: 1, y: 1.5 });
    expect(rotateTile(generic("assembling-machine-2"), { x: 1.5, y: 1.5 }, "north", "east")).toEqual({ x: 1.5, y: 1.5 });
  });

  it("turn as the table says: not at all, in quarter turns, and the storage tank between north and east only", () => {
    const facing = (prototype: string, direction: Direction): Direction => facingOf({ ...generic(prototype), placement: { direction } });
    expect(canRotate(generic("iron-chest"))).toBe(false);
    expect(facing("iron-chest", "south")).toBe("east");
    for (const prototype of ["fast-inserter", "rail-signal", "flamethrower-turret"]) expect((["north", "east", "south", "west"] as const).map((direction) => facing(prototype, direction)), prototype).toEqual(["north", "east", "south", "west"]);
    expect(prototypeData(generic("storage-tank")).twoWay).toBe(true);
    expect((["north", "east", "south", "west"] as const).map((direction) => facing("storage-tank", direction))).toEqual(["north", "east", "north", "east"]);
    expect(PROTOTYPE_NAMES.filter((name) => PROTOTYPES[name]!.twoWay)).toEqual(["storage-tank"]);
  });

  it("let the land mine stand anywhere: every center is its place, and it counts with the nearest tile", () => {
    const mine = generic("land-mine");
    expect(PROTOTYPE_NAMES.filter((name) => PROTOTYPES[name]!.offGrid)).toEqual(["land-mine"]);
    expect(isTileCenter(mine, "east", { x: 0.31, y: -1.2 })).toBe(true);
    expect(isTileCenter(generic("stone-wall"), "east", { x: 0.31, y: -1.2 })).toBe(false);
    expect(footprintBox(mine, "east", { x: 0.75, y: 0.5 })).toEqual({ x: 0.25, y: 0, width: 1, height: 1 });
    expect(occupiedTiles(mine, "east", { x: 0.75, y: 0.5 })).toEqual([{ x: 0, y: 0 }]);
    const overlaps = findTileOverlaps([{ id: "mine", ...mine, placement: { tile: { x: 0.75, y: 0.5 } } }, { id: "wall", ...generic("stone-wall"), placement: { tile: { x: 0.5, y: 0.5 } } }]);
    expect(overlaps).toEqual([{ tile: { x: 0, y: 0 }, entities: ["mine", "wall"] }]);
  });

  it("have the wire reach of the project, but for the power switch and the agricultural tower, which have their own", () => {
    const own = prototypesOf("entity").filter((name) => prototypeData(generic(name)).wireReach !== undefined);
    expect(own.map((name) => [name, prototypeData(generic(name)).wireReach])).toEqual([["agricultural-tower", 30], ["power-switch", 10]]);
    const [tower, power, chest] = [generic("agricultural-tower"), generic("power-switch"), generic("iron-chest")];
    expect(wireReachBetween(tower, tower, 9)).toEqual({ reach: 30, of: "agricultural-tower" });
    expect(wireReachBetween(power, tower, 9)).toEqual({ reach: 10, of: "power-switch" });
    expect(wireReachBetween(power, chest, 9)).toEqual({ reach: 9, of: "project" });
    expect(wireReachBetween(power, chest, 20)).toEqual({ reach: 10, of: "power-switch" });
    expect(wireReachBetween(chest, { prototype: "small-electric-pole" }, 9)).toEqual({ reach: 7.5, of: "small-electric-pole" });
    // The distance is between the footprints: two towers of three by three with 30 tiles between them are within reach, with 31 not.
    const at = (shape: EntityShape, x: number) => ({ ...shape, placement: { tile: tileCenter(shape, "east", { x, y: 0 }) } });
    expect(wireSpan(at(tower, 0), at(tower, 33), 9)).toMatchObject({ distance: 30, tooLong: false });
    expect(wireSpan(at(tower, 0), at(tower, 34), 9)).toMatchObject({ distance: 31, tooLong: true });
    expect(wireSpan(at(power, 0), at(chest, 12), 9)).toMatchObject({ distance: 10, reach: 9, tooLong: true });
  });

  it("name a new entity after its prototype, without a tier number and as an identifier", () => {
    const base = (prototype: string): string => entityNameBase(generic(prototype));
    expect(["fast-inserter", "steel-chest", "assembling-machine-2", "crash-site-chest-1", "stone-wall", "train-stop", "pipe-to-ground", "radar"].map(base)).toEqual([
      "fast_inserter", "steel_chest", "assembling_machine", "crash_site_chest", "stone_wall", "train_stop", "pipe_to_ground", "radar",
    ]);
    for (const name of prototypesOf("entity")) expect(base(name), name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    expect([entityNameBase({ prototype: "substation" }), entityNameBase({ prototype: "small-lamp" })]).toEqual(["pole", "lamp"]);
  });

  it("follow another entity table: a prototype of a type with settings is a generic entity, one that is gone is none", () => {
    const records = (standard as { entities: Record<string, unknown>[] }).entities;
    const chest = records.find((record) => record.name === "iron-chest")!;
    const modded = parseEntityTable({ ...standard, entities: [...records.filter((record) => record.name !== "radar"), { ...chest, name: "2x-chest", displayName: "Double chest", width: 2 }, { ...chest, name: "odd-thing", type: "simple-entity" }] });
    try {
      setEntityTable(modded);
      expect(PROTOTYPE_NAMES).toHaveLength(98);
      expect(isPrototypeName("radar")).toBe(false);
      expect(isPrototypeName("odd-thing")).toBe(false);
      expect(PROTOTYPES["2x-chest"]).toEqual({ kind: "entity", label: "double chest", width: 2, height: 1, rotatable: false });
      expect(settingSpecsOf("2x-chest")).toBe(ENTITY_SETTINGS.container!.settings);
      expect(entityNameBase(generic("2x-chest"))).toBe("_2x_chest");
      expect(prototypesOf("entity")).toContain("2x-chest");
    } finally {
      setEntityTable(STANDARD_ENTITY_TABLE);
    }
    expect(isPrototypeName("radar")).toBe(true);
    expect(isPrototypeName("2x-chest")).toBe(false);
    expect(PROTOTYPE_NAMES).toHaveLength(98);
  });
});
