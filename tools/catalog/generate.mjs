#!/usr/bin/env node
// Generates the signal catalog and its icon table from the locally installed game. See packages/catalog/README.md.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { KINDS } from "./lib/build.mjs";
import { DUMP_COMMANDS, gameVersion, locateGame, modSetId, readModuleInfos, runDump, validModSets } from "./lib/dump.mjs";
import { iconFileRenderer, iconTableText } from "./lib/iconFiles.ts";
import { watchedLocations } from "./lib/isolation.mjs";
import { DUMP_STAMP_FILE, buildFromDumps, completeDumps, moduleVersions } from "./lib/sets.mjs";

const EXPECTED_VERSION = "2.1.24";
const ICON_SIZE = 64;
const ROOT = path.resolve(import.meta.dirname, "../..");
const DUMP_ROOT = path.join(ROOT, ".runtime", "factorio-dump");

const USAGE = `Usage: node tools/catalog/generate.mjs [options]

  --accept-version   generate for the installed game version even if it is not ${EXPECTED_VERSION}
  --reuse-dumps      do not start the game when dumps of the same version exist in .runtime/factorio-dump
  --from-dumps       never start the game: build from the dumps in .runtime/factorio-dump and the game's data files,
                     and fail when the dumps are missing or of another version
  --no-icons         skip rendering packages/catalog/generated/icons
  --no-sandbox       run the game without sandbox-exec (the before/after isolation check still applies)
  --check            fail if the committed catalog or icon table differs from the generated one; write nothing
  --output <dir>     write data/ and generated/ below <dir> instead of packages/catalog, to compare a run with what is there
  --help

Environment: FACTORIO_BIN (default /Applications/factorio.app/Contents/MacOS/factorio), FACTORIO_DATA (default: the
"data" directory next to the binary's parent).`;

const FLAGS = ["--accept-version", "--reuse-dumps", "--from-dumps", "--no-icons", "--no-sandbox", "--check", "--help"];
const SIGNAL_FIELDS = ["name", "displayName", "order", "subgroup", "group", "prototype", "hidden", "parameter", "special", "wildcard", "visibility", "hideFromSignalGui", "placedBy", "itemAlias",
  "stackSize", "weight", "level", "color", "next", "icon", "liftWeight", "rocketPartsRequired", "modules", "removedBy", "variants"];

function fail(message) {
  console.error(`catalog: ${message}`);
  process.exit(1);
}

function ordered(record) {
  const out = {};
  for (const field of ["when", ...SIGNAL_FIELDS]) {
    if (record[field] === undefined) continue;
    out[field] = field === "variants" ? record.variants.map(ordered) : record[field];
  }
  const unknown = Object.keys(record).filter((field) => !(field in out));
  if (unknown.length) throw new Error(`Unordered catalog field(s): ${unknown.join(", ")}`);
  return out;
}

/** Top-level keys pretty-printed, every record on its own line: small, yet line-diffable. */
function serialise(catalog) {
  const list = (records, indent) => `[\n${records.map((record) => `${indent}  ${JSON.stringify(ordered(record))}`).join(",\n")}\n${indent}]`;
  const parts = [
    `"schema": ${catalog.schema}`,
    `"game": ${JSON.stringify(catalog.game)}`,
    `"provenance": ${JSON.stringify(catalog.provenance, null, 2).replaceAll("\n", "\n  ")}`,
    `"modules": [\n${catalog.modules.map((module) => `    ${JSON.stringify(module)}`).join(",\n")}\n  ]`,
    `"constants": ${JSON.stringify({ ...catalog.constants, rocketSilos: catalog.constants.rocketSilos.map(ordered) })}`,
    `"groups": ${list(catalog.groups, "  ")}`,
    `"subgroups": ${list(catalog.subgroups, "  ")}`,
    `"qualities": ${list(catalog.qualities, "  ")}`,
    `"speakers": [\n${catalog.speakers.map(serialiseSpeaker).join(",\n")}\n  ]`,
    `"signals": {\n${KINDS.map(({ kind }) => `    ${JSON.stringify(kind)}: ${list(catalog.signals[kind], "    ")}`).join(",\n")}\n  }`,
  ];
  return `{\n  ${parts.join(",\n  ")}\n}\n`;
}

/** One instrument per line; everything else of the record before them. */
function serialiseSpeaker({ instruments, ...rest }) {
  return `    {${JSON.stringify(rest).slice(1, -1)},"instruments":[\n${instruments.map((instrument) => `      ${JSON.stringify(instrument)}`).join(",\n")}\n    ]}`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const args = process.argv.slice(2);
  const outputAt = args.indexOf("--output");
  const output = outputAt < 0 ? undefined : args[outputAt + 1];
  if (outputAt >= 0 && (!output || output.startsWith("--"))) fail(`--output needs a directory\n\n${USAGE}`);
  if (outputAt >= 0) args.splice(outputAt, 2);
  const packageDir = output ? path.resolve(output) : path.join(ROOT, "packages", "catalog");
  const iconRoot = path.join(packageDir, "generated", "icons");
  const unknown = args.filter((arg) => !FLAGS.includes(arg));
  if (unknown.length) fail(`unknown option ${unknown.join(" ")}\n\n${USAGE}`);
  if (args.includes("--help")) return console.log(USAGE);
  const option = (name) => args.includes(name);

  let located;
  try {
    located = locateGame();
  } catch (error) {
    fail(error.message);
  }
  const { binary, dataDir, gameRoot } = located;
  const sandbox = !option("--no-sandbox");
  if (sandbox && (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec"))) fail("sandbox-exec is only available on macOS; pass --no-sandbox to rely on the before/after isolation check alone");
  fs.mkdirSync(DUMP_ROOT, { recursive: true });
  const dumpRoot = fs.realpathSync(DUMP_ROOT);
  const common = { binary, dataDir, gameRoot, dumpRoot, sandbox, log: (line) => console.log(`  ${line}`) };

  // 1. Versions: the five standard modules and the binary must all be the expected release.
  const modules = readModuleInfos(dataDir);
  const versions = moduleVersions(modules);
  const mismatched = modules.filter((m) => m.version !== EXPECTED_VERSION);
  if (mismatched.length && !option("--accept-version")) {
    fail(`this generator is pinned to Factorio ${EXPECTED_VERSION}, but ${dataDir} contains ${versions}.\nRe-run with --accept-version to generate packages/catalog/data/catalog-<version>.json for the installed release.`);
  }
  let running = "";
  try {
    running = execFileSync("/usr/bin/pgrep", ["-x", "factorio"], { encoding: "utf8" }).trim();
  } catch {
    // pgrep exits non-zero when nothing matches
  }
  if (running) console.log(`catalog: note: a game instance is already running (pid ${running.split("\n").join(", ")}); the dump uses its own write directory and does not touch it.`);

  const fromDumps = option("--from-dumps");
  const reuse = option("--reuse-dumps") || fromDumps;
  const stamp = completeDumps(dumpRoot, modules);
  const sets = validModSets(modules);
  let game = stamp?.game;
  let runs = stamp?.runs ?? [];
  if (fromDumps && !stamp) fail(`--from-dumps: ${path.relative(ROOT, dumpRoot)} has no complete dumps of ${versions}; run without the option to dump from the game`);
  if (!reuse || !stamp) {
    console.log(`catalog: dumping ${sets.length} module sets with ${binary}`);
    const probe = gameVersion(common);
    game = { version: probe.version, build: probe.build, variant: probe.variant };
    if (modules.some((m) => m.version !== game.version)) fail(`inconsistent installation: binary is ${game.version}, modules are ${versions}`);
    runs = [];
    for (const mods of sets) {
      for (const command of Object.keys(DUMP_COMMANDS)) {
        const run = runDump({ ...common, mods, command });
        runs.push({ set: modSetId(mods), command, commandLine: run.commandLine, seconds: run.seconds, isolation: run.isolation });
      }
    }
    fs.writeFileSync(path.join(dumpRoot, DUMP_STAMP_FILE), JSON.stringify({ versions, game, dumpedAt: new Date().toISOString(), runs }, null, 1) + "\n");
  } else {
    console.log(`catalog: reusing dumps of ${stamp.dumpedAt} in ${dumpRoot}`);
  }

  // 2. Build the catalog from all sets and prove the provenance rules reproduce each of them.
  const { catalog, icons } = buildFromDumps({ dumpRoot, dataDir, modules, game });
  const template = (command) => ["factorio", "--config", "<dump>/sets/<set>/config/config.ini", "--mod-directory", "<dump>/sets/<set>/mods", "--no-log-rotation", ...DUMP_COMMANDS[command]].join(" ");
  catalog.provenance = {
    generator: "tools/catalog/generate.mjs",
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    locale: "en",
    commands: Object.keys(DUMP_COMMANDS).map(template),
    modSets: sets.map(modSetId),
    icons: `icons-${game.version}.json names the image files of the game that each icon is composited from; no image is part of either file`,
  };

  // 3. Write the catalog only when its content (ignoring the timestamp) changed, so repeated runs are no-ops. The icon
  //    table (which image files make up each icon; no artwork) carries no timestamp and is compared as text.
  const target = path.join(packageDir, "data", `catalog-${game.version}.json`);
  const catalogText = serialise(catalog);
  const previous = fs.existsSync(target) ? readJson(target) : undefined;
  const sameContent = previous !== undefined && JSON.stringify({ ...previous, provenance: { ...previous.provenance, generatedAt: "" } }) === JSON.stringify({ ...JSON.parse(catalogText), provenance: { ...catalog.provenance, generatedAt: "" } });
  const tableTarget = path.join(packageDir, "data", `icons-${game.version}.json`);
  const table = iconTableText(catalog.game, icons);
  const outputs = [
    { file: target, same: sameContent, text: catalogText },
    { file: tableTarget, same: fs.existsSync(tableTarget) && fs.readFileSync(tableTarget, "utf8") === table, text: table },
  ];
  const relative = (file) => path.relative(ROOT, file);
  if (option("--check")) {
    const outdated = outputs.filter(({ same }) => !same).map(({ file }) => relative(file));
    if (outdated.length) fail(`out of date: ${outdated.join(", ")}`);
    return console.log(`catalog: up to date: ${outputs.map(({ file }) => relative(file)).join(", ")}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  for (const { file, same, text } of outputs) {
    if (!same) fs.writeFileSync(file, text);
    console.log(`catalog: ${same ? `${relative(file)} unchanged` : `wrote ${relative(file)}`}`);
  }
  if (game.version !== EXPECTED_VERSION) console.log(`catalog: note: packages/catalog/src/standard.ts and standardIconTable.ts still import the files of ${EXPECTED_VERSION}; point them at the new files and re-pin the tests.`);

  // 4. Icons (Wube artwork: git-ignored), composited by the code the app renders with.
  if (!option("--no-icons")) {
    const render = iconFileRenderer(dataDir);
    fs.rmSync(iconRoot, { recursive: true, force: true });
    for (const [id, entry] of icons) {
      const file = path.join(iconRoot, `${id}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, render(entry, ICON_SIZE));
    }
    console.log(`catalog: rendered ${icons.size} icons (${ICON_SIZE}px) into ${path.relative(ROOT, iconRoot)}`);
  }
  const manifest = {
    game,
    catalog: relative(target),
    generatedAt: new Date().toISOString(),
    binary,
    dataDir,
    sandbox,
    watched: watchedLocations(gameRoot),
    iconSize: ICON_SIZE,
    icons: Object.fromEntries([...icons].map(([id, { layers }]) => [id, layers.map((layer) => layer.icon)])),
    runs,
  };
  fs.mkdirSync(path.join(packageDir, "generated"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "generated", "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");

  const count = (records) => records.length;
  console.log(`catalog: Factorio ${game.version} (build ${game.build}); ${KINDS.map(({ kind }) => `${kind} ${count(catalog.signals[kind])}`).join(", ")}; groups ${count(catalog.groups)}, subgroups ${count(catalog.subgroups)}`);
}

try {
  main();
} catch (error) {
  fail(error.stack ?? String(error));
}
