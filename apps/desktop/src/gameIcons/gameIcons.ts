// Renders catalog icons on demand from the user's installation of the game and keeps them in memory. A caller names an
// icon id and gets PNG bytes or nothing; which files are read is decided by the icon table alone, and each of them must
// really lie inside the installation's data directory.
import { DEFAULT_ICON_SIZE, iconFileLocation, type IconEntry, type IconTable } from "@face/catalog/icons";
import { realpath } from "node:fs/promises";
import { extname, join } from "node:path";
import { isInsideDirectory } from "../assetPath.ts";
import { readRegularFile } from "../regularFile.ts";
import { iconSource, renderIcon } from "./iconRenderer.ts";
import { decodePng, encodePng, FAST_ENCODING, type RgbaImage } from "./png.ts";

/** The largest source image read. The game's icon files are below 50 KiB. */
export const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

const SOURCE_CACHE_ENTRIES = 32;
/** Decoded images above this size are not kept: layers shared by many icons are small, and the cache stays below 8 MiB whatever the folder holds. */
const SOURCE_CACHE_IMAGE_BYTES = 256 * 1024;
/** Files open at the same time, however many icons are asked for at once. */
const CONCURRENT_READS = 8;

export interface GameIconsOptions {
  /** Told why an icon could not be rendered (a missing or damaged file, a file outside the data directory). For the log. */
  readonly onProblem?: (iconId: string, error: unknown) => void;
}

/** What belongs to one installation. Replaced as a whole on `reset`, so work still running for the old one cannot leak into the new. */
interface Installation {
  /** The data directory with links resolved, or undefined when it cannot be resolved. */
  readonly root: Promise<string | undefined>;
  readonly icons: Map<string, Promise<Uint8Array | undefined>>;
  /** Decoded source images by path, least recently used first. An entry is a promise, so layers that many icons share are read once. */
  readonly sources: Map<string, Promise<RgbaImage>>;
}

export class GameIcons {
  private readonly table: IconTable;
  private readonly onProblem: ((iconId: string, error: unknown) => void) | undefined;
  private installation: Installation | undefined;
  private changes = 0;
  private reading = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(table: IconTable, options: GameIconsOptions = {}) {
    this.table = table;
    this.onProblem = options.onProblem;
  }

  /** Increases whenever the installation changes: an icon fetched under an earlier revision may be out of date. */
  get revision(): number {
    return this.changes;
  }

  /** Switches to another installation's data directory, or to none, and forgets everything rendered so far. */
  reset(dataDirectory: string | undefined): void {
    this.changes++;
    this.installation = dataDirectory === undefined ? undefined : { root: realpath(dataDirectory).catch(() => undefined), icons: new Map(), sources: new Map() };
  }

  /** True when an installation is set and the table has the icon: `icon` then answers from the installation, or with nothing when its files are missing or damaged. */
  covers(id: string): boolean {
    return this.installation !== undefined && this.table.icons.has(id);
  }

  /**
   * The icon as a 64 pixel PNG, or undefined when the id is not in the table, no installation is set or a source file is
   * missing, damaged or outside the data directory. Never rejects. The answer is kept, so the bytes must not be changed.
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
    const root = await installation.root;
    if (root === undefined) throw new Error("The game's data directory cannot be resolved");
    const images = await Promise.all(layers.map((layer) => this.source(installation, root, layer.icon)));
    return encodePng(renderIcon(layers, layers.map((layer, index) => iconSource(images[index]!, layer.size)), { expected, output: DEFAULT_ICON_SIZE }), FAST_ENCODING);
  }

  private async source(installation: Installation, root: string, icon: string): Promise<RgbaImage> {
    const location = iconFileLocation(icon);
    if (!location) throw new Error(`Not an image file of the game: ${icon}`);
    const file = join(root, location.module, ...location.segments);
    const { sources } = installation;
    let image = sources.get(file);
    if (image) sources.delete(file);
    else image = this.read(root, file);
    sources.set(file, image);
    for (const oldest of sources.keys()) {
      if (sources.size <= SOURCE_CACHE_ENTRIES) break;
      sources.delete(oldest);
    }
    try {
      const decoded = await image;
      if (decoded.data.length > SOURCE_CACHE_IMAGE_BYTES && sources.get(file) === image) sources.delete(file);
      return decoded;
    } catch (error) {
      // A failure is not kept: the icon's own answer is, and that is cleared with the installation.
      if (sources.get(file) === image) sources.delete(file);
      throw error;
    }
  }

  /** Reads and decodes one source image, with at most CONCURRENT_READS files open at a time. */
  private async read(root: string, file: string): Promise<RgbaImage> {
    if (this.reading >= CONCURRENT_READS) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.reading++;
    try {
      // Links are resolved before the path is judged, so a link inside the data directory cannot lead out of it.
      const resolved = await realpath(file);
      if (!isInsideDirectory(root, resolved) || extname(resolved).toLowerCase() !== ".png") throw new Error(`Not an image file inside the game's data directory: ${file}`);
      return decodePng(await readRegularFile(resolved, MAX_SOURCE_FILE_BYTES, { noFollow: true }));
    } finally {
      // A waiting read takes over this slot; otherwise the slot is free again.
      const next = this.waiting.shift();
      if (next) next();
      else this.reading--;
    }
  }
}
