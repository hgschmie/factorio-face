// Reads and writes project files (format v1): a zip archive with face.json and the circuit sources at its root.
// Callers pass validated paths and data; everything read from disk is untrusted and validated here.
import { strToU8, unzipSync, zipSync, type UnzipFileInfo, type Unzipped } from "fflate";
import { randomBytes } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DEFAULT_CIRCUIT_FILE, LIMITS, MANIFEST_FILE_NAME, PROJECT_FILE_EXTENSION, PROJECT_FORMAT_VERSION, type LoadedProject, type ProjectData } from "./ipc.ts";
import { manifestFileContent, parseArchiveEntryName, parseCircuitFileName, parseManifestFile, ValidationError } from "./validation.ts";

export const DEFAULT_GAME_VERSION = "2.1.24";
export const DEFAULT_MODULES = ["base", "space-age", "quality", "recycler", "elevated-rails"] as const;

export function createEmptyProject(name = "Untitled circuit"): ProjectData {
  return {
    manifest: { formatVersion: PROJECT_FORMAT_VERSION, name, gameVersion: DEFAULT_GAME_VERSION, modules: [...DEFAULT_MODULES], customSignalGroups: [], circuits: [DEFAULT_CIRCUIT_FILE] },
    files: [{ name: DEFAULT_CIRCUIT_FILE, source: `circuit ${JSON.stringify(name)} {\n}\n` }],
  };
}

/** Writes to a temporary file in the same directory, flushes it and renames it over the target, so readers never see a partial file. */
export async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o644);
    try {
      await handle.writeFile(content);
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

const STORED = 0;
const DEFLATED = 8;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function readArchive(path: string): Promise<Uint8Array> {
  const tooLarge = (): never => {
    throw new ValidationError(`The project file is too large (limit ${megabytes(LIMITS.projectFileBytes)}): ${path}`);
  };
  const info = await stat(path).catch((error: unknown) => {
    throw isMissing(error) ? new ValidationError(`Project file not found: ${path}`) : error;
  });
  if (info.isDirectory()) throw new ValidationError(`Not a face project file (it is a folder; a project is a single ${PROJECT_FILE_EXTENSION} file): ${path}`);
  if (!info.isFile()) throw new ValidationError(`Not a face project file: ${path}`);
  if (info.size > LIMITS.projectFileBytes) tooLarge();
  const bytes = await readFile(path);
  // The file may have grown since it was measured.
  if (bytes.length > LIMITS.projectFileBytes) tooLarge();
  return bytes;
}

/**
 * Inflates the entries named in `wanted` (entry name to size limit in bytes) and returns those that exist. Every entry of
 * the archive is counted and has its name checked; entries that are not wanted are never inflated.
 */
function extractEntries(archive: Uint8Array, wanted: ReadonlyMap<string, number>, path: string): Map<string, Uint8Array> {
  const declaredSizes = new Map<string, number>();
  let contentBytes = 0;
  const filter = ({ name, size, originalSize, compression }: UnzipFileInfo): boolean => {
    if (declaredSizes.size >= LIMITS.projectEntries) throw new ValidationError(`The project file has too many entries (limit ${LIMITS.projectEntries}): ${path}`);
    parseArchiveEntryName(name);
    if (declaredSizes.has(name)) throw new ValidationError(`The project file contains ${JSON.stringify(name)} more than once: ${path}`);
    declaredSizes.set(name, originalSize);
    const limit = wanted.get(name);
    if (limit === undefined) return false;
    if (compression !== STORED && compression !== DEFLATED) throw new ValidationError(`${name} uses a compression method that is not supported: ${path}`);
    // A stored entry is copied at its compressed size, whatever size it declares.
    if (originalSize > limit || (compression === STORED && size > limit)) throw new ValidationError(`${name} is too large: ${path}`);
    contentBytes += originalSize;
    if (contentBytes > LIMITS.projectContentBytes) throw new ValidationError(`The project is too large (limit ${megabytes(LIMITS.projectContentBytes)}): ${path}`);
    return true;
  };
  let inflated: Unzipped;
  try {
    inflated = unzipSync(archive, { filter });
  } catch (error) {
    throw error instanceof ValidationError ? error : new ValidationError(`Not a face project file (it is not a readable zip archive): ${path}`);
  }
  const entries = new Map<string, Uint8Array>();
  for (const [name, limit] of wanted) {
    const bytes = Object.hasOwn(inflated, name) ? inflated[name] : undefined;
    if (!bytes) continue;
    if (bytes.length > limit) throw new ValidationError(`${name} is too large: ${path}`);
    if (bytes.length !== declaredSizes.get(name)) throw new ValidationError(`${name} is damaged: ${path}`);
    entries.set(name, bytes);
  }
  return entries;
}

function decodeText(name: string, bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new ValidationError(`${name} is not valid UTF-8 text`);
  }
}

export async function readProject(path: string): Promise<LoadedProject> {
  const archive = await readArchive(path);
  const manifestBytes = extractEntries(archive, new Map([[MANIFEST_FILE_NAME, LIMITS.manifestBytes]]), path).get(MANIFEST_FILE_NAME);
  if (!manifestBytes) throw new ValidationError(`Not a face project file (it has no ${MANIFEST_FILE_NAME}): ${path}`);
  const manifestText = decodeText(MANIFEST_FILE_NAME, manifestBytes);
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch {
    throw new ValidationError(`${MANIFEST_FILE_NAME} is not valid JSON`);
  }
  const manifest = parseManifestFile(manifestJson);
  // A UTF-8 file can need up to three bytes per UTF-16 code unit.
  const sources = extractEntries(archive, new Map(manifest.circuits.map((name) => [name, LIMITS.circuitSourceLength * 3])), path);
  const files = manifest.circuits.map((name) => {
    const bytes = sources.get(name);
    if (!bytes) throw new ValidationError(`The project file lists ${name} but does not contain it: ${path}`);
    const source = decodeText(name, bytes);
    if (source.length > LIMITS.circuitSourceLength) throw new ValidationError(`${name} is too large: ${path}`);
    return { name, source };
  });
  return { path, data: { manifest, files } };
}

/** The project as a zip archive: face.json and the circuit files at the root. Refuses what `readProject` would not read back. */
function packProject(data: ProjectData): Uint8Array {
  const entries: Record<string, Uint8Array> = { [MANIFEST_FILE_NAME]: strToU8(JSON.stringify(manifestFileContent(data.manifest), null, 2) + "\n") };
  for (const file of data.files) entries[parseCircuitFileName(file.name)] = strToU8(file.source);
  const contentBytes = Object.values(entries).reduce((sum, bytes) => sum + bytes.length, 0);
  if (contentBytes > LIMITS.projectContentBytes) throw new ValidationError(`The project is too large to save (limit ${megabytes(LIMITS.projectContentBytes)})`);
  const archive = zipSync(entries);
  if (archive.length > LIMITS.projectFileBytes) throw new ValidationError(`The project file would be too large (limit ${megabytes(LIMITS.projectFileBytes)})`);
  return archive;
}

/** Replaces the project file as a whole: readers see the previous project or the new one, never a mixture. */
export async function writeProject(path: string, data: ProjectData): Promise<void> {
  const archive = packProject(data);
  const target = await stat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (target?.isDirectory()) throw new ValidationError(`Cannot save the project over a folder: ${path}`);
  try {
    await writeFileAtomic(path, archive);
  } catch (error) {
    throw isMissing(error) ? new ValidationError(`The folder for the project file does not exist: ${dirname(path)}`) : error;
  }
}
