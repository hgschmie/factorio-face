// React binding of the project session. The session object is created once and lives as long as the component.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { FaceApi, HiddenModuleItems } from "../../../desktop/src/ipc.ts";
import type { DataInUse } from "../gameData/dataInUse.ts";
import type { WorkbenchCommands, WorkbenchController, WorkbenchState } from "../workbench/controller.ts";
import { ProjectSession } from "./projectSession.ts";

/** Read access for scripted checks (end-to-end tests, measurements): the same state and commands the views use. */
export interface SessionProbe {
  getState(): WorkbenchState;
  readonly commands: WorkbenchCommands;
}

declare global {
  interface Window {
    faceSession?: SessionProbe;
  }
}

/** `data`: the game data the window works with, already applied (`loadDataInUse`). `hidden`: what the user hid of the modules, as the window starts with it. */
export function useProjectSession(api: FaceApi | undefined, data?: DataInUse, hidden?: readonly HiddenModuleItems[]): WorkbenchController {
  const [session] = useState(() => new ProjectSession({ api, data, hidden }));
  // The window shows the empty project at once; the project that was open last replaces it when it has been read.
  useEffect(() => void session.start(), [session]);
  useEffect(() => {
    window.faceSession = { getState: () => session.state, commands: session.commands };
    return () => {
      delete window.faceSession;
    };
  }, [session]);
  // The session is not disposed on unmount: React's development double-mount would stop a simulation that is meant to keep running.
  return useSyncExternalStore(session.subscribe, session.getController);
}
