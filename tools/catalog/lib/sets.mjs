// Reads what the dump runs left below .runtime/factorio-dump and builds the catalog from it. Never starts the game.
import fs from "node:fs";
import path from "node:path";
import { LOCALE_SECTIONS, SPEAKER_LOCALE_SECTIONS, buildCatalog } from "./build.mjs";
import { DUMP_OUTPUTS, RUNTIME_DUMP_FILE, modSetId, validModSets } from "./dump.mjs";
import { readLocaleSections } from "./locale.mjs";

export const DUMP_STAMP_FILE = "dump-info.json";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const outputDir = (dumpRoot, mods) => path.join(dumpRoot, "sets", modSetId(mods), "script-output");

/** The versions a dump is stamped with: "base 2.1.24, elevated-rails 2.1.24, ...". */
export const moduleVersions = (modules) => modules.map((m) => `${m.name} ${m.version}`).join(", ");

/** The stamp of the last dump run ({ versions, game, dumpedAt, runs }), or undefined when a dump is missing or the dumps are of other module versions. */
export function completeDumps(dumpRoot, modules) {
  const file = path.join(dumpRoot, DUMP_STAMP_FILE);
  const stamp = fs.existsSync(file) ? readJson(file) : undefined;
  const complete = stamp?.versions === moduleVersions(modules) && validModSets(modules).every((mods) => Object.values(DUMP_OUTPUTS).every((output) => fs.existsSync(path.join(outputDir(dumpRoot, mods), output))));
  return complete ? stamp : undefined;
}

function loadSet(dumpRoot, mods, dataDir) {
  const output = outputDir(dumpRoot, mods);
  const locale = readLocaleSections(dataDir, mods, SPEAKER_LOCALE_SECTIONS);
  for (const section of LOCALE_SECTIONS) {
    const file = path.join(output, `${section}-locale.json`);
    if (fs.existsSync(file)) locale[section] = readJson(file).names;
  }
  return { id: modSetId(mods), mods, raw: readJson(path.join(output, DUMP_OUTPUTS.data)), runtime: readJson(path.join(output, RUNTIME_DUMP_FILE)), locale };
}

/**
 * Builds the catalog from the dumps of every valid module set and proves that the provenance rules reproduce each of them.
 * The build variant ("mac-arm64, full") stays out of the result so that it is the same on every platform.
 * @returns { catalog, icons } as `buildCatalog` does
 */
export function buildFromDumps({ dumpRoot, dataDir, modules, game }) {
  const sets = validModSets(modules).map((mods) => loadSet(dumpRoot, mods, dataDir));
  for (const set of sets) {
    if (set.runtime.game_version !== game.version) throw new Error(`${set.id}: runtime dump is from ${set.runtime.game_version}, expected ${game.version}`);
    const active = Object.keys(set.runtime.active_mods).sort().join();
    if (active !== [...set.mods].sort().join()) throw new Error(`${set.id}: the game loaded ${active}`);
  }
  return buildCatalog({ sets, modules, game: { version: game.version, build: game.build } });
}
