import { describe, expect, it } from "vitest";
import { ICON_TABLE_LIMITS, iconFileLocation, iconTableFile, IconTableError, parseIconTable } from "../../src/gameIcons/iconTable.ts";

const lamp = "__base__/graphics/icons/small-lamp.png";
const game = { version: "2.1.24", build: 87808 };
const table = (icons: unknown, more: object = {}): unknown => ({ schema: 1, game, icons, ...more });

describe("icon file locations", () => {
  it("splits a path into the module and the segments below it", () => {
    expect(iconFileLocation(lamp)).toEqual({ module: "base", segments: ["graphics", "icons", "small-lamp.png"] });
    expect(iconFileLocation("__space-age__/graphics/icons/fluid/molten-iron.png")?.module).toBe("space-age");
    expect(iconFileLocation("__core__/graphics/icons/mip/ghost-tile.png")?.segments).toEqual(["graphics", "icons", "mip", "ghost-tile.png"]);
    expect(iconFileLocation("__base__/graphics/icons/signal/signal_A.png")).toBeDefined();
  });

  it.each([
    ["__base__/../core/a.png"],
    ["__base__/graphics/../../a.png"],
    ["__base__/./a.png"],
    ["__base__/graphics//a.png"],
    ["__base__//a.png"],
    ["__base__/.hidden.png"],
    ["__base__/a.png/"],
    ["__base__/a.PNG"],
    ["__base__/a.jpg"],
    ["__base__/a"],
    ["__base__/.png"],
    ["__base__/a b.png"],
    ["__base__/a\\b.png"],
    ["__base__/a%2fb.png"],
    ["__base__/a\0.png"],
    ["__mymod__/graphics/a.png"],
    ["__BASE__/a.png"],
    ["__base/a.png"],
    ["base/a.png"],
    ["/__base__/a.png"],
    ["__base__/a.png\n"],
    ["/etc/passwd"],
    ["C:/__base__/a.png"],
    [""],
    [`__base__/${"a".repeat(ICON_TABLE_LIMITS.pathLength)}.png`],
  ])("refuses %j", (path) => {
    expect(iconFileLocation(path)).toBeUndefined();
  });
});

describe("icon table", () => {
  it("reads plain paths as 64 pixel layers and plain lists as icons that expect 64", () => {
    const parsed = parseIconTable(table({
      "item/small-lamp": [lamp],
      "recipe/small-lamp-recycling": [lamp, { icon: "__quality__/graphics/icons/recycling.png", size: 64, scale: 0.4, shift: [-8, 8.5], tint: [1, 0.5, 0, 1], floating: true }],
      "group/logistics": { expected: 128, layers: [{ icon: "__base__/graphics/item-group/logistics.png", size: 128 }] },
    }));
    expect(parsed.game).toEqual(game);
    expect([...parsed.icons.keys()]).toEqual(["item/small-lamp", "recipe/small-lamp-recycling", "group/logistics"]);
    expect(parsed.icons.get("item/small-lamp")).toEqual({ expected: 64, layers: [{ icon: lamp, size: 64 }] });
    const overlay = { icon: "__quality__/graphics/icons/recycling.png", size: 64, scale: 0.4, shift: [-8, 8.5], tint: [1, 0.5, 0, 1], floating: true };
    expect(parsed.icons.get("recipe/small-lamp-recycling")?.layers[1]).toEqual(overlay);
    expect(parsed.icons.get("group/logistics")).toEqual({ expected: 128, layers: [{ icon: "__base__/graphics/item-group/logistics.png", size: 128 }] });
  });

  it("accepts the ids the catalog uses, including variants, and no key of Object.prototype", () => {
    const ids = ["entity/factorio-logo-11tiles~space-age", "space-location/solar-system-edge", "virtual/signal-0", "recipe/a~quality+space-age"];
    const parsed = parseIconTable(table(Object.fromEntries(ids.map((id) => [id, [lamp]]))));
    expect(parsed.icons.size).toBe(4);
    for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty", "item/unknown"]) expect(parsed.icons.get(id)).toBeUndefined();
    expect(parseIconTable(table({})).icons.size).toBe(0);
    expect(parseIconTable(table({}, { game: { version: "2.1.24" } })).game).toEqual({ version: "2.1.24" });
  });

  it("writes the compact form and reads it back unchanged", () => {
    const file = {
      schema: 1,
      game,
      icons: {
        "item/small-lamp": [lamp],
        "item/barrel": [lamp, { icon: lamp, size: 64, scale: 0.5, shift: [0, -8], tint: [0.2, 0.4, 1, 0.75] }, { icon: lamp, size: 32 }, { icon: lamp, size: 64, floating: true }],
        "group/logistics": { expected: 128, layers: [{ icon: lamp, size: 128 }, lamp] },
      },
    };
    expect(iconTableFile(parseIconTable(file))).toEqual(file);
    expect(JSON.stringify(iconTableFile(parseIconTable(JSON.parse(JSON.stringify(file)))))).toBe(JSON.stringify(file));
    // A layer of 64 pixels without modifiers is written as its path, however it was given.
    expect(iconTableFile(parseIconTable(table({ "item/a": { expected: 64, layers: [{ icon: lamp, size: 64 }] } }))).icons).toEqual({ "item/a": [lamp] });
  });

  const layerOf = (more: object): unknown => table({ "item/a": [{ icon: lamp, size: 64, ...more }] });
  it.each<[string, unknown]>([
    ["no object", null],
    ["a list", []],
    ["another schema", { schema: 2, game, icons: {} }],
    ["no schema", { game, icons: {} }],
    ["no game", { schema: 1, icons: {} }],
    ["a game version that is none", table({}, { game: { version: "2.1" } })],
    ["a fractional build", table({}, { game: { version: "2.1.24", build: 1.5 } })],
    ["no icons", { schema: 1, game }],
    ["icons as a list", table([])],
    ["an id without a kind", table({ lamp: [lamp] })],
    ["an id that climbs", table({ "item/../x": [lamp] })],
    ["an id with a dot-dot name", table({ "item/..": [lamp] })],
    ["an id with a deeper path", table({ "item/a/b": [lamp] })],
    ["an id with a space", table({ "item/a b": [lamp] })],
    ["an overlong id", table({ [`item/${"a".repeat(ICON_TABLE_LIMITS.idLength)}`]: [lamp] })],
    ["an icon without layers", table({ "item/a": [] })],
    ["an icon with too many layers", table({ "item/a": Array.from({ length: ICON_TABLE_LIMITS.layers + 1 }, () => lamp) })],
    ["an icon that is a string", table({ "item/a": lamp })],
    ["an entry with an unknown field", table({ "item/a": { expected: 64, layers: [lamp], extra: 1 } })],
    ["an entry without an expected size", table({ "item/a": { layers: [lamp] } })],
    ["an expected size of 0", table({ "item/a": { expected: 0, layers: [lamp] } })],
    ["an expected size beyond the limit", table({ "item/a": { expected: 4096, layers: [lamp] } })],
    ["a layer that is a number", table({ "item/a": [1] })],
    ["a path outside the game's modules", table({ "item/a": ["__mymod__/a.png"] })],
    ["a path that climbs", table({ "item/a": ["__base__/../../secret.png"] })],
    ["an absolute path", table({ "item/a": ["/etc/passwd.png"] })],
    ["a path that is no png", table({ "item/a": ["__base__/info.json"] })],
    ["a layer object without a size", table({ "item/a": [{ icon: lamp }] })],
    ["a layer object with a bad path", layerOf({ icon: "__base__/a/../b.png" })],
    ["a layer with an unknown field", layerOf({ rotation: 1 })],
    ["a fractional size", layerOf({ size: 64.5 })],
    ["a size of 0", layerOf({ size: 0 })],
    ["a size beyond the limit", layerOf({ size: 2048 })],
    ["a size as text", layerOf({ size: "64" })],
    ["a scale of 0", layerOf({ scale: 0 })],
    ["a negative scale", layerOf({ scale: -1 })],
    ["a scale beyond the limit", layerOf({ scale: 1000 })],
    ["a scale that is no number", layerOf({ scale: null })],
    ["a shift with one component", layerOf({ shift: [1] })],
    ["a shift beyond the limit", layerOf({ shift: [0, 1e9] })],
    ["a shift with text", layerOf({ shift: ["1", 0] })],
    ["a tint with three components", layerOf({ tint: [1, 1, 1] })],
    ["a tint above 1", layerOf({ tint: [255, 0, 0, 1] })],
    ["a negative tint", layerOf({ tint: [-0.1, 0, 0, 1] })],
    ["floating that is not true", layerOf({ floating: false })],
  ])("refuses %s", (_, value) => {
    expect(() => parseIconTable(value)).toThrow(IconTableError);
  });

  it("refuses numbers JSON cannot carry", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => parseIconTable(layerOf({ scale: bad }))).toThrow(IconTableError);
      expect(() => parseIconTable(layerOf({ shift: [bad, 0] }))).toThrow(IconTableError);
      expect(() => parseIconTable(layerOf({ tint: [bad, 0, 0, 1] }))).toThrow(IconTableError);
      expect(() => parseIconTable(layerOf({ size: bad }))).toThrow(IconTableError);
    }
  });

  it("refuses a table with more icons than the limit", () => {
    const icons = Object.fromEntries(Array.from({ length: ICON_TABLE_LIMITS.icons + 1 }, (_, index) => [`item/i${index}`, [lamp]]));
    expect(() => parseIconTable(table(icons))).toThrow(/too many icons/);
  });
});
