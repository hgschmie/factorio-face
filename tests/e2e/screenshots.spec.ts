// Reference screenshots of the workbench for visual review, written to .runtime/screenshots/.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cardGrabPoint, expect, ROOT, SCREENSHOT_DIR, test } from "./app.ts";

test("captures the workbench in its main states", async ({ page }) => {
  // The game's icons are generated locally and git-ignored; without them the inline placeholders are shown.
  const hasCatalogIcons = existsSync(resolve(ROOT, "packages/catalog/generated/icons/item/constant-combinator.png"));
  if (hasCatalogIcons) await expect(page.locator(".palette-item img.entity-icon")).toHaveCount(5);
  else await expect(page.locator(".palette-item svg.entity-icon")).toHaveCount(5);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "workbench-circuit.png") });

  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y);
  await expect(page.getByRole("toolbar", { name: "Selection actions" })).toBeVisible();
  await page.getByRole("button", { name: "Step" }).click({ clickCount: 30 });
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "workbench-selection.png") });

  await page.mouse.click(gate.x, gate.y, { button: "right" });
  await expect(page.getByRole("menu", { name: "Canvas actions" })).toBeVisible();
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "workbench-context-menu.png") });
  await page.keyboard.press("Escape");

  await page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Green wire" }).click();
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "workbench-wire-tool.png") });
});
