// Whose a cut, copy or paste is while text of the page and entities of the canvas can both be selected.
import { describe, expect, it } from "vitest";
import { clipboardIsForEntities, type ClipboardSituation } from "../src/textSelection.ts";

const CANVAS: ClipboardSituation = { focusOnText: false, textSelected: false, editable: true, canPaste: true };
const forEntities = (situation: Partial<ClipboardSituation>): boolean[] => (["cut", "copy", "paste"] as const).map((type) => clipboardIsForEntities(type, { ...CANVAS, ...situation }));

describe("the clipboard rule", () => {
  it("gives cut, copy and paste to the entities while nothing of the page's text is selected", () => {
    expect(forEntities({})).toEqual([true, true, true]);
  });

  it("gives a copy to selected text of the page, whatever entities are selected; such text cannot be cut, and a paste is still one of entities", () => {
    expect(forEntities({ textSelected: true })).toEqual([false, false, true]);
  });

  it("leaves all three to a text field, the source editor and a dialog", () => {
    expect(forEntities({ focusOnText: true })).toEqual([false, false, false]);
    expect(forEntities({ focusOnText: true, textSelected: true })).toEqual([false, false, false]);
  });

  it("only copies from a circuit that cannot be edited, and pastes nothing where the display mode takes no paste", () => {
    expect(forEntities({ editable: false })).toEqual([false, true, false]);
    expect(forEntities({ canPaste: false })).toEqual([true, true, false]);
    expect(forEntities({ editable: false, textSelected: true })).toEqual([false, false, false]);
  });
});
