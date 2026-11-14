// Runs the game with every writable path redirected into the workspace and proves afterwards that nothing else changed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DUMP_COMMANDS, DUMP_OUTPUTS, RUNTIME_DUMP_FILE, RUNTIME_SCENARIO, STANDARD_MODULES, configIni, gameArguments, gameEnvironment, modSetId, parseDependency, parseGameVersion, readModuleInfos,
  sandboxProfile, scenarioArgs,
} from "./commands.ts";
import { diffSnapshots, snapshot } from "./isolation.mjs";

export { DUMP_COMMANDS, DUMP_OUTPUTS, RUNTIME_DUMP_FILE, RUNTIME_SCENARIO, STANDARD_MODULES, modSetId, parseDependency, readModuleInfos };
const SCENARIO_SOURCE = path.join(import.meta.dirname, "..", "runtime-dump", "control.lua");

/** Where the game is: FACTORIO_BIN and FACTORIO_DATA, or the application bundle with its `data` directory. `gameRoot` is what the isolation check watches. */
export function locateGame(env = process.env) {
  const binary = env.FACTORIO_BIN ?? "/Applications/factorio.app/Contents/MacOS/factorio";
  if (!fs.existsSync(binary)) throw new Error(`game binary not found at ${binary} (set FACTORIO_BIN)`);
  const dataDir = fs.realpathSync(env.FACTORIO_DATA ?? path.resolve(binary, "../../data"));
  return { binary, dataDir, gameRoot: /^(.*\.app)\//.exec(binary)?.[1] ?? path.dirname(dataDir) };
}

/** Every module combination the game accepts: base plus any subset whose required dependencies are satisfied. */
export function validModSets(infos) {
  const optional = infos.filter((m) => m.name !== "base");
  const sets = [];
  for (let mask = 0; mask < 1 << optional.length; mask++) {
    const enabled = new Set(["base", ...optional.filter((_, bit) => mask & (1 << bit)).map((m) => m.name)]);
    if (infos.every((m) => !enabled.has(m.name) || m.requires.every((dep) => enabled.has(dep)))) sets.push(STANDARD_MODULES.filter((name) => enabled.has(name)));
  }
  return sets.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

const quote = (arg) => (/[^\w@%+=:,./-]/.test(arg) ? `'${arg}'` : arg);

/**
 * Starts the game once. HOME and TMPDIR point into `dumpRoot`; on macOS the process additionally runs under a sandbox
 * profile that denies every file write outside `dumpRoot` and all IP networking. The watched locations (see
 * isolation.mjs) are fingerprinted before and after; any difference is an error.
 */
export function runGame({ binary, gameRoot, dumpRoot, cwd, args, sandbox, label, log }) {
  const home = path.join(dumpRoot, "home");
  const tmp = path.join(dumpRoot, "tmp");
  for (const dir of [home, tmp, cwd]) fs.mkdirSync(dir, { recursive: true });
  const profileFile = path.join(dumpRoot, "sandbox.sb");
  if (sandbox) fs.writeFileSync(profileFile, sandboxProfile(dumpRoot) + "\n");
  const [program, programArgs] = sandbox ? ["/usr/bin/sandbox-exec", ["-f", profileFile, binary, ...args]] : [binary, args];
  const env = gameEnvironment({ platform: process.platform, home, tmp });
  const commandLine = [program, ...programArgs].map(quote).join(" ");

  const before = snapshot(gameRoot);
  const started = Date.now();
  const result = spawnSync(program, programArgs, { cwd, env, encoding: "utf8", timeout: 15 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 });
  const seconds = (Date.now() - started) / 1000;
  const after = snapshot(gameRoot);
  const changes = diffSnapshots(before, after);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  log?.(`${label}: exit ${result.status}${result.signal ? ` (${result.signal})` : ""} in ${seconds.toFixed(1)}s, changes outside the workspace: ${changes.length}`);
  if (changes.length) throw new Error(`Isolation violated by ${commandLine}:\n  ${changes.join("\n  ")}\n(If you were playing the game at the same time, its own writes are reported here too.)`);
  if (result.error || result.status !== 0) throw new Error(`Game run failed (${result.error?.message ?? `exit ${result.status}`}): ${commandLine}\n${output.slice(-2000)}`);
  return { commandLine, env, seconds, output, isolation: { before, after } };
}

/**
 * Runs the game once for one module set and checks that it wrote `output` to script-output; all game state lives in
 * `<dumpRoot>/sets/<id>/`. A `scenario` ({ name, source }: one control.lua) is installed there first.
 */
function runSet({ binary, dataDir, gameRoot, dumpRoot, mods, sandbox, log }, { name, commandArgs, output, scenario }) {
  const setDir = path.join(dumpRoot, "sets", modSetId(mods));
  const modDir = path.join(setDir, "mods");
  const configFile = path.join(setDir, "config", "config.ini");
  for (const dir of [modDir, path.dirname(configFile)]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFile, configIni(dataDir, setDir));
  fs.writeFileSync(path.join(modDir, "mod-list.json"), JSON.stringify({ mods: STANDARD_MODULES.map((name) => ({ name, enabled: mods.includes(name) })) }, null, 2) + "\n");
  if (scenario) {
    const scenarioDir = path.join(setDir, "scenarios", scenario.name);
    fs.mkdirSync(scenarioDir, { recursive: true });
    fs.copyFileSync(scenario.source, path.join(scenarioDir, "control.lua"));
  }
  const expected = path.join(setDir, "script-output", output);
  fs.rmSync(expected, { force: true });
  const args = gameArguments(configFile, modDir, commandArgs);
  const run = runGame({ binary, gameRoot, dumpRoot, cwd: setDir, args, sandbox, label: `${modSetId(mods)} ${commandArgs.slice(0, 2).join(" ")}`, log });
  fs.writeFileSync(path.join(setDir, `${name}.log`), run.output);
  if (!fs.existsSync(expected)) throw new Error(`${run.commandLine} did not produce ${expected}`);
  return { ...run, setDir, outputFile: expected };
}

/** Runs one dump command for one module set. */
export function runDump({ command, ...options }) {
  const scenario = command === "runtime" ? { name: RUNTIME_SCENARIO, source: SCENARIO_SOURCE } : undefined;
  return runSet(options, { name: command, commandArgs: DUMP_COMMANDS[command], output: DUMP_OUTPUTS[command], scenario });
}

/** Runs a scenario (the control.lua at `source`) headless under `--test-scenario`; it has to write `output` to script-output and end the test. */
export function runScenario({ scenario, source, output, ...options }) {
  return runSet(options, { name: scenario, commandArgs: scenarioArgs(scenario), output, scenario: { name: scenario, source } });
}

/** Parses `factorio --version`: "Version: 2.1.24 (build 87808, mac-arm64, full)". */
export function gameVersion(options) {
  const run = runGame({ ...options, cwd: options.dumpRoot, args: ["--version"], label: "--version" });
  const version = parseGameVersion(run.output);
  if (!version) throw new Error(`Cannot parse the game version from:\n${run.output}`);
  return { ...version, commandLine: run.commandLine };
}
