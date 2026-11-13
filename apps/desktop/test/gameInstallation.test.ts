import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareGameVersion,
  dataDirectoryCandidates,
  detectInstallation,
  detectionCandidates,
  findInstallation,
  inspectDataDirectory,
  inspectGameFolder,
  inspectGameFolderInTime,
  installationCandidates,
  parseLibraryFolders,
  steamLibraryCandidates,
  steamRoots,
  withTimeout,
  type Host,
} from "../src/gameInstallation.ts";
import { readRegularFile } from "../src/regularFile.ts";
import { writeGameData } from "./support/fakeGame.ts";
import { useScratch } from "./support/scratch.ts";

const scratch = useScratch("game-installation");
const CATALOG = "2.1.24";
const mac: Host = { platform: "darwin", env: {}, home: "/Users/someone" };
const linux: Host = { platform: "linux", env: {}, home: "/home/someone" };
const windows: Host = { platform: "win32", env: { ProgramFiles: "D:\\Programs", "ProgramFiles(x86)": "D:\\Programs (x86)" }, home: "C:\\Users\\someone" };

describe("installation candidates", () => {
  it("lists the usual places on macOS", () => {
    expect(installationCandidates(mac)).toEqual([
      "/Applications/factorio.app",
      "/Users/someone/Applications/factorio.app",
      "/Users/someone/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app",
    ]);
  });

  it("lists the usual places on Windows, from the environment or the default folders", () => {
    expect(installationCandidates(windows)).toEqual(["D:\\Programs\\Factorio", "D:\\Programs (x86)\\Steam\\steamapps\\common\\Factorio", "C:\\GOG Games\\Factorio"]);
    expect(installationCandidates({ ...windows, env: {} })).toEqual(["C:\\Program Files\\Factorio", "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Factorio", "C:\\GOG Games\\Factorio"]);
    expect(steamRoots(windows)).toEqual(["D:\\Programs (x86)\\Steam"]);
  });

  it("lists the usual places on Linux", () => {
    expect(installationCandidates(linux)).toEqual([
      "/home/someone/.steam/steam/steamapps/common/Factorio",
      "/home/someone/.local/share/Steam/steamapps/common/Factorio",
      "/home/someone/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common/Factorio",
      "/home/someone/factorio",
      "/opt/factorio",
    ]);
  });

  it("knows no places on other platforms", () => {
    expect(installationCandidates({ ...linux, platform: "freebsd" })).toEqual([]);
    expect(steamRoots({ ...linux, platform: "freebsd" })).toEqual([]);
  });
});

describe("steam libraries", () => {
  const library = (folder: string, index: number): string => `\t"${index}"\n\t{\n\t\t"path"\t\t"${folder}"\n\t\t"label"\t\t""\n\t\t"apps"\n\t\t{\n\t\t\t"427520"\t\t"1"\n\t\t}\n\t}`;
  const vdf = (...folders: string[]): string => `"libraryfolders"\n{\n${folders.map(library).join("\n")}\n}\n`;

  it("reads the path lines of libraryfolders.vdf", () => {
    expect(parseLibraryFolders(vdf("/home/someone/.local/share/Steam", "/mnt/games/SteamLibrary"))).toEqual(["/home/someone/.local/share/Steam", "/mnt/games/SteamLibrary"]);
    expect(parseLibraryFolders(vdf("C:\\\\Program Files (x86)\\\\Steam", "D:\\\\Steam Library"))).toEqual(["C:\\Program Files (x86)\\Steam", "D:\\Steam Library"]);
    expect(parseLibraryFolders(vdf("/a", "/a", "/b").replaceAll("\n", "\r\n"))).toEqual(["/a", "/b"]);
    expect(parseLibraryFolders('"path" "/quoted \\"name\\""')).toEqual(['/quoted "name"']);
  });

  it("ignores everything that is not a path line", () => {
    expect(parseLibraryFolders("")).toEqual([]);
    expect(parseLibraryFolders("not a vdf file at all")).toEqual([]);
    expect(parseLibraryFolders('"label" "/x"\n"path" ""\n"path"\n"path" "/unterminated\n// "path" "/commented"\n"paths" "/other"')).toEqual([]);
    expect(parseLibraryFolders(vdf(...Array.from({ length: 100 }, (_, index) => `/lib${index}`)))).toHaveLength(32);
  });

  it("names the game's folder in each library", () => {
    const listed = vdf("/mnt/games/SteamLibrary", "relative/library", "/mnt/x/../y/");
    expect(steamLibraryCandidates(listed, linux)).toEqual(["/mnt/games/SteamLibrary/steamapps/common/Factorio", "/mnt/y/steamapps/common/Factorio"]);
    expect(steamLibraryCandidates(vdf("D:\\\\Steam Library", "/not/windows/../x"), windows)).toEqual(["D:\\Steam Library\\steamapps\\common\\Factorio", "\\not\\x\\steamapps\\common\\Factorio"]);
  });

  it("leaves out libraries on other volumes on macOS", () => {
    const text = vdf("/Users/someone/Library/Application Support/Steam", "/Volumes/Games/SteamLibrary", "/volumes/lower", "/Users/x/../../Volumes/Sneaky", "/Users/someone/Volumes/fine");
    expect(steamLibraryCandidates(text, mac)).toEqual([
      "/Users/someone/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app",
      "/Users/someone/Volumes/fine/steamapps/common/Factorio/factorio.app",
    ]);
    // Elsewhere a library on a mounted volume is an ordinary folder.
    expect(steamLibraryCandidates(vdf("/Volumes/Games/SteamLibrary"), linux)).toEqual(["/Volumes/Games/SteamLibrary/steamapps/common/Factorio"]);
  });

  it("adds the libraries listed below each Steam root to the usual places, once each", async () => {
    const home = scratch("steam-home");
    const host: Host = { platform: "linux", env: {}, home };
    expect(await detectionCandidates(host)).toEqual(installationCandidates(host));
    await mkdir(join(home, ".steam/steam/steamapps"), { recursive: true });
    await mkdir(join(home, ".local/share/Steam/steamapps"), { recursive: true });
    await writeFile(join(home, ".steam/steam/steamapps/libraryfolders.vdf"), vdf(join(home, ".steam/steam"), "/mnt/games/SteamLibrary"));
    await writeFile(join(home, ".local/share/Steam/steamapps/libraryfolders.vdf"), vdf("/mnt/games/SteamLibrary", "/mnt/more"));
    expect(await detectionCandidates(host)).toEqual([...installationCandidates(host), "/mnt/games/SteamLibrary/steamapps/common/Factorio", "/mnt/more/steamapps/common/Factorio"]);
    // A library file that is a folder, or absurdly large, is passed over.
    await rm(join(home, ".steam/steam/steamapps/libraryfolders.vdf"));
    await mkdir(join(home, ".steam/steam/steamapps/libraryfolders.vdf"));
    await writeFile(join(home, ".local/share/Steam/steamapps/libraryfolders.vdf"), vdf("/mnt/more") + " ".repeat(300_000));
    expect(await detectionCandidates(host)).toEqual(installationCandidates(host));
  });
});

describe("version comparison", () => {
  it("tells equal, same minor and different versions apart", () => {
    expect(compareGameVersion("2.1.24", "2.1.24")).toBe("equal");
    expect(compareGameVersion("2.1.30", "2.1.24")).toBe("same-minor");
    expect(compareGameVersion("2.1.3", "2.1.24")).toBe("same-minor");
    expect(compareGameVersion("2.0.24", "2.1.24")).toBe("different");
    expect(compareGameVersion("2.2.0", "2.1.24")).toBe("different");
    expect(compareGameVersion("3.1.24", "2.1.24")).toBe("different");
    expect(compareGameVersion("2.10.24", "2.1.24")).toBe("different");
  });
});

describe("data directory inspection", () => {
  it("accepts a full installation and reports its modules", async () => {
    const data = await writeGameData(scratch("full/data"));
    expect(await inspectDataDirectory(data, CATALOG)).toEqual({
      ok: true,
      installation: {
        dataDirectory: data,
        version: "2.1.24",
        versionMatch: "equal",
        modules: [{ name: "base", version: "2.1.24" }, { name: "core" }, ...["space-age", "quality", "elevated-rails", "recycler"].map((name) => ({ name, version: "2.1.24" }))],
      },
    });
  });

  it("reports only the modules that are there, and how the version compares", async () => {
    const data = await writeGameData(scratch("demo/data"), { version: "2.1.30", modules: ["quality"] });
    await mkdir(join(data, "space-age"));
    await mkdir(join(data, "recycler"));
    await writeFile(join(data, "recycler/info.json"), JSON.stringify({ name: "something-else", version: "2.1.30" }));
    const inspection = await inspectDataDirectory(data, CATALOG);
    const modules = [{ name: "base", version: "2.1.30" }, { name: "core" }, { name: "quality", version: "2.1.30" }];
    expect(inspection).toMatchObject({ ok: true, installation: { version: "2.1.30", versionMatch: "same-minor", modules } });
    expect(await inspectDataDirectory(await writeGameData(scratch("old/data"), { version: "2.0.72" }), CATALOG)).toMatchObject({ ok: true, installation: { versionMatch: "different" } });
  });

  it("rejects game data without images", async () => {
    const data = await writeGameData(scratch("headless/data"), { images: false });
    const inspection = await inspectDataDirectory(data, CATALOG);
    expect(inspection).toEqual({ ok: false, problem: "no-images", message: `This folder has the game's data but no images (a headless build, or a copy of the data alone): ${data}` });
    // A folder where the image should be is no image.
    await mkdir(join(data, "base/graphics/icons/signal/signal_A.png"), { recursive: true });
    expect(await inspectDataDirectory(data, CATALOG)).toMatchObject({ ok: false, problem: "no-images" });
  });

  it("rejects folders that are not the game's data", async () => {
    const empty = scratch("empty");
    await mkdir(empty);
    expect(await inspectDataDirectory(empty, CATALOG)).toEqual({ ok: false, problem: "not-game-data", message: `This folder does not contain the game's data: ${empty}` });
    expect(await inspectDataDirectory(scratch("absent"), CATALOG)).toEqual({ ok: false, problem: "not-found", message: `This folder does not exist or cannot be read: ${scratch("absent")}` });
    const file = scratch("a-file");
    await writeFile(file, "x");
    expect(await inspectDataDirectory(file, CATALOG)).toMatchObject({ ok: false, problem: "not-found" });
  });

  it.each<[string, (data: string) => Promise<unknown>]>([
    ["base is missing", (data) => rm(join(data, "base/info.json"))],
    ["core is missing", (data) => rm(join(data, "core/info.json"))],
    ["base has another name", (data) => writeFile(join(data, "base/info.json"), JSON.stringify({ name: "base-mod", version: "2.1.24" }))],
    ["core has another name", (data) => writeFile(join(data, "core/info.json"), JSON.stringify({ name: "base" }))],
    ["base has no version", (data) => writeFile(join(data, "base/info.json"), JSON.stringify({ name: "base" }))],
    ["the version has two parts", (data) => writeFile(join(data, "base/info.json"), JSON.stringify({ name: "base", version: "2.1" }))],
    ["the version is a number", (data) => writeFile(join(data, "base/info.json"), JSON.stringify({ name: "base", version: 2 }))],
    ["info.json is not JSON", (data) => writeFile(join(data, "base/info.json"), "{ name: base")],
    ["info.json is a list", (data) => writeFile(join(data, "base/info.json"), "[]")],
    ["info.json is null", (data) => writeFile(join(data, "base/info.json"), "null")],
    ["info.json is huge", (data) => writeFile(join(data, "base/info.json"), JSON.stringify({ name: "base", version: "2.1.24", padding: "x".repeat(100_000) }))],
    ["info.json is a folder", async (data) => {
      await rm(join(data, "base/info.json"));
      await mkdir(join(data, "base/info.json"));
    }],
  ])("rejects a data directory where %s", async (name, damage) => {
    const data = await writeGameData(scratch(`damaged-${name.replaceAll(/\W+/g, "-")}`, "data"));
    await damage(data);
    expect(await inspectDataDirectory(data, CATALOG)).toMatchObject({ ok: false, problem: "not-game-data" });
  });
});

describe("game folders", () => {
  it("names the four places the data directory can be", () => {
    expect(dataDirectoryCandidates("/games/factorio", "darwin")).toEqual(["/games/factorio", "/games/factorio/data", "/games/factorio/Contents/data", "/games/factorio/factorio.app/Contents/data"]);
    expect(dataDirectoryCandidates("C:\\Factorio", "win32")).toEqual(["C:\\Factorio", "C:\\Factorio\\data", "C:\\Factorio\\Contents\\data", "C:\\Factorio\\factorio.app\\Contents\\data"]);
  });

  it("accepts the data directory, the bundle's Contents, the bundle and the folder around it", async () => {
    const data = await writeGameData(scratch("mac/Factorio/factorio.app/Contents/data"));
    for (const folder of [data, scratch("mac/Factorio/factorio.app/Contents"), scratch("mac/Factorio/factorio.app"), scratch("mac/Factorio")]) {
      expect(await inspectGameFolder(folder, CATALOG, "darwin"), folder).toMatchObject({ ok: true, installation: { dataDirectory: data, version: "2.1.24" } });
    }
    expect(await inspectGameFolder(scratch("mac"), CATALOG, "darwin")).toMatchObject({ ok: false, problem: "not-game-data" });
  });

  it("accepts a game folder with a data directory, as on Windows and Linux", async () => {
    const data = await writeGameData(scratch("linux/factorio/data"));
    expect(await inspectGameFolder(scratch("linux/factorio"), CATALOG, "linux")).toMatchObject({ ok: true, installation: { dataDirectory: data } });
    expect(await inspectGameFolder(data, CATALOG, "linux")).toMatchObject({ ok: true, installation: { dataDirectory: data } });
  });

  it("follows a link to the installation", async () => {
    const data = await writeGameData(scratch("linked-target/data"));
    await symlink(scratch("linked-target"), scratch("linked"));
    expect(await inspectGameFolder(scratch("linked"), CATALOG, "linux")).toMatchObject({ ok: true, installation: { dataDirectory: scratch("linked/data") } });
    expect(data).toBe(scratch("linked-target/data"));
  });

  it("says why a folder is no installation", async () => {
    const headless = await writeGameData(scratch("server/factorio/data"), { images: false });
    const noImages = { ok: false, problem: "no-images", message: `This folder has the game's data but no images (a headless build, or a copy of the data alone): ${headless}` };
    expect(await inspectGameFolder(scratch("server/factorio"), CATALOG, "linux")).toEqual(noImages);
    expect(await inspectGameFolder(headless, CATALOG, "linux")).toMatchObject({ ok: false, problem: "no-images" });
    const server = scratch("server"), nowhere = scratch("nowhere");
    expect(await inspectGameFolder(server, CATALOG, "linux")).toEqual({ ok: false, problem: "not-game-data", message: `This folder does not contain the game's data: ${server}` });
    expect(await inspectGameFolder(nowhere, CATALOG, "linux")).toEqual({ ok: false, problem: "not-found", message: `This folder does not exist or cannot be read: ${nowhere}` });
    expect(await inspectGameFolder("relative/folder", CATALOG, "linux")).toMatchObject({ ok: false, problem: "not-found" });
    expect(await inspectGameFolder(`${headless}\0`, CATALOG, "linux")).toMatchObject({ ok: false, problem: "not-found" });
  });
});

describe("auto-detection", () => {
  it("takes the first folder that holds a full installation", async () => {
    const first = await writeGameData(scratch("find/first/data"), { version: "2.1.20" });
    await writeGameData(scratch("find/second/data"));
    await writeGameData(scratch("find/headless/data"), { images: false });
    const folders = [scratch("find/absent"), scratch("find/headless"), scratch("find/first"), scratch("find/second")];
    expect(await findInstallation(folders, CATALOG, "linux")).toMatchObject({ dataDirectory: first, version: "2.1.20", versionMatch: "same-minor" });
    expect(await findInstallation(Promise.resolve(folders.slice(0, 2)), CATALOG, "linux")).toBeUndefined();
    expect(await findInstallation([], CATALOG, "linux")).toBeUndefined();
  });

  it("looks through the usual places of the platform in order", async () => {
    const home = scratch("detect-home");
    const host: Host = { platform: "linux", env: {}, home };
    expect(await detectInstallation(host, CATALOG)).toBeUndefined();
    const plain = await writeGameData(join(home, "factorio/data"));
    expect(await detectInstallation(host, CATALOG)).toMatchObject({ dataDirectory: plain });
    const steam = await writeGameData(join(home, ".local/share/Steam/steamapps/common/Factorio/data"));
    expect(await detectInstallation(host, CATALOG)).toMatchObject({ dataDirectory: steam });
  });

  it("finds the game in a further Steam library", async () => {
    const home = scratch("library-home");
    const library = scratch("library-elsewhere");
    await mkdir(join(home, ".steam/steam/steamapps"), { recursive: true });
    await writeFile(join(home, ".steam/steam/steamapps/libraryfolders.vdf"), `"libraryfolders"\n{\n\t"1"\n\t{\n\t\t"path"\t\t"${library}"\n\t}\n}\n`);
    const data = await writeGameData(join(library, "steamapps/common/Factorio/data"));
    expect(await detectInstallation({ platform: "linux", env: {}, home }, CATALOG)).toMatchObject({ dataDirectory: data });
  });

  it("finds the application bundle in a Steam library on macOS", async () => {
    const home = scratch("mac-home");
    const data = await writeGameData(join(home, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/data"));
    const found = await detectInstallation({ platform: "darwin", env: {}, home }, CATALOG);
    // The real /Applications/factorio.app comes first on a machine that has the game.
    expect([data, "/Applications/factorio.app/Contents/data"]).toContain(found?.dataDirectory);
  });

  it("gives up at the deadline", async () => {
    const never = new Promise<string[]>(() => {});
    const started = Date.now();
    expect(await findInstallation(never, CATALOG, "linux", 30)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await withTimeout(new Promise<string>(() => {}), 10, () => "late")).toBe("late");
    expect(await withTimeout(Promise.resolve("done"), 10_000, () => "late")).toBe("done");
    await expect(withTimeout(Promise.reject(new Error("broken")), 10_000, () => "late")).rejects.toThrow("broken");
    const data = await writeGameData(scratch("in-time/data"));
    expect(await inspectGameFolderInTime(data, CATALOG, "linux")).toMatchObject({ ok: true });
    // Folders after the deadline are not looked at any more.
    expect(await findInstallation([data], CATALOG, "linux", 0)).toBeUndefined();
  });
});

describe("bounded file reads", () => {
  it("reads a regular file up to the limit", async () => {
    const file = scratch("bounded.bin");
    await writeFile(file, Uint8Array.from({ length: 1000 }, (_, index) => index % 251));
    const bytes = await readRegularFile(file, 1000);
    expect(bytes).toHaveLength(1000);
    expect(bytes[999]).toBe(999 % 251);
    await expect(readRegularFile(file, 999)).rejects.toThrow(/larger than 999 bytes/);
    await writeFile(scratch("empty.bin"), "");
    expect(await readRegularFile(scratch("empty.bin"), 10)).toHaveLength(0);
  });

  it("refuses folders, missing files and, when asked, links", async () => {
    await mkdir(scratch("bounded-dir"));
    await expect(readRegularFile(scratch("bounded-dir"), 1000)).rejects.toThrow();
    await expect(readRegularFile(scratch("bounded-missing"), 1000)).rejects.toThrow();
    await writeFile(scratch("bounded-target"), "content");
    await symlink(scratch("bounded-target"), scratch("bounded-link"));
    expect(new TextDecoder().decode(await readRegularFile(scratch("bounded-link"), 1000))).toBe("content");
    await expect(readRegularFile(scratch("bounded-link"), 1000, { noFollow: true })).rejects.toThrow();
    expect(new TextDecoder().decode(await readRegularFile(scratch("bounded-target"), 1000, { noFollow: true }))).toBe("content");
  });
});
