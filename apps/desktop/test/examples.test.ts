import { strToU8, zipSync } from "fflate";
import { mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../src/emptyProject.ts";
import { Examples } from "../src/examples.ts";
import { LIMITS, type ProjectData } from "../src/ipc.ts";
import { writeProject } from "../src/projectStore.ts";
import { ValidationError } from "../src/validation.ts";
import { useScratch } from "./support/scratch.ts";

const scratch = useScratch("examples-test");

function example(name: string, source = `circuit ${JSON.stringify(name)} {\n}\n`): ProjectData {
  const project = createEmptyProject(name);
  return { manifest: project.manifest, files: [{ name: "main.face", source }] };
}

/** A fresh examples directory with the given project files, by file name. */
async function directory(name: string, projects: Readonly<Record<string, ProjectData>> = {}): Promise<string> {
  const path = scratch(name);
  await mkdir(path);
  for (const [file, data] of Object.entries(projects)) await writeProject(scratch(name, file), data);
  return path;
}

describe("example projects", () => {
  it("lists the project files of the directory by project name, whatever the files are called", async () => {
    const path = await directory("listed", { "a.faceproj": example("Zebra crossing"), "z.faceproj": example("Adder"), "Feedback example.faceproj": example("Feedback example") });
    expect(await new Examples(path).list()).toEqual([
      { file: "z.faceproj", name: "Adder" },
      { file: "Feedback example.faceproj", name: "Feedback example" },
      { file: "a.faceproj", name: "Zebra crossing" },
    ]);
  });

  it("leaves out what is not a project file directly in the directory, and says which files it could not read", async () => {
    const path = await directory("mixed", { "good.faceproj": example("Good") });
    const outside = await directory("mixed-outside", { "secret.faceproj": example("Secret") });
    await writeFile(scratch("mixed", "notes.txt"), "not a project");
    await writeFile(scratch("mixed", "good.face"), 'circuit "Source" {\n}\n');
    await writeFile(scratch("mixed", ".hidden.faceproj"), zipSync({ "face.json": strToU8(JSON.stringify(example("Hidden").manifest)), "main.face": strToU8("") }));
    await writeFile(scratch("mixed", "damaged.faceproj"), "this is not a zip archive");
    await mkdir(scratch("mixed", "folder.faceproj"));
    await writeProject(scratch("mixed", "folder.faceproj", "inner.faceproj"), example("Inner"));
    await symlink(scratch("mixed-outside", "secret.faceproj"), scratch("mixed", "link.faceproj"));
    await symlink(outside, scratch("mixed", "linked-folder.faceproj"));

    const problems: [string, string][] = [];
    const examples = new Examples(path, (file, error) => void problems.push([file, (error as Error).message]));
    expect(await examples.list()).toEqual([{ file: "good.faceproj", name: "Good" }]);
    expect(problems).toEqual([["damaged.faceproj", expect.stringContaining("Not a face project file")]]);
    // What is not listed cannot be opened, although the file is there.
    for (const file of ["link.faceproj", "damaged.faceproj", ".hidden.faceproj", "folder.faceproj", "notes.txt"]) await expect(examples.open(file)).rejects.toThrow(ValidationError);
  });

  it("has no examples without the directory", async () => {
    const examples = new Examples(scratch("missing"));
    expect(await examples.list()).toEqual([]);
    await expect(examples.open("Feedback example.faceproj")).rejects.toThrow("Not an example of this application: Feedback example.faceproj");
  });

  it("bounds the number of examples", async () => {
    const projects = Object.fromEntries(Array.from({ length: LIMITS.examples + 3 }, (_, i) => [`e${String(i).padStart(3, "0")}.faceproj`, example(`Example ${i}`)]));
    expect(await new Examples(await directory("many", projects)).list()).toHaveLength(LIMITS.examples);
  });

  it("opens a listed example as a project without a path", async () => {
    const data = example("Feedback example", '// A counter.\ncircuit "Feedback example" {\n}\n');
    const examples = new Examples(await directory("opened", { "Feedback example.faceproj": data }));
    expect(await examples.open("Feedback example.faceproj")).toEqual({ path: null, data });
  });

  it.each([
    ["a path below the directory", "sub/inner.faceproj"],
    ["a path out of the directory", "../outside/secret.faceproj"],
    ["an absolute path", "/etc/passwd"],
    ["the absolute path of a listed example", "ABSOLUTE"],
    ["a Windows path", "..\\outside\\secret.faceproj"],
    ["a drive", "C:secret.faceproj"],
    ["dots", ".."],
    ["a name with a NUL", "inner.faceproj\0.txt"],
    ["a name without the extension", "inner"],
    ["a file that is not listed", "other.faceproj"],
    ["a file name in another case", "INNER.FACEPROJ"],
    ["nothing", ""],
    ["a number", 42],
    ["a list", ["inner.faceproj"]],
    ["an object", { file: "inner.faceproj" }],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s as the name of an example", async (_what, name) => {
    const path = scratch("refused");
    await rm(path, { recursive: true, force: true });
    await rm(scratch("outside"), { recursive: true, force: true });
    await directory("refused", { "inner.faceproj": example("Inner") });
    await directory("outside", { "secret.faceproj": example("Secret") });
    await mkdir(scratch("refused", "sub"));
    await writeProject(scratch("refused", "sub", "inner.faceproj"), example("Below"));
    await writeProject(scratch("refused", "other.faceproj"), example("Other"));

    const examples = new Examples(path);
    // The list as the menu got it: a file that appears later is not part of it.
    await rm(scratch("refused", "other.faceproj"));
    expect(await examples.list()).toEqual([{ file: "inner.faceproj", name: "Inner" }]);
    await writeProject(scratch("refused", "other.faceproj"), example("Other"));
    await expect(examples.open(name === "ABSOLUTE" ? scratch("refused", "inner.faceproj") : name)).rejects.toThrow(ValidationError);
    expect((await examples.open("inner.faceproj")).data.manifest.name).toBe("Inner");
  });

  it("reads an example with the limits and the validation of any project file", async () => {
    const path = await directory("limits", { "grown.faceproj": example("Grown"), "changed.faceproj": example("Changed") });
    const examples = new Examples(path);
    expect(await examples.list()).toHaveLength(2);
    // Both files change after they were listed: one grows beyond the size limit, the other gets a manifest that is not valid.
    await truncate(scratch("limits", "grown.faceproj"), LIMITS.projectFileBytes + 1);
    await writeFile(scratch("limits", "changed.faceproj"), zipSync({ "face.json": strToU8(JSON.stringify({ ...example("Changed").manifest, formatVersion: 2 })), "main.face": strToU8("") }));
    await expect(examples.open("grown.faceproj")).rejects.toThrow(/project file is too large/);
    await expect(examples.open("changed.faceproj")).rejects.toThrow(/Unsupported project format version/);
  });
});
