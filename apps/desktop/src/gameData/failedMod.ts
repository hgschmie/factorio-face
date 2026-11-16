// Which mod the game blames when a run ends with an error, read from the end of its log. The log is text of a program the
// app does not control, with whatever the user's mods print in between: only the three ways in which the game itself names a
// mod as the source of its error count, each on a line that begins as the game's own error lines do. Anything else names
// no mod. What is taken from the log is bounded, and it is only ever shown as text. Pure.
//
// The forms, as Factorio 2.1.24 writes them (a mod failing while its data is loaded, in its control script, in an event):
//   0.186 Error Util.cpp:81: Failed to load mod "some-mod": __some-mod__/data.lua:2: attempt to index local 'x' (a nil value)
//   1.561 Error RunTest.cpp:67: Error loading scenario: some-mod 1.2.3 errored when running a required file.
//   4.307 Error RunTest.cpp:67: Error loading scenario: The mod Some Mod (1.2.3) caused a non-recoverable error.
//         ... Error while running event some-mod::on_init()
// A prototype that cannot be built ("Error in assignID: ...") names its prototype, not its mod: nothing is said for it.

export interface FailedMod {
  /** The mod's name, as its folder has it; absent when the game gave its title alone. */
  readonly name?: string;
  /** What the mod calls itself, when the game named it so. */
  readonly title?: string;
  readonly version?: string;
  /** What the game was doing: loading the mods' data and settings, starting the scenario, or running it. */
  readonly during: "load" | "start" | "run";
}

export const FAILED_MOD_LIMITS = { nameLength: 100, titleLength: 100 } as const;

const NAME = "[A-Za-z0-9_ .-]+";
const VERSION = "\\d{1,5}\\.\\d{1,5}\\.\\d{1,5}";
/** How a line of the game's own begins when it reports an error: the time, "Error", and the place in its source. */
const ERROR_LINE = /^ *\d+\.\d{3} Error [A-Za-z0-9_]+\.cpp:\d+: (.*)$/;
const NOT_LOADED = new RegExp(`^Failed to load mod "(${NAME})":`);
const REQUIRED_FILE = new RegExp(`^(?:Error loading scenario: )?(${NAME}) (${VERSION}) errored when running a required file\\.`);
const NON_RECOVERABLE = new RegExp(`^(Error loading scenario|Error at tick \\d+): The mod (.+) \\((${VERSION})\\) caused a non-recoverable error\\.`);
/** The line below a non-recoverable error that has the mod's name. */
const IN_EVENT = new RegExp(`^Error while running event (${NAME})::`);
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isName = (name: string): boolean => name.length <= FAILED_MOD_LIMITS.nameLength && name.trim() === name;

/**
 * The mod the game names as the source of the error its log ends with; undefined when the last error of the log names none,
 * or when there is no error. `log` is the game's output as the runner hands it on (`sanitiseOutput`).
 */
export function failedMod(log: string): FailedMod | undefined {
  const lines = log.split("\n");
  const at = lines.findLastIndex((line) => ERROR_LINE.test(line));
  if (at < 0) return undefined;
  const error = ERROR_LINE.exec(lines[at]!)![1]!;

  const notLoaded = NOT_LOADED.exec(error);
  if (notLoaded && isName(notLoaded[1]!)) {
    // The version is in the line with which the game began to load the mod, when the log still has it.
    const loading = new RegExp(`^ *\\d+\\.\\d{3} Loading mod (?:settings )?${escaped(notLoaded[1]!)} (${VERSION}) \\(`);
    const version = lines.slice(0, at).findLast((line) => loading.test(line))?.match(loading)?.[1];
    return { name: notLoaded[1]!, ...(version === undefined ? {} : { version }), during: "load" };
  }

  const required = REQUIRED_FILE.exec(error);
  if (required && isName(required[1]!)) return { name: required[1]!, version: required[2]!, during: "start" };

  const nonRecoverable = NON_RECOVERABLE.exec(error);
  if (nonRecoverable) {
    // The lines of this error end where the game's next line begins.
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((line) => /^ *\d+\.\d{3} /.test(line));
    const name = (end < 0 ? rest : rest.slice(0, end)).map((line) => IN_EVENT.exec(line)?.[1]).find((found) => found !== undefined && isName(found));
    const title = nonRecoverable[2]!.trim();
    return { ...(name === undefined ? {} : { name }), title: title.length > FAILED_MOD_LIMITS.titleLength ? `${title.slice(0, FAILED_MOD_LIMITS.titleLength)}...` : title, version: nonRecoverable[3]!, during: nonRecoverable[1]!.startsWith("Error at tick") ? "run" : "start" };
  }
  return undefined;
}

/** "LTN - Logistic Train Network 3.5.0 (LogisticTrainNetwork)": the title where the game gave one, the version, and the name where it says more. */
function label({ name, title, version }: FailedMod): string {
  const called = `${title ?? name ?? ""}${version === undefined ? "" : ` ${version}`}`;
  return title !== undefined && name !== undefined && name !== title ? `${called} (${name})` : called;
}

/** The failure in a sentence without its full stop, as the runner's messages are: which mod, when, and what follows from it. */
export function failedModMessage(mod: FailedMod): string {
  if (mod.during === "load") return `The game could not load the mod ${label(mod)} and cannot be read with it enabled`;
  return `The mod ${label(mod)} failed while the game ${mod.during === "start" ? "started" : "ran"}, and the game cannot be read with it enabled`;
}
