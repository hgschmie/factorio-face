// Local only: compares icons rendered from the installed game with the ones the catalog generator wrote. Skipped where the
// game, the generated icons or the generator's data dump is absent (all three are outside the repository's history).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GameIcons } from "../../src/gameIcons/gameIcons.ts";
import { iconLayers, iconSource, renderIcon, type IconPrototype } from "../../src/gameIcons/iconRenderer.ts";
import { iconFileLocation, iconTableFile, parseIconTable, type IconEntry } from "../../src/gameIcons/iconTable.ts";
import { decodePng } from "../../src/gameIcons/png.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const DATA = "/Applications/factorio.app/Contents/data";
const GENERATED = resolve(ROOT, "packages/catalog/generated");
const DUMP = resolve(ROOT, ".runtime/factorio-dump/sets/base+elevated-rails+recycler+quality+space-age/script-output/data-raw-dump.json");

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const versionOf = (file: string, field: (json: never) => unknown): unknown => (existsSync(file) ? field(readJson(file) as never) : undefined);
const installed = versionOf(resolve(DATA, "base/info.json"), (info: { version: string }) => info.version);
const generated = versionOf(resolve(GENERATED, "manifest.json"), (manifest: { game: { version: string } }) => manifest.game.version);
// The generated icons only say something about the installation they were rendered from.
const available = installed !== undefined && installed === generated && existsSync(resolve(GENERATED, "icons")) && existsSync(DUMP);

/** Icon id, the prototype it belongs to in the data dump, and the icon size that prototype expects. */
const SAMPLES: readonly (readonly [id: string, type: string, name: string, expected: number])[] = [
  ["item/small-lamp", "item", "small-lamp", 64], // one RGBA layer
  ["fluid/crude-oil", "fluid", "crude-oil", 64], // gray with alpha
  ["quality/epic", "quality", "epic", 64], // palette, no mip levels
  ["virtual/signal-A", "virtual-signal", "signal-A", 64],
  ["recipe/accumulator-recycling", "recipe", "accumulator-recycling", 64], // three layers, the middle one scaled
  ["item/crude-oil-barrel", "item", "crude-oil-barrel", 64], // tinted layers
  ["recipe/empty-crude-oil-barrel", "recipe", "empty-crude-oil-barrel", 64], // tinted, scaled and shifted
  ["space-location/vulcanus", "planet", "vulcanus", 64],
  ["group/logistics", "item-group", "logistics", 128], // 128 pixel source for a slot that expects 128
];

describe.skipIf(!available)("icons from the installed game", () => {
  // The layers come from the data dump the way the generator takes them: the prototype's icon fields, normalised.
  const raw = (available ? readJson(DUMP) : {}) as Record<string, Record<string, IconPrototype>>;
  const entries = new Map<string, IconEntry>(SAMPLES.map(([id, type, name, expected]) => [id, { expected, layers: iconLayers(raw[type]?.[name] ?? {}) ?? [] }]));
  const table = parseIconTable(JSON.parse(JSON.stringify(iconTableFile({ game: { version: String(installed) }, icons: entries }))));
  const reference = (id: string): Uint8Array => decodePng(readFileSync(resolve(GENERATED, "icons", `${id}.png`))).data;

  it("covers single, layered, scaled, shifted and tinted icons", () => {
    const layers = [...table.icons.values()].flatMap((entry) => entry.layers);
    expect(table.icons.size).toBe(SAMPLES.length);
    expect(layers.some((layer) => layer.scale !== undefined)).toBe(true);
    expect(layers.some((layer) => layer.shift !== undefined)).toBe(true);
    expect(layers.some((layer) => layer.tint !== undefined)).toBe(true);
    expect(table.icons.get("recipe/accumulator-recycling")?.layers).toHaveLength(3);
    expect(table.icons.get("group/logistics")).toMatchObject({ expected: 128, layers: [{ size: 128 }] });
  });

  it.each(SAMPLES.map(([id]) => [id]))("renders %s pixel for pixel like the generator", (id) => {
    const { expected, layers } = table.icons.get(id)!;
    const sources = layers.map((layer) => {
      const location = iconFileLocation(layer.icon)!;
      return iconSource(decodePng(readFileSync(resolve(DATA, location.module, ...location.segments))), layer.size);
    });
    expect(Buffer.compare(renderIcon(layers, sources, { expected, output: 64 }).data, reference(id))).toBe(0);
  });

  it("serves the same pixels through the icon service", async () => {
    const problems: string[] = [];
    const icons = new GameIcons(table, { onProblem: (id, error) => problems.push(`${id}: ${String(error)}`) });
    icons.reset(DATA);
    const rendered = await Promise.all(SAMPLES.map(([id]) => icons.icon(id)));
    expect(problems).toEqual([]);
    for (const [index, [id]] of SAMPLES.entries()) expect(Buffer.compare(decodePng(rendered[index]!).data, reference(id)), id).toBe(0);
  });
});
