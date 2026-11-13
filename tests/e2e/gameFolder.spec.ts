// The game installation: icons rendered from it, the application settings dialog, choosing and resetting the folder. Every
// installation here is built by the test (fakeGame.ts); the bundled icons are switched off so only the installation counts.
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AppSettingsState } from "../../apps/desktop/src/ipc.ts";
import { placeholderIcon } from "../../apps/desktop/src/gameIcons/placeholder.ts";
import { APP_TITLE, clickMenu, closeApp, dialogCalls, expect, launchApp, NO_GAME_DIR, SCREENSHOT_DIR, selectEntity, stubDialogs, test, USER_DATA_DIR, type RunningApp } from "./app.ts";
import { BLUE, emptyFolder, fetchAsset, iconStrip, ORANGE, pngFacts, RED, VIOLET, writeFakeGame } from "./fakeGame.ts";

const ICONS = "face-asset://catalog/icons/";
const PLACEHOLDER = new Uint8Array(placeholderIcon());
const SETTINGS_MENU = process.platform === "darwin" ? [APP_TITLE, "Settings..."] : ["File", "Settings..."];
const BASE_ICONS = { "base/graphics/icons/constant-combinator.png": BLUE, "base/graphics/icons/decider-combinator.png": ORANGE };

/** Launches the app without bundled icons. `gameFolder` is where auto-detection looks; without it there is no game. */
async function launch(options: { readonly gameFolder?: string; readonly userData?: string } = {}): Promise<RunningApp> {
  return launchApp({ userData: options.userData, env: { FACE_ASSET_ROOT: await emptyFolder(), ...(options.gameFolder === undefined ? {} : { FACE_GAME_DIR: options.gameFolder }) } });
}

const settingsDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Application settings" });

async function openSettings(app: ElectronApplication, page: Page): Promise<Locator> {
  await clickMenu(app, ...SETTINGS_MENU);
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function settingsState(page: Page): Promise<AppSettingsState> {
  const result = await page.evaluate(() => window.face!.getAppSettings());
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const paletteIcon = (page: Page, kind: string): Locator => page.locator(`.palette-item[data-kind="${kind}"] .entity-icon`);
const storedSettings = async (userData: string): Promise<unknown> => JSON.parse(await readFile(resolve(userData, "app-settings.json"), "utf8"));

test("renders icons from the installation it finds, and answers nothing else", async () => {
  const game = await writeFakeGame({ icons: BASE_ICONS });
  const { app, page, userData } = await launch({ gameFolder: game.folder });
  try {
    const found = { chosenFolder: null, dataDirectory: game.dataDirectory, source: "detected", gameVersion: "2.1.24", versionMatch: "equal", problem: null, iconRevision: 0 };
    expect(await settingsState(page)).toMatchObject(found);

    const signal = await fetchAsset(app, `${ICONS}virtual/signal-A.png`);
    expect([signal.status, signal.contentType, signal.sniffing]).toEqual([200, "image/png", "nosniff"]);
    expect(pngFacts(signal.bytes)).toEqual({ size: [64, 64], center: RED });
    expect(pngFacts((await fetchAsset(app, `${ICONS}item/constant-combinator.png`)).bytes).center).toEqual(BLUE);
    expect(pngFacts((await fetchAsset(app, `${ICONS}item/decider-combinator.png?r=7`)).bytes).center).toEqual(ORANGE);

    // Only ids of the icon table are answered, and no path reaches a file of the installation.
    const file = "base/graphics/icons/signal/signal_A.png";
    const unanswered = ["item/no-such-item.png", "../base/info.json", `../${file}`, file, "%2e%2e/%2e%2e/core/info.json", "virtual/signal-A.webp", "virtual/signal-A"];
    for (const path of unanswered) expect((await fetchAsset(app, ICONS + path)).status, path).toBe(404);
    expect((await fetchAsset(app, "face-asset://other/icons/virtual/signal-A.png").catch(() => ({ status: 404 }))).status).toBe(404);
    const posted = await app.evaluate(async ({ net }, url) => (await net.fetch(url, { method: "POST", body: "x" })).status, `${ICONS}virtual/signal-A.png`);
    expect(posted).toBe(405);

    // The window shows them: the palette entries, the cards, and the signals of the picker, under the same URLs as bundled icons.
    await expect(paletteIcon(page, "constant")).toHaveAttribute("src", `${ICONS}item/constant-combinator.png`);
    await expect.poll(() => paletteIcon(page, "constant").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(64);
    await expect(page.locator('g.card[data-kind="constant"] image[href$="icons/item/constant-combinator.png"]')).toHaveCount(1);
    await selectEntity(page, "source");
    await page.getByRole("complementary", { name: "Inspector" }).getByRole("button", { name: "Choose signal 1" }).click();
    const current = page.getByRole("dialog", { name: "Choose a signal" }).locator('[data-signal="virtual:signal-A"] img');
    await expect(current).toHaveAttribute("src", `${ICONS}virtual/signal-A.png`);
    await expect.poll(() => current.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(64);
    await page.keyboard.press("Escape");

    // Finding the game stores nothing, and nothing is written into the installation.
    expect(existsSync(resolve(userData, "app-settings.json"))).toBe(false);
    await expect(page.locator(".icon-hint")).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("shows the installation in the settings dialog, which opens from the menu and holds the keyboard", async () => {
  const game = await writeFakeGame({ modules: ["quality", "elevated-rails"] });
  const { app, page } = await launch({ gameFolder: game.folder });
  try {
    await page.locator("svg.canvas-svg").focus();
    const dialog = await openSettings(app, page);
    await expect(dialog.locator(".game-folder-path")).toHaveAttribute("data-source", "detected");
    await expect(dialog.locator(".game-folder-path .path")).toHaveText(game.dataDirectory);
    await expect(dialog.locator(".game-folder-path small")).toHaveText("Found automatically");
    await expect(dialog.locator('[data-fact="version"]')).toHaveAttribute("data-level", "ok");
    await expect(dialog.locator('[data-fact="version"] dd')).toHaveText("Factorio 2.1.24");
    await expect(dialog.locator('[data-fact="modules"] dd')).toContainText("base, core, quality, elevated-rails");
    await expect(dialog.locator('[data-fact="modules"] [data-missing]')).toHaveText("Not installed: space-age, recycler. Their icons are shown as placeholders.");
    await expect(dialog).toContainText("The app only reads icon images from this folder. It does not start the game and writes nothing there.");
    await expect(dialog.getByRole("button", { name: "Choose..." })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Reset to auto-detect" })).toBeDisabled();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "app-settings.png") });

    // The focus is in the dialog and stays there; keys of the circuit do nothing behind it.
    await expect(dialog.getByRole("button", { name: "Close application settings" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Choose..." })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close application settings" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Choose..." })).toBeFocused();
    await page.keyboard.press("2");
    await expect(page.locator(".palette-item[aria-pressed='true']")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("svg.canvas-svg")).toBeFocused();

    // A press beside it closes it as well.
    await openSettings(app, page);
    await page.mouse.click(20, 400);
    await expect(settingsDialog(page)).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("chooses a folder through the native dialog, keeps the choice across a restart and resets it", async () => {
  const game = await writeFakeGame({ icons: BASE_ICONS, bundle: true });
  const first = await launch();
  try {
    const { app, page, userData } = first;
    // No game: pictograms and names, and the hint.
    await expect(paletteIcon(page, "constant")).toHaveJSProperty("tagName", "svg");
    await expect(page.locator(".icon-hint")).toBeVisible();
    const dialog = await openSettings(app, page);
    await expect(dialog.locator(".game-folder-path .path")).toHaveText("No installation found");
    await expect(dialog.locator(".game-folder-path")).toHaveAttribute("data-source", "none");
    await expect(dialog.getByRole("button", { name: "Reset to auto-detect" })).toBeDisabled();

    await stubDialogs(app, { openPath: game.folder });
    await dialog.getByRole("button", { name: "Choose..." }).click();
    await expect(dialog.locator(".game-folder-path .path")).toHaveText(game.folder);
    await expect(dialog.locator(".game-folder-path small")).toHaveText("Chosen by you");
    await expect(dialog.locator('[data-fact="data"] dd')).toHaveText(game.dataDirectory);
    await expect(dialog.getByRole("button", { name: "Reset to auto-detect" })).toBeEnabled();
    const calls = await dialogCalls(app);
    expect(calls.open).toBe(1);
    // On macOS the game is an application bundle, which the panel offers only as a file.
    expect(calls.openOptions?.properties).toEqual(process.platform === "darwin" ? ["openFile", "openDirectory"] : ["openDirectory"]);
    expect(await storedSettings(userData)).toEqual({ version: 1, gameDirectory: game.folder });
    expect(await settingsState(page)).toMatchObject({ chosenFolder: game.folder, dataDirectory: game.dataDirectory, source: "chosen", iconRevision: 1 });

    // The window fetches its icons again, under the new revision, and the hint is gone.
    await page.keyboard.press("Escape");
    await expect(paletteIcon(page, "constant")).toHaveAttribute("src", `${ICONS}item/constant-combinator.png?r=1`);
    await expect.poll(() => paletteIcon(page, "constant").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(64);
    await expect(page.locator(".icon-hint")).toHaveCount(0);
    expect(pngFacts((await fetchAsset(app, `${ICONS}item/constant-combinator.png?r=1`)).bytes).center).toEqual(BLUE);
  } finally {
    await closeApp(first.app);
  }

  // The same profile again; auto-detection would find nothing.
  const second = await launch({ userData: first.userData });
  try {
    const { app, page, userData } = second;
    expect(await settingsState(page)).toMatchObject({ chosenFolder: game.folder, dataDirectory: game.dataDirectory, source: "chosen", iconRevision: 0 });
    await expect(paletteIcon(page, "constant")).toHaveAttribute("src", `${ICONS}item/constant-combinator.png`);
    await expect(page.locator(".icon-hint")).toHaveCount(0);

    const dialog = await openSettings(app, page);
    await expect(dialog.locator(".game-folder-path .path")).toHaveText(game.folder);
    await dialog.getByRole("button", { name: "Reset to auto-detect" }).click();
    await expect(dialog.locator(".game-folder-path .path")).toHaveText("No installation found");
    await expect(dialog.getByRole("button", { name: "Reset to auto-detect" })).toBeDisabled();
    expect(await storedSettings(userData)).toEqual({ version: 1, gameDirectory: null });
    expect(await settingsState(page)).toMatchObject({ chosenFolder: null, dataDirectory: null, source: "none", iconRevision: 1 });
    await page.keyboard.press("Escape");
    await expect(paletteIcon(page, "constant")).toHaveJSProperty("tagName", "svg");
    expect((await fetchAsset(app, `${ICONS}item/constant-combinator.png?r=1`)).status).toBe(404);
  } finally {
    await closeApp(second.app);
  }
});

test("refuses a folder without the game with its reason, and takes no folder from the page", async () => {
  const game = await writeFakeGame({ icons: BASE_ICONS });
  const notAGame = await emptyFolder();
  const { app, page, userData } = await launch({ gameFolder: game.folder });
  try {
    const dialog = await openSettings(app, page);
    await stubDialogs(app, { openPath: notAGame });
    await dialog.getByRole("button", { name: "Choose..." }).click();
    await expect(dialog.locator('[data-message="error"]')).toHaveText(`This folder does not contain the game's data: ${notAGame}`);
    await expect(dialog.getByRole("alert")).toHaveCount(1);
    // The installation in use stays, and nothing was stored.
    await expect(dialog.locator(".game-folder-path .path")).toHaveText(game.dataDirectory);
    await expect(dialog.getByRole("button", { name: "Reset to auto-detect" })).toBeDisabled();
    expect(existsSync(resolve(userData, "app-settings.json"))).toBe(false);
    expect(await settingsState(page)).toMatchObject({ chosenFolder: null, dataDirectory: game.dataDirectory, source: "detected", iconRevision: 0 });

    // A cancelled chooser clears the message and changes nothing.
    await stubDialogs(app, {});
    await dialog.getByRole("button", { name: "Choose..." }).click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Choose..." })).toBeEnabled();

    // The calls take no arguments: a folder the page passes is not looked at, the chooser alone names one.
    const other = await writeFakeGame({ version: "2.1.30" });
    const results = await page.evaluate(
      async (folder) => {
        const face = window.face as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
        return [await face.chooseGameFolder!(folder), await face.chooseGameFolder!({ gameDirectory: folder }), await face.resetGameFolder!(folder), await face.getAppSettings!(folder)];
      },
      other.folder,
    );
    expect(results.slice(0, 2)).toEqual([{ ok: true, value: null }, { ok: true, value: null }]);
    for (const result of results.slice(2)) expect(result).toMatchObject({ ok: true, value: { chosenFolder: null, dataDirectory: game.dataDirectory, gameVersion: "2.1.24" } });
    // The chooser was shown for each of the two requests (and once for the cancelled one above), with what the app decides to offer.
    expect((await dialogCalls(app)).open).toBe(3);
    expect(await storedSettings(userData)).toEqual({ version: 1, gameDirectory: null });
  } finally {
    await closeApp(app);
  }
});

test("keeps the keyboard in the settings dialog after the chooser has closed", async () => {
  const game = await writeFakeGame({ icons: BASE_ICONS });
  const { app, page } = await launch({ gameFolder: game.folder });
  try {
    const dialog = await openSettings(app, page);
    const choose = dialog.getByRole("button", { name: "Choose..." });
    const displayMode = () => page.evaluate(() => window.faceSession!.getState().displayMode);
    const focusInDialog = () => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null);
    await stubDialogs(app, {});
    expect(await displayMode()).toBe("edit");

    // The button that opened the chooser is disabled while it is open, which takes the focus from it and out of the dialog.
    await choose.click();
    await expect(choose).toBeEnabled();
    // A key of the circuit then does not reach the page behind the dialog, and brings the focus back into it.
    await page.keyboard.press("b");
    expect(await displayMode()).toBe("edit");
    await expect(dialog).toBeVisible();
    expect(await focusInDialog()).toBe(true);
    // Tab goes on inside the dialog.
    await page.keyboard.press("Tab");
    expect(await focusInDialog()).toBe(true);

    // And Escape closes it from there, as it does with the focus inside.
    await choose.click();
    await expect(choose).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await displayMode()).toBe("edit");
  } finally {
    await closeApp(app);
  }
});

test("uses an installation of another version and says so", async () => {
  const older = await writeFakeGame({ version: "2.0.72", icons: BASE_ICONS });
  const patch = await writeFakeGame({ version: "2.1.30" });
  const { app, page } = await launch({ gameFolder: older.folder });
  try {
    const dialog = await openSettings(app, page);
    const version = dialog.locator('[data-fact="version"]');
    await expect(version).toHaveAttribute("data-level", "warning");
    await expect(version.locator("dd")).toContainText("Factorio 2.0.72");
    await expect(version.locator("small.warning")).toContainText("The signal catalog of this app is from 2.1.24. This installation is used all the same");
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "app-settings-other-version.png") });
    // It is used: its icons are served.
    expect(pngFacts((await fetchAsset(app, `${ICONS}item/constant-combinator.png`)).bytes).center).toEqual(BLUE);
    expect(await settingsState(page)).toMatchObject({ gameVersion: "2.0.72", catalogVersion: "2.1.24", versionMatch: "different", dataDirectory: older.dataDirectory });

    // Another patch release of the same line is a plain note.
    await stubDialogs(app, { openPath: patch.dataDirectory });
    await dialog.getByRole("button", { name: "Choose..." }).click();
    await expect(version).toHaveAttribute("data-level", "note");
    await expect(version.locator("dd")).toContainText("Factorio 2.1.30");
    await expect(version.locator("small")).toContainText("The signal catalog of this app is from 2.1.24.");
    await expect(version.locator("small.warning")).toHaveCount(0);
    // The data directory itself was chosen, so it is not named a second time.
    await expect(dialog.locator(".game-folder-path .path")).toHaveText(patch.dataDirectory);
    await expect(dialog.locator('[data-fact="data"]')).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("serves a placeholder for an icon whose file is missing or leads out of the installation", async () => {
  const game = await writeFakeGame({ modules: ["quality"], icons: BASE_ICONS });
  // A readable image outside the data directory, and a link to it where the icon of the arithmetic combinator belongs.
  const outside = join(dirname(game.folder), "outside.png");
  await writeFile(outside, iconStrip(VIOLET));
  await symlink(outside, join(game.dataDirectory, "base/graphics/icons/arithmetic-combinator.png"));
  // The same through a linked folder: the icon of the red wire is `shortcut-toolbar/mip/new-red-wire-x56.png`.
  const outsideFolder = join(dirname(game.folder), "outside");
  await mkdir(join(outsideFolder, "mip"), { recursive: true });
  await writeFile(join(outsideFolder, "mip/new-red-wire-x56.png"), iconStrip(VIOLET));
  await symlink(outsideFolder, join(game.dataDirectory, "base/graphics/icons/shortcut-toolbar"));
  const { app, page } = await launch({ gameFolder: game.folder });
  try {
    const escaped = await fetchAsset(app, `${ICONS}item/arithmetic-combinator.png`);
    expect([escaped.status, escaped.contentType]).toEqual([200, "image/png"]);
    expect(escaped.bytes).toEqual(PLACEHOLDER);
    expect(pngFacts(escaped.bytes).center).not.toEqual(VIOLET);
    expect((await fetchAsset(app, `${ICONS}item/red-wire.png`)).bytes).toEqual(PLACEHOLDER);

    // A module that is not installed, and a file that is just not there.
    expect((await fetchAsset(app, `${ICONS}item/carbon-fiber.png`)).bytes).toEqual(PLACEHOLDER);
    expect((await fetchAsset(app, `${ICONS}item/small-lamp.png`)).bytes).toEqual(PLACEHOLDER);
    // What is there is still rendered.
    expect(pngFacts((await fetchAsset(app, `${ICONS}item/constant-combinator.png`)).bytes).center).toEqual(BLUE);

    // In the window a placeholder is an image like any icon; the name stays next to it.
    await expect(paletteIcon(page, "arithmetic")).toHaveAttribute("src", `${ICONS}item/arithmetic-combinator.png`);
    await expect.poll(() => paletteIcon(page, "arithmetic").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(64);
    const dialog = await openSettings(app, page);
    await expect(dialog.locator('[data-fact="modules"] [data-missing]')).toContainText("Not installed: space-age, elevated-rails, recycler.");
  } finally {
    await closeApp(app);
  }
});

test("hints at the settings when there is neither a game nor bundled icons, once", async () => {
  expect(existsSync(NO_GAME_DIR)).toBe(false);
  const { app, page } = await launch();
  try {
    const none = { chosenFolder: null, dataDirectory: null, source: "none", gameVersion: null, catalogVersion: "2.1.24", versionMatch: null, modules: [], problem: null, iconRevision: 0 };
    expect(await settingsState(page)).toEqual(none);
    expect((await fetchAsset(app, `${ICONS}virtual/signal-A.png`)).status).toBe(404);
    const hint = page.locator(".icon-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("No Factorio installation found");
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "app-settings-hint.png") });
    // Nothing is in the way: no dialog, and the hint is in the title bar, where it takes no room from the workbench.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("g.card")).toHaveCount(4);

    await hint.getByRole("button", { name: "Game folder..." }).click();
    await expect(settingsDialog(page).locator(".game-folder-path .path")).toHaveText("No installation found");
    await page.keyboard.press("Escape");
    await expect(hint).toBeVisible();
    await hint.getByRole("button", { name: "Dismiss hint" }).click();
    await expect(hint).toHaveCount(0);
    // The settings stay reachable from the menu.
    await openSettings(app, page);
  } finally {
    await closeApp(app);
  }
});

test("keeps a chosen folder that has vanished, with its problem, and does not look elsewhere", async () => {
  const game = await writeFakeGame({ icons: BASE_ICONS });
  const vanished = resolve(dirname(game.folder), "unplugged", "factorio");
  // The profile of an earlier run in which that folder was chosen.
  const userData = resolve(USER_DATA_DIR, `vanished-${process.pid}`);
  await mkdir(userData, { recursive: true });
  await writeFile(resolve(userData, "app-settings.json"), JSON.stringify({ version: 1, gameDirectory: vanished }));
  const { app, page } = await launch({ userData, gameFolder: game.folder });
  try {
    expect(await settingsState(page)).toMatchObject({ chosenFolder: vanished, dataDirectory: null, source: "chosen", problem: `This folder does not exist or cannot be read: ${vanished}` });
    await expect(page.locator(".icon-hint")).toContainText("The chosen Factorio folder cannot be used");
    const dialog = await openSettings(app, page);
    await expect(dialog.locator(".game-folder-path .path")).toHaveText(vanished);
    await expect(dialog.locator('[data-message="problem"]')).toContainText(`This folder does not exist or cannot be read: ${vanished}`);
    await expect(dialog.locator('[data-fact="version"]')).toHaveCount(0);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "app-settings-vanished.png") });

    // Reset: auto-detection takes over and finds the game.
    await dialog.getByRole("button", { name: "Reset to auto-detect" }).click();
    await expect(dialog.locator(".game-folder-path .path")).toHaveText(game.dataDirectory);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".icon-hint")).toHaveCount(0);
    await expect(paletteIcon(page, "constant")).toHaveAttribute("src", `${ICONS}item/constant-combinator.png?r=1`);
  } finally {
    await closeApp(app);
  }
});
