import { STANDARD_CATALOG_VERSION } from "@face/catalog";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMITS, PROJECT_FILE_EXTENSION, type ProjectData } from "../src/ipc.ts";
import { createEmptyProject } from "../src/emptyProject.ts";
import { readProject, writeFileAtomic, writeProject } from "../src/projectStore.ts";
import { readLastProject, RecentProjects } from "../src/recentProjects.ts";
import { parseProjectData, ValidationError } from "../src/validation.ts";

// Scratch space inside the repository; never the system temp directory.
const SCRATCH_ROOT = resolve(import.meta.dirname, "../../../.cache/tmp");
let scratch: string;

beforeAll(async () => {
  await mkdir(SCRATCH_ROOT, { recursive: true });
  scratch = await mkdtemp(join(SCRATCH_ROOT, "desktop-test-"));
});
afterAll(() => rm(scratch, { recursive: true, force: true }));

const project: ProjectData = {
  manifest: { formatVersion: 1, name: "Stored", gameVersion: "2.1.25", modules: ["base"], customSignalGroups: [], circuits: ["main.face", "second.face"] },
  files: [
    { name: "main.face", source: 'circuit "Stored" {\n    // umlauts and symbols: äöü →\n}\n' },
    { name: "second.face", source: "" },
  ],
};

type Entries = Record<string, Uint8Array>;

function manifestEntry(overrides: Record<string, unknown> = {}): Uint8Array {
  return strToU8(JSON.stringify({ ...project.manifest, ...overrides }));
}

/** The entries of a valid project file, to be bent out of shape by the tests. */
function validEntries(): Entries {
  return { "face.json": manifestEntry(), "main.face": strToU8(project.files[0]!.source), "second.face": new Uint8Array(0) };
}

/** A fresh directory with one project file path in it; the file is written when `content` is given. */
async function projectFile(name: string, content?: Uint8Array): Promise<string> {
  const directory = join(scratch, name);
  await mkdir(directory);
  const path = join(directory, `${name}${PROJECT_FILE_EXTENSION}`);
  if (content) await writeFile(path, content);
  return path;
}

/** Changes the central directory record of one entry, which is where a reader takes names, sizes and methods from. */
function patchEntry(archive: Uint8Array, name: string, patch: (view: DataView, record: number, bytes: Uint8Array) => void): Uint8Array {
  const bytes = archive.slice();
  const view = new DataView(bytes.buffer);
  let record = view.getUint32(bytes.length - 6, true);
  for (;;) {
    if (view.getUint32(record, true) !== 0x02014b50) throw new Error(`No entry ${name}`);
    const nameLength = view.getUint16(record + 28, true);
    if (strFromU8(bytes.subarray(record + 46, record + 46 + nameLength)) === name) break;
    record += 46 + nameLength + view.getUint16(record + 30, true) + view.getUint16(record + 32, true);
  }
  patch(view, record, bytes);
  return bytes;
}

const METHOD = 10;
const COMPRESSED_SIZE = 20;
const DECLARED_SIZE = 24;
const NAME = 46;

describe("project file", () => {
  it("writes one zip archive with face.json and the circuit files and reads it back unchanged", async () => {
    const path = await projectFile("roundtrip");
    await writeProject(path, project);
    expect(await readdir(join(scratch, "roundtrip"))).toEqual([`roundtrip${PROJECT_FILE_EXTENSION}`]);
    const archive = await readFile(path);
    expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const entries = unzipSync(archive);
    expect(Object.keys(entries).sort()).toEqual(["face.json", "main.face", "second.face"]);
    expect(JSON.parse(strFromU8(entries["face.json"]!))).toEqual(project.manifest);
    expect(strFromU8(entries["main.face"]!)).toBe(project.files[0]!.source);
    expect(entries["second.face"]).toHaveLength(0);
    expect(await readProject(path)).toEqual({ path, data: project });
  });

  it("reads archives written by other tools: stored entries, a directory entry, a byte order mark", async () => {
    const entries = { "face.json": strToU8("﻿" + JSON.stringify(project.manifest)), "main.face": validEntries()["main.face"]!, "second.face": new Uint8Array(0), assets: {} };
    const path = await projectFile("stored", zipSync(entries, { level: 0 }));
    expect((await readProject(path)).data).toEqual(project);
  });

  it("keeps unknown manifest fields across read and write", async () => {
    const onDisk = { ...project.manifest, editor: { theme: "dusk" }, revision: 7 };
    const path = await projectFile("unknown-fields", zipSync({ ...validEntries(), "face.json": strToU8(JSON.stringify(onDisk)) }));
    const loaded = await readProject(path);
    expect(loaded.data.manifest.extras).toEqual({ editor: { theme: "dusk" }, revision: 7 });
    // Saved again with changed settings, as the renderer does: the unknown fields are still top-level fields of face.json.
    await writeProject(path, parseProjectData({ ...loaded.data, manifest: { ...loaded.data.manifest, modules: ["base", "quality"] } }));
    expect(JSON.parse(strFromU8(unzipSync(await readFile(path))["face.json"]!))).toEqual({ ...onDisk, modules: ["base", "quality"] });
  });

  it("keeps the wire reach across write and read, and writes none for a project that has none", async () => {
    const path = await projectFile("wire-reach");
    const manifestOnDisk = async (): Promise<unknown> => JSON.parse(strFromU8(unzipSync(await readFile(path))["face.json"]!));
    await writeProject(path, project);
    expect(await manifestOnDisk()).not.toHaveProperty("wireReach");
    expect((await readProject(path)).data.manifest).not.toHaveProperty("wireReach");
    const changed: ProjectData = { ...project, manifest: { ...project.manifest, wireReach: 12.5 } };
    await writeProject(path, parseProjectData(changed));
    expect(await manifestOnDisk()).toEqual({ ...project.manifest, wireReach: 12.5 });
    expect(await readProject(path)).toEqual({ path, data: changed });
  });

  it("keeps the record of the game's mods across write and read, and refuses a project file whose record is malformed", async () => {
    const path = await projectFile("game-mods");
    const gameMods = { gameVersion: "2.1.25", mods: [{ name: "base", version: "2.1.25" }, { name: "some-mod", version: "1.2.3" }] };
    const modded: ProjectData = { ...project, manifest: { ...project.manifest, gameMods } };
    await writeProject(path, parseProjectData(modded));
    expect(JSON.parse(strFromU8(unzipSync(await readFile(path))["face.json"]!))).toEqual({ ...project.manifest, gameMods });
    expect(await readProject(path)).toEqual({ path, data: modded });
    const bad = await projectFile("bad-game-mods", zipSync({ ...validEntries(), "face.json": manifestEntry({ gameMods: { gameVersion: "2.1.25", mods: [{ name: "x" }] } }) }));
    await expect(readProject(bad)).rejects.toThrow("Mod version must be a version of three numbers");
  });

  it("brings a wire reach out of range into it and refuses a project file whose wire reach is not a number", async () => {
    for (const [wireReach, expected] of [[-1, 0], [64.5, 64], [1000, 64]]) {
      const path = await projectFile(`far-reach-${wireReach}`, zipSync({ ...validEntries(), "face.json": manifestEntry({ wireReach }) }));
      expect((await readProject(path)).data.manifest.wireReach).toBe(expected);
    }
    for (const [index, wireReach] of ["9", null].entries()) {
      const path = await projectFile(`bad-reach-${index}`, zipSync({ ...validEntries(), "face.json": manifestEntry({ wireReach }) }));
      await expect(readProject(path)).rejects.toThrow("Wire reach must be a number");
    }
  });

  it("ignores unknown root entries, unlisted circuits and everything below assets/", async () => {
    const assets = { "icon.png": new Uint8Array(8), nested: { "deep.png": new Uint8Array(8) } };
    const extra = { "notes.txt": strToU8("mine"), ".DS_Store": new Uint8Array(4), "unlisted.face": strToU8("circuit"), "Main.face": strToU8("other case"), assets };
    const path = await projectFile("ignored", zipSync({ ...validEntries(), ...extra }));
    expect((await readProject(path)).data).toEqual(project);
  });

  it("does not inflate entries it ignores, however large they claim to be", async () => {
    const archive = zipSync({ ...validEntries(), "notes.txt": strToU8("x"), assets: { "huge.png": strToU8("x") } });
    const claim = (view: DataView, record: number): void => view.setUint32(record + DECLARED_SIZE, 0xfffffff0, true);
    const path = await projectFile("ignored-huge", patchEntry(patchEntry(archive, "notes.txt", claim), "assets/huge.png", claim));
    expect((await readProject(path)).data).toEqual(project);
  });

  it("replaces an existing project as a whole and leaves no temporary files behind", async () => {
    const path = await projectFile("overwrite");
    await writeProject(path, project);
    const changed: ProjectData = { manifest: { ...project.manifest, name: "Changed", circuits: ["main.face"] }, files: [{ name: "main.face", source: "changed\n" }] };
    await writeProject(path, changed);
    expect(await readProject(path)).toEqual({ path, data: changed });
    expect(Object.keys(unzipSync(await readFile(path)))).toEqual(["face.json", "main.face"]);
    expect(await readdir(join(scratch, "overwrite"))).toEqual([`overwrite${PROJECT_FILE_EXTENSION}`]);
  });

  it("replaces a file that is not a project, as the Save panel confirmed", async () => {
    const path = await projectFile("replace-foreign", strToU8("something else"));
    await writeProject(path, project);
    expect((await readProject(path)).data).toEqual(project);
  });

  it("keeps the previous project when a save fails", async () => {
    const path = await projectFile("failed-save");
    await writeProject(path, project);
    await expect(writeProject(path, { ...project, files: [{ name: "../escape.face", source: "x" }] })).rejects.toThrow(ValidationError);
    expect(await readProject(path)).toEqual({ path, data: project });
    expect(await readdir(join(scratch, "failed-save"))).toEqual([`failed-save${PROJECT_FILE_EXTENSION}`]);
  });

  it("removes the temporary file when the rename fails", async () => {
    const directory = join(scratch, "failed-rename");
    await mkdir(join(directory, "target"), { recursive: true });
    await writeFile(join(directory, "target", "occupied"), "x");
    // Renaming a file over a non-empty directory fails.
    await expect(writeFileAtomic(join(directory, "target"), "content")).rejects.toThrow();
    await expect(writeFileAtomic(join(directory, "target"), new Uint8Array(3))).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["target"]);
  });

  it("refuses to save over a directory, empty or not, and into a folder that does not exist", async () => {
    const path = await projectFile("directory-target");
    await mkdir(path);
    await expect(writeProject(path, project)).rejects.toThrow(/over a folder/);
    await writeFile(join(path, "face.json"), JSON.stringify(project.manifest));
    await expect(writeProject(path, project)).rejects.toThrow(ValidationError);
    expect(await readdir(path)).toEqual(["face.json"]);
    expect(await readdir(join(scratch, "directory-target"))).toEqual([`directory-target${PROJECT_FILE_EXTENSION}`]);

    await expect(writeProject(join(scratch, "no-such-folder", `p${PROJECT_FILE_EXTENSION}`), project)).rejects.toThrow(/does not exist/);
    expect(await readdir(scratch)).not.toContain("no-such-folder");
  });

  it("reports a missing file, a directory of the dropped format and files that are not zip archives", async () => {
    await expect(readProject(join(scratch, `missing${PROJECT_FILE_EXTENSION}`))).rejects.toThrow(/Project file not found/);

    const directory = await projectFile("old-format");
    await mkdir(directory);
    await writeFile(join(directory, "face.json"), JSON.stringify(project.manifest));
    await writeFile(join(directory, "main.face"), "");
    await expect(readProject(directory)).rejects.toThrow(/Not a face project file \(it is a folder/);

    const valid = zipSync(validEntries());
    const notZip: [string, Uint8Array][] = [
      ["empty", new Uint8Array(0)],
      ["text", strToU8('{ "formatVersion": 1 }\n'.repeat(40))],
      ["truncated", valid.subarray(0, valid.length - 30)],
      ["header-only", valid.subarray(0, 4)],
    ];
    for (const [name, content] of notZip) {
      const error: unknown = await readProject(await projectFile(`not-zip-${name}`, content)).catch((caught: unknown) => caught);
      expect(error, name).toBeInstanceOf(ValidationError);
      expect((error as Error).message, name).toMatch(/Not a face project file/);
    }
  });

  it("requires face.json, valid JSON in it, a valid manifest and every circuit it lists", async () => {
    await expect(readProject(await projectFile("no-entries", zipSync({})))).rejects.toThrow(/Not a face project file \(it has no face\.json\)/);
    const { "face.json": _manifest, ...circuitsOnly } = validEntries();
    await expect(readProject(await projectFile("no-manifest", zipSync(circuitsOnly)))).rejects.toThrow(/Not a face project file \(it has no face\.json\)/);
    await expect(readProject(await projectFile("bad-json", zipSync({ ...validEntries(), "face.json": strToU8("{ nope") })))).rejects.toThrow(/not valid JSON/);
    const withManifest = (overrides: Record<string, unknown>): Uint8Array => zipSync({ ...validEntries(), "face.json": manifestEntry(overrides) });
    await expect(readProject(await projectFile("bad-manifest", withManifest({ circuits: ["../../outside.face"] })))).rejects.toThrow(ValidationError);
    await expect(readProject(await projectFile("future-version", withManifest({ formatVersion: 3 })))).rejects.toThrow(/Unsupported project format version/);
    const { "second.face": _second, ...withoutSecond } = validEntries();
    await expect(readProject(await projectFile("missing-circuit", zipSync(withoutSecond)))).rejects.toThrow(/lists second\.face but does not contain it/);
    // A circuit is an entry at the root, not one that merely ends in the same name.
    await expect(readProject(await projectFile("circuit-in-assets", zipSync({ ...withoutSecond, assets: { "second.face": strToU8("") } })))).rejects.toThrow(/lists second\.face/);
  });

  it.each([
    ["a parent directory", "../escape.face"],
    ["a bare parent directory", ".."],
    ["a parent directory below assets/", "assets/../../escape.png"],
    ["a subdirectory", "sub/main.face"],
    ["a directory entry", "sub/"],
    ["an absolute path", "/etc/escape.face"],
    ["a drive letter", "C:escape.face"],
    ["a backslash", "sub\\escape.face"],
    ["a NUL character", "main.face\0.txt"],
  ])("rejects an entry name with %s", async (_what, name) => {
    const path = await projectFile(`name-${encodeURIComponent(name)}`.replaceAll("%", "_").replaceAll(".", "_"), zipSync({ ...validEntries(), [name]: strToU8("x") }));
    const error: unknown = await readProject(path).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/The project file contains an entry/);
  });

  it("rejects an entry without a name", async () => {
    const archive = patchEntry(zipSync({ ...validEntries(), x: strToU8("x") }), "x", (view, record) => view.setUint16(record + 28, 0, true));
    await expect(readProject(await projectFile("name-empty", archive))).rejects.toThrow(ValidationError);
  });

  it.each([
    ["face.json", "fbce.json"],
    ["main.face", "mbin.face"],
    ["notes.txt", "notez.txt"],
    ["assets/a.png", "assets/b.png"],
  ])("rejects a second entry named %s", async (name, placeholder) => {
    const rename = (_view: DataView, record: number, bytes: Uint8Array): void => bytes.set(strToU8(name), record + NAME);
    const archive = patchEntry(zipSync({ ...validEntries(), [name]: validEntries()[name] ?? strToU8("x"), [placeholder]: strToU8("y") }), placeholder, rename);
    await expect(readProject(await projectFile(`duplicate-${placeholder.replace("/", "-")}`, archive))).rejects.toThrow(/more than once/);
  });

  it("refuses a manifest or circuit that is too large, by its declared size and before inflating it", async () => {
    const hugeManifest = zipSync({ ...validEntries(), "face.json": strToU8(" ".repeat(LIMITS.manifestBytes + 1)) });
    await expect(readProject(await projectFile("oversized-manifest", hugeManifest))).rejects.toThrow(/face\.json is too large/);
    const hugeCircuit = zipSync({ ...validEntries(), "second.face": new Uint8Array(LIMITS.circuitSourceLength * 3 + 1) });
    await expect(readProject(await projectFile("oversized-circuit", hugeCircuit))).rejects.toThrow(/second\.face is too large/);

    // Small entries that only claim to be huge: nothing that large is ever allocated for them.
    const claim = (size: number) => (view: DataView, record: number): void => view.setUint32(record + DECLARED_SIZE, size, true);
    const valid = zipSync(validEntries());
    await expect(readProject(await projectFile("declared-manifest", patchEntry(valid, "face.json", claim(0xfffffff0))))).rejects.toThrow(/face\.json is too large/);
    await expect(readProject(await projectFile("declared-circuit", patchEntry(valid, "main.face", claim(LIMITS.circuitSourceLength * 3 + 1))))).rejects.toThrow(/main\.face is too large/);
  });

  it("refuses entries whose content does not have the declared size", async () => {
    const claim = (size: number) => (view: DataView, record: number): void => view.setUint32(record + DECLARED_SIZE, size, true);
    const valid = zipSync({ ...validEntries(), "main.face": strToU8("abcdefgh".repeat(4000)) });
    await expect(readProject(await projectFile("lying-longer", patchEntry(valid, "main.face", claim(64_000))))).rejects.toThrow(/main\.face is damaged/);
    // Known gap: fflate fills a buffer of the declared size and stops, and it does not verify checksums. An entry that
    // declares less than it holds is therefore cut off instead of refused; what matters here is that it never grows.
    const cutOff = await readProject(await projectFile("lying-shorter", patchEntry(valid, "main.face", claim(100))));
    expect(cutOff.data.files[0]!.source).toHaveLength(100);
    // A stored entry is copied as it is: its real size counts, not the small one it declares.
    const stored = zipSync({ ...validEntries(), "face.json": [strToU8(JSON.stringify(project.manifest) + " ".repeat(LIMITS.manifestBytes)), { level: 0 }] });
    await expect(readProject(await projectFile("lying-stored", patchEntry(stored, "face.json", claim(200))))).rejects.toThrow(/face\.json is too large/);
    const smallStored = zipSync(validEntries(), { level: 0 });
    await expect(readProject(await projectFile("lying-stored-small", patchEntry(smallStored, "main.face", claim(3))))).rejects.toThrow(/main\.face is damaged/);
  });

  it("refuses a circuit that is too long as text, text that is not UTF-8 and unsupported compression methods", async () => {
    const long = zipSync({ ...validEntries(), "main.face": strToU8("x".repeat(LIMITS.circuitSourceLength + 1)) });
    await expect(readProject(await projectFile("long-circuit", long))).rejects.toThrow(/main\.face is too large/);
    const latin1 = zipSync({ ...validEntries(), "main.face": new Uint8Array([0x63, 0xe4, 0xf6, 0xfc]) });
    await expect(readProject(await projectFile("latin1", latin1))).rejects.toThrow(/main\.face is not valid UTF-8/);
    const lzma = patchEntry(zipSync(validEntries()), "main.face", (view, record) => view.setUint16(record + METHOD, 14, true));
    await expect(readProject(await projectFile("lzma", lzma))).rejects.toThrow(/compression method/);
  });

  it("caps the number of entries", async () => {
    const filler = (count: number): Entries => Object.fromEntries(Array.from({ length: count }, (_, index) => [`filler-${index}.txt`, new Uint8Array(0)]));
    const atLimit = zipSync({ ...validEntries(), ...filler(LIMITS.projectEntries - 3) });
    expect((await readProject(await projectFile("entries-at-limit", atLimit))).data).toEqual(project);
    const overLimit = zipSync({ ...validEntries(), ...filler(LIMITS.projectEntries - 2) });
    await expect(readProject(await projectFile("entries-over-limit", overLimit))).rejects.toThrow(/too many entries/);
  });

  it("caps the size of the project file before reading it", async () => {
    const path = await projectFile("oversized-archive", zipSync(validEntries()));
    // A sparse file: large for the size check without writing that much.
    await truncate(path, LIMITS.projectFileBytes + 1);
    await expect(readProject(path)).rejects.toThrow(/project file is too large/);
    await truncate(path, LIMITS.projectFileBytes);
    await expect(readProject(path)).rejects.toThrow(/Not a face project file/);
  });

  it("creates a valid empty project", () => {
    const empty = createEmptyProject("Fresh");
    expect(parseProjectData(empty)).toEqual(empty);
    expect(empty.files[0]!.source).toBe('circuit "Fresh" {\n}\n');
    expect(empty.manifest.modules).toEqual(["base", "space-age", "quality", "recycler", "elevated-rails"]);
    expect(empty.manifest.gameVersion).toBe(STANDARD_CATALOG_VERSION);
  });
});

describe("project file with a blueprint book", () => {
  const string = "0eNqVkMEKwjAQRH9l2XMQe1DBq78h";
  const withBook: ProjectData = { ...project, manifest: { ...project.manifest, formatVersion: 2 }, book: { string, origin: [2, 0] } };
  const entriesOf = async (path: string): Promise<Entries> => unzipSync(await readFile(path));
  const manifestOf = async (path: string): Promise<unknown> => JSON.parse(strFromU8((await entriesOf(path))["face.json"]!));
  /** A project file as another tool could have written it: the manifest with `overrides`, the circuits, and `book` as book.txt. */
  const fileWith = (name: string, overrides: Record<string, unknown>, book?: Uint8Array | string): Promise<string> =>
    projectFile(name, zipSync({ ...validEntries(), "face.json": manifestEntry(overrides), ...(book === undefined ? {} : { "book.txt": typeof book === "string" ? strToU8(book) : book }) }));

  it("writes the book as the entry book.txt, names it in the manifest of version 2 and reads both back", async () => {
    const path = await projectFile("book-roundtrip");
    // The renderer spreads the manifest of an empty or a loaded project: the version it sends says nothing.
    await writeProject(path, parseProjectData({ ...project, book: withBook.book }));
    const entries = await entriesOf(path);
    expect(Object.keys(entries).sort()).toEqual(["book.txt", "face.json", "main.face", "second.face"]);
    expect(strFromU8(entries["book.txt"]!)).toBe(string);
    expect(strFromU8(entries["face.json"]!)).toBe(JSON.stringify({ ...project.manifest, formatVersion: 2, book: { file: "book.txt", origin: [2, 0] } }, null, 2) + "\n");
    expect(await readProject(path)).toEqual({ path, data: withBook });
  });

  it("keeps a book without an origin without one", async () => {
    const path = await projectFile("book-no-origin");
    await writeProject(path, { ...project, book: { string } });
    expect(await manifestOf(path)).toEqual({ ...project.manifest, formatVersion: 2, book: { file: "book.txt" } });
    const loaded = await readProject(path);
    expect(loaded.data).toEqual({ ...withBook, book: { string } });
    expect(loaded.data.book).not.toHaveProperty("origin");
  });

  it("writes a project without a book as before: the same bytes of face.json, version 1, no book.txt", async () => {
    const path = await projectFile("book-none");
    await writeProject(path, project);
    const entries = await entriesOf(path);
    expect(strFromU8(entries["face.json"]!)).toBe(JSON.stringify(project.manifest, null, 2) + "\n");
    expect(Object.keys(entries).sort()).toEqual(["face.json", "main.face", "second.face"]);
    expect((await readProject(path)).data).not.toHaveProperty("book");
  });

  it("goes back to version 1 when the book is taken out of a project, and to version 2 when one is put in", async () => {
    const path = await projectFile("book-removed");
    await writeProject(path, withBook);
    const { book: _book, ...loaded } = (await readProject(path)).data;
    expect(loaded.manifest.formatVersion).toBe(2);
    await writeProject(path, parseProjectData(loaded));
    expect(Object.keys(await entriesOf(path)).sort()).toEqual(["face.json", "main.face", "second.face"]);
    expect(await manifestOf(path)).toEqual(project.manifest);
    expect(await readProject(path)).toEqual({ path, data: project });
    await writeProject(path, parseProjectData({ ...(await readProject(path)).data, book: { string } }));
    expect(await manifestOf(path)).toEqual({ ...project.manifest, formatVersion: 2, book: { file: "book.txt" } });
  });

  it("writes the book after the known fields and before the unknown ones, and keeps both across a save", async () => {
    const onDisk = { ...project.manifest, formatVersion: 2, wireReach: 12, book: { file: "book.txt", origin: [7] }, editor: { theme: "dusk" } };
    const path = await fileWith("book-unknown-fields", onDisk, string);
    const loaded = await readProject(path);
    expect(loaded.data.manifest.extras).toEqual({ editor: { theme: "dusk" } });
    expect(loaded.data.book).toEqual({ string, origin: [7] });
    await writeProject(path, parseProjectData(loaded.data));
    expect(await manifestOf(path)).toEqual(onDisk);
    expect(Object.keys((await manifestOf(path)) as object).slice(-3)).toEqual(["wireReach", "book", "editor"]);
  });

  it("reads a file of version 2 without a book and a file of version 1 with one", async () => {
    const versionTwo = await readProject(await fileWith("book-version-2-none", { formatVersion: 2 }));
    expect(versionTwo.data).toEqual({ ...project, manifest: { ...project.manifest, formatVersion: 2 } });
    const versionOne = await fileWith("book-version-1", { formatVersion: 1, book: { file: "book.txt", origin: [0] } }, string);
    expect((await readProject(versionOne)).data).toEqual({ ...project, book: { string, origin: [0] } });
    // Saved as it was read, the file gets the version that fits what it holds.
    await writeProject(versionOne, parseProjectData((await readProject(versionOne)).data));
    expect(await manifestOf(versionOne)).toEqual({ ...project.manifest, formatVersion: 2, book: { file: "book.txt", origin: [0] } });
  });

  it("ignores an entry book.txt that the manifest does not name, whatever it holds and without inflating it", async () => {
    expect((await readProject(await fileWith("book-unlisted", {}, string))).data).toEqual(project);
    expect((await readProject(await fileWith("book-unlisted-junk", { formatVersion: 2 }, new Uint8Array([0xff, 0xfe, 0x00])))).data).not.toHaveProperty("book");
    const claim = (view: DataView, record: number): void => view.setUint32(record + DECLARED_SIZE, 0xfffffff0, true);
    const huge = patchEntry(zipSync({ ...validEntries(), "book.txt": strToU8(string) }), "book.txt", claim);
    expect((await readProject(await projectFile("book-unlisted-huge", huge))).data).toEqual(project);
  });

  it("refuses a manifest that names a book the file does not have, like a missing circuit", async () => {
    await expect(readProject(await fileWith("book-missing", { formatVersion: 2, book: { file: "book.txt" } }))).rejects.toThrow(/lists book\.txt but does not contain it/);
    // The book is an entry at the root, under exactly that name.
    const elsewhere = zipSync({ ...validEntries(), "face.json": manifestEntry({ book: { file: "book.txt" } }), "Book.txt": strToU8(string), assets: { "book.txt": strToU8(string) } });
    await expect(readProject(await projectFile("book-elsewhere", elsewhere))).rejects.toThrow(/lists book\.txt but does not contain it/);
  });

  it.each([
    ["a circuit", "main.face"],
    ["the manifest", "face.json"],
    ["another entry", "notes.txt"],
    ["a path", "../book.txt"],
  ])("refuses a manifest whose book is %s", async (_what, file) => {
    const path = await fileWith(`book-file-${encodeURIComponent(file).replaceAll("%", "_").replaceAll(".", "_")}`, { book: { file } }, string);
    await expect(readProject(path)).rejects.toThrow(/the manifest names another one/);
  });

  it.each([
    ["plain JSON", '{"blueprint_book":{}}'],
    ["another version character", "1eNqVkMEK"],
    ["a line break at the end", `${string}\n`],
    ["nothing", ""],
  ])("refuses a book that is %s, which is not a blueprint string", async (what, content) => {
    const path = await fileWith(`book-content-${what.replaceAll(" ", "-")}`, { book: { file: "book.txt" } }, content);
    const error: unknown = await readProject(path).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toBe("The blueprint book is not a blueprint string");
  });

  it("reads a stored book with a byte order mark, as it reads the other entries, and does not keep the mark", async () => {
    const entries = { ...validEntries(), "face.json": manifestEntry({ book: { file: "book.txt" } }), "book.txt": strToU8(`\ufeff${string}`) };
    expect((await readProject(await projectFile("book-stored", zipSync(entries, { level: 0 })))).data.book).toEqual({ string });
  });

  it("refuses a book that is not text", async () => {
    const path = await fileWith("book-not-text", { book: { file: "book.txt" } }, new Uint8Array([0x30, 0xe4, 0xf6, 0xfc]));
    await expect(readProject(path)).rejects.toThrow(/book\.txt is not valid UTF-8/);
  });

  it.each([["an empty list", []], ["no list", 2], ["a negative position", [0, -1]], ["a fraction", [1.5]], ["text", ["0"]], ["a position beyond the limit", [LIMITS.bookOriginIndex + 1]], ["too many positions", Array.from({ length: LIMITS.bookOriginDepth + 1 }, () => 0)]])(
    "refuses an origin that is %s",
    async (what, origin) => {
      const path = await fileWith(`book-origin-${what.replaceAll(" ", "-")}`, { book: { file: "book.txt", origin } }, string);
      const error: unknown = await readProject(path).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toMatch(/origin in the blueprint book/);
    },
  );

  it("takes a book up to the longest blueprint string and refuses a longer one, by its declared size and before inflating it", async () => {
    const longest = "0" + "A".repeat(LIMITS.blueprintStringLength - 1);
    const path = await projectFile("book-longest");
    await writeProject(path, { ...project, book: { string: longest } });
    expect((await readProject(path)).data.book?.string).toBe(longest);
    await expect(readProject(await fileWith("book-too-long", { book: { file: "book.txt" } }, longest + "A"))).rejects.toThrow(/book\.txt is too large/);
    const claim = (view: DataView, record: number): void => view.setUint32(record + DECLARED_SIZE, 0xfffffff0, true);
    const claimed = patchEntry(zipSync({ ...validEntries(), "face.json": manifestEntry({ book: { file: "book.txt" } }), "book.txt": strToU8(string) }), "book.txt", claim);
    await expect(readProject(await projectFile("book-declared", claimed))).rejects.toThrow(/book\.txt is too large/);
  });

  it("leaves room beside the largest book that does not compress: a tenth of the file limit, a fifteenth of the content limit", async () => {
    // Base64 of bytes without a pattern, as a book of the game is: deflate takes it down to three quarters and no further.
    const length = LIMITS.blueprintStringLength;
    let state = 1;
    const bytes = Uint8Array.from({ length: (length / 4) * 3 }, () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 24);
    const longest = ("0" + Buffer.from(bytes).toString("base64")).slice(0, length);
    const path = await projectFile("book-incompressible");
    await writeProject(path, { ...project, book: { string: longest } });
    const size = (await readFile(path)).length;
    expect(size).toBeGreaterThan(length / 2);
    expect(size).toBeLessThan(LIMITS.projectFileBytes / 8);
    expect(length).toBeLessThan(LIMITS.projectContentBytes / 15);
    expect((await readProject(path)).data.book?.string).toBe(longest);
  });

  it.each([
    ["no blueprint string", { string: "book" }],
    ["longer than the limit", { string: "0" + "A".repeat(LIMITS.blueprintStringLength) }],
    ["no string", { string: 5 }],
    ["with an empty origin", { string, origin: [] }],
    ["with an origin that is no position", { string, origin: [0.5] }],
  ])("refuses to save a book that is %s, and keeps the previous project", async (what, book) => {
    const path = await projectFile(`book-save-${what.replaceAll(" ", "-")}`);
    await writeProject(path, withBook);
    await expect(writeProject(path, { ...project, book: book as ProjectData["book"] })).rejects.toThrow(ValidationError);
    expect(await readProject(path)).toEqual({ path, data: withBook });
  });
});

describe("recent projects", () => {
  it("stores the most recent first, without duplicates, bounded and across instances", async () => {
    const file = join(scratch, "profile", "recent-projects.json");
    const recent = new RecentProjects(file);
    expect(await recent.list()).toEqual([]);
    await recent.add("/projects/a.faceproj", "A", new Date("2026-11-11T10:00:00Z"));
    await recent.add("/projects/b.faceproj", "B", new Date("2026-11-11T11:00:00Z"));
    await recent.add("/projects/a.faceproj", "A renamed", new Date("2026-11-11T12:00:00Z"));
    expect(await recent.list()).toEqual([
      { path: "/projects/a.faceproj", name: "A renamed", openedAt: "2026-11-11T12:00:00.000Z" },
      { path: "/projects/b.faceproj", name: "B", openedAt: "2026-11-11T11:00:00.000Z" },
    ]);
    for (let i = 0; i < 15; i++) await recent.add(`/projects/p${i}.faceproj`, `P${i}`);
    expect(await recent.list()).toHaveLength(LIMITS.recentProjects);

    const reopened = new RecentProjects(file);
    expect((await reopened.list())[0]!.path).toBe("/projects/p14.faceproj");
    await reopened.clear();
    expect(await new RecentProjects(file).list()).toEqual([]);
  });

  it("starts empty when the file is corrupt", async () => {
    const file = join(scratch, "corrupt-recent.json");
    await writeFile(file, "not json");
    expect(await new RecentProjects(file).list()).toEqual([]);
  });
});

describe("the project a freshly started app opens", () => {
  const recentWith = async (name: string, ...paths: string[]): Promise<RecentProjects> => {
    const recent = new RecentProjects(join(scratch, `${name}-recent.json`));
    // Added oldest first, so the first path given ends up on top.
    for (const path of paths.reverse()) await recent.add(path, "Stored");
    return recent;
  };

  it("is none when no project was ever opened or saved", async () => {
    expect(await readLastProject(await recentWith("start-none"))).toBeNull();
  });

  it("is the top of the recent projects, read from disk", async () => {
    const last = await projectFile("start-last");
    const older = await projectFile("start-older");
    await writeProject(last, project);
    await writeProject(older, { ...project, manifest: { ...project.manifest, name: "Older" } });
    const recent = await recentWith("start-last", last, older);
    expect(await readLastProject(recent)).toEqual({ path: last, data: project });
    // Reading decides nothing about the list: the caller records the project as opened.
    expect((await recent.list()).map((entry) => entry.path)).toEqual([last, older]);
  });

  it("fails when the last project is gone or damaged, and an older one does not stand in for it", async () => {
    const older = await projectFile("start-fallback");
    await writeProject(older, project);
    const deleted = await projectFile("start-deleted");
    const damaged = await projectFile("start-damaged", strToU8("this is not a zip archive"));
    await expect(readLastProject(await recentWith("start-deleted", deleted, older))).rejects.toThrow(`Project file not found: ${deleted}`);
    await expect(readLastProject(await recentWith("start-damaged", damaged, older))).rejects.toThrow(/Not a face project file \(it is not a readable zip archive\)/);
    // An entry of the dropped directory format, or any other path that does not name a project file, is not even looked at.
    await expect(readLastProject(await recentWith("start-directory", scratch, older))).rejects.toThrow(/Not a face project file \(the name must end in .faceproj\)/);
    for (const name of ["start-deleted", "start-damaged", "start-directory"]) expect(JSON.parse(await readFile(join(scratch, `${name}-recent.json`), "utf8"))).toHaveLength(2);
  });
});
