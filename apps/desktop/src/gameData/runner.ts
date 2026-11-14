// Runs the user's game headless for one dump: `--dump-data`, `--dump-prototype-locale` and the runtime scenario, the three
// commands of the catalog generator (tools/catalog/lib/commands.ts), each in a process of its own. The isolation is the
// generator's too: a private configuration whose every writable path is inside a fresh folder of the app, a private mod
// directory, HOME and the temp directory redirected into that folder, and on macOS the kernel sandbox, which denies every
// write outside the folder and all IP networking. The program is started without a shell, with fixed arguments and an
// environment of its own; its output is bounded and never interpreted beyond the version line. The folder is removed afterwards.
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DUMP_COMMANDS, DUMP_OUTPUTS, RUNTIME_SCENARIO, configIni, gameArguments, gameEnvironment, parseGameVersion, sandboxProfile, type DumpCommand, type GameVersion,
} from "../../../../tools/catalog/lib/commands.ts";
import { removePrivateModDirectory } from "./userMods.ts";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
/** The game's application id at Steam. In the environment it tells the Steam library that the game was started by Steam, so it does not start the game again through the client. */
export const STEAM_APP_ID = "427520";
export const RUNNER_DEFAULTS = { stepTimeoutMs: 5 * 60_000, totalTimeoutMs: 12 * 60_000, outputLimitBytes: 16 * 1024 * 1024, logTailBytes: 32 * 1024 } as const;
const RUN_PREFIX = "run-";
const HEAD_BYTES = 4096;
const EXIT_GRACE_MS = 1000;
const ERROR_FILE = "face-runtime-dump-error.txt";
const STEPS = Object.keys(DUMP_COMMANDS) as DumpCommand[];

export type RunStep = "prepare" | DumpCommand | "collect";

export interface RunProgress {
  readonly step: RunStep;
  /** Position among the steps of a run, from 1. */
  readonly index: number;
  readonly count: number;
  readonly state: "started" | "finished";
  /** How long the step took, when it has finished. */
  readonly seconds?: number;
}

export type RunFailure =
  /** Another run uses the same folder. */
  | "busy"
  | "cancelled"
  | "timeout"
  /** The sandbox was required and is not available. */
  | "sandbox"
  /** The program could not be started. */
  | "start"
  /** The program ended with an error. */
  | "exit"
  | "output-limit"
  /** The program ended well and did not write what the command writes. */
  | "no-output"
  /** What the program wrote could not be used. */
  | "invalid-dump";

export interface RunReport {
  /** Whether the kernel sandbox enclosed the game. */
  readonly sandboxed: boolean;
  /** Watched files of the user that were not the same after the run as before it. */
  readonly changed: readonly string[];
  readonly steps: readonly { readonly step: RunStep; readonly seconds: number }[];
}

export type RunResult<T> =
  | ({ readonly ok: true; readonly value: T; readonly game: GameVersion } & RunReport)
  | ({ readonly ok: false; readonly failure: RunFailure; readonly step: RunStep; readonly message: string; /** The end of what the game printed, made safe to show. */ readonly log: string } & RunReport);

export interface GameRunOptions<T> {
  /** The program, as `locateGameExecutable` names it. */
  readonly executable: string;
  readonly dataDirectory: string;
  /** A folder of the app's own; every run works in a fresh folder inside it, and leftovers of earlier runs in it are removed. */
  readonly runsDirectory: string;
  readonly platform: NodeJS.Platform;
  /** The host's environment, of which only `SystemRoot` is passed on (Windows). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** A build from a Steam library: the environment then names the game's application id. */
  readonly steam?: boolean;
  /** The text of the runtime scenario (tools/catalog/runtime-dump/control.lua). */
  readonly scenarioSource: string;
  /** Creates the private mod directory at the given path (`buildPrivateModDirectory`). Without it the directory is empty. */
  readonly prepareMods?: (modDirectory: string) => Promise<unknown>;
  /** Files of the user to compare before and after by size and time (`watchedUserFiles`). */
  readonly watch?: readonly string[];
  /** macOS: "preferred" (the default) uses the sandbox when it can be entered, "required" fails when it cannot, "off" never uses it. Elsewhere there is none. */
  readonly sandbox?: "preferred" | "required" | "off";
  readonly stepTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly outputLimitBytes?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RunProgress) => void;
  /** Reads what the game wrote below `script-output` while the folder still exists. What it throws fails the run as "invalid-dump". */
  readonly collect: (scriptOutput: string, game: GameVersion) => Promise<T>;
  /** Keep the folder of the run instead of removing it, to look at a failure. */
  readonly keep?: boolean;
}

/** What the game printed, safe to show: decoded leniently, control characters and escape sequences taken out. */
export function sanitiseOutput(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "?");
}

/** The program and arguments of one run: the game itself, or `sandbox-exec` around it, which replaces itself with the game. */
export function gameCommand(executable: string, args: readonly string[], profileFile: string | undefined): { program: string; args: string[] } {
  return profileFile === undefined ? { program: executable, args: [...args] } : { program: SANDBOX_EXEC, args: ["-f", profileFile, executable, ...args] };
}

/** The environment of a run: the generator's, and for a Steam build the game's application id. */
export function runEnvironment(options: { platform: NodeJS.Platform; home: string; tmp: string; systemRoot?: string; steam?: boolean }): Record<string, string> {
  const { steam = false, systemRoot, ...rest } = options;
  return { ...gameEnvironment({ ...rest, ...(systemRoot ? { systemRoot } : {}) }), ...(steam ? { SteamAppId: STEAM_APP_ID, SteamGameId: STEAM_APP_ID } : {}) };
}

interface ProcessOutcome {
  readonly end: "exit" | "start" | "timeout" | "cancelled" | "output-limit";
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: string;
  readonly head: Uint8Array;
  readonly tail: Uint8Array;
}

/** Starts one process and waits for its end; it is killed at the deadline, on cancellation and when it prints more than the limit. Never rejects. */
function runProcess(program: string, args: readonly string[], options: { cwd: string; env: Record<string, string>; timeoutMs: number; outputLimitBytes: number; signal?: AbortSignal }): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    let head: Buffer = Buffer.alloc(0), tail: Buffer = Buffer.alloc(0);
    let printed = 0;
    let end: ProcessOutcome["end"] = "exit";
    let error: string | undefined;
    let finished = false;
    if (options.signal?.aborted) return resolve({ end: "cancelled", code: null, signal: null, head, tail });
    const child = spawn(program, [...args], { cwd: options.cwd, env: options.env, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ end, code, signal, ...(error === undefined ? {} : { error }), head, tail });
    };
    const stop = (reason: ProcessOutcome["end"]): void => {
      if (end !== "exit") return;
      end = reason;
      if (exited) finish(exited.code, exited.signal);
      else child.kill("SIGKILL");
    };
    const onAbort = (): void => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const onData = (chunk: Buffer): void => {
      printed += chunk.length;
      if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk]).subarray(0, HEAD_BYTES);
      tail = Buffer.concat([tail, chunk]).subarray(-RUNNER_DEFAULTS.logTailBytes);
      if (printed > options.outputLimitBytes) stop("output-limit");
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (cause) => {
      error = cause.message;
      if (end === "exit") end = "start";
      // A process that never started has no "close".
      if (child.pid === undefined) finish(null, null);
    });
    child.on("exit", (code, signal) => {
      exited = { code, signal };
      // "close" waits for the output to end, and a process the game left behind can hold it open: the rest of the output gets a moment, not more.
      setTimeout(() => finish(code, signal), EXIT_GRACE_MS).unref();
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/** The end of a file, at most `bytes` of it; empty when it cannot be read. */
async function readTail(file: string, bytes: number, fromStart = false): Promise<Uint8Array> {
  try {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, bytes);
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, fromStart ? 0 : size - length);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return new Uint8Array();
  }
}

/** Size and modification time of each file, "absent" for one that is not there. No content is read. */
async function fingerprint(files: readonly string[]): Promise<string[]> {
  return Promise.all(files.map((file) => stat(file).then((info) => `${info.isDirectory() ? "directory" : info.size} ${info.mtimeMs}`, () => "absent")));
}

async function isFile(file: string): Promise<boolean> {
  return lstat(file).then((info) => info.isFile(), () => false);
}

/** Removes a run's folder; the links of its private mod directory go first and one by one. */
async function removeRun(directory: string): Promise<void> {
  await removePrivateModDirectory(join(directory, "game", "mods"));
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
}

const active = new Set<string>();

/**
 * Takes one dump of the game. Resolves with what `collect` made of the game's files, or with the failure, the step it
 * happened in and the end of the game's output; never rejects. The run's folder is gone when the promise settles.
 */
export async function runGameDump<T>(options: GameRunOptions<T>): Promise<RunResult<T>> {
  const { executable, dataDirectory, runsDirectory, platform, signal, onProgress, sandbox = "preferred" } = options;
  const stepTimeoutMs = options.stepTimeoutMs ?? RUNNER_DEFAULTS.stepTimeoutMs, outputLimitBytes = options.outputLimitBytes ?? RUNNER_DEFAULTS.outputLimitBytes;
  const deadline = Date.now() + (options.totalTimeoutMs ?? RUNNER_DEFAULTS.totalTimeoutMs);
  const watch = options.watch ?? [];
  const steps: { step: RunStep; seconds: number }[] = [];
  const count = STEPS.length + 2;
  let sandboxed = false;
  let before: string[] | undefined;
  let current: RunStep = "prepare";
  let started = Date.now();
  const begin = (step: RunStep): void => {
    current = step;
    started = Date.now();
    notify("started");
  };
  const end = (): void => {
    steps.push({ step: current, seconds: (Date.now() - started) / 1000 });
    notify("finished");
  };
  const notify = (state: RunProgress["state"]): void => {
    try {
      onProgress?.({ step: current, index: steps.length + (state === "started" ? 1 : 0), count, state, ...(state === "finished" ? { seconds: steps.at(-1)!.seconds } : {}) });
    } catch {
      // A listener's failure is not the run's.
    }
  };
  const report = async (): Promise<RunReport> => {
    const after = before && (await fingerprint(watch));
    return { sandboxed, changed: watch.filter((_, index) => before?.[index] !== after?.[index]), steps };
  };
  const fail = async (failure: RunFailure, message: string, log: Uint8Array = new Uint8Array()): Promise<RunResult<T>> => ({ ok: false, failure, step: current, message, log: sanitiseOutput(log), ...(await report()) });

  if (active.has(runsDirectory)) return fail("busy", "The game is already being read");
  active.add(runsDirectory);
  let run: string | undefined;
  try {
    begin("prepare");
    if (signal?.aborted) return await fail("cancelled", "Cancelled");
    await mkdir(runsDirectory, { recursive: true });
    for (const name of await readdir(runsDirectory)) if (name.startsWith(RUN_PREFIX)) await removeRun(join(runsDirectory, name));
    // Links resolved: the sandbox profile and the game's configuration name real paths.
    run = await realpath(await mkdtemp(join(runsDirectory, RUN_PREFIX)));
    // Both go into the game's configuration, one path per line.
    const unusable = [run, dataDirectory].find((folder) => /[\u0000-\u001f]/.test(folder));
    if (unusable !== undefined) return await fail("start", `The game cannot be configured with a folder of this name: ${JSON.stringify(unusable)}`);
    const home = join(run, "home"), tmp = join(run, "tmp"), game = join(run, "game");
    const configFile = join(game, "config", "config.ini"), modDirectory = join(game, "mods"), scriptOutput = join(game, "script-output");
    for (const directory of [home, tmp, join(game, "config"), join(game, "scenarios", RUNTIME_SCENARIO)]) await mkdir(directory, { recursive: true });
    await writeFile(configFile, configIni(dataDirectory, game));
    await writeFile(join(game, "scenarios", RUNTIME_SCENARIO, "control.lua"), options.scenarioSource);
    if (options.prepareMods) await options.prepareMods(modDirectory);
    else await mkdir(modDirectory);

    let profileFile: string | undefined;
    const env = runEnvironment({ platform, home, tmp, ...(options.env?.SystemRoot ? { systemRoot: options.env.SystemRoot } : {}), ...(options.steam ? { steam: true } : {}) });
    if (sandbox !== "off" && platform === "darwin") {
      profileFile = join(run, "sandbox.sb");
      await writeFile(profileFile, sandboxProfile(run) + "\n");
      // A process that is itself sandboxed cannot enter another sandbox; the probe says so before the game is started.
      const probe = await runProcess(SANDBOX_EXEC, ["-f", profileFile, "/usr/bin/true"], { cwd: run, env, timeoutMs: 10_000, outputLimitBytes: 65_536, ...(signal ? { signal } : {}) });
      if (probe.end === "cancelled") return await fail("cancelled", "Cancelled");
      if (probe.end !== "exit" || probe.code !== 0) profileFile = undefined;
    }
    sandboxed = profileFile !== undefined;
    if (sandbox === "required" && !sandboxed) return await fail("sandbox", "The game cannot be enclosed in a sandbox here, and it is not started without one");
    before = await fingerprint(watch);
    end();

    let version: GameVersion | undefined;
    for (const step of STEPS) {
      begin(step);
      const { program, args } = gameCommand(executable, gameArguments(configFile, modDirectory, DUMP_COMMANDS[step]), profileFile);
      const timeoutMs = Math.min(stepTimeoutMs, deadline - Date.now());
      if (timeoutMs <= 0) return await fail("timeout", "The game took too long in all");
      const outcome = await runProcess(program, args, { cwd: game, env, timeoutMs, outputLimitBytes, ...(signal ? { signal } : {}) });
      // The Windows build prints nothing to a pipe; its log has the same text.
      const logFile = join(game, "factorio-current.log");
      const log = outcome.tail.length ? outcome.tail : await readTail(logFile, RUNNER_DEFAULTS.logTailBytes);
      const seconds = Math.round((Date.now() - started) / 1000);
      if (outcome.end === "cancelled") return await fail("cancelled", "Cancelled", log);
      if (outcome.end === "timeout") return await fail("timeout", `The game did not finish within ${seconds} seconds and was stopped`, log);
      if (outcome.end === "output-limit") return await fail("output-limit", `The game printed more than ${outputLimitBytes} bytes and was stopped`, log);
      if (outcome.end === "start") return await fail("start", `The game could not be started: ${outcome.error ?? "unknown error"}`, log);
      if (outcome.code !== 0) return await fail("exit", `The game ended with ${outcome.code === null ? `signal ${outcome.signal}` : `exit code ${outcome.code}`}`, log);
      if (!(await isFile(join(scriptOutput, DUMP_OUTPUTS[step])))) {
        const reason = sanitiseOutput(await readTail(join(scriptOutput, ERROR_FILE), 2048)).trim();
        const hint = options.steam ? " (a game from Steam may have handed over to the Steam client instead of running)" : "";
        return await fail("no-output", `The game ended without writing ${DUMP_OUTPUTS[step]}${reason ? `: ${reason}` : hint}`, log);
      }
      version ??= parseGameVersion(sanitiseOutput(outcome.head)) ?? parseGameVersion(sanitiseOutput(await readTail(logFile, HEAD_BYTES, true)));
      end();
    }
    if (!version) return await fail("invalid-dump", "The game did not say which version it is");

    begin("collect");
    if (signal?.aborted) return await fail("cancelled", "Cancelled");
    let value: T;
    try {
      value = await options.collect(scriptOutput, version);
    } catch (error) {
      return await fail("invalid-dump", error instanceof Error ? error.message : String(error));
    }
    end();
    return { ok: true, value, game: version, ...(await report()) };
  } catch (error) {
    return await fail("start", `The run could not be prepared: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (run !== undefined && !options.keep) await removeRun(run).catch(() => undefined);
    active.delete(runsDirectory);
  }
}
