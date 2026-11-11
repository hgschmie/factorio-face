import type { FaceApi } from "../../desktop/src/ipc.ts";

declare global {
  interface Window {
    /** Exposed by the Electron preload script; undefined when the renderer runs in a plain browser. */
    readonly face?: FaceApi;
  }
}
