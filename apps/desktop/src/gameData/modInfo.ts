// What the mods say of themselves: the `info.json` of every mod the game had loaded, read from the user's mod directory. One
// file per mod, from its folder or out of its archive (zipEntry.ts), with a size limit. The content is a mod author's: it
// comes back as parsed JSON and nothing more, for the single-set build to take a title and the dependencies from.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { readRegularFile } from "../regularFile.ts";
import { USER_MOD_LIMITS, type ModFile } from "./userMods.ts";
import { readZipEntry } from "./zipEntry.ts";

export const INFO_FILE = "info.json";
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
/** In an archive the mod is one folder of any name. */
export const isInfoEntry = (name: string): boolean => /^[^/\\]+\/info\.json$/.test(name);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether two version texts name the same version: the game writes 1.2.3 for a file named 1.02.3. */
export function sameVersion(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !VERSION.test(a) || !VERSION.test(b)) return false;
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  return x.every((part, index) => part === y[index]);
}

/** The content of an `info.json` as JSON. Throws for bytes that are no UTF-8 or no JSON. */
export const parseModInfo = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

/** The bytes of the `info.json` of a mod, undefined for an archive without one. Rejects for whatever cannot be read. */
async function infoBytes(file: string, kind: ModFile["kind"]): Promise<Uint8Array | undefined> {
  if (kind === "directory") return readRegularFile(path.join(file, INFO_FILE), USER_MOD_LIMITS.infoBytes);
  // Neither flag exists on Windows. Without blocking, so that a pipe under a mod's name cannot hold the app.
  const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`Not a regular file: ${file}`);
    return await readZipEntry(handle, info.size, isInfoEntry, USER_MOD_LIMITS.infoBytes);
  } finally {
    await handle.close();
  }
}

/**
 * The parsed `info.json` of each of `mods` (what the game says it loaded) by mod name, from the file of that name and
 * version among `files` of `directory`. A file whose name does not say what it is (an archive without a version in its
 * name) is asked. A file counts when its own `info.json` names the mod and the version the game loaded, and no other mod
 * than its file name does; a mod without such a file is absent from the result. Never rejects.
 */
export async function readModInfos(directory: string, files: readonly ModFile[], mods: readonly { readonly name: string; readonly version: string }[]): Promise<Map<string, unknown>> {
  const loaded = new Map(mods.map((mod) => [mod.name, mod.version]));
  const infos = new Map<string, unknown>();
  for (const file of files) {
    if (file.name !== undefined && (infos.has(file.name) || !sameVersion(loaded.get(file.name), file.version))) continue;
    try {
      const bytes = await infoBytes(path.join(directory, file.fileName), file.kind);
      const info: unknown = bytes === undefined ? undefined : parseModInfo(bytes);
      if (!isRecord(info) || typeof info.name !== "string" || (file.name !== undefined && info.name !== file.name)) continue;
      if (!infos.has(info.name) && sameVersion(loaded.get(info.name), info.version)) infos.set(info.name, info);
    } catch {
      // Not readable, not an archive, not JSON: the mod stays without its info, and the caller says how many do.
    }
  }
  return infos;
}
