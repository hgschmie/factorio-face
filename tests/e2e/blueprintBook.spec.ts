// The blueprint book of a project: an import keeps the book, a blueprint of it becomes the circuit, a book is attached from a
// pasted string or a file, the circuit is written into it, the book goes out as a string and as a file, it is saved with the
// project, and it is removed. Native dialogs are stubbed; the clipboard is the real one. The book of the game is fixture F-30:
// the blueprints "first" and "third", the book "inner" with the blueprint "inside", and two planners.
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeBlueprintString, encodeBlueprintString } from "../../packages/blueprints/src/string.ts";
import { clickMenu, closeApp, dialogCalls, entityNames, EXAMPLE_NAME, expect, launchApp, newProjectPath, openProject, PROJECTS_DIR, readProjectEntries, ROOT, showDisplay, stubDialogs, test, writeProjectEntries } from "./app.ts";
import { placeAll } from "./board.ts";

const FIXTURE = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/game/F-30-blueprint-book.json"), "utf8")) as {
  readonly book: { readonly string: string };
  readonly native: { readonly emptyLabelled: { readonly exported: object } };
};
/** The book as the game exported it. */
const GAME_BOOK = FIXTURE.book.string;
const GAME_ROWS = [
  "first1 entity, 1 known to the editor",
  "third1 entity, 1 known to the editor",
  "innerBlueprint book",
  "inside1 entity, 1 known to the editor",
  "beltsUpgrade planner, cannot be imported",
  "combinatorsDeconstruction planner, cannot be imported",
];

const VERSION = 562954249109504;
const position = (x: number, y: number) => ({ x, y });
const lamp = (number: number, x: number) => ({ entity_number: number, name: "small-lamp", position: position(x + 0.5, 0.5) });
const rail = (number: number, x: number) => ({ entity_number: number, name: "straight-rail", position: position(x + 0.5, 2.5) });
const TWO_LAMPS = { blueprint: { item: "blueprint", label: "Two lamps", entities: [lamp(1, 0), lamp(2, 1)], wires: [[1, 1, 2, 1]], version: VERSION } };
/**
 * A book with blueprints that differ: one of rails only, which the editor imports nothing of, two lamps, and in a book inside
 * it three lamps with a gate on two tiles of landfill, which an export over it destroys.
 */
const CIRCUITS = {
  blueprint_book: {
    item: "blueprint-book",
    label: "Circuits",
    active_index: 0,
    blueprints: [
      { index: 0, blueprint: { item: "blueprint", label: "Rails only", entities: [rail(1, 0)], version: VERSION } },
      { index: 1, ...TWO_LAMPS },
      { index: 2, deconstruction_planner: { item: "deconstruction-planner", label: "Trees", version: VERSION } },
      {
        index: 3,
        blueprint_book: {
          item: "blueprint-book",
          label: "Inner",
          blueprints: [
            {
              index: 0,
              blueprint: {
                item: "blueprint",
                label: "Three lamps",
                entities: [lamp(1, 0), lamp(2, 1), lamp(3, 2), { entity_number: 4, name: "gate", position: position(0.5, 2.5) }],
                tiles: [{ name: "landfill", position: position(0, 0) }, { name: "landfill", position: position(1, 0) }],
                version: VERSION,
              },
            },
          ],
        },
      },
    ],
    version: VERSION,
  },
};
const CIRCUITS_BOOK = encodeBlueprintString(CIRCUITS);
const CIRCUITS_ROWS = ["Rails only1 entity, none known to the editor", "Two lamps2 entities, 2 known to the editor", "TreesDeconstruction planner, cannot be imported", "InnerBlueprint book", "Three lamps4 entities, 3 known to the editor"];
/** A book the editor can import nothing of: rails and a planner. */
const TRACKS_BOOK = encodeBlueprintString({
  blueprint_book: {
    item: "blueprint-book",
    label: "Tracks",
    active_index: 0,
    blueprints: [
      { index: 0, blueprint: { item: "blueprint", label: "Rails only", entities: [rail(1, 0)], version: VERSION } },
      { index: 1, upgrade_planner: { item: "upgrade-planner", label: "Faster", version: VERSION } },
    ],
    version: VERSION,
  },
});

const DISCARD = 1;
const NO_BOOK = "The project holds no blueprint book.";

const dialog = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });
const toast = (page: Page) => page.locator(".toast");
/** The line about the book in the status line: a button with the label of the book and the blueprint the circuit came from. */
const bookLine = (page: Page) => page.locator(".statusbar .status-book");
/** The radio button of the row of an item, by its path in the book ("" is the book itself). */
const rowRadio = (within: Locator, path: string) => within.locator(`li[data-path="${path}"] input[type="radio"]`);
const button = (within: Locator, name: string) => within.getByRole("button", { name, exact: true });

function readClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

function writeClipboard(app: ElectronApplication, text: string): Promise<void> {
  return app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
}

/** The window's own paste, as Cmd+V does it. */
function pasteClipboard(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.paste());
}

/** What the session says of the book of the project; null without one. */
function bookState(page: Page) {
  return page.evaluate(() => {
    const { book } = window.faceSession!.getState();
    return book && { label: book.label, origin: book.origin, originLabel: book.originLabel, problem: book.problem };
  });
}

/** The blueprint string of the book of the project; undefined without a book that can be read. */
function bookString(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const exported = window.faceSession!.commands.exportBook();
    return exported.ok ? exported.string : undefined;
  });
}

function projectState(page: Page) {
  return page.evaluate(() => {
    const { project, displayMode, canUndo } = window.faceSession!.getState();
    return { name: project.name, path: project.path, dirty: project.dirty, displayMode, canUndo };
  });
}

/** Gives the open project a book the way Paste Book does it, without the dialog: the setup of the tests that are about something else. */
async function attach(page: Page, text: string): Promise<void> {
  expect(await page.evaluate((value) => window.faceSession!.commands.attachBook(value), text)).toEqual({ ok: true });
  await expect(bookLine(page)).toBeVisible();
}

/** Opens the paste dialog of an import, pastes `text` into its box and returns the dialog. */
async function pasteImport(app: ElectronApplication, page: Page, text: string): Promise<Locator> {
  await writeClipboard(app, text);
  await clickMenu(app, "File", "Import Blueprint", "Paste Blueprint...");
  const paste = dialog(page, "Paste blueprint string");
  await expect(paste.getByRole("textbox", { name: "Blueprint string" })).toBeFocused();
  await pasteClipboard(app);
  return paste;
}

/** Imports the blueprint at `path` of a pasted book as a new project and closes the report of the import when `reported` says there is one. */
async function importFromBook(app: ElectronApplication, page: Page, text: string, path: string, reported: boolean): Promise<void> {
  const paste = await pasteImport(app, page, text);
  await rowRadio(paste, path).check();
  await button(paste, "Import").click();
  if (reported) await button(dialog(page, "Blueprint imported"), "OK").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** Gives every entity of the example its tile, so that the circuit can become a blueprint. */
async function placeExample(page: Page): Promise<void> {
  await showDisplay(page, "blueprint");
  await placeAll(page).click();
  await expect(placeAll(page)).toHaveCount(0);
}

let directories = 0;

/** A path in a new, empty directory under .runtime/e2e-projects; the file itself does not exist yet. */
async function bookPath(name: string): Promise<string> {
  const directory = resolve(PROJECTS_DIR, `books-${process.pid}-${++directories}`);
  await mkdir(directory, { recursive: true });
  return resolve(directory, name);
}

/** The labels of the items of the book at `path` of a book string, in their order. */
function labelsAt(string: string, path: readonly number[]): (string | undefined)[] {
  const decoded = decodeBlueprintString(string);
  if (!decoded.ok) throw new Error(decoded.message);
  type Item = Record<string, { readonly label?: string; readonly blueprints?: readonly Item[] } | undefined>;
  let book = (decoded.data as Item).blueprint_book;
  for (const step of path) book = book?.blueprints?.[step]?.blueprint_book;
  return (book?.blueprints ?? []).map((item) => (item.blueprint ?? item.blueprint_book ?? item.deconstruction_planner ?? item.upgrade_planner)?.label);
}

test("an import of a blueprint of a book keeps the book, and the status line names it", async ({ app, page }) => {
  // The example has no book: the line takes no room.
  await expect(bookLine(page)).toHaveCount(0);
  expect(await bookState(page)).toBeNull();

  const paste = await pasteImport(app, page, GAME_BOOK);
  await expect(paste.locator('[data-message="book"]')).toHaveText("This is a blueprint book 'Probe' with 3 blueprints; choose one of them.");
  const list = paste.getByRole("radiogroup", { name: "Blueprints of the book" });
  await expect(list.getByRole("listitem")).toHaveText(GAME_ROWS);
  await expect(rowRadio(paste, "0")).toBeChecked();
  // Nothing of the book is the circuit of a project yet.
  await expect(list.locator('[data-mark="origin"]')).toHaveCount(0);
  await expect(paste.locator('[data-message="note"]')).toContainText("The project keeps the book: File > Blueprint Book has its other blueprints and exports it again.");

  await rowRadio(paste, "1").check();
  await button(paste, "Import").click();
  // The description of this blueprint is not kept, which the report says.
  const report = dialog(page, "Blueprint imported");
  await expect(report.locator('[data-message="summary"]')).toHaveText('"third": Imported 1 entity and 0 wires.');
  await button(report, "OK").click();

  expect(await projectState(page)).toEqual({ name: "third", path: null, dirty: true, displayMode: "blueprint", canUndo: false });
  expect(await entityNames(page)).toEqual(["constant1"]);
  expect(await bookState(page)).toEqual({ label: "Probe", origin: [1], originLabel: "third", problem: null });
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Probe", "Blueprint: third"]);
  await expect(bookLine(page)).toHaveAttribute("title", 'The project holds the blueprint book "Probe". The circuit came from its blueprint "third", or was last exported to it. Press to choose a blueprint of the book.');
  // The book is the string that was pasted, character for character.
  expect(await bookString(page)).toBe(GAME_BOOK);
});

test("a book the editor can import nothing of, and an empty one, open as a project with the book and no circuit", async ({ app, page }) => {
  let paste = await pasteImport(app, page, TRACKS_BOOK);
  await expect(paste.getByRole("radiogroup", { name: "Blueprints of the book" }).getByRole("listitem")).toHaveText(["Rails only1 entity, none known to the editor", "FasterUpgrade planner, cannot be imported"]);
  await expect(paste.getByRole("radio")).toBeDisabled();
  await expect(paste.locator('[data-message="error"]')).toHaveCount(0);
  await expect(paste.locator('[data-message="book-only"]')).toHaveText(
    "No blueprint of this book has an entity the editor knows, so there is no circuit to import. The book can be opened as a project without a circuit: the project keeps the book, and File > Export Blueprint > To Blueprint Book writes a circuit into it.",
  );
  await expect(paste.locator('[data-message="note"]')).toHaveText("The book opens as a new project that holds it and has no circuit.");
  await expect(button(paste, "Import")).toHaveCount(0);
  await button(paste, "Open Book").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await projectState(page)).toEqual({ name: "Tracks", path: null, dirty: true, displayMode: "blueprint", canUndo: false });
  expect(await entityNames(page)).toEqual([]);
  expect(await bookState(page)).toEqual({ label: "Tracks", origin: null, originLabel: null, problem: null });
  // No blueprint the circuit came from: the line names the book only.
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Tracks"]);
  expect(await bookString(page)).toBe(TRACKS_BOOK);

  // A book without items, as the game exports one. The project that is open has unsaved changes, so the app asks first.
  const empty = encodeBlueprintString(FIXTURE.native.emptyLabelled.exported);
  await stubDialogs(app, { unsavedChoice: DISCARD });
  paste = await pasteImport(app, page, empty);
  await expect(paste.locator('[data-message="book"]')).toHaveText("The blueprint book 'Empty' has no blueprints.");
  await expect(paste.getByRole("radiogroup")).toHaveCount(0);
  await expect(paste.locator('[data-message="book-only"]')).toHaveText(
    "The book can be opened as a project without a circuit: the project keeps the book, and File > Export Blueprint > To Blueprint Book writes a circuit into it.",
  );
  await button(paste, "Open Book").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await dialogCalls(app)).message).toBe(1);
  expect(await bookState(page)).toEqual({ label: "Empty", origin: null, originLabel: null, problem: null });
  expect(await bookString(page)).toBe(empty);
});

test("chooses another blueprint of the book as the circuit, and Undo brings the circuit back", async ({ app, page }) => {
  await importFromBook(app, page, CIRCUITS_BOOK, "1", false);
  expect(await entityNames(page)).toEqual(["lamp1", "lamp2"]);
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Circuits", "Blueprint: Two lamps"]);

  // From the line in the window.
  await bookLine(page).click();
  const choose = dialog(page, "Choose blueprint");
  await expect(choose.locator('[data-message="book"]')).toHaveText('Blueprint book "Circuits": choose the blueprint to work on.');
  const list = choose.getByRole("radiogroup", { name: "Blueprints of the book" });
  // The blueprint the circuit came from is marked, and it is the one chosen at the start.
  await expect(list.getByRole("listitem")).toHaveText([CIRCUITS_ROWS[0]!, "Two lampsCircuit came from here2 entities, 2 known to the editor", ...CIRCUITS_ROWS.slice(2)]);
  await expect(list.locator('li[data-path="1"] [data-mark="origin"]')).toHaveText("Circuit came from here");
  await expect(rowRadio(choose, "1")).toBeChecked();
  await expect(rowRadio(choose, "0")).toBeDisabled();
  await expect(choose.getByRole("radio")).toHaveCount(3);
  await expect(choose.locator('[data-message="note"]')).toContainText("The chosen blueprint replaces the circuit of the project; Undo brings the circuit back.");
  await expect(button(choose, "Replace Circuit")).toBeFocused();

  await rowRadio(choose, "3.0").check();
  await button(choose, "Replace Circuit").click();
  // What the import of that blueprint left out is reported as after an import.
  const report = dialog(page, "Blueprint imported");
  await expect(report.locator('[data-message="summary"]')).toHaveText('"Three lamps": Imported 3 of 4 entities and 0 wires.');
  await expect(report.getByRole("region", { name: "Dropped entities" }).getByRole("listitem")).toHaveText(["1 x gate"]);
  await button(report, "OK").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The circuit is replaced; the project, its name and the book stay.
  expect(await entityNames(page)).toEqual(["lamp1", "lamp2", "lamp3"]);
  expect(await projectState(page)).toEqual({ name: "Two lamps", path: null, dirty: true, displayMode: "blueprint", canUndo: true });
  expect(await bookState(page)).toEqual({ label: "Circuits", origin: [3, 0], originLabel: "Three lamps", problem: null });
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Circuits", "Blueprint: Three lamps"]);
  expect(await bookString(page)).toBe(CIRCUITS_BOOK);

  // One step back: the circuit and the blueprint it came from. And forward again.
  await clickMenu(app, "Edit", "Undo");
  await expect.poll(() => entityNames(page)).toEqual(["lamp1", "lamp2"]);
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Circuits", "Blueprint: Two lamps"]);
  await clickMenu(app, "Edit", "Redo");
  await expect.poll(() => entityNames(page)).toEqual(["lamp1", "lamp2", "lamp3"]);
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Circuits", "Blueprint: Three lamps"]);

  // The same dialog from the menu, now with the other blueprint marked. Escape closes it and changes nothing.
  await clickMenu(app, "File", "Blueprint Book", "Choose Blueprint...");
  await expect(rowRadio(choose, "3.0")).toBeChecked();
  await expect(choose.locator("[data-mark]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await entityNames(page)).toEqual(["lamp1", "lamp2", "lamp3"]);
});

test("attaches a book from a pasted string and from a file, and says which book it replaces", async ({ app, page }) => {
  const before = await entityNames(page);
  await writeClipboard(app, encodeBlueprintString(TWO_LAMPS));
  await clickMenu(app, "File", "Blueprint Book", "Paste Book...");
  const paste = dialog(page, "Paste blueprint book string");
  const box = paste.getByRole("textbox", { name: "Blueprint book string" });
  await expect(box).toBeFocused();
  await expect(button(paste, "Attach Book")).toBeDisabled();
  await expect(paste.locator('[data-message="error"]')).toHaveCount(0);

  // A single blueprint is no book: the refusal is in the dialog and nothing is attached.
  await pasteClipboard(app);
  await expect(paste.locator('[data-message="error"]')).toHaveText("This is a blueprint, not a blueprint book. File > Import Blueprint opens a blueprint as a project.");
  await expect(box).toHaveAttribute("aria-invalid", "true");
  await expect(button(paste, "Attach Book")).toBeDisabled();
  await box.fill("not a blueprint");
  await expect(paste.locator('[data-message="error"]')).toHaveText("This is not a blueprint string: it starts with 'n', a blueprint string starts with '0'.");

  // The book of the game: listed as it is, and attached. The project had none, so nothing is replaced.
  await box.fill("");
  await writeClipboard(app, GAME_BOOK);
  await pasteClipboard(app);
  await expect(paste.locator('[data-message="error"]')).toHaveCount(0);
  await expect(paste.locator('[data-message="book"]')).toHaveText('This is the blueprint book "Probe".');
  await expect(paste.getByRole("group", { name: "Items of the book" }).getByRole("listitem")).toHaveText(GAME_ROWS);
  await expect(paste.getByRole("radio")).toHaveCount(0);
  await expect(paste.locator('[data-message="replaces"]')).toHaveCount(0);
  await button(paste, "Attach Book").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The circuit is left alone and comes from no blueprint of the book; the project has a change to save.
  expect(await entityNames(page)).toEqual(before);
  expect(await projectState(page)).toMatchObject({ name: EXAMPLE_NAME, dirty: true, displayMode: "edit", canUndo: false });
  expect(await bookState(page)).toEqual({ label: "Probe", origin: null, originLabel: null, problem: null });
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Probe"]);
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
  expect(await bookString(page)).toBe(GAME_BOOK);

  // From a file, as plain JSON: the dialog says which book goes before it replaces it.
  const file = await bookPath("circuits.json");
  await writeFile(file, JSON.stringify(CIRCUITS, null, 2));
  await stubDialogs(app, { openPath: file });
  await clickMenu(app, "File", "Blueprint Book", "Load Book From File...");
  const load = dialog(page, "Load blueprint book");
  await expect(load.locator(".blueprint-file")).toHaveText("File circuits.json");
  await expect(load.getByRole("textbox")).toHaveCount(0);
  await expect(load.locator('[data-message="book"]')).toHaveText('This is the blueprint book "Circuits".');
  await expect(load.getByRole("group", { name: "Items of the book" }).getByRole("listitem")).toHaveText(CIRCUITS_ROWS);
  await expect(load.locator('[data-message="replaces"]')).toHaveText(
    'This replaces the blueprint book "Probe" of the project. Blueprints that were written into it and not exported are lost with it; Undo does not bring it back.',
  );
  await expect(button(load, "Replace Book")).toBeFocused();
  // Escape keeps the book the project has.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await bookState(page)).toMatchObject({ label: "Probe" });

  await clickMenu(app, "File", "Blueprint Book", "Load Book From File...");
  await button(load, "Replace Book").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await dialogCalls(app)).open).toBe(2);
  expect(await bookState(page)).toEqual({ label: "Circuits", origin: null, originLabel: null, problem: null });
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Circuits"]);
  expect(await entityNames(page)).toEqual(before);
  // Plain JSON is kept as its blueprint string.
  expect(labelsAt((await bookString(page))!, [])).toEqual(["Rails only", "Two lamps", "Trees", "Inner"]);

  // A file that holds a blueprint: refused in the dialog, and the book stays.
  const single = await bookPath("lamps.txt");
  await writeFile(single, encodeBlueprintString(TWO_LAMPS));
  await stubDialogs(app, { openPath: single });
  await clickMenu(app, "File", "Blueprint Book", "Load Book From File...");
  await expect(load.locator('[data-message="error"]')).toHaveText("This is a blueprint, not a blueprint book. File > Import Blueprint opens a blueprint as a project.");
  await expect(button(load, "Replace Book")).toBeDisabled();
  await expect(button(load, "Cancel")).toBeFocused();
  await button(load, "Cancel").click();
  expect(await bookState(page)).toMatchObject({ label: "Circuits" });
});

test("exports the circuit into the book as a new blueprint and, after a second step that says what is lost, over an existing one", async ({ app, page }) => {
  await attach(page, CIRCUITS_BOOK);

  // The entities of the example have no tile yet: what is in the way of a blueprint is said before anything is chosen.
  await clickMenu(app, "File", "Export Blueprint", "To Blueprint Book...");
  await expect(dialog(page, "No blueprint yet").locator("[data-problem]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await placeExample(page);

  // As a new blueprint: of the book itself unless the user chooses a book inside it.
  await clickMenu(app, "File", "Export Blueprint", "To Blueprint Book...");
  const target = dialog(page, "Export to blueprint book");
  const list = target.getByRole("radiogroup", { name: "Items of the book" });
  await expect(list.getByRole("listitem")).toHaveText(["CircuitsThe book itself", ...CIRCUITS_ROWS]);
  // The book itself, the book inside it and the three blueprints can be chosen; the planner is only listed.
  await expect(target.getByRole("radio")).toHaveCount(5);
  await expect(rowRadio(target, "")).toBeChecked();
  await expect(target.locator('[data-message="target"]')).toHaveText("The circuit is added as a new blueprint at the end of the book.");
  await expect(button(target, "Add to Book")).toBeFocused();
  await rowRadio(target, "3").check();
  await expect(target.locator('[data-message="target"]')).toHaveText('The circuit is added as a new blueprint at the end of "Inner", a book inside the book.');
  await button(target, "Add to Book").click();

  const exported = dialog(page, "Exported to blueprint book");
  await expect(exported.locator('[data-message="exported"]')).toHaveText(`The circuit was added to "Inner", a book inside the book "Circuits", as the blueprint "${EXAMPLE_NAME}".`);
  await expect(exported.getByRole("region", { name: "Warnings" })).toHaveCount(0);
  await expect(exported).toContainText("The book is saved with the project. It goes to the game through File > Blueprint Book: Export As File or Show Book String.");
  await expect(button(exported, "OK")).toBeFocused();
  await button(exported, "OK").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await bookState(page)).toEqual({ label: "Circuits", origin: [3, 1], originLabel: EXAMPLE_NAME, problem: null });
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Circuits", `Blueprint: ${EXAMPLE_NAME}`]);
  let string = (await bookString(page))!;
  expect(labelsAt(string, [])).toEqual(["Rails only", "Two lamps", "Trees", "Inner"]);
  expect(labelsAt(string, [3])).toEqual(["Three lamps", EXAMPLE_NAME]);

  // Over a blueprint the circuit did not come from: the dialog starts at the one it came from, and the second step counts what goes.
  await clickMenu(app, "File", "Export Blueprint", "To Blueprint Book...");
  await expect(rowRadio(target, "3.1")).toBeChecked();
  await expect(list.locator('li[data-path="3.1"] [data-mark="origin"]')).toHaveText("Circuit came from here");
  await expect(button(target, "Overwrite...")).toBeFocused();
  await rowRadio(target, "3.0").check();
  await expect(target.locator('[data-message="target"]')).toHaveText('The circuit takes the place of the blueprint "Three lamps". The next step says what is lost by that.');
  await button(target, "Overwrite...").click();

  const confirm = dialog(page, "Overwrite blueprint");
  await expect(confirm.locator('[data-message="overwrite"]')).toHaveText('Overwrite the blueprint "Three lamps" of the book "Circuits" with the circuit of the project?');
  await expect(confirm.getByRole("list", { name: "What overwriting does" }).getByRole("listitem")).toHaveText([
    "The whole blueprint is replaced by the circuit of the project: its entities, its wires and its label.",
    "1 entity and 2 tiles that the editor does not hold are gone from it.",
    "Its description, icons and snapping are not kept: the circuit did not come from this blueprint.",
    "Undo does not bring the replaced blueprint back.",
  ]);
  // The step starts on the way back, and nothing is written until Overwrite is pressed.
  await expect(button(confirm, "Back")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toHaveCount(0);
  await expect(rowRadio(target, "3.0")).toBeChecked();
  expect(await bookString(page)).toBe(string);
  await button(target, "Overwrite...").click();
  await button(confirm, "Overwrite").click();
  await expect(exported.locator('[data-message="exported"]')).toHaveText(`The circuit was written over the blueprint "Three lamps" of "Inner", a book inside the book "Circuits". It is now "${EXAMPLE_NAME}".`);
  await button(exported, "OK").click();
  expect(await bookState(page)).toEqual({ label: "Circuits", origin: [3, 0], originLabel: EXAMPLE_NAME, problem: null });
  string = (await bookString(page))!;
  // The blueprint kept its slot; the items around it are as they were.
  expect(labelsAt(string, [])).toEqual(["Rails only", "Two lamps", "Trees", "Inner"]);
  expect(labelsAt(string, [3])).toEqual([EXAMPLE_NAME, EXAMPLE_NAME]);

  // Over the blueprint the circuit came from, which is what the dialog now starts with: its description, icons and snapping stay.
  await clickMenu(app, "File", "Export Blueprint", "To Blueprint Book...");
  await expect(rowRadio(target, "3.0")).toBeChecked();
  await button(target, "Overwrite...").click();
  await expect(confirm.getByRole("list", { name: "What overwriting does" }).getByRole("listitem")).toHaveText([
    "The whole blueprint is replaced by the circuit of the project: its entities, its wires and its label.",
    "Its description, icons and snapping are kept, because the circuit came from this blueprint.",
    "Undo does not bring the replaced blueprint back.",
  ]);
  // Escape leaves the whole command.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await bookString(page)).toBe(string);

  await clickMenu(app, "File", "Export Blueprint", "To Blueprint Book...");
  await button(target, "Overwrite...").click();
  await button(confirm, "Overwrite").click();
  await expect(exported.locator('[data-message="exported"]')).toHaveText(`The circuit was written over the blueprint "${EXAMPLE_NAME}" of "Inner", a book inside the book "Circuits".`);
  await button(exported, "OK").click();
  string = (await bookString(page))!;
  expect(labelsAt(string, [3])).toEqual([EXAMPLE_NAME, EXAMPLE_NAME]);

  // The book is no part of the history of the circuit: Undo takes back the placing of the entities, and the book stays as it was written.
  await clickMenu(app, "Edit", "Undo");
  await expect(placeAll(page)).toHaveText("Place all4");
  expect(await bookString(page)).toBe(string);
  expect(await bookState(page)).toMatchObject({ origin: [3, 0], originLabel: EXAMPLE_NAME });
});

test("shows the string of an unchanged book as it came in, and writes it to a file", async ({ app, page }) => {
  await attach(page, GAME_BOOK);
  await writeClipboard(app, "");

  await clickMenu(app, "File", "Blueprint Book", "Show Book String");
  const shown = dialog(page, "Blueprint book string");
  const box = shown.getByRole("textbox", { name: "Blueprint book string" });
  // The string the game wrote, character for character; read-only, in focus and selected as a whole.
  await expect(box).toHaveValue(GAME_BOOK);
  await expect(box).toBeFocused();
  expect(await box.evaluate((area: HTMLTextAreaElement) => [area.readOnly, area.selectionStart, area.selectionEnd === area.value.length])).toEqual([true, 0, true]);
  // It is the book as it is, not an export of the editor: no version and no warnings.
  await expect(shown.locator('[data-fact="version"]')).toHaveCount(0);
  await expect(shown.getByRole("region", { name: "Warnings" })).toHaveCount(0);
  await expect(shown).toContainText("a book that nothing was written into is the string it came in as");
  await button(shown, "Copy").click();
  await expect(button(shown, "Copied")).toBeVisible();
  expect(await readClipboard(app)).toBe(GAME_BOOK);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const path = await bookPath("probe");
  await stubDialogs(app, { savePath: path });
  await clickMenu(app, "File", "Blueprint Book", "Export As File...");
  await expect(toast(page)).toHaveText(`Blueprint book exported to ${path}.txt.`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await dialogCalls(app);
  expect(calls.save).toBe(1);
  // The file is suggested under the label of the book.
  expect(calls.saveOptions!.defaultPath).toMatch(/Probe\.txt$/);
  expect(await readFile(`${path}.txt`, "utf8")).toBe(GAME_BOOK);
});

test("saves the book with the project and has it again when the project is reopened", async () => {
  const projectPath = await newProjectPath("third");
  const first = await launchApp();
  try {
    const { app, page } = first;
    await importFromBook(app, page, GAME_BOOK, "1", true);
    await stubDialogs(app, { savePath: projectPath });
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    // The book is an entry of the project file, as the game wrote it; the manifest says where the circuit came from.
    const entries = await readProjectEntries(projectPath);
    expect(Object.keys(entries).sort()).toEqual(["book.txt", "face.json", "main.face"]);
    expect(entries["book.txt"]).toBe(GAME_BOOK);
    expect(JSON.parse(entries["face.json"]!)).toMatchObject({ name: "third", book: { file: "book.txt", origin: [1] } });
  } finally {
    await closeApp(first.app);
  }

  // A new session with the same profile starts with that project, and with its book.
  const second = await launchApp({ userData: first.userData, open: "start" });
  try {
    const { app, page } = second;
    await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
    await expect(bookLine(page).locator("span")).toHaveText(["Book: Probe", "Blueprint: third"]);
    expect(await bookState(page)).toEqual({ label: "Probe", origin: [1], originLabel: "third", problem: null });
    expect(await bookString(page)).toBe(GAME_BOOK);
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    // The line and the path share the end of the status line without leaving it.
    expect(await page.evaluate(() => document.querySelector(".statusbar")!.scrollWidth - document.querySelector(".statusbar")!.clientWidth)).toBe(0);

    // Another blueprint of the book is a change of the project.
    await clickMenu(app, "File", "Blueprint Book", "Choose Blueprint...");
    const choose = dialog(page, "Choose blueprint");
    await expect(rowRadio(choose, "1")).toBeChecked();
    await rowRadio(choose, "2.0").check();
    await button(choose, "Replace Circuit").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(bookLine(page).locator("span")).toHaveText(["Book: Probe", "Blueprint: inside"]);
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    const entries = await readProjectEntries(projectPath);
    expect(entries["book.txt"]).toBe(GAME_BOOK);
    expect(JSON.parse(entries["face.json"]!)).toMatchObject({ book: { file: "book.txt", origin: [2, 0] } });
  } finally {
    await closeApp(second.app);
  }
});

test("cuts long labels of a book off in the status line and has them whole in its tooltip", async ({ page }) => {
  const long = { blueprint_book: { item: "blueprint-book", label: "Long".repeat(40), active_index: 0, blueprints: [{ index: 0, blueprint: { ...TWO_LAMPS.blueprint, label: "Plan".repeat(40) } }], version: VERSION } };
  await attach(page, encodeBlueprintString(long));
  expect(await page.evaluate(() => window.faceSession!.commands.chooseFromBook([0]).ok)).toBe(true);
  // The session bounds a label to 80 characters; the line shows what fits of that, and the tooltip has all of it.
  const [bookLabel, blueprintLabel] = [`${"Long".repeat(20)}...`, `${"Plan".repeat(20)}...`];
  await expect(bookLine(page).locator("span")).toHaveText([`Book: ${bookLabel}`, `Blueprint: ${blueprintLabel}`]);
  await expect(bookLine(page)).toHaveAttribute("title", `The project holds the blueprint book "${bookLabel}". The circuit came from its blueprint "${blueprintLabel}", or was last exported to it. Press to choose a blueprint of the book.`);
  const shown = await bookLine(page).evaluate((line) => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const [bar, meta, own] = [document.querySelector(".statusbar")!, box(".project-meta"), line.getBoundingClientRect()];
    const spans = [...line.querySelectorAll("span")];
    return {
      cut: spans.map((span) => span.scrollWidth > span.clientWidth),
      ellipsis: spans.map((span) => getComputedStyle(span).textOverflow),
      // The line keeps to its share, and nothing of the status line leaves it or runs into its neighbors.
      share: own.width <= meta.width / 2,
      inside: own.left >= meta.left && own.right <= box(".project-meta .path").left && box('[data-testid="save-state"]').right <= box(".statusbar").right,
      overflow: bar.scrollWidth - bar.clientWidth,
    };
  });
  expect(shown).toEqual({ cut: [true, true], ellipsis: ["ellipsis", "ellipsis"], share: true, inside: true, overflow: 0 });
});

test("removes the book from the project after a confirmation that names it", async ({ app, page }) => {
  const before = await entityNames(page);
  await attach(page, GAME_BOOK);

  await clickMenu(app, "File", "Blueprint Book", "Remove Book From Project");
  const remove = dialog(page, "Remove blueprint book");
  await expect(remove.locator('[data-message="remove"]')).toHaveText('Remove the blueprint book "Probe" from the project?');
  await expect(remove).toContainText("Blueprints that were written into the book and not exported are lost with it: Undo does not bring the book back.");
  // The dialog starts on the way out: Enter removes nothing.
  await expect(button(remove, "Cancel")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await bookState(page)).toMatchObject({ label: "Probe" });

  await clickMenu(app, "File", "Blueprint Book", "Remove Book From Project");
  await button(remove, "Remove Book").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await bookState(page)).toBeNull();
  await expect(bookLine(page)).toHaveCount(0);
  expect(await entityNames(page)).toEqual(before);
  // Undo does not bring it back: the book is no part of the history.
  await clickMenu(app, "Edit", "Undo");
  expect(await bookState(page)).toBeNull();
});

test("says that the project holds no blueprint book, and how to load one, for every command that needs one", async ({ app, page }) => {
  await stubDialogs(app, { savePath: await bookPath("never.txt") });
  const none = dialog(page, "No blueprint book");
  const commands: readonly (readonly string[])[] = [
    ["Blueprint Book", "Choose Blueprint..."],
    ["Blueprint Book", "Export As File..."],
    ["Blueprint Book", "Show Book String"],
    ["Blueprint Book", "Remove Book From Project"],
    ["Export Blueprint", "To Blueprint Book..."],
  ];
  for (const command of commands) {
    await clickMenu(app, "File", ...command);
    await expect(none.locator('[data-message="no-book"]'), command.join(" > ")).toHaveText(
      `${NO_BOOK} File > Blueprint Book > Load Book From File or Paste Book gives it one and leaves the circuit alone; File > Import Blueprint opens a book of the game as a new project.`,
    );
    await expect(button(none, "Close")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  // Nothing was written and nothing else was shown.
  expect((await dialogCalls(app)).save).toBe(0);
  await expect(toast(page)).toHaveCount(0);

  // The message leads on to the two ways to give the project a book.
  await clickMenu(app, "File", "Blueprint Book", "Show Book String");
  await button(none, "Paste Book...").click();
  await expect(none).toHaveCount(0);
  const paste = dialog(page, "Paste blueprint book string");
  await paste.getByRole("textbox", { name: "Blueprint book string" }).fill(GAME_BOOK);
  await button(paste, "Attach Book").click();
  await expect(bookLine(page).locator("span")).toHaveText(["Book: Probe"]);
  await clickMenu(app, "File", "Blueprint Book", "Show Book String");
  await expect(dialog(page, "Blueprint book string").getByRole("textbox")).toHaveValue(GAME_BOOK);
});

test("shows what is wrong with a book that cannot be read and offers only to remove or replace it", async ({ app, page }) => {
  // A project file whose book entry holds a single blueprint, as a damaged or a foreign file may.
  const path = await newProjectPath("Damaged");
  const manifest = { formatVersion: 2, name: "Damaged", gameVersion: "2.1.25", modules: ["base", "space-age", "quality", "recycler", "elevated-rails"], customSignalGroups: [], circuits: ["main.face"], book: { file: "book.txt" } };
  await writeProjectEntries(path, { "face.json": JSON.stringify(manifest, null, 2) + "\n", "main.face": 'circuit "Damaged" {\n}\n', "book.txt": encodeBlueprintString(TWO_LAMPS) });
  await openProject(page, path);
  const problem = "The blueprint book of this project cannot be read. This is a blueprint, not a blueprint book. It stays in the project file as it is until it is removed.";
  expect(await bookState(page)).toMatchObject({ origin: null, problem });
  await expect(bookLine(page).locator("span")).toHaveText(["Book cannot be read"]);
  await expect(bookLine(page)).toHaveAttribute("title", problem);
  if (await toast(page).count()) await toast(page).getByRole("button", { name: "Dismiss message" }).click();

  const unreadable = dialog(page, "Blueprint book cannot be read");
  await bookLine(page).click();
  await expect(unreadable.locator('[data-message="error"]')).toHaveText(problem);
  await expect(unreadable.locator(".dialog-actions").getByRole("button")).toHaveText(["Remove Book...", "Load Book From File...", "Paste Book...", "Close"]);
  await expect(button(unreadable, "Close")).toBeFocused();
  await page.keyboard.press("Escape");
  for (const command of [["Blueprint Book", "Choose Blueprint..."], ["Blueprint Book", "Export As File..."], ["Blueprint Book", "Show Book String"], ["Export Blueprint", "To Blueprint Book..."]]) {
    await clickMenu(app, "File", ...command);
    await expect(unreadable.locator('[data-message="error"]'), command.join(" > ")).toHaveText(problem);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // Replacing it says what goes.
  await clickMenu(app, "File", "Blueprint Book", "Paste Book...");
  const paste = dialog(page, "Paste blueprint book string");
  await expect(paste.locator('[data-message="replaces"]')).toHaveText("This replaces the blueprint book of the project, which cannot be read.");
  await expect(button(paste, "Replace Book")).toBeDisabled();
  await page.keyboard.press("Escape");

  // Removing it, from the message.
  await bookLine(page).click();
  await button(unreadable, "Remove Book...").click();
  const remove = dialog(page, "Remove blueprint book");
  await expect(remove.locator('[data-message="remove"]')).toHaveText("Remove the blueprint book that cannot be read from the project?");
  await expect(remove.locator('[data-message="error"]')).toHaveText(problem);
  await button(remove, "Remove Book").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await bookState(page)).toBeNull();
  await expect(bookLine(page)).toHaveCount(0);
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
});
