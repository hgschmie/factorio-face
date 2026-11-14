// Blueprint files in the main process: what is read as text and with which limits, what is written and how, and the file names.
import { DEFAULT_LIMITS } from "@face/blueprints";
import { mkdir, readdir, readFile, symlink, truncate, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { decodeTextFile, readBlueprintFile, suggestedBlueprintFileName, withBlueprintExtension, writeBlueprintFile } from "../src/blueprintFiles.ts";
import { BLUEPRINT_FILE_EXTENSION, LIMITS } from "../src/ipc.ts";
import { parseExportBlueprintRequest, ValidationError } from "../src/validation.ts";
import { useScratch } from "./support/scratch.ts";

const scratch = useScratch("blueprint-files");
const STRING = "0eNqVkMEKwjAQRH9l2XMQe1DBq78h";

/** A fresh directory with one file path in it; the file is written when `content` is given. */
async function file(name: string, content?: string | Uint8Array): Promise<string> {
  const directory = scratch(name);
  await mkdir(directory);
  const path = scratch(name, `${name}.txt`);
  if (content !== undefined) await writeFile(path, content);
  return path;
}

const utf16 = (text: string, bigEndian: boolean): Uint8Array => {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, !bigEndian);
  for (let index = 0; index < text.length; index++) view.setUint16(2 + index * 2, text.charCodeAt(index), !bigEndian);
  return bytes;
};

describe("limits", () => {
  it("are those of the importer: a file as long as the text it looks at, a string as long as the one it reads", () => {
    expect(LIMITS.blueprintFileBytes).toBe(2 * DEFAULT_LIMITS.maxStringLength);
    expect(LIMITS.blueprintStringLength).toBe(DEFAULT_LIMITS.maxStringLength);
  });
});

describe("reading a blueprint file", () => {
  it("returns the text as it is, with the name of the file and not its path", async () => {
    const text = `  ${STRING.slice(0, 10)}\r\n${STRING.slice(10)}\n`;
    const path = await file("plain", text);
    expect(await readBlueprintFile(path)).toEqual({ name: "plain.txt", text });
    const json = await file("json", '{ "blueprint": { "label": "Zähler →" } }');
    expect((await readBlueprintFile(json)).text).toBe('{ "blueprint": { "label": "Zähler →" } }');
    expect(await readBlueprintFile(await file("empty", ""))).toEqual({ name: "empty.txt", text: "" });
  });

  it("reads UTF-8 with a byte order mark and UTF-16 with one, without the mark", async () => {
    expect((await readBlueprintFile(await file("bom", new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(STRING)])))).text).toBe(STRING);
    expect((await readBlueprintFile(await file("utf16le", utf16(STRING, false)))).text).toBe(STRING);
    expect((await readBlueprintFile(await file("utf16be", utf16(STRING, true)))).text).toBe(STRING);
  });

  it.each([
    ["bytes that are not UTF-8", new Uint8Array([0x30, 0xff, 0xfe, 0x80])],
    ["a truncated UTF-8 sequence", new Uint8Array([0x30, 0xe2, 0x82])],
    ["a NUL character", new Uint8Array([0x30, 0x00, 0x41])],
    ["UTF-16 with half a character", new Uint8Array([0xff, 0xfe, 0x30, 0x00, 0x41])],
    ["a zip archive", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x9c, 0xa5])],
  ])("refuses %s as not a text file", async (name, bytes) => {
    const path = await file(name.replace(/[^a-z0-9]+/gi, "-"), bytes);
    await expect(readBlueprintFile(path)).rejects.toThrow(new ValidationError(`Not a text file: ${path}`));
    expect(() => decodeTextFile(bytes, path)).toThrow(ValidationError);
  });

  it("reads a file of exactly the limit and refuses a larger one without reading it", async () => {
    const atLimit = await file("at-limit", "");
    await truncate(atLimit, LIMITS.blueprintFileBytes);
    // A sparse file of NUL bytes: read in full, then refused for what it holds, not for its size.
    await expect(readBlueprintFile(atLimit)).rejects.toThrow(/Not a text file/);
    const over = await file("over-limit", "");
    await truncate(over, LIMITS.blueprintFileBytes + 1);
    await expect(readBlueprintFile(over)).rejects.toThrow(new ValidationError(`The file is too large for a blueprint (limit 16 MiB): ${over}`));
    // Whatever its declared size: a terabyte costs nothing.
    await truncate(over, 2 ** 40);
    await expect(readBlueprintFile(over)).rejects.toThrow(/too large/);
  });

  it("refuses what is not a file", async () => {
    const missing = await file("missing");
    await expect(readBlueprintFile(missing)).rejects.toThrow(new ValidationError(`File not found: ${missing}`));
    await expect(readBlueprintFile(scratch("missing"))).rejects.toThrow(new ValidationError(`Not a file: ${scratch("missing")}`));
    await expect(readBlueprintFile(scratch("missing", "plain.txt", "below"))).rejects.toThrow(/File not found/);
  });

  it("reads through a link the user chose, with the same limits", async () => {
    const target = await file("link-target", STRING);
    await symlink(target, scratch("link-target", "link.txt"));
    expect(await readBlueprintFile(scratch("link-target", "link.txt"))).toEqual({ name: "link.txt", text: STRING });
    const large = await file("link-large", "");
    await truncate(large, LIMITS.blueprintFileBytes + 1);
    await symlink(large, scratch("link-large", "link.txt"));
    await expect(readBlueprintFile(scratch("link-large", "link.txt"))).rejects.toThrow(/too large/);
  });
});

describe("writing a blueprint file", () => {
  it("writes the string as the whole file and leaves nothing else behind", async () => {
    const path = await file("written");
    await writeBlueprintFile(path, STRING);
    expect(await readFile(path, "utf8")).toBe(STRING);
    expect(await readdir(scratch("written"))).toEqual(["written.txt"]);
    // What was written is what an import reads.
    expect(await readBlueprintFile(path)).toEqual({ name: "written.txt", text: STRING });
  });

  it("replaces an existing file as a whole", async () => {
    const path = await file("replaced", "something much longer than the blueprint string that replaces it, so a partial write would show");
    await writeBlueprintFile(path, STRING);
    expect(await readFile(path, "utf8")).toBe(STRING);
    expect(await readdir(scratch("replaced"))).toEqual(["replaced.txt"]);
  });

  it("writes the longest string a request may carry", async () => {
    const { text } = parseExportBlueprintRequest({ name: "n", text: "0" + "A".repeat(LIMITS.blueprintStringLength - 1) });
    const path = await file("longest");
    await writeBlueprintFile(path, text);
    expect((await readBlueprintFile(path)).text).toHaveLength(LIMITS.blueprintStringLength);
  });

  it("refuses a folder as the target and a folder that does not exist, and leaves no temporary file", async () => {
    const path = await file("refused");
    await mkdir(scratch("refused", "folder.txt"));
    await expect(writeBlueprintFile(scratch("refused", "folder.txt"), STRING)).rejects.toThrow(new ValidationError(`Cannot write the blueprint over a folder: ${scratch("refused", "folder.txt")}`));
    await expect(writeBlueprintFile(scratch("refused", "nowhere", "x.txt"), STRING)).rejects.toThrow(new ValidationError(`The folder for the blueprint file does not exist: ${scratch("refused", "nowhere")}`));
    expect(await readdir(scratch("refused"))).toEqual(["folder.txt"]);
    expect(path).toBe(scratch("refused", "refused.txt"));
  });
});

describe("file names", () => {
  it("suggests the name of the project with the extension of blueprint files", () => {
    expect(BLUEPRINT_FILE_EXTENSION).toBe(".txt");
    expect(suggestedBlueprintFileName("Feedback example")).toBe("Feedback example.txt");
    expect(suggestedBlueprintFileName("Counter v1.2 (final)")).toBe("Counter v1.2 final.txt");
    expect(suggestedBlueprintFileName("Zähler → Lampe")).toBe("Z hler Lampe.txt");
  });

  it.each([
    ["/etc/passwd", "etc passwd.txt"],
    ["../../secret", "secret.txt"],
    ["..", "blueprint.txt"],
    [".hidden", "hidden.txt"],
    ["C:\\Windows\\system.ini", "C Windows system.ini.txt"],
    ["///", "blueprint.txt"],
    ["   ", "blueprint.txt"],
  ])("never suggests a path or a hidden file: %s", (name, expected) => {
    const suggested = suggestedBlueprintFileName(name);
    expect(suggested).toBe(expected);
    expect(suggested).toMatch(/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.txt$/);
  });

  it("appends the extension to a name without one and leaves the user's own alone", () => {
    expect(withBlueprintExtension("/blueprints/counter")).toBe("/blueprints/counter.txt");
    expect(withBlueprintExtension("/blueprints/counter.txt")).toBe("/blueprints/counter.txt");
    expect(withBlueprintExtension("/blueprints/counter.blueprint")).toBe("/blueprints/counter.blueprint");
    expect(withBlueprintExtension("/blue.prints/counter")).toBe("/blue.prints/counter.txt");
  });
});
