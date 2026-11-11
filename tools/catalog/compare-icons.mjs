#!/usr/bin/env node
// Validates the icon renderer against icons dumped by the game itself (`factorio --dump-icon-sprites`), if such a dump
// is present in .runtime/factorio-dump/sets/<set>/script-output. This tool never starts the game: the icon dump needs
// the graphics stack, which makes macOS touch its Metal shader cache outside the workspace (see README).
import fs from "node:fs";
import path from "node:path";
import { availableSignals, iconPath, loadStandardCatalog } from "../../packages/catalog/src/index.ts";
import { decodePng } from "./lib/png.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SETS = path.join(ROOT, ".runtime", "factorio-dump", "sets");
const ICONS = path.join(ROOT, "packages", "catalog", "generated", "icons");
const GAME_DIR = { virtual: "virtual-signal" };
const MEAN_LIMIT = 2;

const catalog = loadStandardCatalog();
const sets = (fs.existsSync(SETS) ? fs.readdirSync(SETS) : []).filter((id) => fs.existsSync(path.join(SETS, id, "script-output", "item")));
if (!sets.length) {
  console.log("compare-icons: no game icon dump found below .runtime/factorio-dump/sets; nothing to compare");
  process.exit(0);
}
let failed = false;
for (const id of sets) {
  const results = [];
  let skipped = 0;
  for (const entry of availableSignals(catalog, id.split("+"))) {
    const gameFile = path.join(SETS, id, "script-output", GAME_DIR[entry.kind] ?? entry.kind, `${entry.name}.png`);
    if (!fs.existsSync(gameFile)) continue;
    const game = decodePng(fs.readFileSync(gameFile));
    const mine = decodePng(fs.readFileSync(iconPath(entry, ICONS)));
    if (game.width !== mine.width || game.height !== mine.height) {
      skipped++;
      continue;
    }
    // The game writes premultiplied colour values into its PNGs; ours are straight alpha.
    let sum = 0, max = 0;
    for (let i = 0; i < mine.data.length; i += 4) {
      const alpha = mine.data[i + 3] / 255;
      for (let c = 0; c < 4; c++) {
        const diff = Math.abs(game.data[i + c] - (c === 3 ? mine.data[i + 3] : mine.data[i + c] * alpha));
        sum += diff;
        max = Math.max(max, diff);
      }
    }
    results.push({ key: entry.key, mean: sum / mine.data.length, max: Math.round(max) });
  }
  results.sort((a, b) => b.mean - a.mean);
  const worst = results.slice(0, 5).map((r) => `${r.key} ${r.mean.toFixed(2)}/${r.max}`).join(", ");
  const average = results.reduce((total, r) => total + r.mean, 0) / results.length;
  console.log(`compare-icons: ${id}: ${results.length} icons compared, ${skipped} skipped (native size differs); mean abs error per channel ${average.toFixed(3)} of 255, worst (mean/max): ${worst}`);
  if (results.some((r) => r.mean > MEAN_LIMIT)) failed = true;
}
if (failed) {
  console.error(`compare-icons: at least one icon differs by more than ${MEAN_LIMIT}/255 on average`);
  process.exit(1);
}
