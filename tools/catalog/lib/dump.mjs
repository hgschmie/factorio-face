// Runs the game with every writable path redirected into the workspace and proves afterwards that nothing else changed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { diffSnapshots, snapshot } from "./isolation.mjs";

export const STANDARD_MODULES = ["base", "elevated-rails", "recycler", "quality", "space-age"];
export const RUNTIME_SCENARIO = "face-catalog-dump";
export const RUNTIME_DUMP_FILE = "face-runtime-dump.json";
// All three commands run headless. `--dump-icon-sprites` is deliberately absent: it starts the graphics stack, and macOS
// then updates the per-user Metal shader cache (outside the workspace) on the game's behalf.
export const DUMP_COMMANDS = {
  data: ["--dump-data"],
  locale: ["--dump-prototype-locale"],
  runtime: ["--test-scenario", RUNTIME_SCENARIO, "--test-ticks", "600"],
};
export const DUMP_OUTPUTS = { data: "data-raw-dump.json", locale: "item-locale.json", runtime: RUNTIME_DUMP_FILE };
const SCENARIO_SOURCE = path.join(import.meta.dirname, "..", "runtime-dump", "control.lua");

/** Parses a dependency string such as "+ quality >= 2.1.0" into { name, kind, constraint }. */
export function parseDependency(text) {
  const match = /^\s*(\(\?\)|[!?~+])?\s*([A-Za-z0-9_-]+)\s*(.*)$/.exec(text);
  if (!match) throw new Error(`Unparseable dependency "${text}"`);
  const kinds = { "": "required", "~": "required", "+": "recommended", "?": "optional", "(?)": "optional", "!": "incompatible" };
  return { name: match[2], kind: kinds[match[1] ?? ""], constraint: match[3].trim() };
}

export function readModuleInfos(dataDir) {
  return STANDARD_MODULES.map((name) => {
    const info = JSON.parse(fs.readFileSync(path.join(dataDir, name, "info.json"), "utf8"));
    const dependencies = (info.dependencies ?? []).map(parseDependency);
    const pick = (kind) => dependencies.filter((d) => d.kind === kind).map((d) => d.name);
    const featureFlags = Object.keys(info).filter((key) => key.endsWith("_required") && info[key] === true).map((key) => key.slice(0, -"_required".length).replaceAll("_", "-"));
    return { name, title: info.title, version: info.version, requires: pick("required"), recommends: pick("recommended"), featureFlags };
  });
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

export const modSetId = (mods) => mods.join("+");

function sandboxProfile(writableRoot) {
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${JSON.stringify(writableRoot)}))`,
    '(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
    "(deny network-outbound (remote ip))",
    "(deny network-inbound (local ip))",
  ].join("\n");
}

function configIni(readData, writeData) {
  return [
    "; version=13",
    "[path]",
    `read-data=${readData}`,
    `write-data=${writeData}`,
    "[general]",
    "locale=en",
    "[other]",
    "enable-crash-log-uploading=false",
    "enable-steam-networking=false",
    "disable-blueprint-storage=true",
    "[graphics]",
    "full-screen=false",
    "[sound]",
    "master-volume=0",
    "",
  ].join("\n");
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
  const env = { PATH: "/usr/bin:/bin", HOME: home, CFFIXED_USER_HOME: home, TMPDIR: `${tmp}/`, LANG: "en_US.UTF-8" };
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

/** Runs one dump command for one module set; all game state lives in `<dumpRoot>/sets/<id>/`. */
export function runDump({ binary, dataDir, gameRoot, dumpRoot, mods, command, sandbox, log }) {
  const setDir = path.join(dumpRoot, "sets", modSetId(mods));
  const modDir = path.join(setDir, "mods");
  const configFile = path.join(setDir, "config", "config.ini");
  for (const dir of [modDir, path.dirname(configFile)]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFile, configIni(dataDir, setDir));
  fs.writeFileSync(path.join(modDir, "mod-list.json"), JSON.stringify({ mods: STANDARD_MODULES.map((name) => ({ name, enabled: mods.includes(name) })) }, null, 2) + "\n");
  if (command === "runtime") {
    const scenarioDir = path.join(setDir, "scenarios", RUNTIME_SCENARIO);
    fs.mkdirSync(scenarioDir, { recursive: true });
    fs.copyFileSync(SCENARIO_SOURCE, path.join(scenarioDir, "control.lua"));
  }
  const expected = path.join(setDir, "script-output", DUMP_OUTPUTS[command]);
  fs.rmSync(expected, { force: true });
  const args = ["--config", configFile, "--mod-directory", modDir, "--no-log-rotation", ...DUMP_COMMANDS[command]];
  const run = runGame({ binary, gameRoot, dumpRoot, cwd: setDir, args, sandbox, label: `${modSetId(mods)} ${DUMP_COMMANDS[command].slice(0, 2).join(" ")}`, log });
  fs.writeFileSync(path.join(setDir, `${command}.log`), run.output);
  if (!fs.existsSync(expected)) throw new Error(`${run.commandLine} did not produce ${expected}`);
  return { ...run, setDir };
}

/** Parses `factorio --version`: "Version: 2.1.24 (build 87808, mac-arm64, full)". */
export function gameVersion(options) {
  const run = runGame({ ...options, cwd: options.dumpRoot, args: ["--version"], label: "--version" });
  const match = /^Version: (\d+\.\d+\.\d+) \(build (\d+), ([^)]*)\)/m.exec(run.output);
  if (!match) throw new Error(`Cannot parse the game version from:\n${run.output}`);
  return { version: match[1], build: Number(match[2]), variant: match[3], commandLine: run.commandLine };
}
