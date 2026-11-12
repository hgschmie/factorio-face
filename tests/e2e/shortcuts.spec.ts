// Keyboard shortcuts of the canvas: the tools (Q, Alt+R, Alt+G, 1 to 5), Escape, the arrow keys, Cmd/Ctrl+D, the shortcut
// overview, and where none of them may act: while typing, in a dialog, in a menu, with the modifier of a menu key.
import type { ElectronApplication, Page } from "@playwright/test";
import { canvas, card, cardGrabPoint, clickCenter, clickMenu, clientPointOf, committedPositions, entityNames, expect, pin, selectEntity, sourceText, test, wires } from "./app.ts";
import { FIVE_KINDS, FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

const MAC = process.platform === "darwin";
const KINDS = ["constant", "arithmetic", "decider", "selector", "lamp"] as const;
const SELECT = { type: "select" };
const RED_WIRE = { type: "wire", color: "red" };
const BROKEN_SOURCE = FIVE_KINDS_SOURCE.replace("when virtual:signal-A < 10", "when virtual:signal-A <");

const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
const toolButton = (page: Page, name: string) => page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name });
const block = (page: Page, kind: string) => page.locator(`.palette-item[data-kind="${kind}"]`);
const listed = (page: Page, name: string) => page.locator(".entity-list").getByRole("button", { name, exact: true });
const mode = (page: Page, name: string) => page.getByRole("navigation", { name: "Workbench mode" }).getByRole("button", { name, exact: true });
const overview = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });
const menu = (page: Page) => page.getByRole("menu", { name: "Canvas actions" });
const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const redo = (page: Page) => page.getByRole("button", { name: "Redo" });
const activeTool = (page: Page) => page.evaluate(() => window.faceSession!.getState().tool);
const selectedNames = (page: Page) => page.locator("g.card.selected").evaluateAll((cards) => cards.map((element) => element.getAttribute("data-entity-name")).sort());
const readClipboard = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());

/** The circuit is what the fixture declares, the select tool is active and nothing but `selected` is selected. */
async function expectUntouched(page: Page, tool: object = SELECT): Promise<void> {
  await expect.poll(() => activeTool(page)).toEqual(tool);
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(page.locator("g.card")).toHaveCount(5);
}

const start = { gate: { x: 300, y: 80 }, twice: { x: 300, y: 260 } };

test.beforeEach(async ({ page }) => {
  await openFiveKinds(page);
});

test("Q, Alt+R, Alt+G and the digits pick the tools, wherever the focus is outside of text", async ({ page }) => {
  await canvas(page).focus();
  await page.keyboard.press("Alt+KeyR");
  await expect(toolButton(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".canvas")).toHaveClass(/wire-red/);
  // The key picks the tool; pressed again it does not put it down.
  await page.keyboard.press("Alt+KeyR");
  await page.keyboard.press("Alt+KeyG");
  await expect(toolButton(page, "Green wire")).toHaveAttribute("aria-pressed", "true");
  await expect(toolButton(page, "Red wire")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Alt+KeyG");
  await page.keyboard.press("Alt+KeyR");
  await expect(toolButton(page, "Red wire")).toHaveAttribute("aria-pressed", "true");

  for (const [index, kind] of KINDS.entries()) {
    await page.keyboard.press(String(index + 1));
    await expect(block(page, kind)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('.palette-item[aria-pressed="true"]')).toHaveCount(1);
    await expect.poll(() => activeTool(page)).toEqual({ type: "place", kind });
  }
  await page.keyboard.press("6");
  await page.keyboard.press("0");
  await page.keyboard.press("q");
  await expect(toolButton(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.palette-item[aria-pressed="true"]')).toHaveCount(0);

  // With the focus on a button of the palette, of the inspector or of the dock the keys are the same.
  await listed(page, "twice").click();
  await expect(listed(page, "twice")).toBeFocused();
  await page.keyboard.press("2");
  await expect(block(page, "arithmetic")).toHaveAttribute("aria-pressed", "true");
  await inspector(page).getByRole("group", { name: "Facing" }).getByRole("button", { name: "East" }).focus();
  await page.keyboard.press("Alt+KeyG");
  await expect(toolButton(page, "Green wire")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Step" }).focus();
  await page.keyboard.press("Q");
  await expect(toolButton(page, "Select and move")).toHaveAttribute("aria-pressed", "true");

  // A building block picked with its key is placed with a click, and the select tool is back.
  await page.keyboard.press("5");
  await expect(block(page, "lamp")).toHaveAttribute("aria-pressed", "true");
  const empty = await clientPointOf(page, { x: 140, y: 360 });
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator("g.card")).toHaveCount(6);
  await expect(toolButton(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => sourceText(page)).toMatch(/lamp \w+ at \(40, 300\)/);
});

test("the tool buttons and the building blocks name their key in the tooltip, the blocks also next to their name", async ({ page }) => {
  await expect(toolButton(page, "Select and move")).toHaveAttribute("title", "Select and move (Q)");
  await expect(toolButton(page, "Red wire")).toHaveAttribute("title", MAC ? "Red wire (⌥R)" : "Red wire (Alt+R)");
  await expect(toolButton(page, "Green wire")).toHaveAttribute("title", MAC ? "Green wire (⌥G)" : "Green wire (Alt+G)");
  expect(await page.locator(".palette-item").evaluateAll((items) => items.map((item) => item.getAttribute("title")))).toEqual(["Place: Constant (1)", "Place: Arithmetic (2)", "Place: Decider (3)", "Place: Selector (4)", "Place: Lamp (5)"]);
  await expect(page.locator(".palette-item kbd.key-hint")).toHaveText(["1", "2", "3", "4", "5"]);
  for (const hint of await page.locator(".palette-item kbd.key-hint").all()) await expect(hint).toBeVisible();

  // A screen reader hears the key once: it is in the description (the tooltip), not in the name, and the hint is hidden from it.
  await expect(page.locator('.palette-item kbd.key-hint[aria-hidden="true"]')).toHaveCount(5);
  await expect(block(page, "constant")).toHaveAccessibleName("Constant Emit steady signals");
  await expect(block(page, "constant")).toHaveAccessibleDescription("Place: Constant (1)");
  await expect(toolButton(page, "Red wire")).toHaveAccessibleName("Red wire");
  await expect(toolButton(page, "Red wire")).toHaveAccessibleDescription(MAC ? "Red wire (⌥R)" : "Red wire (Alt+R)");
  expect(await page.locator(".palette [aria-keyshortcuts]").count()).toBe(0);
});

test("Escape returns to the select tool from outside the canvas, after it has dropped a pending wire", async ({ page }) => {
  await toolButton(page, "Red wire").click();
  await expect(toolButton(page, "Red wire")).toBeFocused();
  await expect(toolButton(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(toolButton(page, "Select and move")).toHaveAttribute("aria-pressed", "true");

  // A wire that was started is dropped first; the tool stays for the next one.
  await page.keyboard.press("Alt+KeyG");
  await clickCenter(page, pin(page, "pick", "out", "green"));
  await expect(pin(page, "pick", "out", "green")).toHaveClass(/pending/);
  await toolButton(page, "Green wire").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pin.pending")).toHaveCount(0);
  await expect(toolButton(page, "Green wire")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(toolButton(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  await expect(wires(page)).toHaveCount(7);

  // On the canvas the key does what it did: the wire, the tool, then the selection.
  await selectEntity(page, "gate");
  await page.keyboard.press("3");
  await expect(block(page, "decider")).toHaveAttribute("aria-pressed", "true");
  await canvas(page).focus();
  await page.keyboard.press("Escape");
  await expect(toolButton(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await page.keyboard.press("Escape");
  await expect(page.locator("g.card.selected")).toHaveCount(0);

  // Escape that closes a dialog is the dialog's: the tool behind it stays.
  await page.keyboard.press("4");
  await expect(block(page, "selector")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Project settings" });
  await settings.getByLabel("Project name").focus();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(block(page, "selector")).toHaveAttribute("aria-pressed", "true");
  await expectUntouched(page, { type: "place", kind: "selector" });
});

test("the keys are text in the name field, the description, the signal search and the source editor", async ({ page }) => {
  const LETTERS = "q12345rg?";
  /** Keys that type nothing with their modifier: where the focus is they must do nothing to the circuit either. */
  const pressModified = async (): Promise<void> => {
    for (const key of ["Alt+KeyR", "Alt+KeyG", "ControlOrMeta+d"]) await page.keyboard.press(key);
  };

  await selectEntity(page, "source");
  const name = inspector(page).getByLabel("Entity name");
  await name.fill("");
  await name.pressSequentially(LETTERS);
  await expect(name).toHaveValue(LETTERS);
  // The arrows move the caret.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.type("x");
  await expect(name).toHaveValue("q12345rx?");
  await pressModified();
  await page.keyboard.press("Escape");
  await expect(name).toHaveValue("source");
  await expectUntouched(page);

  const description = inspector(page).getByLabel("Description", { exact: true });
  await description.click();
  await page.keyboard.type(`${LETTERS} Q R`);
  await expect(description).toHaveValue(`${LETTERS} Q R`);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("1");
  await expect(description).toHaveValue(`${LETTERS} Q1 R`);
  await pressModified();
  await page.keyboard.press("Escape");
  await expect(description).toHaveValue("");
  await expectUntouched(page);

  await inspector(page).getByRole("button", { name: "Choose signal 1" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a signal" });
  const search = picker.getByLabel("Search signals");
  await expect(search).toBeFocused();
  await page.keyboard.type(LETTERS);
  await expect(search).toHaveValue(LETTERS);
  await page.keyboard.press("ArrowLeft");
  await pressModified();
  // In the dialog the keys belong to its controls also where they are not text.
  await picker.getByRole("button", { name: "Close signal picker" }).focus();
  for (const key of ["q", "3", "r", "ArrowRight", "Alt+KeyR", "ControlOrMeta+d"]) await page.keyboard.press(key);
  await picker.getByRole("button", { name: "Close signal picker" }).click();
  await expect(picker).toHaveCount(0);
  await expectUntouched(page);

  await mode(page, "Split").click();
  await page.locator(".source-pane .cm-line", { hasText: "wire red twice.out <-> pick.in" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(` // ${LETTERS}`);
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE.replace("pick.in\n", `pick.in // ${LETTERS}\n`));
  await page.keyboard.press("Alt+KeyR");
  await page.keyboard.press("Alt+KeyG");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("!");
  const typed = FIVE_KINDS_SOURCE.replace("pick.in\n", "pick.in // q12345rg!?\n");
  await expect.poll(() => sourceText(page)).toBe(typed);
  // Cmd/Ctrl+D is the editor's own key there.
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => sourceText(page)).toBe(typed);
  await expect.poll(() => activeTool(page)).toEqual(SELECT);
  await expect.poll(() => committedPositions(page)).toMatchObject({ source: { x: 40, y: 80 }, gate: start.gate });
  expect(await entityNames(page)).toEqual(FIVE_KINDS);
  await expect(overview(page)).toHaveCount(0);
});

test("Cmd/Ctrl+R is Run of the menu: it neither rotates nor picks a tool, and plain R still rotates", async ({ page, app }) => {
  await selectEntity(page, "gate");
  for (const key of ["ControlOrMeta+r", "ControlOrMeta+Shift+r", "ControlOrMeta+t", "ControlOrMeta+1"]) await page.keyboard.press(key);
  // A key that does act, to know the ones before it were handled: exactly one quarter turn.
  await page.keyboard.press("r");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "south");
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE.replace("gate at (300, 80)", "gate at (300, 80) facing south"));
  await expect.poll(() => activeTool(page)).toEqual(SELECT);

  // The key is registered for the menu item, and the item runs the simulation.
  const accelerators = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((item) => item.label === "Simulation")!.submenu!.items.map((item) => [item.label, item.accelerator]));
  expect(accelerators).toEqual([["Run / Pause", "CmdOrCtrl+R"], ["Step", "CmdOrCtrl+T"], ["Reset", "CmdOrCtrl+Shift+R"]]);
  await clickMenu(app, "Simulation", "Run / Pause");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId("tick-counter").textContent())).toBeGreaterThan(0);
  await clickMenu(app, "Simulation", "Run / Pause");
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "south");
});

test("the arrow keys move the selection one grid step, with Shift five, and every press is one undo step", async ({ page }) => {
  await selectEntity(page, "gate");
  const gate = () => committedPositions(page).then((positions) => positions.gate);
  await page.keyboard.press("ArrowRight");
  await expect.poll(gate).toEqual({ x: 320, y: 80 });
  await page.keyboard.press("ArrowDown");
  await expect.poll(gate).toEqual({ x: 320, y: 100 });
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(gate).toEqual({ x: 220, y: 100 });
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(gate).toEqual({ x: 220, y: 0 });
  await expect(card(page, "gate")).toHaveAttribute("data-x", "220");
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await expect(wires(page)).toHaveCount(7);
  // With Cmd, Ctrl or Alt the arrows are not ours.
  for (const key of ["Alt+ArrowRight", "Control+ArrowDown"]) await page.keyboard.press(key);

  for (const position of [{ x: 220, y: 100 }, { x: 320, y: 100 }, { x: 320, y: 80 }, start.gate]) {
    await undo(page).click();
    await expect.poll(gate).toEqual(position);
  }
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await expect.poll(gate).toEqual({ x: 320, y: 80 });
  await undo(page).click();
  await expect.poll(gate).toEqual(start.gate);

  // A held arrow repeats, each repetition a step; a held R turns once.
  await canvas(page).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await expect.poll(gate).toEqual({ x: 360, y: 80 });
  for (let i = 0; i < 3; i++) await page.keyboard.down("r");
  await page.keyboard.up("r");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "south");
  for (let i = 0; i < 4; i++) await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();

  // Several entities move together as one step, also with the focus on a button outside the canvas.
  await canvas(page).focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("g.card.selected")).toHaveCount(5);
  await page.getByRole("button", { name: "Step" }).focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => committedPositions(page)).toEqual({ source: { x: 40, y: 180 }, gate: { x: 300, y: 180 }, twice: { x: 300, y: 360 }, pick: { x: 560, y: 360 }, light: { x: 560, y: 180 } });
  await expect(page.locator("g.card.selected")).toHaveCount(5);
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();

  // Without a selection the arrows do nothing.
  await canvas(page).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("g.card.selected")).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("?");
  await expect(overview(page)).toBeVisible();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
});

test("the arrows move through an open menu and not the selection", async ({ page }) => {
  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: /Cut/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page).getByRole("menuitem", { name: /Copy/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page).getByRole("menuitem", { name: /Paste/ })).toBeFocused();
  // Neither do the other keys act while the menu is open.
  for (const key of ["q", "2", "Alt+KeyR", "ControlOrMeta+d", "ArrowLeft", "ArrowRight"]) await page.keyboard.press(key);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await expectUntouched(page);
});

test("Cmd/Ctrl+D duplicates the selection as one undo step and leaves the clipboard alone", async ({ page, app }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText("kept"));
  await selectEntity(page, "source");
  const gate = await cardGrabPoint(page, "gate");
  await page.keyboard.down("Shift");
  await page.mouse.click(gate.x, gate.y);
  await page.keyboard.up("Shift");
  await expect(page.locator("g.card.selected")).toHaveCount(2);

  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.locator("g.card")).toHaveCount(7);
  await expect.poll(() => selectedNames(page)).toEqual(["gate2", "source2"]);
  await expect.poll(() => committedPositions(page)).toMatchObject({ source: { x: 40, y: 80 }, gate: start.gate, source2: { x: 80, y: 120 }, gate2: { x: 340, y: 120 } });
  // The wires between the two came along: red and green from source to gate and the two feedback wires.
  await expect(wires(page)).toHaveCount(11);
  expect(await readClipboard(app)).toBe("kept");
  const duplicated = await sourceText(page);

  // It is what a copy and a paste give; the copies are the selection either way.
  const pasted = await page.evaluate(() => {
    const { commands, getState } = window.faceSession!;
    commands.undo();
    const ids = getState().circuit.entities.filter((entity) => entity.name === "source" || entity.name === "gate").map((entity) => entity.id);
    commands.pasteEntities(commands.copyEntities(ids));
    return getState().source;
  });
  expect(pasted).toBe(duplicated);
  await expect.poll(() => selectedNames(page)).toEqual(["gate2", "source2"]);

  // The key goes on from the copies; a held key makes one copy.
  await canvas(page).focus();
  await page.keyboard.down("ControlOrMeta");
  for (let i = 0; i < 3; i++) await page.keyboard.down("d");
  await page.keyboard.up("d");
  await page.keyboard.up("ControlOrMeta");
  await expect(page.locator("g.card")).toHaveCount(9);
  await expect.poll(() => selectedNames(page)).toEqual(["gate3", "source3"]);
  await expect.poll(() => committedPositions(page)).toMatchObject({ source3: { x: 120, y: 160 }, gate3: { x: 380, y: 160 } });
  expect(await readClipboard(app)).toBe("kept");

  // Each duplicate is one undo step.
  await undo(page).click();
  await expect(page.locator("g.card")).toHaveCount(7);
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await redo(page).click();
  await expect(page.locator("g.card")).toHaveCount(9);

  // Nothing selected, nothing duplicated.
  await page.keyboard.press("Escape");
  await expect(page.locator("g.card.selected")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("?");
  await expect(overview(page)).toBeVisible();
  await expect(page.locator("g.card")).toHaveCount(9);
  expect(await readClipboard(app)).toBe("kept");
});

test("the overview opens with ? and from the Help menu, holds the focus and gives it back on Escape", async ({ page, app }) => {
  await canvas(page).focus();
  await page.keyboard.press("5");
  await expect(block(page, "lamp")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+Slash");
  await expect(overview(page)).toBeVisible();
  await expect(overview(page)).toHaveAttribute("aria-modal", "true");
  await expect(overview(page).getByRole("heading", { level: 3 })).toHaveText(["Tools", "Editing", "View", "Simulation", "File"]);
  const keys = (id: string) => overview(page).locator(`[data-shortcut="${id}"] kbd`);
  const row = (id: string) => overview(page).locator(`[data-shortcut="${id}"] dt`);
  await expect(keys("tool.wireRed")).toHaveText(MAC ? ["⌥", "R"] : ["Alt", "R"]);
  await expect(keys("tool.place.lamp")).toHaveText(["5"]);
  await expect(keys("edit.duplicate")).toHaveText(MAC ? ["⌘", "D"] : ["Ctrl", "D"]);
  await expect(keys("edit.nudgeFar")).toHaveText([MAC ? "⇧" : "Shift", "Arrow keys"]);
  await expect(keys("edit.redo")).toHaveText(MAC ? ["⇧", "⌘", "Z"] : ["Ctrl", "Y"]);
  await expect(keys("simulation.toggleRun")).toHaveText(MAC ? ["⌘", "R"] : ["Ctrl", "R"]);
  await expect(keys("file.saveAs")).toHaveText(MAC ? ["⇧", "⌘", "S"] : ["Ctrl", "Shift", "S"]);
  await expect(row("simulation.toggleRun")).toHaveText("Run / Pause");
  await expect(row("view.shortcuts")).toHaveText("Keyboard shortcuts");
  // The whole dialog is inside the window.
  const [box, shell] = [await overview(page).boundingBox(), await page.locator(".app-shell").boundingBox()];
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(shell!.height);

  // The focus is in the dialog and stays there; the keys of the circuit are off behind it.
  const close = overview(page).getByRole("button", { name: "Close keyboard shortcuts" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await overview(page).getByText("Rotate clockwise").click();
  await expect(overview(page)).toBeFocused();
  for (const key of ["q", "1", "Alt+KeyR", "?", "ArrowLeft"]) await page.keyboard.press(key);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  // Escape closes the dialog and nothing else: the tool that was picked is still picked, the focus is where it was.
  await page.keyboard.press("Escape");
  await expect(overview(page)).toHaveCount(0);
  await expect(canvas(page)).toBeFocused();
  await expect.poll(() => activeTool(page)).toEqual({ type: "place", kind: "lamp" });
  await page.keyboard.press("Escape");
  await expect(toolButton(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  await expectUntouched(page);

  // From the menu, also while a text field has the focus; closing gives the field the focus back.
  await selectEntity(page, "gate");
  const name = inspector(page).getByLabel("Entity name");
  await name.click();
  await clickMenu(app, "Help", "Keyboard Shortcuts");
  await expect(overview(page)).toBeVisible();
  await expect(close).toBeFocused();
  await close.click();
  await expect(overview(page)).toHaveCount(0);
  await expect(name).toBeFocused();

  // A click beside the dialog closes it too.
  await canvas(page).focus();
  await page.keyboard.press("?");
  await expect(overview(page)).toBeVisible();
  await page.mouse.click(8, shell!.height - 8);
  await expect(overview(page)).toHaveCount(0);
  await expect(canvas(page)).toBeFocused();
});

test("in Source mode the keys of the canvas are off and the overview still opens", async ({ page, app }) => {
  await canvas(page).focus();
  await page.keyboard.press("Alt+KeyR");
  await expect(toolButton(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await mode(page, "Source").click();
  await expect(canvas(page)).toHaveCount(0);
  await expect(mode(page, "Source")).toBeFocused();
  for (const key of ["q", "1", "Alt+KeyG", "ArrowRight", "ControlOrMeta+d", "r", "Escape"]) await page.keyboard.press(key);
  await page.keyboard.press("?");
  await expect(overview(page)).toBeVisible();
  await expect.poll(() => activeTool(page)).toEqual(RED_WIRE);
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await page.keyboard.press("Escape");
  await expect(overview(page)).toHaveCount(0);
  await expect(mode(page, "Source")).toBeFocused();

  // In the editor the question mark is text, and the menu item opens the overview all the same.
  await page.locator(".source-pane .cm-line", { hasText: "wire red twice.out <-> pick.in" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // why?");
  await expect.poll(() => sourceText(page)).toContain("pick.in // why?");
  await expect(overview(page)).toHaveCount(0);
  await clickMenu(app, "Help", "Keyboard Shortcuts");
  await expect(overview(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overview(page)).toHaveCount(0);
  await expect(page.locator(".source-pane .cm-content")).toBeFocused();
});

test("while the source has errors the editing keys and the tools that edit are off; Q and the overview work", async ({ page }) => {
  await selectEntity(page, "gate");
  await page.keyboard.press("Alt+KeyR");
  await expect(toolButton(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate((text) => window.faceSession!.commands.setSource(text), BROKEN_SOURCE);
  await expect(page.locator(".invalid-banner")).toBeVisible();
  await expect(toolButton(page, "Red wire")).toBeDisabled();
  await expect(block(page, "constant")).toBeDisabled();

  await canvas(page).focus();
  await page.keyboard.press("q");
  await expect(toolButton(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  for (const key of ["1", "5", "Alt+KeyR", "Alt+KeyG", "ArrowRight", "Shift+ArrowDown", "ControlOrMeta+d", "r"]) await page.keyboard.press(key);
  await page.keyboard.press("?");
  await expect(overview(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overview(page)).toHaveCount(0);
  await expect.poll(() => activeTool(page)).toEqual(SELECT);
  await expect.poll(() => sourceText(page)).toBe(BROKEN_SOURCE);
  await expect.poll(() => committedPositions(page)).toMatchObject(start);
  await expect(page.locator("g.card")).toHaveCount(5);

  // Valid again: the same keys act.
  await page.evaluate((text) => window.faceSession!.commands.setSource(text), FIVE_KINDS_SOURCE);
  await expect(page.locator(".invalid-banner")).toHaveCount(0);
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await canvas(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => committedPositions(page)).toMatchObject({ gate: { x: 320, y: 80 } });
  await page.keyboard.press("1");
  await expect(block(page, "constant")).toHaveAttribute("aria-pressed", "true");
});
