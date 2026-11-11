// The app's two private schemes. face-app:// serves the renderer bundle, face-asset:// serves catalog icons; each
// from one allow-listed directory, and nothing outside those directories is reachable.
import { protocol } from "electron";
import { readFile, realpath, stat } from "node:fs/promises";
import { BUNDLE_CONTENT_TYPES, IMAGE_CONTENT_TYPES, isInsideDirectory, resolveServedUrl, type ServedRoot } from "./assetPath.ts";
import { APP_HOST, APP_SCHEME, ASSET_HOST_CATALOG, ASSET_SCHEME } from "./ipc.ts";

const MAX_FILE_BYTES = 32 * 1024 * 1024;

export const RENDERER_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/**
 * Policy for the renderer document: local content only, no eval, no inline scripts. Inline styles are needed by
 * CodeMirror and React style attributes. index.html carries the same policy as a meta tag.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${ASSET_SCHEME}:`,
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'self'",
].join("; ");

/** Must run before app `ready`, and only once. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true } },
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

function serve(served: ServedRoot, extraHeaders: Readonly<Record<string, string>>): void {
  const notFound = (): Response => new Response(null, { status: 404 });
  protocol.handle(served.scheme, async (request) => {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const file = resolveServedUrl(request.url, served);
    if (!file) return notFound();
    try {
      // Resolve symlinks on both sides so a link inside the root cannot point outside it.
      const [realRoot, realFile] = await Promise.all([realpath(served.directory), realpath(file.filePath)]);
      if (!isInsideDirectory(realRoot, realFile)) return notFound();
      const info = await stat(realFile);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) return notFound();
      const body = await readFile(realFile);
      return new Response(new Uint8Array(body), { headers: { "content-type": file.contentType, "cache-control": "no-cache", "x-content-type-options": "nosniff", ...extraHeaders } });
    } catch {
      return notFound();
    }
  });
}

/** Must run after app `ready`. */
export function handleSchemes(rendererDirectory: string, assetRoot: string): void {
  serve({ scheme: APP_SCHEME, host: APP_HOST, directory: rendererDirectory, contentTypes: BUNDLE_CONTENT_TYPES }, { "content-security-policy": CONTENT_SECURITY_POLICY });
  serve({ scheme: ASSET_SCHEME, host: ASSET_HOST_CATALOG, directory: assetRoot, contentTypes: IMAGE_CONTENT_TYPES }, {});
}
