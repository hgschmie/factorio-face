// Reads one entry of a zip archive through a file handle: the end record, the central directory, then that entry alone. The
// archive itself is never loaded (a mod can have hundreds of megabytes). It is a file the app does not control: every count,
// size and offset is checked against the file and against limits before anything is allocated or read, and whatever is not
// a plain archive (encrypted, in several parts, compressed by anything but deflate) is refused.
import type { FileHandle } from "node:fs/promises";
import { crc32, inflateRawSync } from "node:zlib";

/** A mod with every sprite in a file of its own has some ten thousand entries; a central directory entry is 46 bytes and the name. */
export const ZIP_LIMITS = { entries: 200_000, nameLength: 1024, directoryBytes: 32 * 1024 * 1024 } as const;

const END_RECORD = 0x06054b50, END_RECORD_BYTES = 22, MAX_COMMENT_BYTES = 0xffff;
const ZIP64_LOCATOR = 0x07064b50, ZIP64_LOCATOR_BYTES = 20;
const ZIP64_END_RECORD = 0x06064b50, ZIP64_END_RECORD_BYTES = 56;
const CENTRAL_ENTRY = 0x02014b50, CENTRAL_ENTRY_BYTES = 46;
const LOCAL_ENTRY = 0x04034b50, LOCAL_ENTRY_BYTES = 30;
const ZIP64_EXTRA = 0x0001;
const STORED = 0, DEFLATED = 8;
const ENCRYPTED = 1;
/** What a 16 or 32 bit field holds when the real value is in the zip64 structures. */
const NONE16 = 0xffff, NONE32 = 0xffffffff;

function fail(message: string): never {
  throw new Error(`Not a readable zip archive: ${message}`);
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(bytes, filled, length - filled, position + filled);
    if (bytesRead === 0) fail("the file ends early");
    filled += bytesRead;
  }
  return bytes;
}

function uint64(bytes: Buffer, at: number): number {
  const value = bytes.readBigUInt64LE(at);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : fail("a size is out of range");
}

interface Directory {
  readonly entries: number;
  readonly offset: number;
  readonly size: number;
}

/** Where the central directory is, by the end record that closes the file, or by the zip64 one before it where that one says so. */
async function locateDirectory(handle: FileHandle, fileSize: number): Promise<Directory> {
  if (fileSize < END_RECORD_BYTES) fail("the file is too small");
  const tailStart = Math.max(0, fileSize - END_RECORD_BYTES - MAX_COMMENT_BYTES);
  const tail = await readAt(handle, tailStart, fileSize - tailStart);
  // The record whose comment ends the file; a signature inside a comment does not.
  let at = tail.length - END_RECORD_BYTES;
  while (at >= 0 && !(tail.readUInt32LE(at) === END_RECORD && at + END_RECORD_BYTES + tail.readUInt16LE(at + 20) === tail.length)) at--;
  if (at < 0) fail("no end record");
  const end = tailStart + at;
  const [disk, directoryDisk, here, total] = [tail.readUInt16LE(at + 4), tail.readUInt16LE(at + 6), tail.readUInt16LE(at + 8), tail.readUInt16LE(at + 10)];
  const [size, offset] = [tail.readUInt32LE(at + 12), tail.readUInt32LE(at + 16)];
  let directory: Directory = { entries: total, offset, size };
  let before = end;
  // A field at its highest value says that the zip64 end record has the real one, unless there is none and the value is meant.
  const zip64 = [disk, directoryDisk, here, total].includes(NONE16) || size === NONE32 || offset === NONE32;
  const locator = zip64 && end >= ZIP64_LOCATOR_BYTES + ZIP64_END_RECORD_BYTES ? await readAt(handle, end - ZIP64_LOCATOR_BYTES, ZIP64_LOCATOR_BYTES) : undefined;
  if (locator?.readUInt32LE(0) === ZIP64_LOCATOR) {
    if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) > 1) fail("an archive in several parts");
    before = uint64(locator, 8);
    if (before > end - ZIP64_LOCATOR_BYTES - ZIP64_END_RECORD_BYTES) fail("the zip64 end record is outside the file");
    const record = await readAt(handle, before, ZIP64_END_RECORD_BYTES);
    if (record.readUInt32LE(0) !== ZIP64_END_RECORD) fail("a malformed zip64 end record");
    if (record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0 || uint64(record, 24) !== uint64(record, 32)) fail("an archive in several parts");
    directory = { entries: uint64(record, 32), size: uint64(record, 40), offset: uint64(record, 48) };
  } else if (disk !== 0 || directoryDisk !== 0 || here !== total) fail("an archive in several parts");
  if (directory.entries > ZIP_LIMITS.entries) fail(`more than ${ZIP_LIMITS.entries} entries`);
  if (directory.size > ZIP_LIMITS.directoryBytes) fail(`a central directory of more than ${ZIP_LIMITS.directoryBytes} bytes`);
  if (directory.size < directory.entries * CENTRAL_ENTRY_BYTES || directory.offset + directory.size > before) fail("the central directory is outside the file");
  return directory;
}

interface Entry {
  readonly name: Buffer;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  /** Of the entry's local header. */
  readonly offset: number;
}

/** The sizes and the offset of an entry whose 32 bit fields say that the zip64 extra field has them: in that order, each only when its field says so. */
function zip64Fields(extra: Buffer, fields: { size: number; compressedSize: number; offset: number }): void {
  let at = 0;
  while (at + 4 <= extra.length && extra.readUInt16LE(at) !== ZIP64_EXTRA) at += 4 + extra.readUInt16LE(at + 2);
  if (at + 4 > extra.length) fail("an entry without its zip64 sizes");
  const end = at + 4 + extra.readUInt16LE(at + 2);
  at += 4;
  for (const field of ["size", "compressedSize", "offset"] as const) {
    if (fields[field] !== NONE32) continue;
    if (at + 8 > end || end > extra.length) fail("an entry without its zip64 sizes");
    fields[field] = uint64(extra, at);
    at += 8;
  }
}

/** The first entry of the central directory whose name `wanted` accepts. Names are read as UTF-8; what is not, never equals a name asked for. */
function findEntry(directory: Buffer, count: number, wanted: (name: string) => boolean): Entry | undefined {
  const decoder = new TextDecoder();
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + CENTRAL_ENTRY_BYTES > directory.length || directory.readUInt32LE(at) !== CENTRAL_ENTRY) fail("a malformed central directory");
    const [nameLength, extraLength, commentLength] = [directory.readUInt16LE(at + 28), directory.readUInt16LE(at + 30), directory.readUInt16LE(at + 32)];
    const next = at + CENTRAL_ENTRY_BYTES + nameLength + extraLength + commentLength;
    if (nameLength > ZIP_LIMITS.nameLength) fail(`a name of more than ${ZIP_LIMITS.nameLength} bytes`);
    if (next > directory.length) fail("a malformed central directory");
    const name = directory.subarray(at + CENTRAL_ENTRY_BYTES, at + CENTRAL_ENTRY_BYTES + nameLength);
    if (wanted(decoder.decode(name))) {
      if (directory.readUInt16LE(at + 8) & ENCRYPTED) fail("an encrypted entry");
      const fields = { size: directory.readUInt32LE(at + 24), compressedSize: directory.readUInt32LE(at + 20), offset: directory.readUInt32LE(at + 42) };
      if (Object.values(fields).includes(NONE32)) zip64Fields(directory.subarray(next - commentLength - extraLength, next - commentLength), fields);
      return { name, method: directory.readUInt16LE(at + 10), crc: directory.readUInt32LE(at + 16), ...fields };
    }
    at = next;
  }
  return undefined;
}

/**
 * The content of the first entry of the archive behind `handle` (a file of `fileSize` bytes) whose name `wanted` accepts;
 * undefined when the archive has none. Throws for a file that is no plain zip archive, and for an entry that is larger than
 * `maxBytes` (compressed or not), not stored or deflated, or not what its checksum says.
 */
export async function readZipEntry(handle: FileHandle, fileSize: number, wanted: (name: string) => boolean, maxBytes: number): Promise<Uint8Array | undefined> {
  const directory = await locateDirectory(handle, fileSize);
  const entry = findEntry(await readAt(handle, directory.offset, directory.size), directory.entries, wanted);
  if (entry === undefined) return undefined;
  if (entry.method !== STORED && entry.method !== DEFLATED) fail(`an entry compressed by method ${entry.method}`);
  if (entry.size > maxBytes || entry.compressedSize > maxBytes) fail(`an entry of more than ${maxBytes} bytes`);
  if (entry.method === STORED && entry.compressedSize !== entry.size) fail("a stored entry with two sizes");
  // The local header repeats the name; its own extra field may differ from the central one.
  const headerBytes = LOCAL_ENTRY_BYTES + entry.name.length;
  if (entry.offset + headerBytes > directory.offset) fail("an entry outside the file");
  const header = await readAt(handle, entry.offset, headerBytes);
  const sameName = header.readUInt16LE(26) === entry.name.length && header.subarray(LOCAL_ENTRY_BYTES).equals(entry.name);
  if (header.readUInt32LE(0) !== LOCAL_ENTRY || !sameName) fail("an entry that is not where the central directory says");
  const start = entry.offset + headerBytes + header.readUInt16LE(28);
  if (start + entry.compressedSize > directory.offset) fail("an entry outside the file");
  const stored = await readAt(handle, start, entry.compressedSize);
  let content: Buffer;
  try {
    content = entry.method === STORED ? stored : inflateRawSync(stored, { maxOutputLength: maxBytes });
  } catch {
    return fail("an entry that cannot be decompressed, or that is larger than it says");
  }
  if (content.length !== entry.size || crc32(content) !== entry.crc) fail("an entry that is not what its sizes and checksum say");
  return content;
}
