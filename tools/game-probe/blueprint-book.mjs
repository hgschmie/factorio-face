#!/usr/bin/env node
// Records fixture F-30 from the locally installed game: how it writes and reads a blueprint book. What it exports for books made
// through the runtime API (an empty one; one with blueprints, an empty slot, a book inside, an upgrade and a deconstruction
// planner), what it makes of books written by hand (items without `index`, with the same one, out of order, far apart;
// `active_index` anywhere), and how many slots a book has. The books written by hand are in lib/blueprintBookCases.mjs, the
// scenario is blueprint-book.lua; a case added to either is in the fixture after the next run. The game runs with its five
// standard modules, headless and sandboxed like the catalog dump (tools/catalog/lib/dump.mjs).
import fs from "node:fs";
import path from "node:path";
import { STANDARD_MODULES, locateGame, modSetId, runScenario } from "../catalog/lib/dump.mjs";
import { CASES, composeScenario } from "./lib/blueprintBookCases.mjs";
import { buildFixture, fixtureErrors, serialiseFixture, summarise } from "./lib/blueprintBookFixture.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
// A folder of its own: the other probes keep their game state next to it, and they may run at the same time.
const PROBE_ROOT = path.join(ROOT, ".runtime", "game-probe", "blueprint-book");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "game", "F-30-blueprint-book.json");
const SCENARIO = "face-blueprint-book";
const OUTPUT = "face-blueprint-book.json";
const ERROR_OUTPUT = "face-blueprint-book-error.txt";
const SOURCE =
  "Recorded from the game by tools/game-probe/blueprint-book.mjs: LuaItemStack.export_stack and import_stack, LuaItemCommon.get_inventory(defines.inventory.item_main), active_index, label, label_color, blueprint_description and preview_icons, and LuaInventory.insert.";
// The user's own game writes to the watched folders while it runs; such a run proves nothing and is repeated.
const ATTEMPTS = 5;

const USAGE = `Usage: node tools/game-probe/blueprint-book.mjs [--check]

  --check   fail if ${path.relative(ROOT, FIXTURE)} differs from what the game says; write nothing

Environment: FACTORIO_BIN, FACTORIO_DATA (as for tools/catalog/generate.mjs). All game state goes to .runtime/game-probe/blueprint-book.`;

function fail(message) {
  console.error(`blueprint-book: ${message}`);
  process.exit(1);
}

function record(options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return runScenario({ ...options, scenario: SCENARIO, output: OUTPUT });
    } catch (error) {
      if (!String(error.message).startsWith("Isolation violated") || attempt === ATTEMPTS) throw error;
      console.log(`blueprint-book: something else wrote to the game's folders during attempt ${attempt} of ${ATTEMPTS}; running again`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) return console.log(USAGE);
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length) fail(`unknown option ${unknown.join(" ")}\n\n${USAGE}`);
  if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec")) fail("the probe runs the game under sandbox-exec, which only macOS has");

  fs.mkdirSync(PROBE_ROOT, { recursive: true });
  const dumpRoot = fs.realpathSync(PROBE_ROOT);
  const source = path.join(dumpRoot, "face-blueprint-book-control.lua");
  fs.writeFileSync(source, composeScenario(CASES));
  const errorFile = path.join(dumpRoot, "sets", modSetId(STANDARD_MODULES), "script-output", ERROR_OUTPUT);
  fs.rmSync(errorFile, { force: true });
  let run;
  try {
    run = record({ ...locateGame(), dumpRoot, mods: STANDARD_MODULES, sandbox: true, source, log: (line) => console.log(`  ${line}`) });
  } catch (error) {
    if (fs.existsSync(errorFile)) fail(`the scenario failed: ${fs.readFileSync(errorFile, "utf8")}`);
    throw error;
  }
  if (fs.existsSync(errorFile)) fail(`the scenario failed: ${fs.readFileSync(errorFile, "utf8")}`);
  const recorded = buildFixture(JSON.parse(fs.readFileSync(run.outputFile, "utf8")), CASES, SOURCE);
  const text = serialiseFixture(recorded);
  const relative = path.relative(ROOT, FIXTURE);
  const same = fs.existsSync(FIXTURE) && fs.readFileSync(FIXTURE, "utf8") === text;
  if (args.includes("--check")) {
    if (!same) fail(`${relative} is not what Factorio ${recorded.gameVersion} says`);
  } else if (!same) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, text);
  }
  console.log(`blueprint-book: Factorio ${recorded.gameVersion}, ${recorded.imports.length} books written by hand; ${relative} ${same ? "is up to date" : "written"}`);
  for (const line of summarise(recorded)) console.log(`  ${line}`);
  // A step the game refused is a finding, not a failed recording: it is in the fixture.
  const errors = fixtureErrors(recorded);
  if (errors.length) console.log(`blueprint-book: the game could not do ${errors.length} ${errors.length === 1 ? "step" : "steps"}:\n  ${errors.join("\n  ")}`);
}

try {
  main();
} catch (error) {
  fail(error.stack ?? String(error));
}
