// Deletion must be easy to find and must never fire while the user is typing.
import { canvas, card, cardGrabPoint, CARET, clickCenter, entityNames, expect, sourceText, test, wires } from "./app.ts";
import { FIVE_KINDS as ALL, FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

test.beforeEach(async ({ page }) => {
  await openFiveKinds(page);
});

test("a selection shows no floating toolbar; on the canvas the context menu deletes", async ({ page }) => {
  const floatingDelete = page.locator(".canvas").getByRole("button", { name: /Delete/ });
  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y);
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await expect(page.getByRole("toolbar", { name: "Selection actions" })).toHaveCount(0);
  await expect(floatingDelete).toHaveCount(0);

  // Several cards: still nothing over the canvas; the inspector names the selection and the menu counts it.
  const light = await cardGrabPoint(page, "light");
  await page.keyboard.down("Shift");
  await page.mouse.click(light.x, light.y);
  await page.keyboard.up("Shift");
  await expect(page.locator("g.card.selected")).toHaveCount(2);
  await expect(page.getByRole("complementary", { name: "Inspector" }).getByRole("heading", { name: "2 entities selected" })).toBeVisible();
  await expect(floatingDelete).toHaveCount(0);
  const menu = page.getByRole("menu", { name: "Canvas actions" });
  await page.mouse.click(light.x, light.y, { button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveText([/Cut/, /Copy/, /Delete 2 entities/]);
  await page.keyboard.press("Escape");
  expect(await entityNames(page)).toEqual(ALL);

  // A right click on a card outside the selection selects it alone and deletes only it.
  const twice = await cardGrabPoint(page, "twice");
  await page.mouse.click(twice.x, twice.y);
  await page.mouse.click(gate.x, gate.y, { button: "right" });
  await expect(page.locator("g.card.selected")).toHaveCount(1);
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await clickCenter(page, menu.getByRole("menuitem", { name: "Delete" }));
  expect(await entityNames(page)).toEqual(["source", "twice", "pick", "light"]);
  // The entity's five wires went with it, and the whole deletion is one undo step that restores the text exactly.
  await expect(wires(page)).toHaveCount(2);
  await expect(page.locator("g.card.selected")).toHaveCount(0);
  expect(await sourceText(page)).not.toContain("gate");
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await entityNames(page)).toEqual(ALL);
  await expect(wires(page)).toHaveCount(7);
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("deletes through the context menu, which shows the shortcut", async ({ page }) => {
  const twice = await cardGrabPoint(page, "twice");
  await page.mouse.click(twice.x, twice.y, { button: "right" });
  await expect(card(page, "twice")).toHaveClass(/selected/);
  const menu = page.getByRole("menu", { name: "Canvas actions" });
  const remove = menu.getByRole("menuitem", { name: /Delete/ });
  await expect(remove).toBeVisible();
  await expect(remove.locator("kbd")).toHaveText(/⌫|Del/);

  // Escape closes the menu without deleting.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await entityNames(page)).toEqual(ALL);

  await page.mouse.click(twice.x, twice.y, { button: "right" });
  await clickCenter(page, menu.getByRole("menuitem", { name: /Delete/ }));
  expect(await entityNames(page)).toEqual(["source", "gate", "pick", "light"]);
  await expect(menu).toHaveCount(0);

  // On empty canvas the menu offers view actions instead.
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + box.height - 120, { button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveText([/Select all/, /Fit to content/]);
  await menu.getByRole("menuitem", { name: /Select all/ }).click();
  await expect(page.locator("g.card.selected")).toHaveCount(4);
});

test("deletes with Delete and Backspace while the canvas has focus", async ({ page }) => {
  const light = await cardGrabPoint(page, "light");
  await page.mouse.click(light.x, light.y);
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.press("Delete");
  expect(await entityNames(page)).toEqual(["source", "gate", "twice", "pick"]);

  const pick = await cardGrabPoint(page, "pick");
  await page.mouse.click(pick.x, pick.y);
  await page.keyboard.press("Backspace");
  expect(await entityNames(page)).toEqual(["source", "gate", "twice"]);

  // Nothing selected: the keys do nothing.
  await page.keyboard.press("Delete");
  expect(await entityNames(page)).toEqual(["source", "gate", "twice"]);

  // Several selected entities go in one step.
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("g.card.selected")).toHaveCount(3);
  await page.keyboard.press("Delete");
  expect(await entityNames(page)).toEqual([]);
  await expect(page.locator(".canvas-empty")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await entityNames(page)).toEqual(["source", "gate", "twice"]);
});

test("Delete and Backspace edit text, not the circuit, while a text field has focus", async ({ page }) => {
  const light = await cardGrabPoint(page, "light");
  await page.mouse.click(light.x, light.y);
  await expect(card(page, "light")).toHaveClass(/selected/);

  const name = page.getByLabel("Entity name");
  await name.click();
  await expect(name).toBeFocused();
  await page.keyboard.press(CARET.end);
  await page.keyboard.press("Backspace");
  await page.keyboard.press(CARET.start);
  await page.keyboard.press("Delete");
  await expect(name).toHaveValue("igh");
  expect(await entityNames(page)).toEqual(ALL);
  await page.keyboard.press("Escape");
  await expect(name).toHaveValue("light");

  // The same in a settings field of the inspector.
  const number = page.getByLabel("Number", { exact: true });
  await number.click();
  await page.keyboard.press(CARET.end);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await expect(number).toHaveValue("");
  expect(await entityNames(page)).toEqual(ALL);
  await expect(card(page, "light")).toHaveClass(/selected/);
});

test("Delete and Backspace do not delete entities while the source editor has focus", async ({ page }) => {
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".source-pane .cm-content")).toBeVisible();
  // The canvas is narrower now; bring the whole circuit back into view before aiming at a card.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y);
  await expect(card(page, "gate")).toHaveClass(/selected/);

  const content = page.locator(".source-pane .cm-content");
  await content.click();
  await expect(content).toBeFocused();
  // The caret now sits in some declaration, and that entity is the selection.
  await expect(page.locator("g.card.selected")).toHaveCount(1);
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  expect(await entityNames(page)).toEqual(ALL);
  await expect(page.locator("g.card.selected")).toHaveCount(1);
  // The keys did reach the editor: two characters are gone from the text, no entity from the circuit.
  expect((await sourceText(page)).length).toBe(FIVE_KINDS_SOURCE.length - 2);

  // The Edit > Delete menu command follows the same rule.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await content.click();
  await page.keyboard.press("Delete");
  expect(await entityNames(page)).toEqual(ALL);
});
