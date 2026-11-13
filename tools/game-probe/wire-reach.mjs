#!/usr/bin/env node
// Records fixture F-24 from the locally installed game: which placements of one entity a circuit wire from another reaches.
// The cases are in wire-reach.lua: the combinators and the lamp in every direction, the four electric poles (each with its own
// reach, also against each other) and the programmable speaker. A case added there is in the fixture after the next run.
// The game runs headless and sandboxed like the catalog dump (tools/catalog/lib/dump.mjs); the scenario is wire-reach.lua.
import fs from "node:fs";
import path from "node:path";
import { locateGame, runScenario } from "../catalog/lib/dump.mjs";
import { buildFixture, serialiseFixture } from "./lib/fixture.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PROBE_ROOT = path.join(ROOT, ".runtime", "game-probe");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "game", "F-24-wire-reach.json");
const SCENARIO = "face-wire-reach";
const OUTPUT = "face-wire-reach.json";
const ERROR_OUTPUT = "face-wire-reach-error.txt";
const SOURCE = "Recorded from the game by tools/game-probe/wire-reach.mjs: LuaWireConnector.can_wire_reach and connect_to with the reach check, which agree for every placement.";
// The user's own game writes to the watched folders while it runs; such a run proves nothing and is repeated.
const ATTEMPTS = 5;

const USAGE = `Usage: node tools/game-probe/wire-reach.mjs [--check]

  --check   fail if ${path.relative(ROOT, FIXTURE)} differs from what the game says; write nothing

Environment: FACTORIO_BIN, FACTORIO_DATA (as for tools/catalog/generate.mjs). All game state goes to .runtime/game-probe.`;

function fail(message) {
  console.error(`wire-reach: ${message}`);
  process.exit(1);
}

function record(options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return runScenario({ ...options, scenario: SCENARIO, source: path.join(import.meta.dirname, "wire-reach.lua"), output: OUTPUT });
    } catch (error) {
      if (!String(error.message).startsWith("Isolation violated") || attempt === ATTEMPTS) throw error;
      console.log(`wire-reach: something else wrote to the game's folders during attempt ${attempt} of ${ATTEMPTS}; running again`);
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
  const errorFile = path.join(dumpRoot, "sets", "base", "script-output", ERROR_OUTPUT);
  fs.rmSync(errorFile, { force: true });
  let run;
  try {
    run = record({ ...locateGame(), dumpRoot, mods: ["base"], sandbox: true, log: (line) => console.log(`  ${line}`) });
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
  console.log(`wire-reach: Factorio ${recorded.gameVersion}, ${recorded.cases.length} cases; ${relative} ${same ? "is up to date" : "written"}`);
}

try {
  main();
} catch (error) {
  fail(error.stack ?? String(error));
}
