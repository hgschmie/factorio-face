// Platform-dependent labels for keyboard shortcuts shown in the UI.
export const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

export const SHORTCUT = {
  delete: IS_MAC ? "⌫" : "Del",
  selectAll: IS_MAC ? "⌘A" : "Ctrl+A",
  cut: IS_MAC ? "⌘X" : "Ctrl+X",
  copy: IS_MAC ? "⌘C" : "Ctrl+C",
  undo: IS_MAC ? "⌘Z" : "Ctrl+Z",
  redo: IS_MAC ? "⇧⌘Z" : "Ctrl+Y",
  save: IS_MAC ? "⌘S" : "Ctrl+S",
  fit: IS_MAC ? "⌘0" : "Ctrl+0",
} as const;

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
