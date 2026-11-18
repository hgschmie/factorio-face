// The image files of the user's mods, for the icons of data that was read from a game with mods. A file is named by its mod
// and its path inside the mod, and comes from the mod's folder or archive in the user's mod directory: the one of the version
// the game had loaded when the data was read, found the way modInfo.ts finds it. An archive is read through its index
// (zipEntry.ts); nothing is extracted or written anywhere. Everything here rejects for what it cannot give; the caller turns
// that into an icon that is not drawn.
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { isInsideDirectory } from "../assetPath.ts";
import { INFO_FILE, isInfoEntry, parseModInfo, sameVersion } from "../gameData/modInfo.ts";
import { readUserMods, USER_MOD_LIMITS, type ModFile } from "../gameData/userMods.ts";
import { ZipArchives } from "../gameData/zipEntry.ts";
import { readRegularFile } from "../regularFile.ts";

export interface LoadedModVersion {
  readonly name: string;
  readonly version: string;
}

type ModSource =
  /** The folder with links resolved: a mod under development is usually a link to its folder, and nothing is read outside what it points to. */
  | { readonly kind: "directory"; readonly root: string }
  /** `top` is the one folder of the archive that holds the mod. */
  | { readonly kind: "zip"; readonly file: string; readonly top: string };

const isImage = (name: string): boolean => name.toLowerCase().endsWith(".png");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The files of the mods of one read of the game. The mod directory is listed once, at the first file asked for; where a mod
 * is, and that it is not there, is kept per mod, as is the index of every archive read (within the bounds of `ZipArchives`).
 * To look again, make a new one.
 */
export class ModFiles {
  private readonly directory: () => Promise<string | undefined>;
  private readonly versions: ReadonlyMap<string, string>;
  private listing: Promise<{ readonly directory: string; readonly files: readonly ModFile[] }> | undefined;
  private readonly sources = new Map<string, Promise<ModSource>>();
  /** Of an archive only its images and the file that says which mod it is are ever read. */
  private readonly archives = new ZipArchives((name) => isImage(name) || isInfoEntry(name));

  /** `directory` names the user's mod directory, or nothing when there is none; `mods` are what the game had loaded. */
  constructor(directory: () => Promise<string | undefined>, mods: readonly LoadedModVersion[]) {
    this.directory = directory;
    this.versions = new Map(mods.map((mod) => [mod.name, mod.version]));
  }

  /** What the indexes of the archives hold: how many archives, and the estimated bytes in memory. */
  get indexed(): { readonly archives: number; readonly bytes: number } {
    return this.archives.held;
  }

  /**
   * The image file `segments` of the loaded mod `mod`, of at most `maxBytes`. Rejects when the mod is not there in its
   * version, has no such file, or the file is no regular file inside the mod or is too large.
   */
  async read(mod: string, segments: readonly string[], maxBytes: number): Promise<Uint8Array> {
    const source = await this.source(mod);
    if (source.kind === "zip") {
      const bytes = isImage(segments.at(-1) ?? "") ? await this.archives.read(source.file, [source.top, ...segments].join("/"), maxBytes) : undefined;
      if (bytes === undefined) throw new Error(`The mod ${mod} has no image file ${segments.join("/")}`);
      return bytes;
    }
    // Links are resolved before the path is judged, so a link inside the mod's folder cannot lead out of it.
    const resolved = await realpath(join(source.root, ...segments));
    if (!isInsideDirectory(source.root, resolved) || !isImage(resolved)) throw new Error(`Not an image file inside the folder of the mod ${mod}: ${segments.join("/")}`);
    return readRegularFile(resolved, maxBytes, { noFollow: true });
  }

  private source(mod: string): Promise<ModSource> {
    let source = this.sources.get(mod);
    if (!source) this.sources.set(mod, (source = this.locate(mod)));
    return source;
  }

  private async locate(mod: string): Promise<ModSource> {
    const version = this.versions.get(mod);
    if (version === undefined) throw new Error(`The game had no mod ${mod} loaded`);
    const { directory, files } = await (this.listing ??= this.list());
    // The files whose name says they are the mod come first. An archive whose name says nothing (it has no version) is asked
    // after them, as in modInfo.ts, so that it is only opened for a mod that no other file is.
    const named = files.filter((file) => file.name === mod && sameVersion(version, file.version));
    const unnamed = files.filter((file) => file.name === undefined && file.kind === "zip");
    for (const file of [...named, ...unnamed]) {
      const found = await this.describe(join(directory, file.fileName), file.kind).catch(() => undefined);
      if (isRecord(found?.info) && found.info.name === mod && sameVersion(version, found.info.version)) return found.source;
    }
    throw new Error(`The mod ${mod} ${version} is not in the mod directory`);
  }

  private async list(): Promise<{ readonly directory: string; readonly files: readonly ModFile[] }> {
    const directory = await this.directory();
    if (directory === undefined) throw new Error("There is no mod directory");
    return { directory, files: (await readUserMods(directory)).files };
  }

  /** What a file of the mod directory is, by its own `info.json`, and where its files are read from. */
  private async describe(file: string, kind: ModFile["kind"]): Promise<{ readonly info: unknown; readonly source: ModSource }> {
    if (kind === "directory") {
      const root = await realpath(file);
      return { info: parseModInfo(await readRegularFile(join(root, INFO_FILE), USER_MOD_LIMITS.infoBytes)), source: { kind, root } };
    }
    const entry = await this.archives.find(file, isInfoEntry);
    const bytes = entry === undefined ? undefined : await this.archives.read(file, entry, USER_MOD_LIMITS.infoBytes);
    if (entry === undefined || bytes === undefined) throw new Error(`An archive without ${INFO_FILE}: ${file}`);
    return { info: parseModInfo(bytes), source: { kind, file, top: entry.slice(0, entry.indexOf("/")) } };
  }
}
