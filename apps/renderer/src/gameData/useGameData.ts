// The game data as the main process reports it: where it comes from and where a request to read the game stands. Everything
// is done by asking the main process, which asks the user itself before it runs the game. Other data is applied by loading
// the window again, after the unsaved-changes prompt of the session.
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { FaceApi, GameDataStatus, IpcResult } from "../../../desktop/src/ipc.ts";
import { hasEnded, INITIAL_GAME_DATA, reduceGameData, type GameDataState } from "./gameDataView.ts";
import { forgetSettingsOpen, rememberSettingsOpen } from "./reopen.ts";

export interface GameDataController extends GameDataState {
  /** Asks for the status again: the game and its mods may have changed since it was last looked at. */
  refresh(): void;
  /** Asks the main process to read the game; it asks the user first. */
  read(): void;
  cancel(): void;
  /** Back to the built-in data. */
  discard(): void;
  /** Loads the window again, for data that is waiting. */
  reload(): void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * `reloadWindow`: the session's command, which asks about unsaved changes and resolves false when the window stays.
 * `installation`: anything that changes when the installation in use does; the status is asked for again then.
 */
export function useGameData(api: FaceApi | undefined, reloadWindow: () => Promise<boolean>, installation?: unknown): GameDataController | undefined {
  const [state, dispatch] = useReducer(reduceGameData, INITIAL_GAME_DATA);
  const reloadRef = useRef(reloadWindow);
  reloadRef.current = reloadWindow;

  const request = useCallback(async (call: () => Promise<IpcResult<GameDataStatus>>, quick: boolean): Promise<GameDataStatus | undefined> => {
    dispatch({ type: "requested", quick });
    try {
      const result = await call();
      dispatch({ type: "answered", result, quick });
      return result.ok ? result.value : undefined;
    } catch (error) {
      dispatch({ type: "failed", error: messageOf(error), quick });
      return undefined;
    }
  }, []);

  /** Loads the window again when other data waits; the settings dialog comes back with the new window. */
  const apply = useCallback(async (status: GameDataStatus | undefined): Promise<void> => {
    if (!status?.pending) return;
    rememberSettingsOpen();
    if (!(await reloadRef.current().catch(() => false))) forgetSettingsOpen();
  }, []);

  useEffect(() => {
    if (!api) return;
    return api.onGameDataRunChanged((run) => {
      dispatch({ type: "run", run });
      if (hasEnded(run)) void request(() => api.getGameDataStatus(), false);
    });
  }, [api, request]);

  useEffect(() => {
    if (api) void request(() => api.getGameDataStatus(), false);
  }, [api, request, installation]);

  return useMemo(() => {
    if (!api) return undefined;
    return {
      ...state,
      refresh: () => void request(() => api.getGameDataStatus(), false),
      read: () => void request(() => api.readGameData(), false).then((status) => (status?.run.state === "done" ? apply(status) : undefined)),
      cancel: () => void request(() => api.cancelGameDataRead(), false),
      discard: () => void request(() => api.discardGameData(), true).then(apply),
      reload: () => void apply(state.status),
    };
  }, [api, state, request, apply]);
}
