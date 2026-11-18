import { describe, expect, it } from "vitest";
import { buildTextContextMenu, type TextContext } from "../src/contextMenu.ts";

const ALL = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const NONE = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false };
const context = (overrides: Partial<TextContext> = {}): TextContext => ({ isEditable: false, selectionText: "", editFlags: NONE, ...overrides });
const items = (overrides?: Partial<TextContext>): string[] => buildTextContextMenu(context(overrides)).map((item) => (item.type === "separator" ? "-" : `${item.role}${item.enabled === false ? " (off)" : ""}`));

describe("native context menu for text", () => {
  it("has no menu where there is neither selected text nor a text field: a button, a heading, the canvas", () => {
    expect(items()).toEqual([]);
    expect(items({ selectionText: " \n\t", editFlags: ALL })).toEqual([]);
  });

  it("offers Copy, and nothing else, for selected text of the page", () => {
    expect(items({ selectionText: "31 entities of your game were left out", editFlags: { ...NONE, canCopy: true } })).toEqual(["copy"]);
  });

  it("offers the editing items in a text field, each as far as the field allows it", () => {
    expect(items({ isEditable: true, selectionText: "decider", editFlags: ALL })).toEqual(["cut", "copy", "paste", "-", "selectAll"]);
    expect(items({ isEditable: true, editFlags: { ...NONE, canPaste: true } })).toEqual(["cut (off)", "copy (off)", "paste", "-", "selectAll (off)"]);
  });

  it("consists of roles alone: nothing of the page's text reaches a label, and nothing is done in the main process", () => {
    for (const template of [buildTextContextMenu(context({ selectionText: "x" })), buildTextContextMenu(context({ isEditable: true, editFlags: ALL }))]) {
      for (const item of template) expect(Object.keys(item).filter((key) => key !== "role" && key !== "enabled" && key !== "type")).toEqual([]);
    }
  });
});
