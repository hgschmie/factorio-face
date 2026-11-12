// Reference screenshots of the workbench for visual review, written to .runtime/screenshots/.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cardGrabPoint, expect, ROOT, SCREENSHOT_DIR, selectEntity, test } from "./app.ts";

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

  const greenWire = page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Green wire" });
  await greenWire.click();
  await expect(greenWire).toHaveAttribute("aria-pressed", "true");
  // The pressed colors fade in.
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "workbench-wire-tool.png") });
});

test("captures the integrated session: running simulation, diagnostics, signal picker, module settings", async ({ page }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });

  // A running simulation with the three downstream entities traced.
  const empty = { x: 0, y: 0 };
  for (const [index, name] of ["gate", "twice", "light"].entries()) {
    const point = await cardGrabPoint(page, name);
    if (index > 0) await page.keyboard.down("Shift");
    await page.mouse.click(point.x, point.y);
    if (index > 0) await page.keyboard.up("Shift");
    if (index === 0) Object.assign(empty, { x: point.x - 150, y: point.y + 250 });
  }
  await page.getByLabel("SPEED").selectOption("10");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(async () => Number(await page.getByTestId("tick-counter").textContent())).toBeGreaterThanOrEqual(17);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "integration-simulation-running.png") });
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Reset simulation" }).click();

  // The signal picker, opened from a constant's signal field, on the Space Age group.
  await selectEntity(page, "source");
  await inspector.getByRole("button", { name: "Choose signal 1" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a signal" });
  await picker.getByRole("tab", { name: "Space" }).click();
  await expect(picker.locator(".picker-signal").first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "integration-signal-picker.png") });
  await picker.getByLabel("Search signals").fill("carbon fiber");
  await picker.locator('[data-signal="item:carbon-fiber"]').click();
  await expect(picker).toHaveCount(0);

  // Module settings; switching Space Age off turns the signal just chosen into a warning.
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Project settings" });
  await settings.getByRole("checkbox", { name: /Space Age/ }).uncheck();
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "integration-module-settings.png") });
  await settings.getByRole("button", { name: "Close project settings" }).click();

  // Split view with an error and the warning: squiggles in the editor, the problems list below, a read-only canvas.
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.locator(".cm-line", { hasText: "when virtual:signal-B > 8" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and");
  await expect(page.locator(".diagnostics li.severity-error")).not.toHaveCount(0);
  await page.mouse.move(10, 10);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "integration-split-diagnostics.png") });
});
