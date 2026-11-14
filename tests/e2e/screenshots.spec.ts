// Reference screenshots of the workbench for visual review, written to .runtime/screenshots/.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { card, cardGrabPoint, expect, ROOT, SCREENSHOT_DIR, selectEntity, showDisplay, shrinkToMinimum, test } from "./app.ts";
import { hoverOnBoard, selectOnBoard } from "./board.ts";
import { openRelay } from "./fixtures.ts";

test("captures the workbench in its main states", async ({ page }) => {
  // The game's icons are generated locally and git-ignored; without them the inline placeholders are shown.
  const hasCatalogIcons = existsSync(resolve(ROOT, "packages/catalog/generated/icons/item/constant-combinator.png"));
  // The four combinators and the two entries of the group that starts open.
  if (hasCatalogIcons) await expect(page.locator(".palette-item img.entity-icon")).toHaveCount(6);
  else await expect(page.locator(".palette-item svg.entity-icon")).toHaveCount(6);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "workbench-circuit.png") });

  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y);
  await expect(card(page, "gate")).toHaveClass(/selected/);
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

test("captures the entity selector, poles and the speaker", async ({ page, app }) => {
  const shots = resolve(SCREENSHOT_DIR, "package-h");
  const group = (name: string) => page.locator(".palette-group-header", { hasText: name });
  await openRelay(page);
  await page.getByRole("button", { name: "Fit circuit" }).click();

  // The sidebar: every group closed, then every group open.
  await group("Lights and sound").click();
  await expect(page.locator(".palette-item")).toHaveCount(4);
  // The chevrons turn.
  await page.mouse.move(10, 10);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(shots, "sidebar-groups-closed.png") });
  await group("Lights and sound").click();
  await group("Power poles").click();
  await expect(page.locator(".palette-item")).toHaveCount(10);
  await page.mouse.move(10, 10);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(shots, "sidebar-groups-open.png") });
  await page.locator(".palette").screenshot({ path: resolve(shots, "sidebar-groups-open-panel.png") });

  // A chain through the poles on the edit canvas, with the simulation's status rows.
  await page.screenshot({ path: resolve(shots, "edit-pole-chain.png") });
  await page.locator(".canvas").screenshot({ path: resolve(shots, "edit-pole-chain-canvas.png") });

  // The inspectors of a pole and of the speaker.
  await selectEntity(page, "big");
  await page.screenshot({ path: resolve(shots, "inspector-pole.png") });
  await selectEntity(page, "alarm");
  await page.screenshot({ path: resolve(shots, "inspector-speaker.png") });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector.getByRole("checkbox", { name: "Show alert" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(shots, "inspector-speaker-lower.png") });

  // The board: a small, a medium and a big pole and a substation with their wires, and the bubble of the pole under the pointer.
  await page.keyboard.press("Escape");
  await showDisplay(page, "blueprint");
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.mouse.move(10, 10);
  await page.screenshot({ path: resolve(shots, "board-poles.png") });
  await page.locator(".canvas").screenshot({ path: resolve(shots, "board-poles-canvas.png") });
  await selectOnBoard(page, "station");
  await hoverOnBoard(page, "station");
  await page.screenshot({ path: resolve(shots, "board-substation-selected.png") });

  // A big pole in hand: its footprint of two by two tiles under the pointer.
  await page.locator('.palette-item[data-prototype="big-electric-pole"]').click();
  const box = (await page.locator("svg.canvas-svg").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.75);
  await expect(page.locator("rect.board-ghost")).toBeVisible();
  // The pressed colors fade in.
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(shots, "board-big-pole-ghost.png") });

  // A tall window has room for all of it at once (as tall as the screen allows).
  await page.keyboard.press("Escape");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1510, 1300));
  await page.waitForTimeout(300);
  await page.locator(".palette").screenshot({ path: resolve(shots, "sidebar-groups-open-tall-panel.png") });

  // The smallest window: the sidebar with every group open still shows the groups and the entity list, each scrolling.
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    const [width = 0, height = 0] = window!.getMinimumSize();
    window!.setSize(width, height);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(shots, "sidebar-minimum-window.png") });
  await page.locator(".palette").screenshot({ path: resolve(shots, "sidebar-minimum-window-panel.png") });
});

test("captures the strip, the status line, the tiles with their popups, the entities in use and the hover popup of the board", async ({ page, app }) => {
  const shots = resolve(SCREENSHOT_DIR, "ui-rework");
  const palette = page.getByRole("complementary", { name: "Components" });
  const tile = (prototype: string) => palette.locator(`.palette-item[data-prototype="${prototype}"]`);
  const settle = () => page.waitForTimeout(250);

  // The whole window, edit canvas: the strip above the canvas, the tiles, the status line.
  await page.mouse.move(10, 10);
  await settle();
  await page.screenshot({ path: resolve(shots, "window-edit.png") });

  // The selector with a popup: a combinator with its key, and a pole with its tiles and reach.
  await tile("decider-combinator").hover();
  await expect(page.locator(".tile-popup")).toHaveAttribute("data-prototype", "decider-combinator");
  await settle();
  await page.screenshot({ path: resolve(shots, "selector-popup.png") });
  await palette.locator(".palette-group-header", { hasText: "Power poles" }).click();
  await tile("big-electric-pole").hover();
  await expect(page.locator(".tile-popup")).toHaveAttribute("data-prototype", "big-electric-pole");
  await settle();
  await page.screenshot({ path: resolve(shots, "selector-popup-pole.png") });

  // "Entities in use" filled: the relay circuit has a lamp, a speaker and all four poles.
  await openRelay(page);
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await expect(palette.locator(".palette-tile.in-use")).toHaveCount(6);
  await page.mouse.move(10, 10);
  await settle();
  await page.screenshot({ path: resolve(shots, "entities-in-use.png") });
  await palette.screenshot({ path: resolve(shots, "entities-in-use-panel.png") });

  // The whole window, blueprint board, with the popup of the entity under the pointer.
  await showDisplay(page, "blueprint");
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await page.mouse.move(10, 10);
  await settle();
  await page.screenshot({ path: resolve(shots, "window-blueprint.png") });
  await hoverOnBoard(page, "alarm");
  await settle();
  await page.screenshot({ path: resolve(shots, "board-hover-popup.png") });

  // An error in the source: the status line and the banner.
  await page.evaluate(() => window.faceSession!.commands.setSource(window.faceSession!.getState().source.replace("> 0", ">")));
  await expect(page.locator(".status-source")).toHaveAttribute("data-level", "error");
  await page.mouse.move(10, 10);
  await settle();
  await page.screenshot({ path: resolve(shots, "status-error.png") });
  await page.getByRole("button", { name: "Undo" }).click();

  // The smallest window, Circuit and Split: the strip on one line and wrapped.
  await shrinkToMinimum(app, page);
  await settle();
  await page.screenshot({ path: resolve(shots, "window-minimum.png") });
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await settle();
  await page.screenshot({ path: resolve(shots, "window-minimum-split.png") });
});
