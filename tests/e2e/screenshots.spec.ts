// Reference screenshots of the workbench for visual review, written to .runtime/screenshots/.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { boardGrabPoint, card, cardGrabPoint, clickCenter, clientPointOf, expect, pin, ROOT, SCREENSHOT_DIR, selectEntity, showDisplay, shrinkToMinimum, test } from "./app.ts";
import { BOARD, hoverOnBoard, openBoard, pinOffsets, selectOnBoard, setSource } from "./board.ts";
import { openRelay } from "./fixtures.ts";

test("captures the workbench in its main states", async ({ page }) => {
  // The game's icons are generated locally and git-ignored; without them the inline placeholders are shown.
  const hasCatalogIcons = existsSync(resolve(ROOT, "packages/catalog/generated/icons/item/constant-combinator.png"));
  // The four combinators and the tiles of the tab that is on show (Logistics: 42, four of them the combinators again).
  if (hasCatalogIcons) await expect(page.locator(".palette-item img.entity-icon")).toHaveCount(42);
  else await expect(page.locator(".palette-item svg.entity-icon")).toHaveCount(42);
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

  // The sidebar: the entities in use closed, then open, above the tab of the poles, the lamp and the speaker.
  await group("Entities in use").click();
  await expect(page.locator(".palette-tile.in-use")).toHaveCount(0);
  // The chevron turns.
  await page.mouse.move(10, 10);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(shots, "sidebar-groups-closed.png") });
  await group("Entities in use").click();
  await expect(page.locator(".palette-tile.in-use")).toHaveCount(6);
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

const POLE_CHAIN = `circuit "Pole chain" {
    constant source at (40, 80) {
        virtual:signal-A = 1
    }

    pole p1 at (300, 80) {
    }

    pole p2 at (560, 80) {
        prototype = medium-electric-pole
    }

    lamp light at (820, 80) {
        when virtual:signal-A > 0
    }

    constant feed at (40, 320) {
        virtual:signal-B = 2
    }

    pole relay at (300, 320) {
    }

    decider gate at (560, 320) {
        when virtual:signal-B > 1
        output virtual:signal-C = 1
    }

    wire red source.out <-> p1
    wire red p1 <-> p2
    wire green p1 <-> p2
    wire red p2 <-> light.in
    wire red feed.out <-> relay
    wire green feed.out <-> relay
    wire red relay <-> gate.in
    wire green relay <-> gate.in
}
`;

const POLE_COLUMN = `circuit "Pole column" {
    constant feed at (40, 280) {
        virtual:signal-A = 1
    }

    pole top at (300, 80) {
    }

    pole middle at (300, 280) {
    }

    pole bottom at (300, 480) {
        prototype = big-electric-pole
    }

    pole aside at (560, 280) {
    }

    lamp light at (560, 480) {
        when virtual:signal-A > 0
    }

    wire red top <-> middle
    wire green top <-> middle
    wire red middle <-> bottom
    wire red feed.out <-> middle
    wire red bottom <-> light.in
    wire green middle <-> aside
}
`;

/** Poles in a row, in a column and on diagonals, a big pole and a substation, with a red and a green wire between each pair. */
const POLE_BOARD = `circuit "Pole board" {
    pole a at (0, 0) tile (0.5, 0.5) {
    }

    pole b at (0, 0) tile (3.5, 0.5) {
    }

    pole c at (0, 0) tile (0.5, 3.5) {
    }

    pole d at (0, 0) tile (3.5, 3.5) {
    }

    pole e at (0, 0) tile (5.5, 4.5) {
    }

    pole big at (0, 0) tile (7, 1) {
        prototype = big-electric-pole
    }

    pole station at (0, 0) tile (11, 1) {
        prototype = substation
    }

    pole under at (0, 0) tile (11, 4) {
        prototype = big-electric-pole
    }

    constant source at (0, 0) tile (-1.5, 1.5) {
        virtual:signal-A = 1
    }

    lamp light at (0, 0) tile (12.5, 3.5) {
        when virtual:signal-A > 0
    }

${[["a", "b"], ["a", "c"], ["a", "d"], ["d", "e"], ["b", "big"], ["big", "station"], ["station", "under"]].flatMap(([from, to]) => ["red", "green"].map((color) => `    wire ${color} ${from} <-> ${to}`)).join("\n")}
    wire red source.out <-> a
    wire green source.out <-> a
    wire red under <-> light.in
    wire green under <-> light.in
}
`;

const POLE_BOARD_CLOSE = `circuit "Pole board close up" {
    pole a at (0, 0) tile (1.5, 0.5) {
    }

    pole b at (0, 0) tile (3.5, 0.5) {
    }

    pole c at (0, 0) tile (1.5, 2.5) {
    }

    pole d at (0, 0) tile (3.5, 2.5) {
    }

    constant source at (0, 0) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    lamp light at (0, 0) tile (4.5, 2.5) {
        when virtual:signal-A > 0
    }

${[["a", "b"], ["a", "c"], ["a", "d"], ["c", "d"]].flatMap(([from, to]) => ["red", "green"].map((color) => `    wire ${color} ${from} <-> ${to}`)).join("\n")}
    wire red source.out <-> a
    wire green source.out <-> a
    wire red d <-> light.in
    wire green d <-> light.in
}
`;

test("captures the one connection point of a pole on both canvases, the wires between poles and the lower project bar", async ({ page, app }) => {
  const shots = resolve(SCREENSHOT_DIR, "pole-pins");
  const settle = () => page.waitForTimeout(250);
  const fit = () => page.getByRole("button", { name: "Fit circuit" }).click();
  const wirePaths = () => page.locator("g.wire").evaluateAll((groups) => Object.fromEntries(groups.map((group) => [group.querySelector("title")!.textContent!.replace(/ \(.*/, ""), group.querySelector("path.wire-core")!.getAttribute("d")!])));

  // The whole window with the example: the project bar is as high as the strip above the canvas.
  await page.mouse.move(10, 10);
  await settle();
  await page.screenshot({ path: resolve(shots, "window-default.png") });

  // The edit canvas: a chain through two poles and a pole between two cards in a row. One pair of pins at the top of each pole.
  await setSource(page, POLE_CHAIN);
  await fit();
  for (const name of ["p1", "p2", "relay"]) expect(await pinOffsets(page, name), name).toEqual({ "io red": [80, 0], "io green": [100, 0] });
  await page.mouse.move(10, 10);
  await settle();
  await page.screenshot({ path: resolve(shots, "edit-pole-chain.png") });
  await page.locator(".canvas").screenshot({ path: resolve(shots, "edit-pole-chain-canvas.png") });
  // A pending wire from the point of a pole starts in its pin.
  await page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Green wire" }).click();
  await clickCenter(page, pin(page, "p2", "io", "green"));
  const lower = await clientPointOf(page, { x: 800, y: 300 });
  await page.mouse.move(lower.x, lower.y, { steps: 3 });
  await expect(page.locator(".wire-preview.green")).toHaveAttribute("d", /^M 660 80 L /);
  await settle();
  await page.locator(".canvas").screenshot({ path: resolve(shots, "edit-pole-pending-wire.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("q");

  // Poles above and below each other, and a selected pole.
  await setSource(page, POLE_COLUMN);
  await fit();
  await selectEntity(page, "middle");
  await page.mouse.move(10, 10);
  await settle();
  await page.locator(".canvas").screenshot({ path: resolve(shots, "edit-pole-column-canvas.png") });
  await page.keyboard.press("Escape");

  // The board: the pins of a pole side by side at one height, and a red and a green wire between the same two poles both on show.
  await openBoard(page, POLE_BOARD);
  expect(await pinOffsets(page, "a")).toEqual({ "io red": [30, 12], "io green": [50, 12] });
  expect(await pinOffsets(page, "big")).toEqual({ "io red": [70, 12], "io green": [90, 12] });
  expect(await pinOffsets(page, "station")).toEqual({ "io red": [70, 12], "io green": [90, 12] });
  const paths = await wirePaths();
  // In a row: red 10 units above the pins, green 10 below. In a column and on a diagonal: straight, the pins keep them apart.
  expect(paths["red: b <-> a"]).toBe("M 270 12 L 270 12 Q 270 2 260 2 L 40 2 Q 30 2 30 12 L 30 12");
  expect(paths["green: b <-> a"]).toBe("M 290 12 L 290 12 Q 290 22 280 22 L 60 22 Q 50 22 50 12 L 50 12");
  expect(paths["red: c <-> a"]).toBe("M 30 252 L 30 12");
  expect(paths["green: c <-> a"]).toBe("M 50 252 L 50 12");
  expect(paths["red: d <-> a"]).toBe("M 270 252 L 30 12");
  expect(paths["green: d <-> a"]).toBe("M 290 252 L 50 12");
  // A big pole and a substation have their pins in the middle of two tiles, in a row with those of a pole on one tile.
  expect(paths["red: big <-> station"]).toBe("M 550 12 L 550 12 Q 550 2 560 2 L 860 2 Q 870 2 870 12 L 870 12");
  expect(paths["green: station <-> under"]).toBe("M 890 12 L 890 252");
  expect(new Set(Object.values(paths)).size).toBe(Object.keys(paths).length);
  await page.mouse.move(10, 10);
  await settle();
  await page.screenshot({ path: resolve(shots, "board-poles.png") });
  await page.locator(".canvas").screenshot({ path: resolve(shots, "board-poles-canvas.png") });
  // Close up: a row, a column and a diagonal of small poles, and a constant and a lamp wired to them.
  await openBoard(page, POLE_BOARD_CLOSE);
  await page.mouse.move(10, 10);
  await settle();
  await page.locator(".canvas").screenshot({ path: resolve(shots, "board-poles-close-up.png") });

  // A refused action: its message stands over the canvas, above the hint line and the zoom controls, also in Split mode.
  await openBoard(page, BOARD);
  await selectOnBoard(page, "source");
  const pick = await boardGrabPoint(page, "pick");
  await page.keyboard.down("Shift");
  await page.mouse.click(pick.x, pick.y);
  await page.keyboard.up("Shift");
  await page.keyboard.press("h");
  const toast = page.locator(".toast");
  await expect(toast).toHaveText("Not flipped: source would stand on a tile of gate.");
  const clear = async (where: string): Promise<void> => {
    const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
    const [message, hint, zoom, area] = [await box(".toast"), await box(".canvas-hint"), await box(".zoom-controls"), await box(".canvas-area")];
    expect(message.y + message.height, where).toBeLessThanOrEqual(Math.min(hint.y, zoom.y));
    expect(message.x, where).toBeGreaterThanOrEqual(area.x);
    expect(message.x + message.width, where).toBeLessThanOrEqual(area.x + area.width);
  };
  await clear("circuit");
  await settle();
  await page.screenshot({ path: resolve(shots, "refused-action-circuit.png") });
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".source-pane")).toBeVisible();
  await clear("split");
  await settle();
  await page.screenshot({ path: resolve(shots, "refused-action-split.png") });
  await toast.getByRole("button", { name: "Dismiss message" }).click();
  await page.getByRole("button", { name: "Circuit", exact: true }).click();

  // The smallest window.
  await shrinkToMinimum(app, page);
  await page.mouse.move(10, 10);
  await settle();
  await page.screenshot({ path: resolve(shots, "window-minimum.png") });
});

/** Entities of the game of several sizes on a board small enough to read: from one tile to the nine by nine of a rocket silo. */
const SIZES = `circuit "Sizes" {
    constant source at (40, 80) tile (19.5, 8.5) {
        item:iron-plate = 150
    }

    entity feeder at (280, 80) tile (18.5, 8.5) facing north {
        prototype = fast-inserter
        when item:iron-plate < 100
        read-hand = pulse
    }

    entity box at (520, 80) tile (17.5, 8.5) {
        prototype = steel-chest
        read-empty-slots = true
    }

    entity split at (760, 80) tile (15, 8.5) facing north {
        prototype = splitter
        input-left when item:iron-plate > 100
        output-right when item:iron-plate > 200
    }

    entity station at (1000, 80) tile (19, 6) {
        prototype = train-stop
        read-from-train = true
    }

    entity heat at (40, 300) tile (15.5, 6) facing north {
        prototype = boiler
    }

    entity maker at (280, 300) tile (11.5, 7.5) {
        prototype = assembling-machine-2
        when item:iron-plate > 100
        read-working = true
    }

    entity robots at (520, 300) tile (18, 2) {
        prototype = roboport
    }

    entity refinery at (760, 300) tile (12.5, 2.5) {
        prototype = oil-refinery
    }

    entity silo at (1000, 300) tile (4.5, 4.5) {
        prototype = rocket-silo
        read-launched = true
    }

    wire red source.out <-> feeder
    wire red feeder <-> box
    wire red box <-> split
    wire red split <-> maker
    wire green maker <-> silo
    wire green maker <-> refinery
    wire green source.out <-> station
}
`;

test("captures entities of the game of several sizes on the board and on the edit canvas", async ({ page }) => {
  const shots = resolve(SCREENSHOT_DIR, "entities-ui");
  await openBoard(page, SIZES);
  await expect(page.locator("g.card.board-entity")).toHaveCount(10);
  await expect(card(page, "feeder")).toHaveClass(/disabled/);
  await page.mouse.move(10, 10);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(shots, "board-sizes.png") });
  await page.locator(".canvas").screenshot({ path: resolve(shots, "board-sizes-canvas.png") });
  await showDisplay(page, "edit");
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await expect(page.locator("g.card")).toHaveCount(10);
  await page.mouse.move(10, 10);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(shots, "edit-canvas-sizes.png") });
});
