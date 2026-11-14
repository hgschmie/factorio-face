// The example projects that ship with the app: the project files of one directory. An example is opened as a copy without a path,
// so the shipped file is only ever read.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { LIMITS, type LoadedProject } from "./ipc.ts";
import { readProject } from "./projectStore.ts";
import { parseExampleFileName, ValidationError } from "./validation.ts";

export interface ExampleProject {
  /** File name inside the examples directory: what a caller names to open the example. */
  readonly file: string;
  /** The project's name, from its manifest. */
  readonly name: string;
}

export class Examples {
  private listed: Promise<readonly ExampleProject[]> | undefined;

  constructor(
    private readonly directory: string,
    private readonly onProblem: (file: string, error: unknown) => void = () => undefined,
  ) {}

  /**
   * The project files directly in the directory that can be read as projects, by project name. Read once per run. Links, folders and
   * files that are not projects are left out; a directory that does not exist has no examples.
   */
  list(): Promise<readonly ExampleProject[]> {
    return (this.listed ??= this.scan());
  }

  private async scan(): Promise<readonly ExampleProject[]> {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    const files = entries.filter((entry) => entry.isFile() && isExampleFileName(entry.name)).map((entry) => entry.name);
    const examples: ExampleProject[] = [];
    for (const file of files.sort().slice(0, LIMITS.examples)) {
      try {
        examples.push({ file, name: (await readProject(join(this.directory, file))).data.manifest.name });
      } catch (error) {
        this.onProblem(file, error);
      }
    }
    return examples.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Reads an example, with the limits and the validation of any project file. `file` is untrusted: it must be a plain file name, and
   * one that `list` returned, so a caller can reach the listed files of the examples directory and nothing else.
   */
  async open(file: unknown): Promise<LoadedProject> {
    const name = parseExampleFileName(file);
    if (!(await this.list()).some((example) => example.file === name)) throw new ValidationError(`Not an example of this application: ${name}`);
    const { data } = await readProject(join(this.directory, name));
    return { path: null, data };
  }
}

function isExampleFileName(name: string): boolean {
  try {
    return parseExampleFileName(name) === name;
  } catch (error) {
    if (error instanceof ValidationError) return false;
    throw error;
  }
}
