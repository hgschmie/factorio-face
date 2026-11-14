// A stand-in for the game in the tests of the dump runner. It takes the arguments of a dump run, reads the private
// configuration it is given, rewrites the two files the game rewrites in its mod directory, and writes canned dump files.
// Started through a launcher that names a control file: { record, dump, mode?, at?, outside? }. Every start appends its
// arguments, environment and working directory to `record`. `mode` (at the command `at`, default every command):
//   fail       print an error and exit with code 3
//   hang       never end
//   flood      print without end
//   no-output  end well without writing anything
//   lua-error  runtime only: write the scenario's error file instead of the dump
//   quiet      print nothing; the log file has the version line (the Windows build)
//   noisy      print control characters and an escape sequence before the usual output
//   escape     try to write the file `outside` and say in `record` whether that worked
//   linger     leave a process behind that holds the output open for five seconds, and end well
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, , controlFile, ...args] = process.argv;
const control = JSON.parse(fs.readFileSync(controlFile, "utf8"));
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const command = args.includes("--dump-data") ? "data" : args.includes("--dump-prototype-locale") ? "locale" : args.includes("--test-scenario") ? "runtime" : "unknown";
const mode = control.at === undefined || control.at === command ? control.mode : undefined;
const record = { pid: process.pid, command, args, env: process.env, cwd: process.cwd() };

const config = fs.readFileSync(option("--config"), "utf8");
const writeData = /^write-data=(.*)$/m.exec(config)[1];
const output = path.join(writeData, "script-output");
// Inside a sandbox the record of the test is out of reach; the run's own folder is not.
const save = () => {
  for (const file of [control.record, path.join(writeData, "fake-record.jsonl")]) {
    try {
      return fs.appendFileSync(file, JSON.stringify(record) + "\n");
    } catch {
      // the next one
    }
  }
};
const VERSION_LINE = "   0.000 2026-11-14 10:00:00; Factorio 2.1.24 (build 87808, mac-arm64, full, space-age)\n";

if (mode === "escape") {
  try {
    fs.writeFileSync(control.outside, "escaped");
    record.escaped = true;
  } catch (error) {
    record.escaped = error.code;
  }
}
save();

fs.writeFileSync(path.join(writeData, "factorio-current.log"), VERSION_LINE + "   0.002 Running in headless mode\n");
if (mode === "noisy") process.stdout.write("\u001b[31mred\u001b[0m bell\u0007 nul\u0000 tab\there\r\n");
if (mode !== "quiet") process.stdout.write(VERSION_LINE + `   0.002 Program arguments: ${args.join(" ")}\n`);

// The game rewrites both files in the mod directory it is given.
const mods = option("--mod-directory");
fs.writeFileSync(path.join(mods, "mod-list.json"), JSON.stringify({ mods: [{ name: "base", enabled: true }] }, null, 2));
fs.writeFileSync(path.join(mods, "mod-settings.dat"), Buffer.alloc(16));

if (mode === "linger") spawn(process.execPath, ["-e", "setTimeout(() => undefined, 5000)"], { stdio: "inherit", detached: true }).unref();
if (mode === "fail") {
  process.stderr.write("   0.500 Error ModManager.cpp:1: Failed to load mods: something is wrong\n");
  process.exit(3);
} else if (mode === "hang") {
  setInterval(() => undefined, 1000);
} else if (mode === "flood") {
  const line = "   0.600 the same line again and again and again and again and again and again\n".repeat(64);
  const pour = () => {
    while (process.stdout.write(line));
    process.stdout.once("drain", pour);
  };
  pour();
} else if (mode !== "no-output") {
  fs.mkdirSync(output, { recursive: true });
  const copy = (name) => fs.copyFileSync(path.join(control.dump, name), path.join(output, name));
  if (command === "data") copy("data-raw-dump.json");
  if (command === "locale") for (const name of fs.readdirSync(control.dump).filter((file) => file.endsWith("-locale.json"))) copy(name);
  if (command === "runtime") {
    const scenario = path.join(writeData, "scenarios", option("--test-scenario"), "control.lua");
    if (!fs.existsSync(scenario)) {
      process.stderr.write(`Error: scenario not found: ${scenario}\n`);
      process.exit(1);
    }
    if (mode === "lua-error") fs.writeFileSync(path.join(output, "face-runtime-dump-error.txt"), "attempt to index field 'quality' (a nil value)\n");
    else copy("face-runtime-dump.json");
  }
  if (mode !== "quiet") process.stdout.write("   1.000 Goodbye\n");
}
