// What the status line says about the source and about the project file. Pure.
import type { ProjectView } from "./controller.ts";

export type StatusLevel = "ok" | "error" | "checking";

export interface StatusLead {
  readonly level: StatusLevel;
  readonly text: string;
  /** What the light means, for its tooltip. */
  readonly title: string;
}

/**
 * The lead of the status line: whether the source has errors and whether the canvas can edit. `editable` is false while the
 * source has errors and while its analysis has not caught up with the text.
 */
export function statusLead(errors: number, editable: boolean): StatusLead {
  if (errors > 0) {
    return {
      level: "error",
      text: `${errors} ${errors === 1 ? "error" : "errors"} in source, canvas is read-only`,
      title: "Red: the source has errors. The canvas shows the last valid circuit and cannot edit it until they are fixed; the problems are listed under the source.",
    };
  }
  if (editable) return { level: "ok", text: "No errors", title: "Green: the source has no errors, so the canvas shows it as it is and can edit it." };
  return { level: "checking", text: "Checking the source", title: "Amber: the source is being checked. The canvas can edit again once that is done." };
}

export const NOT_SAVED_YET = "Not saved yet";

/** Whether the project differs from its file: "Unsaved changes", "All changes saved", and "No changes" for one that has no file yet. */
export function saveStateText(project: Pick<ProjectView, "path" | "dirty">): string {
  return project.dirty ? "Unsaved changes" : project.path ? "All changes saved" : "No changes";
}

/**
 * A path in two parts for a line that shortens it in the middle: the folders, which give way first, and the last separator
 * with the file name, which stays. Together they are the path as it is.
 */
export function splitPath(path: string): readonly [head: string, tail: string] {
  // The separator the path ends in does not count: a folder is its own last part.
  const cut = Math.max(path.lastIndexOf("/", path.length - 2), path.lastIndexOf("\\", path.length - 2));
  return cut <= 0 ? ["", path] : [path.slice(0, cut), path.slice(cut)];
}
