// Which mod a failed run of the game blames. The excerpts are from logs of Factorio 2.1.24 that failed in these ways, shortened.
import { describe, expect, it } from "vitest";
import { FAILED_MOD_LIMITS, failedMod, failedModMessage } from "../../src/gameData/failedMod.ts";

const HEAD = ["   0.000 2026-11-15 23:00:00; Factorio 2.1.24 (build 87808, mac-arm64, full, space-age)", "   0.052 System info: [CPU: arm64, 12 cores, RAM: 98304 MB]", "   0.053 Running in headless mode"];
const log = (...lines: string[]): string => [...HEAD, ...lines, "   4.355 Goodbye", ""].join("\n");

const ON_INIT = log(
  "   4.271 Script @__cargo-ships__/logic/ship_api.lua:44: Adding ship 'boat':",
  "   4.307 Error RunTest.cpp:67: Error loading scenario: The mod LTN - Logistic Train Network (3.5.0) caused a non-recoverable error.",
  "Please report this error to the mod author.",
  "",
  "Error while running event LogisticTrainNetwork::on_init()",
  "__LogisticTrainNetwork__/script/tools.lua:26: assertion failed!",
  "stack traceback:",
  "\t[C]: in function 'assert'",
  "\t__LogisticTrainNetwork__/script/tools.lua:26: in function 'getDispatcher'",
  "\t__LogisticTrainNetwork__/script/init.lua:370: in function <__LogisticTrainNetwork__/script/init.lua:369>",
);
const ON_TICK = log(
  "   2.030 Error RunTest.cpp:101: Error at tick 0: The mod Broken: The Mod (really) (1.2.3) caused a non-recoverable error.",
  "Please report this error to the mod author.",
  "",
  "Error while running event face-broken::on_tick (ID 0)",
  "__face-broken__/control.lua:1: attempt to index local 't' (a nil value)",
  "stack traceback:",
  "\t__face-broken__/control.lua:1: in function <__face-broken__/control.lua:1>",
  "   2.030 Info GlobalContext.cpp:763: Deleting active scenario.",
);
const REQUIRED_FILE = log(
  "   1.559 Checksum for script __level__/control.lua: 3247819239",
  "   1.561 Error RunTest.cpp:67: Error loading scenario: face-broken 1.2.3 errored when running a required file.",
  "",
  "__face-broken__/control.lua:2: attempt to index local 'x' (a nil value)",
  "stack traceback:",
  "\t__face-broken__/control.lua:2: in main chunk",
);
const DATA_STAGE = log(
  "   0.164 Loading mod elevated-rails 2.1.24 (data.lua)",
  "   0.170 Loading mod face-broken 1.2.0 (data.lua)",
  "   0.325 Loading mod face-broken 1.2.3 (data-updates.lua)",
  '   0.343 Error Util.cpp:81: Failed to load mod "face-broken": __face-broken__/data-updates.lua:1: this mod refuses to load',
  "stack traceback:",
  "\t[C]: in function 'error'",
  "\t__face-broken__/data-updates.lua:1: in main chunk",
  "",
  "------------- Error -------------",
  'Failed to load mod "face-broken": __face-broken__/data-updates.lua:1: this mod refuses to load',
  "---------------------------------",
);
const SETTINGS_STAGE = log("   0.057 Loading mod settings face-broken 1.2.3 (settings.lua)", '   0.058 Error Util.cpp:81: Failed to load mod "face-broken": __face-broken__/settings.lua:1: settings refuse');
const DEPENDENCY = log('   0.053 Error Util.cpp:81: Failed to load mod "face-broken": ', "• face-broken", "    • Missing required dependency face-not-there >= 1.0.0");
const PROTOTYPE = log(
  "   0.406 Checksum of space-age: 3636981730",
  "   0.641 Error Util.cpp:81: Error in assignID: item with name 'no-such-item' does not exist.",
  "",
  "At ROOT.recipe.face-broken-recipe.ingredients[0].name",
  "",
  "Source: face-broken-recipe (recipe).",
);

describe("failedMod", () => {
  it("names the mod the game blames for an error in an event, by title, version and name", () => {
    expect(failedMod(ON_INIT)).toEqual({ name: "LogisticTrainNetwork", title: "LTN - Logistic Train Network", version: "3.5.0", during: "start" });
    expect(failedModMessage(failedMod(ON_INIT)!)).toBe("The mod LTN - Logistic Train Network 3.5.0 (LogisticTrainNetwork) failed while the game started, and the game cannot be read with it enabled");
    // A title is whatever the mod calls itself; the version is the last thing in brackets before the game's own words.
    expect(failedMod(ON_TICK)).toEqual({ name: "face-broken", title: "Broken: The Mod (really)", version: "1.2.3", during: "run" });
    expect(failedModMessage(failedMod(ON_TICK)!)).toBe("The mod Broken: The Mod (really) 1.2.3 (face-broken) failed while the game ran, and the game cannot be read with it enabled");
  });

  it("names the mod whose control script the game could not run, and the one it could not load", () => {
    expect(failedMod(REQUIRED_FILE)).toEqual({ name: "face-broken", version: "1.2.3", during: "start" });
    expect(failedModMessage(failedMod(REQUIRED_FILE)!)).toBe("The mod face-broken 1.2.3 failed while the game started, and the game cannot be read with it enabled");
    // The version is the one of the line with which the game last began to load the mod.
    expect(failedMod(DATA_STAGE)).toEqual({ name: "face-broken", version: "1.2.3", during: "load" });
    expect(failedMod(SETTINGS_STAGE)).toEqual({ name: "face-broken", version: "1.2.3", during: "load" });
    expect(failedModMessage(failedMod(DATA_STAGE)!)).toBe("The game could not load the mod face-broken 1.2.3 and cannot be read with it enabled");
    // A mod that lacks what it depends on was never begun: the log has no version for it.
    expect(failedMod(DEPENDENCY)).toEqual({ name: "face-broken", during: "load" });
    expect(failedModMessage(failedMod(DEPENDENCY)!)).toBe("The game could not load the mod face-broken and cannot be read with it enabled");
  });

  it("names none when the game does not: another error, no error, an error that is not the last one", () => {
    expect(failedMod(PROTOTYPE)).toBeUndefined();
    expect(failedMod(log("   0.500 Error ModManager.cpp:1: Failed to load mods: something is wrong"))).toBeUndefined();
    expect(failedMod(log())).toBeUndefined();
    expect(failedMod("")).toBeUndefined();
    expect(failedMod(`${ON_INIT}   5.000 Error Main.cpp:1: Something else went wrong\n`)).toBeUndefined();
    // The name of the event's mod is looked for in the lines of the error itself, not further down.
    expect(failedMod(log("   2.000 Error RunTest.cpp:67: Error loading scenario: The mod Some Mod (1.0.0) caused a non-recoverable error.", "   2.001 Info X.cpp:1: next", "Error while running event other::on_init()"))).toEqual({ title: "Some Mod", version: "1.0.0", during: "start" });
  });

  it("takes the game's word only from a line of the game's own, and bounds what it takes", () => {
    // What a mod prints is not an error line of the game, whatever it says.
    expect(failedMod(log('   4.124 Script @__evil__/control.lua:1: Error Util.cpp:81: Failed to load mod "innocent": no', 'Failed to load mod "innocent": no', "Error loading scenario: The mod Innocent (1.0.0) caused a non-recoverable error."))).toBeUndefined();
    expect(failedMod(log('   0.343 Error Util.cpp:81: Failed to load mod "a/b": no'))).toBeUndefined();
    expect(failedMod(log(`   0.343 Error Util.cpp:81: Failed to load mod "${"x".repeat(FAILED_MOD_LIMITS.nameLength + 1)}": no`))).toBeUndefined();
    expect(failedMod(log("   0.343 Error Util.cpp:81: Error loading scenario: some-mod 1.2 errored when running a required file."))).toBeUndefined();
    const long = failedMod(log(`   2.000 Error RunTest.cpp:67: Error loading scenario: The mod ${"T".repeat(500)} (1.0.0) caused a non-recoverable error.`, `Error while running event ${"n".repeat(500)}::on_init()`));
    expect(long).toEqual({ title: `${"T".repeat(FAILED_MOD_LIMITS.titleLength)}...`, version: "1.0.0", during: "start" });
    // A name that is a pattern in itself is looked for as it is written.
    expect(failedMod(log("   0.170 Loading mod aXb 9.9.9 (data.lua)", '   0.343 Error Util.cpp:81: Failed to load mod "a.b": no'))).toEqual({ name: "a.b", during: "load" });
  });
});
