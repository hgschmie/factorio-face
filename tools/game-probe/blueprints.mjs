#!/usr/bin/env node
// Records fixture F-01 from the locally installed game: the blueprints the game itself exports for every supported entity
// and setting, and what it makes of the blueprints this project exports (docs/factorio-audit.md 6.8, F-01, F-02 and F-23).
// The cases are the sample circuits of packages/blueprints/test/samples.ts (lib/blueprintCases.ts turns them into what the
// game is sent); the scenario is blueprints.lua. The game runs headless and sandboxed like the catalog dump
// (tools/catalog/lib/dump.mjs), with all standard modules, because the samples use qualities and Space Age signals. Its state
// is in a folder of its own, so that this probe and the wire reach probe can run at the same time.
import fs from "node:fs";
import path from "node:path";
import { locateGame, modSetId, runScenario, STANDARD_MODULES } from "../catalog/lib/dump.mjs";
import { buildFixture, fixtureErrors, serialiseFixture } from "./lib/blueprintFixture.mjs";
import { composeScenario, loadRequest } from "./lib/blueprintScenario.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PROBE_ROOT = path.join(ROOT, ".runtime", "game-probe", "blueprints");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "game", "F-01-blueprints.json");
const SCENARIO = "face-blueprints";
const OUTPUT = "face-blueprints.json";
const ERROR_OUTPUT = "face-blueprints-error.txt";
const SOURCE = "Recorded from the game by tools/game-probe/blueprints.mjs: LuaItemStack.import_stack, export_stack, build_blueprint and create_blueprint, and the control behaviours of the runtime API.";
// The user's own game writes to the watched folders while it runs; such a run proves nothing and is repeated.
const ATTEMPTS = 5;

const USAGE = `Usage: node tools/game-probe/blueprints.mjs [--check]

  --check   fail if ${path.relative(ROOT, FIXTURE)} differs from what the game says; write nothing

Environment: FACTORIO_BIN, FACTORIO_DATA (as for tools/catalog/generate.mjs). All game state goes to .runtime/game-probe/blueprints.`;

function fail(message) {
  console.error(`blueprints: ${message}`);
  process.exit(1);
}

function record(options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return runScenario({ ...options, scenario: SCENARIO, output: OUTPUT });
    } catch (error) {
      if (!String(error.message).startsWith("Isolation violated") || attempt === ATTEMPTS) throw error;
      console.log(`blueprints: something else wrote to the game's folders during attempt ${attempt} of ${ATTEMPTS}; running again`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) return console.log(USAGE);
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length) fail(`unknown option ${unknown.join(" ")}\n\n${USAGE}`);
  if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec")) fail("the probe runs the game under sandbox-exec, which only macOS has");

  fs.mkdirSync(PROBE_ROOT, { recursive: true });
  const dumpRoot = fs.realpathSync(PROBE_ROOT);
  const source = path.join(dumpRoot, "face-blueprints-control.lua");
  fs.writeFileSync(source, composeScenario(await loadRequest(dumpRoot)));
  const errorFile = path.join(dumpRoot, "sets", modSetId(STANDARD_MODULES), "script-output", ERROR_OUTPUT);
  fs.rmSync(errorFile, { force: true });
  let run;
  try {
    run = record({ ...locateGame(), dumpRoot, mods: STANDARD_MODULES, sandbox: true, source, log: (line) => console.log(`  ${line}`) });
  } catch (error) {
    if (fs.existsSync(errorFile)) fail(`the scenario failed: ${fs.readFileSync(errorFile, "utf8")}`);
    throw error;
  }
  const recorded = buildFixture(JSON.parse(fs.readFileSync(run.outputFile, "utf8")), SOURCE);
  const text = serialiseFixture(recorded);
  const relative = path.relative(ROOT, FIXTURE);
  const same = fs.existsSync(FIXTURE) && fs.readFileSync(FIXTURE, "utf8") === text;
  if (args.includes("--check")) {
    if (!same) fail(`${relative} is not what Factorio ${recorded.gameVersion} says`);
  } else if (!same) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, text);
  }
  console.log(`blueprints: Factorio ${recorded.gameVersion}, ${recorded.cases.length} cases; ${relative} ${same ? "is up to date" : "written"}`);
  // A step the game refused is a finding, not a failed recording: it is in the fixture, and the tests of packages/blueprints name it.
  const errors = fixtureErrors(recorded);
  if (errors.length) console.log(`blueprints: the game could not do ${errors.length} ${errors.length === 1 ? "step" : "steps"}:\n  ${errors.join("\n  ")}`);
  console.log("blueprints: now run `npx vitest run packages/blueprints` (or `make test`); the tests named 'F-01' hold the package against the recording");
}

try {
  await main();
} catch (error) {
  fail(error.stack ?? String(error));
}
