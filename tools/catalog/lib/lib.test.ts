// Tests for the generator's pure parts. The libraries are plain .mjs (run by node without a build step), so they are
// loaded dynamically and given their types here.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

interface Image { width: number; height: number; data: Uint8Array }
interface Layer { icon: string; size: number; scale?: number; shift?: number[]; tint?: number[] }
interface ModuleInfo { name: string; requires: string[]; recommends: string[] }
type Records = Record<string, unknown>[];
interface Built {
  catalog: { signals: Record<string, Records>; groups: Records; subgroups: Records; qualities: Records; constants: Record<string, unknown> };
  icons: Map<string, { layers: Layer[]; expected: number }>;
}

const load = (file: string): Promise<unknown> => import(/* @vite-ignore */ new URL(file, import.meta.url).href);
const png = (await load("./png.mjs")) as { decodePng(buffer: Buffer): Image; encodePng(image: Image): Buffer };
const icons = (await load("./icons.mjs")) as {
  IconRenderer: new (dataDir: string) => { render(layers: Layer[], options?: { expected?: number; output?: number }): Image };
  iconLayers(proto: object): Layer[] | undefined;
  normaliseColor(color: object): number[];
};
const dump = (await load("./dump.mjs")) as { parseDependency(text: string): { name: string; kind: string; constraint: string }; validModSets(infos: ModuleInfo[]): string[][] };
const build = (await load("./build.mjs")) as { buildCatalog(input: object): Built; visibilityOf(signal: object): string };

const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "face-catalog-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("png codec", () => {
  it("round-trips RGBA images", () => {
    const image = { width: 5, height: 3, data: Uint8Array.from({ length: 60 }, (_, i) => (i * 37 + 11) % 256) };
    const decoded = png.decodePng(png.encodePng(image));
    expect([decoded.width, decoded.height]).toEqual([5, 3]);
    expect([...decoded.data]).toEqual([...image.data]);
  });

  it("rejects data that is not a PNG", () => {
    expect(() => png.decodePng(Buffer.alloc(32))).toThrow(/Not a PNG/);
  });
});

describe("icon renderer", () => {
  const pixel = (image: Image, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  mkdirSync(join(scratch, "mod"), { recursive: true });
  // 4x4 opaque red with a 2x2 mip level to its right, and a 4x4 half-transparent white.
  const red = { width: 6, height: 4, data: new Uint8Array(6 * 4 * 4) };
  for (let i = 0; i < 24; i++) red.data.set(i % 6 < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255], i * 4);
  writeFileSync(join(scratch, "mod", "red.png"), png.encodePng(red));
  writeFileSync(join(scratch, "mod", "white.png"), png.encodePng({ width: 4, height: 4, data: new Uint8Array(64).fill(255).map((v, i) => (i % 4 === 3 ? 128 : v)) }));
  const renderer = new icons.IconRenderer(scratch);

  it("uses the first mip level and scales it to the output size", () => {
    const image = renderer.render([{ icon: "__mod__/red.png", size: 4 }], { expected: 4, output: 8 });
    expect([image.width, image.height]).toEqual([8, 8]);
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 7, 7)).toEqual([255, 0, 0, 255]);
  });

  it("composites scaled, shifted and tinted layers in order", () => {
    const layers = [{ icon: "__mod__/red.png", size: 4 }, { icon: "__mod__/white.png", size: 4, scale: 0.25, shift: [0.5, 0.5], tint: [0, 0, 1, 1] }];
    const image = renderer.render(layers, { expected: 4, output: 8 });
    expect(pixel(image, 1, 1)).toEqual([255, 0, 0, 255]);
    // Bottom-right quadrant: blue-tinted white at about 50% over red.
    const [r, g, b, a] = pixel(image, 6, 6);
    expect(a).toBe(255);
    expect(g).toBe(0);
    expect(Math.abs((r ?? 0) - 127)).toBeLessThanOrEqual(1);
    expect(Math.abs((b ?? 0) - 128)).toBeLessThanOrEqual(1);
  });

  it("normalises icon definitions and colours", () => {
    expect(icons.iconLayers({ icon: "__mod__/a.png" })).toEqual([{ icon: "__mod__/a.png", size: 64 }]);
    expect(icons.iconLayers({ icons: [{ icon: "__mod__/a.png", icon_size: 32, tint: { r: 255, g: 0, b: 0 }, shift: [0, 0] }], icon: "ignored" })).toEqual([{ icon: "__mod__/a.png", size: 32, tint: [1, 0, 0, 1] }]);
    expect(icons.iconLayers({})).toBeUndefined();
    expect(icons.normaliseColor([0.5, 0.25, 1])).toEqual([0.5, 0.25, 1, 1]);
    expect(icons.normaliseColor({ r: 51, g: 102, b: 255, a: 255 })).toEqual([0.2, 0.4, 1, 1]);
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
