// Bounded reads of files in folders the app does not control (the game installation).
import { constants } from "node:fs";
import { open } from "node:fs/promises";

export interface RegularFileOptions {
  /** Refuse a symbolic link as the last path component. For paths that were resolved with `realpath` before. */
  readonly noFollow?: boolean;
}

/**
 * Reads a regular file of at most `maxBytes`. The file is opened first and then measured and read through the same handle,
 * so what was checked is what is read, whatever happens to the path meanwhile. Rejects for anything else, including a
 * directory, a pipe (opened without blocking) and a file that is too large.
 */
export async function readRegularFile(path: string, maxBytes: number, { noFollow = false }: RegularFileOptions = {}): Promise<Uint8Array> {
  // Neither flag exists on Windows.
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (noFollow ? (constants.O_NOFOLLOW ?? 0) : 0);
  const handle = await open(path, flags);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
    if (info.size > maxBytes) throw new Error(`File is larger than ${maxBytes} bytes: ${path}`);
    const bytes = new Uint8Array(info.size);
    let filled = 0;
    while (filled < bytes.length) {
      const { bytesRead } = await handle.read(bytes, filled, bytes.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return bytes.subarray(0, filled);
  } finally {
    await handle.close();
  }
}
