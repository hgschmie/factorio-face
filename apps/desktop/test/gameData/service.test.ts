// The data in use while the app runs: what a start makes of the cache file, the one request to read the game with its
// states (idle, confirming, running, done, failed, cancelled), and the text the user agrees to. The game is the fake one.
import { loadStandardIconTable } from "@face/catalog/icons/standard";
import { parseEntityTable } from "@face/model";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectDataDirectory, type GameInstallation, type Host } from "../../src/gameInstallation.ts";
import { GAME_DATA_FILE_NAME, GameDataCache } from "../../src/gameData/cache.ts";
import { CONFIRM_BUTTONS, CONFIRM_RUN, plannedMods, readConfirmation, type ReadConfirmation } from "../../src/gameData/confirmation.ts";
import { modDirectoryFromEnv, planGameRead, type GameReadPlan } from "../../src/gameData/refresh.ts";
import { GameDataService, NO_INSTALLATION, usableGameData, type GameDataServiceOptions } from "../../src/gameData/service.ts";
import type { GameDataRun } from "../../src/ipc.ts";
import { ValidationError } from "../../src/validation.ts";
import { MOD_ENTITY, SOME_MOD_INFO, fakeGameStarts, modArchive, writeCannedDump, writeFakeGame, type CannedDump, type FakeGameControl } from "../support/cannedDump.ts";
import { writeGameData } from "../support/fakeGame.ts";
import { useScratch } from "../support/scratch.ts";

const scratch = useScratch("game-service");
const BUILT_IN = { kind: "built-in", version: "2.1.24" } as const;
const MODDED = { kind: "game", version: "2.1.24", build: 87808, mods: 1 } as const;
/** What a window is told it can ask icons for with the built-in data: the ids of the icon table that comes with the build. */
const BUILT_IN_ICONS = [...loadStandardIconTable().icons.keys()];

interface Setup {
  readonly service: GameDataService;
  readonly options: GameDataServiceOptions;
  readonly cache: GameDataCache;
  readonly cacheFile: string;
  readonly control: FakeGameControl;
  readonly installation: GameInstallation;
  readonly host: Host;
  readonly mods: string;
  /** Every state the request went through, as the window is told. */
  readonly runs: GameDataRun[];
  /** What the window was switched to: a game version, or "built-in". */
  readonly activations: string[];
  readonly confirmations: ReadConfirmation[];
  /** What the next confirmations answer; true unless set. */
  answer: boolean | Promise<boolean>;
  /** A second service on the same profile: what the next start of the app has. */
  restart(): Promise<GameDataService>;
}

/** A Linux-style installation whose program is the fake game, a user with one mod, and a service on a profile of its own. */
async function setup(name: string, dump: CannedDump = {}, behaviour: Partial<FakeGameControl> = {}, change: Partial<GameDataServiceOptions> = {}): Promise<Setup> {
  const root = scratch(name, "factorio"), home = scratch(name, "home");
  const dataDirectory = await writeGameData(join(root, "data"), { modules: [] });
  await mkdir(join(root, "bin", "x64"), { recursive: true });
  const control: FakeGameControl = { record: scratch(name, "record.jsonl"), dump: await writeCannedDump(scratch(name, "dump"), { editor: true, activeMods: { base: "2.1.24", "some-mod": "1.2.3" }, ...dump }), ...behaviour };
  await writeFakeGame(join(root, "bin", "x64", "factorio"), control);
  const mods = join(home, ".factorio", "mods");
  await mkdir(mods, { recursive: true });
  await writeFile(join(mods, "mod-list.json"), JSON.stringify({ mods: [{ name: "base", enabled: true }, { name: "some-mod", enabled: true }] }));
  await writeFile(join(mods, "some-mod_1.2.3.zip"), modArchive(SOME_MOD_INFO));
  const inspection = await inspectDataDirectory(dataDirectory, "2.1.24");
  if (!inspection.ok) throw new Error(inspection.message);
  const host: Host = { platform: "linux", env: {}, home };
  const cacheFile = scratch(name, "user-data", GAME_DATA_FILE_NAME);
  const cache = new GameDataCache(cacheFile);
  const runs: GameDataRun[] = [], activations: string[] = [], confirmations: ReadConfirmation[] = [];
  const state = { answer: true as boolean | Promise<boolean> };
  const options = async (): Promise<GameDataServiceOptions> => ({
    cache,
    cached: usableGameData(await cache.load()),
    builtInIcons: loadStandardIconTable(),
    installation: async () => inspection.installation,
    host,
    confirm: async (confirmation) => {
      confirmations.push(confirmation);
      return state.answer;
    },
    run: { runsDirectory: scratch(name, "user-data", "game-data-runs"), scenarioSource: "-- scenario\n", generator: "face test", sandbox: "off" },
    onRun: (run) => void runs.push(run),
    onActivate: (data) => void activations.push(data?.version ?? "built-in"),
    ...change,
  });
  const first = await options();
  return {
    service: new GameDataService(first), options: first, cache, cacheFile, control, installation: inspection.installation, host, mods, runs, activations, confirmations,
    set answer(value: boolean | Promise<boolean>) {
      state.answer = value;
    },
    restart: async () => new GameDataService(await options()),
  };
}

const states = (runs: readonly GameDataRun[]): string[] => runs.map((run) => (run.state === "running" ? `running ${run.step} ${run.index}/${run.count}` : run.state));

describe("the confirmation", () => {
  const plan: GameReadPlan = {
    executable: "/Applications/factorio.app/Contents/MacOS/factorio",
    steam: false,
    modDirectory: "/Users/someone/Library/Application Support/factorio/mods",
    key: { version: "2.1.24", mods: [{ name: "base", version: "2.1.24" }, { name: "space-age", version: "2.1.24" }, { name: "a-mod", version: "1.0.0" }, { name: "b-mod", version: null }], modSettings: null },
    problems: [],
  };

  it("names the program, what runs in it and where the mods come from, and Cancel is its default", () => {
    const confirmation = readConfirmation(plan, "darwin");
    expect(confirmation).toMatchObject({ message: "Run Factorio to read its entities and signals?", buttons: ["Cancel", "Run the Game"], defaultId: 0, cancelId: 0 });
    expect(CONFIRM_BUTTONS[CONFIRM_RUN]).toBe("Run the Game");
    expect(confirmation.detail.split("\n\n")).toEqual([
      "The app will start this program:\n/Applications/factorio.app/Contents/MacOS/factorio",
      "The game runs headless, without a window, three times in a row, and loads its data as it does when you play, with your mods and their settings. This usually takes less than a minute and can be cancelled.",
      "2 mods are enabled, and their code runs in the game. The mods are read from:\n/Users/someone/Library/Application Support/factorio/mods",
      "Nothing is written to the game's folders, your mods, saves or settings: the game works in a private folder of this app, with copies of your mod list and mod settings. Where the system's sandbox can be entered, as it normally can, the game runs in it and is denied every write elsewhere and all network access; the app says so afterwards if it could not.",
    ]);
    expect(plannedMods(plan)).toBe(2);
  });

  it("says so when there is one mod, none, or no mod directory, and promises no sandbox where there is none", () => {
    const one = { ...plan, key: { ...plan.key, mods: plan.key.mods.slice(0, 3) } };
    expect(readConfirmation(one, "linux").detail).toContain("1 mod is enabled, and its code runs in the game. The mods are read from:\n/Users/someone");
    expect(readConfirmation({ ...plan, key: { ...plan.key, mods: plan.key.mods.slice(0, 2) } }, "linux").detail).toContain("No mod is enabled. The mods are read from:");
    expect(readConfirmation({ ...plan, modDirectory: null }, "linux").detail).toContain("Your game has no mods: there is no mod directory.");
    expect(readConfirmation(plan, "linux").detail).not.toContain("sandbox");
    expect(readConfirmation(plan, "win32").detail).toContain("Nothing is written to the game's folders, your mods, saves or settings");
  });

  it("adds a note for a game from Steam and what could not be read of the mods", () => {
    const { detail } = readConfirmation({ ...plan, steam: true, problems: ["mod-list.json cannot be read; the game decides which mods it enables"] }, "darwin");
    expect(detail.split("\n\n").slice(4)).toEqual([
      "This installation is from Steam. Such a game may hand over to the Steam client instead of running; the app then reports that nothing was read.",
      "mod-list.json cannot be read; the game decides which mods it enables",
    ]);
  });

  it("is shown with the real plan of the installation before anything is started", async () => {
    const { service, confirmations, control, installation, host, mods } = await setup("confirm-plan");
    const planned = await planGameRead(installation, host);
    if (!planned.ok) throw new Error(planned.message);
    await service.read();
    expect(confirmations).toEqual([readConfirmation(planned.plan, "linux")]);
    expect(confirmations[0]!.detail).toContain(`The app will start this program:\n${planned.plan.executable}`);
    expect(confirmations[0]!.detail).toContain(`1 mod is enabled, and its code runs in the game. The mods are read from:\n${mods}`);
    expect((await fakeGameStarts(control)).every((start) => start.args.includes("--mod-directory"))).toBe(true);
  });
});

describe("the mod directory of a test", () => {
  it("replaces the user's, and nothing of the user's is looked at", async () => {
    const { installation, host, mods } = await setup("mods-override");
    const other = scratch("mods-override", "elsewhere", "mods");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "other-mod_0.3.0.zip"), "another mod");
    const planned = await planGameRead(installation, { ...host, env: { FACE_GAME_MODS_DIR: other } });
    expect(planned).toMatchObject({ ok: true, plan: { modDirectory: other, key: { mods: [{ name: "base", version: "2.1.24" }, { name: "other-mod", version: "0.3.0" }] } } });
    expect(await planGameRead(installation, host)).toMatchObject({ ok: true, plan: { modDirectory: mods } });
    expect(modDirectoryFromEnv({})).toBeUndefined();
    expect(modDirectoryFromEnv({ FACE_GAME_MODS_DIR: "" })).toBeUndefined();
    expect(() => modDirectoryFromEnv({ FACE_GAME_MODS_DIR: "relative/mods" })).toThrow("FACE_GAME_MODS_DIR must be an absolute path");
  });
});

describe("reading the game", () => {
  it("is idle with the built-in data until it is asked", async () => {
    const { service, runs, control } = await setup("idle");
    expect(await service.status()).toEqual({ inUse: BUILT_IN, pending: null, stale: false, unavailable: null, problem: null, discardable: false, run: { state: "idle" } });
    expect(service.current()).toEqual({ source: BUILT_IN, problem: null, mods: [], catalog: null, entities: null, icons: BUILT_IN_ICONS });
    expect(BUILT_IN_ICONS.length).toBeGreaterThan(1000);
    expect(BUILT_IN_ICONS).toContain("virtual/signal-A");
    expect(service.busy).toBe(false);
    expect(service.activate()).toBe(false);
    expect(runs).toEqual([]);
    expect(await fakeGameStarts(control)).toEqual([]);
  });

  it("starts nothing when the user declines", async () => {
    const setting = await setup("declined");
    setting.answer = false;
    const status = await setting.service.read();
    expect(status).toMatchObject({ inUse: BUILT_IN, pending: null, run: { state: "idle" } });
    expect(states(setting.runs)).toEqual(["confirming", "idle"]);
    expect(setting.confirmations).toHaveLength(1);
    expect(await fakeGameStarts(setting.control)).toEqual([]);
    expect(existsSync(setting.cacheFile)).toBe(false);
  });

  it("goes from confirming through the five steps to done, keeps the data, and gives it to the window when that loads again", async () => {
    const { service, runs, activations, control, cacheFile, options, restart } = await setup("done");
    const status = await service.read();
    expect(states(runs)).toEqual(["confirming", "running prepare 1/5", "running prepare 1/5", "running data 2/5", "running locale 3/5", "running runtime 4/5", "running collect 5/5", "done"]);
    expect(status).toMatchObject({ inUse: BUILT_IN, pending: MODDED, stale: false, unavailable: null, problem: null, discardable: true });
    expect(status.run).toMatchObject({ state: "done", warnings: ["3 icons of mods are not shown: the app reads icons from the game's own files only."] });
    expect(status.run.state === "done" && status.run.steps.map((step) => step.step)).toEqual(["prepare", "data", "locale", "runtime", "collect"]);
    expect((await fakeGameStarts(control)).map((start) => start.command)).toEqual(["data", "locale", "runtime"]);
    expect(await readdir(options.run.runsDirectory)).toEqual([]);
    expect(existsSync(cacheFile)).toBe(true);

    // The window keeps the data it has until it is loaded again.
    expect(service.current().catalog).toBeNull();
    expect(activations).toEqual([]);
    expect(service.activate()).toBe(true);
    expect(activations).toEqual(["2.1.24"]);
    expect(service.activate()).toBe(false);
    const current = service.current();
    expect(current).toMatchObject({ source: MODDED, problem: null, mods: [{ name: "base", version: "2.1.24" }, { name: "some-mod", version: "1.2.3" }] });
    // The window gets the mod as its info.json describes it, and every record with the mod that created it.
    expect(current.catalog!.modules[1]).toEqual({ name: "some-mod", title: "Some Mod", version: "1.2.3", requires: ["base"], recommends: [], featureFlags: [] });
    expect(current.catalog!.signals.virtual!.map((signal) => [signal.name, signal.modules])).toEqual([["mod-signal", ["some-mod"]], ["signal-A", ["base"]]]);
    expect(parseEntityTable(current.entities).byName.get(MOD_ENTITY)!.modules).toEqual(["some-mod"]);
    expect(parseEntityTable(current.entities).byName.get("small-lamp")!.modules).toEqual(["base"]);
    expect(parseEntityTable(current.entities).byName.has(MOD_ENTITY)).toBe(true);
    expect(current.catalog!.signals.virtual!.map((signal) => signal.name)).toEqual(["mod-signal", "signal-A"]);
    expect(service.iconTable!.icons.has("virtual/signal-A")).toBe(true);
    expect(service.iconTable!.icons.has("virtual/mod-signal")).toBe(false);
    // The window is told which icons it can ask for: those of the icon table. The three the catalog names beside them are the mod's.
    expect(current.icons).toEqual([...service.iconTable!.icons.keys()]);
    expect(current.icons).toEqual(expect.arrayContaining(["virtual/signal-A", "item/plate", "item/constant-combinator", "group/g"]));
    expect(["virtual/mod-signal", `item/${MOD_ENTITY}`, "item/gadget"].filter((id) => current.icons.includes(id))).toEqual([]);
    expect(await service.status()).toMatchObject({ inUse: MODDED, pending: null, stale: false, discardable: true });

    // The next start of the app has it at once.
    const next = await restart();
    expect(next.current()).toEqual(current);
    expect(await next.status()).toMatchObject({ inUse: MODDED, pending: null, problem: null, run: { state: "idle" } });
  });

  it("asks once: a second request while the first is confirming or running opens nothing and starts nothing", async () => {
    const setting = await setup("once", {}, { mode: "hang", at: "data" });
    let agree: (value: boolean) => void = () => undefined;
    setting.answer = new Promise<boolean>((resolve) => (agree = resolve));
    const first = setting.service.read();
    await expect.poll(() => setting.confirmations.length).toBe(1);
    expect(setting.service.busy).toBe(true);
    expect((await setting.service.read()).run).toEqual({ state: "confirming" });
    await expect(setting.service.discard()).rejects.toThrow(ValidationError);
    // Cancelling does not answer the dialog: it is the user's.
    expect((await setting.service.cancel()).run).toEqual({ state: "confirming" });
    agree(true);
    await expect.poll(async () => (await fakeGameStarts(setting.control)).length).toBe(1);
    expect((await setting.service.read()).run).toMatchObject({ state: "running", step: "data", index: 2, count: 5 });
    expect(setting.confirmations).toHaveLength(1);
    await setting.service.cancel();
    expect((await first).run).toEqual({ state: "cancelled" });
    expect(await fakeGameStarts(setting.control)).toHaveLength(1);
    expect(states(setting.runs).at(-1)).toBe("cancelled");
    expect(setting.service.busy).toBe(false);
    expect(existsSync(setting.cacheFile)).toBe(false);
    expect(await readdir(setting.options.run.runsDirectory)).toEqual([]);
  });

  it("fails with the reason and the end of the game's log, and the data in use stays", async () => {
    const { service, runs, cacheFile } = await setup("failed", {}, { mode: "fail", at: "locale" });
    const status = await service.read();
    expect(status).toMatchObject({ inUse: BUILT_IN, pending: null, discardable: false, run: { state: "failed", message: "The game ended with exit code 3", warnings: [] } });
    expect(status.run.state === "failed" && status.run.log).toContain("Failed to load mods: something is wrong");
    expect(states(runs).at(-1)).toBe("failed");
    expect(existsSync(cacheFile)).toBe(false);
    // The next request starts over.
    expect((await service.read()).run).toMatchObject({ state: "failed" });
    expect(states(runs).filter((state) => state === "confirming")).toHaveLength(2);
  });

  it("refuses data without one of the editor's own prototypes and caches nothing", async () => {
    const { service, cacheFile } = await setup("no-substation", { without: ["substation", "small-lamp"] });
    const status = await service.read();
    expect(status.run).toMatchObject({
      state: "failed",
      message: "The game was read, but its data cannot be used: the game has no small-lamp, substation, which the editor cannot do without (a mod removes or renames them). The data in use stays.",
    });
    expect(status).toMatchObject({ pending: null, discardable: false });
    expect(existsSync(cacheFile)).toBe(false);
  });

  it("fails without an installation, without the program, and when the read itself throws", async () => {
    const none = await setup("no-installation", {}, {}, { installation: async () => undefined });
    expect(await none.service.status()).toMatchObject({ unavailable: NO_INSTALLATION, stale: false });
    expect((await none.service.read()).run).toEqual({ state: "failed", message: NO_INSTALLATION, log: "", warnings: [] });
    expect(none.confirmations).toEqual([]);

    const copy = await setup("data-only");
    const dataOnly = { ...copy.installation, dataDirectory: await writeGameData(scratch("data-only", "copy", "data")) };
    const withoutProgram = new GameDataService({ ...copy.options, installation: async () => dataOnly });
    expect((await withoutProgram.status()).unavailable).toMatch(/^This installation has the game's data but not the game itself/);
    expect((await withoutProgram.read()).run).toMatchObject({ state: "failed" });
    expect(copy.confirmations).toEqual([]);

    const thrown = await setup("thrown", {}, {}, { read: async () => Promise.reject(new Error("disk full")) });
    expect((await thrown.service.read()).run).toEqual({ state: "failed", message: "The game could not be read: disk full", log: "", warnings: [] });
    expect(thrown.service.busy).toBe(false);
  });

  it("stops a running game before the app quits", async () => {
    const { service, control, options } = await setup("shutdown", {}, { mode: "hang", at: "runtime" });
    const reading = service.read();
    await expect.poll(async () => (await fakeGameStarts(control)).length).toBe(3);
    await service.shutdown();
    expect(service.busy).toBe(false);
    expect((await reading).run).toEqual({ state: "cancelled" });
    expect(await readdir(options.run.runsDirectory)).toEqual([]);
    await service.shutdown();
    // Nothing is started any more, and an answer to a confirmation that was open comes too late.
    expect((await service.read()).run).toEqual({ state: "cancelled" });
    const late = await setup("shutdown-confirming");
    let agree: (value: boolean) => void = () => undefined;
    late.answer = new Promise<boolean>((resolve) => (agree = resolve));
    const waiting = late.service.read();
    await expect.poll(() => late.confirmations.length).toBe(1);
    const stopped = late.service.shutdown();
    agree(true);
    await stopped;
    expect((await waiting).run).toEqual({ state: "idle" });
    expect(await fakeGameStarts(late.control)).toEqual([]);
  });

  it("says when the game or its mods are not the ones the data was read from", async () => {
    const { service, mods } = await setup("stale");
    await service.read();
    service.activate();
    expect((await service.status()).stale).toBe(false);
    await writeFile(join(mods, "some-mod_1.3.0.zip"), "a newer version");
    expect(await service.status()).toMatchObject({ inUse: MODDED, stale: true, unavailable: null });
  });

  it("goes back to the built-in data when what was read is discarded", async () => {
    const { service, activations, runs, cacheFile, restart } = await setup("discard");
    await service.read();
    service.activate();
    const status = await service.discard();
    expect(status).toEqual({ inUse: { ...MODDED, readAt: expect.any(String) as string }, pending: BUILT_IN, stale: false, unavailable: null, problem: null, discardable: false, run: { state: "idle" } });
    expect(states(runs).at(-1)).toBe("idle");
    expect(existsSync(cacheFile)).toBe(false);
    expect(service.activate()).toBe(true);
    expect(activations).toEqual(["2.1.24", "built-in"]);
    expect(service.current()).toEqual({ source: BUILT_IN, problem: null, mods: [], catalog: null, entities: null, icons: BUILT_IN_ICONS });
    expect(service.iconTable).toBeUndefined();
    expect((await restart()).current().source).toEqual(BUILT_IN);
  });
});

describe("the cache at start", () => {
  async function stored(name: string): Promise<Setup> {
    const setting = await setup(name);
    await setting.service.read();
    return setting;
  }

  it("is used when it is fine", async () => {
    const { restart, cache, cacheFile } = await stored("fine");
    expect(usableGameData(await cache.load())).toMatchObject({ status: "ok" });
    const service = await restart();
    expect(service.current()).toMatchObject({ source: MODDED, problem: null });
    expect(service.iconTable).toBeDefined();
    // Which icons can be drawn is no field of the file: it is the icon table the file has always held, so a file of an earlier version says it as well.
    const file = JSON.parse(await readFile(cacheFile, "utf8")) as { icons: { icons: Record<string, unknown> } };
    expect(Object.keys(file).sort()).toEqual(["catalog", "entities", "icons", "key", "keyId", "mods", "notes", "readAt", "skippedIcons", "version"]);
    expect(service.current().icons).toEqual(Object.keys(file.icons.icons));
    expect(service.current().icons).not.toContain("virtual/mod-signal");
  });

  it("falls back to the built-in data, with the reason, when the file is damaged; discarding removes it", async () => {
    const { restart, cacheFile, activations } = await stored("damaged");
    await writeFile(cacheFile, (await readFile(cacheFile, "utf8")).slice(0, 5000));
    const service = await restart();
    const problem = expect.stringMatching(/^The data read from your game cannot be used: .*\. The built-in data is in use\.$/) as string;
    expect(service.current()).toEqual({ source: BUILT_IN, problem, mods: [], catalog: null, entities: null, icons: BUILT_IN_ICONS });
    expect(await service.status()).toMatchObject({ inUse: BUILT_IN, pending: null, problem, discardable: true, run: { state: "idle" } });
    expect(service.activate()).toBe(false);
    expect(await service.discard()).toMatchObject({ problem: null, discardable: false, pending: null });
    expect(existsSync(cacheFile)).toBe(false);
    expect(activations).toEqual([]);
  });

  it("falls back for a file of the earlier format and asks to read the game again, which replaces it", async () => {
    const { restart, cacheFile } = await stored("outdated");
    const file = JSON.parse(await readFile(cacheFile, "utf8")) as Record<string, unknown>;
    await writeFile(cacheFile, JSON.stringify({ ...file, version: 1 }));
    const service = await restart();
    const problem = "The data read from your game was stored by an earlier version of this app and cannot be used by this one. Read the game again to work with your game's data. The built-in data is in use.";
    expect(service.current()).toEqual({ source: BUILT_IN, problem, mods: [], catalog: null, entities: null, icons: BUILT_IN_ICONS });
    expect(await service.status()).toMatchObject({ inUse: BUILT_IN, pending: null, problem, discardable: true, unavailable: null });
    expect(await service.read()).toMatchObject({ inUse: BUILT_IN, pending: MODDED, problem: null, run: { state: "done" } });
    expect(JSON.parse(await readFile(cacheFile, "utf8"))).toMatchObject({ version: 3 });
    expect((await restart()).current()).toMatchObject({ source: MODDED, problem: null });
  });

  it("falls back when the data lacks one of the editor's prototypes, and a new read replaces it", async () => {
    const { restart, cacheFile } = await stored("lacking");
    const file = JSON.parse(await readFile(cacheFile, "utf8")) as { entities: { entities: { name: string }[] } };
    file.entities.entities = file.entities.entities.filter((entity) => entity.name !== "decider-combinator");
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(file));
    const service = await restart();
    const problem = "The data read from your game cannot be used: the game has no decider-combinator, which the editor cannot do without (a mod removes or renames it). The built-in data is in use.";
    expect(service.current()).toMatchObject({ source: BUILT_IN, problem, catalog: null });
    const status = await service.read();
    expect(status).toMatchObject({ inUse: BUILT_IN, pending: MODDED, problem: null, run: { state: "done" } });
    expect(service.activate()).toBe(true);
    expect(service.current()).toMatchObject({ source: MODDED, problem: null });
  });
});
