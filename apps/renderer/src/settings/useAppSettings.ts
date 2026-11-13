// The settings of the application as the main process reports them: read once, followed through its change event, and
// changed only by asking the main process (which shows the folder chooser itself).
import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { AppSettingsState, FaceApi, IpcResult } from "../../../desktop/src/ipc.ts";
import { INITIAL_APP_SETTINGS, reduceAppSettings, type AppSettingsStatus } from "./appSettings.ts";

export interface AppSettingsController extends AppSettingsStatus {
  /** Opens the native chooser for the game folder. */
  chooseGameFolder(): void;
  /** Back to auto-detection. */
  resetGameFolder(): void;
}

export function useAppSettings(api: FaceApi | undefined): AppSettingsController | undefined {
  const [status, dispatch] = useReducer(reduceAppSettings, INITIAL_APP_SETTINGS);

  const request = useCallback((call: () => Promise<IpcResult<AppSettingsState | null>>): void => {
    dispatch({ type: "requested" });
    call().then(
      (result) => dispatch({ type: "answered", result }),
      (error: unknown) => dispatch({ type: "failed", error: error instanceof Error ? error.message : String(error) }),
    );
  }, []);

  useEffect(() => {
    if (!api) return;
    const off = api.onAppSettingsChanged((state) => dispatch({ type: "changed", state }));
    request(() => api.getAppSettings());
    return off;
  }, [api, request]);

  return useMemo(() => {
    if (!api) return undefined;
    return { ...status, chooseGameFolder: () => request(() => api.chooseGameFolder()), resetGameFolder: () => request(() => api.resetGameFolder()) };
  }, [api, status, request]);
}
