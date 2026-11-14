#!/usr/bin/env node
// Writes the example projects that ship with the app, examples/*.faceproj, with the app's own project writer. The readable form of
// an example is a circuit source next to this script: `<Project name>.face` becomes `examples/<Project name>.faceproj`, a project
// with the settings of a new one. The first example is the example of docs/dsl.md.
// Usage: node tools/examples/generate.ts [--check]
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createEmptyProject } from "../../apps/desktop/src/emptyProject.ts";
import { CIRCUIT_FILE_EXTENSION, PROJECT_FILE_EXTENSION, type ProjectData } from "../../apps/desktop/src/ipc.ts";
import { readProject, writeProject } from "../../apps/desktop/src/projectStore.ts";
import { parseExampleFileName, parseProjectData } from "../../apps/desktop/src/validation.ts";

const ROOT = resolve(import.meta.dirname, "../..");
export const SOURCES_DIRECTORY = import.meta.dirname;
export const EXAMPLES_DIRECTORY = resolve(ROOT, "examples");

export interface ExampleFile {
  /** File name of the project file in the examples directory. */
  readonly file: string;
  readonly data: ProjectData;
}

/** The example projects as this script writes them, one per circuit source, by file name. */
export async function exampleProjects(): Promise<ExampleFile[]> {
  const sources = (await readdir(SOURCES_DIRECTORY)).filter((name) => name.endsWith(CIRCUIT_FILE_EXTENSION)).sort();
  return Promise.all(
    sources.map(async (name) => {
      const project = createEmptyProject(basename(name, CIRCUIT_FILE_EXTENSION));
      const source = await readFile(resolve(SOURCES_DIRECTORY, name), "utf8");
      const data = parseProjectData({ manifest: project.manifest, files: [{ name: project.manifest.circuits[0], source }] });
      return { file: parseExampleFileName(data.manifest.name + PROJECT_FILE_EXTENSION), data };
    }),
  );
}

/** What is wrong with the committed examples directory, one line each: nothing when it holds exactly what this script writes. */
export async function staleExamples(): Promise<string[]> {
  const expected = await exampleProjects();
  const problems: string[] = [];
  for (const { file, data } of expected) {
    const committed = await readProject(resolve(EXAMPLES_DIRECTORY, file)).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    if (typeof committed === "string") problems.push(`${file}: ${committed}`);
    else if (!isDeepStrictEqual(committed.data, data)) problems.push(`${file} differs from its source`);
  }
  const known = new Set(expected.map((example) => example.file));
  const present = await readdir(EXAMPLES_DIRECTORY).catch(() => []);
  for (const name of present) if (name.endsWith(PROJECT_FILE_EXTENSION) && !known.has(name)) problems.push(`${name} has no source in tools/examples`);
  return problems;
}

/** Writes the examples that are missing or differ. A project file carries the time it was written, so one that is up to date is left alone. */
async function writeExamples(): Promise<void> {
  for (const { file, data } of await exampleProjects()) {
    const path = resolve(EXAMPLES_DIRECTORY, file);
    const committed = await readProject(path).catch(() => undefined);
    if (committed && isDeepStrictEqual(committed.data, data)) {
      console.log(`up to date: examples/${file}`);
      continue;
    }
    await writeProject(path, data);
    console.log(`written: examples/${file}`);
  }
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const problems = await staleExamples();
    for (const problem of problems) console.error(problem);
    if (problems.length > 0) {
      console.error("Run `npm run examples` to write the example projects again.");
      process.exit(1);
    }
  } else await writeExamples();
}
