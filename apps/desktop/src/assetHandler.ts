// What the app's private schemes answer. Free of Electron: a handler maps a request to a Response, and protocols.ts registers
// it. Files come from one allow-listed directory; catalog icons come from the user's installation of the game first.
import { realpath } from "node:fs/promises";
import { iconIdOf, isInsideDirectory, resolveServedUrl, servedSegments, type ResolvedAsset, type ServedRoot } from "./assetPath.ts";
import { withTimeout } from "./gameInstallation.ts";
import { placeholderIcon } from "./gameIcons/placeholder.ts";
import { readRegularFile } from "./regularFile.ts";

export const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** How long a request waits for an icon of the installation. A file system that hangs (a volume that went away) must not hold a request for good. */
export const ICON_RENDER_TIMEOUT_MS = 2000;

export interface ServedRequest {
  readonly method: string;
  readonly url: string;
}

export type RequestHandler = (request: ServedRequest) => Promise<Response>;

/** The icons of the installation in use, as the asset handler needs them (`GameIcons`, behind the search for the installation). */
export interface InstallationIcons {
  /** Resolves once it is known which installation is in use, so the first requests after start wait for the search instead of missing it. */
  ready(): Promise<unknown>;
  /** True when an installation is in use and its icon table has the id. */
  covers(id: string): boolean;
  /** PNG bytes, or undefined when the icon cannot be rendered. Never rejects. The bytes are shared and must not be changed. */
  icon(id: string): Promise<Uint8Array | undefined>;
}

const notFound = (): Response => new Response(null, { status: 404 });

function found(body: Uint8Array, contentType: string, extraHeaders: Readonly<Record<string, string>> = {}): Response {
  // A Response copies the bytes it is given, so a shared icon stays as it is.
  return new Response(body as Uint8Array<ArrayBuffer>, { headers: { "content-type": contentType, "cache-control": "no-cache", "x-content-type-options": "nosniff", ...extraHeaders } });
}

/** The content of a file below the root, or undefined when it is missing, too large, no regular file or reached through a link that leaves the root. */
async function readServedFile(served: ServedRoot, file: ResolvedAsset): Promise<Uint8Array | undefined> {
  try {
    // Resolve symlinks on both sides so a link inside the root cannot point outside it.
    const [realRoot, realFile] = await Promise.all([realpath(served.directory), realpath(file.filePath)]);
    if (!isInsideDirectory(realRoot, realFile)) return undefined;
    return await readRegularFile(realFile, MAX_FILE_BYTES, { noFollow: true });
  } catch {
    return undefined;
  }
}

/** Serves the files of one directory. */
export function fileHandler(served: ServedRoot, extraHeaders: Readonly<Record<string, string>> = {}): RequestHandler {
  return async (request) => {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const file = resolveServedUrl(request.url, served);
    const body = file && (await readServedFile(served, file));
    return file && body ? found(body, file.contentType, extraHeaders) : notFound();
  };
}

/**
 * Serves the catalog asset root. `/icons/<id>.png` is answered, in this order, with the icon rendered from the installation
 * in use, with the file of that name below the root (icons bundled with the app), and with a placeholder when the
 * installation should have the icon but cannot provide it. Everything else, and every path without an installation, is a file
 * below the root or 404, on which the renderer falls back to names and pictograms.
 */
export function assetHandler(served: ServedRoot, icons?: InstallationIcons, renderTimeoutMs = ICON_RENDER_TIMEOUT_MS): RequestHandler {
  const files = fileHandler(served);
  return async (request) => {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const segments = servedSegments(request.url, served);
    const id = segments && iconIdOf(segments);
    if (id === undefined || !icons) return files(request);
    await icons.ready();
    const covered = icons.covers(id);
    const rendered = covered ? await withTimeout(icons.icon(id), renderTimeoutMs, () => undefined) : undefined;
    if (rendered) return found(rendered, "image/png");
    const bundled = await files(request);
    return bundled.ok || !covered ? bundled : found(placeholderIcon(), "image/png");
  };
}
