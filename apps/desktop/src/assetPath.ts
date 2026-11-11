// Maps URLs of the app's own schemes to files below an allow-listed root. Pure path logic; the protocol handlers add a
// symlink check before reading.
import { extname, resolve, sep } from "node:path";

export const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export const BUNDLE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ...IMAGE_CONTENT_TYPES,
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Which URLs a root answers to and which file types it serves. */
export interface ServedRoot {
  readonly scheme: string;
  readonly host: string;
  readonly directory: string;
  readonly contentTypes: Readonly<Record<string, string>>;
}

export interface ResolvedAsset {
  readonly filePath: string;
  readonly contentType: string;
}

export function isInsideDirectory(root: string, candidate: string): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return candidate.startsWith(prefix);
}

/** Returns the file for a URL, or undefined when the URL is malformed, not allow-listed or escapes the root. */
export function resolveServedUrl(url: string, served: ServedRoot): ResolvedAsset | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${served.scheme}:` || parsed.hostname !== served.host) return undefined;
  if (parsed.username || parsed.password || parsed.port) return undefined;

  let relative: string;
  try {
    relative = decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }
  // Reject anything that is not a plain forward-slash path, before the platform resolver gets to interpret it.
  if (relative.includes("\0") || relative.includes("\\") || /%2f|%5c/i.test(parsed.pathname)) return undefined;
  const segments = relative.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) return undefined;

  const root = resolve(served.directory);
  const filePath = resolve(root, ...segments);
  if (!isInsideDirectory(root, filePath)) return undefined;
  const contentType = served.contentTypes[extname(filePath).toLowerCase()];
  return contentType ? { filePath, contentType } : undefined;
}
