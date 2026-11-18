// For a panel that opens from a button and is no modal dialog: the project settings, the signal picker.
import { useCallback, useState } from "react";

/**
 * Remembers what had the focus when the panel opened, which is the button that opened it, and returns the function that gives
 * the focus back to it. A panel calls it where it closes by a key, by its close button or by a choice. Where a press elsewhere
 * closes the panel it does not: the focus goes where the press takes it.
 */
export function useFocusReturn(): () => void {
  const [opener] = useState(() => document.activeElement);
  return useCallback(() => {
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, [opener]);
}
