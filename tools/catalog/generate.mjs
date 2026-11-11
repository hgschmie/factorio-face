#!/usr/bin/env node
// Generates the signal catalog from the locally installed game. See packages/catalog/README.md.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { KINDS, LOCALE_SECTIONS, buildCatalog } from "./lib/build.mjs";
import { DUMP_COMMANDS, DUMP_OUTPUTS, RUNTIME_DUMP_FILE, gameVersion, modSetId, readModuleInfos, runDump, validModSets } from "./lib/dump.mjs";
import { IconRenderer } from "./lib/icons.mjs";
import { watchedLocations } from "./lib/isolation.mjs";

const EXPECTED_VERSION = "2.1.24";
const ICON_SIZE = 64;
const ROOT = path.resolve(import.meta.dirname, "../..");
const DUMP_ROOT = path.join(ROOT, ".runtime", "factorio-dump");
const PACKAGE = path.join(ROOT, "packages", "catalog");
const ICON_ROOT = path.join(PACKAGE, "generated", "icons");

const USAGE = `Usage: node tools/catalog/generate.mjs [options]

  --accept-version   generate for the installed game version even if it is not ${EXPECTED_VERSION}
  --reuse-dumps      do not start the game when dumps of the same version exist in .runtime/factorio-dump
  --no-icons         skip rendering packages/catalog/generated/icons
  --no-sandbox       run the game without sandbox-exec (the before/after isolation check still applies)
  --check            fail if the committed catalog differs from the generated one; write nothing
  --help

Environment: FACTORIO_BIN (default /Applications/factorio.app/Contents/MacOS/factorio), FACTORIO_DATA (default: the
"data" directory next to the binary's parent).`;

const FLAGS = ["--accept-version", "--reuse-dumps", "--no-icons", "--no-sandbox", "--check", "--help"];
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
    `"signals": {\n${KINDS.map(({ kind }) => `    ${JSON.stringify(kind)}: ${list(catalog.signals[kind], "    ")}`).join(",\n")}\n  }`,
  ];
  return `{\n  ${parts.join(",\n  ")}\n}\n`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadSet(mods) {
  const output = path.join(DUMP_ROOT, "sets", modSetId(mods), "script-output");
  const locale = {};
  for (const section of LOCALE_SECTIONS) {
    const file = path.join(output, `${section}-locale.json`);
    if (fs.existsSync(file)) locale[section] = readJson(file).names;
  }
  return { id: modSetId(mods), mods, raw: readJson(path.join(output, DUMP_OUTPUTS.data)), runtime: readJson(path.join(output, RUNTIME_DUMP_FILE)), locale };
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !FLAGS.includes(arg));
  if (unknown.length) fail(`unknown option ${unknown.join(" ")}\n\n${USAGE}`);
  if (args.includes("--help")) return console.log(USAGE);
  const option = (name) => args.includes(name);

  const binary = process.env.FACTORIO_BIN ?? "/Applications/factorio.app/Contents/MacOS/factorio";
  const dataDir = fs.realpathSync(process.env.FACTORIO_DATA ?? path.resolve(binary, "../../data"));
  if (!fs.existsSync(binary)) fail(`game binary not found at ${binary} (set FACTORIO_BIN)`);
  const appBundle = /^(.*\.app)\//.exec(binary)?.[1];
  const gameRoot = appBundle ?? path.dirname(dataDir);
  const sandbox = !option("--no-sandbox");
  if (sandbox && (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec"))) fail("sandbox-exec is only available on macOS; pass --no-sandbox to rely on the before/after isolation check alone");
  fs.mkdirSync(DUMP_ROOT, { recursive: true });
  const dumpRoot = fs.realpathSync(DUMP_ROOT);
  const common = { binary, dataDir, gameRoot, dumpRoot, sandbox, log: (line) => console.log(`  ${line}`) };

  // 1. Versions: the five standard modules and the binary must all be the expected release.
  const modules = readModuleInfos(dataDir);
  const versions = modules.map((m) => `${m.name} ${m.version}`).join(", ");
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

  const reuse = option("--reuse-dumps");
  const stampFile = path.join(dumpRoot, "dump-info.json");
  const stamp = fs.existsSync(stampFile) ? readJson(stampFile) : undefined;
  const sets = validModSets(modules);
  const stale = !stamp || stamp.versions !== versions || sets.some((mods) => Object.values(DUMP_OUTPUTS).some((file) => !fs.existsSync(path.join(dumpRoot, "sets", modSetId(mods), "script-output", file))));
  let game = stamp?.game;
  let runs = stamp?.runs ?? [];
  if (!reuse || stale) {
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
    fs.writeFileSync(stampFile, JSON.stringify({ versions, game, dumpedAt: new Date().toISOString(), runs }, null, 1) + "\n");
  } else {
    console.log(`catalog: reusing dumps of ${stamp.dumpedAt} in ${dumpRoot}`);
  }

  // 2. Build the catalog from all sets and prove the provenance rules reproduce each of them.
  const loaded = sets.map(loadSet);
  for (const set of loaded) {
    if (set.runtime.game_version !== game.version) fail(`${set.id}: runtime dump is from ${set.runtime.game_version}, expected ${game.version}`);
    const active = Object.keys(set.runtime.active_mods).sort().join();
    if (active !== [...set.mods].sort().join()) fail(`${set.id}: the game loaded ${active}`);
  }
  // The build variant ("mac-arm64, full") stays out of the committed file so that it is the same on every platform.
  const { catalog, icons } = buildCatalog({ sets: loaded, modules, game: { version: game.version, build: game.build } });
  const template = (command) => ["factorio", "--config", "<dump>/sets/<set>/config/config.ini", "--mod-directory", "<dump>/sets/<set>/mods", "--no-log-rotation", ...DUMP_COMMANDS[command]].join(" ");
  catalog.provenance = {
    generator: "tools/catalog/generate.mjs",
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    locale: "en",
    commands: Object.keys(DUMP_COMMANDS).map(template),
    modSets: sets.map(modSetId),
    icons: "rendered from the game's icon PNGs by tools/catalog/lib/icons.mjs; not part of this file",
  };

  // 3. Write the catalog only when its content (ignoring the timestamp) changed, so repeated runs are no-ops.
  const target = path.join(PACKAGE, "data", `catalog-${game.version}.json`);
  const previous = fs.existsSync(target) ? readJson(target) : undefined;
  const sameContent = previous && JSON.stringify({ ...previous, provenance: { ...previous.provenance, generatedAt: "" } }) === JSON.stringify({ ...JSON.parse(serialise(catalog)), provenance: { ...catalog.provenance, generatedAt: "" } });
  const relative = path.relative(ROOT, target);
  if (option("--check")) {
    if (!sameContent) fail(`${relative} is out of date`);
    return console.log(`catalog: ${relative} is up to date`);
  }
  if (sameContent) console.log(`catalog: ${relative} unchanged`);
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serialise(catalog));
    console.log(`catalog: wrote ${relative}`);
  }
  if (game.version !== EXPECTED_VERSION) console.log(`catalog: note: packages/catalog/src/standard.ts still imports catalog-${EXPECTED_VERSION}.json; point it at the new file and re-pin the tests.`);

  // 4. Icons (Wube artwork: git-ignored).
  if (!option("--no-icons")) {
    const renderer = new IconRenderer(dataDir);
    fs.rmSync(ICON_ROOT, { recursive: true, force: true });
    for (const [id, { layers, expected }] of icons) {
      const file = path.join(ICON_ROOT, `${id}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, renderer.renderPng(layers, { expected, output: ICON_SIZE }));
    }
    console.log(`catalog: rendered ${icons.size} icons (${ICON_SIZE}px) into ${path.relative(ROOT, ICON_ROOT)}`);
  }
  const manifest = {
    game,
    catalog: relative,
    generatedAt: new Date().toISOString(),
    binary,
    dataDir,
    sandbox,
    watched: watchedLocations(gameRoot),
    iconSize: ICON_SIZE,
    icons: Object.fromEntries([...icons].map(([id, { layers }]) => [id, layers.map((layer) => layer.icon)])),
    runs,
  };
  fs.mkdirSync(path.join(PACKAGE, "generated"), { recursive: true });
  fs.writeFileSync(path.join(PACKAGE, "generated", "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");

  const count = (records) => records.length;
  console.log(`catalog: Factorio ${game.version} (build ${game.build}); ${KINDS.map(({ kind }) => `${kind} ${count(catalog.signals[kind])}`).join(", ")}; groups ${count(catalog.groups)}, subgroups ${count(catalog.subgroups)}`);
}

try {
  main();
} catch (error) {
  fail(error.stack ?? String(error));
}
