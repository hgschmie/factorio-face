import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_MODULES, iconFileLocation, iconTableFile, parseIconTable } from "../src/iconTable.ts";
import { STANDARD_CATALOG_VERSION, loadStandardCatalog } from "../src/index.ts";
import { loadStandardIconTable } from "../src/standardIconTable.ts";

const FILE = fileURLToPath(new URL(`../data/icons-${STANDARD_CATALOG_VERSION}.json`, import.meta.url));
const catalog = loadStandardCatalog();
const table = loadStandardIconTable();

describe("standard icon table", () => {
  it("is of the catalog's release", () => {
    expect(table.game).toEqual(catalog.game);
    expect(table.game.version).toBe(STANDARD_CATALOG_VERSION);
    expect(loadStandardIconTable()).toBe(table);
  });

  it("has exactly the icons the catalog's signals, groups and qualities refer to", () => {
    const entries = [...catalog.signals, ...catalog.groups, ...catalog.qualities];
    const referenced = new Set(entries.flatMap((entry) => [entry.icon, ...(entry.variants ?? []).flatMap((variant) => (typeof variant.icon === "string" ? [variant.icon] : []))]));
    expect(referenced.size).toBe(1138);
    expect([...referenced].filter((id) => !table.icons.has(id))).toEqual([]);
    expect(table.icons.size).toBe(referenced.size);
  });

  it("names only image files inside the game's modules", () => {
    const layers = [...table.icons.values()].flatMap((entry) => entry.layers);
    expect(layers.filter((layer) => !iconFileLocation(layer.icon)).map((layer) => layer.icon)).toEqual([]);
    expect([...new Set(layers.map((layer) => iconFileLocation(layer.icon)?.module))].sort()).toEqual([...GAME_MODULES].sort());
    // Item groups expect 128 pixels, everything else 64.
    for (const [id, entry] of table.icons) expect(entry.expected, id).toBe(id.startsWith("group/") ? 128 : 64);
  });

  it("is committed in the generator's form: compact, sorted by id, one icon per line", () => {
    const text = readFileSync(FILE, "utf8");
    const file = JSON.parse(text) as { icons: Record<string, unknown> };
    const ids = Object.keys(file.icons);
    expect(ids).toEqual([...ids].sort());
    expect(text.split("\n")).toHaveLength(ids.length + 7);
    expect(iconTableFile(parseIconTable(file))).toEqual(file);
    expect(text.length).toBeLessThan(200_000);
  });
});
