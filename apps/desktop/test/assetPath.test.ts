import { describe, expect, it } from "vitest";
import { BUNDLE_CONTENT_TYPES, IMAGE_CONTENT_TYPES, isInsideDirectory, resolveServedUrl, type ServedRoot } from "../src/assetPath.ts";
import { profilePathsFromEnv, projectsDirectoryFromEnv, resolveAssetRoot } from "../src/paths.ts";

const ROOT = "/repo/packages/catalog/generated";
const CATALOG: ServedRoot = { scheme: "face-asset", host: "catalog", directory: ROOT, contentTypes: IMAGE_CONTENT_TYPES };
const BUNDLE: ServedRoot = { scheme: "face-app", host: "bundle", directory: "/repo/dist/renderer", contentTypes: BUNDLE_CONTENT_TYPES };
const resolveAssetUrl = (url: string, _root: string) => resolveServedUrl(url, CATALOG);

describe("face-asset URLs", () => {
  it("maps catalog URLs to files below the root", () => {
    expect(resolveAssetUrl("face-asset://catalog/icons/item/iron-plate.png", ROOT)).toEqual({ filePath: `${ROOT}/icons/item/iron-plate.png`, contentType: "image/png" });
    expect(resolveAssetUrl("face-asset://catalog/icons/My%20Icon.WEBP", ROOT)).toEqual({ filePath: `${ROOT}/icons/My Icon.WEBP`, contentType: "image/webp" });
    expect(resolveAssetUrl("face-asset://catalog/a.svg?cache=1#x", ROOT)?.filePath).toBe(`${ROOT}/a.svg`);
  });

  it.each([
    ["encoded slash", "face-asset://catalog/icons%2f..%2f..%2fsecret.png"],
    ["backslash traversal", "face-asset://catalog/icons/..%5c..%5csecret.png"],
    ["NUL byte", "face-asset://catalog/icons/a%00.png"],
    ["unknown host", "face-asset://project/icon.png"],
    ["empty host", "face-asset:///icons/a.png"],
    ["other scheme", "file:///etc/passwd"],
    ["http", "https://catalog/icons/a.png"],
    ["credentials", "face-asset://user:pw@catalog/icons/a.png"],
    ["port", "face-asset://catalog:8080/icons/a.png"],
    ["root itself", "face-asset://catalog/"],
    ["not an image", "face-asset://catalog/manifest.json"],
    ["no extension", "face-asset://catalog/icons/item"],
    ["malformed escape", "face-asset://catalog/icons/%zz.png"],
    ["not a URL", "icons/a.png"],
  ])("rejects %s", (_name, url) => {
    expect(resolveAssetUrl(url, ROOT)).toBeUndefined();
  });

  // The URL parser removes dot segments before the path is looked at, so these cannot climb out of the root:
  // they resolve to a file inside it (which then simply does not exist).
  it.each([
    ["path traversal", "face-asset://catalog/../secret.png", `${ROOT}/secret.png`],
    ["nested traversal", "face-asset://catalog/icons/../../../../secret.png", `${ROOT}/secret.png`],
    ["encoded traversal", "face-asset://catalog/icons/%2e%2e/%2E%2E/secret.png", `${ROOT}/secret.png`],
    ["double-encoded traversal stays a literal name", "face-asset://catalog/%252e%252e/secret.png", `${ROOT}/%2e%2e/secret.png`],
  ])("contains %s", (_name, url, expected) => {
    expect(resolveAssetUrl(url, ROOT)?.filePath).toBe(expected);
  });

  it("never yields a path outside the root, whatever the URL parser normalizes", () => {
    for (const url of ["face-asset://catalog/a/../../../etc/x.png", "face-asset://catalog/./../x.png", "face-asset://catalog//abs/x.png", "face-asset://catalog/a/%2e%2e%2f%2e%2e/x.png"]) {
      const resolved = resolveAssetUrl(url, ROOT);
      if (resolved) expect(isInsideDirectory(ROOT, resolved.filePath)).toBe(true);
    }
  });

  it("serves the renderer bundle from its own scheme and host only", () => {
    expect(resolveServedUrl("face-app://bundle/index.html", BUNDLE)).toEqual({ filePath: "/repo/dist/renderer/index.html", contentType: "text/html; charset=utf-8" });
    expect(resolveServedUrl("face-app://bundle/app.js", BUNDLE)?.contentType).toBe("text/javascript; charset=utf-8");
    expect(resolveServedUrl("face-app://bundle/../main.cjs", BUNDLE)).toBeUndefined();
    expect(resolveServedUrl("face-app://bundle/../../package.json", BUNDLE)).toBeUndefined();
    expect(resolveServedUrl("face-app://catalog/index.html", BUNDLE)).toBeUndefined();
    expect(resolveServedUrl("face-asset://catalog/index.html", BUNDLE)).toBeUndefined();
    expect(resolveServedUrl("face-asset://catalog/app.js", CATALOG)).toBeUndefined();
  });

  it("does not treat a sibling directory with the same prefix as inside", () => {
    expect(isInsideDirectory("/repo/generated", "/repo/generated-evil/a.png")).toBe(false);
    expect(isInsideDirectory("/repo/generated", "/repo/generated/a.png")).toBe(true);
    expect(isInsideDirectory("/repo/generated", "/repo/generated")).toBe(false);
  });
});

describe("profile and asset locations", () => {
  it("derives all profile directories from FACE_USER_DATA", () => {
    expect(profilePathsFromEnv({ FACE_USER_DATA: "/repo/.runtime/user-data" })).toEqual({
      userData: "/repo/.runtime/user-data",
      sessionData: "/repo/.runtime/user-data/session",
      logs: "/repo/.runtime/user-data/logs",
      crashDumps: "/repo/.runtime/user-data/crashes",
    });
  });

  it("leaves the defaults alone when the variable is unset and refuses relative paths", () => {
    expect(profilePathsFromEnv({})).toBeUndefined();
    expect(profilePathsFromEnv({ FACE_USER_DATA: "" })).toBeUndefined();
    expect(() => profilePathsFromEnv({ FACE_USER_DATA: ".runtime/user-data" })).toThrow(/absolute/);
  });

  it("takes the dialog start folder from FACE_PROJECTS_DIR and refuses relative paths", () => {
    expect(projectsDirectoryFromEnv({ FACE_PROJECTS_DIR: "/repo/projects/" })).toBe("/repo/projects/");
    expect(projectsDirectoryFromEnv({})).toBeUndefined();
    expect(projectsDirectoryFromEnv({ FACE_PROJECTS_DIR: "" })).toBeUndefined();
    expect(() => projectsDirectoryFromEnv({ FACE_PROJECTS_DIR: "projects" })).toThrow(/absolute/);
  });

  it("picks the asset root from the environment, the repository or the bundle", () => {
    const base = { mainDirectory: "/repo/dist", resourcesPath: "/Applications/face.app/Contents/Resources" };
    expect(resolveAssetRoot({ ...base, env: { FACE_ASSET_ROOT: "/elsewhere/icons" }, packaged: false })).toBe("/elsewhere/icons");
    expect(resolveAssetRoot({ ...base, env: {}, packaged: false })).toBe("/repo/packages/catalog/generated");
    expect(resolveAssetRoot({ ...base, env: {}, packaged: true })).toBe("/Applications/face.app/Contents/Resources/catalog");
    expect(() => resolveAssetRoot({ ...base, env: { FACE_ASSET_ROOT: "icons" }, packaged: false })).toThrow(/absolute/);
  });
});
