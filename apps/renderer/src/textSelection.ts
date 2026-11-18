// Text of the page that the user selects and copies. Where text can be selected is the stylesheet's rule (styles/base.css): text
// that informs can, controls and the canvas cannot. Here: whose a cut, copy or paste is while both text and entities are
// selected, a selection that is dropped when the user turns to something else, and a copy the page starts itself.

/** Where a cut, copy or paste event finds the page. */
export interface ClipboardSituation {
  /** The focus is in a text control, in the source editor or in a dialog: the event is about text there. */
  readonly focusOnText: boolean;
  /** Text of the page outside an editable field is selected (`pageTextIsSelected`). */
  readonly textSelected: boolean;
  readonly editable: boolean;
  /** The display mode takes pasted entities. */
  readonly canPaste: boolean;
}

/**
 * True when the event is about the entities of the canvas: its selection is cut or copied, or entities are pasted. False leaves
 * the event to the browser, which copies selected text. Selected text of the page wins over selected entities: it is what the
 * user selected last and sees highlighted, and a press on the canvas drops it (`dropTextSelectionOnPress`). A cut is left alone
 * then as well, and does nothing: such text cannot be cut. A paste is never about text outside a field.
 */
export function clipboardIsForEntities(type: "cut" | "copy" | "paste", { focusOnText, textSelected, editable, canPaste }: ClipboardSituation): boolean {
  if (focusOnText) return false;
  if (type === "paste") return editable && canPaste;
  if (textSelected) return false;
  return type === "copy" || editable;
}

/** True when text of the page itself, such as a message, is selected. A selection left behind in the source editor does not count. */
export function pageTextIsSelected(): boolean {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
  return anchor != null && anchor.closest(".cm-editor") === null;
}

/** Whether a press there can begin a selection: the nearest `user-select` that says so, whether the engine inherits the property or not. */
function isSelectable(target: Element): boolean {
  for (let element: Element | null = target; element; element = element.parentElement) {
    const value = getComputedStyle(element).userSelect;
    if (value !== "auto") return value !== "none";
  }
  return true;
}

/**
 * For `pointerdown` on the document: a press on something that cannot be selected (a control, the canvas) drops the selected
 * text of the page. The browser would keep it, and the next copy, the one of the canvas menu included, would take that text
 * instead of the entities the user has turned to. A press on text is the browser's: it keeps or replaces the selection, and
 * the native context menu offers its Copy there.
 */
export function dropTextSelectionOnPress(event: PointerEvent): void {
  if (!(event.target instanceof Element) || isSelectable(event.target) || !pageTextIsSelected()) return;
  document.getSelection()?.removeAllRanges();
}

/** True when text is selected in or across the element: a click on it then is the end of that selection, not a press on a control. */
export function hasSelectionInside(element: Element): boolean {
  const selection = document.getSelection();
  return selection !== null && !selection.isCollapsed && selection.containsNode(element, true);
}

/**
 * Puts text on the clipboard with a copy the page starts, which it may on a click; the clipboard itself is out of the page's
 * reach. The text is handed over in the copy event, ahead of every other listener. True when the copy was made.
 */
export function copyText(text: string): boolean {
  let handed = false;
  const onCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    event.stopPropagation();
    handed = true;
  };
  document.addEventListener("copy", onCopy, true);
  try {
    document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }
  return handed;
}
