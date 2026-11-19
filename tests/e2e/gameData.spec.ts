// The entity and signal data read from the user's game: the "Game data" section of the application settings, the native
// confirmation before the game is run, progress, failure and cancellation, the window loaded again with the new data, the mods of
// the game as modules a project switches, what a mod brings to the selector and the picker once it is on, what a project says
// that uses a mod that is off, a blueprint import that switches mods on, and the record of the mods in the project file. The game is a stand-in
// (apps/desktop/test/support/fakeFactorio.mjs) in an installation the test builds; the real game is never started.
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FLAWED_ENTITIES, MOD_ENTITY, MOD_SIGNAL, MODDED_KINDS, type CannedDump, type WiredEntity } from "../../apps/desktop/test/support/cannedDump.ts";
import type { GameDataInUse, GameDataStatus } from "../../apps/desktop/src/ipc.ts";
import { decodeBlueprintString, encodeBlueprintString } from "../../packages/blueprints/src/string.ts";
import {
  APP_TITLE, card, clickMenu, clientPointOf, closeApp, entityNames, expect, launchApp, newProjectPath, openProject, pin, readProjectEntries, SCREENSHOT_DIR, selectEntity, showDisplay, shrinkToMinimum, sourceText, test,
  type RunningApp,
} from "./app.ts";
import { inspector, setSource } from "./board.ts";
import { addFakeProgram, fetchAsset, MOD_ICON_COLOR, pngFacts, setFakeProgram, writeFakeGame, type FakeMod, type FakeProgram } from "./fakeGame.ts";

const SHOTS = resolve(SCREENSHOT_DIR, "game-data");
const SETTINGS_MENU = process.platform === "darwin" ? [APP_TITLE, "Settings..."] : ["File", "Settings..."];
const CONFIRMATION = "Run Factorio to read its entities and signals?";
const READ_SOURCE = /^Read from your game on .+: 2\.1\.25 with 1 mod$/;
const BUILT_IN_SOURCE = "Built in, Factorio 2.1.25";
/** What a read warns of when the icon table lacks icons; with the mod of these tests loaded it lacks none. */
const ICON_WARNING = /icons? (is|are) not shown/;
/** Where the page asks for the icons of the catalog. */
const CATALOG_ICONS = "face-asset://catalog/icons/";

/** The address of a catalog icon, with or without the revision that follows a change of the game data. */
const iconAddress = (id: string): RegExp => new RegExp(`^${CATALOG_ICONS}${id}\\.png(\\?r=\\d+)?$`);

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

/** The images on the page whose loading has ended without a picture, by address: none, since an icon the app has no entry for is not asked for and one that fails all the same gives way to a name. */
function brokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.images).filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.src));
}

/** Waits until the one image inside `within` has loaded with a picture, and answers with its address. */
async function loadedImage(within: Locator): Promise<string> {
  const image = within.locator("img");
  await expect(image).toHaveCount(1);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  return (await image.getAttribute("src")) ?? "";
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
    expect(await status(page)).toEqual({ inUse: { kind: "built-in", version: "2.1.25" }, pending: null, stale: false, unavailable: null, problem: null, discardable: false, leftOut: [], run: { state: "idle" } });
    const builtIn = await dataInUse(page);
    expect(builtIn).toEqual({ source: { kind: "built-in", version: "2.1.25" }, problem: null, mods: [], catalog: null, entities: null, icons: expect.any(Array) as string[] });
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
    // The icons of the mod are in the icon table: nothing is left out, and nothing warns of it.
    await expect(section(page).getByText(ICON_WARNING)).toHaveCount(0);
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
    expect(current).toMatchObject({ inUse: { kind: "game", version: "2.1.25", build: 88022, mods: 1 }, pending: null, stale: false, unavailable: null, problem: null, discardable: true, run: { state: "done" } });
    const read = await dataInUse(page);
    expect(read.mods).toEqual([{ name: "base", version: "2.1.25" }, { name: "some-mod", version: "1.2.3" }]);
    // The mod is described by the info.json in its archive, and what it created names it; nothing of that is a warning.
    expect(read.catalog!.modules).toEqual([{ name: "base", title: "base", version: "2.1.25", requires: [], recommends: [], featureFlags: [] }, { name: "some-mod", title: "Some Mod", version: "1.2.3", requires: ["base"], recommends: [], featureFlags: [] }]);
    expect(read.catalog!.signals.virtual!.map((signal) => [signal.name, signal.modules])).toEqual([[MOD_SIGNAL, ["some-mod"]], ["signal-A", ["base"]]]);
    await expect(message(page, "warnings").locator("li", { hasText: "info.json" })).toHaveCount(0);
    // The window is told which icons the app has: those made of the game's own files, and those made of the mod's.
    expect(read.icons).toEqual(expect.arrayContaining(["virtual/signal-A", "item/constant-combinator", "group/g", `virtual/${MOD_SIGNAL}`, `item/${MOD_ENTITY}`, "item/gadget"]));
    // An icon of the mod is drawn from the archive in the user's mod directory, which is as it was.
    const modIcon = await fetchAsset(app, `${CATALOG_ICONS}item/${MOD_ENTITY}.png`);
    expect([modIcon.status, modIcon.contentType]).toEqual([200, "image/png"]);
    expect(pngFacts(modIcon.bytes)).toEqual({ size: [64, 64], center: MOD_ICON_COLOR });
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

interface DialogShape {
  /** The dialog is as high as the window allows: the height of the backdrop without its padding. */
  readonly fills: boolean;
  readonly height: number;
  /** How far the dialog scrolls as a whole. */
  readonly overflow: number;
  /** The box of the left-out entities while it is open: its height, how far it scrolls, and the headings and names that are in view in full. */
  readonly list: { readonly height: number; readonly overflow: number; readonly headings: number; readonly names: number } | null;
}

/** How the application settings take the height of the window. */
function dialogShape(page: Page): Promise<DialogShape> {
  return settingsDialog(page).evaluate((panel) => {
    const backdrop = panel.parentElement!;
    const padding = getComputedStyle(backdrop);
    const room = backdrop.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
    const { height } = panel.getBoundingClientRect();
    const box = panel.querySelector(".left-out-groups");
    const frame = box?.getBoundingClientRect();
    const inView = (selector: string): number => [...box!.querySelectorAll(selector)].map((element) => element.getBoundingClientRect()).filter((rect) => rect.top >= frame!.top && rect.bottom <= frame!.bottom).length;
    return {
      fills: Math.abs(height - room) < 1,
      height,
      overflow: panel.scrollHeight - panel.clientHeight,
      list: box && frame ? { height: frame.height, overflow: box.scrollHeight - box.clientHeight, headings: inView("h4"), names: inView("li") } : null,
    };
  });
}

test("a read says how many entities it left out, lists them by reason behind a disclosure, copies the list, and has it after a restart", async () => {
  const SUMMARY = "3 entities of your game were left out: they cannot be placed or imported, because the game's data about them does not fit together. Such entities are mostly internal helper entities of mods.";
  const SIZE_FOUND = "tile size is 0 x 0 at run time, 1 x 1 as derived from data.raw";
  const LIST = [
    "Entities of the game that were left out: 3",
    "",
    "The game's data gives them no collision box, so they have no size. (2)",
    "Found: no collision box",
    "mod-helper-a",
    "mod-helper-b",
    "",
    "The running game gives them another size in tiles than the game's data files do. (1)",
    `Found: ${SIZE_FOUND}`,
    "mod-hidden-lamp",
    "",
  ].join("\n");
  const leftOut = (page: Page): Locator => message(page, "left-out");
  const toggle = (page: Page): Locator => leftOut(page).getByRole("button", { name: "Left-out entities" });
  const list = (page: Page): Locator => leftOut(page).getByRole("group", { name: "Entities that were left out, by reason" });

  const first = await launchWithGame({ dump: { entities: FLAWED_ENTITIES } });
  try {
    const { app, page } = first;
    await readGame(app, page);
    // One line says how many and what that means; the run's warnings do not say it a second time. The list is closed.
    await expect(leftOut(page).locator("p.settings-message")).toHaveText(SUMMARY);
    await expect(section(page).getByText(ICON_WARNING)).toHaveCount(0);
    // No warning of the run repeats it: with nothing else to warn about there is no list of warnings at all.
    await expect(message(page, "warnings")).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(list(page)).toHaveCount(0);
    expect((await status(page)).leftOut).toEqual([
      { name: "mod-helper-b", reason: "no-collision-box", detail: "no collision box" },
      { name: "mod-helper-a", reason: "no-collision-box", detail: "no collision box" },
      { name: "mod-hidden-lamp", reason: "size", detail: SIZE_FOUND },
    ]);
    // What was left out is not among the entities of the data in use.
    const names = ((await dataInUse(page)).entities as { entities: { name: string }[] }).entities.map((entity) => entity.name);
    expect(FLAWED_ENTITIES.filter((entity) => names.includes(entity.name))).toEqual([]);

    // Opened by pointer or key: the entities by reason, each reason in plain words, in a box that scrolls.
    await toggle(page).focus();
    await page.keyboard.press("Enter");
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(list(page).locator("section")).toHaveCount(2);
    const group = (reason: string): Locator => list(page).locator(`section[data-reason="${reason}"]`);
    await expect(group("no-collision-box").locator("h4")).toHaveText("The game's data gives them no collision box, so they have no size. (2)");
    await expect(group("no-collision-box").locator("li")).toHaveText(["mod-helper-a", "mod-helper-b"]);
    await expect(group("size").locator("h4")).toHaveText("The running game gives them another size in tiles than the game's data files do. (1)");
    await expect(group("size").locator(".left-out-found")).toHaveText(`Found: ${SIZE_FOUND}`);
    await expect(group("size").locator("li")).toHaveText(["mod-hidden-lamp"]);
    // With the list open the dialog is as high as the window allows and does not scroll as a whole: the box of the list takes
    // the height the other parts leave. These few lines fit it, so both reasons are in view.
    expect(await list(page).evaluate((element) => [getComputedStyle(element).maxHeight, getComputedStyle(element).overflowY, element.scrollHeight - element.clientHeight])).toEqual(["none", "auto", 0]);
    expect(await dialogShape(page)).toMatchObject({ fills: true, overflow: 0, list: { headings: 2, names: 3 } });
    await page.screenshot({ path: resolve(SHOTS, "left-out.png") });

    // A name is text: a triple click selects it, and the copy key takes it.
    await group("size").locator("li").click({ clickCount: 3 });
    expect(await page.evaluate(() => document.getSelection()!.toString().trim())).toBe("mod-hidden-lamp");
    await page.keyboard.press("ControlOrMeta+c");
    await expect.poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).trim()).toBe("mod-hidden-lamp");

    // The button copies the whole list as plain text.
    await leftOut(page).getByRole("button", { name: "Copy list" }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(LIST);
    await expect(leftOut(page).getByRole("button", { name: "Copied" })).toBeVisible();
    await toggle(page).click();
    await expect(list(page)).toHaveCount(0);
  } finally {
    await closeApp(first.app);
  }

  // At the next start there is no run to report, and the list is there all the same: it belongs to the data.
  const { app, page } = await launchWithGame({ userData: first.userData, program: first.program, folder: resolve(first.dataDirectory, process.platform === "darwin" ? "../.." : "..") });
  try {
    await gameDataInUse(page);
    await openSettings(app, page);
    await expect(message(page, "warnings")).toHaveCount(0);
    await expect(leftOut(page).locator("p.settings-message")).toHaveText(SUMMARY);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await toggle(page).click();
    await expect(list(page).locator("li")).toHaveText(["mod-helper-a", "mod-helper-b", "mod-hidden-lamp"]);
    // Back to the built-in data, which leaves nothing out.
    await answerMessageBoxes(app, { run: true, unsaved: 1 });
    await builtInButton(page).click();
    await expect(source(page)).toHaveText(BUILT_IN_SOURCE, { timeout: 20_000 });
    await expect(leftOut(page)).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});

test("a long list of left-out entities takes the height the dialog has left and scrolls by itself; the dialog scrolls as a whole only in a window too low for that", async () => {
  // Two helpers without a collision box, and two dozen without a size: the second reason begins a few lines below the first.
  const ghosts = Array.from({ length: 24 }, (_, index): WiredEntity => ({ name: `mod-ghost-${String(index + 1).padStart(2, "0")}`, type: "lamp", label: `Ghost ${index + 1}`, size: [1, 1], module: "some-mod", flaw: "no-size" }));
  const { app, page } = await launchWithGame({ dump: { entities: [...FLAWED_ENTITIES.slice(0, 2), ...ghosts] } });
  try {
    await readGame(app, page);
    const leftOut = message(page, "left-out");
    await expect(leftOut.locator("p.settings-message")).toContainText("26 entities of your game were left out");
    // Closed, the dialog is as high as its content.
    const closed = await dialogShape(page);
    expect(closed).toMatchObject({ fills: false, overflow: 0, list: null });

    await leftOut.getByRole("button", { name: "Left-out entities" }).click();
    const box = leftOut.getByRole("group", { name: "Entities that were left out, by reason" });
    await expect(box.locator("section")).toHaveCount(2);
    await expect(box.locator("li")).toHaveCount(26);
    // Open, it is as high as the window allows and does not scroll as a whole: the list is the one part that scrolls. It has
    // what the other parts leave, which is room for the first reason with its two names, the heading of the second and more.
    const open = await dialogShape(page);
    expect(open).toMatchObject({ fills: true, overflow: 0 });
    expect(open.height).toBeGreaterThan(closed.height);
    expect(open.list!.overflow).toBeGreaterThan(0);
    expect(open.list!.height).toBeGreaterThanOrEqual(120);
    expect(open.list!.headings).toBe(2);
    expect(open.list!.names).toBeGreaterThan(2);
    // The parts below the list are in view with it: nothing of the dialog is outside of it.
    await expect(leftOut.getByRole("button", { name: "Copy list" })).toBeInViewport({ ratio: 1 });
    await expect(readButton(page)).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: resolve(SHOTS, "left-out-long.png") });

    // The smallest window leaves the list less than its minimum: it keeps that, and only then does the dialog scroll as a whole.
    await shrinkToMinimum(app, page);
    const low = await dialogShape(page);
    expect(low.fills).toBe(true);
    expect(low.overflow).toBeGreaterThan(0);
    expect(Math.round(low.list!.height)).toBe(120);
    expect(low.list!.overflow).toBeGreaterThan(0);

    // Closed again it is as high as its content, as before.
    await leftOut.getByRole("button", { name: "Left-out entities" }).click();
    await expect(box).toHaveCount(0);
    expect((await dialogShape(page)).list).toBeNull();
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

    // The selector has the mod's crate among the game's entities, with the name the game gives it and the mod's own icon, which loaded.
    const crate = paletteEntry(page, MOD_ENTITY);
    await expect(crate).toHaveAccessibleName("Mod crate");
    await expect(crate).toHaveAttribute("data-kind", "entity");
    expect(await loadedImage(crate)).toMatch(iconAddress(`item/${MOD_ENTITY}`));
    await expect(crate.locator("svg")).toHaveCount(0);
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
    // The tile shows the mod's icon, drawn from the mod's archive, and not the name that stands in for an icon that is missing or fails.
    await expect(entry).not.toHaveClass(/(^| )text( |$)/);
    expect(await loadedImage(entry)).toMatch(iconAddress(`virtual/${MOD_SIGNAL}`));
    await expect(entry.locator(".icon-fallback")).toHaveCount(0);
    await expect(entry).toHaveText("");
    expect(await brokenImages(page)).toEqual([]);
    await entry.click();
    await expect(picker).toHaveCount(0);
    expect(await sourceText(page)).toContain(`        virtual:${MOD_SIGNAL} = 1\n`);
    // The same in the inspector's signal field and in the signal history, which show an icon where there is one.
    await expect(page.locator(".trace-signal", { hasText: MOD_SIGNAL })).toBeVisible();
    expect(await loadedImage(inspector.locator(".signal-input"))).toMatch(iconAddress(`virtual/${MOD_SIGNAL}`));
    expect(await loadedImage(page.locator(".trace", { hasText: MOD_SIGNAL }).first().locator("th"))).toMatch(iconAddress(`virtual/${MOD_SIGNAL}`));
    expect(await brokenImages(page)).toEqual([]);
    // And on the card: the row of what the combinator sends has the signal as its icon and the value, not the name that stands in without one.
    const sent = card(page, "constant1").locator('.card-row[data-row="out"]');
    await expect(sent.locator(".row-value")).toHaveText("1");
    await expect(sent.locator("image")).toHaveAttribute("href", iconAddress(`virtual/${MOD_SIGNAL}`));
    // Since the launch, with the built-in data and with the game's, every request for an icon was answered with an image: those of the mod too.
    for (const id of ["virtual/signal-A", `virtual/${MOD_SIGNAL}`, `item/${MOD_ENTITY}`]) expect(icons.answered.some((address) => iconAddress(id).test(address)), id).toBe(true);
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
    // The inspector says the same, in the same words: under the title of the entity, and under the field of the signal.
    await selectEntity(page, "mod_crate1");
    await expect(inspector.locator(".entity-warning")).toHaveText("'mod-crate' (Mod crate) is an entity of Some Mod, which is switched off in the project settings");
    await selectEntity(page, "constant1");
    await expect(inspector.locator(".entity-warning")).toHaveCount(0);
    await expect(inspector.locator(".field-warning")).toHaveText("Belongs to Some Mod, which is switched off in the project settings");
    // The picker does not offer the signal any more, and a search that would find it says where it is switched on.
    await inspector.getByRole("button", { name: "Choose signal 1" }).click();
    await picker.getByLabel("Search signals").fill("mod sig");
    await expect(picker.locator(".picker-signal")).toHaveCount(0);
    await expect(picker.locator(".picker-signals .muted-note:not([data-note])")).toHaveText('No signal matches "mod sig".');
    await expect(picker.locator('[data-note="not-offered"]')).toHaveText("1 signal of Some Mod matches. It is switched off in this project (Project Settings).");
    // A search that finds nothing of the mod says nothing about it.
    await picker.getByLabel("Search signals").fill("signal a");
    await expect(picker.locator('[data-signal="virtual:signal-A"]')).toHaveCount(1);
    await expect(picker.locator('[data-note="not-offered"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await selectEntity(page, "mod_crate1");
    await page.screenshot({ path: resolve(SHOTS, "inspector-mod-off.png") });
    await page.locator("[data-settings-toggle]").click();
    const unused = projectSettings.locator('[data-note="modules-off"]');
    await expect(unused).toContainText("This project uses signals or entities of Some Mod, which is switched off.");
    await page.screenshot({ path: resolve(SHOTS, "project-settings-mod-in-use.png") });
    await unused.getByRole("button", { name: "Switch it on" }).click();
    await expect(unused).toHaveCount(0);
    await expect(moduleRow(page, "some-mod").locator("input")).toBeChecked();
    // The button went away under the focus: Escape closes the panel all the same.
    await page.keyboard.press("Escape");
    await expect(projectSettings).toHaveCount(0);
    expect(await problems(page)).toEqual([]);
    await expect(card(page, "mod_crate1")).toHaveClass(/selected/);
    await expect(inspector.locator(".entity-warning")).toHaveCount(0);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(1);

    // Saved: the file has the record of the game and its mods, and the module list of the project with the mod in it.
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
    }, projectPath);
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    const saved = JSON.parse((await readProjectEntries(projectPath))["face.json"]!) as Record<string, unknown>;
    expect(saved.gameMods).toEqual({ gameVersion: "2.1.25", mods: [{ name: "base", version: "2.1.25" }, { name: "some-mod", version: "1.2.3" }] });
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
    await expect(projectSettings.locator('[data-note="made-with"]')).toHaveText("Made with Factorio 2.1.25 with some-mod 1.2.3.");
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

const USES_MOD = `circuit "Uses the mod" {
    ${MOD_ENTITY} crate at (40, 80) {
    }

    constant-combinator source at (300, 80) {
        virtual:${MOD_SIGNAL} = 1
        item:gadget = 2
    }
}
`;
const MOD_HIDDEN = { module: "some-mod", signals: ["item:gadget", `virtual:${MOD_SIGNAL}`], entities: [MOD_ENTITY] };
const storedSettings = async (userData: string): Promise<unknown> => JSON.parse(await readFile(resolve(userData, "app-settings.json"), "utf8"));

test("signals and an entity of a mod are hidden in the dialog of its row: neither the picker nor the selector offers them, a project that uses them has no warning, and the choice holds after a restart and for a new project", async () => {
  const itemsButtons = (page: Page): Locator => projectSettingsOf(page).locator('.module-list li [data-action="choose-items"]');
  const itemsDialog = (page: Page): Locator => page.getByRole("dialog", { name: "Some Mod", exact: true });
  const openItems = (page: Page): Promise<void> => projectSettingsOf(page).getByRole("button", { name: "Signals and entities of Some Mod", exact: true }).click();
  const listOf = (page: Page, name: string): Locator => itemsDialog(page).getByRole("listbox", { name, exact: true });
  const rowsOf = (page: Page, name: string): Locator => listOf(page, name).getByRole("option");
  const side = (page: Page, name: "signals" | "entities"): Locator => itemsDialog(page).locator(`.side-switch button[data-side="${name}"]`);
  const button = (page: Page, name: string): Locator => itemsDialog(page).getByRole("button", { name, exact: true });
  const inUse = (page: Page): Locator => palette(page).locator(`.palette-tile.in-use[data-prototype="${MOD_ENTITY}"]`);

  const first = await launchWithGame();
  try {
    const { app, page, userData } = first;
    await readGame(app, page);
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);
    // A project with the mod on that uses its crate and two of its signals.
    await switchOn(page);
    await setSource(page, USES_MOD);
    await expect(card(page, "crate")).toHaveCount(1);
    expect(await problems(page)).toEqual([]);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(1);
    await expect(inUse(page)).toHaveCount(1);

    // The module of the game and the mod have the button; the dialog of the mod lists what it brings, in the game's order.
    await page.locator("[data-settings-toggle]").click();
    await expect(itemsButtons(page)).toHaveCount(2);
    await openItems(page);
    await expect(itemsDialog(page)).toBeVisible();
    await expect(projectSettingsOf(page)).toHaveCount(1);
    await expect(side(page, "signals")).toHaveText("Signals3");
    await expect(side(page, "entities")).toHaveText("Entities1");
    await expect(rowsOf(page, "Shown signals")).toHaveText(["Gadget", "Mod crate", "Mod signal"]);
    await expect(rowsOf(page, "Shown signals").first()).toHaveAttribute("title", "item:gadget");
    await expect(rowsOf(page, "Hidden signals")).toHaveCount(0);
    // A row has the mod's own icon where the app can draw it, as the picker has.
    expect(await loadedImage(rowsOf(page, "Shown signals").last())).toMatch(iconAddress(`virtual/${MOD_SIGNAL}`));

    // Two signals with the arrow to the right, then the entity.
    await rowsOf(page, "Shown signals").first().click();
    await listOf(page, "Shown signals").getByRole("option", { name: "Mod signal", exact: true }).click({ modifiers: ["ControlOrMeta"] });
    await button(page, "Hide").click();
    await expect(rowsOf(page, "Hidden signals")).toHaveText(["Gadget", "Mod signal"]);
    await expect(rowsOf(page, "Shown signals")).toHaveText(["Mod crate"]);
    await expect(side(page, "signals")).toHaveText("Signals3, 2 hidden");
    await side(page, "entities").click();
    await expect(rowsOf(page, "Shown entities")).toHaveText(["Mod crate"]);
    await rowsOf(page, "Shown entities").first().click();
    await button(page, "Hide").click();
    await expect(rowsOf(page, "Hidden entities")).toHaveText(["Mod crate"]);
    await expect(rowsOf(page, "Shown entities")).toHaveCount(0);
    await expect(itemsDialog(page).locator('[data-list="shown"] [data-note="empty"]')).toHaveText("Every entity is hidden.");
    await expect.poll(() => storedSettings(userData)).toEqual({ version: 1, gameDirectory: null, hidden: [MOD_HIDDEN] });
    await page.screenshot({ path: resolve(SHOTS, "module-items-mod.png") });
    await button(page, "Close").click();
    await expect(itemsDialog(page)).toHaveCount(0);
    await expect(moduleRow(page, "some-mod").locator(".module-count")).toHaveText("3 signals, 1 entity, 3 hidden");
    await page.keyboard.press("Escape");
    await expect(projectSettingsOf(page)).toHaveCount(0);

    // The selector does not offer the crate, in its tab or in its search; the one of the circuit is in use all the same.
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(0);
    await expect(paletteEntry(page, "small-lamp")).toHaveCount(1);
    await expect(inUse(page)).toHaveCount(1);
    await palette(page).getByLabel("Search entities").fill("crate");
    await expect(palette(page).locator(".palette-catalog .palette-empty")).toHaveText('No entity matches "crate".');
    await palette(page).getByLabel("Search entities").fill("");

    // The picker has the one signal of the mod that is not hidden, and neither of the two that are.
    await selectEntity(page, "source");
    await inspector(page).getByRole("button", { name: "Choose signal 1" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a signal" });
    await picker.getByLabel("Search signals").fill("mod");
    await expect(picker.locator('[data-signal="item:mod-crate"]')).toHaveCount(1);
    await expect(picker.locator(`[data-signal="virtual:${MOD_SIGNAL}"]`)).toHaveCount(0);
    // A search says that it matches what is hidden, below what it found and below the line of a search that found nothing.
    const hiddenNote = '1 matching signal is hidden on this machine (Project Settings, "Signals and entities" of its group).';
    await expect(picker.locator('[data-note="not-offered"]')).toHaveText(hiddenNote);
    await picker.getByLabel("Search signals").fill("gadget");
    await expect(picker.locator(".picker-signals .muted-note:not([data-note])")).toHaveText('No signal matches "gadget".');
    await expect(picker.locator('[data-note="not-offered"]')).toHaveText(hiddenNote);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    // The project uses all three: no warning, the crate is drawn, the source is as it was.
    expect(await problems(page)).toEqual([]);
    await expect(page.locator(".statusbar")).not.toContainText("warning");
    await expect(card(page, "crate")).toHaveCount(1);
    await expect(inspector(page).locator(".field-warning")).toHaveCount(0);
    expect(await sourceText(page)).toBe(USES_MOD);
  } finally {
    await closeApp(first.app);
  }

  // After a restart, with the data of the game in use again, a new project has the choice: a mod that is off shows it in its row,
  // and switched on it does not offer what is hidden.
  const second = await launchWithGame({ userData: first.userData, program: first.program, folder: resolve(first.dataDirectory, process.platform === "darwin" ? "../.." : "..") });
  try {
    const { page, userData } = second;
    await gameDataInUse(page);
    expect(await enabledModules(page)).toEqual(["base"]);
    await page.locator("[data-settings-toggle]").click();
    await expect(itemsButtons(page)).toHaveCount(2);
    await expect(moduleRow(page, "some-mod").locator(".module-count")).toHaveText("3 signals, 1 entity, 3 hidden");
    await moduleRow(page, "some-mod").locator("input").check();
    await page.keyboard.press("Escape");
    await expect(projectSettingsOf(page)).toHaveCount(0);
    await expect(paletteEntry(page, "small-lamp")).toHaveCount(1);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(0);

    // Shown again, with the buttons for all of a list: the crate is offered again and the settings file holds nothing about it.
    await page.locator("[data-settings-toggle]").click();
    await openItems(page);
    await expect(rowsOf(page, "Hidden signals")).toHaveText(["Gadget", "Mod signal"]);
    await button(page, "Show all").click();
    await expect(rowsOf(page, "Hidden signals")).toHaveCount(0);
    await expect(rowsOf(page, "Shown signals")).toHaveText(["Gadget", "Mod crate", "Mod signal"]);
    await side(page, "entities").click();
    await button(page, "Show all").click();
    await expect(rowsOf(page, "Shown entities")).toHaveText(["Mod crate"]);
    await expect.poll(() => storedSettings(userData)).toEqual({ version: 1, gameDirectory: null });
    await button(page, "Close").click();
    await expect(moduleRow(page, "some-mod").locator(".module-count")).toHaveText("3 signals, 1 entity");
    await page.keyboard.press("Escape");
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(1);
  } finally {
    await closeApp(second.app);
  }
});

/** The four combinators of the game and the two of the mod, apart on the edit canvas. */
const COMBINATORS_SOURCE = `circuit "Combinators" {
    constant-combinator c at (40, 80) {
        virtual:signal-A = 3
    }

    arithmetic-combinator a at (280, 80) {
        virtual:signal-A = virtual:signal-A * 2
    }

    decider-combinator d at (520, 80) {
        when virtual:signal-A > 5
        output virtual:signal-A = 1
    }

    selector-combinator s at (760, 80) {
    }

    mod-arithmetic tiny at (40, 320) {
        virtual:signal-A = virtual:signal-A * 2
    }

    mod-decider wide at (280, 320) {
        when virtual:signal-A > 5
        output virtual:signal-A = 1
    }
}
`;

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

    // A combinator of a mod has the common part of the inspector: its name in the game, the name, the facing, the description
    // and Delete. In place of the form of its kind it has one line, and nothing offers to make it another entity.
    const notShown = inspector(page).locator('[data-note="settings-not-shown"]');
    await expect(inspector(page).locator(".inspector-identity")).toHaveText("Tiny arithmetic combinator");
    await expect(inspector(page).getByLabel("Entity name")).toHaveValue("arithmetic1");
    await expect(inspector(page).getByRole("group", { name: "Facing" }).getByRole("button")).toHaveCount(4);
    await expect(inspector(page).getByLabel("Description", { exact: true })).toBeVisible();
    await expect(inspector(page).getByRole("button", { name: "Delete arithmetic1" })).toBeVisible();
    await expect(notShown).toHaveText("The settings of this entity are not shown here. They stay in the source as they are.");
    await expect(inspector(page).locator(".form-section")).toHaveCount(0);
    await expect(inspector(page).getByRole("group", { name: "Arithmetic" })).toHaveCount(0);
    await expect(inspector(page).locator("[data-prototype]")).toHaveCount(0);
    await expect(inspector(page).locator(".muted-note.prototype-note")).toHaveCount(0);
    await page.screenshot({ path: resolve(SHOTS, "modded-kinds-inspector.png") });

    // The four combinators of the game keep their forms beside the mod's, which have none.
    await setSource(page, COMBINATORS_SOURCE);
    await page.getByRole("button", { name: "Fit circuit" }).click();
    for (const name of ["c", "a", "d", "s"]) {
      await selectEntity(page, name);
      await expect(inspector(page).locator(".form-section").first(), name).toBeVisible();
      await expect(notShown, name).toHaveCount(0);
    }
    for (const [name, title] of [["tiny", "Tiny arithmetic combinator"], ["wide", "Wide decider combinator"]] as const) {
      await selectEntity(page, name);
      await expect(inspector(page).locator("h2")).toHaveText(title);
      await expect(notShown, name).toHaveCount(1);
      await expect(inspector(page).locator(".form-section"), name).toHaveCount(0);
    }
    // What the inspector does show is edited as ever, and the settings stay in the source as they are.
    await inspector(page).getByLabel("Description", { exact: true }).fill("gate");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect.poll(() => sourceText(page)).toContain('        description = "gate"\n');
    for (const kept of ["        when virtual:signal-A > 5\n", "        output virtual:signal-A = 1\n", "        virtual:signal-A = virtual:signal-A * 2\n"]) expect(await sourceText(page)).toContain(kept);

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

/** A game with many mods: twelve that add a crate each, two that add nothing, and one that adds only a hidden entity with its hidden item. */
const CRATES = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
/** A title as a mod may write it: it is shown as the text it is. */
const BOLD_TITLE = "<b>Bold</b> crates 03";
/** A title too long for one line of a row, which by title comes before the mods that by name come before it. */
const LONG_TITLE = "A Dozen Crates - Logistic Crate Network, Extended Edition";
const crateTitle = (number: string): string => (number === "03" ? BOLD_TITLE : number === "12" ? LONG_TITLE : `Crates ${number}`);
const MANY_MODS: readonly FakeMod[] = [
  // crates-02 needs crates-01, and crates-05 needs crates-04 through a mod that adds nothing.
  ...CRATES.map((number) => ({ name: `crates-${number}`, version: "1.0.0", title: crateTitle(number), dependencies: ["base >= 2.1", ...(number === "02" ? ["crates-01"] : number === "05" ? ["glue-lib >= 0.1"] : [])] })),
  { name: "glue-lib", version: "0.1.0", title: "Glue", dependencies: ["base", "crates-04"] },
  { name: "zz-lib", version: "0.1.0", title: "A library", dependencies: ["base"] },
  { name: "quiet-lib", version: "0.2.0", title: "Quiet Library", dependencies: ["base"] },
];
const MANY_CRATES: CannedDump = {
  entities: [
    ...CRATES.map((number): WiredEntity => ({ name: `crate-${number}`, type: "container", label: `Crate ${number}`, size: [1, 1], module: `crates-${number}` })),
    { name: "quiet-helper", type: "container", label: "Quiet helper", size: [1, 1], module: "quiet-lib", hidden: true },
  ],
};
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
    await readGame(app, page, /^Read from your game on .+: 2\.1\.25 with 16 mods$/);
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);
    expect(await enabledModules(page)).toEqual(["base"]);

    // The list: the game's module first, then the mods that add something to choose; the two that add nothing and the one
    // that adds only what is hidden are counted.
    await page.locator("[data-settings-toggle]").click();
    const projectSettings = projectSettingsOf(page);
    const rows = projectSettings.locator(".module-list li[data-module]");
    // The game's module, then the mods by title: the one whose title begins with a tag comes before the letters, "A Dozen" before "Crates".
    const listed = ["base", "crates-03", "crates-12", ...CRATES.filter((number) => number !== "03" && number !== "12").map((number) => `crates-${number}`), "some-mod"];
    expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-module")))).toEqual(listed);
    await expect(moduleRow(page, "crates-01").locator(".module-title")).toHaveAttribute("title", "Crates 01 (crates-01)");
    await expect(moduleRow(page, "quiet-lib")).toHaveCount(0);
    await expect(projectSettings.locator('[data-note="other-mods"]')).toHaveText("3 other mods of your game add nothing that can be chosen here.");
    await expect(projectSettings.locator('[data-note="mods-hint"]')).toHaveCount(0);
    await expect(moduleRow(page, "crates-01").locator(".module-count")).toHaveText("1 signal, 1 entity");
    // A title is text, whatever a mod writes into it.
    await expect(moduleRow(page, "crates-03").locator(".module-title")).toHaveText(BOLD_TITLE);
    await expect(moduleRow(page, "crates-03").locator("b")).toHaveCount(0);
    // Fourteen rows have their own scrolling area, and it is the only one: the panel is as high as its content, so the
    // filter above the list and the line below it stay in view whatever the list is scrolled to.
    const list = projectSettings.locator(".module-list");
    const overflow = (locator: Locator): Promise<number> => locator.evaluate((element) => element.scrollHeight - element.clientHeight);
    const bottom = (locator: Locator): Promise<number> => locator.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(await list.evaluate((element) => [getComputedStyle(element).overflowY, element.scrollHeight > element.clientHeight])).toEqual(["auto", true]);
    expect(await overflow(projectSettings)).toBe(0);
    expect(await bottom(projectSettings.locator('[data-note="other-mods"]'))).toBeLessThanOrEqual(await bottom(projectSettings));
    // The list has the room the panel does not need for anything else: more than the six rows of a list of a fixed height.
    expect(await list.evaluate((element) => [...element.children].filter((row) => row.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom).length)).toBeGreaterThan(6);
    // A title has the width of the row and a second line where it needs one: it is not cut on the first. What the mod adds is below it.
    const longTitle = moduleRow(page, "crates-12").locator(".module-title");
    await expect(longTitle).toHaveText(LONG_TITLE);
    await expect(longTitle).toHaveAttribute("title", `${LONG_TITLE} (crates-12)`);
    const shape = await longTitle.evaluate((element) => ({ lines: Math.round(element.clientHeight / parseFloat(getComputedStyle(element).lineHeight)), cut: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight + 1 }));
    expect(shape).toEqual({ lines: 2, cut: false });
    expect(await moduleRow(page, "crates-12").locator(".module-count").evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(await bottom(longTitle));
    await expect(moduleRow(page, "crates-12").locator(".module-count")).toHaveText("1 signal, 1 entity");
    await page.screenshot({ path: resolve(SHOTS, "project-settings-many-mods.png") });

    // The filter finds a mod by its title or its name; Escape empties it and leaves the panel open. While it narrows the
    // list, the panel keeps the height it had: the list keeps its room, empty below the rows that are left.
    const filter = projectSettings.getByLabel("Filter signal groups");
    const heights = (): Promise<number[]> => projectSettings.evaluate((panel) => [panel.getBoundingClientRect().height, panel.querySelector(".module-list")!.getBoundingClientRect().height, panel.scrollHeight - panel.clientHeight]);
    const full = await heights();
    const expectSameShape = async (): Promise<void> => {
      const now = await heights();
      expect(Math.abs(now[0]! - full[0]!), "height of the panel").toBeLessThan(0.5);
      expect(Math.abs(now[1]! - full[1]!), "height of the list").toBeLessThan(0.5);
      expect(now[2], "the panel does not scroll").toBe(0);
    };
    await filter.fill("bold");
    expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-module")))).toEqual(["crates-03"]);
    await expectSameShape();
    await filter.fill("CRATES-1");
    expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-module")))).toEqual(["crates-12", "crates-10", "crates-11"]);
    await expectSameShape();
    await filter.fill("no such mod");
    await expect(rows).toHaveCount(0);
    // That nothing matches is said where the rows were.
    await expect(list.locator('li[data-note="no-match"]')).toHaveText("No signal group matches the filter.");
    await expectSameShape();
    await page.screenshot({ path: resolve(SHOTS, "project-settings-filter.png") });
    await filter.press("Escape");
    await expect(filter).toHaveValue("");
    await expect(rows).toHaveCount(listed.length);
    await expect(projectSettings).toBeVisible();
    await expectSameShape();

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
    // The notice takes its room from the list, not from the panel: still one scrolling area, and the line below the list in view.
    expect(await overflow(projectSettings)).toBe(0);
    expect(await overflow(list)).toBeGreaterThan(0);
    expect(await bottom(projectSettings.locator('[data-note="other-mods"]'))).toBeLessThanOrEqual(await bottom(projectSettings));
    await page.screenshot({ path: resolve(SHOTS, "project-settings-mods-in-use.png") });
    await unused.getByRole("button", { name: "Switch them on" }).click();
    await expect(unused).toHaveCount(0);
    expect(await enabledModules(page)).toEqual(["base", "crates-07", "crates-08"]);
    expect(await problems(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(projectSettings).toHaveCount(0);
    await expect(paletteEntry(page, "crate-07")).toHaveCount(1);

    // A mod that adds only hidden things has no row, since nothing of it can be chosen, until the project uses something of
    // it: then the row and the notice are where it is switched on.
    const quiet = moduleRow(page, "quiet-lib");
    const otherMods = projectSettings.locator('[data-note="other-mods"]');
    await setSource(page, USES_CRATES.replace("item:crate-08 = 1\n", "item:crate-08 = 1\n        item:quiet-helper = 2\n"));
    expect(await problems(page)).toEqual(["warning disabled-signal: The signal 'item:quiet-helper' is of Quiet Library, which is switched off in the project settings"]);
    await page.locator("[data-settings-toggle]").click();
    await expect(quiet.locator(".module-title")).toHaveText("Quiet Library");
    await expect(quiet.locator(".module-count")).toHaveText("Only hidden signals or entities");
    await expect(quiet.locator("input")).not.toBeChecked();
    await expect(otherMods).toHaveText("2 other mods of your game add nothing that can be chosen here.");
    await expect(unused.locator("p")).toHaveText("This project uses signals or entities of Quiet Library, which is switched off. They are marked with a warning and are not offered.");
    await unused.getByRole("button", { name: "Switch it on" }).click();
    await expect(unused).toHaveCount(0);
    await expect(quiet.locator("input")).toBeChecked();
    expect(await enabledModules(page)).toEqual(["base", "crates-07", "crates-08", "quiet-lib"]);
    expect(await problems(page)).toEqual([]);
    // Switched on it keeps its row, where it is switched off again. Off and still in use it keeps the row too; once the source
    // uses nothing of it, the row is gone and the mod is counted with the others.
    await quiet.locator("input").uncheck();
    await expect(quiet.locator("input")).not.toBeChecked();
    await expect(unused).toHaveCount(1);
    await setSource(page, USES_CRATES);
    await expect(quiet).toHaveCount(0);
    await expect(unused).toHaveCount(0);
    await expect(otherMods).toHaveText("3 other mods of your game add nothing that can be chosen here.");
    // The row went away under the focus: Escape closes the panel all the same.
    await page.keyboard.press("Escape");
    await expect(projectSettings).toHaveCount(0);

    // A blueprint with a crate of one mod and a signal of another opens as a project that has those mods on, with what they
    // require, and the report names them in the order of the rows of the project settings. The mods of the project before play no part.
    const blueprint = encodeBlueprintString({
      blueprint: {
        item: "blueprint",
        label: "Two crates",
        version: 562954249109504,
        entities: [
          { entity_number: 1, name: "crate-05", position: { x: 0.5, y: 0.5 } },
          { entity_number: 2, name: "constant-combinator", position: { x: 2.5, y: 0.5 }, control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, name: "crate-12", count: 1 }] }] } } },
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
      `Switched on: ${LONG_TITLE}, Crates 04, Crates 05. The blueprint has their signals or entities; a new project has only the modules of the game itself on.`,
    ]);
    await page.screenshot({ path: resolve(SHOTS, "import-report-mods.png") });
    await report.getByRole("button", { name: "OK" }).click();
    await expect(report).toHaveCount(0);
    expect(await enabledModules(page)).toEqual(["base", "crates-04", "crates-05", "crates-12"]);
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
    await expect(log).toContainText("Factorio 2.1.25 (build 88022");
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
    expect(await dataInUse(page)).toMatchObject({ source: { kind: "built-in", version: "2.1.25" }, catalog: null, entities: null });

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
  expect(stored.version).toBe(4);
  await writeFile(file, JSON.stringify({ ...stored, version: 1 }));

  const { app, page } = await launchWithGame({ userData: first.userData, program: first.program, folder: resolve(first.dataDirectory, process.platform === "darwin" ? "../.." : "..") });
  try {
    const outdated = "The data read from your game was stored by an earlier version of this app and cannot be used by this one. Read the game again to work with your game's data. The built-in data is in use.";
    const hint = page.locator(".data-hint");
    await expect(hint).toContainText(outdated);
    expect(await page.evaluate(() => window.faceSession!.getState().project.gameData)).toBe(false);
    await expect(paletteEntry(page, MOD_ENTITY)).toHaveCount(0);
    expect(await dataInUse(page)).toMatchObject({ source: { kind: "built-in", version: "2.1.25" }, catalog: null, entities: null });

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
    expect((JSON.parse(await readFile(file, "utf8")) as { version: number }).version).toBe(4);
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
    await expect(message(page, "pending")).toHaveText("Not in use yet: Built in, Factorio 2.1.25. It is used once the window has been loaded again.");
    expect((await messageBoxes(app)).unsaved).toBe(1);
    await expect(source(page)).toHaveText(READ_SOURCE);
    expect(await entityNames(page)).toEqual(["keep"]);
    expect(await status(page)).toMatchObject({ inUse: { kind: "game" }, pending: { kind: "built-in", version: "2.1.25" }, discardable: false });
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
