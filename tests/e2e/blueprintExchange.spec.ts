// Blueprints of the game in and out of the app: the string in a dialog and in a file, a pasted string, a blueprint book, the report
// on what an import dropped, and what is in the way of an export. Native dialogs are stubbed; the clipboard is the real one.
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { encodeBlueprintString } from "../../packages/blueprints/src/string.ts";
import { clickMenu, dialogCalls, entityNames, EXAMPLE_NAME, expect, isDocumentEdited, menuLabels, PROJECTS_DIR, SCREENSHOT_DIR, showDisplay, sourceText, stubDialogs, test } from "./app.ts";
import { placeAll } from "./board.ts";

const SHOTS = resolve(SCREENSHOT_DIR, "blueprint-ui");
const DISCARD = 1;

const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const pasteDialog = (page: Page) => dialog(page, "Paste blueprint string");
const toast = (page: Page) => page.locator(".toast");

function readClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

function writeClipboard(app: ElectronApplication, text: string): Promise<void> {
  return app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
}

/** The state of the session that the tests of an import look at. */
function projectState(page: Page) {
  return page.evaluate(() => {
    const { project, displayMode, circuit } = window.faceSession!.getState();
    return { name: project.name, path: project.path, dirty: project.dirty, displayMode, entities: circuit.entities.map((entity) => `${entity.kind} ${entity.name}`), wires: circuit.wires.length };
  });
}

/** The blueprint string of the circuit on show; undefined while something is in the way of one. */
function exportedString(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const exported = window.faceSession!.commands.exportBlueprint();
    return exported.ok ? exported.string : undefined;
  });
}

/** Gives every entity of the example its tile: the board with "Place all", as a user does it. */
async function placeExample(page: Page): Promise<string> {
  await showDisplay(page, "blueprint");
  await placeAll(page).click();
  await expect(placeAll(page)).toHaveCount(0);
  const string = await exportedString(page);
  expect(string).toMatch(/^0[A-Za-z0-9+/]+=*$/);
  return string!;
}

/** Opens the paste dialog from the Edit menu and pastes `text` into its box with the window's own paste, as Cmd+V does. */
async function pasteBlueprint(app: ElectronApplication, page: Page, text: string): Promise<void> {
  await writeClipboard(app, text);
  await clickMenu(app, "Edit", "Paste Blueprint String...");
  await expect(pasteDialog(page).getByRole("textbox", { name: "Blueprint string" })).toBeFocused();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.paste());
}

let directories = 0;

/** A path in a new, empty directory under .runtime/e2e-projects; the file itself does not exist yet. */
async function blueprintPath(name: string): Promise<string> {
  const directory = resolve(PROJECTS_DIR, `blueprints-${process.pid}-${++directories}`);
  await mkdir(directory, { recursive: true });
  return resolve(directory, name);
}

const position = (x: number, y: number) => ({ x, y });

/**
 * A blueprint as the game writes it: five entities the editor knows and four it does not (rails and a gate, which carry no
 * circuit wire; belts, inserters and chests are entities of the editor), wires between both, a copper wire.
 */
const MIXED = {
  blueprint: {
    icons: [{ signal: { name: "constant-combinator" }, index: 1 }],
    description: "A counter next to a belt.",
    entities: [
      { entity_number: 1, name: "constant-combinator", position: position(0.5, 0.5), control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, name: "iron-plate", quality: "normal", comparator: "=", count: 5 }] }] } } },
      { entity_number: 2, name: "decider-combinator", position: position(3, 0.5), direction: 4, quality: "rare" },
      { entity_number: 3, name: "small-lamp", position: position(4.5, 0.5) },
      { entity_number: 4, name: "straight-rail", position: position(0.5, 2.5) },
      { entity_number: 5, name: "straight-rail", position: position(1.5, 2.5) },
      { entity_number: 6, name: "straight-rail", position: position(2.5, 2.5) },
      { entity_number: 7, name: "gate", position: position(3.5, 2.5) },
      { entity_number: 8, name: "medium-electric-pole", position: position(6.5, 0.5) },
      { entity_number: 9, name: "medium-electric-pole", position: position(6.5, 4.5) },
    ],
    wires: [
      [1, 1, 2, 1],
      [2, 4, 3, 2],
      [3, 1, 7, 1],
      [4, 2, 7, 2],
      [8, 5, 9, 5],
    ],
    item: "blueprint",
    label: "Counter with belt",
    version: 562954249109504,
  },
};

const lamp = (number: number, x: number) => ({ entity_number: number, name: "small-lamp", position: position(x + 0.5, 0.5) });
const BOOK = {
  blueprint_book: {
    item: "blueprint-book",
    label: "Circuits",
    active_index: 0,
    blueprints: [
      { index: 0, blueprint: { item: "blueprint", label: "Belts only", entities: [{ entity_number: 1, name: "straight-rail", position: position(0.5, 0.5) }], version: 562954249109504 } },
      { index: 1, blueprint: { item: "blueprint", label: "Two lamps", entities: [lamp(1, 0), lamp(2, 1)], wires: [[1, 1, 2, 1]], version: 562954249109504 } },
      { index: 2, deconstruction_planner: { item: "deconstruction-planner", label: "Trees", version: 562954249109504 } },
      {
        index: 3,
        blueprint_book: { item: "blueprint-book", label: "Inner", blueprints: [{ index: 0, blueprint: { item: "blueprint", label: "Three lamps", entities: [lamp(1, 0), lamp(2, 1), lamp(3, 2), { entity_number: 4, name: "gate", position: position(0.5, 2.5) }], version: 562954249109504 } }] },
      },
    ],
    version: 562954249109504,
  },
};

test.beforeAll(() => mkdir(SHOTS, { recursive: true }));

test("shows the blueprint string of the example and takes it back through the paste dialog as the same circuit", async ({ app, page }) => {
  const string = await placeExample(page);
  const before = await projectState(page);
  await writeClipboard(app, "");

  await clickMenu(app, "File", "Show Blueprint String");
  const shown = dialog(page, "Blueprint string");
  const box = shown.getByRole("textbox", { name: "Blueprint string" });
  await expect(box).toHaveValue(string);
  // Read-only, in focus and selected as a whole: ready for the copy key.
  await expect(box).toBeFocused();
  expect(await box.evaluate((area: HTMLTextAreaElement) => [area.readOnly, area.selectionStart, area.selectionEnd === area.value.length])).toEqual([true, 0, true]);
  await expect(shown.locator('[data-fact="version"]')).toHaveText("Factorio 2.1.24");
  await expect(shown.getByRole("region", { name: "Warnings" })).toHaveCount(0);
  await shown.getByRole("button", { name: "Copy" }).click();
  await expect(shown.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await readClipboard(app)).toBe(string);
  await page.screenshot({ path: resolve(SHOTS, "show-string.png") });
  await page.keyboard.press("Escape");
  await expect(shown).toHaveCount(0);

  // Placing the entities changed the example, so the app asks before the blueprint replaces it.
  await stubDialogs(app, { unsavedChoice: DISCARD });
  await pasteBlueprint(app, page, string);
  await expect(pasteDialog(page).locator('[data-message="blueprint"]')).toHaveText(`"${EXAMPLE_NAME}": 4 entities.`);
  await pasteDialog(page).getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await dialogCalls(app)).message).toBe(1);

  // A new project on the blueprint board: named after the blueprint, without a file, unsaved, and not a recent project.
  await expect.poll(() => entityNames(page)).toEqual(["constant1", "decider1", "arithmetic1", "lamp1"]);
  const after = await projectState(page);
  expect(after).toEqual({ name: EXAMPLE_NAME, path: null, dirty: true, displayMode: "blueprint", entities: ["constant constant1", "decider decider1", "arithmetic arithmetic1", "lamp lamp1"], wires: before.wires });
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "blueprint");
  await expect(page.locator(".project-meta .path")).toHaveText("Not saved yet");
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
  await expect.poll(() => isDocumentEdited(app)).toBe(true);
  expect(await menuLabels(app, "File", "Open Recent")).toEqual(["No Recent Projects"]);
  // The same circuit: its blueprint is the one that was pasted, entity for entity and wire for wire.
  expect(await exportedString(page)).toBe(string);
  expect(await sourceText(page)).toContain("tile (");

  // Save asks for a location, as for every project without a file.
  await clickMenu(app, "File", "Save");
  expect((await dialogCalls(app)).save).toBe(1);
});

test("keeps the current project when the user cancels the unsaved-changes prompt of an import", async ({ app, page }) => {
  const string = await placeExample(page);
  await stubDialogs(app, {});
  await pasteBlueprint(app, page, string);
  await pasteDialog(page).getByRole("button", { name: "Import", exact: true }).click();
  await expect.poll(async () => (await dialogCalls(app)).message).toBe(1);
  // The dialog stays with its text, and nothing was replaced.
  await expect(pasteDialog(page).getByRole("button", { name: "Import", exact: true })).toBeEnabled();
  await expect(pasteDialog(page).getByRole("textbox")).toHaveValue(string);
  expect(await entityNames(page)).toEqual(["source", "gate", "twice", "light"]);
});

test("exports the blueprint to a file and imports it from that file", async ({ app, page }) => {
  const string = await placeExample(page);
  const path = await blueprintPath("feedback");
  await stubDialogs(app, { savePath: path, openPath: `${path}.txt`, unsavedChoice: DISCARD });

  await clickMenu(app, "File", "Export Blueprint...");
  // A name without an extension gets the one of blueprint files.
  await expect(toast(page)).toHaveText(`Blueprint exported to ${path}.txt.`);
  let calls = await dialogCalls(app);
  expect(calls).toMatchObject({ save: 1, saveOptions: { filters: [{ name: "Blueprint string", extensions: ["txt"] }] } });
  expect(calls.saveOptions!.defaultPath).toMatch(/Feedback example\.txt$/);
  // The file is the string and nothing else, and nothing is left next to it.
  expect(await readFile(`${path}.txt`, "utf8")).toBe(string);
  expect(await readdir(dirname(path))).toEqual([`${basename(path)}.txt`]);
  // Exporting saved nothing: the project is as unsaved as before.
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");

  await clickMenu(app, "File", "Import Blueprint...");
  await expect.poll(() => entityNames(page)).toEqual(["constant1", "decider1", "arithmetic1", "lamp1"]);
  calls = await dialogCalls(app);
  expect(calls).toMatchObject({ open: 1, openOptions: { properties: ["openFile"] } });
  expect(calls.openOptions!.filters![0]).toEqual({ name: "Blueprint string", extensions: ["txt", "json"] });
  // One blueprint with nothing dropped: no dialog at all, just the circuit.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await projectState(page)).toMatchObject({ name: EXAMPLE_NAME, path: null, dirty: true, displayMode: "blueprint" });
  expect(await exportedString(page)).toBe(string);
  expect(await menuLabels(app, "File", "Open Recent")).toEqual(["No Recent Projects"]);
});

test("says what is in the way of a blueprint and offers the board for entities without a tile", async ({ app, page }) => {
  await stubDialogs(app, { savePath: await blueprintPath("never.txt") });
  for (const item of ["Show Blueprint String", "Export Blueprint..."]) {
    await clickMenu(app, "File", item);
    const problems = dialog(page, "No blueprint yet");
    await expect(problems.locator("[data-problem]")).toHaveText(["4 entities have no place in the game (no 'tile'): 'source', 'gate', 'twice', 'light'. Place every entity on the blueprint board first."]);
    await expect(problems.getByRole("button", { name: "Show blueprint board" })).toBeFocused();
    if (item === "Show Blueprint String") {
      await page.screenshot({ path: resolve(SHOTS, "export-problems.png") });
      await page.keyboard.press("Escape");
      await expect(problems).toHaveCount(0);
    }
  }
  // Neither a string nor a file was made.
  expect((await dialogCalls(app)).save).toBe(0);
  await expect(dialog(page, "Blueprint string")).toHaveCount(0);

  await dialog(page, "No blueprint yet").getByRole("button", { name: "Show blueprint board" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "blueprint");
  await expect(placeAll(page)).toHaveText("Place all4");
  expect(await page.evaluate(() => window.faceSession!.getState().selection.length)).toBe(4);

  // A custom signal has no place in the game either; that is not for the board to solve.
  await placeAll(page).click();
  await page.evaluate(() => {
    const { source } = window.faceSession!.getState();
    window.faceSession!.commands.setSource(source.replace("virtual:signal-A = 1", "custom:my-signal = 1"));
  });
  await expect.poll(() => exportedString(page)).toBeUndefined();
  await clickMenu(app, "File", "Show Blueprint String");
  await expect(dialog(page, "No blueprint yet").locator('[data-problem="custom-signal"]')).toContainText("'source'");
  await expect(dialog(page, "No blueprint yet").getByRole("button", { name: "Show blueprint board" })).toHaveCount(0);
  await expect(dialog(page, "No blueprint yet").getByRole("button", { name: "Close" }).last()).toBeFocused();
});

test("imports the entities the editor knows from a pasted blueprint and reports what it dropped", async ({ app, page }) => {
  await pasteBlueprint(app, page, encodeBlueprintString(MIXED));
  await expect(pasteDialog(page).locator('[data-message="blueprint"]')).toHaveText('"Counter with belt": 5 of 9 entities can be imported. The rest is dropped; a report lists it after the import.');
  await pasteDialog(page).getByRole("button", { name: "Import", exact: true }).click();

  const report = dialog(page, "Blueprint imported");
  await expect(report.locator('[data-message="summary"]')).toHaveText('"Counter with belt": Imported 5 of 9 entities and 2 wires.');
  await expect(report.getByRole("region", { name: "Dropped entities" }).getByRole("listitem")).toHaveText(["3 x straight-rail", "1 x gate"]);
  await expect(report.getByRole("region", { name: "Wires" }).getByRole("listitem")).toHaveText([
    "2 circuit wires to dropped entities went with them.",
    "1 copper wire (power) was dropped: the editor has circuit wires only.",
  ]);
  await expect(report.getByRole("region", { name: "Settings" }).getByRole("listitem")).toHaveText(["Ignored decider-combinator: quality is something the editor does not have1 entity: decider1"]);
  await expect(report.getByRole("region", { name: "Blueprint" }).getByRole("listitem")).toHaveText(["Not kept from the blueprint itself: description."]);
  await expect(report.getByRole("button", { name: "OK" })).toBeFocused();
  await page.screenshot({ path: resolve(SHOTS, "import-report.png") });

  // The circuit is open behind the report: the known entities with the wires between them, on their tiles.
  expect(await projectState(page)).toEqual({
    name: "Counter with belt",
    path: null,
    dirty: true,
    displayMode: "blueprint",
    entities: ["constant constant1", "decider decider1", "lamp lamp1", "pole pole1", "pole pole2"],
    wires: 2,
  });
  await report.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".status-source")).toHaveText("No errors");
  await expect(placeAll(page)).toHaveCount(0);
  expect(await exportedString(page)).toBeDefined();
});

test("lists the blueprints of a book and imports the chosen one", async ({ app, page }) => {
  const path = await blueprintPath("book.json");
  // The plain JSON, as the game also takes it, in a file.
  await writeFile(path, JSON.stringify(BOOK, null, 2));
  await stubDialogs(app, { openPath: path });
  await clickMenu(app, "File", "Import Blueprint...");

  const book = dialog(page, "Import blueprint");
  await expect(book.locator(".blueprint-file")).toHaveText("File book.json");
  await expect(book.locator('[data-message="book"]')).toHaveText("This is a blueprint book 'Circuits' with 3 blueprints; choose one of them.");
  // Every item of the book in its order, a book inside it followed by its own items.
  await expect(book.getByRole("radiogroup", { name: "Blueprints of the book" }).getByRole("listitem")).toHaveText([
    "Belts only1 entity, none known to the editor",
    "Two lamps2 entities, 2 known to the editor",
    "TreesDeconstruction planner, cannot be imported",
    "InnerBlueprint book",
    "Three lamps4 entities, 3 known to the editor",
  ]);
  // The first blueprint with something to import is chosen; one without is not on offer.
  await expect(book.getByRole("radio", { name: /Two lamps/ })).toBeChecked();
  await expect(book.getByRole("radio", { name: /Belts only/ })).toBeDisabled();
  await page.screenshot({ path: resolve(SHOTS, "book-list.png") });

  await book.getByRole("radio", { name: /Three lamps/ }).check();
  await book.getByRole("button", { name: "Import", exact: true }).click();
  const report = dialog(page, "Blueprint imported");
  await expect(report.locator('[data-message="summary"]')).toHaveText('"Three lamps": Imported 3 of 4 entities and 0 wires.');
  await report.getByRole("button", { name: "OK" }).click();
  expect(await projectState(page)).toMatchObject({ name: "Three lamps", path: null, dirty: true, entities: ["lamp lamp1", "lamp lamp2", "lamp lamp3"] });
  expect(await menuLabels(app, "File", "Open Recent")).toEqual(["No Recent Projects"]);
});

test("shows why a text is not a blueprint and keeps the dialog open", async ({ app, page }) => {
  await clickMenu(app, "File", "Paste Blueprint String...");
  const paste = pasteDialog(page);
  const box = paste.getByRole("textbox", { name: "Blueprint string" });
  const error = paste.locator('[data-message="error"]');
  const importButton = paste.getByRole("button", { name: "Import", exact: true });
  // Nothing to complain about while the box is empty.
  await expect(box).toBeFocused();
  await expect(error).toHaveCount(0);
  await expect(importButton).toBeDisabled();

  await page.keyboard.type("this is not a blueprint");
  await expect(error).toHaveText("This is not a blueprint string: it starts with 't', a blueprint string starts with '0'.");
  await expect(importButton).toBeDisabled();
  await expect(box).toHaveAttribute("aria-invalid", "true");
  await page.screenshot({ path: resolve(SHOTS, "paste-error.png") });

  // A string that was cut short, a planner, and a blueprint without an entity the editor knows.
  const cases: readonly (readonly [string, string])[] = [
    [encodeBlueprintString(MIXED).slice(0, 120), "The blueprint string is damaged or incomplete: it cannot be unpacked."],
    [encodeBlueprintString({ upgrade_planner: { item: "upgrade-planner" } }), "This is an upgrade planner, not a blueprint; the editor imports blueprints only."],
    [encodeBlueprintString({ blueprint: { item: "blueprint", entities: [{ entity_number: 1, name: "straight-rail", position: position(0.5, 0.5) }] } }), "The editor knows none of the 1 entity of this blueprint (straight-rail), so there is nothing to import."],
  ];
  for (const [text, message] of cases) {
    await box.fill(text);
    await expect(error).toHaveText(message);
    await expect(importButton).toBeDisabled();
  }
  // The keys of the circuit stay with the dialog, and the project behind it is untouched.
  expect(await entityNames(page)).toEqual(["source", "gate", "twice", "light"]);
  await expect(paste).toBeVisible();

  // Text that becomes a blueprint can be imported from the same dialog.
  await box.fill(encodeBlueprintString(BOOK.blueprint_book.blueprints[1]));
  await expect(error).toHaveCount(0);
  await expect(paste.locator('[data-message="blueprint"]')).toHaveText('"Two lamps": 2 entities.');
  await importButton.click();
  await expect.poll(() => entityNames(page)).toEqual(["lamp1", "lamp2"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("reports a file that is not text or too large, and reads or writes no path the page names", async ({ app, page }) => {
  const binary = await blueprintPath("binary.txt");
  await writeFile(binary, new Uint8Array([0x30, 0xff, 0xfe, 0x00, 0x80]));
  await stubDialogs(app, { openPath: binary });
  await clickMenu(app, "File", "Import Blueprint...");
  await expect(toast(page)).toHaveText(`Not a text file: ${binary}`);
  await toast(page).getByRole("button", { name: "Dismiss message" }).click();

  const large = await blueprintPath("large.txt");
  await writeFile(large, new Uint8Array(16 * 1024 * 1024 + 1).fill(0x41));
  await stubDialogs(app, { openPath: large });
  await clickMenu(app, "File", "Import Blueprint...");
  await expect(toast(page)).toHaveText(`The file is too large for a blueprint (limit 16 MiB): ${large}`);

  // The two calls take no path. Whatever the page passes, the file comes from the dialog (here: cancelled) and the text must be a blueprint string.
  const secret = await blueprintPath("secret.txt");
  await writeFile(secret, "0secret");
  const target = await blueprintPath("target.txt");
  await stubDialogs(app, {});
  const answers = await page.evaluate(
    async ([readPath, writePath]) => {
      const api = window.face as unknown as { importBlueprintFile(...args: unknown[]): Promise<unknown>; exportBlueprintFile(...args: unknown[]): Promise<unknown> };
      return [
        await api.importBlueprintFile(readPath, { path: readPath }),
        await api.exportBlueprintFile({ name: "x", text: "0abc", path: writePath }, writePath),
        await api.exportBlueprintFile({ name: writePath, text: "0abc" }),
        await api.exportBlueprintFile({ name: "x", text: `0abc\n${writePath}` }),
        await api.exportBlueprintFile({ name: "x", text: "not a blueprint string" }),
        await api.exportBlueprintFile({ name: "x", text: "{}" }),
        await api.exportBlueprintFile({ name: "x" }),
        await api.exportBlueprintFile(writePath),
      ];
    },
    [secret, target] as const,
  );
  expect(answers).toEqual([
    { ok: true, value: null },
    { ok: true, value: null },
    { ok: true, value: null },
    { ok: false, error: "Not a blueprint string" },
    { ok: false, error: "Not a blueprint string" },
    { ok: false, error: "Not a blueprint string" },
    { ok: false, error: "Blueprint string must be a string" },
    { ok: false, error: "Export request must be an object" },
  ]);
  const calls = await dialogCalls(app);
  expect(calls).toMatchObject({ open: 1, save: 2 });
  // A project name that looks like a path only ever becomes a file name in the folder the dialog starts in.
  expect(calls.saveOptions!.defaultPath).not.toContain(dirname(target));
  expect(await readdir(dirname(target))).toEqual([]);
});
