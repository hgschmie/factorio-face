#!/usr/bin/env node
// Records fixture F-29 from the locally installed game: what an entity does whose circuit condition is in use ("Enable/disable"
// on) and blank, wired and not, next to the same entity with a condition that holds, one that does not and the switch off, so
// that the reading can be trusted. Every entity is built twice, from a blueprint string and through the runtime API. The
// prototypes and states are in blank-condition.lua; one added there is in the fixture after the next run. The game runs with
// its five standard modules, headless and sandboxed like the catalog dump (tools/catalog/lib/dump.mjs).
import fs from "node:fs";
import path from "node:path";
import { STANDARD_MODULES, locateGame, modSetId, runScenario } from "../catalog/lib/dump.mjs";
import { buildFixture, describeCase, fixtureErrors, serialiseFixture, summarise } from "./lib/blankConditionFixture.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
// A folder of its own: the other probes keep their game state next to it, and they may run at the same time.
const PROBE_ROOT = path.join(ROOT, ".runtime", "game-probe", "blank-condition");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "game", "F-29-blank-condition.json");
const SCENARIO = "face-blank-condition";
const OUTPUT = "face-blank-condition.json";
const ERROR_OUTPUT = "face-blank-condition-error.txt";
const SOURCE =
  "Recorded from the game by tools/game-probe/blank-condition.mjs: the control behaviours of the runtime API (circuit_condition with its `fulfilled`, LuaGenericOnOffControlBehavior.disabled), LuaEntity.status, and LuaItemStack.import_stack, build_blueprint and create_blueprint.";
// The user's own game writes to the watched folders while it runs; such a run proves nothing and is repeated.
const ATTEMPTS = 5;

const USAGE = `Usage: node tools/game-probe/blank-condition.mjs [--check]

  --check   fail if ${path.relative(ROOT, FIXTURE)} differs from what the game says; write nothing

Environment: FACTORIO_BIN, FACTORIO_DATA (as for tools/catalog/generate.mjs). All game state goes to .runtime/game-probe/blank-condition.`;

function fail(message) {
  console.error(`blank-condition: ${message}`);
  process.exit(1);
}

function record(options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return runScenario({ ...options, scenario: SCENARIO, source: path.join(import.meta.dirname, "blank-condition.lua"), output: OUTPUT });
    } catch (error) {
      if (!String(error.message).startsWith("Isolation violated") || attempt === ATTEMPTS) throw error;
      console.log(`blank-condition: something else wrote to the game's folders during attempt ${attempt} of ${ATTEMPTS}; running again`);
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
  const errorFile = path.join(dumpRoot, "sets", modSetId(STANDARD_MODULES), "script-output", ERROR_OUTPUT);
  fs.rmSync(errorFile, { force: true });
  let run;
  try {
    run = record({ ...locateGame(), dumpRoot, mods: STANDARD_MODULES, sandbox: true, log: (line) => console.log(`  ${line}`) });
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
  console.log(`blank-condition: Factorio ${recorded.gameVersion}, ${recorded.cases.length} prototypes and ${recorded.deciders.length} decider combinators; ${relative} ${same ? "is up to date" : "written"}`);
  for (const probed of recorded.cases) console.log(`  ${describeCase(summarise(probed))}`);
  for (const { state, output, error } of recorded.deciders) console.log(`  decider-combinator, ${state}: ${error ?? (output["signal-B"] ? "holds" : "does not hold")}`);
  // A step the game refused is a finding, not a failed recording: it is in the fixture.
  const errors = fixtureErrors(recorded);
  if (errors.length) console.log(`blank-condition: the game could not do ${errors.length} ${errors.length === 1 ? "step" : "steps"}:\n  ${errors.join("\n  ")}`);
}

try {
  main();
} catch (error) {
  fail(error.stack ?? String(error));
}
