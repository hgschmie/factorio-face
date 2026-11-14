// Blueprint files: a text file that holds a blueprint string (or the JSON of one). The game has no such files, only text boxes, so the
// format is ours: the string as it is, in UTF-8. Callers pass paths that a native dialog returned; what is read is untrusted text.
import { stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { BLUEPRINT_FILE_EXTENSION, LIMITS, type BlueprintFileText } from "./ipc.ts";
import { writeFileAtomic } from "./projectStore.ts";
import { readRegularFile } from "./regularFile.ts";
import { ValidationError } from "./validation.ts";

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * The text of a file: UTF-8 with or without a byte order mark, or UTF-16 with one (what some editors and shells on Windows write).
 * Anything else is not a text file.
 */
export function decodeTextFile(bytes: Uint8Array, path: string): string {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : undefined;
  try {
    // The decoder takes the byte order mark away.
    const text = new TextDecoder(utf16 ?? "utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new TypeError("NUL character");
    return text;
  } catch {
    throw new ValidationError(`Not a text file: ${path}`);
  }
}

/** Reads a file as text, up to `LIMITS.blueprintFileBytes`. Whether the text is a blueprint is for the importer to say. */
export async function readBlueprintFile(path: string): Promise<BlueprintFileText> {
  const info = await stat(path).catch((error: unknown) => {
    throw isMissing(error) ? new ValidationError(`File not found: ${path}`) : error;
  });
  if (!info.isFile()) throw new ValidationError(`Not a file: ${path}`);
  if (info.size > LIMITS.blueprintFileBytes) throw new ValidationError(`The file is too large for a blueprint (limit ${LIMITS.blueprintFileBytes / (1024 * 1024)} MiB): ${path}`);
  // The read measures the file again through its own handle and refuses it there: it may have grown or been replaced since.
  const bytes = await readRegularFile(path, LIMITS.blueprintFileBytes);
  return { name: basename(path), text: decodeTextFile(bytes, path) };
}

/** Writes a blueprint string as the whole content of a file, atomically like a project file: no line break, so the file is the string. */
export async function writeBlueprintFile(path: string, text: string): Promise<void> {
  const target = await stat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (target?.isDirectory()) throw new ValidationError(`Cannot write the blueprint over a folder: ${path}`);
  try {
    await writeFileAtomic(path, text);
  } catch (error) {
    throw isMissing(error) ? new ValidationError(`The folder for the blueprint file does not exist: ${dirname(path)}`) : error;
  }
}

/** The file name the save dialog suggests for the blueprint of a project: its name in characters every file system takes. Never a path. */
export function suggestedBlueprintFileName(projectName: string): string {
  const cleaned = projectName.replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").replace(/^[. ]+/, "").trim();
  return (cleaned.length > 0 ? cleaned : "blueprint") + BLUEPRINT_FILE_EXTENSION;
}

/** A name without any extension gets the one of blueprint files; a name with one is the user's choice. */
export function withBlueprintExtension(path: string): string {
  return extname(path) === "" ? path + BLUEPRINT_FILE_EXTENSION : path;
}
