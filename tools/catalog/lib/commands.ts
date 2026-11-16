// What one dump of the game is made of: the three headless commands, the files they write, the private configuration, the
// environment and the macOS sandbox profile. Shared by the generator (dump.mjs) and the app (apps/desktop/src/gameData), so
// free of `import.meta`, of child processes and of syntax that Node's type stripping cannot run.
import type { ModuleInfo } from "@face/catalog";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const STANDARD_MODULES: readonly string[] = ["base", "elevated-rails", "recycler", "quality", "space-age"];
export const RUNTIME_SCENARIO = "face-catalog-dump";
export const RUNTIME_DUMP_FILE = "face-runtime-dump.json";
export const scenarioArgs = (name: string): string[] => ["--test-scenario", name, "--test-ticks", "600"];

export type DumpCommand = "data" | "locale" | "runtime";
// All three commands run headless. `--dump-icon-sprites` is deliberately absent: it starts the graphics stack, and macOS
// then updates the per-user Metal shader cache (outside the workspace) on the game's behalf.
export const DUMP_COMMANDS: Readonly<Record<DumpCommand, readonly string[]>> = {
  data: ["--dump-data"],
  locale: ["--dump-prototype-locale"],
  runtime: scenarioArgs(RUNTIME_SCENARIO),
};
/** The file below `script-output` that proves a command ran. */
export const DUMP_OUTPUTS: Readonly<Record<DumpCommand, string>> = { data: "data-raw-dump.json", locale: "item-locale.json", runtime: RUNTIME_DUMP_FILE };

/** The arguments of one run: a private configuration and mod directory, then the command. */
export function gameArguments(configFile: string, modDirectory: string, command: readonly string[]): string[] {
  return ["--config", configFile, "--mod-directory", modDirectory, "--no-log-rotation", ...command];
}

/** A configuration whose every writable path is below `writeData`, with uploads, Steam networking and blueprint storage off. */
export function configIni(readData: string, writeData: string): string {
  return [
    "; version=13",
    "[path]",
    `read-data=${readData}`,
    `write-data=${writeData}`,
    "[general]",
    "locale=en",
    "[other]",
    "enable-crash-log-uploading=false",
    "enable-steam-networking=false",
    "disable-blueprint-storage=true",
    "[graphics]",
    "full-screen=false",
    "[sound]",
    "master-volume=0",
    "",
  ].join("\n");
}

/** A `sandbox-exec` profile that denies every file write outside `writableRoot` (a path with links resolved) and all IP networking. */
export function sandboxProfile(writableRoot: string): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${JSON.stringify(writableRoot)}))`,
    '(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
    "(deny network-outbound (remote ip))",
    "(deny network-inbound (local ip))",
  ].join("\n");
}

export interface GameEnvironmentOptions {
  readonly platform: NodeJS.Platform;
  /** A private home directory; everything per user that the game or the system creates on its behalf lands there. */
  readonly home: string;
  readonly tmp: string;
  /** Windows only: the system directory (`SystemRoot` of the host), without which no program starts there. */
  readonly systemRoot?: string;
}

/** The whole environment of a run: nothing of the host's but what is named here. */
export function gameEnvironment({ platform, home, tmp, systemRoot = "C:\\Windows" }: GameEnvironmentOptions): Record<string, string> {
  if (platform === "win32") {
    const roaming = `${home}\\AppData\\Roaming`, local = `${home}\\AppData\\Local`;
    return { SystemRoot: systemRoot, windir: systemRoot, PATH: `${systemRoot}\\System32;${systemRoot}`, USERPROFILE: home, APPDATA: roaming, LOCALAPPDATA: local, TEMP: tmp, TMP: tmp };
  }
  const common = { PATH: "/usr/bin:/bin", HOME: home };
  if (platform === "darwin") return { ...common, CFFIXED_USER_HOME: home, TMPDIR: `${tmp}/`, LANG: "en_US.UTF-8" };
  return { ...common, TMPDIR: `${tmp}/`, LANG: "C.UTF-8", XDG_CONFIG_HOME: `${home}/.config`, XDG_DATA_HOME: `${home}/.local/share`, XDG_CACHE_HOME: `${home}/.cache` };
}

export interface Dependency {
  readonly name: string;
  readonly kind: "required" | "recommended" | "optional" | "incompatible";
  readonly constraint: string;
}

/**
 * Parses a dependency string such as "+ quality >= 2.1.0" into { name, kind, constraint }. The name is what stands before the
 * version constraint: older mods have spaces and dots in theirs.
 */
export function parseDependency(text: string): Dependency {
  const kinds: Record<string, Dependency["kind"]> = { "": "required", "~": "required", "+": "recommended", "?": "optional", "(?)": "optional", "!": "incompatible" };
  const [, prefix = "", rest = ""] = /^\s*(\(\?\)|[!?~+])?\s*(.*)$/s.exec(text) ?? [];
  const at = rest.search(/[<>=]/);
  const name = (at < 0 ? rest : rest.slice(0, at)).trim();
  if (!/^[A-Za-z0-9_ .-]+$/.test(name)) throw new Error(`Unparseable dependency "${text.slice(0, 120)}"`);
  return { name, kind: kinds[prefix]!, constraint: at < 0 ? "" : rest.slice(at).trim() };
}

/**
 * A module as its parsed `info.json` describes it, under the name and version the caller knows it by: its title, what it
 * cannot do without (`requires`), what it switches on with itself ("+", `recommends`) and the engine features it asks for.
 * Optional and incompatible dependencies are in neither list. Throws for dependencies that are no list of dependency strings.
 */
export function moduleInfo(name: string, version: string, info: Readonly<Record<string, unknown>>): ModuleInfo {
  const { title, dependencies = [] } = info;
  if (!Array.isArray(dependencies) || !dependencies.every((entry) => typeof entry === "string")) throw new Error(`${name}: the dependencies are not a list of texts`);
  const parsed = (dependencies as string[]).map(parseDependency);
  const pick = (kind: Dependency["kind"]): string[] => parsed.filter((d) => d.kind === kind).map((d) => d.name);
  const featureFlags = Object.keys(info).filter((key) => /^[a-z0-9_]+_required$/.test(key) && info[key] === true).map((key) => key.slice(0, -"_required".length).replaceAll("_", "-"));
  return { name, title: typeof title === "string" && title.trim() !== "" ? title : name, version, requires: pick("required"), recommends: pick("recommended"), featureFlags };
}

/** The `info.json` of the named modules of the game below its `data` directory. */
export function readModuleInfos(dataDir: string, names: readonly string[] = STANDARD_MODULES): ModuleInfo[] {
  return names.map((name) => {
    const info = JSON.parse(readFileSync(join(dataDir, name, "info.json"), "utf8")) as Record<string, unknown> & { version: string };
    return moduleInfo(name, info.version, info);
  });
}

export const modSetId = (mods: readonly string[]): string => mods.join("+");

export interface GameVersion {
  readonly version: string;
  readonly build: number;
  /** "mac-arm64, full" */
  readonly variant: string;
}

/**
 * The release a game process says it is: "Version: 2.1.24 (build 87808, mac-arm64, full)" of `--version`, or the first line of
 * a log, "Factorio 2.1.24 (build 87808, mac-arm64, full, space-age)". Undefined when the text has neither.
 */
export function parseGameVersion(output: string): GameVersion | undefined {
  const match = /(?:^Version:|\bFactorio) (\d+\.\d+\.\d+) \(build (\d{1,9}), ([^)\r\n]{0,100})\)/m.exec(output);
  return match ? { version: match[1]!, build: Number(match[2]), variant: match[3]! } : undefined;
}
