// The entity and signal data read from the user's game: the "Game data" section of the application settings, the native
// confirmation before the game is run, progress, failure and cancellation, the window loaded again with the new data, the mods of
// the game as modules a project switches, what a mod brings to the selector and the picker once it is on, what a project says
// that uses a mod that is off, a blueprint import that switches mods on, and the record of the mods in the project file. The game is a stand-in
// (apps/desktop/test/support/fakeFactorio.mjs) in an installation the test builds; the real game is never started.
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MOD_ENTITY, MOD_SIGNAL, MODDED_KINDS, type CannedDump } from "../../apps/desktop/test/support/cannedDump.ts";
import type { GameDataInUse, GameDataStatus } from "../../apps/desktop/src/ipc.ts";
import { decodeBlueprintString, encodeBlueprintString } from "../../packages/blueprints/src/string.ts";
import {
  APP_TITLE, card, clickMenu, clientPointOf, closeApp, entityNames, expect, launchApp, newProjectPath, openProject, pin, readProjectEntries, SCREENSHOT_DIR, showDisplay, sourceText, test,
  type RunningApp,
} from "./app.ts";
import { inspector, setSource } from "./board.ts";
import { addFakeProgram, setFakeProgram, writeFakeGame, type FakeMod, type FakeProgram } from "./fakeGame.ts";

const SHOTS = resolve(SCREENSHOT_DIR, "game-data");
const SETTINGS_MENU = process.platform === "darwin" ? [APP_TITLE, "Settings..."] : ["File", "Settings..."];
const CONFIRMATION = "Run Factorio to read its entities and signals?";
const READ_SOURCE = /^Read from your game on .+: 2\.1\.24 with 1 mod$/;
const BUILT_IN_SOURCE = "Built in, Factorio 2.1.24";
const ICON_WARNING = "3 icons of mods are not shown: the app reads icons from the game's own files only.";
/** Where the page asks for the icons of the catalog. */
const CATALOG_ICONS = "face-asset://catalog/icons/";

const settingsDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Application settings" });
const section = (page: Page): Locator => settingsDialog(page).getByRole("region", { name: "Game data" });
const message = (page: Page, name: string): Locator => section(page).locator(`[data-message="${name}"]`);
const source = (page: Page): Locator => section(page).locator(".game-data-source > span");
const readButton = (page: Page): Locator => section(page).getByRole("button", { name: /^Read (from the game|the game again)\.\.\.$/ });
const builtInButton = (page: Page): Locator => section(page).getByRole("button", { name: "Use built-in data" });
const palette = (page: Page): Locator => page.getByRole("complementary", { name: "Components" });
const paletteEntry = (page: Page, prototype: string): Locator => palette(page).locator(`.palette-item[data-prototype="${prototype}"]`);
const projectSettingsOf = (page: Page): Locator => page.getByRole("dialog", { name: "Project settings" });
const moduleRow = (page: Page, name: string): Locator => projectSettingsOf(page).locator(`.module-list li[data-module="${name}"]`);
/** Waits until the window works with data read from a game: it was loaded again, and its session is there. */
const gameDataInUse = (page: Page): Promise<unknown> => page.waitForFunction(() => window.faceSession?.getState().project.gameData === true);
/** Switches a mod on in the project, as its settings do: a new project has the mods of the game off. */
const switchOn = (page: Page, module = "some-mod"): Promise<void> => page.evaluate((name) => window.faceSession!.commands.setModuleEnabled(name, true), module);
const enabledModules = (page: Page): Promise<string[]> => page.evaluate(() => window.faceSession!.getState().catalog.modules.filter((module) => module.enabled).map((module) => module.name));
const problems = (page: Page): Promise<string[]> => page.evaluate(() => window.faceSession!.getState().diagnostics.map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`));

/** The requests for catalog icons the windows of an app made since it was launched. */
interface IconRequests {
  /** The addresses that were answered, whatever with. */
  readonly answered: string[];
  /** The addresses that were answered with an error or not at all, each with what went wrong. */
  readonly failed: string[];
}

interface Game extends RunningApp {
  readonly program: FakeProgram;
  readonly dataDirectory: string;
  readonly icons: IconRequests;
}

/** Records the requests for catalog icons of every window of the app, from now on. */
function watchIconRequests(app: ElectronApplication, requests: IconRequests): void {
  const context = app.context();
  context.on("response", (response) => {
    if (!response.url().startsWith(CATALOG_ICONS)) return;
    requests.answered.push(response.url());
    if (!response.ok()) requests.failed.push(`${response.status()} ${response.url()}`);
  });
  context.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "failed";
    // A window that is loaded again drops the requests it has open; that is no answer.
    if (request.url().startsWith(CATALOG_ICONS) && reason !== "net::ERR_ABORTED") requests.failed.push(`${reason} ${request.url()}`);
  });
}

/** The app with an installation whose program is the stand-in, and the mod directory of a user with one mod. */
async function launchWithGame(
  options: { readonly userData?: string; readonly behaviour?: Parameters<typeof addFakeProgram>[2]; readonly program?: FakeProgram; readonly folder?: string; readonly dump?: CannedDump; readonly mods?: readonly FakeMod[] } = {},
): Promise<Game> {
  const game = options.folder === undefined ? await writeFakeGame({ bundle: process.platform === "darwin" }) : undefined;
  const program = options.program ?? (await addFakeProgram(game!, options.dump, options.behaviour, options.mods));
  const folder = options.folder ?? game!.folder;
  const icons: IconRequests = { answered: [], failed: [] };
  const running = await launchApp({ open: "start", userData: options.userData, env: { FACE_GAME_DIR: folder, FACE_GAME_MODS_DIR: program.modDirectory }, onLaunch: (app) => watchIconRequests(app, icons) });
  return { ...running, program, dataDirectory: game?.dataDirectory ?? "", icons };
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

/** The images on the page whose loading has ended without a picture, by address: none, since an icon the app cannot draw is not asked for and one that fails all the same gives way to a name. */
function brokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.images).filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.src));
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
async function readGame(app: ElectronApplication, page: Page, shown: RegExp = READ_SOURCE): Promise<void> {
  await answerMessageBoxes(app, { run: true, unsaved: 1 });
  await openSettings(app, page);
  await readButton(page).click();
  await expect(source(page)).toHaveText(shown, { timeout: 20_000 });
  await gameDataInUse(page);
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
    const builtIn = await dataInUse(page);
    expect(builtIn).toEqual({ source: { kind: "built-in", version: "2.1.24" }, problem: null, mods: [], catalog: null, entities: null, icons: expect.any(Array) as string[] });
    // The icons the app can draw are those of the icon table that comes with the build.
    expect(builtIn.icons.length).toBeGreaterThan(1000);
    expect(builtIn.icons).toContain("virtual/signal-A");
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
    const read = await dataInUse(page);
    expect(read.mods).toEqual([{ name: "base", version: "2.1.24" }, { name: "some-mod", version: "1.2.3" }]);
    // The mod is described by the info.json in its archive, and what it created names it; nothing of that is a warning.
    expect(read.catalog!.modules).toEqual([{ name: "base", title: "base", version: "2.1.24", requires: [], recommends: [], featureFlags: [] }, { name: "some-mod", title: "Some Mod", version: "1.2.3", requires: ["base"], recommends: [], featureFlags: [] }]);
    expect(read.catalog!.signals.virtual!.map((signal) => [signal.name, signal.modules])).toEqual([[MOD_SIGNAL, ["some-mod"]], ["signal-A", ["base"]]]);
    await expect(message(page, "warnings").locator("li", { hasText: "info.json" })).toHaveCount(0);
    // The window is told which icons the app can draw: those made of the game's own files, not the mod's.
    expect(read.icons).toEqual(expect.arrayContaining(["virtual/signal-A", "item/constant-combinator", "group/g"]));
    expect([`virtual/${MOD_SIGNAL}`, `item/${MOD_ENTITY}`, "item/gadget"].filter((id) => read.icons.includes(id))).toEqual([]);
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

test("a mod is switched on in the project settings; what it brings is then in the selector and the picker, is placed, saved and reopened, and the project file records the mods", async () => {
  const { app, page, userData, program, icons } = await launchWithGame();
  const projectPath = await newProjectPath("Modded");
  try {
    await readGame(app, page);
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);

    // A new project has the game's own modules on and its mods off: what the mod brings is not offered yet.
    await expect(palette(page).getByRole("tab", { name: "Group", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(paletteEntry(page, "constant-combinator")).toHaveCount(1);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(0);
    expect(await enabledModules(page)).toEqual(["base"]);
    await expect(page.getByTestId("save-state")).toHaveText("No changes");

    // The project settings list the game's module and the mod, by the title its info.json gives it and with what it brings.
    await page.locator("[data-settings-toggle]").click();
    const projectSettings = projectSettingsOf(page);
    await expect(projectSettings.locator(".module-list li")).toHaveCount(2);
    await expect(moduleRow(page, "base").locator("input")).toBeChecked();
    await expect(moduleRow(page, "base").locator("input")).toBeDisabled();
    await expect(moduleRow(page, "base").locator("small")).toHaveText("Always enabled");
    await expect(moduleRow(page, "some-mod").locator(".module-title")).toHaveText("Some Mod");
    await expect(moduleRow(page, "some-mod").locator(".module-count")).toHaveText("3 signals, 1 entity");
    await expect(moduleRow(page, "some-mod").locator("input")).not.toBeChecked();
    await expect(moduleRow(page, "some-mod").locator("input")).toBeEnabled();
    // Two rows need no filter; every mod of this game adds something; and the mods are here, so nothing says where they come from.
    await expect(projectSettings.getByLabel("Filter signal groups")).toHaveCount(0);
    await expect(projectSettings.locator('[data-note="other-mods"], [data-note="mods-hint"], [data-note="modules-off"]')).toHaveCount(0);
    await page.screenshot({ path: resolve(SHOTS, "project-settings-mod-off.png") });
    await moduleRow(page, "some-mod").locator("input").check();
    await expect(moduleRow(page, "some-mod").locator("input")).toBeChecked();
    await expect(moduleRow(page, "base").locator("small")).toHaveText("Always enabled");
    await page.keyboard.press("Escape");
    await expect(projectSettings).toHaveCount(0);
    expect(await enabledModules(page)).toEqual(["base", "some-mod"]);

    // The selector has the mod's crate among the game's entities, with the name the game gives it and no icon of its own.
    const crate = paletteEntry(page, MOD_ENTITY);
    await expect(crate).toHaveAccessibleName("Mod crate");
    await expect(crate).toHaveAttribute("data-kind", "entity");
    await expect(crate.locator("img")).toHaveCount(0);
    await crate.click();
    const spot = await clientPointOf(page, { x: 400, y: 200 });
    await page.mouse.click(spot.x, spot.y);
    await expect(card(page, "mod_crate1")).toHaveClass(/selected/);
    expect(await sourceText(page)).toContain(`    ${MOD_ENTITY} mod_crate1 at (`);

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
    // The app cannot draw the icon of a mod and knows it: the tile shows the name, as every tile does without icons, and asks for no image.
    await expect(entry).toHaveClass(/(^| )text( |$)/);
    await expect(entry).toHaveText(MOD_SIGNAL);
    await expect(entry.locator("img, .icon-fallback")).toHaveCount(0);
    expect(await brokenImages(page)).toEqual([]);
    await entry.click();
    await expect(picker).toHaveCount(0);
    expect(await sourceText(page)).toContain(`        virtual:${MOD_SIGNAL} = 1\n`);
    // The same in the inspector's signal field and in the signal history, which show an icon where there is one.
    await expect(page.locator(".trace-signal", { hasText: MOD_SIGNAL })).toBeVisible();
    await expect(inspector.locator(".signal-input img")).toHaveCount(0);
    expect(await brokenImages(page)).toEqual([]);
    // And on the card: the row of what the combinator sends has the signal by its short name, laid out as text, and no image.
    const sent = card(page, "constant1").locator('.card-row[data-row="out"]');
    await expect(sent.locator(".row-value")).toHaveText(`${MOD_SIGNAL} 1`);
    await expect(sent.locator("image")).toHaveCount(0);
    // Since the launch, with the built-in data and with the game's, the page asked for no icon the app does not have: every request was answered with an image.
    expect(icons.answered).toContain(`${CATALOG_ICONS}virtual/signal-A.png`);
    expect(icons.failed).toEqual([]);
    // Both are of modules the project has on: nothing is flagged.
    expect(await page.evaluate(() => window.faceSession!.getState().diagnostics)).toEqual([]);
    await page.screenshot({ path: resolve(SHOTS, "modded-circuit.png") });

    // Switched off again, the mod's entity and its signal stay where they are, each with a warning that names the mod, and are
    // offered no more; the project settings say so and switch the mod back on with one button.
    await page.evaluate(() => window.faceSession!.commands.setModuleEnabled("some-mod", false));
    expect(await problems(page)).toEqual([
      "warning disabled-prototype: 'mod-crate' (Mod crate) is an entity of Some Mod, which is switched off in the project settings",
      "warning disabled-signal: The signal 'virtual:mod-signal' is of Some Mod, which is switched off in the project settings",
    ]);
    expect(await entityNames(page)).toEqual(["mod_crate1", "constant1"]);
    await expect(card(page, "mod_crate1")).toHaveCount(1);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(0);
    await expect(page.locator(".statusbar")).toContainText("2 warnings");
    await page.locator("[data-settings-toggle]").click();
    const unused = projectSettings.locator('[data-note="modules-off"]');
    await expect(unused).toContainText("This project uses signals or entities of Some Mod, which is switched off.");
    await page.screenshot({ path: resolve(SHOTS, "project-settings-mod-in-use.png") });
    await unused.getByRole("button", { name: "Switch it on" }).click();
    await expect(unused).toHaveCount(0);
    await expect(moduleRow(page, "some-mod").locator("input")).toBeChecked();
    await page.keyboard.press("Escape");
    expect(await problems(page)).toEqual([]);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(1);

    // Saved: the file has the record of the game and its mods, and the module list of the project with the mod in it.
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
    }, projectPath);
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    const saved = JSON.parse((await readProjectEntries(projectPath))["face.json"]!) as Record<string, unknown>;
    expect(saved.gameMods).toEqual({ gameVersion: "2.1.24", mods: [{ name: "base", version: "2.1.24" }, { name: "some-mod", version: "1.2.3" }] });
    expect(saved.modules).toEqual(["base", "some-mod"]);
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
      "error: Unknown entity 'mod-crate': the game data in use has no entity of this name (the names are the game's, as a blueprint has them: constant-combinator, small-lamp, steel-chest)",
      "warning: Unknown signal 'virtual:mod-signal'",
    ]);
    await page.locator("[data-settings-toggle]").click();
    await expect(projectSettings.locator('[data-note="made-with"]')).toHaveText("Made with Factorio 2.1.24 with some-mod 1.2.3.");
    await expect(projectSettings.locator('[data-note="mods-notice"]')).toContainText("The data in use lacks some-mod 1.2.3.");
    // The list is the project's with this data too: the five modules of the game, of which the project has only the base one
    // on, and the name of the mod, which this data does not have, is kept.
    await expect(projectSettings.locator(".module-list li")).toHaveCount(5);
    await expect(moduleRow(page, "base").locator("input")).toBeDisabled();
    await expect(moduleRow(page, "space-age").locator("input")).toBeEnabled();
    await expect(moduleRow(page, "space-age").locator("input")).not.toBeChecked();
    await expect(projectSettings).toContainText("Not part of this catalog, kept in the project file: some-mod.");
    await expect(projectSettings.locator('[data-note="mods-hint"]')).toHaveText("The mods of your game appear here after the game has been read in the application settings.");
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

const MODDED_KINDS_SOURCE = `circuit "Modded kinds" {
    constant-combinator source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 3
    }

    mod-arithmetic double at (280, 80) tile (2.5, 0.5) {
        virtual:signal-A = virtual:signal-A * 2
    }

    mod-decider gate at (520, 80) tile (5, 1) facing north {
        when virtual:signal-A > 5
        output virtual:signal-A = 1
    }

    mod-pole relay at (760, 80) tile (9, 1) {
    }

    mod-lamp light at (1000, 80) tile (13, 1) {
        when virtual:signal-A > 0
    }

    mod-loader feed at (1240, 80) tile (16.5, 0.5) {
        when virtual:signal-A > 0
    }

    wire red source.out <-> double.in
    wire red double.out <-> gate.in
    wire green gate.out <-> relay
    wire green relay <-> light.in
    wire green relay <-> feed
}
`;

test("a mod's combinators, lamps, poles and loaders are entities of their kinds: selector, inspector, source, board, blueprint", async () => {
  const { app, page } = await launchWithGame({ dump: { entities: MODDED_KINDS } });
  const projectPath = await newProjectPath("Modded kinds");
  try {
    await readGame(app, page);
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);
    await switchOn(page);

    // The selector has each of them in the tab of its item group, with the kind of its prototype type. A modded speaker has none.
    for (const [prototype, kind, name] of [["mod-arithmetic", "arithmetic", "Tiny arithmetic combinator"], ["mod-decider", "decider", "Wide decider combinator"], ["mod-lamp", "lamp", "Big lamp"], ["mod-pole", "pole", "Huge electric pole"], ["mod-loader", "entity", "Miniloader"]] as const) {
      await expect(paletteEntry(page, prototype)).toHaveAttribute("data-kind", kind);
      await expect(paletteEntry(page, prototype)).toHaveAccessibleName(name);
    }
    await expect(palette(page).locator('[data-prototype="mod-speaker"]')).toHaveCount(0);
    // The first row stays the four combinators of the game.
    const pinned = palette(page).getByRole("group", { name: "Combinators" }).locator(".palette-item");
    expect(await pinned.evaluateAll((items) => items.map((item) => item.getAttribute("data-prototype")))).toEqual(["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"]);

    // Placed from its tile: an arithmetic combinator of the mod, declared by its name.
    await paletteEntry(page, "mod-arithmetic").click();
    const spot = await clientPointOf(page, { x: 400, y: 200 });
    await page.mouse.click(spot.x, spot.y);
    await expect(card(page, "arithmetic1")).toHaveClass(/selected/);
    await expect(card(page, "arithmetic1")).toHaveAttribute("data-kind", "arithmetic");
    expect(await sourceText(page)).toMatch(/    mod-arithmetic arithmetic1 at \(\d+, \d+\) \{\n    \}/);

    // The inspector has the form of the kind, and above it the choice among the prototypes of the kind.
    const choice = inspector(page).getByRole("group", { name: "Arithmetic" });
    expect(await choice.getByRole("button").evaluateAll((all) => all.map((element) => element.getAttribute("data-prototype")))).toEqual(["arithmetic-combinator", "mod-arithmetic"]);
    await expect(choice.getByRole("button", { pressed: true })).toHaveText(/Tiny arithmetic combinator.*1 tile/);
    await expect(inspector(page).locator(".muted-note.prototype-note")).toHaveCount(0);
    await choice.locator('[data-prototype="arithmetic-combinator"]').click();
    await expect(choice.getByRole("button", { pressed: true })).toHaveText(/Arithmetic combinator.*1 x 2 tiles/);
    expect(await sourceText(page)).toMatch(/    arithmetic-combinator arithmetic1 at \(\d+, \d+\) \{\n    \}/);
    await choice.locator('[data-prototype="mod-arithmetic"]').click();
    expect(await sourceText(page)).toMatch(/    mod-arithmetic arithmetic1 at \(\d+, \d+\) \{\n    \}/);
    await page.screenshot({ path: resolve(SHOTS, "modded-kinds-inspector.png") });

    // A circuit of modded prototypes is free of problems, and on the board each stands on the tiles of its prototype.
    await setSource(page, MODDED_KINDS_SOURCE);
    expect(await page.evaluate(() => window.faceSession!.getState().diagnostics)).toEqual([]);
    await showDisplay(page, "blueprint");
    const bodySize = (name: string): Promise<(string | null)[]> => card(page, name).locator(".card-body").evaluate((body) => [body.getAttribute("width"), body.getAttribute("height")]);
    // A body leaves four units of its tiles free on every side: 72 is one tile, 152 two.
    expect(await Promise.all(["source", "double", "gate", "relay", "light", "feed"].map(bodySize))).toEqual([["72", "72"], ["72", "72"], ["152", "152"], ["152", "152"], ["152", "152"], ["72", "72"]]);
    for (const name of ["double", "gate"]) for (const side of ["in", "out"] as const) await expect(pin(page, name, side, "red")).toHaveCount(1);
    // The combinator of two by two tiles has its halves across its facing, like the one of the game: two arrows and the notch between.
    await expect(card(page, "gate").locator(".board-arrow")).toHaveCount(2);
    await expect(card(page, "double").locator(".board-arrow")).toHaveCount(0);
    await expect(card(page, "relay")).toHaveAttribute("data-kind", "pole");
    await page.screenshot({ path: resolve(SHOTS, "modded-kinds-board.png") });

    // It computes as the standard entities do: the lamp behind the modded pole is lit.
    for (let tick = 0; tick < 6 && (await card(page, "light").getAttribute("data-status")) !== "lit"; tick++) await page.getByRole("button", { name: "Step" }).click();
    await expect(card(page, "light")).toHaveAttribute("data-status", "lit");

    // The blueprint names every entity by its prototype.
    const exported = await page.evaluate(() => {
      const result = window.faceSession!.commands.exportBlueprint();
      return result.ok ? result.string : undefined;
    });
    const decoded = decodeBlueprintString(exported ?? "");
    expect(decoded.ok && (decoded.data as { blueprint: { entities: { name: string }[] } }).blueprint.entities.map((entity) => entity.name)).toEqual(["constant-combinator", "mod-arithmetic", "mod-decider", "mod-pole", "mod-lamp", "mod-loader"]);

    // Saved and opened with the built-in data: the project comes back, and each entity of the mod is named as unknown.
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
    }, projectPath);
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    await openSettings(app, page);
    await builtInButton(page).click();
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE, { timeout: 20_000 });
    await page.keyboard.press("Escape");
    expect(await sourceText(page)).toBe(MODDED_KINDS_SOURCE);
    const flagged = await page.evaluate(() => window.faceSession!.getState().diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.message));
    const missing = (name: string): string => `Unknown entity '${name}': the game data in use has no entity of this name (the names are the game's, as a blueprint has them: constant-combinator, small-lamp, steel-chest)`;
    // One error per declaration, on its word; the five wires that end at them are left out and say nothing.
    expect(flagged).toEqual([missing("mod-arithmetic"), missing("mod-decider"), missing("mod-pole"), missing("mod-lamp"), "Unknown entity 'mod-loader'; did you mean loader?"]);
  } finally {
    await closeApp(app);
  }
});

/** A game with many mods: twelve that add a crate each, and two that add nothing. */
const CRATES = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
/** A title as a mod may write it: it is shown as the text it is. */
const BOLD_TITLE = "<b>Bold</b> crates 03";
const crateTitle = (number: string): string => (number === "03" ? BOLD_TITLE : `Crates ${number}`);
const MANY_MODS: readonly FakeMod[] = [
  // crates-02 needs crates-01, and crates-05 needs crates-04 through a mod that adds nothing.
  ...CRATES.map((number) => ({ name: `crates-${number}`, version: "1.0.0", title: crateTitle(number), dependencies: ["base >= 2.1", ...(number === "02" ? ["crates-01"] : number === "05" ? ["glue-lib >= 0.1"] : [])] })),
  { name: "glue-lib", version: "0.1.0", title: "Glue", dependencies: ["base", "crates-04"] },
  { name: "zz-lib", version: "0.1.0", title: "A library", dependencies: ["base"] },
];
const MANY_CRATES: CannedDump = { entities: CRATES.map((number) => ({ name: `crate-${number}`, type: "container", label: `Crate ${number}`, size: [1, 1], module: `crates-${number}` })) };
const USES_CRATES = `circuit "Crates" {
    crate-07 box at (40, 80) {
    }

    constant-combinator source at (300, 80) {
        item:crate-08 = 1
    }
}
`;

test("a game with many mods: the list scrolls and filters, mods switch with what they need, a project says which it uses although they are off, and an import switches on what it needs", async () => {
  const { app, page } = await launchWithGame({ dump: MANY_CRATES, mods: MANY_MODS });
  try {
    await readGame(app, page, /^Read from your game on .+: 2\.1\.24 with 15 mods$/);
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);
    expect(await enabledModules(page)).toEqual(["base"]);

    // The list: the game's module first, then the mods that add something by name; the two that add nothing are counted.
    await page.locator("[data-settings-toggle]").click();
    const projectSettings = projectSettingsOf(page);
    const rows = projectSettings.locator(".module-list li");
    const listed = ["base", ...CRATES.map((number) => `crates-${number}`), "some-mod"];
    expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-module")))).toEqual(listed);
    await expect(projectSettings.locator('[data-note="other-mods"]')).toHaveText("2 other mods of your game add no signals or entities.");
    await expect(projectSettings.locator('[data-note="mods-hint"]')).toHaveCount(0);
    await expect(moduleRow(page, "crates-01").locator(".module-count")).toHaveText("1 signal, 1 entity");
    // A title is text, whatever a mod writes into it.
    await expect(moduleRow(page, "crates-03").locator(".module-title")).toHaveText(BOLD_TITLE);
    await expect(moduleRow(page, "crates-03").locator("b")).toHaveCount(0);
    // Fourteen rows have their own scrolling area, so that the rest of the panel stays in reach.
    const list = projectSettings.locator(".module-list");
    expect(await list.evaluate((element) => [getComputedStyle(element).overflowY, element.scrollHeight > element.clientHeight])).toEqual(["auto", true]);
    await page.screenshot({ path: resolve(SHOTS, "project-settings-many-mods.png") });

    // The filter finds a mod by its title or its name; Escape empties it and leaves the panel open.
    const filter = projectSettings.getByLabel("Filter signal groups");
    await filter.fill("bold");
    expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-module")))).toEqual(["crates-03"]);
    await filter.fill("CRATES-1");
    expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-module")))).toEqual(["crates-10", "crates-11", "crates-12"]);
    await filter.fill("no such mod");
    await expect(rows).toHaveCount(0);
    await expect(projectSettings.locator('[data-note="no-match"]')).toHaveText("No signal group matches the filter.");
    await page.screenshot({ path: resolve(SHOTS, "project-settings-filter.png") });
    await filter.press("Escape");
    await expect(filter).toHaveValue("");
    await expect(rows).toHaveCount(listed.length);
    await expect(projectSettings).toBeVisible();

    // Dependencies: a mod is switched on with what it requires, also through a mod that is not listed, and off with what requires it.
    await expect(moduleRow(page, "crates-02").locator("small")).toHaveText("Switching on also switches on Crates 01");
    await expect(moduleRow(page, "crates-05").locator("small")).toHaveText("Switching on also switches on Crates 04");
    await moduleRow(page, "crates-05").locator("input").check();
    expect(await enabledModules(page)).toEqual(["base", "crates-04", "crates-05"]);
    await expect(moduleRow(page, "crates-04").locator("small")).toHaveText("Switching off also switches off Crates 05");
    await moduleRow(page, "crates-04").locator("input").uncheck();
    expect(await enabledModules(page)).toEqual(["base"]);
    await page.keyboard.press("Escape");
    await expect(projectSettings).toHaveCount(0);

    // A circuit with an entity and a signal of mods that are off: both stay, each with a warning that names its mod.
    await setSource(page, USES_CRATES);
    expect(await problems(page)).toEqual([
      "warning disabled-prototype: 'crate-07' (Crate 07) is an entity of Crates 07, which is switched off in the project settings",
      "warning disabled-signal: The signal 'item:crate-08' is of Crates 08, which is switched off in the project settings",
    ]);
    expect(await entityNames(page)).toEqual(["box", "source"]);
    await expect(paletteEntry(page, "crate-07")).toHaveCount(0);
    await page.locator("[data-settings-toggle]").click();
    const unused = projectSettings.locator('[data-note="modules-off"]');
    await expect(unused.locator("p")).toHaveText("This project uses signals or entities of Crates 07, Crates 08, which are switched off. They are marked with a warning and are not offered.");
    await page.screenshot({ path: resolve(SHOTS, "project-settings-mods-in-use.png") });
    await unused.getByRole("button", { name: "Switch them on" }).click();
    await expect(unused).toHaveCount(0);
    expect(await enabledModules(page)).toEqual(["base", "crates-07", "crates-08"]);
    expect(await problems(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(paletteEntry(page, "crate-07")).toHaveCount(1);

    // A blueprint with a crate of one mod and a signal of another opens as a project that has those mods on, with what they
    // require, and the report names them. The mods of the project before play no part.
    const blueprint = encodeBlueprintString({
      blueprint: {
        item: "blueprint",
        label: "Two crates",
        version: 562954249109504,
        entities: [
          { entity_number: 1, name: "crate-05", position: { x: 0.5, y: 0.5 } },
          { entity_number: 2, name: "constant-combinator", position: { x: 2.5, y: 0.5 }, control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, name: "crate-09", count: 1 }] }] } } },
        ],
      },
    });
    await clickMenu(app, "File", "Import Blueprint", "Paste Blueprint...");
    const paste = page.getByRole("dialog", { name: "Paste blueprint string" });
    await paste.getByRole("textbox", { name: "Blueprint string" }).fill(blueprint);
    await expect(paste.locator('[data-message="blueprint"]')).toHaveText('"Two crates": 2 entities.');
    await paste.getByRole("button", { name: "Import", exact: true }).click();
    const report = page.getByRole("dialog", { name: "Blueprint imported" });
    await expect(report.locator('[data-message="summary"]')).toHaveText('"Two crates": Imported 2 entities and 0 wires.');
    await expect(report.getByRole("region", { name: "Signal groups" }).getByRole("listitem")).toHaveText([
      "Switched on: Crates 04, Crates 05, Crates 09. The blueprint has their signals or entities; a new project has only the modules of the game itself on.",
    ]);
    await page.screenshot({ path: resolve(SHOTS, "import-report-mods.png") });
    await report.getByRole("button", { name: "OK" }).click();
    await expect(report).toHaveCount(0);
    expect(await enabledModules(page)).toEqual(["base", "crates-04", "crates-05", "crates-09"]);
    expect(await entityNames(page)).toEqual(["crate1", "constant1"]);
    expect(await problems(page)).toEqual([]);
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
    expect(await page.evaluate(() => window.faceSession!.getState().project.gameData)).toBe(false);
    expect(await page.evaluate(() => window.faceSession!.getState().catalog.modules.map((module) => module.name))).toEqual(["base", "elevated-rails", "recycler", "quality", "space-age"]);
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

test("a data file of the earlier format falls back to the built-in data and asks to read the game again, which replaces it", async () => {
  const first = await launchWithGame();
  const file = join(first.userData, "game-data.json");
  try {
    await readGame(first.app, first.page);
  } finally {
    await closeApp(first.app);
  }
  // As the app wrote it before every record named the mod that adds it.
  const stored = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  expect(stored.version).toBe(2);
  await writeFile(file, JSON.stringify({ ...stored, version: 1 }));

  const { app, page } = await launchWithGame({ userData: first.userData, program: first.program, folder: resolve(first.dataDirectory, process.platform === "darwin" ? "../.." : "..") });
  try {
    const outdated = "The data read from your game was stored by an earlier version of this app and cannot be used by this one. Read the game again to work with your game's data. The built-in data is in use.";
    const hint = page.locator(".data-hint");
    await expect(hint).toContainText(outdated);
    expect(await page.evaluate(() => window.faceSession!.getState().project.gameData)).toBe(false);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(0);
    expect(await dataInUse(page)).toMatchObject({ source: { kind: "built-in", version: "2.1.24" }, catalog: null, entities: null });

    await hint.getByRole("button", { name: "Game data..." }).click();
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE);
    await expect(message(page, "data-problem")).toHaveText(outdated);
    await expect(readButton(page)).toHaveText("Read from the game...");
    await expect(builtInButton(page)).toBeEnabled();

    // Reading the game again writes a file of the current format; the window is loaded again with it and the message is gone.
    await answerMessageBoxes(app, { run: true });
    await readButton(page).click();
    await expect(source(page)).toHaveText(READ_SOURCE, { timeout: 20_000 });
    await expect(message(page, "data-problem")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".data-hint")).toHaveCount(0);
    await gameDataInUse(page);
    await switchOn(page);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(1);
    expect((JSON.parse(await readFile(file, "utf8")) as { version: number }).version).toBe(2);
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
    await gameDataInUse(page);
    // The window starts with a new project: the mod is in its list, off.
    expect(await page.evaluate(() => window.faceSession!.getState().catalog.modules.map((module) => [module.name, module.enabled]))).toEqual([["base", true], ["some-mod", false]]);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(0);
    await switchOn(page);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(1);
    await page.evaluate(() => window.faceSession!.commands.setModuleEnabled("some-mod", false));
    await expect(page.locator(".data-hint")).toHaveCount(0);

    // An unsaved change, and the user keeps the window: the data waits, and the dialog offers to load the window again.
    await setSource(page, 'circuit "Kept" {\n    constant-combinator keep at (40, 80) {\n    }\n}\n');
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
