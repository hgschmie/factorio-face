// Edit > Select All for a control that has rows of its own to select. The key of that menu item may never reach the page as a
// key (the menu takes it), so the command is offered to the control with the focus as an event, which a list takes by
// preventing its default. Nothing else is told about it.
export const SELECT_ALL_EVENT = "face:select-all";

/** Offers Select All to the control with the focus; true when a control took it. */
export function offerSelectAll(target: Element | null): boolean {
  return target !== null && !target.dispatchEvent(new CustomEvent(SELECT_ALL_EVENT, { bubbles: true, cancelable: true }));
}
