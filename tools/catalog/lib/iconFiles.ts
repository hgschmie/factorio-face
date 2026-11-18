// The generator's two icon outputs: the icon table, and the icons rendered from the game's image files. The codec and the
// compositor are the app's own (apps/desktop/src/gameIcons), so a generated icon and one the app renders from an
// installation have the same pixels. Free of syntax that Node's type stripping cannot run.
import { iconFileLocation, iconTableFile, IconTableError, parseIconTable, type IconEntry, type IconLayer, type IconTableGame } from "@face/catalog/icons";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iconSource, renderIconPng } from "../../../apps/desktop/src/gameIcons/iconRenderer.ts";
import { COMPACT_ENCODING, decodePng } from "../../../apps/desktop/src/gameIcons/png.ts";

/**
 * The content of `packages/catalog/data/icons-<version>.json`: one icon per line and sorted by id, so that a changed icon
 * is a changed line, and nothing that differs between two runs. Throws IconTableError for a table the app would refuse, and
 * for a layer that is not a file of the game's own modules: the parser also takes files of mods, which this table never has.
 */
export function iconTableText(game: IconTableGame, icons: ReadonlyMap<string, IconEntry>): string {
  const sorted = new Map([...icons].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  // Through the parser once: the file then holds exactly what the app reads back from it.
  const table = parseIconTable(iconTableFile({ game, icons: sorted }));
  for (const [id, { layers }] of table.icons) {
    const foreign = layers.find((layer) => !iconFileLocation(layer.icon));
    if (foreign) throw new IconTableError(`Layer of icon ${JSON.stringify(id)} does not name an image file of the game: ${JSON.stringify(foreign.icon)}`);
  }
  const file = iconTableFile(table);
  const lines = Object.entries(file.icons).map(([id, entry]) => `    ${JSON.stringify(id)}: ${JSON.stringify(entry)}`);
  return `{\n  "schema": ${file.schema},\n  "game": ${JSON.stringify(file.game)},\n  "icons": {\n${lines.join(",\n")}\n  }\n}\n`;
}

/** Renders icons as PNG files from the images below a game's `data` directory. First mip levels are kept: many icons share a layer. */
export function iconFileRenderer(dataDir: string): (entry: IconEntry, output: number) => Uint8Array {
  const sources = new Map<string, Float64Array>();
  const source = ({ icon, size }: IconLayer): Float64Array => {
    const key = `${size}|${icon}`;
    let pixels = sources.get(key);
    if (!pixels) {
      const location = iconFileLocation(icon);
      if (!location) throw new Error(`Not an image file of the game: ${icon}`);
      try {
        pixels = iconSource(decodePng(readFileSync(join(dataDir, location.module, ...location.segments))), size);
      } catch (error) {
        throw new Error(`${icon}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      sources.set(key, pixels);
    }
    return pixels;
  };
  return ({ expected, layers }, output) => renderIconPng(layers, layers.map(source), { expected, output }, COMPACT_ENCODING);
}
