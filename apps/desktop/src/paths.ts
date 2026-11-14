// Profile, asset and example locations. Development and test runs set FACE_USER_DATA so nothing is written outside the workspace.
import { isAbsolute, join, normalize, resolve } from "node:path";

export interface ProfilePaths {
  readonly userData: string;
  readonly sessionData: string;
  readonly logs: string;
  readonly crashDumps: string;
}

/** Returns the profile layout for FACE_USER_DATA, or undefined when the variable is unset (packaged default locations apply). */
export function profilePathsFromEnv(env: NodeJS.ProcessEnv): ProfilePaths | undefined {
  const base = env.FACE_USER_DATA;
  if (base === undefined || base === "") return undefined;
  if (!isAbsolute(base)) throw new Error(`FACE_USER_DATA must be an absolute path: ${base}`);
  const userData = normalize(base);
  return { userData, sessionData: join(userData, "session"), logs: join(userData, "logs"), crashDumps: join(userData, "crashes") };
}

/** FACE_PROJECTS_DIR: the folder project dialogs start in. Unset, the operating system picks (usually the last folder used). */
export function projectsDirectoryFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const directory = env.FACE_PROJECTS_DIR;
  if (directory === undefined || directory === "") return undefined;
  if (!isAbsolute(directory)) throw new Error(`FACE_PROJECTS_DIR must be an absolute path: ${directory}`);
  return normalize(directory);
}

export interface AssetRootOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly packaged: boolean;
  /** Directory of the bundled main script (dist/ in development). */
  readonly mainDirectory: string;
  readonly resourcesPath: string;
}

/** FACE_ASSET_ROOT wins; otherwise the generated catalog in the repository (development) or the bundled copy (packaged). */
export function resolveAssetRoot({ env, packaged, mainDirectory, resourcesPath }: AssetRootOptions): string {
  const override = env.FACE_ASSET_ROOT;
  if (override) {
    if (!isAbsolute(override)) throw new Error(`FACE_ASSET_ROOT must be an absolute path: ${override}`);
    return normalize(override);
  }
  return packaged ? join(resourcesPath, "catalog") : resolve(mainDirectory, "../packages/catalog/generated");
}

/** Where the example projects are: FACE_EXAMPLES_DIR wins; otherwise `examples/` of the repository (development) or of the application's resources (packaged). */
export function resolveExamplesDirectory({ env, packaged, mainDirectory, resourcesPath }: AssetRootOptions): string {
  const override = env.FACE_EXAMPLES_DIR;
  if (override) {
    if (!isAbsolute(override)) throw new Error(`FACE_EXAMPLES_DIR must be an absolute path: ${override}`);
    return normalize(override);
  }
  return packaged ? join(resourcesPath, "examples") : resolve(mainDirectory, "../examples");
}
