import { describe, expect, it } from "vitest";
import { LIMITS, type ProjectData } from "../src/ipc.ts";
import { manifestFileContent, parseBoolean, parseCircuitFileName, parseManifest, parseManifestFile, parseProjectData, parseProjectPath, parseRecentProjects, parseSaveProjectRequest, resolveInsideProject, ValidationError } from "../src/validation.ts";

const manifest = { formatVersion: 1, name: "Demo", gameVersion: "2.1.24", modules: ["base", "space-age"], customSignalGroups: [], circuits: ["main.face"] };
const data: ProjectData = { manifest: { ...manifest, formatVersion: 1 }, files: [{ name: "main.face", source: 'circuit "Demo" {\n}\n' }] };

describe("project paths", () => {
  it("accepts absolute, normalized paths", () => {
    expect(parseProjectPath("/Users/someone/projects/demo")).toBe("/Users/someone/projects/demo");
    expect(parseProjectPath("/Users/someone/projects/demo/")).toBe("/Users/someone/projects/demo");
    expect(parseProjectPath("/")).toBe("/");
  });

  it.each([["relative/path"], ["./demo"], ["../demo"], [""], ["/a/../b"], ["/a/./b"], ["/a//b"], ["/a/b\0c"], ["~/demo"], [42], [null], [undefined], [{}], [["/a"]], ["/" + "a".repeat(LIMITS.pathLength)]])("rejects %j", (value) => {
    expect(() => parseProjectPath(value)).toThrow(ValidationError);
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

  it("resolves names directly inside the project directory", () => {
    expect(resolveInsideProject("/projects/demo", "main.face")).toBe("/projects/demo/main.face");
    expect(() => resolveInsideProject("/projects/demo", "../other/main.face")).toThrow(ValidationError);
    expect(() => resolveInsideProject("projects/demo", "main.face")).toThrow(ValidationError);
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
    expect(parseSaveProjectRequest({ path: "/projects/demo", data }).path).toBe("/projects/demo");
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

  it("rejects save requests with a relative or missing path", () => {
    expect(() => parseSaveProjectRequest({ path: "demo", data })).toThrow(ValidationError);
    expect(() => parseSaveProjectRequest({ data })).toThrow(ValidationError);
    expect(() => parseSaveProjectRequest("save")).toThrow(ValidationError);
  });

  it("checks booleans strictly", () => {
    expect(parseBoolean(true, "flag")).toBe(true);
    expect(() => parseBoolean("true", "flag")).toThrow(ValidationError);
  });
});

describe("recent projects file", () => {
  const entry = { path: "/projects/demo", name: "Demo", openedAt: "2026-11-11T12:00:00.000Z" };

  it("keeps valid entries and drops malformed ones and duplicates", () => {
    const parsed = parseRecentProjects([entry, { ...entry, path: "relative" }, { ...entry, openedAt: "yesterday" }, entry, "junk", null, { ...entry, path: "/projects/other" }]);
    expect(parsed).toEqual([entry, { ...entry, path: "/projects/other" }]);
  });

  it("returns an empty list for anything that is not an array and caps the length", () => {
    expect(parseRecentProjects({ entry })).toEqual([]);
    expect(parseRecentProjects(Array.from({ length: 50 }, (_, i) => ({ ...entry, path: `/projects/p${i}` })))).toHaveLength(LIMITS.recentProjects);
  });
});
