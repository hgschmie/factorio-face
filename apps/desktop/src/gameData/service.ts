// The data the editor works with, while the app runs: which data the window has, which it gets when it is loaded again, and
// the one request to read the game that can be under way. Free of Electron: the native confirmation, the event to the window
// and what switching the data means for the icons are handed in. Nothing here takes an argument from the renderer.
import type { IconTable } from "@face/catalog/icons";
import { missingEditorPrototypes, parseEntityTable } from "@face/model";
import type { GameInstallation, Host } from "../gameInstallation.ts";
import type { GameDataInUse, GameDataRun, GameDataSource, GameDataStatus } from "../ipc.ts";
import { ValidationError } from "../validation.ts";
import type { CachedGameData, GameDataCache } from "./cache.ts";
import { readConfirmation, type ReadConfirmation } from "./confirmation.ts";
import { gameDataSource, sameGameState, type GameData } from "./gameData.ts";
import { planGameRead, readGameData, type RefreshOptions, type RefreshResult } from "./refresh.ts";

export const GAME_DATA_RUNS_DIRECTORY = "game-data-runs";
export const NO_INSTALLATION = "No Factorio installation is in use. Choose the game's folder above.";

/**
 * What was found in the cache, as far as the editor can work with it: data whose entity table lacks one of the prototypes the
 * editor has a kind of its own for (a mod removed the lamp) counts as a file that cannot be used.
 */
export function usableGameData(cached: CachedGameData): CachedGameData {
  if (cached.status !== "ok") return cached;
  const problem = unusable(cached.data);
  return problem === undefined ? cached : { status: "damaged", message: `The data read from your game cannot be used: ${problem}` };
}

/** Why the editor cannot work with data, or undefined when it can. */
function unusable(data: GameData): string | undefined {
  const missing = missingEditorPrototypes(parseEntityTable(data.entities));
  return missing.length === 0 ? undefined : `the game has no ${missing.join(", ")}, which the editor cannot do without (a mod removes or renames ${missing.length === 1 ? "it" : "them"})`;
}

interface Loaded {
  readonly data: GameData;
  readonly iconTable: IconTable;
}

export interface GameDataServiceOptions {
  readonly cache: GameDataCache;
  /** What the cache held at start, through `usableGameData`. */
  readonly cached: CachedGameData;
  /** The release of the data that comes with the build. */
  readonly builtInVersion: string;
  /** The installation in use, once it is known (`GameSettings.installation`). */
  installation(): Promise<GameInstallation | undefined>;
  readonly host: Host;
  /** Shows the native confirmation; true only when the user agreed to run the game. */
  confirm(confirmation: ReadConfirmation): Promise<boolean>;
  /** The run's options that are the app's own: where runs work, the scenario's text, what the tables name as their origin. */
  readonly run: Pick<RefreshOptions, "runsDirectory" | "scenarioSource" | "generator" | "sandbox" | "stepTimeoutMs" | "totalTimeoutMs">;
  /** `readGameData`, unless a test says otherwise. */
  readonly read?: (options: RefreshOptions) => Promise<RefreshResult>;
  /** Told whenever the request moves on. */
  onRun(run: GameDataRun): void;
  /** Told the icon table and release of the data a window is given from now on; undefined for the built-in data. */
  onActivate(data: { readonly iconTable: IconTable; readonly version: string } | undefined): void;
}

const IDLE: GameDataRun = { state: "idle" };

export class GameDataService {
  private readonly options: GameDataServiceOptions;
  /** What the window has. */
  private inUse: Loaded | undefined;
  /** What the cache holds: what a window gets when it loads. */
  private stored: Loaded | undefined;
  private problem: string | null;
  private run: GameDataRun = IDLE;
  private abort: AbortController | undefined;
  private reading: Promise<unknown> = Promise.resolve();
  /** The app is about to quit: nothing is started any more. */
  private stopping = false;

  constructor(options: GameDataServiceOptions) {
    this.options = options;
    const { cached } = options;
    this.stored = this.inUse = cached.status === "ok" ? { data: cached.data, iconTable: cached.iconTable } : undefined;
    this.problem = cached.status === "damaged" ? `${cached.message}. The built-in data is in use.` : null;
  }

  /** True while the confirmation is open or the game runs. */
  get busy(): boolean {
    return this.run.state === "confirming" || this.run.state === "running";
  }

  /** The icon table of the data in use; undefined for the built-in data. */
  get iconTable(): IconTable | undefined {
    return this.inUse?.iconTable;
  }

  private sourceOf(loaded: Loaded | undefined): GameDataSource {
    return loaded ? gameDataSource(loaded.data) : { kind: "built-in", version: this.options.builtInVersion };
  }

  /** What a window works with. */
  current(): GameDataInUse {
    const { inUse } = this;
    return { source: this.sourceOf(inUse), problem: this.problem, mods: inUse?.data.mods ?? [], catalog: inUse?.data.catalog ?? null, entities: inUse?.data.entities ?? null };
  }

  /** Looks at the installation and the user's mods, which starts nothing. Never rejects. */
  async status(): Promise<GameDataStatus> {
    const { inUse, stored } = this;
    const installation = await this.options.installation();
    const planned = installation && (await planGameRead(installation, this.options.host).catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) })));
    return {
      inUse: this.sourceOf(inUse),
      pending: stored === inUse ? null : this.sourceOf(stored),
      stale: inUse !== undefined && planned?.ok === true && !sameGameState(inUse.data.key, planned.plan.key),
      unavailable: planned === undefined ? NO_INSTALLATION : planned.ok ? null : planned.message,
      problem: this.problem,
      discardable: stored !== undefined || this.problem !== null,
      run: this.run,
    };
  }

  /**
   * A window is about to load: it gets what the cache holds. Tells `onActivate` when that is other data than the window had.
   * True when it is.
   */
  activate(): boolean {
    if (this.inUse === this.stored) return false;
    this.inUse = this.stored;
    this.options.onActivate(this.inUse && { iconTable: this.inUse.iconTable, version: this.inUse.data.key.version });
    return true;
  }

  /**
   * Asks the user and, when they agree, reads the game and keeps what was read. Resolves with the status when that has ended;
   * at once while a request is under way. Never rejects.
   */
  async read(): Promise<GameDataStatus> {
    if (this.busy || this.stopping) return this.status();
    this.move({ state: "confirming" });
    const reading = this.confirmAndRead().catch((error: unknown): GameDataRun => {
      console.error("[face] reading the game failed:", error);
      return { state: "failed", message: `The game could not be read: ${error instanceof Error ? error.message : String(error)}`, log: "", warnings: [] };
    });
    this.reading = reading;
    this.move(await reading);
    this.abort = undefined;
    return this.status();
  }

  private async confirmAndRead(): Promise<GameDataRun> {
    const { host, confirm, cache, read = readGameData } = this.options;
    const failed = (message: string, log = "", warnings: readonly string[] = []): GameDataRun => ({ state: "failed", message, log, warnings });
    const installation = await this.options.installation();
    if (!installation) return failed(NO_INSTALLATION);
    const planned = await planGameRead(installation, host);
    if (!planned.ok) return failed(planned.message);
    if (!(await confirm(readConfirmation(planned.plan, host.platform))) || this.stopping) return IDLE;

    const abort = (this.abort = new AbortController());
    const startedAt = new Date().toISOString();
    this.move({ state: "running", step: "prepare", index: 1, count: 5, startedAt });
    const result = await read({
      ...this.options.run,
      installation,
      host,
      confirmedExecutable: planned.plan.executable,
      signal: abort.signal,
      onProgress: ({ step, index, count, state }) => {
        if (state === "started" && this.run.state === "running") this.move({ state: "running", step, index, count, startedAt });
      },
    });
    if (!result.ok) return result.failure === "cancelled" ? { state: "cancelled" } : failed(result.message, result.log, result.warnings);
    const problem = unusable(result.data);
    if (problem !== undefined) return failed(`The game was read, but its data cannot be used: ${problem}. The data in use stays.`, "", result.warnings);
    await cache.store(result.data);
    this.stored = { data: result.data, iconTable: result.iconTable };
    this.problem = null;
    return { state: "done", warnings: result.warnings, steps: result.steps };
  }

  /** Stops the game when it is being read; the request then ends as cancelled. An open confirmation is the user's to answer. */
  cancel(): Promise<GameDataStatus> {
    this.abort?.abort();
    return this.status();
  }

  /** Cancels and resolves when nothing is running any more: before the app quits. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    this.abort?.abort();
    await this.reading;
  }

  /** Removes what was read from the game, a file that cannot be used included. The built-in data applies from the next load of the window. */
  async discard(): Promise<GameDataStatus> {
    if (this.busy) throw new ValidationError("The game is being read. Cancel that first.");
    await this.options.cache.discard();
    this.stored = undefined;
    this.problem = null;
    if (this.run.state !== "idle") this.move(IDLE);
    return this.status();
  }

  private move(run: GameDataRun): void {
    this.run = run;
    try {
      this.options.onRun(run);
    } catch (error) {
      console.error("[face] reporting the game read failed:", error);
    }
  }
}
