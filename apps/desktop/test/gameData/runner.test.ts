import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gameCommand, runEnvironment, runGameDump, sanitiseOutput, RUNNER_DEFAULTS, SANDBOX_EXEC, type GameRunOptions, type RunProgress } from "../../src/gameData/runner.ts";
import { buildPrivateModDirectory, readUserMods } from "../../src/gameData/userMods.ts";
import { FAKE_GAME_VERSION, fakeGameStarts, writeCannedDump, writeFakeGame, type FakeGameControl, type FakeGameStart } from "../support/cannedDump.ts";
import { useScratch } from "../support/scratch.ts";
import { treeSnapshot } from "../support/treeSnapshot.ts";

const scratch = useScratch("game-runner");
const SCENARIO = "-- the scenario\n";
const canSandbox = process.platform === "darwin" && spawnSync(SANDBOX_EXEC, ["-p", "(version 1)(allow default)", "/usr/bin/true"]).status === 0;

interface Fixture {
  readonly control: FakeGameControl;
  readonly runs: string;
  readonly options: GameRunOptions<string[]>;
  starts(): Promise<FakeGameStart[]>;
}

/** A fake game of its own for a test, and the options to run it without the sandbox. */
async function fixture(name: string, behaviour: Partial<FakeGameControl> = {}, more: Partial<GameRunOptions<string[]>> = {}): Promise<Fixture> {
  await mkdir(scratch(name), { recursive: true });
  const control: FakeGameControl = { record: scratch(name, "record.jsonl"), dump: await writeCannedDump(scratch(name, "dump")), ...behaviour };
  const executable = await writeFakeGame(scratch(name, "factorio"), control);
  const runs = scratch(name, "runs");
  const options: GameRunOptions<string[]> = {
    executable, dataDirectory: scratch(name, "data"), runsDirectory: runs, platform: process.platform, scenarioSource: SCENARIO, sandbox: "off",
    collect: async (scriptOutput) => (await readdir(scriptOutput)).sort(),
    ...more,
  };
  return { control, runs, options, starts: () => fakeGameStarts(control) };
}

describe("command and environment", () => {
  it("starts the game itself, or sandbox-exec around it", () => {
    expect(gameCommand("/game/factorio", ["--dump-data"], undefined)).toEqual({ program: "/game/factorio", args: ["--dump-data"] });
    expect(gameCommand("/game/factorio", ["--dump-data"], "/run/sandbox.sb")).toEqual({ program: "/usr/bin/sandbox-exec", args: ["-f", "/run/sandbox.sb", "/game/factorio", "--dump-data"] });
  });

  it("has an environment of its own per platform, with the Steam application id for a Steam build", () => {
    expect(runEnvironment({ platform: "darwin", home: "/run/home", tmp: "/run/tmp" })).toEqual({ PATH: "/usr/bin:/bin", HOME: "/run/home", CFFIXED_USER_HOME: "/run/home", TMPDIR: "/run/tmp/", LANG: "en_US.UTF-8" });
    expect(runEnvironment({ platform: "linux", home: "/run/home", tmp: "/run/tmp", steam: true })).toEqual({
      PATH: "/usr/bin:/bin", HOME: "/run/home", TMPDIR: "/run/tmp/", LANG: "C.UTF-8", XDG_CONFIG_HOME: "/run/home/.config", XDG_DATA_HOME: "/run/home/.local/share", XDG_CACHE_HOME: "/run/home/.cache",
      SteamAppId: "427520", SteamGameId: "427520",
    });
    expect(runEnvironment({ platform: "win32", home: "C:\\run\\home", tmp: "C:\\run\\tmp", systemRoot: "D:\\Windows" })).toEqual({
      SystemRoot: "D:\\Windows", windir: "D:\\Windows", PATH: "D:\\Windows\\System32;D:\\Windows", USERPROFILE: "C:\\run\\home", APPDATA: "C:\\run\\home\\AppData\\Roaming", LOCALAPPDATA: "C:\\run\\home\\AppData\\Local",
      TEMP: "C:\\run\\tmp", TMP: "C:\\run\\tmp",
    });
  });

  it("makes output safe to show", () => {
    const bytes = new Uint8Array([...Buffer.from("\u001b[31mred\u001b[0m bell\u0007 nul\u0000 tab\there\r\nnext "), 0xff, 0xfe]);
    expect(sanitiseOutput(bytes)).toBe("red bell? nul? tab\there\nnext \ufffd\ufffd");
  });
});

describe("runGameDump with a fake game", () => {
  it("runs the three commands with fixed arguments in a private folder and an environment of its own, and removes the folder", async () => {
    const progress: RunProgress[] = [];
    const { options, runs, starts } = await fixture("success", {}, { onProgress: (event) => progress.push(event) });
    const result = await runGameDump(options);
    expect(result).toMatchObject({ ok: true, game: FAKE_GAME_VERSION, sandboxed: false, changed: [] });
    expect(result.ok && result.value).toEqual(["data-raw-dump.json", "entity-locale.json", "face-runtime-dump.json", "item-group-locale.json", "item-locale.json"]);
    expect(result.steps.map(({ step }) => step)).toEqual(["prepare", "data", "locale", "runtime", "collect"]);

    const recorded = await starts();
    expect(recorded.map((start) => start.command)).toEqual(["data", "locale", "runtime"]);
    const game = recorded[0]!.cwd;
    expect(game).toMatch(new RegExp(`runs/run-[A-Za-z0-9]{6}/game$`));
    const run = join(game, "..");
    const common = ["--config", join(game, "config", "config.ini"), "--mod-directory", join(game, "mods"), "--no-log-rotation"];
    expect(recorded.map((start) => start.args)).toEqual([[...common, "--dump-data"], [...common, "--dump-prototype-locale"], [...common, "--test-scenario", "face-catalog-dump", "--test-ticks", "600"]]);
    for (const start of recorded) {
      expect(start.cwd).toBe(game);
      // The launcher's shell adds two variables and Node one on macOS; nothing of this process's environment is passed on.
      const { PWD: _pwd, SHLVL: _level, __CF_USER_TEXT_ENCODING: _encoding, ...env } = start.env;
      expect(env).toEqual(runEnvironment({ platform: process.platform, home: join(run, "home"), tmp: join(run, "tmp") }));
    }
    expect(await readdir(runs)).toEqual([]);

    expect(progress.map(({ step, state, index }) => `${index} ${step} ${state}`)).toEqual([
      "1 prepare started", "1 prepare finished", "2 data started", "2 data finished", "3 locale started", "3 locale finished", "4 runtime started", "4 runtime finished", "5 collect started", "5 collect finished",
    ]);
    expect(progress.every((event) => event.count === 5 && (event.state === "started") === (event.seconds === undefined))).toBe(true);
  });

  it("gives the game a configuration that keeps every write in the run's folder, and the scenario", async () => {
    const { options, runs } = await fixture("config", {}, { keep: true });
    expect(await runGameDump(options)).toMatchObject({ ok: true });
    const [run] = await readdir(runs);
    const game = join(runs, run!, "game");
    const config = await readFile(join(game, "config", "config.ini"), "utf8");
    expect(config).toContain(`[path]\nread-data=${options.dataDirectory}\nwrite-data=${game}\n`);
    expect(config).toContain("enable-crash-log-uploading=false\nenable-steam-networking=false\ndisable-blueprint-storage=true\n");
    expect(await readFile(join(game, "scenarios", "face-catalog-dump", "control.lua"), "utf8")).toBe(SCENARIO);
    expect((await readdir(join(runs, run!))).sort()).toEqual(["game", "home", "tmp"]);
    // The next run removes what an earlier one left behind.
    expect(await runGameDump({ ...options, keep: false })).toMatchObject({ ok: true });
    expect(await readdir(runs)).toEqual([]);
  });

  it("reports a game that ends with an error, with the end of its output", async () => {
    const { options, runs, starts } = await fixture("failure", { mode: "fail", at: "locale" });
    const result = await runGameDump(options);
    expect(result).toMatchObject({ ok: false, failure: "exit", step: "locale", message: "The game ended with exit code 3" });
    expect(result.ok ? "" : result.log).toMatch(/Factorio 2\.1\.24 \(build 87808.*\n.*\n.*Failed to load mods: something is wrong\n$/);
    expect((await starts()).map((start) => start.command)).toEqual(["data", "locale"]);
    expect(result.steps.map(({ step }) => step)).toEqual(["prepare", "data"]);
    expect(await readdir(runs)).toEqual([]);
  });

  it("stops a game that hangs at the step's deadline", async () => {
    const { options, runs, starts } = await fixture("timeout", { mode: "hang", at: "data" }, { stepTimeoutMs: 400 });
    const result = await runGameDump(options);
    expect(result).toMatchObject({ ok: false, failure: "timeout", step: "data" });
    expect(result.ok ? "" : result.message).toMatch(/did not finish within \d+ seconds and was stopped/);
    const [start] = await starts();
    expect(() => process.kill(start!.pid, 0)).toThrow(/ESRCH/);
    expect(await readdir(runs)).toEqual([]);
  });

  it("stops at the deadline of the whole run", async () => {
    const { options, starts } = await fixture("total", { mode: "hang", at: "locale" }, { stepTimeoutMs: 60_000, totalTimeoutMs: 1500 });
    const started = Date.now();
    expect(await runGameDump(options)).toMatchObject({ ok: false, failure: "timeout", step: "locale" });
    expect(Date.now() - started).toBeLessThan(10_000);
    const hanging = (await starts())[1]!;
    expect(() => process.kill(hanging.pid, 0)).toThrow(/ESRCH/);
  });

  it("can be cancelled while the game runs, and before it starts", async () => {
    const { options, runs, starts } = await fixture("cancel", { mode: "hang", at: "data" });
    const controller = new AbortController();
    const running = runGameDump({ ...options, signal: controller.signal });
    while ((await starts()).length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    expect(await running).toMatchObject({ ok: false, failure: "cancelled", step: "data" });
    const [start] = await starts();
    expect(() => process.kill(start!.pid, 0)).toThrow(/ESRCH/);
    expect(await readdir(runs)).toEqual([]);

    expect(await runGameDump({ ...options, signal: controller.signal })).toMatchObject({ ok: false, failure: "cancelled", step: "prepare" });
    expect(await starts()).toHaveLength(1);
  });

  it("stops a game that floods its output, and keeps only the end of it", async () => {
    const { options, runs } = await fixture("flood", { mode: "flood", at: "data" }, { outputLimitBytes: 256 * 1024 });
    const result = await runGameDump(options);
    expect(result).toMatchObject({ ok: false, failure: "output-limit", step: "data", message: "The game printed more than 262144 bytes and was stopped" });
    expect(result.ok ? 0 : result.log.length).toBeLessThanOrEqual(RUNNER_DEFAULTS.logTailBytes);
    expect(result.ok ? "" : result.log).toContain("the same line again");
    expect(await readdir(runs)).toEqual([]);
  });

  it("reports a game that ends well without its dump, with the scenario's own error when there is one", async () => {
    const silent = await fixture("no-output", { mode: "no-output", at: "data" });
    expect(await runGameDump(silent.options)).toMatchObject({ ok: false, failure: "no-output", step: "data", message: "The game ended without writing data-raw-dump.json" });
    expect(await runGameDump({ ...silent.options, steam: true })).toMatchObject({ message: "The game ended without writing data-raw-dump.json (a game from Steam may have handed over to the Steam client instead of running)" });
    const lua = await fixture("lua-error", { mode: "lua-error" });
    expect(await runGameDump(lua.options)).toMatchObject({ ok: false, failure: "no-output", step: "runtime", message: "The game ended without writing face-runtime-dump.json: attempt to index field 'quality' (a nil value)" });
  });

  it("reports a program that cannot be started", async () => {
    const { options, runs } = await fixture("missing");
    const result = await runGameDump({ ...options, executable: scratch("missing", "no-such-program") });
    expect(result).toMatchObject({ ok: false, failure: "start", step: "data" });
    expect(result.ok ? "" : result.message).toMatch(/could not be started: .*ENOENT/);
    expect(await readdir(runs)).toEqual([]);
    expect(await runGameDump({ ...options, dataDirectory: "/data\nwrite-data=/elsewhere" })).toMatchObject({ ok: false, failure: "start", step: "prepare" });
  });

  it("shows the game's output with control characters taken out, and reads the version from the log when nothing is printed", async () => {
    const noisy = await fixture("noisy", { mode: "noisy" }, { collect: () => Promise.reject(new Error("not what was expected")) });
    expect(await runGameDump(noisy.options)).toMatchObject({ ok: false, failure: "invalid-dump", step: "collect", message: "not what was expected", log: "" });
    const failing = await fixture("noisy-failure", { mode: "noisy", at: "data" }, { steam: true });
    await writeFakeGame(failing.options.executable, { ...failing.control, mode: "fail" });
    const failed = await runGameDump(failing.options);
    expect(failed.ok ? "" : failed.log).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
    expect((await failing.starts())[0]!.env).toMatchObject({ SteamAppId: "427520", SteamGameId: "427520" });
    const quiet = await fixture("quiet", { mode: "quiet" });
    expect(await runGameDump(quiet.options)).toMatchObject({ ok: true, game: FAKE_GAME_VERSION });
  });

  it("does not wait for a process the game leaves behind with its output open", async () => {
    const { options, runs } = await fixture("linger", { mode: "linger", at: "data" });
    const started = Date.now();
    expect(await runGameDump(options)).toMatchObject({ ok: true, game: FAKE_GAME_VERSION });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(await readdir(runs)).toEqual([]);
  });

  it("refuses a second run in the same folder while one is running", async () => {
    const { options } = await fixture("busy");
    const [first, second] = await Promise.all([runGameDump(options), runGameDump(options)]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, failure: "busy", step: "prepare" });
    expect(await runGameDump(options)).toMatchObject({ ok: true });
  });

  it("gives the game a private mod directory and leaves the user's untouched, whatever the game rewrites", async () => {
    const mods = scratch("mods", "user", "mods");
    await mkdir(join(mods, "folder-mod_1.0.0"), { recursive: true });
    await writeFile(join(mods, "mod-list.json"), JSON.stringify({ mods: [{ name: "base", enabled: true }, { name: "alpha", enabled: true }] }));
    await writeFile(join(mods, "mod-settings.dat"), new Uint8Array([9, 9, 9]));
    await writeFile(join(mods, "alpha_1.0.0.zip"), "an archive");
    await writeFile(join(mods, "folder-mod_1.0.0", "info.json"), "{}");
    const before = await treeSnapshot(scratch("mods", "user"));
    const seen: string[][] = [];
    const { options, runs } = await fixture("mods", {}, {
      prepareMods: async (directory) => buildPrivateModDirectory(await readUserMods(mods), directory, process.platform),
      watch: [join(mods, "mod-list.json"), join(mods, "mod-settings.dat"), mods],
      collect: async (scriptOutput) => {
        const directory = join(scriptOutput, "..", "mods");
        seen.push((await readdir(directory)).sort(), [await readFile(join(directory, "mod-list.json"), "utf8"), await readFile(join(directory, "alpha_1.0.0.zip"), "utf8")]);
        return [];
      },
    });
    expect(await runGameDump(options)).toMatchObject({ ok: true, changed: [] });
    // The game saw the user's mods and rewrote its own copy of the list.
    expect(seen[0]).toEqual(["alpha_1.0.0.zip", "folder-mod_1.0.0", "mod-list.json", "mod-settings.dat"]);
    expect(seen[1]).toEqual([JSON.stringify({ mods: [{ name: "base", enabled: true }] }, null, 2), "an archive"]);
    expect(await readdir(runs)).toEqual([]);
    expect(await treeSnapshot(scratch("mods", "user"))).toEqual(before);
  });

  it("names the watched files of the user that changed while the game ran", async () => {
    const watched = scratch("watch-user", "factorio-current.log"), untouched = scratch("watch-user", "player-data.json"), absent = scratch("watch-user", "absent");
    await mkdir(scratch("watch-user"), { recursive: true });
    await writeFile(watched, "the user's log");
    await writeFile(untouched, "{}");
    const { options } = await fixture("watch", { mode: "escape", outside: watched }, { watch: [watched, untouched, absent] });
    expect(await runGameDump(options)).toMatchObject({ ok: true, changed: [watched] });
  });

  it("fails without starting the game when the sandbox is required and there is none", async () => {
    const { options, starts } = await fixture("required");
    expect(await runGameDump({ ...options, platform: "linux", sandbox: "required" })).toMatchObject({ ok: false, failure: "sandbox", step: "prepare", sandboxed: false });
    expect(await starts()).toEqual([]);
  });
});

describe.skipIf(!canSandbox)("runGameDump in the macOS sandbox", () => {
  it("encloses the game: it writes inside the run's folder and nowhere else", async () => {
    const outside = scratch("sandboxed", "outside.txt");
    const { options, runs } = await fixture("sandboxed", { mode: "escape", outside }, { sandbox: "required", keep: true, watch: [scratch("sandboxed")] });
    const result = await runGameDump(options);
    expect(result).toMatchObject({ ok: true, sandboxed: true, game: FAKE_GAME_VERSION });
    expect(await stat(outside).catch(() => undefined)).toBeUndefined();
    const [run] = await readdir(runs);
    const recorded = (await readFile(join(runs, run!, "game", "fake-record.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as FakeGameStart);
    expect(recorded.map((start) => [start.command, start.escaped])).toEqual([["data", "EPERM"], ["locale", "EPERM"], ["runtime", "EPERM"]]);
    expect(await readFile(join(runs, run!, "sandbox.sb"), "utf8")).toContain(`(allow file-write* (subpath ${JSON.stringify(join(runs, run!))}))`);
  });

  it("is used when it can be entered, unless it is switched off", async () => {
    const { options } = await fixture("preferred");
    expect(await runGameDump({ ...options, sandbox: "preferred" })).toMatchObject({ ok: true, sandboxed: true });
    expect(await runGameDump({ ...options, sandbox: "off" })).toMatchObject({ ok: true, sandboxed: false });
  });
});
