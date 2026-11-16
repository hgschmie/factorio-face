// The reader of one zip entry on archives made by hand: what a packer writes (stored, deflated, zip64, with a comment), and
// what nobody should: sizes, counts and offsets that lie, parts that are missing, forms the reader does not take.
import { strToU8, zipSync } from "fflate";
import { randomBytes } from "node:crypto";
import { open, writeFile, type FileHandle } from "node:fs/promises";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ZIP_LIMITS, readZipEntry } from "../../src/gameData/zipEntry.ts";
import { useScratch } from "../support/scratch.ts";

const scratch = useScratch("zip-entry");
const MAX = 64 * 1024;
const NONE32 = 0xffffffff;

interface CentralFields {
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
  readonly disk: number;
  readonly name: string;
}

interface EntrySpec {
  readonly name: string;
  readonly content: string | Uint8Array;
  readonly stored?: boolean;
  /** Sizes and offset in a zip64 extra field of the central entry. */
  readonly zip64?: boolean;
  /** What the central directory says against the truth. */
  readonly central?: Partial<CentralFields>;
  /** The name in the local header against the truth. */
  readonly localName?: string;
  readonly localExtra?: number;
}

interface ArchiveSpec {
  readonly comment?: Uint8Array;
  /** A zip64 end record and its locator, and an end record that points at them. */
  readonly zip64?: boolean;
  /** What the end record (the zip64 one with `zip64`) says against the truth. */
  readonly end?: Partial<{ entries: number; entriesHere: number; size: number; offset: number; disk: number }>;
  readonly locator?: Partial<{ offset: number; disks: number }>;
}

function archive(entries: readonly EntrySpec[], { comment = new Uint8Array(), zip64 = false, end = {}, locator = {} }: ArchiveSpec = {}): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let position = 0;
  for (const entry of entries) {
    const content = Buffer.from(typeof entry.content === "string" ? strToU8(entry.content) : entry.content);
    const data = entry.stored ? content : deflateRawSync(content);
    const localName = Buffer.from(entry.localName ?? entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.stored ? 0 : 8, 8);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(entry.localExtra ?? 0, 28);
    locals.push(local, localName, Buffer.alloc(entry.localExtra ?? 0), data);

    const fields: CentralFields = { flags: 0, method: entry.stored ? 0 : 8, crc: crc32(content), compressedSize: data.length, size: content.length, offset: position, disk: 0, name: entry.name, ...entry.central };
    const extra = Buffer.alloc(entry.zip64 ? 28 : 0);
    if (entry.zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      [fields.size, fields.compressedSize, fields.offset].forEach((value, index) => extra.writeBigUInt64LE(BigInt(value), 4 + index * 8));
    }
    const centralName = Buffer.from(fields.name);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(fields.flags, 8);
    central.writeUInt16LE(fields.method, 10);
    central.writeUInt32LE(fields.crc, 16);
    central.writeUInt32LE(entry.zip64 ? NONE32 : fields.compressedSize, 20);
    central.writeUInt32LE(entry.zip64 ? NONE32 : fields.size, 24);
    central.writeUInt16LE(centralName.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(fields.disk, 34);
    central.writeUInt32LE(entry.zip64 ? NONE32 : fields.offset, 42);
    centrals.push(central, centralName, extra);
    position += 30 + localName.length + (entry.localExtra ?? 0) + data.length;
  }
  const directory = Buffer.concat(centrals);
  const said = { entries: entries.length, entriesHere: end.entries ?? entries.length, size: directory.length, offset: position, disk: 0, ...end };
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt32LE(said.disk, 16);
    record.writeBigUInt64LE(BigInt(said.entriesHere), 24);
    record.writeBigUInt64LE(BigInt(said.entries), 32);
    record.writeBigUInt64LE(BigInt(said.size), 40);
    record.writeBigUInt64LE(BigInt(said.offset), 48);
    const pointer = Buffer.alloc(20);
    pointer.writeUInt32LE(0x07064b50, 0);
    pointer.writeBigUInt64LE(BigInt(locator.offset ?? position + directory.length), 8);
    pointer.writeUInt32LE(locator.disks ?? 1, 16);
    tail.push(record, pointer);
  }
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(zip64 ? 0 : said.disk, 4);
  record.writeUInt16LE(zip64 ? 0xffff : said.entriesHere, 8);
  record.writeUInt16LE(zip64 ? 0xffff : said.entries, 10);
  record.writeUInt32LE(zip64 ? NONE32 : said.size, 12);
  record.writeUInt32LE(zip64 ? NONE32 : said.offset, 16);
  record.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, directory, ...tail, record, comment]);
}

let files = 0;
async function withHandle<T>(bytes: Uint8Array, use: (handle: FileHandle, size: number) => Promise<T>): Promise<T> {
  const file = scratch(`archive-${++files}.zip`);
  await writeFile(file, bytes);
  const handle = await open(file, "r");
  try {
    return await use(handle, bytes.length);
  } finally {
    await handle.close();
  }
}

const isInfo = (name: string): boolean => /^[^/]+\/info\.json$/.test(name);
const read = (bytes: Uint8Array, wanted: (name: string) => boolean = isInfo, maxBytes = MAX): Promise<Uint8Array | undefined> => withHandle(bytes, (handle, size) => readZipEntry(handle, size, wanted, maxBytes));
const text = async (bytes: Uint8Array, wanted?: (name: string) => boolean): Promise<string | undefined> => {
  const content = await read(bytes, wanted);
  return content && Buffer.from(content).toString("utf8");
};

const INFO = JSON.stringify({ name: "some-mod", version: "1.2.3", title: "Some Mod", dependencies: ["base"] });
const ENTRIES: readonly EntrySpec[] = [
  { name: "some-mod/", content: "", stored: true },
  { name: "some-mod/graphics/big.png", content: new Uint8Array(200_000).fill(7) },
  { name: "some-mod/locale/en/info.json", content: "not this one" },
  { name: "some-mod/info.json", content: INFO },
  { name: "other/info.json", content: "nor this one" },
];
const refused = (bytes: Uint8Array, reason: RegExp, maxBytes = MAX): Promise<void> => expect(read(bytes, isInfo, maxBytes)).rejects.toThrow(new RegExp(`^Not a readable zip archive: .*${reason.source}`));

describe("readZipEntry", () => {
  it("reads the first entry that is asked for, deflated or stored, and nothing when there is none", async () => {
    expect(await text(archive(ENTRIES))).toBe(INFO);
    expect(await text(archive(ENTRIES.map((entry) => ({ ...entry, stored: true }))))).toBe(INFO);
    expect(await text(archive(ENTRIES), (name) => name.endsWith("/en/info.json"))).toBe("not this one");
    expect(await text(archive([{ name: "empty/info.json", content: "" }]))).toBe("");
    expect(await read(archive(ENTRIES), () => false)).toBeUndefined();
    expect(await read(archive([]))).toBeUndefined();
  });

  it("reads what a packer writes", async () => {
    const packed = zipSync({ "some-mod_1.2.3/control.lua": strToU8("-- code"), "some-mod_1.2.3/info.json": strToU8(INFO), "some-mod_1.2.3/data.lua": [strToU8("-- data"), { level: 0 }] });
    expect(await text(packed)).toBe(INFO);
    expect(await text(packed, (name) => name.endsWith("data.lua"))).toBe("-- data");
  });

  it("takes names as UTF-8 and an extra field in the local header that the central one does not have", async () => {
    expect(await text(archive([{ name: "Мод é/info.json", content: INFO, localExtra: 36 }]), (name) => name === "Мод é/info.json")).toBe(INFO);
  });

  it("finds the end record before a comment, also one that looks like an end record", async () => {
    const fake = Buffer.alloc(40);
    fake.writeUInt32LE(0x06054b50, 4);
    expect(await text(archive(ENTRIES, { comment: strToU8("made by hand") }))).toBe(INFO);
    expect(await text(archive(ENTRIES, { comment: fake }))).toBe(INFO);
    expect(await text(archive(ENTRIES, { comment: new Uint8Array(0xffff).fill(0x41) }))).toBe(INFO);
    // Bytes after the comment are not part of an archive.
    await refused(Buffer.concat([archive(ENTRIES), Buffer.from("trailing")]), /no end record/);
  });

  it("reads the directory and the one entry, not the archive", async () => {
    const large = archive([{ name: "mod/graphics/sheet.png", content: new Uint8Array(8 * 1024 * 1024).map((_, index) => (index * 31) & 0xff), stored: true }, { name: "mod/info.json", content: INFO }]);
    expect(large.length).toBeGreaterThan(8 * 1024 * 1024);
    const bytesRead = await withHandle(large, async (handle, size) => {
      let total = 0;
      const counting = { read: async (buffer: Buffer, offset: number, length: number, position: number) => {
        total += length;
        return handle.read(buffer, offset, length, position);
      } } as unknown as FileHandle;
      expect(Buffer.from((await readZipEntry(counting, size, isInfo, MAX))!).toString()).toBe(INFO);
      return total;
    });
    // The end of the file, where a comment may be, the directory and the entry.
    expect(bytesRead).toBeLessThan(128 * 1024);
  });

  it("reads a zip64 archive: the end record's values from the zip64 one, an entry's from its extra field", async () => {
    expect(await text(archive(ENTRIES, { zip64: true }))).toBe(INFO);
    expect(await text(archive(ENTRIES.map((entry) => ({ ...entry, zip64: true })), { zip64: true, comment: strToU8("zip64") }))).toBe(INFO);
    expect(await text(archive(ENTRIES.map((entry) => ({ ...entry, zip64: true }))))).toBe(INFO);
    // A locator that says nothing of the number of parts, as some packers write it.
    expect(await text(archive(ENTRIES, { zip64: true, locator: { disks: 0 } }))).toBe(INFO);
  });

  it("refuses what is no zip archive", async () => {
    await refused(strToU8("a mod"), /too small/);
    await refused(new Uint8Array(), /too small/);
    await refused(new Uint8Array(5000), /no end record/);
    await refused(strToU8("PK\u0003\u0004" + "x".repeat(100)), /no end record/);
    const whole = archive(ENTRIES);
    await refused(whole.subarray(0, whole.length - 1), /no end record/);
    await refused(whole.subarray(0, 100), /no end record/);
    // The end record alone, as if the rest had been cut off in front of it.
    await refused(whole.subarray(whole.length - 22), /central directory is outside the file/);
  });

  it("refuses an entry that is larger than allowed, whatever its header says", async () => {
    const big = "x".repeat(MAX + 1);
    await refused(archive([{ name: "mod/info.json", content: big }]), /an entry of more than 65536 bytes/);
    await refused(archive([{ name: "mod/info.json", content: big, stored: true }]), /an entry of more than 65536 bytes/);
    expect((await read(archive([{ name: "mod/info.json", content: "x".repeat(MAX) }])))!.length).toBe(MAX);
    // 20 MB of zeros deflate to 20 kB: the size it claims is small, and so is what is read of it.
    const bomb = new Uint8Array(20 * 1024 * 1024);
    await refused(archive([{ name: "mod/info.json", content: bomb, central: { size: 100 } }]), /cannot be decompressed, or that is larger than it says/);
    await refused(archive([{ name: "mod/info.json", content: bomb }]), /an entry of more than/);
    // Compressed data that is larger than allowed although the content would not be.
    await refused(archive([{ name: "mod/info.json", content: randomBytes(2000), central: { size: 10 } }]), /an entry of more than 100 bytes/, 100);
    await refused(archive([{ name: "mod/info.json", content: INFO, zip64: true, central: { size: Number.MAX_SAFE_INTEGER } }]), /an entry of more than/);
  });

  it("refuses an entry that is not what its header says", async () => {
    await refused(archive([{ name: "mod/info.json", content: INFO, central: { crc: 1 } }]), /not what its sizes and checksum say/);
    await refused(archive([{ name: "mod/info.json", content: INFO, central: { size: INFO.length - 1 } }]), /not what its sizes and checksum say/);
    await refused(archive([{ name: "mod/info.json", content: INFO, stored: true, central: { size: INFO.length - 1 } }]), /a stored entry with two sizes/);
    await refused(archive([{ name: "mod/info.json", content: INFO, stored: true, central: { method: 8 } }]), /cannot be decompressed|not what its sizes and checksum say/);
    await refused(archive([{ name: "mod/info.json", content: INFO, localName: "mod/data.lua!" }]), /not where the central directory says/);
    await refused(archive([{ name: "mod/info.json", content: INFO, localName: "mod/info.jso" }]), /not where the central directory says/);
  });

  it("refuses the forms it does not read: other compression, encryption, several parts", async () => {
    for (const method of [1, 9, 12, 14, 93, 99]) await refused(archive([{ name: "mod/info.json", content: INFO, central: { method } }]), new RegExp(`compressed by method ${method}`));
    await refused(archive([{ name: "mod/info.json", content: INFO, central: { flags: 1 } }]), /an encrypted entry/);
    await refused(archive(ENTRIES, { end: { disk: 1 } }), /several parts/);
    await refused(archive(ENTRIES, { end: { entriesHere: 2 } }), /several parts/);
    await refused(archive(ENTRIES, { zip64: true, end: { disk: 1 } }), /several parts/);
    await refused(archive(ENTRIES, { zip64: true, end: { entriesHere: 2 } }), /several parts/);
    await refused(archive(ENTRIES, { zip64: true, locator: { disks: 2 } }), /several parts/);
    // An entry of another part is not looked at unless it is the one asked for; its data is then not in this file.
    await refused(archive([{ name: "mod/info.json", content: INFO, central: { offset: 4_000_000 } }]), /an entry outside the file/);
  });

  it("refuses counts, sizes and offsets that do not fit the file or the limits", async () => {
    await refused(archive(ENTRIES, { zip64: true, end: { entries: ZIP_LIMITS.entries + 1, entriesHere: ZIP_LIMITS.entries + 1 } }), /more than 200000 entries/);
    await refused(archive(ENTRIES, { zip64: true, end: { size: ZIP_LIMITS.directoryBytes + 1 } }), /a central directory of more than/);
    await refused(archive(ENTRIES, { end: { entries: 60_000, entriesHere: 60_000 } }), /central directory is outside the file/);
    await refused(archive(ENTRIES, { end: { size: 10_000_000 } }), /central directory is outside the file/);
    await refused(archive(ENTRIES, { end: { offset: 4_000_000_000 } }), /central directory is outside the file/);
    await refused(archive(ENTRIES, { zip64: true, end: { offset: Number.MAX_SAFE_INTEGER } }), /central directory is outside the file/);
    await refused(archive(ENTRIES, { zip64: true, locator: { offset: 4_000_000_000 } }), /zip64 end record is outside the file/);
    await refused(archive(ENTRIES, { zip64: true, locator: { offset: 0 } }), /malformed zip64 end record/);
    // More entries than the directory has: the walk ends at its last byte.
    await refused(archive([{ name: "mod/data.lua", content: "x" }, { name: "mod/a", content: "" }, { name: "mod/b", content: "" }], { end: { entries: 4, entriesHere: 4 } }), /malformed central directory|outside the file/);
    // A directory that starts in the middle of an entry.
    const shifted = archive(ENTRIES);
    shifted.writeUInt32LE(shifted.readUInt32LE(shifted.length - 6) + 1, shifted.length - 6);
    shifted.writeUInt32LE(shifted.readUInt32LE(shifted.length - 10) - 1, shifted.length - 10);
    await refused(shifted, /malformed central directory/);
    await refused(archive([{ name: `mod/${"n".repeat(ZIP_LIMITS.nameLength)}`, content: "" }, { name: "mod/info.json", content: INFO }]), /a name of more than 1024 bytes/);
    // The data of the entry would run into the central directory.
    await refused(archive([{ name: "mod/info.json", content: INFO, stored: true, central: { size: 5000, compressedSize: 5000 } }]), /an entry outside the file/);
    await refused(archive([{ name: "mod/info.json", content: INFO, central: { offset: 4_000_000_000 } }]), /an entry outside the file/);
    // Values of 64 bits that no file has.
    const huge = archive(ENTRIES, { zip64: true });
    huge.writeBigUInt64LE(2n ** 60n, huge.length - 22 - 20 - 56 + 48);
    await refused(huge, /a size is out of range/);
    // A 32 bit field at its highest value without the zip64 field that should have the real one.
    await refused(archive([{ name: "mod/info.json", content: INFO, central: { size: NONE32 } }]), /an entry without its zip64 sizes/);
  });

  it("does not stall on a directory of many entries", async () => {
    const many = archive([...Array.from({ length: 20_000 }, (_, index) => ({ name: `mod/graphics/icons/sprite-${index}.png`, content: "", stored: true })), { name: "mod/info.json", content: INFO }]);
    const started = performance.now();
    expect(await text(many)).toBe(INFO);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
