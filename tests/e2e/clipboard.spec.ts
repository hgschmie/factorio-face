// Cut, copy and paste of entities on the canvas. The clipboard is the real one of the system, read and written through Electron's
// `clipboard` module in the main process; the actions are real key presses, the web contents' own cut / copy / paste (what the
// Edit menu items do: on macOS those are native and cannot be clicked from here) and real clicks in the context menu, whose Paste
// goes through the main process like Edit > Paste.
import type { ElectronApplication, Page } from "@playwright/test";
import { canvas, card, cardGrabPoint, CARET, clickCenter, clientPointOf, committedPositions, entityNames, expect, openExample, selectEntity, sourceText, test, wires } from "./app.ts";
import { FIVE_KINDS as ALL, FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

const SOURCE_AND_GATE = `constant source at (40, 80) {
    virtual:signal-A = 1
}

decider gate at (300, 80) {
    when virtual:signal-A < 10
    output virtual:signal-A = input
}

wire red source.out <-> gate.in
wire green source.out <-> gate.in
wire red gate.out <-> gate.in
wire green gate.out <-> gate.in
`;
const TWICE_AND_PICK = `arithmetic twice at (300, 260) {
    virtual:signal-B = virtual:signal-A[red] * 2
}

selector pick at (560, 260) {
    operation = select
    order = min
    index = virtual:signal-I
}

wire red twice.out <-> pick.in
`;
const LIGHT = "lamp light at (560, 80) {\n    when virtual:signal-B > 8\n}\n";
const GATE = "decider gate at (300, 80) {\n    when virtual:signal-A < 10\n    output virtual:signal-A = input\n}\n\nwire red gate.out <-> gate.in\nwire green gate.out <-> gate.in\n";

test.beforeEach(async ({ page, app }) => {
  await writeClipboard(app, "");
  await openFiveKinds(page);
});

function readClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

function writeClipboard(app: ElectronApplication, text: string): Promise<void> {
  return app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
}

/** What Edit > Cut, Copy and Paste do: the role items call these methods of the focused web contents. */
function editRole(app: ElectronApplication, role: "cut" | "copy" | "paste"): Promise<void> {
  return app.evaluate(({ BrowserWindow }, method) => BrowserWindow.getAllWindows()[0]!.webContents[method](), role);
}

async function selectGroup(page: Page, ...names: string[]): Promise<void> {
  await selectEntity(page, names[0]!);
  await page.keyboard.down("Shift");
  for (const name of names.slice(1)) {
    const point = await cardGrabPoint(page, name);
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.up("Shift");
  await expect(page.locator("g.card.selected")).toHaveCount(names.length);
  await expect(canvas(page)).toBeFocused();
}

/** Takes the pointer off the canvas without a click, so that the focus stays where it is. */
async function pointerOffCanvas(page: Page): Promise<void> {
  const box = (await page.locator(".statusbar").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function pointerTo(page: Page, world: { x: number; y: number }): Promise<void> {
  const point = await clientPointOf(page, world);
  await page.mouse.move(point.x, point.y);
}

/** Right-clicks a world point and clicks Paste in the menu that opens there. */
async function pasteByMenu(page: Page, world: { x: number; y: number }): Promise<void> {
  const point = await clientPointOf(page, world);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Paste/ }));
  await expect(menu(page)).toHaveCount(0);
}

async function selectedNames(page: Page): Promise<string[]> {
  return page.locator("g.card.selected").evaluateAll((cards) => cards.map((element) => element.getAttribute("data-entity-name") ?? ""));
}

const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const redo = (page: Page) => page.getByRole("button", { name: "Redo" });
const menu = (page: Page) => page.getByRole("menu", { name: "Canvas actions" });
const toast = (page: Page) => page.locator(".toast");

test("copies a group with its wires and pastes it under the pointer as one undo step", async ({ page, app }) => {
  await page.getByRole("button", { name: "Zoom out" }).click();
  await selectGroup(page, "source", "gate");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toBe(SOURCE_AND_GATE);
  // Copying changes nothing.
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();

  // The corner of the group goes to the grid point under the pointer; the shape of the group stays.
  await pointerTo(page, { x: 47, y: 453 });
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "source2", "gate2"]);
  await expect(wires(page)).toHaveCount(11);
  expect(await committedPositions(page)).toMatchObject({ source: { x: 40, y: 80 }, gate: { x: 300, y: 80 }, source2: { x: 40, y: 460 }, gate2: { x: 300, y: 460 } });
  await expect.poll(() => selectedNames(page)).toEqual(["source2", "gate2"]);
  await expect(page.getByRole("complementary", { name: "Inspector" }).getByRole("heading", { name: "2 entities selected" })).toBeVisible();
  const pasted = await sourceText(page);
  expect(pasted).toContain("    decider gate2 at (300, 460) {\n        when virtual:signal-A < 10\n        output virtual:signal-A = input\n    }\n\n    wire red source.out <-> gate.in\n");
  expect(pasted).toContain("    wire red twice.out <-> pick.in\n    wire red source2.out <-> gate2.in\n    wire green source2.out <-> gate2.in\n    wire red gate2.out <-> gate2.in\n    wire green gate2.out <-> gate2.in\n}\n");

  // One step back and forth.
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();
  await expect(wires(page)).toHaveCount(7);
  await redo(page).click();
  await expect.poll(() => sourceText(page)).toBe(pasted);
  await expect(page.locator("g.card")).toHaveCount(7);
  await expect(redo(page)).toBeDisabled();
});

test("pastes next to the original and further away each time while the pointer is elsewhere", async ({ page, app }) => {
  await selectGroup(page, "source", "gate");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toBe(SOURCE_AND_GATE);
  await pointerOffCanvas(page);

  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "source2", "gate2"]);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "source2", "gate2", "source3", "gate3"]);
  expect(await committedPositions(page)).toMatchObject({ source2: { x: 80, y: 120 }, gate2: { x: 340, y: 120 }, source3: { x: 120, y: 160 }, gate3: { x: 380, y: 160 } });
  await expect(wires(page)).toHaveCount(15);
  await expect.poll(() => selectedNames(page)).toEqual(["source3", "gate3"]);

  // The copies are entities of their own: moving one leaves its original alone.
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await committedPositions(page)).gate3).toEqual({ x: 380, y: 180 });
  expect(await committedPositions(page)).toMatchObject({ gate: { x: 300, y: 80 }, gate2: { x: 340, y: 120 } });

  // Each paste is a step of its own.
  await undo(page).click();
  await undo(page).click();
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "source2", "gate2"]);
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await redo(page).click();
  await redo(page).click();
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "source2", "gate2", "source3", "gate3"]);
});

test("cuts a group as one step and pastes it back in place", async ({ page, app }) => {
  await selectGroup(page, "twice", "pick");
  await pointerOffCanvas(page);
  await page.keyboard.press("ControlOrMeta+x");
  await expect.poll(() => entityNames(page)).toEqual(["source", "gate", "light"]);
  expect(await readClipboard(app)).toBe(TWICE_AND_PICK);
  await expect(wires(page)).toHaveCount(4);
  await expect(page.locator("g.card.selected")).toHaveCount(0);

  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await expect.poll(() => entityNames(page)).toEqual(["source", "gate", "light"]);

  // The names and the place are free again. The wires to entities outside the group are not part of the clipboard.
  await canvas(page).focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => entityNames(page)).toEqual(["source", "gate", "light", "twice", "pick"]);
  expect(await committedPositions(page)).toMatchObject({ twice: { x: 300, y: 260 }, pick: { x: 560, y: 260 } });
  await expect(wires(page)).toHaveCount(5);
  await expect.poll(() => selectedNames(page)).toEqual(["twice", "pick"]);
  await undo(page).click();
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
});

test("the Edit menu's cut, copy and paste act on the selected entities", async ({ page, app }) => {
  await selectEntity(page, "light");
  await pointerOffCanvas(page);
  await editRole(app, "copy");
  await expect.poll(() => readClipboard(app)).toBe(LIGHT);
  await editRole(app, "paste");
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "light2"]);
  expect((await committedPositions(page)).light2).toEqual({ x: 600, y: 120 });
  await expect.poll(() => selectedNames(page)).toEqual(["light2"]);
  await editRole(app, "cut");
  await expect.poll(() => entityNames(page)).toEqual(ALL);
  expect(await readClipboard(app)).toBe(LIGHT.replace("light at (560, 80)", "light2 at (600, 120)"));
  await undo(page).click();
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
});

test("the context menu of a card cuts, copies and pastes, and shows the shortcuts", async ({ page, app }) => {
  await page.getByRole("button", { name: "Zoom out" }).click();
  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Cut/, /Copy/, /Paste/, /Rotate clockwise/, /Rotate counter-clockwise/, /Flip horizontal/, /Flip vertical/, /Delete/]);
  await expect(menu(page).getByRole("menuitem").locator("kbd")).toHaveText([/^(⌘|Ctrl\+)X$/, /^(⌘|Ctrl\+)C$/, /^(⌘|Ctrl\+)V$/, /^R$/, /^(⇧|Shift\+)R$/, /^H$/, /^V$/, /⌫|Del/]);
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Copy/ }));
  await expect.poll(() => readClipboard(app)).toBe(GATE);
  await expect(menu(page)).toHaveCount(0);
  expect(await entityNames(page)).toEqual(ALL);

  // The keys work right after the menu: the focus is back on the canvas, and the paste goes to the pointer.
  await expect(canvas(page)).toBeFocused();
  await pointerTo(page, { x: 112, y: 468 });
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "gate2"]);
  expect((await committedPositions(page)).gate2).toEqual({ x: 120, y: 460 });
  await expect(card(page, "gate2")).toHaveClass(/selected/);
  await expect(wires(page)).toHaveCount(9);

  const copy = await cardGrabPoint(page, "gate2");
  await page.mouse.click(copy.x, copy.y, { button: "right" });
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Cut/ }));
  await expect.poll(() => entityNames(page)).toEqual(ALL);
  expect(await readClipboard(app)).toBe(GATE.replace("gate at (300, 80)", "gate2 at (120, 460)").replaceAll("gate.", "gate2."));

  // Paste in the menu of a card: the copy goes to the grid point that was right-clicked, on top of the card, and is the selection.
  const twice = await clientPointOf(page, { x: 387, y: 293 });
  await page.mouse.click(twice.x, twice.y, { button: "right" });
  await expect(card(page, "twice")).toHaveClass(/selected/);
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Paste/ }));
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "gate2"]);
  expect((await committedPositions(page)).gate2).toEqual({ x: 380, y: 300 });
  await expect.poll(() => selectedNames(page)).toEqual(["gate2"]);
  for (let step = 0; step < 3; step++) await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();
});

test("the context menu pastes at the point it was opened at, as one undo step", async ({ page, app }) => {
  await page.getByRole("button", { name: "Zoom out" }).click();
  await selectEntity(page, "light");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toBe(LIGHT);

  // Empty canvas has no selection, so its menu has no Cut and no Copy. The pointer is on the item when it is clicked, away from
  // the point the menu was opened at.
  const empty = await clientPointOf(page, { x: 47, y: 453 });
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Paste/, /Select all/, /Fit to content/]);
  await expect(page.locator("g.card.selected")).toHaveCount(0);
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Paste/ }));
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "light2"]);
  expect((await committedPositions(page)).light2).toEqual({ x: 40, y: 460 });
  await expect.poll(() => selectedNames(page)).toEqual(["light2"]);
  await expect(canvas(page)).toBeFocused();

  // The point belonged to that one paste: the next one by key goes to the pointer again.
  await pointerTo(page, { x: 312, y: 448 });
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "light2", "light3"]);
  expect((await committedPositions(page)).light3).toEqual({ x: 320, y: 440 });

  // So does the one after a paste that the main process did not perform. The second call returns after the first has failed.
  await app.evaluate(({ ipcMain }) => ipcMain.removeHandler("face:edit:paste"));
  await pasteByMenu(page, { x: 47, y: 393 });
  await page.evaluate(() => window.face!.getRecentProjects());
  await pointerTo(page, { x: 312, y: 388 });
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "light2", "light3", "light4"]);
  expect((await committedPositions(page)).light4).toEqual({ x: 320, y: 380 });

  // Each paste is one step.
  await undo(page).click();
  await undo(page).click();
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "light2"]);
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();
});

test("pastes into another project with names that are free there, and ignores other text with a notice", async ({ page, app }) => {
  await selectGroup(page, "source", "gate");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toBe(SOURCE_AND_GATE);

  // The example circuit has a source and a gate of its own in the same places.
  await openExample(app, page);
  await expect(page.locator("g.card")).toHaveCount(4);
  await expect(page.locator(".project-meta .path")).not.toContainText("Feedback example.faceproj");
  const before = await sourceText(page);
  await pointerOffCanvas(page);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => entityNames(page)).toEqual(["source", "gate", "twice", "light", "source2", "gate2"]);
  expect(await committedPositions(page)).toMatchObject({ source2: { x: 80, y: 120 }, gate2: { x: 340, y: 120 } });
  await expect(wires(page)).toHaveCount(8);
  await expect.poll(() => selectedNames(page)).toEqual(["source2", "gate2"]);
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(before);

  // Text that is not a circuit fragment: nothing is pasted, not even its valid part.
  for (const text of ["just some words", `${LIGHT}wire red light.in <-> nowhere.out\n`]) {
    await writeClipboard(app, text);
    await page.keyboard.press("ControlOrMeta+v");
    await expect(toast(page)).toContainText("Nothing was pasted");
    expect(await sourceText(page)).toBe(before);
    await expect(undo(page)).toBeDisabled();
    await toast(page).getByRole("button", { name: "Dismiss message" }).click();
    await expect(toast(page)).toHaveCount(0);
  }
  // The Paste of the context menu ends in the same notice.
  await pasteByMenu(page, { x: 60, y: 320 });
  await expect(toast(page)).toContainText("Nothing was pasted");
  expect(await sourceText(page)).toBe(before);
  await toast(page).getByRole("button", { name: "Dismiss message" }).click();
  // The text of the notice can be selected and copied like any text, also while entities are selected.
  await selectEntity(page, "light");
  await writeClipboard(app, "words");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(toast(page)).toContainText("Nothing was pasted");
  await toast(page).locator("span").evaluate((message) => document.getSelection()!.selectAllChildren(message));
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toMatch(/^Nothing was pasted/);
  await toast(page).getByRole("button", { name: "Dismiss message" }).click();
  await expect(toast(page)).toHaveCount(0);

  // A declaration written by hand is as good as a copy.
  await writeClipboard(app, "lamp extra at (0, 400) { when virtual:signal-A > 0 }");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => entityNames(page)).toEqual(["source", "gate", "twice", "light", "extra"]);
  await expect(toast(page)).toHaveCount(0);
});

test("text fields and the source editor keep their own cut, copy and paste", async ({ page, app }) => {
  await selectEntity(page, "light");
  const name = page.getByLabel("Entity name");
  await name.click();
  await expect(name).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toBe("light");
  await page.keyboard.press(CARET.end);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(name).toHaveValue("lightlight");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+x");
  await expect(name).toHaveValue("");
  await expect.poll(() => readClipboard(app)).toBe("lightlight");
  // A fragment on the clipboard is text here like any other.
  await writeClipboard(app, LIGHT);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(name).not.toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(name).toHaveValue("light");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();

  // The source editor: a fragment pasted into the circuit block is text that the user typed, not a canvas paste.
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const content = page.locator(".source-pane .cm-content");
  await content.click();
  await expect(content).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toBe(FIVE_KINDS_SOURCE);
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await writeClipboard(app, "    lamp extra at (40, 440) {\n    }\n");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE.replace(/\}\n$/, "    lamp extra at (40, 440) {\n    }\n}\n"));
  await expect.poll(() => entityNames(page)).toEqual([...ALL, "extra"]);

  // Text left selected in the editor does not take the clipboard away from the canvas once the focus is there.
  await page.keyboard.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await selectEntity(page, "light");
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toBe(LIGHT);
});

test("while the source has errors a copy still works, cut and paste do nothing", async ({ page, app }) => {
  await selectEntity(page, "light");
  await page.evaluate((text) => window.faceSession!.commands.setSource(text), FIVE_KINDS_SOURCE.replace("when virtual:signal-A < 10", "when virtual:signal-A <"));
  await expect(page.locator(".invalid-banner")).toBeVisible();
  const broken = await sourceText(page);
  await canvas(page).focus();
  await pointerOffCanvas(page);

  // The canvas shows the last valid circuit, and that is what a copy takes.
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toBe(LIGHT);
  await writeClipboard(app, GATE);
  await page.keyboard.press("ControlOrMeta+x");
  await page.keyboard.press("ControlOrMeta+v");
  // The copy that follows was handled after the two keys before it.
  await selectEntity(page, "gate");
  await writeClipboard(app, "");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => readClipboard(app)).toBe(GATE);
  expect(await sourceText(page)).toBe(broken);
  expect(await entityNames(page)).toEqual(ALL);
  await expect(toast(page)).toHaveCount(0);

  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: /Copy/ })).toBeEnabled();
  for (const item of [/Cut/, /Paste/, /Delete/]) await expect(menu(page).getByRole("menuitem", { name: item })).toBeDisabled();
});
