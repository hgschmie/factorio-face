import { describe, expect, it } from "vitest";
import { LIMITS, type ProjectData } from "../src/ipc.ts";
import {
  manifestFileContent,
  parseArchiveEntryName,
  parseBoolean,
  parseCircuitFileName,
  parseManifest,
  parseManifestFile,
  parseProjectData,
  parseProjectPath,
  parseRecentProjects,
  parseSaveProjectRequest,
  ValidationError,
  withProjectExtension,
} from "../src/validation.ts";

const manifest = { formatVersion: 1, name: "Demo", gameVersion: "2.1.24", modules: ["base", "space-age"], customSignalGroups: [], circuits: ["main.face"] };
const data: ProjectData = { manifest: { ...manifest, formatVersion: 1 }, files: [{ name: "main.face", source: 'circuit "Demo" {\n}\n' }] };

describe("project paths", () => {
  it("accepts absolute, normalized paths of project files", () => {
    for (const path of ["/Users/someone/projects/demo.faceproj", "/Users/someone/My circuits/a.b.faceproj", "/demo.FACEPROJ"]) expect(parseProjectPath(path)).toBe(path);
  });

  it.each([
    ["relative/demo.faceproj"],
    ["./demo.faceproj"],
    ["../demo.faceproj"],
    [""],
    ["/a/../b.faceproj"],
    ["/a/./b.faceproj"],
    ["/a//b.faceproj"],
    ["/a/b\0c.faceproj"],
    ["~/demo.faceproj"],
    [42],
    [null],
    [undefined],
    [{}],
    [["/a.faceproj"]],
    ["/" + "a".repeat(LIMITS.pathLength) + ".faceproj"],
  ])("rejects %j", (value) => {
    expect(() => parseProjectPath(value)).toThrow(ValidationError);
  });

  const notProjectFiles = ["/Users/someone/projects/demo", "/projects/demo/", "/", "/etc/passwd", "/a/demo.faceproj/", "/a/demo.faceproj.txt", "/a/demo.zip", "/a/.faceproj", "/a/faceproj"];
  it.each(notProjectFiles.map((path) => [path]))("rejects %j, which does not name a project file", (value) => {
    expect(() => parseProjectPath(value)).toThrow(/Not a face project file/);
  });

  it("appends the extension only where it is missing", () => {
    expect(withProjectExtension("/projects/demo")).toBe("/projects/demo.faceproj");
    expect(withProjectExtension("/projects/demo.v2")).toBe("/projects/demo.v2.faceproj");
    expect(withProjectExtension("/projects/demo.faceproj")).toBe("/projects/demo.faceproj");
    expect(withProjectExtension("/projects/demo.FaceProj")).toBe("/projects/demo.FaceProj");
    expect(parseProjectPath(withProjectExtension("/projects/demo"))).toBe("/projects/demo.faceproj");
  });
});

describe("circuit file names", () => {
  it("accepts plain .face names", () => {
    for (const name of ["main.face", "My circuit 2.face", "a_b-c.v2.face"]) expect(parseCircuitFileName(name)).toBe(name);
  });

  it.each([["../main.face"], ["sub/main.face"], ["sub\\main.face"], ["/etc/main.face"], [".face"], [".hidden.face"], ["main.txt"], ["main.face "], ["a..b.face"], ["main.face\n"], ["nul\0.face"], ["x".repeat(200) + ".face"], [7]])(
    "rejects %j",
    (value) => {
      expect(() => parseCircuitFileName(value)).toThrow(ValidationError);
    },
  );
});

describe("project file entry names", () => {
  it("accepts root entries and tolerates entries below assets/", () => {
    for (const name of ["face.json", "main.face", "notes.txt", ".DS_Store", "assets"]) expect(parseArchiveEntryName(name)).toBe("root");
    for (const name of ["assets/", "assets/icon.png", "assets/sub/icon.png"]) expect(parseArchiveEntryName(name)).toBe("assets");
  });

  const unsafe = ["", "../main.face", "..", "a..b.face", "sub/main.face", "sub/", "/main.face", "/assets/icon.png", "sub\\main.face", "C:main.face", "c:\\main.face", "main\0.face"];
  const unsafeAssets = ["assets/../main.face", "assets/..\\x", "Assets/icon.png", "assets/a\0b"];
  it.each([...unsafe, ...unsafeAssets].map((name) => [name]))("rejects %j", (name) => {
    expect(() => parseArchiveEntryName(name)).toThrow(ValidationError);
  });

  it("does not repeat an oversized name in the message", () => {
    expect(() => parseArchiveEntryName("/" + "x".repeat(60_000))).toThrow(/^.{0,200}$/);
  });
});

describe("manifest", () => {
  it("accepts a valid manifest and drops unknown fields that arrive over IPC", () => {
    expect(parseManifest({ ...manifest, extra: "ignored" })).toEqual(manifest);
    expect(parseManifest({ ...manifest, extras: {} })).toEqual(manifest);
  });

  it("keeps unknown top-level fields of face.json in extras and writes them back at the top level", () => {
    const onDisk = { ...manifest, layout: { zoom: 1.5, panels: ["dock", null] }, futureFlag: true, extras: "a field that happens to be called extras" };
    const parsed = parseManifestFile(onDisk);
    expect(parsed).toEqual({ ...manifest, extras: { layout: { zoom: 1.5, panels: ["dock", null] }, futureFlag: true, extras: "a field that happens to be called extras" } });
    expect(manifestFileContent(parsed)).toEqual(onDisk);
    // The in-memory form survives the IPC validation unchanged, and a file without unknown fields has no extras.
    expect(parseManifest(parsed)).toEqual(parsed);
    expect(parseManifestFile(manifest)).toEqual(manifest);
    expect(Object.keys(manifestFileContent(parsed)).slice(0, 6)).toEqual(["formatVersion", "name", "gameVersion", "modules", "customSignalGroups", "circuits"]);
  });

  it("keeps a __proto__ field as data without touching any prototype", () => {
    const parsed = parseManifestFile(JSON.parse(`{ "formatVersion": 1, "name": "Demo", "gameVersion": "2.1.24", "modules": [], "circuits": ["main.face"], "__proto__": { "polluted": true }, "nested": { "__proto__": { "polluted": true } } }`));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((parsed as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed.extras!)).toEqual(["__proto__", "nested"]);
    expect(JSON.stringify(manifestFileContent(parsed))).toContain('"__proto__":{"polluted":true}');
  });

  it("validates known fields of face.json as strictly as before", () => {
    expect(() => parseManifestFile({ ...manifest, circuits: ["../main.face"], note: "x" })).toThrow(ValidationError);
    expect(() => parseManifestFile({ ...manifest, formatVersion: 2 })).toThrow(ValidationError);
    expect(() => parseManifestFile([])).toThrow(ValidationError);
  });

  it.each([
    ["extras that are not an object", { ...manifest, extras: ["x"] }],
    ["extras that redefine a known field", { ...manifest, extras: { name: "Other" } }],
    ["extras with a function", { ...manifest, extras: { run: () => 1 } }],
    ["extras with a non-finite number", { ...manifest, extras: { value: Number.POSITIVE_INFINITY } }],
    ["extras with a class instance", { ...manifest, extras: { when: new Date(0) } }],
    ["extras with an empty field name", { ...manifest, extras: { "": 1 } }],
    ["extras with a control character in a field name", { ...manifest, extras: { "a\u0000b": 1 } }],
    ["extras nested too deeply", { ...manifest, extras: { deep: Array.from({ length: LIMITS.manifestExtrasDepth + 2 }).reduce<unknown>((inner) => [inner], 1) } }],
    ["oversized extras", { ...manifest, extras: { blob: "x".repeat(LIMITS.manifestBytes) } }],
  ])("rejects %s", (_name, value) => {
    expect(() => parseManifest(value)).toThrow(ValidationError);
  });

  it("takes an optional wire reach from 0 (unlimited) to 64 tiles, fractions included, and leaves an absent one absent", () => {
    expect(parseManifest(manifest)).not.toHaveProperty("wireReach");
    expect(parseManifestFile(manifest)).not.toHaveProperty("wireReach");
    for (const wireReach of [0, 0.5, 9, 12.5, 64]) {
      expect(parseManifest({ ...manifest, wireReach })).toEqual({ ...manifest, wireReach });
      // In face.json it is a known field, not one of the unknown ones, and it is written back after the others.
      const parsed = parseManifestFile({ ...manifest, wireReach, later: true });
      expect(parsed).toEqual({ ...manifest, wireReach, extras: { later: true } });
      expect(Object.keys(manifestFileContent(parsed))).toEqual(["formatVersion", "name", "gameVersion", "modules", "customSignalGroups", "circuits", "wireReach", "later"]);
    }
  });

  it.each([
    ["below the range", -1],
    ["just below the range", -0.5],
    ["above the range", 64.5],
    ["the old maximum", 100],
    ["not finite", Number.POSITIVE_INFINITY],
    ["not a number", Number.NaN],
    ["a string", "9"],
    ["null", null],
    ["an array", [9]],
  ])("rejects a wire reach that is %s", (_name, wireReach) => {
    expect(() => parseManifest({ ...manifest, wireReach })).toThrow("Wire reach must be a number from 0 to 64");
    expect(() => parseManifestFile({ ...manifest, wireReach })).toThrow(ValidationError);
    expect(() => parseManifest({ ...manifest, extras: { wireReach } })).toThrow(ValidationError);
  });

  it("accepts custom signal groups", () => {
    const groups = [{ id: "g1", name: "Mine", enabled: true, signals: [{ name: "alpha", icon: "alpha.png" }, { name: "beta" }] }];
    expect(parseManifest({ ...manifest, customSignalGroups: groups }).customSignalGroups).toEqual(groups);
    expect(() => parseManifest({ ...manifest, customSignalGroups: [{ id: "g1", name: "Mine", enabled: true, signals: [{ name: "alpha", icon: "../alpha.png" }] }] })).toThrow(ValidationError);
  });

  it.each([
    ["wrong version", { ...manifest, formatVersion: 2 }],
    ["missing name", { ...manifest, name: undefined }],
    ["empty name", { ...manifest, name: "" }],
    ["oversized name", { ...manifest, name: "n".repeat(LIMITS.projectNameLength + 1) }],
    ["control characters in name", { ...manifest, name: "a\u0007b" }],
    ["circuits not an array", { ...manifest, circuits: "main.face" }],
    ["traversal in circuits", { ...manifest, circuits: ["../main.face"] }],
    ["duplicate circuits ignoring case", { ...manifest, circuits: ["main.face", "MAIN.face"] }],
    ["too many circuits", { ...manifest, circuits: Array.from({ length: LIMITS.circuitFiles + 1 }, (_, i) => `c${i}.face`) }],
    ["non-string module", { ...manifest, modules: [1] }],
    ["not an object", "manifest"],
    ["null", null],
  ])("rejects %s", (_name, value) => {
    expect(() => parseManifest(value)).toThrow(ValidationError);
  });
});

describe("project data and save requests", () => {
  it("accepts matching manifest and files", () => {
    expect(parseProjectData(data)).toEqual(data);
    expect(parseSaveProjectRequest({ path: null, data })).toEqual({ path: null, data });
    expect(parseSaveProjectRequest({ path: "/projects/demo.faceproj", data }).path).toBe("/projects/demo.faceproj");
  });

  it("rejects files that the manifest does not list, missing files and duplicates", () => {
    expect(() => parseProjectData({ manifest, files: [...data.files, { name: "extra.face", source: "" }] })).toThrow(ValidationError);
    expect(() => parseProjectData({ manifest, files: [] })).toThrow(ValidationError);
    expect(() => parseProjectData({ manifest: { ...manifest, circuits: ["main.face", "b.face"] }, files: [data.files[0], data.files[0]] })).toThrow(ValidationError);
    expect(() => parseProjectData({ manifest, files: [{ name: "../main.face", source: "" }] })).toThrow(ValidationError);
  });

  it("bounds the source size and requires string sources", () => {
    expect(() => parseProjectData({ manifest, files: [{ name: "main.face", source: "x".repeat(LIMITS.circuitSourceLength + 1) }] })).toThrow(/too large/);
    expect(() => parseProjectData({ manifest, files: [{ name: "main.face", source: 5 }] })).toThrow(ValidationError);
  });

  it("rejects save requests with a relative or missing path, or one that is not a project file", () => {
    expect(() => parseSaveProjectRequest({ path: "demo.faceproj", data })).toThrow(ValidationError);
    expect(() => parseSaveProjectRequest({ path: "/projects/demo", data })).toThrow(ValidationError);
    expect(() => parseSaveProjectRequest({ path: "/Users/someone/.zshrc", data })).toThrow(ValidationError);
    expect(() => parseSaveProjectRequest({ data })).toThrow(ValidationError);
    expect(() => parseSaveProjectRequest("save")).toThrow(ValidationError);
  });

  it("checks booleans strictly", () => {
    expect(parseBoolean(true, "flag")).toBe(true);
    expect(() => parseBoolean("true", "flag")).toThrow(ValidationError);
  });
});

describe("recent projects file", () => {
  const entry = { path: "/projects/demo.faceproj", name: "Demo", openedAt: "2026-11-11T12:00:00.000Z" };

  it("keeps valid entries and drops malformed ones and duplicates", () => {
    const parsed = parseRecentProjects([entry, { ...entry, path: "relative" }, { ...entry, openedAt: "yesterday" }, entry, "junk", null, { ...entry, path: "/projects/other.faceproj" }]);
    expect(parsed).toEqual([entry, { ...entry, path: "/projects/other.faceproj" }]);
  });

  it("keeps an entry that points at a project directory of the dropped format; opening it reports the problem", () => {
    const old = { ...entry, path: "/projects/old-directory" };
    expect(parseRecentProjects([old])).toEqual([old]);
    expect(() => parseProjectPath(old.path)).toThrow(/Not a face project file/);
  });

  it("returns an empty list for anything that is not an array and caps the length", () => {
    expect(parseRecentProjects({ entry })).toEqual([]);
    expect(parseRecentProjects(Array.from({ length: 50 }, (_, i) => ({ ...entry, path: `/projects/p${i}.faceproj` })))).toHaveLength(LIMITS.recentProjects);
  });
});
