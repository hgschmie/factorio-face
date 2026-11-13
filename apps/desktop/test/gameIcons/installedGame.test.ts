// Local only: renders icons of the committed icon table from the installed game and compares them with the ones the catalog
// generator wrote. Skipped where the game or the generated icons are absent (both are outside the repository's history).
import { iconFileLocation } from "@face/catalog/icons";
import { loadStandardIconTable } from "@face/catalog/icons/standard";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GameIcons } from "../../src/gameIcons/gameIcons.ts";
import { iconSource, renderIcon } from "../../src/gameIcons/iconRenderer.ts";
import { decodePng } from "../../src/gameIcons/png.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const DATA = "/Applications/factorio.app/Contents/data";
const GENERATED = resolve(ROOT, "packages/catalog/generated");

const table = loadStandardIconTable();
const versionOf = (file: string, field: (json: never) => unknown): unknown => (existsSync(file) ? field(JSON.parse(readFileSync(file, "utf8")) as never) : undefined);
const installed = versionOf(resolve(DATA, "base/info.json"), (info: { version: string }) => info.version);
const generated = versionOf(resolve(GENERATED, "manifest.json"), (manifest: { game: { version: string } }) => manifest.game.version);
// The table and the generated icons only say something about the release they were made from.
const available = installed === table.game.version && generated === table.game.version && existsSync(resolve(GENERATED, "icons"));

const SAMPLES: readonly string[] = [
  "item/small-lamp", // one RGBA layer
  "fluid/crude-oil", // gray with alpha
  "quality/epic", // palette, no mip levels
  "virtual/signal-A",
  "recipe/accumulator-recycling", // three layers, the middle one scaled
  "item/crude-oil-barrel", // tinted layers
  "recipe/empty-crude-oil-barrel", // tinted, scaled and shifted
  "space-location/vulcanus",
  "group/logistics", // 128 pixel source for a slot that expects 128
];

describe.skipIf(!available)("icons from the installed game", () => {
  const reference = (id: string): Uint8Array => decodePng(readFileSync(resolve(GENERATED, "icons", `${id}.png`))).data;

  it("covers single, layered, scaled, shifted and tinted icons", () => {
    const layers = SAMPLES.flatMap((id) => table.icons.get(id)?.layers ?? []);
    expect(SAMPLES.filter((id) => !table.icons.has(id))).toEqual([]);
    expect(layers.some((layer) => layer.scale !== undefined)).toBe(true);
    expect(layers.some((layer) => layer.shift !== undefined)).toBe(true);
    expect(layers.some((layer) => layer.tint !== undefined)).toBe(true);
    expect(table.icons.get("recipe/accumulator-recycling")?.layers).toHaveLength(3);
    expect(table.icons.get("group/logistics")).toMatchObject({ expected: 128, layers: [{ size: 128 }] });
  });

  it.each(SAMPLES.map((id) => [id]))("renders %s pixel for pixel like the generator", (id) => {
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
    const rendered = await Promise.all(SAMPLES.map((id) => icons.icon(id)));
    expect(problems).toEqual([]);
    for (const [index, id] of SAMPLES.entries()) expect(Buffer.compare(decodePng(rendered[index]!).data, reference(id)), id).toBe(0);
  });
});
