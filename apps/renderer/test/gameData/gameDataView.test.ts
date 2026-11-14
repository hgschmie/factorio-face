// The "Game data" section of the application settings as data: what it says in every state of a request to read the game,
// and which report from the main process counts.
import { describe, expect, it } from "vitest";
import type { GameDataRun, GameDataStatus } from "../../../desktop/src/ipc.ts";
import { CANCELLED_NOTICE, formatElapsed, gameDataView, hasEnded, INITIAL_GAME_DATA, reduceGameData, STALE_NOTICE, STEP_LABELS, type GameDataState } from "../../src/gameData/gameDataView.ts";

const BUILT_IN: GameDataStatus = { inUse: { kind: "built-in", version: "2.1.24" }, pending: null, stale: false, unavailable: null, problem: null, discardable: false, run: { state: "idle" } };
const GAME = { kind: "game", version: "2.1.24", build: 87808, readAt: "2026-11-14T12:00:00.000Z", mods: 3 } as const;
const READ: GameDataStatus = { ...BUILT_IN, inUse: GAME, discardable: true };
const date = (): string => "14 November 2026";
const view = (status: GameDataStatus, requesting = false) => gameDataView(status, requesting, date);
const running = (step: "prepare" | "data" | "locale" | "runtime" | "collect", index: number): GameDataRun => ({ state: "running", step, index, count: 5, startedAt: "2026-11-14T12:00:00.000Z" });

describe("the section", () => {
  it("names the built-in data and offers to read the game", () => {
    expect(view(BUILT_IN)).toEqual({
      kind: "built-in", source: "Built in, Factorio 2.1.24", detail: "The entities and signals of the standard game, as they come with this app", stale: null, problem: null, pending: null, phase: "idle", progress: null, failure: null, outcome: null, warnings: [],
      canRead: true, unavailable: null, canDiscard: false, canReload: false,
    });
  });

  it("disables reading with the reason when there is no installation with a program", () => {
    const reason = "This installation has the game's data but not the game itself (a copy of the data alone): /games/factorio/bin/x64/factorio is missing";
    expect(view({ ...BUILT_IN, unavailable: reason })).toMatchObject({ canRead: false, unavailable: reason, canDiscard: false });
  });

  it("names data read from the game, with its date and mods, and offers the built-in data", () => {
    expect(view(READ)).toMatchObject({
      kind: "game", source: "Read from your game on 14 November 2026: 2.1.24 with 3 mods", detail: "The entities and signals of your installed game, with those of its mods", stale: null, canRead: true, canDiscard: true,
    });
    expect(view({ ...READ, inUse: { ...GAME, mods: 0 } })).toMatchObject({ source: "Read from your game on 14 November 2026: 2.1.24 without mods", detail: "The entities and signals of your installed game" });
  });

  it("says when the game or its mods have changed since", () => {
    expect(view({ ...READ, stale: true }).stale).toBe(STALE_NOTICE);
  });

  it("waits for the user while the confirmation is open", () => {
    expect(view({ ...BUILT_IN, run: { state: "confirming" } })).toMatchObject({ phase: "confirming", progress: null, canRead: false, canDiscard: false });
  });

  it.each([
    ["prepare", 1, "Step 1 of 5: preparing a private folder for the game"],
    ["data", 2, "Step 2 of 5: the game loads its data and your mods"],
    ["locale", 3, "Step 3 of 5: the game writes the names of its prototypes"],
    ["runtime", 4, "Step 4 of 5: the game runs a scenario that reports its finished prototypes"],
    ["collect", 5, "Step 5 of 5: building the entity and signal tables"],
  ] as const)("shows the step %s while the game runs, and nothing else can be asked for", (step, index, text) => {
    expect(view({ ...READ, run: running(step, index) })).toMatchObject({ phase: "running", progress: { text, index, count: 5, startedAt: Date.parse("2026-11-14T12:00:00.000Z") }, canRead: false, canDiscard: false, canReload: false });
    expect(Object.keys(STEP_LABELS)).toHaveLength(5);
  });

  it("shows how long it took and the warnings when it worked, and that other data waits for the window", () => {
    const warnings = ["12 icons of mods are not shown: the app reads icons from the game's own files only.", "2 wired entities were left out because the game's data about them is not consistent."];
    const steps = [{ step: "prepare", seconds: 0.2 }, { step: "data", seconds: 6.4 }, { step: "locale", seconds: 5.1 }, { step: "runtime", seconds: 7.9 }, { step: "collect", seconds: 0.3 }] as const;
    const done = view({ ...BUILT_IN, pending: GAME, discardable: true, run: { state: "done", warnings, steps } });
    expect(done).toMatchObject({
      phase: "done", outcome: "The game was read in 20 seconds.", warnings, failure: null, canRead: true, canDiscard: true, canReload: true,
      pending: "Read from your game on 14 November 2026: 2.1.24 with 3 mods. It is used once the window has been loaded again.",
    });
    expect(view({ ...READ, run: { state: "done", warnings: [], steps: [{ step: "data", seconds: 0.4 }] } })).toMatchObject({ outcome: "The game was read in 1 second.", warnings: [], pending: null, canReload: false });
  });

  it("shows the reason and the log when it failed, with the warnings there were", () => {
    const failed = view({ ...BUILT_IN, run: { state: "failed", message: "The game ended with exit code 1", log: "   0.5 Error ModManager.cpp: Failed to load mods", warnings: ["mod-list.json cannot be read; the game decides which mods it enables"] } });
    expect(failed).toMatchObject({ phase: "failed", failure: { message: "The game ended with exit code 1", log: "   0.5 Error ModManager.cpp: Failed to load mods" }, outcome: null, canRead: true });
    expect(failed.warnings).toEqual(["mod-list.json cannot be read; the game decides which mods it enables"]);
  });

  it("says that nothing changed when it was cancelled", () => {
    expect(view({ ...BUILT_IN, run: { state: "cancelled" } })).toMatchObject({ phase: "cancelled", outcome: CANCELLED_NOTICE, failure: null, canRead: true });
  });

  it("says why data read earlier is not in use, which can be discarded", () => {
    const problem = "The data read from your game cannot be used: the file is of another format. The built-in data is in use.";
    expect(view({ ...BUILT_IN, problem, discardable: true })).toMatchObject({ kind: "built-in", problem, canDiscard: true, canRead: true });
  });

  it("offers nothing while a request that is answered at once is on its way", () => {
    expect(view({ ...BUILT_IN, pending: GAME, discardable: true }, true)).toMatchObject({ canRead: false, canDiscard: false, canReload: false });
  });

  it("formats the time a run has taken", () => {
    expect([0, 999, 7000, 59_999, 60_000, 83_500, 600_000, -5].map(formatElapsed)).toEqual(["0:00", "0:00", "0:07", "0:59", "1:00", "1:23", "10:00", "0:00"]);
  });
});

describe("the state", () => {
  const withStatus: GameDataState = { status: BUILT_IN, requesting: false, error: null };

  it("takes the status that was answered and keeps the one it has when a request fails", () => {
    expect(reduceGameData(INITIAL_GAME_DATA, { type: "answered", result: { ok: true, value: BUILT_IN }, quick: false })).toEqual(withStatus);
    expect(reduceGameData(withStatus, { type: "answered", result: { ok: false, error: "The game is being read. Cancel that first." }, quick: true })).toEqual({ ...withStatus, error: "The game is being read. Cancel that first." });
    expect(reduceGameData(withStatus, { type: "failed", error: "gone", quick: false })).toEqual({ ...withStatus, error: "gone" });
    expect(reduceGameData({ ...withStatus, error: "old" }, { type: "requested", quick: false })).toEqual(withStatus);
  });

  it("waits for a request that is answered at once, and not for the game", () => {
    const quick = reduceGameData(withStatus, { type: "requested", quick: true });
    expect(quick.requesting).toBe(true);
    // The read of the game is under way at the same time: its answer does not end the waiting, the quick one's does.
    expect(reduceGameData(quick, { type: "answered", result: { ok: true, value: READ }, quick: false })).toEqual({ status: READ, requesting: true, error: null });
    expect(reduceGameData(quick, { type: "answered", result: { ok: true, value: READ }, quick: true })).toEqual({ status: READ, requesting: false, error: null });
    expect(reduceGameData(quick, { type: "failed", error: "gone", quick: true }).requesting).toBe(false);
    expect(reduceGameData(withStatus, { type: "requested", quick: false }).requesting).toBe(false);
  });

  it("follows the run as the main process reports it, once it knows the rest", () => {
    const run = running("data", 2);
    expect(reduceGameData(withStatus, { type: "run", run }).status).toEqual({ ...BUILT_IN, run });
    expect(reduceGameData(INITIAL_GAME_DATA, { type: "run", run })).toBe(INITIAL_GAME_DATA);
    expect([{ state: "idle" }, { state: "confirming" }, run, { state: "cancelled" }, { state: "done", warnings: [], steps: [] }, { state: "failed", message: "", log: "", warnings: [] }].map((state) => hasEnded(state as GameDataRun))).toEqual([true, false, false, true, true, true]);
  });
});
