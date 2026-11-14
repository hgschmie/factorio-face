// The scenario of the blueprint probe: blueprints.lua with the cases in front of it. The cases are TypeScript that imports the
// language package, which Node cannot run by stripping types, so they are bundled with esbuild first.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HERE = import.meta.dirname;

/** The cases of lib/blueprintCases.ts; the bundle is written to `workDir`. */
export async function loadCases(workDir) {
  const outfile = path.join(workDir, "blueprint-cases.mjs");
  await build({ entryPoints: [path.join(HERE, "blueprintCases.ts")], bundle: true, format: "esm", platform: "node", target: "node24", outfile, logLevel: "silent" });
  const module = await import(`${pathToFileURL(outfile).href}?at=${Date.now()}`);
  return module.probeCases();
}

/** JSON in ASCII only, so that the Lua file is the same bytes whatever reads it. */
const asciiJson = (value) => JSON.stringify(value).replace(/[^\x00-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** The Lua source of the scenario: one line that holds the cases as a JSON string, then blueprints.lua. */
export function composeScenario(cases) {
  const json = asciiJson(cases);
  // A long string ends at the first `]==]`; JSON of ours has none, and a check costs nothing.
  if (json.includes("]==]")) throw new Error("the cases contain ']==]', which ends the Lua string they are passed in");
  return `local CASES_JSON = [==[${json}]==]\n${fs.readFileSync(path.join(HERE, "..", "blueprints.lua"), "utf8")}`;
}
