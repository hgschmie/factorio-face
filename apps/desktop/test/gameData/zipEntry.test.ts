// The reader of one zip entry on archives made by hand: what a packer writes (stored, deflated, zip64, with a comment), and
// what nobody should: sizes, counts and offsets that lie, parts that are missing, forms the reader does not take.
import { strToU8, zipSync } from "fflate";
import { randomBytes } from "node:crypto";
import { mkdir, open, utimes, writeFile, type FileHandle } from "node:fs/promises";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ZIP_LIMITS, ZipArchives, readIndexedEntry, readZipEntry, readZipIndex } from "../../src/gameData/zipEntry.ts";
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

const isPng = (name: string): boolean => name.endsWith(".png");
const ICONS: readonly EntrySpec[] = [
  { name: "mod/info.json", content: INFO },
  { name: "mod/graphics/a.png", content: "image a" },
  { name: "mod/control.lua", content: "-- code" },
  { name: "mod/graphics/b.png", content: "image b", stored: true },
  { name: "mod/graphics/a.png", content: "a second file of that name" },
];
const string = (bytes: Uint8Array | undefined): string | undefined => bytes && Buffer.from(bytes).toString("utf8");

describe("readZipIndex", () => {
  it("lists the entries that are asked for, in the directory's order, the first of two with one name", async () => {
    await withHandle(archive(ICONS), async (handle, size) => {
      const all = await readZipIndex(handle, size);
      expect([...all.entries.keys()]).toEqual(["mod/info.json", "mod/graphics/a.png", "mod/control.lua", "mod/graphics/b.png"]);
      const images = await readZipIndex(handle, size, isPng);
      expect([...images.entries.keys()]).toEqual(["mod/graphics/a.png", "mod/graphics/b.png"]);
      expect(images.bytes).toBeGreaterThan(0);
      expect(images.bytes).toBeLessThan(all.bytes);
      expect(string(await readIndexedEntry(handle, images, "mod/graphics/a.png", MAX))).toBe("image a");
      expect(string(await readIndexedEntry(handle, images, "mod/graphics/b.png", MAX))).toBe("image b");
      expect(await readIndexedEntry(handle, images, "mod/info.json", MAX)).toBeUndefined();
      expect(await readIndexedEntry(handle, images, "mod/graphics/c.png", MAX)).toBeUndefined();
    });
  });

  it("reads the directory once: a further entry costs its own bytes", async () => {
    const entries = [...Array.from({ length: 2000 }, (_, index) => ({ name: `mod/graphics/icon-${index}.png`, content: `image ${index}` })), { name: "mod/graphics/sheet.png", content: new Uint8Array(4 * 1024 * 1024).fill(3), stored: true }];
    await withHandle(archive(entries), async (handle, size) => {
      let total = 0;
      const counting = { read: async (buffer: Buffer, offset: number, length: number, position: number) => {
        total += length;
        return handle.read(buffer, offset, length, position);
      } } as unknown as FileHandle;
      const index = await readZipIndex(counting, size, isPng);
      expect(index.entries.size).toBe(2001);
      const forIndex = total;
      for (const number of [0, 999, 1999]) expect(string(await readIndexedEntry(counting, index, `mod/graphics/icon-${number}.png`, MAX))).toBe(`image ${number}`);
      expect(total - forIndex).toBeLessThan(3 * 200);
      // The size limit is the reader's, for each entry.
      await expect(readIndexedEntry(counting, index, "mod/graphics/sheet.png", MAX)).rejects.toThrow(/an entry of more than 65536 bytes/);
    });
  });

  it("refuses what is no plain archive, as the reader of one entry does", async () => {
    const index = (bytes: Uint8Array): Promise<unknown> => withHandle(bytes, (handle, size) => readZipIndex(handle, size, isPng));
    await expect(index(strToU8("a mod"))).rejects.toThrow(/too small/);
    await expect(index(new Uint8Array(5000))).rejects.toThrow(/no end record/);
    await expect(index(archive(ICONS, { end: { disk: 1 } }))).rejects.toThrow(/several parts/);
    await expect(index(archive(ICONS, { end: { size: 10_000_000 } }))).rejects.toThrow(/central directory is outside the file/);
    await expect(index(archive(ICONS, { zip64: true, end: { entries: ZIP_LIMITS.entries + 1, entriesHere: ZIP_LIMITS.entries + 1 } }))).rejects.toThrow(/more than 200000 entries/);
    await expect(index(archive(ICONS, { end: { entries: 9, entriesHere: 9 } }))).rejects.toThrow(/malformed central directory|outside the file/);
    // The whole directory is walked: a name that is too long fails the index wherever it is, and an entry that is kept must have its sizes.
    await expect(index(archive([...ICONS, { name: `mod/${"n".repeat(ZIP_LIMITS.nameLength)}`, content: "" }]))).rejects.toThrow(/a name of more than 1024 bytes/);
    await expect(index(archive([{ name: "mod/a.png", content: "x", central: { size: NONE32 } }]))).rejects.toThrow(/an entry without its zip64 sizes/);
  });

  it("indexes an archive with entries it does not read, and refuses those when they are asked for", async () => {
    const odd = archive([
      { name: "mod/fine.png", content: "fine" },
      { name: "mod/encrypted.png", content: "x", central: { flags: 1 } },
      { name: "mod/lzma.png", content: "x", central: { method: 14 } },
      { name: "mod/elsewhere.png", content: "x", central: { offset: 4_000_000 } },
      { name: "mod/lying.png", content: "x", central: { crc: 1 } },
      { name: "mod/moved.png", content: "x", localName: "mod/other.png" },
      { name: "mod/unsized.lua", content: "x", central: { size: NONE32 } },
    ]);
    await withHandle(odd, async (handle, size) => {
      const index = await readZipIndex(handle, size, isPng);
      expect(index.entries.size).toBe(6);
      expect(string(await readIndexedEntry(handle, index, "mod/fine.png", MAX))).toBe("fine");
      await expect(readIndexedEntry(handle, index, "mod/encrypted.png", MAX)).rejects.toThrow(/an encrypted entry/);
      await expect(readIndexedEntry(handle, index, "mod/lzma.png", MAX)).rejects.toThrow(/compressed by method 14/);
      await expect(readIndexedEntry(handle, index, "mod/elsewhere.png", MAX)).rejects.toThrow(/an entry outside the file/);
      await expect(readIndexedEntry(handle, index, "mod/lying.png", MAX)).rejects.toThrow(/not what its sizes and checksum say/);
      await expect(readIndexedEntry(handle, index, "mod/moved.png", MAX)).rejects.toThrow(/not where the central directory says/);
    });
  });

  it("does not stall on a directory of many entries, and holds what it says it holds", async () => {
    const many = archive(Array.from({ length: 20_000 }, (_, index) => ({ name: `mod/graphics/icons/sprite-${index}.png`, content: "", stored: true })));
    const started = performance.now();
    const index = await withHandle(many, (handle, size) => readZipIndex(handle, size, isPng));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(index.entries.size).toBe(20_000);
    // Some 240 bytes for an entry with a name of 35 characters.
    expect(index.bytes).toBeGreaterThan(20_000 * 200);
    expect(index.bytes).toBeLessThan(20_000 * 300);
  });
});

describe("ZipArchives", () => {
  let count = 0;
  const place = async (bytes: Uint8Array): Promise<string> => {
    const file = scratch(`kept-${++count}.zip`);
    await writeFile(file, bytes);
    return file;
  };

  it("reads entries by the archive's path, finds one by a rule, and says nothing for one that is not there or not kept", async () => {
    const archives = new ZipArchives((name) => isPng(name) || isInfo(name));
    const file = await place(archive(ICONS));
    expect(await archives.find(file, isInfo)).toBe("mod/info.json");
    expect(string(await archives.read(file, "mod/info.json", MAX))).toBe(INFO);
    expect(string(await archives.read(file, "mod/graphics/b.png", MAX))).toBe("image b");
    expect(await archives.read(file, "mod/control.lua", MAX)).toBeUndefined();
    expect(await archives.read(file, "mod/graphics/../info.json", MAX)).toBeUndefined();
    expect(await archives.find(file, (name) => name.endsWith(".lua"))).toBeUndefined();
    expect(archives.held.archives).toBe(1);
    expect(archives.held.bytes).toBeGreaterThan(0);
    await expect(archives.read(file, "mod/graphics/a.png", 3)).rejects.toThrow(/an entry of more than 3 bytes/);
  });

  it("reads the directory of an archive once and uses it for every further entry", async () => {
    const archives = new ZipArchives();
    const bytes = archive(ICONS);
    const file = await place(bytes);
    // A time of whole seconds, which can be set again exactly.
    const written = new Date("2026-11-01T12:00:00Z");
    await utimes(file, written, written);
    expect(string(await archives.read(file, "mod/graphics/a.png", MAX))).toBe("image a");
    // The directory is wiped where it stands, with the size, the time and the file as they were: only the index still knows the entries.
    const directoryOffset = bytes.readUInt32LE(bytes.length - 6), directorySize = bytes.readUInt32LE(bytes.length - 10);
    const handle = await open(file, "r+");
    await handle.write(Buffer.alloc(directorySize), 0, directorySize, directoryOffset);
    await handle.close();
    await utimes(file, written, written);
    expect(string(await archives.read(file, "mod/graphics/b.png", MAX))).toBe("image b");
    expect(string(await archives.read(file, "mod/control.lua", MAX))).toBe("-- code");
    await expect(new ZipArchives().read(file, "mod/graphics/b.png", MAX)).rejects.toThrow(/malformed central directory/);
  });

  it("indexes an archive again when another file is under its name", async () => {
    const archives = new ZipArchives();
    const file = await place(archive([{ name: "mod/a.png", content: "the first" }]));
    expect(string(await archives.read(file, "mod/a.png", MAX))).toBe("the first");
    await writeFile(file, archive([{ name: "mod/a.png", content: "the second, which is longer" }, { name: "mod/b.png", content: "new" }]));
    expect(string(await archives.read(file, "mod/a.png", MAX))).toBe("the second, which is longer");
    expect(string(await archives.read(file, "mod/b.png", MAX))).toBe("new");
    expect(archives.held.archives).toBe(1);
  });

  it("shares one index among reads that come at once", async () => {
    const archives = new ZipArchives();
    const entries = Array.from({ length: 200 }, (_, index) => ({ name: `mod/icon-${index}.png`, content: `image ${index}` }));
    const file = await place(archive(entries));
    const contents = await Promise.all(entries.map((entry) => archives.read(file, entry.name, MAX)));
    expect(contents.map(string)).toEqual(entries.map((entry) => entry.content));
    expect(archives.held.archives).toBe(1);
  });

  it("keeps no more archives than its limit, the least recently used going first", async () => {
    const archives = new ZipArchives(() => true, { archives: 2, bytes: 1024 * 1024 });
    const [a, b, c] = await Promise.all(["a", "b", "c"].map((name) => place(archive([{ name: `${name}.png`, content: name }]))));
    await archives.read(a!, "a.png", MAX);
    await archives.read(b!, "b.png", MAX);
    await archives.read(a!, "a.png", MAX);
    await archives.read(c!, "c.png", MAX);
    expect(archives.held.archives).toBe(2);
    // What was dropped is read again when it is asked for.
    expect(string(await archives.read(b!, "b.png", MAX))).toBe("b");
    expect(archives.held.archives).toBe(2);
    archives.clear();
    expect(archives.held).toEqual({ archives: 0, bytes: 0 });
    expect(string(await archives.read(a!, "a.png", MAX))).toBe("a");
  });

  it("keeps no more bytes than its limit, and still reads an archive whose index alone is above it", async () => {
    const small = archive([{ name: "mod/a.png", content: "a" }]);
    const large = archive(Array.from({ length: 500 }, (_, index) => ({ name: `mod/graphics/icons/sprite-${index}.png`, content: `${index}` })));
    const archives = new ZipArchives(() => true, { archives: 100, bytes: 20_000 });
    const [first, second, big] = [await place(small), await place(small), await place(large)];
    await archives.read(first, "mod/a.png", MAX);
    await archives.read(second, "mod/a.png", MAX);
    expect(archives.held.archives).toBe(2);
    expect(string(await archives.read(big, "mod/graphics/icons/sprite-499.png", MAX))).toBe("499");
    expect(archives.held).toEqual({ archives: 0, bytes: 0 });
    expect(string(await archives.read(big, "mod/graphics/icons/sprite-7.png", MAX))).toBe("7");
    expect(string(await archives.read(first, "mod/a.png", MAX))).toBe("a");
    expect(archives.held.bytes).toBeLessThanOrEqual(20_000);
  });

  it("refuses a file that is no archive every time, until an archive is there", async () => {
    const archives = new ZipArchives();
    const file = await place(strToU8("this is not an archive, whatever its name says"));
    await expect(archives.read(file, "mod/a.png", MAX)).rejects.toThrow(/^Not a readable zip archive: no end record/);
    await expect(archives.find(file, isInfo)).rejects.toThrow(/no end record/);
    expect(archives.held).toEqual({ archives: 1, bytes: 0 });
    await writeFile(file, archive([{ name: "mod/a.png", content: "now it is one" }]));
    expect(string(await archives.read(file, "mod/a.png", MAX))).toBe("now it is one");
  });

  it("refuses what is no regular file, and a file that is not there", async () => {
    const archives = new ZipArchives();
    const folder = scratch("a-folder.zip");
    await mkdir(folder);
    await expect(archives.read(folder, "mod/a.png", MAX)).rejects.toThrow();
    await expect(archives.read(scratch("missing.zip"), "mod/a.png", MAX)).rejects.toThrow(/ENOENT/);
    expect(archives.held.archives).toBe(0);
  });
});
