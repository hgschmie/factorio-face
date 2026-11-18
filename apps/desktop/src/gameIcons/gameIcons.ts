// Renders catalog icons on demand and keeps them in memory: from the user's installation of the game, and for data read
// from a game with mods from the user's mods as well. A caller names an icon id and gets PNG bytes or nothing; which files
// are read is decided by the icon table alone, and each of them must really lie inside the installation's data directory or
// inside the mod it is named in (modFiles.ts).
import { DEFAULT_ICON_SIZE, iconFileLocation, modFileLocation, type IconEntry, type IconTable } from "@face/catalog/icons";
import { realpath } from "node:fs/promises";
import { extname, join } from "node:path";
import { isInsideDirectory } from "../assetPath.ts";
import { readRegularFile } from "../regularFile.ts";
import { iconSource, renderIcon } from "./iconRenderer.ts";
import { ModFiles, type LoadedModVersion } from "./modFiles.ts";
import { decodePng, encodePng, FAST_ENCODING, type RgbaImage } from "./png.ts";

/** The largest source image read, of the game or of a mod. The game's icon files are below 50 KiB. */
export const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

const SOURCE_CACHE_ENTRIES = 32;
/** Decoded images above this size are not kept: layers shared by many icons are small, and the cache stays below 8 MiB whatever the folder holds. */
const SOURCE_CACHE_IMAGE_BYTES = 256 * 1024;
/** Files open at the same time, however many icons are asked for at once. */
const CONCURRENT_READS = 8;

export interface GameIconsOptions {
  /** Told why an icon could not be rendered (a missing or damaged file, a file outside the data directory or the mod). For the log. */
  readonly onProblem?: (iconId: string, error: unknown) => void;
  /** The user's mod directory for the installation with this data directory, as it is when asked; nothing when there is none. Without this no file of a mod is read. */
  readonly modDirectory?: (dataDirectory: string) => Promise<string | undefined>;
}

/** What belongs to one installation and one icon table. Replaced as a whole when either changes, so work still running for the old one cannot leak into the new. */
interface Installation {
  readonly dataDirectory: string;
  /** The data directory with links resolved, or undefined when it cannot be resolved. */
  readonly root: Promise<string | undefined>;
  readonly icons: Map<string, Promise<Uint8Array | undefined>>;
  /** Decoded source images by the layer's path, least recently used first. An entry is a promise, so layers that many icons share are read once. */
  readonly sources: Map<string, Promise<RgbaImage>>;
  /** The files of the mods the table's data was read with, where they are now. */
  readonly mods: ModFiles;
}

export class GameIcons {
  private table: IconTable;
  private mods: readonly LoadedModVersion[];
  private readonly onProblem: ((iconId: string, error: unknown) => void) | undefined;
  private readonly modDirectory: (dataDirectory: string) => Promise<string | undefined>;
  private installation: Installation | undefined;
  private changes = 0;
  private reading = 0;
  private readonly waiting: (() => void)[] = [];

  /** `mods` are what the game had loaded when the table's data was read from it; none for the table that comes with the build. */
  constructor(table: IconTable, options: GameIconsOptions = {}, mods: readonly LoadedModVersion[] = []) {
    this.table = table;
    this.mods = mods;
    this.onProblem = options.onProblem;
    this.modDirectory = options.modDirectory ?? (() => Promise.resolve(undefined));
  }

  /** Increases whenever the installation changes: an icon fetched under an earlier revision may be out of date. */
  get revision(): number {
    return this.changes;
  }

  /** What the indexes of the mods' archives hold in memory right now, for measurements. */
  get indexedArchives(): { readonly archives: number; readonly bytes: number } {
    return this.installation?.mods.indexed ?? { archives: 0, bytes: 0 };
  }

  /** Switches to another installation's data directory, or to none, and forgets everything rendered so far. */
  reset(dataDirectory: string | undefined): void {
    this.changes++;
    this.installation = dataDirectory === undefined ? undefined : this.installed(dataDirectory, realpath(dataDirectory).catch(() => undefined));
  }

  /**
   * Switches to another icon table (the data read from the user's game with the mods it had loaded, or the standard one
   * again) and forgets everything rendered from the old one, and where the old one's mods were.
   */
  setTable(table: IconTable, mods: readonly LoadedModVersion[] = []): void {
    this.table = table;
    this.mods = mods;
    this.changes++;
    if (this.installation) this.installation = this.installed(this.installation.dataDirectory, this.installation.root);
  }

  private installed(dataDirectory: string, root: Promise<string | undefined>): Installation {
    return { dataDirectory, root, icons: new Map(), sources: new Map(), mods: new ModFiles(() => this.modDirectory(dataDirectory), this.mods) };
  }

  /** True when an installation is set and the table has the icon: `icon` then answers from the installation and the mods, or with nothing when its files are missing or damaged. */
  covers(id: string): boolean {
    return this.installation !== undefined && this.table.icons.has(id);
  }

  /** True for an icon of the table with an image file of a mod among its layers. */
  ofMod(id: string): boolean {
    return this.table.icons.get(id)?.layers.some((layer) => modFileLocation(layer.icon) !== undefined) ?? false;
  }

  /**
   * The icon as a 64 pixel PNG, or undefined when the id is not in the table, no installation is set or a source file is
   * missing, damaged, too large, no PNG the decoder reads, or outside the data directory or its mod. Never rejects. The
   * answer is kept, so the bytes must not be changed.
   */
  icon(id: string): Promise<Uint8Array | undefined> {
    const installation = this.installation;
    const entry = this.table.icons.get(id);
    if (!installation || !entry) return Promise.resolve(undefined);
    let icon = installation.icons.get(id);
    if (!icon) {
      icon = this.render(installation, entry).catch((error: unknown) => {
        this.onProblem?.(id, error);
        return undefined;
      });
      installation.icons.set(id, icon);
    }
    return icon;
  }

  private async render(installation: Installation, { expected, layers }: IconEntry): Promise<Uint8Array> {
    const images = await Promise.all(layers.map((layer) => this.source(installation, layer.icon)));
    return encodePng(renderIcon(layers, layers.map((layer, index) => iconSource(images[index]!, layer.size)), { expected, output: DEFAULT_ICON_SIZE }), FAST_ENCODING);
  }

  private async source(installation: Installation, icon: string): Promise<RgbaImage> {
    const { sources } = installation;
    let image = sources.get(icon);
    if (image) sources.delete(icon);
    else image = this.read(installation, icon);
    sources.set(icon, image);
    for (const oldest of sources.keys()) {
      if (sources.size <= SOURCE_CACHE_ENTRIES) break;
      sources.delete(oldest);
    }
    try {
      const decoded = await image;
      if (decoded.data.length > SOURCE_CACHE_IMAGE_BYTES && sources.get(icon) === image) sources.delete(icon);
      return decoded;
    } catch (error) {
      // A failure is not kept: the icon's own answer is, and that is cleared with the installation.
      if (sources.get(icon) === image) sources.delete(icon);
      throw error;
    }
  }

  /** Reads and decodes one source image, with at most CONCURRENT_READS files open at a time. */
  private async read(installation: Installation, icon: string): Promise<RgbaImage> {
    if (this.reading >= CONCURRENT_READS) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.reading++;
    try {
      return decodePng(await this.bytes(installation, icon));
    } finally {
      // A waiting read takes over this slot; otherwise the slot is free again.
      const next = this.waiting.shift();
      if (next) next();
      else this.reading--;
    }
  }

  /** The bytes of a layer's file: of the installation, or of a mod. */
  private async bytes(installation: Installation, icon: string): Promise<Uint8Array> {
    const location = iconFileLocation(icon);
    if (!location) {
      const ofMod = modFileLocation(icon);
      if (!ofMod) throw new Error(`Not an image file of the game or of a mod: ${icon}`);
      return installation.mods.read(ofMod.mod, ofMod.segments, MAX_SOURCE_FILE_BYTES);
    }
    const root = await installation.root;
    if (root === undefined) throw new Error("The game's data directory cannot be resolved");
    // Links are resolved before the path is judged, so a link inside the data directory cannot lead out of it.
    const resolved = await realpath(join(root, location.module, ...location.segments));
    if (!isInsideDirectory(root, resolved) || extname(resolved).toLowerCase() !== ".png") throw new Error(`Not an image file inside the game's data directory: ${icon}`);
    return readRegularFile(resolved, MAX_SOURCE_FILE_BYTES, { noFollow: true });
  }
}
