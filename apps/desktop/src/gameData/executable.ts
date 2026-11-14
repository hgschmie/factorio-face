// Where the program of the game is, for an installation the app found by its data (gameInstallation.ts). Nothing here starts
// it. The platform is a parameter and only decides where the program is looked for, so every platform's rule can be tested on
// any machine.
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

/** Below the folder that holds `data`: `factorio.app/Contents` on macOS, the game folder elsewhere. */
const EXECUTABLE_SEGMENTS: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  darwin: ["MacOS", "factorio"],
  win32: ["bin", "x64", "factorio.exe"],
  linux: ["bin", "x64", "factorio"],
};

export type ExecutableProblem = "unsupported-platform" | "no-executable" | "not-executable";

export type ExecutableLocation =
  | {
      readonly ok: true;
      /** The program with links resolved: what is started, and what the user is shown before it is. */
      readonly executable: string;
      /** The folder that holds `data` and the program's folder, as the installation names it. */
      readonly gameRoot: string;
      /** Inside a Steam library. Such a build may hand over to the Steam client when started. */
      readonly steam: boolean;
    }
  | { readonly ok: false; readonly problem: ExecutableProblem; readonly message: string };

/** Where the program belongs for a `data` directory, or undefined on a platform the game does not run on. Pure. */
export function executablePath(dataDirectory: string, platform: NodeJS.Platform): string | undefined {
  const segments = EXECUTABLE_SEGMENTS[platform];
  return segments && join(dirname(dataDirectory), ...segments);
}

/** Finds the program beside the `data` directory of an installation. Never throws for what it finds on disk. */
export async function locateGameExecutable(dataDirectory: string, platform: NodeJS.Platform): Promise<ExecutableLocation> {
  const expected = executablePath(dataDirectory, platform);
  if (expected === undefined) return { ok: false, problem: "unsupported-platform", message: `The game cannot be started on this platform (${platform})` };
  const missing: ExecutableLocation = { ok: false, problem: "no-executable", message: `This installation has the game's data but not the game itself (a copy of the data alone): ${expected} is missing` };
  try {
    const executable = await realpath(expected);
    if (!(await stat(executable)).isFile()) return missing;
    // Windows has no execute permission; a file of that name is a program there.
    if (platform !== "win32" && !(await access(executable, constants.X_OK).then(() => true, () => false))) {
      return { ok: false, problem: "not-executable", message: `The game's program cannot be executed: ${executable}` };
    }
    return { ok: true, executable, gameRoot: dirname(dataDirectory), steam: [expected, executable].some((file) => file.toLowerCase().split(sep).includes("steamapps")) };
  } catch {
    return missing;
  }
}
