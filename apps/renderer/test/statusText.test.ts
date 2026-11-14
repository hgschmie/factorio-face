// What the status line says: the state of the source, whether the project is saved, and a path in the two parts it is shortened by.
import { describe, expect, it } from "vitest";
import { NOT_SAVED_YET, saveStateText, splitPath, statusLead } from "../src/workbench/statusText.ts";

describe("statusLead", () => {
  it("is green and says that there are no errors while the canvas can edit", () => {
    expect(statusLead(0, true)).toMatchObject({ level: "ok", text: "No errors" });
  });

  it("is red, counts the errors and says that the canvas is read-only", () => {
    expect(statusLead(1, false)).toMatchObject({ level: "error", text: "1 error in source, canvas is read-only" });
    expect(statusLead(3, false)).toMatchObject({ level: "error", text: "3 errors in source, canvas is read-only" });
    // Errors count whatever else is said: the canvas cannot edit a source with errors.
    expect(statusLead(2, true).level).toBe("error");
  });

  it("is amber while the source has no error but the canvas cannot edit yet: the analysis has not caught up", () => {
    expect(statusLead(0, false)).toMatchObject({ level: "checking", text: "Checking the source" });
  });

  it("explains each light in its tooltip, by its color", () => {
    expect(statusLead(0, true).title).toMatch(/^Green: .*no errors.*can edit/);
    expect(statusLead(2, false).title).toMatch(/^Red: .*errors.*last valid circuit/);
    expect(statusLead(0, false).title).toMatch(/^Amber: .*being checked/);
  });
});

describe("saveStateText", () => {
  it("tells a project without a file from a saved one, and unsaved changes from both", () => {
    expect(saveStateText({ path: null, dirty: false })).toBe("No changes");
    expect(saveStateText({ path: null, dirty: true })).toBe("Unsaved changes");
    expect(saveStateText({ path: "/p/a.faceproj", dirty: false })).toBe("All changes saved");
    expect(saveStateText({ path: "/p/a.faceproj", dirty: true })).toBe("Unsaved changes");
    expect(NOT_SAVED_YET).toBe("Not saved yet");
  });
});

describe("splitPath", () => {
  it("splits before the last separator, so that the file name stays when the folders are cut off", () => {
    expect(splitPath("/Users/me/projects/circuits/Counter.faceproj")).toEqual(["/Users/me/projects/circuits", "/Counter.faceproj"]);
    expect(splitPath("C:\\Users\\me\\Counter.faceproj")).toEqual(["C:\\Users\\me", "\\Counter.faceproj"]);
    expect(splitPath("C:/Users/me\\Counter.faceproj")).toEqual(["C:/Users/me", "\\Counter.faceproj"]);
    expect(splitPath("/Users/me/folder/")).toEqual(["/Users/me", "/folder/"]);
  });

  it("keeps a text without folders in one piece", () => {
    expect(splitPath("Counter.faceproj")).toEqual(["", "Counter.faceproj"]);
    expect(splitPath("/Counter.faceproj")).toEqual(["", "/Counter.faceproj"]);
    expect(splitPath(NOT_SAVED_YET)).toEqual(["", NOT_SAVED_YET]);
    expect(splitPath("")).toEqual(["", ""]);
  });

  it("gives back the path as it is when the parts are joined", () => {
    for (const path of ["/a/b/c.faceproj", "C:\\a\\b.faceproj", "relative/x", "/", "//", "a/"]) expect(splitPath(path).join(""), path).toBe(path);
  });
});
