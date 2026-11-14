// The blueprint display mode: the tile board, entities on the tiles they take in the game, straight wires, the bubble of the
// entity under the pointer, paste and duplicate (copies without a tile), and a camera per mode. Editing on the board: blueprintEdit.spec.ts.
import type { Page } from "@playwright/test";
import { boardGrabPoint, canvas, canvasView, card, cardGrabPoint, clickCenter, entityNames, expect, pin, selectEntity, showDisplay, sourceText, test, wire, wireKeyOf, wirePoint, wires } from "./app.ts";
import { BOARD, bubble, display, footprint, hoverOnBoard, inspector, menu, openBoard, pinOffsets, placeAll, selectOnBoard, setSource, TILE, tilePoint, zoom } from "./board.ts";

/** What the edit canvas shows: where the cards are, how the wires run and the camera. */
async function editPicture(page: Page): Promise<unknown> {
  return page.evaluate(() => ({
    viewBox: document.querySelector("svg.canvas-svg")!.getAttribute("viewBox"),
    cards: [...document.querySelectorAll("g.card")].map((element) => [element.getAttribute("data-entity-name"), element.getAttribute("data-x"), element.getAttribute("data-y"), element.getAttribute("class"), element.querySelectorAll("*").length]),
    wires: [...document.querySelectorAll("g.wire path.wire-core")].map((path) => path.getAttribute("d")),
  }));
}

test("the switch and the B key change between the edit canvas and the blueprint board, and the edit canvas comes back as it was", async ({ page }) => {
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "edit");
  await expect(display(page, "Edit")).toHaveAttribute("aria-pressed", "true");
  await expect(display(page, "Blueprint")).toHaveAttribute("aria-pressed", "false");
  await expect(card(page, "gate")).toHaveCount(1);
  const before = await editPicture(page);
  const source = await sourceText(page);

  await display(page, "Blueprint").click();
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "blueprint");
  await expect(display(page, "Blueprint")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "gate")).toHaveClass(/board-entity/);
  await expect(card(page, "gate")).toHaveAttribute("data-tile-x", "3");
  await expect(page.locator("svg.canvas-svg rect.canvas-ground")).toHaveAttribute("fill", "url(#board-tiles)");
  await expect(page.locator(".canvas-hint")).toContainText("Drag entities to free tiles");
  await expect(page.locator(".statusbar")).toContainText("Tile grid");

  // B goes back and forth, wherever the focus is outside a text field.
  await page.keyboard.press("b");
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "edit");
  await expect(display(page, "Edit")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "gate")).not.toHaveAttribute("data-tile-x");
  expect(await editPicture(page)).toEqual(before);
  await expect(page.locator("svg.canvas-svg rect.canvas-ground")).toHaveAttribute("fill", "url(#grid-dots)");
  await expect(page.locator(".canvas-hint")).toContainText("Drag to arrange");

  await canvas(page).focus();
  await page.keyboard.press("b");
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "blueprint");
  await display(page, "Edit").click();
  expect(await editPicture(page)).toEqual(before);

  // The mode is no edit: nothing to undo, nothing to save.
  expect(await sourceText(page)).toBe(source);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByTestId("save-state")).toHaveText("No changes");

  // In a text field the key is a letter, and the overview lists it.
  await selectEntity(page, "gate");
  const name = inspector(page).getByLabel("Entity name");
  await name.fill("ga");
  await name.press("b");
  await expect(name).toHaveValue("gab");
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "edit");
  await name.press("Escape");
  await canvas(page).focus();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" }).locator('[data-shortcut="view.display"]')).toHaveText("Switch between Edit and Blueprint viewB");
  await page.keyboard.press("b");
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "edit");
});

test("entities stand on the tiles of their footprint: all five kinds, a 2x1 entity in all four directions", async ({ page }) => {
  await openBoard(page);
  await expect(page.locator("g.card.board-entity")).toHaveCount(6);
  expect(await footprint(page, "source")).toEqual({ tile: [0, 0], size: [1, 1], facing: "east", placed: "true" });
  expect(await footprint(page, "gate")).toEqual({ tile: [2, 0], size: [2, 1], facing: "east", placed: "true" });
  expect(await footprint(page, "twice")).toEqual({ tile: [5, 0], size: [1, 2], facing: "south", placed: "true" });
  expect(await footprint(page, "pick")).toEqual({ tile: [2, 2], size: [2, 1], facing: "west", placed: "true" });
  expect(await footprint(page, "check")).toEqual({ tile: [0, 2], size: [1, 2], facing: "north", placed: "true" });
  expect(await footprint(page, "light")).toEqual({ tile: [7, 0], size: [1, 1], facing: "east", placed: "true" });
  for (const name of ["source", "gate", "twice", "pick", "check", "light"]) {
    await expect(card(page, name)).not.toHaveClass(/unplaced|conflict/);
    const { tile } = await footprint(page, name);
    await expect(card(page, name)).toHaveAttribute("data-x", String(tile[0] * TILE));
    await expect(card(page, name)).toHaveAttribute("data-y", String(tile[1] * TILE));
  }

  // The pins: inputs on the input half, outputs on the output half, red on the left seen along the facing.
  expect(await pinOffsets(page, "gate")).toEqual({ "in red": [12, 30], "in green": [12, 50], "out red": [148, 30], "out green": [148, 50] });
  expect(await pinOffsets(page, "twice")).toEqual({ "in red": [50, 12], "in green": [30, 12], "out red": [50, 148], "out green": [30, 148] });
  expect(await pinOffsets(page, "pick")).toEqual({ "in red": [148, 50], "in green": [148, 30], "out red": [12, 50], "out green": [12, 30] });
  expect(await pinOffsets(page, "check")).toEqual({ "in red": [30, 148], "in green": [50, 148], "out red": [30, 12], "out green": [50, 12] });
  // A constant has outputs only, a lamp inputs only.
  expect(await pinOffsets(page, "source")).toEqual({ "out red": [68, 30], "out green": [68, 50] });
  expect(await pinOffsets(page, "light")).toEqual({ "in red": [12, 30], "in green": [12, 50] });
  await expect(pin(page, "gate", "out", "red").locator("title")).toHaveText("Red output");

  // Compact content: icon, name, the arrows of a 2x1 entity, and no card text.
  await expect(card(page, "gate").locator(".board-name")).toHaveText("gate");
  await expect(card(page, "gate").locator("image, svg")).toHaveCount(1);
  await expect(card(page, "gate").locator(".board-arrow")).toHaveCount(2);
  await expect(card(page, "source").locator(".board-arrow")).toHaveCount(0);
  await expect(card(page, "gate").locator(".card-kind, .card-summary, .card-row")).toHaveCount(0);

  // Live state in short: what a combinator emits, and whether the lamp is lit.
  await expect(card(page, "light")).toHaveAttribute("data-status", "off");
  await expect(card(page, "light").locator(".board-led")).not.toHaveClass(/on/);
  // The counter runs up to ten and starts over; the lamp is lit while twice the count is above 8.
  for (let tick = 0; tick < 12 && (await card(page, "light").getAttribute("data-status")) !== "lit"; tick++) await page.getByRole("button", { name: "Step" }).click();
  await expect(card(page, "light")).toHaveAttribute("data-status", "lit");
  await expect(card(page, "light")).toHaveClass(/active/);
  await expect(card(page, "light").locator(".board-led")).toHaveClass(/on/);
  await expect(card(page, "light").locator(".board-glow")).toHaveCount(1);
  await expect(card(page, "twice").locator(".board-output")).toHaveText(/^B \d+$/);
  await expect(card(page, "twice").locator(".board-led")).toHaveClass(/on/);
  // Nothing is wired to the input of this one, so its condition never holds.
  await expect(card(page, "check").locator(".board-output")).toHaveText("–");
  await expect(card(page, "check").locator(".board-led")).not.toHaveClass(/on/);
});

test("the inspector edits on the board, and a turn keeps the top-left tile of the footprint", async ({ page }) => {
  await openBoard(page);
  await selectOnBoard(page, "gate");
  await expect(inspector(page).getByLabel("Entity name")).toHaveValue("gate");

  // A quarter turn: from the tiles (2, 0) and (3, 0) to (2, 0) and (2, 1).
  const facing = inspector(page).getByRole("group", { name: "Facing" });
  await facing.locator('[data-direction="south"]').click();
  await expect.poll(() => footprint(page, "gate")).toEqual({ tile: [2, 0], size: [1, 2], facing: "south", placed: "true" });
  expect(await sourceText(page)).toContain("decider gate at (300, 80) tile (2.5, 1) facing south {");
  // A half turn keeps both tiles and swaps the ends.
  expect(await pinOffsets(page, "gate")).toMatchObject({ "in red": [50, 12], "out red": [50, 148] });
  await facing.locator('[data-direction="north"]').click();
  await expect.poll(() => footprint(page, "gate")).toEqual({ tile: [2, 0], size: [1, 2], facing: "north", placed: "true" });
  expect(await sourceText(page)).toContain("decider gate at (300, 80) tile (2.5, 1) facing north {");
  expect(await pinOffsets(page, "gate")).toMatchObject({ "in red": [30, 148], "out red": [30, 12] });
  await facing.locator('[data-direction="east"]').click();
  await expect.poll(() => footprint(page, "gate")).toEqual({ tile: [2, 0], size: [2, 1], facing: "east", placed: "true" });
  expect(await sourceText(page)).toContain("decider gate at (300, 80) tile (3, 0.5) facing east {");

  const name = inspector(page).getByLabel("Entity name");
  await name.fill("door");
  await name.press("Enter");
  await expect(card(page, "door").locator(".board-name")).toHaveText("door");
  await expect(card(page, "door")).toHaveClass(/selected/);
});

test("an entity without a tile stands at a derived place, marked as not placed, and nothing is written", async ({ page }) => {
  const source = await sourceText(page);
  expect(source).not.toContain("tile");
  await showDisplay(page, "blueprint");
  // The corners of the cards, one tile per 92 units: source (40, 80), gate (300, 80), twice (300, 240), light (560, 80).
  expect(await footprint(page, "source")).toEqual({ tile: [0, 1], size: [1, 1], facing: "east", placed: "false" });
  expect(await footprint(page, "gate")).toEqual({ tile: [3, 1], size: [2, 1], facing: "east", placed: "false" });
  expect(await footprint(page, "twice")).toEqual({ tile: [3, 3], size: [2, 1], facing: "east", placed: "false" });
  expect(await footprint(page, "light")).toEqual({ tile: [6, 1], size: [1, 1], facing: "east", placed: "false" });
  for (const name of await entityNames(page)) await expect(card(page, name)).toHaveClass(/unplaced/);
  expect(await card(page, "gate").locator(".card-body").evaluate((body) => getComputedStyle(body).strokeDasharray)).not.toBe("none");

  // Selecting, stepping and looking around write nothing.
  await selectOnBoard(page, "gate");
  await page.getByRole("button", { name: "Step" }).click();
  await page.getByRole("button", { name: "Fit circuit" }).click();
  expect(await sourceText(page)).toBe(source);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByTestId("save-state")).toHaveText("No changes");

  // A placed entity keeps its tile and a derived one gives way: the lamp takes the left tile of the gate, which moves up.
  await setSource(page, source.replace("lamp light at (560, 80)", "lamp light at (560, 80) tile (3.5, 1.5)"));
  await expect.poll(() => footprint(page, "light")).toEqual({ tile: [3, 1], size: [1, 1], facing: "east", placed: "true" });
  expect(await footprint(page, "gate")).toEqual({ tile: [3, 0], size: [2, 1], facing: "east", placed: "false" });
  await expect(card(page, "light")).not.toHaveClass(/unplaced|conflict/);
  expect(await card(page, "light").locator(".card-body").evaluate((body) => getComputedStyle(body).strokeDasharray)).toBe("none");

  // Two entities on one tile, and a tile that is off the grid: drawn where the tile says, marked as conflicts.
  await setSource(page, source.replace("lamp light at (560, 80)", "lamp light at (560, 80) tile (3.5, 1.5)").replace("constant source at (40, 80)", "constant source at (40, 80) tile (3.5, 1.5)").replace("arithmetic twice at (300, 240)", "arithmetic twice at (300, 240) tile (8.5, 4.5)"));
  await expect(card(page, "light")).toHaveAttribute("data-conflict", "true");
  await expect(card(page, "source")).toHaveClass(/conflict/);
  expect(await footprint(page, "source")).toMatchObject({ tile: [3, 1], placed: "true" });
  // (8.5, 4.5) is no center of a 2x1 entity facing east; the nearest footprint starts at tile (8, 4).
  expect(await footprint(page, "twice")).toEqual({ tile: [8, 4], size: [2, 1], facing: "east", placed: "true" });
  await expect(card(page, "twice")).toHaveClass(/conflict/);
  await expect(card(page, "gate")).not.toHaveAttribute("data-conflict");
});

test("wires are straight lines from pin to pin, a feedback wire bends around its entity, and a click selects a wire", async ({ page }) => {
  await openBoard(page);
  await expect(wires(page)).toHaveCount(5);
  const feed = await wireKeyOf(page, "red", "source.out", "gate.in");
  const down = await wireKeyOf(page, "green", "twice.out", "light.in");
  const loop = await wireKeyOf(page, "green", "gate.out", "gate.in");
  // From the red output pin of the constant on tile (0, 0) to the red input pin of the decider on tile (2, 0).
  await expect(wire(page, feed).locator("path.wire-core")).toHaveAttribute("d", "M 68 30 L 172 30");
  await expect(wire(page, feed)).toHaveAttribute("data-color", "red");
  // From the bottom of the arithmetic combinator on tiles (5, 0) and (5, 1) up to the lamp on tile (7, 0).
  await expect(wire(page, down).locator("path.wire-core")).toHaveAttribute("d", "M 430 148 L 572 50");
  for (const part of ["wire-hit", "wire-casing", "wire-core"]) await expect(wire(page, down).locator(`path.${part}`)).toHaveAttribute("d", "M 430 148 L 572 50");
  // Output to input of one entity: an arc that leaves the footprint on the side of the green pins and stays in sight.
  await expect(wire(page, loop).locator("path.wire-core")).toHaveAttribute("d", /^M (308 50 Q 240 114 172 50|172 50 Q 240 114 308 50)$/);
  const [arc, body] = [await wire(page, loop).locator("path.wire-core").boundingBox(), await card(page, "gate").locator(".card-body").boundingBox()];
  expect(arc!.y + arc!.height).toBeGreaterThan(body!.y + body!.height);
  await wirePoint(page, loop);

  // Selecting: a click, Shift for a second one, the inspector, Delete.
  const middle = await wirePoint(page, feed);
  await page.mouse.move(middle.x, middle.y);
  expect(await wire(page, feed).locator("path.wire-hit").evaluate((path) => getComputedStyle(path).stroke)).not.toBe("rgba(0, 0, 0, 0)");
  await page.mouse.click(middle.x, middle.y);
  await expect(wire(page, feed)).toHaveClass(/selected/);
  await expect(inspector(page).locator(".inspector-wire")).toHaveAttribute("data-wire", feed);
  await expect(bubble(page)).toHaveCount(0);
  const other = await wirePoint(page, down);
  await page.keyboard.down("Shift");
  await page.mouse.click(other.x, other.y);
  await page.keyboard.up("Shift");
  await expect(page.locator("g.wire.selected")).toHaveCount(2);
  // Selected wires are drawn last.
  expect(await wires(page).evaluateAll((all) => all.slice(-2).map((element) => element.getAttribute("data-wire")).sort())).toEqual([feed, down].sort());
  await page.keyboard.press("Delete");
  await expect(wires(page)).toHaveCount(3);
  expect(await sourceText(page)).not.toContain("wire red source.out <-> gate.in");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(wires(page)).toHaveCount(5);

  // A wire is on top wherever it is drawn: where it crosses an entity, a click and a right click take the wire, not the entity.
  const crossing = await wirePoint(page, down, 0.1);
  const under = (await card(page, "twice").locator(".card-body").boundingBox())!;
  expect(crossing.x > under.x && crossing.x < under.x + under.width && crossing.y > under.y && crossing.y < under.y + under.height).toBe(true);
  await page.mouse.click(crossing.x, crossing.y);
  await expect(wire(page, down)).toHaveClass(/selected/);
  await expect(page.locator("g.card.selected")).toHaveCount(0);
  await expect(inspector(page).locator(".inspector-wire")).toHaveAttribute("data-wire", down);
  await selectOnBoard(page, "twice");
  await page.mouse.click(crossing.x, crossing.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Delete/]);
  await expect(wire(page, down)).toHaveClass(/selected/);
  await expect(page.locator("g.card.selected")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("click, Shift-click and the marquee select on the board, and the context menu deletes and selects all", async ({ page }) => {
  await openBoard(page);
  await selectOnBoard(page, "source");
  await expect(page.locator("g.card.selected")).toHaveCount(1);
  expect(await card(page, "source").locator(".card-body").evaluate((body) => getComputedStyle(body).stroke)).toBe(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().replace(/^#(..)(..)(..)$/, (_all, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`)));
  const check = await boardGrabPoint(page, "check");
  await page.keyboard.down("Shift");
  await page.mouse.click(check.x, check.y);
  await expect(page.locator("g.card.selected")).toHaveCount(2);
  await page.mouse.click(check.x, check.y);
  await expect(page.locator("g.card.selected")).toHaveCount(1);
  await page.keyboard.up("Shift");

  // A click on a free tile clears the selection; a marquee over the tiles (5, 0) to (7, 1) takes what stands on them.
  const free = await tilePoint(page, 4, 3);
  await page.mouse.click(free.x, free.y);
  await expect(page.locator("g.card.selected")).toHaveCount(0);
  const [from, to] = [await tilePoint(page, 4, 1), await tilePoint(page, 8, -1)];
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await expect(page.locator("rect.marquee")).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(card(page, "twice")).toHaveClass(/selected/);
  await expect(card(page, "light")).toHaveClass(/selected/);
  await expect(page.locator("g.card.selected")).toHaveCount(2);
  await expect(page.locator(".status-selection")).toHaveText("twice, light");

  // The menu of the empty board: Select all and Fit work.
  await page.mouse.click(free.x, free.y, { button: "right" });
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Select all/ }));
  await expect(page.locator("g.card.selected")).toHaveCount(6);
  await page.getByRole("button", { name: "Zoom out" }).click();
  const zoomedOut = await zoom(page);
  await page.mouse.click((await tilePoint(page, 4, 3)).x, (await tilePoint(page, 4, 3)).y, { button: "right" });
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Fit to content/ }));
  await expect.poll(() => zoom(page)).toBeGreaterThan(zoomedOut);

  // The menu of an entity: Delete removes it with its wires, as one step.
  const pick = await boardGrabPoint(page, "pick");
  await page.mouse.click(pick.x, pick.y, { button: "right" });
  await expect(card(page, "pick")).toHaveClass(/selected/);
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Delete/ }));
  await expect(card(page, "pick")).toHaveCount(0);
  await expect(wires(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "pick")).toHaveCount(1);
  expect(await sourceText(page)).toBe(BOARD);
});

test("the entity under the pointer shows its card and its description in a bubble that keeps its size at any zoom", async ({ page }) => {
  await openBoard(page);
  // The three status rows of the card are live.
  await page.getByRole("button", { name: "Step" }).click({ clickCount: 3 });
  await expect(bubble(page)).toHaveCount(0);
  // Selecting shows none: the bubble belongs to the pointer, and a press hides it.
  await selectOnBoard(page, "gate");
  await expect(bubble(page)).toHaveCount(0);
  await page.waitForTimeout(400);
  await expect(bubble(page)).toHaveCount(0);

  await hoverOnBoard(page, "gate");
  await expect(bubble(page).locator(".card-kind")).toHaveText("DECIDER");
  await expect(bubble(page).locator(".card-name")).toHaveText("gate");
  await expect(bubble(page).locator(".card-summary")).toHaveText("A < 10 → A");
  await expect(bubble(page).locator(".card-note")).toHaveCount(1);
  await expect(bubble(page).locator(".bubble-description")).toHaveText("Counts up to ten.\nThe green wire feeds the output back.");
  await expect(bubble(page).locator(".bubble-pointer")).toBeVisible();
  await expect(bubble(page).locator("g.card-row")).toHaveCount(3);
  await expect(bubble(page).locator('g.card-row[data-row="out"] .row-value')).toHaveText(/\d/);
  // It is not a second card of the entity for the canvas, and it has no pins.
  await expect(card(page, "gate")).toHaveCount(1);
  await expect(bubble(page).locator("[data-terminal], [data-entity-id]")).toHaveCount(0);

  // Next to the entity, inside the canvas, and the pointer goes through it to the board.
  const inside = async (name: string): Promise<{ width: number; height: number }> => {
    const [box, view, entity] = [await bubble(page).boundingBox(), await canvasView(page), await card(page, name).locator(".card-body").boundingBox()];
    expect(box!.x).toBeGreaterThanOrEqual(view.box.x);
    expect(box!.y).toBeGreaterThanOrEqual(view.box.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(view.box.x + view.box.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(view.box.y + view.box.height);
    // Beside the entity, not on it.
    expect(box!.x >= entity!.x + entity!.width || box!.x + box!.width <= entity!.x || box!.y >= entity!.y + entity!.height || box!.y + box!.height <= entity!.y).toBe(true);
    return { width: box!.width, height: box!.height };
  };
  const size = await inside("gate");
  expect(size.width).toBe(184);
  const box = (await bubble(page).boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest(".entity-bubble") === null, [box.x + box.width / 2, box.y + 40])).toBe(true);
  expect(await bubble(page).evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");

  // It follows the pointer, whatever is selected: another entity gets its own at once, without a description.
  await hoverOnBoard(page, "light");
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await expect(bubble(page).locator(".bubble-description")).toHaveCount(0);
  await expect(bubble(page).locator(".card-note")).toHaveCount(0);
  await inside("light");
  // Over the empty board it goes away, and it comes back for the next entity only after the pointer has rested there.
  const empty = await tilePoint(page, 7, 3);
  await page.mouse.move(empty.x, empty.y, { steps: 2 });
  await expect(bubble(page)).toHaveCount(0);
  const twice = await boardGrabPoint(page, "twice");
  await page.mouse.move(twice.x, twice.y, { steps: 2 });
  await expect(bubble(page)).toHaveCount(0);
  await expect(bubble(page)).toHaveAttribute("data-entity-name", "twice");
  // Crossing entities without resting on one shows nothing.
  await page.mouse.move(empty.x, empty.y, { steps: 2 });
  await expect(bubble(page)).toHaveCount(0);
  for (const name of ["gate", "source", "light"]) {
    const point = await boardGrabPoint(page, name);
    await page.mouse.move(point.x, point.y, { steps: 2 });
  }
  await page.mouse.move(empty.x, empty.y, { steps: 2 });
  await page.waitForTimeout(400);
  await expect(bubble(page)).toHaveCount(0);

  // Far out the board is tiny; the bubble is as large as it was close up and still next to its entity.
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Zoom out" }).click();
  expect(await zoom(page)).toBeLessThan(0.4);
  await hoverOnBoard(page, "gate");
  expect(await inside("gate")).toEqual(size);
  await expect(card(page, "gate").locator(".board-name")).toHaveCount(0);
  await page.getByRole("button", { name: "Fit circuit" }).click();

  // Leaving the canvas takes it away; several selected entities do not matter to it.
  await hoverOnBoard(page, "light");
  await page.mouse.move(5, 300, { steps: 2 });
  await expect(bubble(page)).toHaveCount(0);
  const source = await boardGrabPoint(page, "source");
  await page.keyboard.down("Shift");
  await page.mouse.click(source.x, source.y);
  await page.keyboard.up("Shift");
  await expect(page.locator("g.card.selected")).toHaveCount(2);
  await hoverOnBoard(page, "light");
});

test("the bubble of the board is hidden during a drag and a marquee, with an open menu, with a wire or a place tool and on the edit canvas", async ({ page }) => {
  await openBoard(page);
  const shown = (name: string) => expect(bubble(page)).toHaveAttribute("data-entity-name", name);
  const hidden = async (): Promise<void> => {
    await expect(bubble(page)).toHaveCount(0);
    // Not just late: it stays away.
    await page.waitForTimeout(400);
    await expect(bubble(page)).toHaveCount(0);
  };

  // A press hides it at once; during the drag it stays away, also over another entity, and after the drop it needs the pointer to move.
  await hoverOnBoard(page, "light");
  await page.mouse.down();
  await expect(bubble(page)).toHaveCount(0);
  const over = await boardGrabPoint(page, "source");
  await page.mouse.move(over.x, over.y, { steps: 6 });
  await expect(page.locator(".canvas")).toHaveClass(/dragging/);
  await hidden();
  // The drop on a taken tile is refused, so nothing has changed.
  await page.mouse.up();
  await hidden();
  expect(await sourceText(page)).toBe(BOARD);
  await page.mouse.move(over.x + 3, over.y - 3, { steps: 2 });
  await shown("source");

  // A marquee and a pan: the same.
  const empty = await tilePoint(page, 7, 3);
  await page.mouse.move(empty.x, empty.y, { steps: 2 });
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(over.x, over.y, { steps: 6 });
  await expect(page.locator("rect.marquee")).toHaveCount(1);
  await hidden();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.mouse.move(over.x + 3, over.y - 3, { steps: 2 });
  await shown("source");

  // The context menu of the entity under the pointer takes its place.
  await page.mouse.click(over.x, over.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(bubble(page)).toHaveCount(0);
  await page.mouse.move(over.x + 2, over.y - 2);
  await hidden();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await page.mouse.move(over.x + 4, over.y - 4);
  await shown("source");

  // With a wire tool it would cover the pins, with a place tool the tiles: none, and it returns with the select tool.
  await page.keyboard.press("Alt+KeyR");
  await expect(page.locator(".canvas")).toHaveClass(/tool-wire/);
  await expect(bubble(page)).toHaveCount(0);
  const gate = await boardGrabPoint(page, "gate");
  await page.mouse.move(gate.x, gate.y, { steps: 2 });
  await hidden();
  await page.keyboard.press("3");
  await expect(page.locator(".canvas")).toHaveClass(/tool-place/);
  await page.mouse.move(over.x, over.y, { steps: 2 });
  await hidden();
  await page.keyboard.press("q");
  await page.mouse.move(gate.x, gate.y, { steps: 2 });
  await shown("gate");

  // The edit canvas has the cards themselves.
  await page.keyboard.press("b");
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "edit");
  await expect(bubble(page)).toHaveCount(0);
  const cardPoint = await cardGrabPoint(page, "gate");
  await page.mouse.move(cardPoint.x, cardPoint.y, { steps: 2 });
  await hidden();
});

test("paste and duplicate on the board give copies without a tile, selected, as one undo step each", async ({ page }) => {
  await openBoard(page);
  const undo = page.getByRole("button", { name: "Undo" });
  const unplaced = async (name: string): Promise<void> => {
    await expect(card(page, name)).toHaveClass(/selected/);
    await expect(card(page, name)).toHaveClass(/unplaced/);
    await expect(card(page, name)).toHaveAttribute("data-placed", "false");
  };
  const at = async (name: string) => page.evaluate((wanted) => window.faceSession!.getState().circuit.entities.find((entity) => entity.name === wanted)?.position, name);

  // Duplicate: the copy stands where an entity without a tile stands, 40 units on in the edit layout, and is the selection.
  await selectOnBoard(page, "pick");
  await page.keyboard.press("ControlOrMeta+d");
  await unplaced("pick2");
  await expect(page.locator("g.card.selected")).toHaveCount(1);
  const copy = "    selector pick2 at (600, 300) facing west {\n        operation = select\n        order = min\n        index = virtual:signal-I\n    }\n\n";
  expect(await sourceText(page)).toBe(BOARD.replace("    wire red source.out", `${copy}    wire red source.out`));
  expect(await footprint(page, "pick")).toMatchObject({ tile: [2, 2], placed: "true" });
  await expect(placeAll(page)).toHaveText("Place all1");
  await expect(page.locator(".canvas-hint")).toContainText("Dashed ones have no tile yet");
  await undo.click();
  expect(await sourceText(page)).toBe(BOARD);

  // The menu of an entity: all of it is on.
  const grab = await boardGrabPoint(page, "gate");
  await page.mouse.click(grab.x, grab.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Cut/, /Copy/, /Paste/, /Rotate clockwise/, /Rotate counter-clockwise/, /Flip horizontal/, /Flip vertical/, /^Unplace$/, /Delete/]);
  for (const item of await menu(page).getByRole("menuitem").all()) await expect(item).toBeEnabled();
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Copy/ }));
  await expect(menu(page)).toHaveCount(0);

  // Paste by key, with the pointer far from the gate: the copy goes where it was copied from, not to the pointer, whose
  // place on the board is no edit position. The feedback wire comes along.
  const far = await tilePoint(page, 7, 3);
  await page.mouse.move(far.x, far.y);
  await page.keyboard.press("ControlOrMeta+v");
  await unplaced("gate2");
  expect(await at("gate2")).toEqual({ x: 340, y: 120 });
  await expect(wires(page)).toHaveCount(6);
  expect(await sourceText(page)).toContain("decider gate2 at (340, 120) {");
  // Paste by the menu of the empty board: the next copy, one step further on.
  await page.mouse.click(far.x, far.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: /Paste/ })).toBeEnabled();
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Paste/ }));
  await unplaced("gate3");
  expect(await at("gate3")).toEqual({ x: 380, y: 160 });
  await expect(page.locator("g.card.selected")).toHaveCount(1);
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  // A copy is made at home on the board like any entity without a tile.
  await placeAll(page).click();
  await expect(page.locator("g.card.unplaced")).toHaveCount(0);
  for (let step = 0; step < 3; step++) await undo.click();
  expect(await sourceText(page)).toBe(BOARD);

  // Cut is a copy and a deletion, and what was cut comes back without its tile.
  await selectOnBoard(page, "pick");
  await page.keyboard.press("ControlOrMeta+x");
  await expect(card(page, "pick")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+v");
  await unplaced("pick");
  expect(await sourceText(page)).toContain("selector pick at (560, 260) facing west {");

  // On the edit canvas a paste goes to the pointer, as before.
  await showDisplay(page, "edit");
  await canvas(page).focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("g.card")).toHaveCount(7);
  expect(await sourceText(page)).toMatch(/selector pick2 at \(-?\d+, -?\d+\) facing west \{/);
});

test("each display mode has its own camera: the board is fitted when it is first shown, and both views are kept", async ({ page }) => {
  await setSource(page, BOARD);
  const viewBox = async () => ((await canvas(page).getAttribute("viewBox")) ?? "").split(" ").map(Number);
  const near = (actual: number[], expected: number[]): void => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 3));

  // A view of the edit canvas that is not the fit.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const edit = await viewBox();
  const editZoom = await zoom(page);

  // The board has nothing to do with it: all of it is in view.
  await showDisplay(page, "blueprint");
  const board = await viewBox();
  expect(board).not.toEqual(edit);
  const view = await canvasView(page);
  for (const name of await entityNames(page)) {
    const box = (await card(page, name).locator(".card-body").boundingBox())!;
    expect(box.x, name).toBeGreaterThan(view.box.x);
    expect(box.y, name).toBeGreaterThan(view.box.y);
    expect(box.x + box.width, name).toBeLessThan(view.box.x + view.box.width);
    expect(box.y + box.height, name).toBeLessThan(view.box.y + view.box.height);
  }
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom out" }).click();
  const far = await viewBox();
  const farZoom = await zoom(page);
  expect(farZoom).toBeLessThan(editZoom);

  await page.keyboard.press("b");
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "edit");
  near(await viewBox(), edit);
  expect(await zoom(page)).toBeCloseTo(editZoom, 6);
  await showDisplay(page, "blueprint");
  near(await viewBox(), far);

  // Both views survive the canvas being taken away in Source mode, and so does the mode.
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(canvas(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Circuit", exact: true }).click();
  await expect(page.locator(".canvas")).toHaveAttribute("data-display", "blueprint");
  near(await viewBox(), far);
  expect(await zoom(page)).toBeCloseTo(farZoom, 6);
  await showDisplay(page, "edit");
  near(await viewBox(), edit);
});
