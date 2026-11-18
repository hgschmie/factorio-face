// The native context menu for text. The page has menus of its own where it needs them (the canvas), and prevents the event
// there, so this one is never asked; everywhere else Electron shows nothing unless the main process does. Selected text of
// the page gets Copy, a text field the editing items; anything else gets no menu. The items are roles: they act on the page
// as Edit > Cut, Copy and Paste do, through its clipboard events, so the renderer's rule for them holds here too.
import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";

export type TextContext = Pick<ContextMenuParams, "isEditable" | "selectionText"> & { readonly editFlags: Pick<ContextMenuParams["editFlags"], "canCut" | "canCopy" | "canPaste" | "canSelectAll"> };

/** The items for a right press there; none when there is nothing to do with text. */
export function buildTextContextMenu({ isEditable, selectionText, editFlags }: TextContext): MenuItemConstructorOptions[] {
  if (isEditable) {
    return [{ role: "cut", enabled: editFlags.canCut }, { role: "copy", enabled: editFlags.canCopy }, { role: "paste", enabled: editFlags.canPaste }, { type: "separator" }, { role: "selectAll", enabled: editFlags.canSelectAll }];
  }
  return selectionText.trim() === "" ? [] : [{ role: "copy" }];
}
