// The entity and signal data read from the user's game: the "Game data" section of the application settings, the native
// confirmation before the game is run, progress, failure and cancellation, the window loaded again with the new data, what a
// mod brings to the selector and the picker, and the record of the mods in the project file. The game is a stand-in
// (apps/desktop/test/support/fakeFactorio.mjs) in an installation the test builds; the real game is never started.
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MOD_ENTITY, MOD_SIGNAL } from "../../apps/desktop/test/support/cannedDump.ts";
import type { GameDataInUse, GameDataStatus } from "../../apps/desktop/src/ipc.ts";
import {
  APP_TITLE, card, clickMenu, clientPointOf, closeApp, entityNames, expect, launchApp, newProjectPath, openProject, readProjectEntries, SCREENSHOT_DIR, sourceText, test,
  type RunningApp,
} from "./app.ts";
import { setSource } from "./board.ts";
import { addFakeProgram, setFakeProgram, writeFakeGame, type FakeProgram } from "./fakeGame.ts";

const SHOTS = resolve(SCREENSHOT_DIR, "game-data");
const SETTINGS_MENU = process.platform === "darwin" ? [APP_TITLE, "Settings..."] : ["File", "Settings..."];
const CONFIRMATION = "Run Factorio to read its entities and signals?";
const READ_SOURCE = /^Read from your game on .+: 2\.1\.24 with 1 mod$/;
const BUILT_IN_SOURCE = "Built in, Factorio 2.1.24";
const ICON_WARNING = "3 icons of mods are not shown: the app reads icons from the game's own files only.";

const settingsDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Application settings" });
const section = (page: Page): Locator => settingsDialog(page).getByRole("region", { name: "Game data" });
const message = (page: Page, name: string): Locator => section(page).locator(`[data-message="${name}"]`);
const source = (page: Page): Locator => section(page).locator(".game-data-source > span");
const readButton = (page: Page): Locator => section(page).getByRole("button", { name: /^Read (from the game|the game again)\.\.\.$/ });
const builtInButton = (page: Page): Locator => section(page).getByRole("button", { name: "Use built-in data" });
const palette = (page: Page): Locator => page.getByRole("complementary", { name: "Components" });
const paletteEntry = (page: Page, prototype: string): Locator => palette(page).locator(`.palette-item[data-prototype="${prototype}"]`);

interface Game extends RunningApp {
  readonly program: FakeProgram;
  readonly dataDirectory: string;
}

/** The app with an installation whose program is the stand-in, and the mod directory of a user with one mod. */
async function launchWithGame(options: { readonly userData?: string; readonly behaviour?: Parameters<typeof addFakeProgram>[2]; readonly program?: FakeProgram; readonly folder?: string } = {}): Promise<Game> {
  const game = options.folder === undefined ? await writeFakeGame({ bundle: process.platform === "darwin" }) : undefined;
  const program = options.program ?? (await addFakeProgram(game!, {}, options.behaviour));
  const folder = options.folder ?? game!.folder;
  const running = await launchApp({ open: "start", userData: options.userData, env: { FACE_GAME_DIR: folder, FACE_GAME_MODS_DIR: program.modDirectory } });
  return { ...running, program, dataDirectory: game?.dataDirectory ?? "" };
}

interface MessageBoxes {
  /** The options of every confirmation that was shown. */
  readonly confirmations: Electron.MessageBoxOptions[];
  /** How often the unsaved-changes prompt was shown. */
  readonly unsaved: number;
}

/** Answers the native message boxes: the confirmation before the game is run (`run`), and the unsaved-changes prompt (0 Save, 1 Discard, 2 Cancel). */
async function answerMessageBoxes(app: ElectronApplication, answers: { readonly run: boolean; readonly unsaved?: number }): Promise<void> {
  await app.evaluate(
    ({ dialog }, { run, unsaved, confirmation }) => {
      const boxes: { confirmations: unknown[]; unsaved: number } = { confirmations: [], unsaved: 0 };
      (globalThis as Record<string, unknown>).messageBoxes = boxes;
      dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
        if (options.message === confirmation) {
          boxes.confirmations.push(options);
          return { response: run ? options.buttons!.indexOf("Run the Game") : (options.cancelId ?? 0), checkboxChecked: false };
        }
        boxes.unsaved++;
        return { response: unsaved ?? 2, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    },
    { ...answers, confirmation: CONFIRMATION },
  );
}

const messageBoxes = (app: ElectronApplication): Promise<MessageBoxes> => app.evaluate(() => (globalThis as Record<string, unknown>).messageBoxes as MessageBoxes);

async function openSettings(app: ElectronApplication, page: Page): Promise<void> {
  await clickMenu(app, ...SETTINGS_MENU);
  await expect(settingsDialog(page)).toBeVisible();
}

async function status(page: Page): Promise<GameDataStatus> {
  const result = await page.evaluate(() => window.face!.getGameDataStatus());
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function dataInUse(page: Page): Promise<GameDataInUse> {
  const result = await page.evaluate(() => window.face!.getGameData());
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** Folders of runs the app left behind in its profile: none after any run, however it ended. */
async function runFolders(userData: string): Promise<string[]> {
  return readdir(join(userData, "game-data-runs")).catch(() => []);
}

/** Has the game read through the dialog and waits for the window that was loaded again, with the dialog back and the new source in it. */
async function readGame(app: ElectronApplication, page: Page): Promise<void> {
  await answerMessageBoxes(app, { run: true, unsaved: 1 });
  await openSettings(app, page);
  await readButton(page).click();
  await expect(source(page)).toHaveText(READ_SOURCE, { timeout: 20_000 });
  await page.waitForFunction(() => window.faceSession?.getState().catalog.modulesFixed === true);
}

test("the settings say that the built-in data is in use, and whether the game can be read", async () => {
  // An installation with its program: the game can be read.
  const { app, page } = await launchWithGame();
  try {
    await openSettings(app, page);
    await expect(section(page).locator(".section-label")).toHaveText("Game data");
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE);
    await expect(section(page).locator(".game-data-source")).toHaveAttribute("data-source", "built-in");
    await expect(readButton(page)).toBeEnabled();
    await expect(readButton(page)).toHaveText("Read from the game...");
    await expect(builtInButton(page)).toBeDisabled();
    await expect(section(page).locator("[data-message]")).toHaveCount(0);
    await expect(section(page).getByRole("alert")).toHaveCount(0);
    await expect(section(page)).toContainText("The app asks before it starts the game and never starts it by itself.");
    expect(await status(page)).toEqual({ inUse: { kind: "built-in", version: "2.1.24" }, pending: null, stale: false, unavailable: null, problem: null, discardable: false, run: { state: "idle" } });
    expect(await dataInUse(page)).toEqual({ source: { kind: "built-in", version: "2.1.24" }, problem: null, mods: [], catalog: null, entities: null });
    await page.screenshot({ path: resolve(SHOTS, "section-built-in.png") });

    // The keyboard stays in the dialog and reaches the section: Close, Choose, Read, and round again.
    await expect(settingsDialog(page).getByRole("button", { name: "Close application settings" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(settingsDialog(page).getByRole("button", { name: "Choose..." })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(readButton(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(settingsDialog(page).getByRole("button", { name: "Close application settings" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);
  } finally {
    await closeApp(app);
  }

  // An installation without the program (a copy of the data), and no installation at all: the button is disabled and says why.
  const dataOnly = await writeFakeGame();
  for (const [folder, reason] of [[dataOnly.folder, /^The game cannot be read: This installation has the game's data but not the game itself/], [undefined, "The game cannot be read: No Factorio installation is in use. Choose the game's folder above."]] as const) {
    const running = await launchApp({ open: "start", env: folder === undefined ? {} : { FACE_GAME_DIR: folder } });
    try {
      await openSettings(running.app, running.page);
      await expect(message(running.page, "unavailable")).toHaveText(reason);
      await expect(readButton(running.page)).toBeDisabled();
      await expect(builtInButton(running.page)).toBeDisabled();
      await expect(source(running.page)).toHaveText(BUILT_IN_SOURCE);
    } finally {
      await closeApp(running.app);
    }
  }
});

test("reads the game after the confirmation, shows the steps, loads the window again and names the source", async () => {
  const { app, page, userData, program } = await launchWithGame({ behaviour: { delayMs: 500 } });
  try {
    await answerMessageBoxes(app, { run: true });
    await openSettings(app, page);
    await page.screenshot({ path: resolve(SHOTS, "read-before.png") });
    await readButton(page).click();

    // While the game runs: which step, the time, and Cancel in place of the button that started it.
    const progress = message(page, "progress");
    await expect(progress).toContainText(/Step [2-4] of 5: the game /);
    await expect(progress.locator(".elapsed")).toHaveText(/^0:0\d$/);
    await expect(section(page).getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(readButton(page)).toHaveCount(0);
    await expect(builtInButton(page)).toBeDisabled();
    await page.screenshot({ path: resolve(SHOTS, "read-progress.png") });

    // The window is loaded again with the new data, and the dialog is back with the outcome.
    await expect(source(page)).toHaveText(READ_SOURCE, { timeout: 20_000 });
    await expect(section(page).locator(".game-data-source")).toHaveAttribute("data-source", "game");
    await expect(message(page, "outcome")).toHaveText(/^The game was read in \d+ seconds?\.$/);
    await expect(message(page, "warnings").locator("li", { hasText: ICON_WARNING })).toHaveCount(1);
    await expect(readButton(page)).toHaveText("Read the game again...");
    await expect(builtInButton(page)).toBeEnabled();
    await expect(message(page, "stale")).toHaveCount(0);
    await expect(message(page, "pending")).toHaveCount(0);
    await page.screenshot({ path: resolve(SHOTS, "read-after.png") });

    // The user was asked once, by the main process, with the real path of the program and Cancel as the default.
    const { confirmations } = await messageBoxes(app);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({ type: "question", message: CONFIRMATION, buttons: ["Cancel", "Run the Game"], defaultId: 0, cancelId: 0 });
    expect(confirmations[0]!.detail).toContain(`The app will start this program:\n${program.executable}`);
    expect(confirmations[0]!.detail).toContain("The game runs headless, without a window, three times in a row");
    expect(confirmations[0]!.detail).toContain(`1 mod is enabled, and its code runs in the game. The mods are read from:\n${program.modDirectory}`);
    expect(confirmations[0]!.detail).toContain("Nothing is written to the game's folders");

    const current = await status(page);
    expect(current).toMatchObject({ inUse: { kind: "game", version: "2.1.24", build: 87808, mods: 1 }, pending: null, stale: false, unavailable: null, problem: null, discardable: true, run: { state: "done" } });
    expect((await dataInUse(page)).mods).toEqual([{ name: "base", version: "2.1.24" }, { name: "some-mod", version: "1.2.3" }]);
    expect(existsSync(join(userData, "game-data.json"))).toBe(true);
    expect(await runFolders(userData)).toEqual([]);
    // Nothing was written beside the user's mods.
    expect((await readdir(program.modDirectory)).sort()).toEqual(["mod-list.json", "some-mod_1.2.3.zip"]);

    // The game changes: the dialog says so the next time it is opened.
    await page.keyboard.press("Escape");
    await writeFile(join(program.modDirectory, "another-mod_0.1.0.zip"), "a new mod");
    await openSettings(app, page);
    await expect(message(page, "stale")).toHaveText("Your game or its mods have changed since this data was read. Read the game again to work with what it has now.");
  } finally {
    await closeApp(app);
  }
});

test("what a mod brings is in the selector and the picker, is placed, saved and reopened, and the project file records the mods", async () => {
  const { app, page, userData, program } = await launchWithGame();
  const projectPath = await newProjectPath("Modded");
  try {
    await readGame(app, page);
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);

    // The selector has the mod's crate among the game's entities, with the name the game gives it and no icon of its own.
    await expect(palette(page).getByRole("tab", { name: "Group", exact: true })).toHaveAttribute("aria-selected", "true");
    const crate = paletteEntry(page, MOD_ENTITY);
    await expect(crate).toHaveAccessibleName("Mod crate");
    await expect(crate).toHaveAttribute("data-kind", "entity");
    await crate.click();
    const spot = await clientPointOf(page, { x: 400, y: 200 });
    await page.mouse.click(spot.x, spot.y);
    await expect(card(page, "mod_crate1")).toHaveClass(/selected/);
    expect(await sourceText(page)).toContain(`    entity mod_crate1 at (`);
    expect(await sourceText(page)).toContain(`        prototype = ${MOD_ENTITY}\n`);

    // A constant combinator gets the mod's signal from the picker.
    await paletteEntry(page, "constant-combinator").click();
    const other = await clientPointOf(page, { x: 100, y: 200 });
    await page.mouse.click(other.x, other.y);
    await expect(card(page, "constant1")).toHaveClass(/selected/);
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await inspector.getByRole("button", { name: "Add signal" }).click();
    await inspector.getByRole("button", { name: "Choose signal 1" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a signal" });
    await picker.getByLabel("Search signals").fill("mod sig");
    const entry = picker.locator(`[data-signal="virtual:${MOD_SIGNAL}"]`);
    await expect(entry).toHaveAttribute("aria-label", "Mod signal");
    await entry.click();
    await expect(picker).toHaveCount(0);
    expect(await sourceText(page)).toContain(`        virtual:${MOD_SIGNAL} = 1\n`);
    // Both are of the game the data was read from: nothing is flagged.
    expect(await page.evaluate(() => window.faceSession!.getState().diagnostics)).toEqual([]);
    await page.screenshot({ path: resolve(SHOTS, "modded-circuit.png") });

    // The project settings show the game's modules as they are: on, and not to be switched.
    await page.locator("[data-settings-toggle]").click();
    const projectSettings = page.getByRole("dialog", { name: "Project settings" });
    await expect(projectSettings.locator('[data-note="modules-fixed"]')).toContainText("As in your game");
    await expect(projectSettings.locator(".module-list li")).toHaveCount(2);
    for (const module of ["base", "some-mod"]) {
      await expect(projectSettings.locator(`[data-module="${module}"] input`)).toBeChecked();
      await expect(projectSettings.locator(`[data-module="${module}"] input`)).toBeDisabled();
    }
    await page.keyboard.press("Escape");

    // Saved: the file has the record of the game and its mods, and keeps the module list it had.
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
    }, projectPath);
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    const saved = JSON.parse((await readProjectEntries(projectPath))["face.json"]!) as Record<string, unknown>;
    expect(saved.gameMods).toEqual({ gameVersion: "2.1.24", mods: [{ name: "base", version: "2.1.24" }, { name: "some-mod", version: "1.2.3" }] });
    expect(saved.modules).toEqual(["base", "space-age", "quality", "recycler", "elevated-rails"]);
    const savedSource = await sourceText(page);

    // Reopened with the same data: as it was, and no notice.
    await clickMenu(app, "File", "New Project");
    await expect.poll(() => entityNames(page)).toEqual([]);
    await openProject(page, projectPath);
    await expect.poll(() => entityNames(page)).toEqual(["mod_crate1", "constant1"]);
    expect(await sourceText(page)).toBe(savedSource);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await page.evaluate(() => window.faceSession!.getState().diagnostics)).toEqual([]);

    // Back to the built-in data: the window is loaded again, the project comes back and says what the data lacks.
    await openSettings(app, page);
    await builtInButton(page).click();
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE, { timeout: 20_000 });
    await expect(builtInButton(page)).toBeDisabled();
    expect(existsSync(join(userData, "game-data.json"))).toBe(false);
    await page.keyboard.press("Escape");
    await expect(page.locator(".toast")).toContainText("This project was made with other game data. The data in use lacks some-mod 1.2.3.");
    // The project opened all the same, its source as it was: the mod's entity is an error in it, the mod's signal a warning.
    expect(await sourceText(page)).toBe(savedSource);
    const flagged = await page.evaluate(() => window.faceSession!.getState().diagnostics.map((diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`));
    expect(flagged).toEqual([
      "error: Unknown prototype 'mod-crate'; the names are the game's, as a blueprint has them (steel-chest, fast-inserter, transport-belt)",
      "warning: Unknown signal 'virtual:mod-signal'",
    ]);
    await page.locator("[data-settings-toggle]").click();
    await expect(projectSettings.locator('[data-note="made-with"]')).toHaveText("Made with Factorio 2.1.24 with some-mod 1.2.3.");
    await expect(projectSettings.locator('[data-note="mods-notice"]')).toContainText("The data in use lacks some-mod 1.2.3.");
    await expect(projectSettings.locator('[data-module="base"] input')).toBeDisabled();
    await expect(projectSettings.locator('[data-module="space-age"] input')).toBeEnabled();
    await page.keyboard.press("Escape");

    // A save with other data in use keeps the record as it is.
    await page.getByRole("button", { name: "Dismiss message" }).click();
    await page.evaluate(() => window.faceSession!.commands.setProjectName("Modded, renamed"));
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    const again = JSON.parse((await readProjectEntries(projectPath))["face.json"]!) as Record<string, unknown>;
    expect(again).toMatchObject({ name: "Modded, renamed", gameMods: saved.gameMods, modules: saved.modules });
    expect((await readdir(program.modDirectory)).sort()).toEqual(["mod-list.json", "some-mod_1.2.3.zip"]);
  } finally {
    await closeApp(app);
  }
});

test("declining the confirmation starts nothing, and a page cannot start the game without it or name a program", async () => {
  const { app, page, userData, program } = await launchWithGame();
  try {
    await answerMessageBoxes(app, { run: false });
    await openSettings(app, page);
    await readButton(page).click();
    await expect.poll(async () => (await messageBoxes(app)).confirmations.length).toBe(1);
    await expect(readButton(page)).toBeEnabled();
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE);
    await expect(section(page).locator("[data-message]")).toHaveCount(0);
    expect((await status(page)).run).toEqual({ state: "idle" });

    // Whatever the page passes, the call takes no argument: the user is asked about the installation's own program, and declines.
    const answers = await page.evaluate(async (evil) => {
      const face = window.face as unknown as Record<string, (...args: unknown[]) => Promise<{ ok: boolean; value?: { run: { state: string } } }>>;
      const read = [await face.readGameData!(evil), await face.readGameData!({ executable: evil, confirmedExecutable: evil, confirmed: true }), await face.readGameData!(true)];
      const others = [await face.cancelGameDataRead!(evil), await face.discardGameData!(evil), await face.getGameDataStatus!(evil), await face.getGameData!({ file: evil })];
      return [...read, ...others].map((answer) => [answer.ok, answer.value?.run?.state]);
    }, "/bin/sh");
    expect(answers).toEqual([[true, "idle"], [true, "idle"], [true, "idle"], [true, "idle"], [true, "idle"], [true, "idle"], [true, undefined]]);
    const { confirmations } = await messageBoxes(app);
    expect(confirmations).toHaveLength(4);
    for (const confirmation of confirmations) {
      expect(confirmation.detail).toContain(`The app will start this program:\n${program.executable}`);
      expect(confirmation.detail).not.toContain("/bin/sh");
    }

    // Nothing ran: no start of the program, no folder of a run, no data.
    expect(await readFile(program.control.record, "utf8")).toBe("");
    expect(existsSync(join(userData, "game-data-runs"))).toBe(false);
    expect(existsSync(join(userData, "game-data.json"))).toBe(false);
    expect(await status(page)).toMatchObject({ inUse: { kind: "built-in" }, pending: null, discardable: false, run: { state: "idle" } });
  } finally {
    await closeApp(app);
  }
});

test("a game that fails shows the reason and the end of its log, and the built-in data stays", async () => {
  const { app, page, userData } = await launchWithGame({ behaviour: { mode: "fail", at: "locale" } });
  try {
    await answerMessageBoxes(app, { run: true });
    await openSettings(app, page);
    await readButton(page).click();
    await expect(message(page, "read-failed")).toHaveText("The game ended with exit code 3");
    await expect(message(page, "read-failed")).toHaveAttribute("role", "alert");
    const log = section(page).getByLabel("The end of the game's log");
    await expect(log).toContainText("Failed to load mods: something is wrong");
    await expect(log).toContainText("Factorio 2.1.24 (build 87808");
    // The log is text in a box of its own that scrolls and can be reached with the keyboard.
    expect(await log.evaluate((box) => [box.tagName, getComputedStyle(box).overflowY, box.children.length, (box as HTMLElement).tabIndex])).toEqual(["PRE", "auto", 0, 0]);
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE);
    await expect(readButton(page)).toBeEnabled();
    await expect(builtInButton(page)).toBeDisabled();
    await page.screenshot({ path: resolve(SHOTS, "read-failed.png") });
    expect(await status(page)).toMatchObject({ inUse: { kind: "built-in" }, pending: null, run: { state: "failed", message: "The game ended with exit code 3" } });
    expect(existsSync(join(userData, "game-data.json"))).toBe(false);
    expect(await runFolders(userData)).toEqual([]);
  } finally {
    await closeApp(app);
  }
});

test("Cancel stops a game that hangs", async () => {
  const { app, page, userData } = await launchWithGame({ behaviour: { mode: "hang", at: "data" } });
  try {
    await answerMessageBoxes(app, { run: true });
    await openSettings(app, page);
    await readButton(page).click();
    await expect(message(page, "progress")).toContainText("Step 2 of 5: the game loads its data and your mods");
    expect(await runFolders(userData)).toHaveLength(1);
    // While it runs the data cannot be discarded and the window is not loaded again.
    expect(await page.evaluate(async () => [(await window.face!.discardGameData()).ok, (await window.face!.applyGameData()).ok])).toEqual([false, false]);
    const cancel = section(page).getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(message(page, "outcome")).toHaveText("Reading the game was cancelled. Nothing changed.");
    await expect(readButton(page)).toBeFocused();
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE);
    expect((await status(page)).run).toEqual({ state: "cancelled" });
    expect(await runFolders(userData)).toEqual([]);
    expect(existsSync(join(userData, "game-data.json"))).toBe(false);
  } finally {
    await closeApp(app);
  }
});

test("a game that is being read is stopped when the app quits", async () => {
  const { app, page, userData } = await launchWithGame({ behaviour: { mode: "hang", at: "locale" } });
  await answerMessageBoxes(app, { run: true });
  await openSettings(app, page);
  await readButton(page).click();
  await expect(message(page, "progress")).toContainText("Step 3 of 5");
  expect(await runFolders(userData)).toHaveLength(1);
  await closeApp(app);
  expect(await runFolders(userData)).toEqual([]);
});

test("a damaged data file falls back to the built-in data with a message, and discarding it clears the message", async () => {
  const first = await launchWithGame();
  const file = join(first.userData, "game-data.json");
  try {
    await readGame(first.app, first.page);
  } finally {
    await closeApp(first.app);
  }
  await writeFile(file, (await readFile(file, "utf8")).slice(0, 4000));

  const { app, page } = await launchWithGame({ userData: first.userData, program: first.program, folder: resolve(first.dataDirectory, process.platform === "darwin" ? "../.." : "..") });
  try {
    // The window works with the built-in data and says so in the title bar.
    const hint = page.locator(".data-hint");
    await expect(hint).toContainText("The data read from your game cannot be used:");
    await expect(hint).toContainText("The built-in data is in use.");
    expect(await page.evaluate(() => window.faceSession!.getState().catalog.modulesFixed)).toBe(false);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(0);
    await expect(paletteEntry(page, "constant-combinator")).toHaveCount(1);
    expect(await dataInUse(page)).toMatchObject({ source: { kind: "built-in", version: "2.1.24" }, catalog: null, entities: null });

    await hint.getByRole("button", { name: "Game data..." }).click();
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE);
    await expect(message(page, "data-problem")).toContainText("The data read from your game cannot be used:");
    await expect(builtInButton(page)).toBeEnabled();
    await builtInButton(page).click();
    await expect(message(page, "data-problem")).toHaveCount(0);
    await expect(builtInButton(page)).toBeDisabled();
    expect(existsSync(file)).toBe(false);
  } finally {
    await closeApp(app);
  }
});

test("data that was read is in use at the next start, and unsaved changes are asked about before the window is loaded again", async () => {
  const first = await launchWithGame();
  try {
    await readGame(first.app, first.page);
  } finally {
    await closeApp(first.app);
  }
  const { app, page, program } = await launchWithGame({ userData: first.userData, program: first.program, folder: resolve(first.dataDirectory, process.platform === "darwin" ? "../.." : "..") });
  try {
    await page.waitForFunction(() => window.faceSession?.getState().catalog.modulesFixed === true);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(1);
    await expect(page.locator(".data-hint")).toHaveCount(0);

    // An unsaved change, and the user keeps the window: the data waits, and the dialog offers to load the window again.
    await setSource(page, 'circuit "Kept" {\n    constant keep at (40, 80) {\n    }\n}\n');
    await answerMessageBoxes(app, { run: true, unsaved: 2 });
    await openSettings(app, page);
    await expect(source(page)).toHaveText(READ_SOURCE);
    await builtInButton(page).click();
    await expect(message(page, "pending")).toHaveText("Not in use yet: Built in, Factorio 2.1.24. It is used once the window has been loaded again.");
    expect((await messageBoxes(app)).unsaved).toBe(1);
    await expect(source(page)).toHaveText(READ_SOURCE);
    expect(await entityNames(page)).toEqual(["keep"]);
    expect(await status(page)).toMatchObject({ inUse: { kind: "game" }, pending: { kind: "built-in", version: "2.1.24" }, discardable: false });
    await expect(builtInButton(page)).toBeDisabled();

    // Discarding the changes loads the window again, with the built-in data.
    await answerMessageBoxes(app, { run: true, unsaved: 1 });
    await section(page).getByRole("button", { name: "Reload the window" }).click();
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE, { timeout: 20_000 });
    await expect(message(page, "pending")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(0);
    expect(await entityNames(page)).toEqual([]);
    await setFakeProgram(program, {});
  } finally {
    await closeApp(app);
  }
});
