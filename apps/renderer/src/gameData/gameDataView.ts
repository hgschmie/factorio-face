// What the "Game data" section of the application settings says: where the data comes from, whether the game changed since,
// where a request to read the game stands and what can be done. Pure: the section renders the result, the hook keeps the state.
import { describeGameDataSource } from "../../../desktop/src/gameData/source.ts";
import type { GameDataRun, GameDataStatus, GameReadStep, IpcResult, LeftOutEntity, LeftOutReason } from "../../../desktop/src/ipc.ts";

export const STEP_LABELS: Readonly<Record<GameReadStep, string>> = {
  prepare: "preparing a private folder for the game",
  data: "the game loads its data and your mods",
  locale: "the game writes the names of its prototypes",
  runtime: "the game runs a scenario that reports its finished prototypes",
  collect: "building the entity and signal tables",
};

export const BUILT_IN_DETAIL = "The entities and signals of the standard game, as they come with this app";
export const GAME_DETAIL = "The entities and signals of your installed game";
export const MODDED_DETAIL = "The entities and signals of your installed game, with those of its mods";
export const STALE_NOTICE = "Your game or its mods have changed since this data was read. Read the game again to work with what it has now.";
export const CANCELLED_NOTICE = "Reading the game was cancelled. Nothing changed.";
export const CONFIRMING_NOTICE = "Waiting for your answer in the dialog. Nothing has been started.";

/** Why the entities of a group were left out, in plain words. The order is the order of the groups. */
export const LEFT_OUT_REASON_TEXT: Readonly<Record<LeftOutReason, string>> = {
  "no-collision-box": "The game's data gives them no collision box, so they have no size.",
  "no-selection-box": "The game's data gives them no selection box, or an empty one, so there is nothing to click or to wire.",
  size: "The running game gives them another size in tiles than the game's data files do.",
  connection: "The game's data files and the running game do not agree on whether a circuit wire connects to them.",
  mismatch: "The running game says something else about them than the game's data files do.",
  "unknown-type": "They are of a type of entity the editor has no rules for.",
  other: "The game's data about them does not fit together in another way.",
};
export const LEFT_OUT_TOGGLE = "Left-out entities";
export const LEFT_OUT_COPY = "Copy list";

export interface LeftOutGroup {
  readonly reason: LeftOutReason;
  /** The reason in plain words. */
  readonly text: string;
  /** What was found, in the words of the build, when it is the same for every entity of the group. */
  readonly found: string | null;
  /** By name. `found`: what was found about this one, when the group has no common finding. */
  readonly entities: readonly { readonly name: string; readonly found: string | null }[];
}

export interface LeftOutView {
  /** How many there are and what that means: the line that is always shown. */
  readonly summary: string;
  readonly groups: readonly LeftOutGroup[];
  /** The list as plain text, for the clipboard. */
  readonly copyText: string;
}

/** The entities a read of the game left out, grouped by reason; null when there are none. Names and findings are the game's and its mods': text. */
export function leftOutView(leftOut: readonly LeftOutEntity[]): LeftOutView | null {
  if (leftOut.length === 0) return null;
  const one = leftOut.length === 1;
  const summary = `${leftOut.length} ${one ? "entity of your game was" : "entities of your game were"} left out: ${one ? "it" : "they"} cannot be placed or imported, because the game's data about ${one ? "it" : "them"} does not fit together. Such entities are mostly internal helper entities of mods.`;
  const groups = (Object.keys(LEFT_OUT_REASON_TEXT) as LeftOutReason[]).flatMap((reason): LeftOutGroup[] => {
    const members = leftOut.filter((entity) => entity.reason === reason).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (members.length === 0) return [];
    const shared = members.every((entity) => entity.detail === members[0]!.detail);
    const found = (detail: string): string | null => (detail === "" ? null : detail);
    return [{ reason, text: LEFT_OUT_REASON_TEXT[reason], found: shared ? found(members[0]!.detail) : null, entities: members.map(({ name, detail }) => ({ name, found: shared ? null : found(detail) })) }];
  });
  const paragraphs = groups.map((group) => [`${group.text} (${group.entities.length})`, ...(group.found === null ? [] : [`Found: ${group.found}`]), ...group.entities.map((entity) => (entity.found === null ? entity.name : `${entity.name}: ${entity.found}`))].join("\n"));
  return { summary, groups, copyText: [`Entities of the game that were left out: ${leftOut.length}`, ...paragraphs].join("\n\n") + "\n" };
}

/** Minutes and seconds: "0:07", "1:23". */
export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const isBusy = (run: GameDataRun): boolean => run.state === "confirming" || run.state === "running";

export interface GameDataView {
  readonly kind: "built-in" | "game";
  /** "Built in, Factorio 2.1.24", or "Read from your game on 14 November 2026: 2.1.24 with 3 mods". */
  readonly source: string;
  /** What that means for the editor, in a line under it. */
  readonly detail: string;
  readonly stale: string | null;
  /** Why data read earlier is not in use. */
  readonly problem: string | null;
  /** Other data waits for the window to be loaded again: what it is. */
  readonly pending: string | null;
  readonly phase: GameDataRun["state"];
  /** While the game runs: "Step 2 of 5: the game loads its data and your mods", and when it began. */
  readonly progress: { readonly text: string; readonly index: number; readonly count: number; readonly startedAt: number } | null;
  readonly failure: { readonly message: string; readonly log: string } | null;
  /** How the last request ended, when it did not fail: read in so many seconds, or cancelled. */
  readonly outcome: string | null;
  readonly warnings: readonly string[];
  /** The entities missing from the data read from the game, whatever became of the last request. */
  readonly leftOut: LeftOutView | null;
  readonly canRead: boolean;
  /** Why the game cannot be read, under the disabled button. */
  readonly unavailable: string | null;
  readonly canDiscard: boolean;
  readonly canReload: boolean;
}

/** `requesting`: a request that is answered at once (discarding, loading the window again) is on its way. */
export function gameDataView(status: GameDataStatus, requesting = false, formatDate?: (iso: string) => string): GameDataView {
  const { run } = status;
  const busy = isBusy(run) || requesting;
  const seconds = run.state === "done" ? run.steps.reduce((sum, step) => sum + step.seconds, 0) : 0;
  return {
    kind: status.inUse.kind,
    source: describeGameDataSource(status.inUse, formatDate),
    detail: status.inUse.kind === "built-in" ? BUILT_IN_DETAIL : status.inUse.mods > 0 ? MODDED_DETAIL : GAME_DETAIL,
    stale: status.stale ? STALE_NOTICE : null,
    problem: status.problem,
    pending: status.pending && `${describeGameDataSource(status.pending, formatDate)}. It is used once the window has been loaded again.`,
    phase: run.state,
    progress: run.state === "running" ? { text: `Step ${run.index} of ${run.count}: ${STEP_LABELS[run.step]}`, index: run.index, count: run.count, startedAt: Date.parse(run.startedAt) } : null,
    failure: run.state === "failed" ? { message: run.message, log: run.log } : null,
    outcome: run.state === "done" ? `The game was read in ${Math.max(1, Math.round(seconds))} ${Math.round(seconds) <= 1 ? "second" : "seconds"}.` : run.state === "cancelled" ? CANCELLED_NOTICE : null,
    warnings: run.state === "done" || run.state === "failed" ? run.warnings : [],
    leftOut: leftOutView(status.leftOut),
    canRead: !busy && status.unavailable === null,
    unavailable: status.unavailable,
    canDiscard: !busy && status.discardable,
    canReload: !busy && status.pending !== null,
  };
}

export interface GameDataState {
  readonly status: GameDataStatus | undefined;
  /** A request that is answered at once is on its way. */
  readonly requesting: boolean;
  /** Why the last request could not be made at all. */
  readonly error: string | null;
}

export const INITIAL_GAME_DATA: GameDataState = { status: undefined, requesting: false, error: null };

export type GameDataEvent =
  /** `quick`: answered at once, and the buttons wait for it. Reading the game is not: its progress arrives as `run`. */
  | { readonly type: "requested"; readonly quick: boolean }
  | { readonly type: "answered"; readonly result: IpcResult<GameDataStatus | null>; readonly quick: boolean }
  | { readonly type: "failed"; readonly error: string; readonly quick: boolean }
  | { readonly type: "run"; readonly run: GameDataRun };

export function reduceGameData(state: GameDataState, event: GameDataEvent): GameDataState {
  switch (event.type) {
    case "requested":
      return { ...state, requesting: state.requesting || event.quick, error: null };
    case "answered": {
      const requesting = event.quick ? false : state.requesting;
      if (!event.result.ok) return { ...state, requesting, error: event.result.error };
      return { status: event.result.value ?? state.status, requesting, error: null };
    }
    case "failed":
      return { ...state, requesting: event.quick ? false : state.requesting, error: event.error };
    case "run":
      return state.status ? { ...state, status: { ...state.status, run: event.run } } : state;
  }
}

/** True when a request has ended and the rest of the status (what is waiting, whether the game can be read) is worth asking for again. */
export function hasEnded(run: GameDataRun): boolean {
  return !isBusy(run);
}
