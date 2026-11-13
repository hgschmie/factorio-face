// The application settings in the renderer: icon URLs per icon revision, what the dialog says about an installation, when
// the hint is due, and which report about the settings counts.
import { describe, expect, it } from "vitest";
import type { AppSettingsState } from "../../desktop/src/ipc.ts";
import { catalogEntityIconUrl } from "../src/icons/catalogEntityIcons.ts";
import { catalogIconUrl, revisionQuery } from "../src/icons/catalogSignalIcons.ts";
import { appSettingsView, gameFolderHint, INITIAL_APP_SETTINGS, needsGameFolderHint, newerSettings, NO_INSTALLATION, reduceAppSettings, type AppSettingsStatus } from "../src/settings/appSettings.ts";

const BASE = "face-asset://catalog/";
const MODULES = ["base", "core", "space-age", "quality", "elevated-rails", "recycler"];
const NO_GAME = { chosenFolder: null, dataDirectory: null, source: "none", gameVersion: null, versionMatch: null, modules: [], problem: null } as const;
const NONE: AppSettingsState = { ...NO_GAME, catalogVersion: "2.1.24", iconRevision: 0 };
const DATA = "/Applications/factorio.app/Contents/data";
const DETECTED: AppSettingsState = { ...NONE, dataDirectory: DATA, source: "detected", gameVersion: "2.1.24", versionMatch: "equal", modules: MODULES.map((name) => ({ name, present: true })) };
const CHOSEN: AppSettingsState = { ...DETECTED, chosenFolder: "/Applications/factorio.app", source: "chosen" };
const UNUSABLE: AppSettingsState = { ...NONE, chosenFolder: "/Volumes/Games/factorio", source: "chosen", problem: "This folder does not exist or cannot be read: /Volumes/Games/factorio" };

describe("icon URLs", () => {
  it("are the plain URLs for the installation found at start", () => {
    expect(revisionQuery(0)).toBe("");
    expect(catalogIconUrl(BASE, "item/carbon-fiber")).toBe("face-asset://catalog/icons/item/carbon-fiber.png");
    expect(catalogIconUrl(BASE, "item/carbon-fiber", 0)).toBe("face-asset://catalog/icons/item/carbon-fiber.png");
    expect(catalogEntityIconUrl(BASE, "constant-combinator")).toBe("face-asset://catalog/icons/item/constant-combinator.png");
  });

  it("carry the icon revision once the installation has changed, so the images are fetched again", () => {
    expect(revisionQuery(1)).toBe("?r=1");
    expect(catalogIconUrl(BASE, "virtual/signal-A", 1)).toBe("face-asset://catalog/icons/virtual/signal-A.png?r=1");
    expect(catalogIconUrl(BASE, "virtual/signal-A", 12)).toBe("face-asset://catalog/icons/virtual/signal-A.png?r=12");
    expect(catalogEntityIconUrl(BASE, "small-lamp", 3)).toBe("face-asset://catalog/icons/item/small-lamp.png?r=3");
    expect(catalogEntityIconUrl(BASE, "small-lamp", 3)).not.toBe(catalogEntityIconUrl(BASE, "small-lamp", 4));
  });
});

describe("what the dialog says", () => {
  it("without an installation", () => {
    const origin = "The app looked in the usual places for the game on this system";
    expect(appSettingsView(NONE)).toEqual({ folder: NO_INSTALLATION, found: false, origin, dataDirectory: null, version: null, modulesFound: [], modulesMissing: [], problem: null, canReset: false });
    expect(NO_INSTALLATION).toBe("No installation found");
  });

  it("for an installation the app found", () => {
    const version = { text: "Factorio 2.1.24", note: null, level: "ok" };
    const nothingElse = { dataDirectory: null, modulesMissing: [], problem: null, canReset: false };
    expect(appSettingsView(DETECTED)).toEqual({ folder: DATA, found: true, origin: "Found automatically", version, modulesFound: MODULES, ...nothingElse });
  });

  it("for a chosen folder: the folder as chosen, where the icons are read, and a way back", () => {
    expect(appSettingsView(CHOSEN)).toMatchObject({ folder: "/Applications/factorio.app", origin: "Chosen by you", dataDirectory: DATA, canReset: true });
    // The data directory itself was chosen: it is not named twice.
    expect(appSettingsView({ ...CHOSEN, chosenFolder: DATA })).toMatchObject({ folder: DATA, dataDirectory: null, canReset: true });
  });

  it("for a chosen folder that cannot be used: it stays the folder, with its problem", () => {
    expect(appSettingsView(UNUSABLE)).toEqual({
      folder: "/Volumes/Games/factorio", found: true, origin: "Chosen by you", dataDirectory: null, version: null, modulesFound: [], modulesMissing: [], problem: UNUSABLE.problem, canReset: true,
    });
  });

  it("with a note for another patch release and a warning for another release line", () => {
    const patch = appSettingsView({ ...DETECTED, gameVersion: "2.1.30", versionMatch: "same-minor" }).version!;
    expect([patch.text, patch.level]).toEqual(["Factorio 2.1.30", "note"]);
    expect(patch.note).toContain("2.1.24");
    expect(patch.note).toContain("Within 2.1 ");
    const other = appSettingsView({ ...DETECTED, gameVersion: "2.0.72", versionMatch: "different" }).version!;
    expect([other.text, other.level]).toEqual(["Factorio 2.0.72", "warning"]);
    expect(other.note).toContain("2.1.24");
    expect(other.note).toContain("used all the same");
  });

  it("with the modules that are there and those that are not", () => {
    const view = appSettingsView({ ...DETECTED, modules: MODULES.map((name) => ({ name, present: name !== "space-age" && name !== "recycler" })) });
    expect([view.modulesFound, view.modulesMissing]).toEqual([["base", "core", "quality", "elevated-rails"], ["space-age", "recycler"]]);
  });
});

describe("the hint", () => {
  it("is due when no installation is in use and no icons are bundled either", () => {
    expect(needsGameFolderHint(NONE, true)).toBe(true);
    expect(needsGameFolderHint(UNUSABLE, true)).toBe(true);
    // Bundled icons are shown, or it is not known yet whether there are any.
    expect(needsGameFolderHint(NONE, false)).toBe(false);
    // An installation is in use; an icon that fails to load then is another matter.
    expect(needsGameFolderHint(DETECTED, true)).toBe(false);
    expect(needsGameFolderHint(CHOSEN, true)).toBe(false);
    // Before the main process has answered.
    expect(needsGameFolderHint(undefined, true)).toBe(false);
  });

  it("says whether nothing was found or the chosen folder is the trouble", () => {
    expect(gameFolderHint(NONE).text).toBe("No Factorio installation found");
    expect(gameFolderHint(UNUSABLE).text).toBe("The chosen Factorio folder cannot be used");
    for (const state of [NONE, UNUSABLE]) expect(gameFolderHint(state).detail).toContain(`${gameFolderHint(state).text}, so signals and entities are shown without the game's icons.`);
  });
});

describe("the settings state", () => {
  const loaded: AppSettingsStatus = { state: DETECTED, busy: false, error: null };
  const changed: AppSettingsState = { ...CHOSEN, iconRevision: 1 };

  it("starts empty, is busy during a request and takes its answer", () => {
    const requested = reduceAppSettings(INITIAL_APP_SETTINGS, { type: "requested" });
    expect(requested).toEqual({ state: undefined, busy: true, error: null });
    expect(reduceAppSettings(requested, { type: "answered", result: { ok: true, value: DETECTED } })).toEqual(loaded);
  });

  it("keeps the state when the chooser was cancelled", () => {
    const busy = reduceAppSettings(loaded, { type: "requested" });
    expect(reduceAppSettings(busy, { type: "answered", result: { ok: true, value: null } })).toEqual(loaded);
  });

  it("keeps the state and shows the reason when a folder was refused, until the next request", () => {
    const refused = reduceAppSettings(reduceAppSettings(loaded, { type: "requested" }), { type: "answered", result: { ok: false, error: "This folder does not contain the game's data: /tmp" } });
    expect(refused).toEqual({ state: DETECTED, busy: false, error: "This folder does not contain the game's data: /tmp" });
    expect(reduceAppSettings(refused, { type: "requested" })).toEqual({ state: DETECTED, busy: true, error: null });
    expect(reduceAppSettings(reduceAppSettings(loaded, { type: "requested" }), { type: "failed", error: "gone" })).toEqual({ state: DETECTED, busy: false, error: "gone" });
  });

  it("takes a change from its event and from the answer alike, in either order", () => {
    const busy = reduceAppSettings(loaded, { type: "requested" });
    const eventFirst = reduceAppSettings(reduceAppSettings(busy, { type: "changed", state: changed }), { type: "answered", result: { ok: true, value: changed } });
    const answerFirst = reduceAppSettings(reduceAppSettings(busy, { type: "answered", result: { ok: true, value: changed } }), { type: "changed", state: changed });
    expect(eventFirst).toEqual({ state: changed, busy: false, error: null });
    expect(answerFirst).toEqual(eventFirst);
    // An event leaves a request that is still on its way alone.
    expect(reduceAppSettings(busy, { type: "changed", state: changed })).toEqual({ state: changed, busy: true, error: null });
  });

  it("never goes back to an older report", () => {
    expect(newerSettings(undefined, DETECTED)).toBe(DETECTED);
    expect(newerSettings(DETECTED, changed)).toBe(changed);
    expect(newerSettings(changed, DETECTED)).toBe(changed);
    const same = { ...changed };
    expect(newerSettings(changed, same)).toBe(same);
    // The first answer arrives after a change was already reported.
    const late = reduceAppSettings({ state: changed, busy: true, error: null }, { type: "answered", result: { ok: true, value: DETECTED } });
    expect(late.state).toBe(changed);
  });
});
