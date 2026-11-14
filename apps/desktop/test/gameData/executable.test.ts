import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { executablePath, locateGameExecutable } from "../../src/gameData/executable.ts";
import { useScratch } from "../support/scratch.ts";

const scratch = useScratch("game-executable");

async function program(file: string, mode = 0o755): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, "#!/bin/sh\n");
  await chmod(file, mode);
  return file;
}

async function dataDirectory(...segments: string[]): Promise<string> {
  const directory = scratch(...segments);
  await mkdir(directory, { recursive: true });
  return directory;
}

describe("executablePath", () => {
  it("is beside the data directory, per platform", () => {
    expect(executablePath("/Applications/factorio.app/Contents/data", "darwin")).toBe("/Applications/factorio.app/Contents/MacOS/factorio");
    expect(executablePath("/opt/factorio/data", "linux")).toBe("/opt/factorio/bin/x64/factorio");
    expect(executablePath("/games/Factorio/data", "win32")).toBe("/games/Factorio/bin/x64/factorio.exe");
    expect(executablePath("/opt/factorio/data", "freebsd")).toBeUndefined();
  });
});

describe("locateGameExecutable", () => {
  it("finds the program of a macOS application bundle", async () => {
    const data = await dataDirectory("mac", "factorio.app", "Contents", "data");
    const executable = await program(scratch("mac", "factorio.app", "Contents", "MacOS", "factorio"));
    expect(await locateGameExecutable(data, "darwin")).toEqual({ ok: true, executable, gameRoot: scratch("mac", "factorio.app", "Contents"), steam: false });
  });

  it("finds the program of a Linux installation", async () => {
    const data = await dataDirectory("linux", "factorio", "data");
    const executable = await program(scratch("linux", "factorio", "bin", "x64", "factorio"));
    expect(await locateGameExecutable(data, "linux")).toEqual({ ok: true, executable, gameRoot: scratch("linux", "factorio"), steam: false });
  });

  it("finds the program of a Windows installation, which needs no execute permission", async () => {
    const data = await dataDirectory("windows", "Factorio", "data");
    const executable = await program(scratch("windows", "Factorio", "bin", "x64", "factorio.exe"), 0o644);
    expect(await locateGameExecutable(data, "win32")).toEqual({ ok: true, executable, gameRoot: scratch("windows", "Factorio"), steam: false });
  });

  it("says so when an installation has data but no program", async () => {
    const data = await dataDirectory("data-only", "data");
    const location = await locateGameExecutable(data, "linux");
    expect(location).toMatchObject({ ok: false, problem: "no-executable" });
    expect(location.ok ? "" : location.message).toContain(scratch("data-only", "bin", "x64", "factorio"));
    // The program of another platform does not count, and neither does a folder of the program's name.
    await program(scratch("data-only", "bin", "x64", "factorio.exe"));
    await mkdir(scratch("data-only", "MacOS", "factorio"), { recursive: true });
    expect(await locateGameExecutable(data, "linux")).toMatchObject({ ok: false, problem: "no-executable" });
    expect(await locateGameExecutable(data, "darwin")).toMatchObject({ ok: false, problem: "no-executable" });
  });

  it("refuses a file it may not execute, and a platform without the game", async () => {
    const data = await dataDirectory("plain", "factorio", "data");
    await program(scratch("plain", "factorio", "bin", "x64", "factorio"), 0o644);
    expect(await locateGameExecutable(data, "linux")).toMatchObject({ ok: false, problem: "not-executable" });
    expect(await locateGameExecutable(data, "freebsd")).toMatchObject({ ok: false, problem: "unsupported-platform" });
  });

  it("names the program a link leads to, and recognises a Steam library by either path", async () => {
    const real = await program(scratch("elsewhere", "factorio-real"));
    const data = await dataDirectory("linked", "steamapps", "common", "Factorio", "data");
    await mkdir(scratch("linked", "steamapps", "common", "Factorio", "bin", "x64"), { recursive: true });
    await symlink(real, scratch("linked", "steamapps", "common", "Factorio", "bin", "x64", "factorio"));
    expect(await locateGameExecutable(data, "linux")).toMatchObject({ ok: true, executable: real, steam: true });
    const steamData = await dataDirectory("library", "SteamApps", "common", "Factorio", "data");
    const executable = await program(scratch("library", "SteamApps", "common", "Factorio", "bin", "x64", "factorio"));
    expect(await locateGameExecutable(steamData, "linux")).toMatchObject({ ok: true, executable, steam: true });
  });
});
