// Reads and writes project directories (format v1). Callers pass validated paths and data; file contents read from disk are validated here.
import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DEFAULT_CIRCUIT_FILE, LIMITS, MANIFEST_FILE_NAME, PROJECT_FORMAT_VERSION, type LoadedProject, type ProjectData } from "./ipc.ts";
import { parseManifest, resolveInsideProject, ValidationError } from "./validation.ts";

export const DEFAULT_GAME_VERSION = "2.1.24";
export const DEFAULT_MODULES = ["base", "space-age", "quality", "recycler", "elevated-rails"] as const;

export function createEmptyProject(name = "Untitled circuit"): ProjectData {
  return {
    manifest: { formatVersion: PROJECT_FORMAT_VERSION, name, gameVersion: DEFAULT_GAME_VERSION, modules: [...DEFAULT_MODULES], customSignalGroups: [], circuits: [DEFAULT_CIRCUIT_FILE] },
    files: [{ name: DEFAULT_CIRCUIT_FILE, source: `circuit ${JSON.stringify(name)} {\n}\n` }],
  };
}

/** Writes to a temporary file in the same directory, flushes it and renames it over the target, so readers never see a partial file. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o644);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readBoundedFile(path: string, maxBytes: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw new ValidationError(`${basename(path)} is not a regular file`);
  if (info.size > maxBytes) throw new ValidationError(`${basename(path)} is too large`);
  return readFile(path, "utf8");
}

export async function readProject(directory: string): Promise<LoadedProject> {
  let manifestText: string;
  try {
    manifestText = await readBoundedFile(join(directory, MANIFEST_FILE_NAME), LIMITS.manifestBytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ValidationError(`Not a face project (no ${MANIFEST_FILE_NAME}): ${directory}`);
    throw error;
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch {
    throw new ValidationError(`${MANIFEST_FILE_NAME} is not valid JSON`);
  }
  const manifest = parseManifest(manifestJson);
  // A UTF-8 file can need up to three bytes per UTF-16 code unit.
  const files = await Promise.all(manifest.circuits.map(async (name) => ({ name, source: await readBoundedFile(resolveInsideProject(directory, name), LIMITS.circuitSourceLength * 3) })));
  return { path: directory, data: { manifest, files } };
}

/** Refuses to turn an unrelated, non-empty directory into a project. */
async function assertUsableProjectDirectory(directory: string): Promise<void> {
  const info = await stat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info) return;
  if (!info.isDirectory()) throw new ValidationError(`Not a directory: ${directory}`);
  const entries = (await readdir(directory)).filter((entry) => entry !== ".DS_Store");
  if (entries.length > 0 && !entries.includes(MANIFEST_FILE_NAME)) throw new ValidationError(`The directory is not empty and is not a face project: ${directory}`);
}

export async function writeProject(directory: string, data: ProjectData): Promise<void> {
  await assertUsableProjectDirectory(directory);
  await mkdir(directory, { recursive: true });
  // Sources first: the manifest only ever lists files that are completely written.
  for (const file of data.files) await writeFileAtomic(resolveInsideProject(directory, file.name), file.source);
  await writeFileAtomic(join(directory, MANIFEST_FILE_NAME), JSON.stringify(data.manifest, null, 2) + "\n");
}
