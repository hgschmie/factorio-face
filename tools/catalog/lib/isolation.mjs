// Proof that running the game for a dump does not write outside the workspace: fingerprints of every location the game
// or macOS could plausibly write to on its behalf are taken before and after each run and must be identical.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIBRARY_DIRS = ["Preferences", "Saved Application State", "Caches", "HTTPStorages", "WebKit", "Logs", "Containers", "Application Scripts", "Cookies"];

function darwinUserDir(name) {
  try {
    return execFileSync("getconf", [name], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/** Directories fingerprinted recursively, plus parent directories whose factorio-named entries are tracked. */
export function watchedLocations(gameRoot) {
  const home = os.userInfo().homedir;
  const trees = [gameRoot, path.join(home, "Library/Application Support/factorio"), path.join(home, ".factorio")];
  if (process.platform === "darwin") {
    for (const name of ["DARWIN_USER_CACHE_DIR", "DARWIN_USER_TEMP_DIR"]) {
      const dir = darwinUserDir(name);
      if (dir) trees.push(path.join(dir, "com.factorio"));
    }
  }
  return { trees, namedIn: LIBRARY_DIRS.map((d) => path.join(home, "Library", d)) };
}

function fingerprintTree(root) {
  if (!fs.existsSync(root)) return { root, exists: false };
  const hash = createHash("sha256");
  let entries = 0;
  let newest = { mtimeMs: 0, path: "" };
  const walk = (dir) => {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      hash.update(`${dir}\0unreadable:${error.code}\n`);
      return;
    }
    names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of names) {
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);
      entries++;
      hash.update(`${full}\0${stat.isDirectory() ? "d" : stat.size}\0${stat.mtimeMs}\n`);
      if (stat.mtimeMs > newest.mtimeMs) newest = { mtimeMs: stat.mtimeMs, path: full };
      if (entry.isDirectory()) walk(full);
    }
  };
  const rootStat = fs.lstatSync(root);
  hash.update(`${root}\0d\0${rootStat.mtimeMs}\n`);
  walk(fs.realpathSync(root));
  return { root, exists: true, entries, newestMtime: new Date(Math.max(newest.mtimeMs, rootStat.mtimeMs)).toISOString(), newestPath: newest.path || root, sha256: hash.digest("hex") };
}

function namedEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /factorio/i.test(name)).sort().map((name) => `${path.join(dir, name)}@${fs.lstatSync(path.join(dir, name)).mtimeMs}`);
}

export function snapshot(gameRoot) {
  const { trees, namedIn } = watchedLocations(gameRoot);
  return { takenAt: new Date().toISOString(), trees: trees.map(fingerprintTree), named: namedIn.flatMap(namedEntries) };
}

/** Returns a list of human-readable differences; empty means nothing outside the workspace changed. */
export function diffSnapshots(before, after) {
  const changes = [];
  before.trees.forEach((tree, index) => {
    const other = after.trees[index];
    if (tree.exists !== other.exists) changes.push(`${tree.root}: ${tree.exists ? "removed" : "created"}`);
    else if (tree.exists && tree.sha256 !== other.sha256) changes.push(`${tree.root}: changed (newest now ${other.newestPath} at ${other.newestMtime}, ${tree.entries} -> ${other.entries} entries)`);
  });
  const named = new Set(before.named);
  for (const entry of after.named) if (!named.has(entry)) changes.push(`new or modified: ${entry}`);
  for (const entry of before.named) if (!after.named.includes(entry)) changes.push(`removed or modified: ${entry}`);
  return changes;
}
