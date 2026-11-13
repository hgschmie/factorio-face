// Tests for the generator's pure parts and its icon outputs. The .mjs libraries (run by node without a build step) are
// loaded dynamically and given their types here.
import { STANDARD_CATALOG_VERSION } from "@face/catalog";
import { parseIconTable, type IconEntry, type IconTableGame } from "@face/catalog/icons";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { iconSource, renderIcon } from "../../../apps/desktop/src/gameIcons/iconRenderer.ts";
import { COMPACT_ENCODING, decodePng, encodePng, type RgbaImage } from "../../../apps/desktop/src/gameIcons/png.ts";
import { iconFileRenderer, iconTableText } from "./iconFiles.ts";
import { iconLayers, normaliseColor } from "./prototypeIcons.ts";

interface ModuleInfo { name: string; requires: string[]; recommends: string[] }
type Records = Record<string, unknown>[];
interface Built {
  catalog: { game: IconTableGame; signals: Record<string, Records>; groups: Records; subgroups: Records; qualities: Records; speakers: Records; constants: Record<string, unknown> };
  icons: Map<string, IconEntry>;
}

const load = (file: string): Promise<unknown> => import(/* @vite-ignore */ new URL(file, import.meta.url).href);
const dump = (await load("./dump.mjs")) as {
  locateGame(): { dataDir: string };
  parseDependency(text: string): { name: string; kind: string; constraint: string };
  readModuleInfos(dataDir: string): ModuleInfo[];
  validModSets(infos: ModuleInfo[]): string[][];
};
const build = (await load("./build.mjs")) as { buildCatalog(input: object): Built; visibilityOf(signal: object): string };
const sets = (await load("./sets.mjs")) as { completeDumps(dumpRoot: string, modules: ModuleInfo[]): { game: IconTableGame } | undefined; buildFromDumps(input: object): Built };
const locale = (await load("./locale.mjs")) as {
  parseLocale(text: string, sections: string[]): Record<string, Record<string, string>>;
  readLocaleSections(dataDir: string, modules: string[], sections: string[]): Record<string, Record<string, string>>;
};

const ROOT = resolve(import.meta.dirname, "../../..");
const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "face-catalog-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("prototype icons", () => {
  it("normalises icon definitions and colours", () => {
    expect(iconLayers({ icon: "__mod__/a.png" })).toEqual([{ icon: "__mod__/a.png", size: 64 }]);
    const layered = { icons: [{ icon: "__mod__/a.png", icon_size: 32, tint: { r: 255, g: 0, b: 0 }, shift: [0, 0] }], icon: "ignored" };
    expect(iconLayers(layered)).toEqual([{ icon: "__mod__/a.png", size: 32, tint: [1, 0, 0, 1] }]);
    expect(iconLayers({})).toBeUndefined();
    expect(iconLayers({ icons: [] })).toBeUndefined();
    expect(normaliseColor([0.5, 0.25, 1])).toEqual([0.5, 0.25, 1, 1]);
    expect(normaliseColor({ r: 51, g: 102, b: 255, a: 255 })).toEqual([0.2, 0.4, 1, 1]);
  });

  it("keeps scale, shift and the floating flag, and drops what changes nothing", () => {
    const layers = iconLayers({ icons: [{ icon: "__mod__/a.png", scale: 0.5, shift: { x: 4, y: -4 }, floating: true }, { icon: "__mod__/b.png", tint: [1, 1, 1, 1], shift: [8] }] });
    expect(layers).toEqual([{ icon: "__mod__/a.png", size: 64, scale: 0.5, shift: [4, -4], floating: true }, { icon: "__mod__/b.png", size: 64, shift: [8, 0] }]);
    // Identical icons are told apart by this serialisation, so the order of the fields is part of the contract.
    expect(JSON.stringify(layers?.[0])).toBe('{"icon":"__mod__/a.png","size":64,"scale":0.5,"shift":[4,-4],"floating":true}');
  });
});

describe("icon files", () => {
  const data = join(scratch, "game");
  const image = (width: number, color: (x: number) => number[]): RgbaImage => ({ width, height: 4, data: Uint8Array.from({ length: width * 16 }, (_, i) => color((i >> 2) % width)[i % 4]!) });
  // 4x4 opaque red with a 2x2 mip level to its right, and a 4x4 half-transparent white.
  const red = image(6, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255])), white = image(4, () => [255, 255, 255, 128]);
  mkdirSync(join(data, "base", "graphics", "icons"), { recursive: true });
  mkdirSync(join(data, "core"));
  writeFileSync(join(data, "base", "graphics", "icons", "red.png"), encodePng(red));
  writeFileSync(join(data, "core", "white.png"), encodePng(white));
  const layers = [{ icon: "__base__/graphics/icons/red.png", size: 4 }, { icon: "__core__/white.png", size: 4, scale: 0.25, shift: [0.5, 0.5], tint: [0, 0, 1, 1] }] as const;
  const render = iconFileRenderer(data);

  it("composites the first mip levels of the files below the data directory, in the compact encoding", () => {
    const png = render({ expected: 4, layers }, 8);
    const direct = renderIcon(layers, [iconSource(red, 4), iconSource(white, 4)], { expected: 4, output: 8 });
    expect(Buffer.compare(png, encodePng(direct, COMPACT_ENCODING))).toBe(0);
    const decoded = decodePng(png);
    expect([decoded.width, decoded.height]).toEqual([8, 8]);
    expect([...decoded.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    // The same again, now from the kept sources.
    expect(Buffer.compare(render({ expected: 4, layers }, 8), png)).toBe(0);
  });

  it("names the file it cannot use", () => {
    expect(() => render({ expected: 4, layers: [{ icon: "__base__/graphics/icons/missing.png", size: 4 }] }, 8)).toThrow(/__base__\/graphics\/icons\/missing\.png: .*ENOENT/);
    expect(() => render({ expected: 4, layers: [{ icon: "__base__/graphics/icons/red.png", size: 8 }] }, 8)).toThrow(/red\.png: .*smaller than icon size 8/);
    expect(() => render({ expected: 4, layers: [{ icon: "__mymod__/red.png", size: 4 }] }, 8)).toThrow(/Not an image file of the game/);
    expect(() => render({ expected: 4, layers: [{ icon: "__base__/../core/white.png", size: 4 }] }, 8)).toThrow(/Not an image file of the game/);
  });
});

describe("icon table file", () => {
  const lamp = "__base__/graphics/icons/small-lamp.png";
  const game = { version: "2.1.24", build: 87808 };
  const icons = new Map<string, IconEntry>([
    ["item/b", { expected: 64, layers: [{ icon: lamp, size: 64 }] }],
    ["group/g", { expected: 128, layers: [{ icon: lamp, size: 128 }] }],
    ["item/a", { expected: 64, layers: [{ icon: lamp, size: 64 }, { icon: lamp, size: 64, scale: 0.5, shift: [0, -8], tint: [0.2, 0.4, 1, 0.75] }] }],
    ["item/B", { expected: 64, layers: [{ icon: lamp, size: 64, floating: true }] }],
  ]);
  const text = iconTableText(game, icons);

  it("has one icon per line, sorted by id, in the compact form", () => {
    expect(text.split("\n")).toEqual([
      "{",
      '  "schema": 1,',
      '  "game": {"version":"2.1.24","build":87808},',
      '  "icons": {',
      `    "group/g": {"expected":128,"layers":[{"icon":"${lamp}","size":128}]},`,
      `    "item/B": [{"icon":"${lamp}","size":64,"floating":true}],`,
      `    "item/a": ["${lamp}",{"icon":"${lamp}","size":64,"scale":0.5,"shift":[0,-8],"tint":[0.2,0.4,1,0.75]}],`,
      `    "item/b": ["${lamp}"]`,
      "  }",
      "}",
      "",
    ]);
  });

  it("reads back as the table it was written from, whatever order the icons came in", () => {
    const parsed = parseIconTable(JSON.parse(text));
    expect(parsed.game).toEqual(game);
    expect(new Map([...parsed.icons].reverse())).toEqual(icons);
    expect(iconTableText(game, new Map([...icons].reverse()))).toBe(text);
    // Only what the table knows of the game is written.
    expect(iconTableText({ ...game, variant: "mac-arm64, full" } as IconTableGame, icons)).toBe(text);
  });

  it("refuses a table the app would refuse", () => {
    expect(() => iconTableText(game, new Map([["item/a", { expected: 64, layers: [{ icon: "__mymod__/a.png", size: 64 }] }]]))).toThrow(/does not name an image file of the game/);
    expect(() => iconTableText(game, new Map([["item/a b", { expected: 64, layers: [{ icon: lamp, size: 64 }] }]]))).toThrow(/Malformed icon id/);
  });
});

describe("module sets", () => {
  it("parses dependency strings", () => {
    expect(dump.parseDependency("base >= 2.1.0")).toEqual({ name: "base", kind: "required", constraint: ">= 2.1.0" });
    expect(dump.parseDependency("+ quality >= 2.1.0")).toMatchObject({ name: "quality", kind: "recommended" });
    expect(dump.parseDependency("(?) some-mod")).toMatchObject({ name: "some-mod", kind: "optional" });
    expect(dump.parseDependency("! other")).toMatchObject({ name: "other", kind: "incompatible" });
  });

  it("enumerates exactly the dependency-closed module sets", () => {
    const infos = [
      { name: "base", requires: [], recommends: [] },
      { name: "elevated-rails", requires: ["base"], recommends: [] },
      { name: "recycler", requires: ["base"], recommends: [] },
      { name: "quality", requires: ["base", "recycler"], recommends: [] },
      { name: "space-age", requires: ["base", "elevated-rails", "recycler"], recommends: ["quality"] },
    ];
    const sets = dump.validModSets(infos).map((mods) => mods.join("+"));
    expect(sets).toHaveLength(8);
    expect(sets[0]).toBe("base");
    expect(sets.at(-1)).toBe("base+elevated-rails+recycler+quality+space-age");
    expect(sets).not.toContain("base+quality");
    expect(sets).toContain("base+elevated-rails+recycler+space-age");
  });
});

describe("catalog build", () => {
  const modules = [{ name: "base", title: "Base", version: "1", requires: [], recommends: [], featureFlags: [] }, { name: "extra", title: "Extra", version: "1", requires: ["base"], recommends: [], featureFlags: [] }];
  const item = (name: string, more: object = {}) => ({ name, type: "item", order: name, group: "g", subgroup: "s", hidden: false, parameter: false, stack_size: 50, weight: 100, ...more });
  const makeSet = (mods: string[], items: ReturnType<typeof item>[], iconOf: (name: string) => string) => ({
    id: mods.join("+"),
    mods,
    raw: {
      item: Object.fromEntries(items.map((entry) => [entry.name, { icon: iconOf(entry.name) }])),
      "item-group": { g: { icon: "__base__/g.png", icon_size: 128 } },
      "utility-constants": { default: { default_item_weight: 100, default_rocket_lift_weight: 1000 } },
    },
    runtime: {
      item: items, fluid: [], virtual_signal: [], entity: [], recipe: [], space_location: [], asteroid_chunk: [], quality: [],
      item_group: [{ name: "g", order: "a" }],
      item_subgroup: [{ name: "s", group: "g", order: "a" }],
      utility_constants: { default_item_weight: 100 },
      rocket_silos: [],
    },
    locale: { item: { plate: "Plate" }, "item-group": { g: "Group" } },
  });
  const baseSet = makeSet(["base"], [item("plate"), item("gone"), item("twin")], (name) => `__base__/${name === "twin" ? "plate" : name}.png`);
  const extraSet = makeSet(["base", "extra"], [item("plate", { stack_size: 10 }), item("new"), item("twin")], (name) => `__base__/${name === "twin" ? "plate" : name}.png`);
  const { catalog, icons: iconMap } = build.buildCatalog({ sets: [extraSet, baseSet], modules, game: { version: "1" } });
  const byName = Object.fromEntries((catalog.signals.item ?? []).map((record) => [record.name, record]));

  it("derives provenance, removals and variants from the module sets", () => {
    expect(byName.plate).toMatchObject({ displayName: "Plate", stackSize: 50, modules: ["base"], variants: [{ when: ["extra"], stackSize: 10 }] });
    expect(byName.new).toMatchObject({ displayName: "new", modules: ["extra"] });
    expect(byName.new?.removedBy).toBeUndefined();
    expect(byName.gone).toMatchObject({ modules: ["base"], removedBy: ["extra"] });
    expect(catalog.groups).toEqual([{ name: "g", displayName: "Group", order: "a", modules: ["base"] }]);
    expect(catalog.subgroups).toEqual([{ name: "s", group: "g", order: "a", modules: ["base"] }]);
    expect(catalog.constants).toMatchObject({ defaultItemWeight: 100, rocketLiftWeight: 1000 });
  });

  it("shares one icon id between signals with identical layers", () => {
    expect(byName.plate?.icon).toBeUndefined();
    expect(byName.twin?.icon).toBe("item/plate");
    expect([...iconMap.keys()].sort()).toEqual(["group/g", "item/gone", "item/new", "item/plate"]);
    expect(iconMap.get("group/g")).toEqual({ layers: [{ icon: "__base__/g.png", size: 128 }], expected: 128 });
  });

  it("lists a speaker's instruments and notes in the prototype's order, with the names that differ from the display names", () => {
    const speaker = { name: "speaker", maximum_polyphony: 4, instruments: [{ name: "kit", notes: [{ name: "kick-1", sound: {} }, { name: "F#3", sound: {} }] }, { name: "empty", notes: {} }] };
    const withSpeaker = (set: typeof baseSet, names: Record<string, Record<string, string>>) => ({ ...set, raw: { ...set.raw, "programmable-speaker": { speaker } }, locale: { ...set.locale, ...names } });
    const names = { "programmable-speaker-instrument": { kit: "Drumkit" }, "programmable-speaker-note": { "kick-1": "Kick 1", "F#3": "F#3" } };
    const built = build.buildCatalog({ sets: [withSpeaker(baseSet, names), withSpeaker(extraSet, { ...names, "programmable-speaker-instrument": { kit: "Kit" } })], modules, game: { version: "1" } });
    expect(built.catalog.speakers).toEqual([
      {
        name: "speaker",
        maximumPolyphony: 4,
        instruments: [{ name: "kit", displayName: "Drumkit", notes: ["kick-1", "F#3"], noteNames: { "kick-1": "Kick 1" } }, { name: "empty", displayName: "empty", notes: [] }],
        modules: ["base"],
        variants: [{ when: ["extra"], instruments: [{ name: "kit", displayName: "Kit", notes: ["kick-1", "F#3"], noteNames: { "kick-1": "Kick 1" } }, { name: "empty", displayName: "empty", notes: [] }] }],
      },
    ]);
    // A set without a speaker prototype has none.
    expect(catalog.speakers).toEqual([]);
  });

  it("classifies signal picker visibility", () => {
    expect(build.visibilityOf({})).toBe("normal");
    expect(build.visibilityOf({ wildcard: "each", special: true })).toBe("wildcard");
    expect(build.visibilityOf({ parameter: true })).toBe("parameter");
    expect(build.visibilityOf({ special: true })).toBe("parameter");
    expect(build.visibilityOf({ special: true, hidden: true })).toBe("hidden");
    expect(build.visibilityOf({ hideFromSignalGui: true })).toBe("hidden");
    expect(build.visibilityOf({ placedBy: ["x"] })).toBe("hidden");
  });
});

describe("locale files", () => {
  const text = "; comment\n[other]\nkit=Wrong\n\n[instrument]\nkit=Drumkit\n# comment\nodd=a=b\n\n[note]\nF#3=F#3\nkick-1=Kick 1\r\n[more]\nF#3=Wrong\n";

  it("reads the key=value lines of the named sections, keys with a # included", () => {
    expect(locale.parseLocale(text, ["instrument", "note"])).toEqual({ instrument: { kit: "Drumkit", odd: "a=b" }, note: { "F#3": "F#3", "kick-1": "Kick 1" } });
    expect(locale.parseLocale(text, ["absent"])).toEqual({});
  });

  it("lets a later module override an earlier one, core coming first", () => {
    const dir = (module: string) => join(scratch, "data", module, "locale", "en");
    for (const module of ["core", "base", "extra"]) mkdirSync(dir(module), { recursive: true });
    writeFileSync(join(dir("core"), "core.cfg"), "[note]\na=core\nb=core\n");
    writeFileSync(join(dir("base"), "base.cfg"), "[note]\nb=base\nc=base\n");
    writeFileSync(join(dir("extra"), "extra.cfg"), "[note]\nc=extra\n");
    expect(locale.readLocaleSections(join(scratch, "data"), ["base"], ["note", "instrument"])).toEqual({ note: { a: "core", b: "base", c: "base" }, instrument: {} });
    expect(locale.readLocaleSections(join(scratch, "data"), ["base", "extra", "missing"], ["note"])).toEqual({ note: { a: "core", b: "base", c: "extra" } });
  });
});

// Local only: needs the game's data directory and the dumps of the last generator run, both outside the repository's history.
const local = (() => {
  try {
    const { dataDir } = dump.locateGame();
    const modules = dump.readModuleInfos(dataDir);
    const dumpRoot = resolve(ROOT, ".runtime/factorio-dump");
    const game = sets.completeDumps(dumpRoot, modules)?.game;
    return game?.version === STANDARD_CATALOG_VERSION ? { dumpRoot, dataDir, modules, game } : undefined;
  } catch {
    return undefined;
  }
})();

describe.skipIf(!local)("committed icon table", () => {
  it("is the one the generator builds from the dumps", () => {
    const { catalog, icons } = sets.buildFromDumps(local!);
    expect(icons.size).toBe(1138);
    expect(readFileSync(resolve(ROOT, `packages/catalog/data/icons-${STANDARD_CATALOG_VERSION}.json`), "utf8")).toBe(iconTableText(catalog.game, icons));
  });
});
