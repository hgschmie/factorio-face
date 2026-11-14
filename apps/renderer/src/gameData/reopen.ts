// Applying other game data loads the window again. The settings dialog the user was in comes back with it, so that the
// outcome of what they asked for is in front of them. Kept for the one reload in the session storage of the page.
const KEY = "face.reopen-app-settings";

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

export function rememberSettingsOpen(): void {
  try {
    storage()?.setItem(KEY, "1");
  } catch {
    // Without the storage the dialog stays closed after the reload.
  }
}

export function forgetSettingsOpen(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** True once after `rememberSettingsOpen`. */
export function takeSettingsOpen(): boolean {
  try {
    const open = storage()?.getItem(KEY) === "1";
    storage()?.removeItem(KEY);
    return open;
  } catch {
    return false;
  }
}
