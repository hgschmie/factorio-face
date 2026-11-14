// Wires on the canvas: a click selects one, and a selected wire is deleted like an entity. Every wire is clicked at a point
// computed from its own path; after each action the test waits for what the action should have caused.
import type { ElectronApplication, Page } from "@playwright/test";
import {
  canvas, canvasView, card, cardGrabPoint, CARET, clickCenter, clickMenu, clientPointOf, committedPositions, entityNames, expect, pin, selectEntity, sourceText, test, wire, wireKeyOf, wirePoint, wires,
} from "./app.ts";
import { FIVE_KINDS as ALL, FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

const LIGHT = "lamp light at (560, 80) {\n    when virtual:signal-B > 8\n}\n";
/** Where the wires from `source` to `gate` are clicked: their middle lies under the feedback loops of `gate`. */
const NEAR_SOURCE = 0.2;

test.beforeEach(async ({ page }) => {
  await openFiveKinds(page);
});

interface ClickOptions {
  /** Where on the wire, as a fraction of its length. */
  readonly at?: number;
  readonly shift?: boolean;
  readonly button?: "left" | "right";
}

async function clickWire(page: Page, key: string, { at = 0.5, shift = false, button = "left" }: ClickOptions = {}): Promise<void> {
  const point = await wirePoint(page, key, at);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y, { button });
  if (shift) await page.keyboard.up("Shift");
}

async function shiftClickCard(page: Page, name: string): Promise<void> {
  const point = await cardGrabPoint(page, name);
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Shift");
}

const selectedWires = (page: Page) => page.locator("g.wire.selected");
const selectedCards = (page: Page) => page.locator("g.card.selected");
const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
const statusText = (page: Page) => page.locator(".statusbar .status-selection");
const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const redo = (page: Page) => page.getByRole("button", { name: "Redo" });
const menu = (page: Page) => page.getByRole("menu", { name: "Canvas actions" });
const tool = (page: Page, name: string) => page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name });

/** Waits until exactly these wires are selected. */
async function expectSelectedWires(page: Page, ...keys: string[]): Promise<void> {
  await expect.poll(() => selectedWires(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-wire") ?? "").sort())).toEqual([...keys].sort());
}

function readClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

test("a click selects a wire alone; Shift adds and removes wires and cards", async ({ page }) => {
  const red = await wireKeyOf(page, "red", "source.out", "gate.in");
  const green = await wireKeyOf(page, "green", "source.out", "gate.in");
  const lamp = await wireKeyOf(page, "green", "twice.out", "light.in");
  await selectEntity(page, "gate");

  // Hovering shows that the wire can be clicked.
  const onRed = await wirePoint(page, red, NEAR_SOURCE);
  await expect(wire(page, red).locator(".wire-hit")).toHaveCSS("stroke", "rgba(0, 0, 0, 0)");
  await page.mouse.move(onRed.x, onRed.y);
  await expect(wire(page, red)).toHaveCSS("cursor", "pointer");
  await expect(wire(page, red).locator(".wire-hit")).not.toHaveCSS("stroke", "rgba(0, 0, 0, 0)");
  await expect(wire(page, green).locator(".wire-hit")).toHaveCSS("stroke", "rgba(0, 0, 0, 0)");

  await page.mouse.click(onRed.x, onRed.y);
  await expectSelectedWires(page, red);
  await expect(selectedCards(page)).toHaveCount(0);
  await expect(canvas(page)).toBeFocused();
  await expect(inspector(page).getByRole("heading", { name: "Red wire" })).toBeVisible();
  await expect(statusText(page)).toHaveText("red wire source.out <-> gate.in");
  // A selected wire is drawn above the others.
  await expect(page.locator("g.wires > g.wire").last()).toHaveAttribute("data-wire", red);

  // The green wire between the same two terminals runs 20 units away and is a target of its own.
  await clickWire(page, green, { at: NEAR_SOURCE });
  await expectSelectedWires(page, green);
  await clickWire(page, lamp);
  await expectSelectedWires(page, lamp);
  await expect(statusText(page)).toHaveText("green wire twice.out <-> light.in");

  // Shift adds a wire, then a card.
  await clickWire(page, red, { at: NEAR_SOURCE, shift: true });
  await expectSelectedWires(page, lamp, red);
  await expect(inspector(page).getByRole("heading", { name: "2 wires selected" })).toBeVisible();
  await expect(statusText(page)).toHaveText("2 wires selected");
  await shiftClickCard(page, "light");
  await expect(card(page, "light")).toHaveClass(/selected/);
  await expectSelectedWires(page, lamp, red);
  await expect(inspector(page).getByRole("heading", { name: "1 entity and 2 wires selected" })).toBeVisible();
  await expect(inspector(page).locator(".count-badge")).toHaveText("03");
  await expect(statusText(page)).toHaveText("1 entity and 2 wires selected");

  // Shift on a selected wire takes it out again; the rest stays.
  await clickWire(page, lamp, { shift: true });
  await expectSelectedWires(page, red);
  await expect(card(page, "light")).toHaveClass(/selected/);

  // A plain click on the selected card narrows the selection to it, a plain click on a wire to the wire.
  const light = await cardGrabPoint(page, "light");
  await page.mouse.click(light.x, light.y);
  await expect(selectedWires(page)).toHaveCount(0);
  await expect(card(page, "light")).toHaveClass(/selected/);
  await clickWire(page, lamp);
  await expectSelectedWires(page, lamp);
  await expect(selectedCards(page)).toHaveCount(0);

  // Empty canvas and Escape clear a wire selection.
  const empty = await clientPointOf(page, { x: 100, y: 330 });
  await page.mouse.click(empty.x, empty.y);
  await expect(selectedWires(page)).toHaveCount(0);
  await expect(statusText(page)).toHaveText("No selection");
  await clickWire(page, lamp);
  await expectSelectedWires(page, lamp);
  await page.keyboard.press("Escape");
  await expect(selectedWires(page)).toHaveCount(0);
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
});

test("Delete, Backspace and Edit > Delete remove the selected wires; undo restores them", async ({ page, app }) => {
  const red = await wireKeyOf(page, "red", "source.out", "gate.in");
  const lamp = await wireKeyOf(page, "green", "twice.out", "light.in");
  const toPick = await wireKeyOf(page, "red", "twice.out", "pick.in");

  await clickWire(page, red, { at: NEAR_SOURCE });
  await expectSelectedWires(page, red);
  await page.keyboard.press("Delete");
  await expect(wire(page, red)).toHaveCount(0);
  await expect(wires(page)).toHaveCount(6);
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE.replace("    wire red source.out <-> gate.in\n", ""));
  expect(await entityNames(page)).toEqual(ALL);
  await expect(inspector(page)).toContainText("Every signal starts somewhere.");

  await undo(page).click();
  await expect(wire(page, red)).toHaveCount(1);
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();
  await expect(selectedWires(page)).toHaveCount(0);

  // Several wires go in one step.
  await clickWire(page, lamp);
  await clickWire(page, toPick, { at: 0.25, shift: true });
  await expectSelectedWires(page, lamp, toPick);
  await page.keyboard.press("Backspace");
  await expect(wires(page)).toHaveCount(5);
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE.replace("    wire green twice.out <-> light.in\n", "").replace("    wire red twice.out <-> pick.in\n", ""));
  await undo(page).click();
  await expect(wires(page)).toHaveCount(7);
  await expect(undo(page)).toBeDisabled();

  // Nothing selected: the key does nothing.
  await canvas(page).focus();
  await page.keyboard.press("Delete");
  await clickWire(page, lamp);
  await expectSelectedWires(page, lamp);
  await expect(wires(page)).toHaveCount(7);
  await expect(undo(page)).toBeDisabled();

  await clickMenu(app, "Edit", "Delete");
  await expect(wire(page, lamp)).toHaveCount(0);
  await expect(wires(page)).toHaveCount(6);
  expect(await entityNames(page)).toEqual(ALL);
});

test("a wire and an entity selected together are deleted as one undo step", async ({ page }) => {
  const red = await wireKeyOf(page, "red", "source.out", "gate.in");
  await clickWire(page, red, { at: NEAR_SOURCE });
  await shiftClickCard(page, "light");
  await expect(card(page, "light")).toHaveClass(/selected/);
  await expectSelectedWires(page, red);

  await page.keyboard.press("Delete");
  await expect.poll(() => entityNames(page)).toEqual(["source", "gate", "twice", "pick"]);
  // The selected wire and the wire of the lamp.
  await expect(wires(page)).toHaveCount(5);
  await expect(wire(page, red)).toHaveCount(0);
  const text = await sourceText(page);
  expect(text).not.toContain("light");
  expect(text).not.toContain("wire red source.out <-> gate.in");
  await expect(statusText(page)).toHaveText("No selection");

  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(wires(page)).toHaveCount(7);
  await expect(undo(page)).toBeDisabled();
});

test("the context menu of a wire selects it and deletes the selection", async ({ page }) => {
  const red = await wireKeyOf(page, "red", "source.out", "gate.in");
  const lamp = await wireKeyOf(page, "green", "twice.out", "light.in");
  await selectEntity(page, "gate");

  // A right click on a wire outside the selection selects it alone. Wires have no cut or copy.
  await clickWire(page, lamp, { button: "right" });
  await expectSelectedWires(page, lamp);
  await expect(selectedCards(page)).toHaveCount(0);
  await expect(menu(page).getByRole("menuitem")).toHaveText([/^Delete/]);
  await expect(menu(page).getByRole("menuitem", { name: "Delete" }).locator("kbd")).toHaveText(/⌫|Del/);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(wires(page)).toHaveCount(7);

  await clickWire(page, lamp, { button: "right" });
  await clickCenter(page, menu(page).getByRole("menuitem", { name: "Delete" }));
  await expect(wire(page, lamp)).toHaveCount(0);
  await expect(wires(page)).toHaveCount(6);
  await expect(menu(page)).toHaveCount(0);
  expect(await entityNames(page)).toEqual(ALL);

  // On a wire of a mixed selection the menu acts on all of it, as one step.
  await clickWire(page, red, { at: NEAR_SOURCE });
  await shiftClickCard(page, "twice");
  await expect(card(page, "twice")).toHaveClass(/selected/);
  await clickWire(page, red, { at: NEAR_SOURCE, button: "right" });
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Cut/, /Copy/, /Paste/, /Rotate clockwise/, /Rotate counter-clockwise/, /Flip horizontal/, /Flip vertical/, /Delete 1 entity and 1 wire/]);
  await expectSelectedWires(page, red);
  await expect(card(page, "twice")).toHaveClass(/selected/);
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Delete/ }));
  await expect.poll(() => entityNames(page)).toEqual(["source", "gate", "pick", "light"]);
  await expect(wires(page)).toHaveCount(3);
  await undo(page).click();
  await expect.poll(() => entityNames(page)).toEqual(ALL);
  await expect(wires(page)).toHaveCount(6);

  // With a wire tool a wire is no target: the menu is the one of the empty canvas.
  await tool(page, "Red wire").click();
  await expect(tool(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await clickWire(page, red, { at: NEAR_SOURCE, button: "right" });
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Paste/, /Select all/, /Fit to content/]);
  await page.keyboard.press("Escape");
  await expect(selectedWires(page)).toHaveCount(0);
});

test("the inspector shows a selected wire, jumps to its ends and deletes", async ({ page }) => {
  const red = await wireKeyOf(page, "red", "source.out", "gate.in");
  const lamp = await wireKeyOf(page, "green", "twice.out", "light.in");
  const loop = await wireKeyOf(page, "red", "gate.out", "gate.in");
  const view = inspector(page).locator(".inspector-wire");

  await clickWire(page, lamp);
  await expect(view).toHaveAttribute("data-wire", lamp);
  await expect(view).toHaveAttribute("data-color", "green");
  await expect(view.getByRole("heading", { name: "Green wire" })).toBeVisible();
  await expect(view.locator(".wire-end")).toHaveText([/^twice\s*output$/, /^light\s*input$/]);
  await expect(inspector(page).locator(".count-badge")).toHaveText("01");

  // Either end selects its entity.
  await view.getByTitle("Select light").click();
  await expect(card(page, "light")).toHaveClass(/selected/);
  await expect(selectedWires(page)).toHaveCount(0);
  await expect(inspector(page).getByLabel("Entity name")).toHaveValue("light");
  await clickWire(page, lamp);
  await expect(view).toHaveAttribute("data-wire", lamp);
  await view.getByTitle("Select twice").click();
  await expect(inspector(page).getByLabel("Entity name")).toHaveValue("twice");
  await expect(selectedCards(page)).toHaveCount(1);

  // A feedback wire has both ends on one entity.
  await clickWire(page, loop);
  await expect(view).toHaveAttribute("data-color", "red");
  await expect(view.locator(".wire-end")).toHaveText([/^gate\s*output$/, /^gate\s*input$/]);

  await clickWire(page, lamp);
  await expect(view).toHaveAttribute("data-wire", lamp);
  await view.getByRole("button", { name: "Delete wire" }).click();
  await expect(wire(page, lamp)).toHaveCount(0);
  await expect(wires(page)).toHaveCount(6);
  await expect(inspector(page)).toContainText("Every signal starts somewhere.");
  await undo(page).click();
  await expect(wires(page)).toHaveCount(7);

  // Several wires: a summary with one Delete for all of them.
  await clickWire(page, lamp);
  await clickWire(page, red, { at: NEAR_SOURCE, shift: true });
  await expectSelectedWires(page, lamp, red);
  await expect(inspector(page).locator(".selected-wires li")).toHaveText(["source.out <-> gate.in", "twice.out <-> light.in"]);
  await shiftClickCard(page, "pick");
  await expect(inspector(page).locator(".inspector-multi .muted-note")).toHaveText("pick");
  await inspector(page).getByRole("button", { name: "Delete 1 entity and 2 wires" }).click();
  await expect.poll(() => entityNames(page)).toEqual(["source", "gate", "twice", "light"]);
  await expect(wires(page)).toHaveCount(4);
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();
});

test("pins and cards win over wires, and the wire and place tools ignore wires", async ({ page }) => {
  const red = await wireKeyOf(page, "red", "source.out", "gate.in");
  const lamp = await wireKeyOf(page, "green", "twice.out", "light.in");

  // Select tool: the pin lies on the end of the wire, and a click there takes the card.
  await clickCenter(page, pin(page, "gate", "in", "red"));
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await expect(selectedWires(page)).toHaveCount(0);

  // Wire tool: a click on a wire selects nothing and starts nothing.
  await tool(page, "Red wire").click();
  await expect(page.locator(".canvas")).toHaveClass(/wire-red/);
  await expect(wire(page, lamp)).not.toHaveCSS("cursor", "pointer");
  await clickWire(page, lamp);
  await clickWire(page, red, { at: NEAR_SOURCE });
  // The pin where two red wires end still starts a wire, and the next red pin completes it.
  await clickCenter(page, pin(page, "gate", "in", "red"));
  await expect(pin(page, "gate", "in", "red")).toHaveClass(/pending/);
  await expect(selectedWires(page)).toHaveCount(0);
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await clickCenter(page, pin(page, "light", "in", "red"));
  await expect(wire(page, await wireKeyOf(page, "red", "gate.in", "light.in"))).toHaveCount(1);
  await expect(wires(page)).toHaveCount(8);
  // The gesture between the ends of an existing wire still removes it.
  await clickCenter(page, pin(page, "gate", "in", "red"));
  await clickCenter(page, pin(page, "source", "out", "red"));
  await expect(wire(page, red)).toHaveCount(0);
  await expect(wires(page)).toHaveCount(7);
  await expect(selectedWires(page)).toHaveCount(0);

  // Place tool: a click on a wire places the card there.
  const onLamp = await wirePoint(page, lamp);
  await page.locator('.palette-item[data-kind="lamp"]').click();
  await expect(page.locator('.palette-item[data-kind="lamp"]')).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(onLamp.x, onLamp.y);
  await expect(card(page, "lamp1")).toHaveClass(/selected/);
  await expect(selectedWires(page)).toHaveCount(0);
  await undo(page).click();
  await expect(card(page, "lamp1")).toHaveCount(0);

  // Back with the select tool: a card that lies over a wire takes the click.
  await page.evaluate(() => {
    const session = window.faceSession!;
    const pick = session.getState().circuit.entities.find((entity) => entity.name === "pick")!;
    session.commands.moveEntities([{ id: pick.id, position: { x: 460, y: 200 } }]);
  });
  await expect(card(page, "pick")).toHaveAttribute("data-x", "460");
  await page.mouse.click(onLamp.x, onLamp.y);
  await expect(card(page, "pick")).toHaveClass(/selected/);
  await expect(selectedWires(page)).toHaveCount(0);
});

test("a wire selection survives a card move, a rename and edits to the source", async ({ page }) => {
  // Rename first, so that undo and redo rename under a selected wire.
  await selectEntity(page, "gate");
  const name = inspector(page).getByLabel("Entity name");
  await name.fill("counter");
  await name.press("Enter");
  await expect(card(page, "counter")).toHaveClass(/selected/);
  const feed = await wireKeyOf(page, "red", "counter.out", "twice.in");
  const lamp = await wireKeyOf(page, "green", "twice.out", "light.in");
  const view = inspector(page).locator(".inspector-wire");
  const path = wire(page, feed).locator("path.wire-core");

  // Dragging a selected card moves it and keeps the rest of the selection.
  await clickWire(page, feed);
  await shiftClickCard(page, "twice");
  await expect(card(page, "twice")).toHaveClass(/selected/);
  await expectSelectedWires(page, feed);
  const before = (await path.getAttribute("d"))!;
  const { zoom } = await canvasView(page);
  const grab = await cardGrabPoint(page, "twice");
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + 60 * zoom, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await committedPositions(page)).twice).toEqual({ x: 300, y: 320 });
  await expect(path).not.toHaveAttribute("d", before);
  await expectSelectedWires(page, feed);
  await expect(card(page, "twice")).toHaveClass(/selected/);
  // The arrow keys move the selected card; the wire follows and stays selected.
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await committedPositions(page)).twice).toEqual({ x: 320, y: 320 });
  await expectSelectedWires(page, feed);

  // The wire alone: undo takes back the two moves and then the rename, under the selected wire.
  await clickWire(page, feed);
  await expectSelectedWires(page, feed);
  await expect(view.locator(".wire-end")).toHaveText([/^counter\s*output$/, /^twice\s*input$/]);
  await undo(page).click();
  await undo(page).click();
  await expect.poll(async () => (await committedPositions(page)).twice).toEqual({ x: 300, y: 260 });
  await expect(path).toHaveAttribute("d", before);
  await expectSelectedWires(page, feed);
  await undo(page).click();
  await expect(view.locator(".wire-end")).toHaveText([/^gate\s*output$/, /^twice\s*input$/]);
  await expect(statusText(page)).toHaveText("red wire gate.out <-> twice.in");
  await expectSelectedWires(page, feed);
  await redo(page).click();
  await expect(view.locator(".wire-end")).toHaveText([/^counter\s*output$/, /^twice\s*input$/]);
  await expectSelectedWires(page, feed);

  // In the source a caret in a wire statement selects that wire, and typing there does not lose it.
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".source-pane .cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.locator(".source-pane .cm-line", { hasText: "wire green twice.out <-> light.in" }).click();
  await expectSelectedWires(page, lamp);
  await expect(view).toHaveAttribute("data-wire", lamp);
  await page.keyboard.press(CARET.end);
  await page.keyboard.type(" // to the lamp");
  await expect.poll(() => sourceText(page)).toContain("wire green twice.out <-> light.in // to the lamp\n");
  await expectSelectedWires(page, lamp);
  await expect(view).toHaveAttribute("data-wire", lamp);
});

test("copy, cut, Select All and the marquee take entities and leave wires alone", async ({ page, app }) => {
  const red = await wireKeyOf(page, "red", "source.out", "gate.in");
  await app.evaluate(({ clipboard }) => clipboard.writeText("kept"));

  // A wire alone: copy and cut do nothing. The Shift click that follows is handled after them.
  await clickWire(page, red, { at: NEAR_SOURCE });
  await expectSelectedWires(page, red);
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+x");
  await shiftClickCard(page, "light");
  await expect(card(page, "light")).toHaveClass(/selected/);
  expect(await readClipboard(app)).toBe("kept");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();

  // With an entity selected as well, cut takes the entity; the selected wire stays where it is, still selected.
  await page.keyboard.press("ControlOrMeta+x");
  await expect.poll(() => readClipboard(app)).toBe(LIGHT);
  await expect.poll(() => entityNames(page)).toEqual(["source", "gate", "twice", "pick"]);
  await expect(wires(page)).toHaveCount(6);
  await expectSelectedWires(page, red);

  // Select All takes the cards only.
  await page.keyboard.press("ControlOrMeta+a");
  await expect(selectedCards(page)).toHaveCount(4);
  await expect(selectedWires(page)).toHaveCount(0);

  // The marquee adds the cards it touches to the selection and no wires.
  await clickWire(page, red, { at: NEAR_SOURCE });
  await expectSelectedWires(page, red);
  const from = await clientPointOf(page, { x: 0, y: 250 });
  const to = await clientPointOf(page, { x: 280, y: 100 });
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(card(page, "source")).toHaveClass(/selected/);
  await expect(selectedCards(page)).toHaveCount(1);
  await expectSelectedWires(page, red);
});
