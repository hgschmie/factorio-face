// The platform, and where keyboard input belongs. The shortcuts themselves are in shortcuts/shortcuts.ts.
export const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/** True for an input or text area that holds text the user types (not the source editor, which is no form control). */
export function isTextField(target: EventTarget | null): boolean {
  return (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && isTextEntryTarget(target);
}

/** True when keyboard input currently belongs to a text control or the source editor rather than to the canvas. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest(".cm-editor")) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "range", "color"].includes(target.type);
}

const ARROW_KEY_ROLES = '[role="radiogroup"], [role="listbox"], [role="tablist"], [role="menu"], [role="menubar"], [role="tree"], [role="grid"], [role="slider"], [role="spinbutton"], [role="combobox"]';

/** True when the arrow keys mean something to the control with the focus: text, a select, a slider, a radio group, a list, a menu. */
export function usesArrowKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isTextEntryTarget(target) || (target instanceof HTMLInputElement && ["radio", "range"].includes(target.type)) || target.closest(ARROW_KEY_ROLES) !== null;
}
