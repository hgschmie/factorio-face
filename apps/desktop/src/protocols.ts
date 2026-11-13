// The app's two private schemes. face-app:// serves the renderer bundle from one allow-listed directory. face-asset://
// serves catalog icons: rendered from the user's installation of the game, or files of a second allow-listed directory.
// Nothing else is reachable; what a request gets is decided in assetHandler.ts.
import { protocol } from "electron";
import { assetHandler, fileHandler, type InstallationIcons } from "./assetHandler.ts";
import { BUNDLE_CONTENT_TYPES, IMAGE_CONTENT_TYPES, type ServedRoot } from "./assetPath.ts";
import { APP_HOST, APP_SCHEME, ASSET_HOST_CATALOG, ASSET_SCHEME } from "./ipc.ts";

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

/** Must run after app `ready`. `icons` are the catalog icons of the user's installation of the game. */
export function handleSchemes(rendererDirectory: string, assetRoot: string, icons?: InstallationIcons): void {
  const bundle: ServedRoot = { scheme: APP_SCHEME, host: APP_HOST, directory: rendererDirectory, contentTypes: BUNDLE_CONTENT_TYPES };
  const assets: ServedRoot = { scheme: ASSET_SCHEME, host: ASSET_HOST_CATALOG, directory: assetRoot, contentTypes: IMAGE_CONTENT_TYPES };
  protocol.handle(APP_SCHEME, fileHandler(bundle, { "content-security-policy": CONTENT_SECURITY_POLICY }));
  protocol.handle(ASSET_SCHEME, assetHandler(assets, icons));
}
