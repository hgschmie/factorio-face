// Deletion must be easy to find and must never fire while the user is typing.
import { canvas, card, cardGrabPoint, clickCenter, entityNames, expect, test, wires } from "./app.ts";

const ALL = ["source", "gate", "twice", "pick", "light"];

test("deletes through the toolbar attached to the selected card", async ({ page }) => {
  await expect(page.locator(".selection-toolbar")).toHaveCount(0);
  const light = await cardGrabPoint(page, "light");
  await page.mouse.click(light.x, light.y);

  // The action is visible next to the selected card, labelled, with its shortcut.
  const toolbar = page.getByRole("toolbar", { name: "Selection actions" });
  const remove = toolbar.getByRole("button", { name: "Delete selected entity" });
  await expect(remove).toBeVisible();
  await expect(remove).toContainText("Delete");
  const cardBox = (await card(page, "light").locator(".card-body").boundingBox())!;
  const buttonBox = (await remove.boundingBox())!;
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(cardBox.y);
  expect(cardBox.y - (buttonBox.y + buttonBox.height)).toBeLessThan(30);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 8);
  expect(buttonBox.x).toBeGreaterThan(cardBox.x);

  // On a card with feedback wires the toolbar sits above the loops instead of covering them.
  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y);
  const loopTop = (await page.locator('g.wire[data-wire="green|e2.in|e2.out"] path.wire-core').boundingBox())!.y;
  const gateButton = (await remove.boundingBox())!;
  expect(gateButton.y + gateButton.height).toBeLessThanOrEqual(loopTop + 2);

  await clickCenter(page, remove);
  expect(await entityNames(page)).toEqual(["source", "twice", "pick", "light"]);
  // The entity's five wires went with it, and the whole deletion is one undo step.
  await expect(wires(page)).toHaveCount(2);
  await expect(page.locator(".selection-toolbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await entityNames(page)).toEqual(ALL);
  await expect(wires(page)).toHaveCount(7);
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
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Home");
  await page.keyboard.press("Delete");
  await expect(name).toHaveValue("igh");
  expect(await entityNames(page)).toEqual(ALL);
  await page.keyboard.press("Escape");
  await expect(name).toHaveValue("light");

  // The same in a settings field of the inspector.
  const number = page.getByLabel("Number", { exact: true });
  await number.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  expect(await entityNames(page)).toEqual(ALL);
  await expect(card(page, "light")).toHaveClass(/selected/);
});

test("Delete and Backspace do not delete entities while the source editor has focus", async ({ page }) => {
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y);
  await expect(card(page, "gate")).toHaveClass(/selected/);

  const content = page.locator(".source-pane .cm-content");
  await content.click();
  await expect(content).toBeFocused();
  const before = await content.innerText();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  expect(await entityNames(page)).toEqual(ALL);
  await expect(card(page, "gate")).toHaveClass(/selected/);
  // The keys did reach the editor.
  expect(await content.innerText()).not.toBe(before);

  // The Edit > Delete menu command follows the same rule.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await content.click();
  await page.keyboard.press("Delete");
  expect(await entityNames(page)).toEqual(ALL);
});
