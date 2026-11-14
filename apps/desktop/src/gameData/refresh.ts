// Reads the entity and signal data from the user's installed game: finds its program and its mods, has the game run headless
// in isolation (runner.ts) and builds the data from the dump (dump.ts). Only ever called because the user asked for it. Free
// of Electron; what to do with the result (the cache, the windows) is the caller's.
import type { IconTable } from "@face/catalog/icons";
import type { GameInstallation, Host } from "../gameInstallation.ts";
import { buildGameData, readDump } from "./dump.ts";
import { locateGameExecutable } from "./executable.ts";
import type { GameData, GameDataKey } from "./gameData.ts";
import { runGameDump, type GameRunOptions, type RunFailure, type RunProgress, type RunReport } from "./runner.ts";
import { buildPrivateModDirectory, enabledMods, locateUserData, noUserMods, readUserMods, watchedUserFiles, type UserMods } from "./userMods.ts";

/** The first release whose `--test-scenario` runs the runtime scenario headless. */
export const MINIMUM_GAME_VERSION = "2.1.24";

export interface RefreshOptions extends Pick<GameRunOptions<unknown>, "runsDirectory" | "scenarioSource" | "sandbox" | "stepTimeoutMs" | "totalTimeoutMs" | "signal" | "onProgress" | "keep"> {
  /** The installation in use, as the application settings found it. */
  readonly installation: GameInstallation;
  readonly host: Host;
  /** The program the user agreed to have started: `executable` of the plan that was shown. Anything else is not started. */
  readonly confirmedExecutable: string;
  /** What the tables name as their origin: the application and its version. */
  readonly generator: string;
  readonly now?: () => Date;
}

export type RefreshFailure = RunFailure | "unsupported-version" | "no-executable" | "not-confirmed";

export type RefreshResult =
  | ({ readonly ok: true; readonly data: GameData; readonly iconTable: IconTable; /** What the user should know although it worked. */ readonly warnings: readonly string[] } & RunReport)
  | { readonly ok: false; readonly failure: RefreshFailure; readonly message: string; readonly log: string; readonly warnings: readonly string[] };

export type { RunProgress };

/** What reading the game would do, for the user to agree to before anything is started. */
export interface GameReadPlan {
  /** The program that would be started, links resolved. */
  readonly executable: string;
  /** From a Steam library: such a build may hand over to the Steam client. */
  readonly steam: boolean;
  /** Where the user's mods are; null when the game has none. */
  readonly modDirectory: string | null;
  /** The state of the game as its files say it now: compare it with the key of cached data (`sameGameState`). */
  readonly key: GameDataKey;
  /** What could not be read of the user's mods. */
  readonly problems: readonly string[];
}

interface Prepared {
  readonly plan: GameReadPlan;
  readonly mods: UserMods;
  readonly watch: readonly string[];
}

function isOlder(version: string, minimum: string): boolean {
  const [a, b] = [version.split(".").map(Number), minimum.split(".").map(Number)];
  return (a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!) < 0;
}

async function prepare(installation: GameInstallation, host: Host): Promise<({ readonly ok: true } & Prepared) | { readonly ok: false; readonly failure: RefreshFailure; readonly message: string }> {
  if (isOlder(installation.version, MINIMUM_GAME_VERSION)) return { ok: false, failure: "unsupported-version", message: `Reading the game needs Factorio ${MINIMUM_GAME_VERSION} or newer; this installation is ${installation.version}` };
  const program = await locateGameExecutable(installation.dataDirectory, host.platform);
  if (!program.ok) return { ok: false, failure: "no-executable", message: program.message };
  // A platform without a known folder for the user's files is a game without mods.
  const location = await locateUserData(installation.dataDirectory, host);
  const mods = location ? await readUserMods(location.modDirectory) : noUserMods();
  const key: GameDataKey = { version: installation.version, mods: enabledMods(mods, installation.modules), modSettings: mods.settingsHash };
  const plan: GameReadPlan = { executable: program.executable, steam: program.steam, modDirectory: mods.exists ? mods.directory : null, key, problems: mods.problems };
  return { ok: true, plan, mods, watch: location ? watchedUserFiles(location) : [] };
}

/** Looks at the installation and the user's mods without starting anything. Never rejects. */
export async function planGameRead(installation: GameInstallation, host: Host): Promise<{ readonly ok: true; readonly plan: GameReadPlan } | { readonly ok: false; readonly failure: RefreshFailure; readonly message: string }> {
  const prepared = await prepare(installation, host);
  return prepared.ok ? { ok: true, plan: prepared.plan } : prepared;
}

function changeWarning(changed: readonly string[]): string[] {
  return changed.length ? [`These files of your game changed while it was read: ${changed.join(", ")}. If you were playing at the same time, that was the game itself.`] : [];
}

/** Runs the game once and builds the data. Never rejects; the run's folder is gone when the promise settles. */
export async function readGameData(options: RefreshOptions): Promise<RefreshResult> {
  const { installation, host, confirmedExecutable, generator, now = () => new Date(), ...run } = options;
  const prepared = await prepare(installation, host);
  if (!prepared.ok) return { ...prepared, log: "", warnings: [] };
  const { plan, mods, watch } = prepared;
  if (plan.executable !== confirmedExecutable) return { ok: false, failure: "not-confirmed", message: `The game's program is not the one that was agreed to: ${plan.executable}`, log: "", warnings: [] };
  const readAt = now().toISOString();
  const result = await runGameDump({
    ...run,
    executable: plan.executable,
    dataDirectory: installation.dataDirectory,
    platform: host.platform,
    env: host.env,
    steam: plan.steam,
    watch,
    prepareMods: (directory) => buildPrivateModDirectory(mods, directory, host.platform),
    collect: async (scriptOutput, game) => buildGameData(await readDump(scriptOutput), { dataDirectory: installation.dataDirectory, game, key: plan.key, readAt, generator }),
  });
  const warnings = [...plan.problems, ...changeWarning(result.changed)];
  if (!result.ok) return { ok: false, failure: result.failure, message: result.message, log: result.log, warnings };
  const { data, iconTable } = result.value;
  if (!result.sandboxed && host.platform === "darwin" && options.sandbox !== "off") warnings.push("The game ran without the system's sandbox, which could not be entered here.");
  if (data.skippedIcons > 0) warnings.push(`${data.skippedIcons} icons of mods are not shown: the app reads icons from the game's own files only.`);
  if (data.notes.length > 0) warnings.push(`${data.notes.length} wired entities were left out because the game's data about them is not consistent.`);
  return { ok: true, data, iconTable, warnings, sandboxed: result.sandboxed, changed: result.changed, steps: result.steps };
}
