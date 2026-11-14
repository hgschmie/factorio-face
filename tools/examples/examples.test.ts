import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Examples } from "../../apps/desktop/src/examples.ts";
import { DEFAULT_CIRCUIT_FILE } from "../../apps/desktop/src/ipc.ts";
import { readProject } from "../../apps/desktop/src/projectStore.ts";
import { EXAMPLES_DIRECTORY, exampleProjects, staleExamples } from "./generate.ts";

const FEEDBACK = "Feedback example.faceproj";

/** The example of the language description: the first code block of its "Example" section. */
async function documentedExample(): Promise<string> {
  const text = await readFile(resolve(import.meta.dirname, "../../docs/dsl.md"), "utf8");
  const block = /^## Example\n+```text\n([\s\S]*?)^```$/m.exec(text);
  if (!block) throw new Error("docs/dsl.md has no example block");
  return block[1]!;
}

describe("example projects", () => {
  it("are committed as the generator writes them", async () => {
    expect(await staleExamples()).toEqual([]);
  });

  it("ship the example of docs/dsl.md, in the generator's output and in the committed project file", async () => {
    const documented = await documentedExample();
    expect(documented).toContain('circuit "Feedback example" {');
    const generated = (await exampleProjects()).find((example) => example.file === FEEDBACK);
    expect(generated?.data.manifest.name).toBe("Feedback example");
    expect(generated?.data.files).toEqual([{ name: DEFAULT_CIRCUIT_FILE, source: documented }]);
    const committed = await readProject(resolve(EXAMPLES_DIRECTORY, FEEDBACK));
    expect(committed.data).toEqual(generated?.data);
  });

  it("are what the app lists from the repository's examples directory", async () => {
    const problems: string[] = [];
    const examples = new Examples(EXAMPLES_DIRECTORY, (file) => void problems.push(file));
    const listed = [...(await examples.list())].sort((a, b) => a.file.localeCompare(b.file));
    const generated = (await exampleProjects()).map(({ file, data }) => ({ file, name: data.manifest.name })).sort((a, b) => a.file.localeCompare(b.file));
    expect(listed).toEqual(generated);
    expect(problems).toEqual([]);
    expect(await examples.open(FEEDBACK)).toEqual({ path: null, data: (await readProject(resolve(EXAMPLES_DIRECTORY, FEEDBACK))).data });
  });
});
