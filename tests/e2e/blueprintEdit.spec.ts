// Editing on the blueprint board: dragging on tiles, the arrow keys, rotating and its refusal, snapping to the grid and back, placing new
// entities (turned with R before the click), wiring, and repairing a conflict. Nothing of it touches the edit positions (`at`).
import type { Page } from "@playwright/test";
import { boardGrabPoint, canvas, canvasView, card, clickCenter, committedPositions, entityNames, expect, pin, showDisplay, sourceText, test, wire, wireKeyOf, wires } from "./app.ts";
import { BOARD, bubble, committedTiles, dragOnBoard, footprint, inspector, menu, openBoardProject as openBoard, selectOnBoard, TILE, tilePoint, tool } from "./board.ts";

/** The board with two entities that have no tile: `pick` is shown on (5, 3) and (6, 3), `light` on (8, 1). */
const LOOSE = BOARD.replace("selector pick at (560, 260) tile (3, 2.5) facing west", "selector pick at (500, 300)").replace("lamp light at (560, 80) tile (7.5, 0.5)", "lamp light at (700, 80)");

const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const redo = (page: Page) => page.getByRole("button", { name: "Redo" });
const toast = (page: Page) => page.locator(".toast");
const snapAll = (page: Page) => page.getByRole("button", { name: /^Snap all/ });
const tileOf = async (page: Page, name: string) => (await footprint(page, name)).tile;

async function shiftClick(page: Page, name: string): Promise<void> {
  const point = await boardGrabPoint(page, name);
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Shift");
  await expect(card(page, name)).toHaveClass(/selected/);
}

async function openMenuOn(page: Page, name: string): Promise<void> {
  const point = await boardGrabPoint(page, name);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
}

test("a drag moves an entity by whole tiles: the preview snaps, the drop writes the tile as one undo step", async ({ page }) => {
  await openBoard(page);
  const positions = await committedPositions(page);
  const feed = await wireKeyOf(page, "red", "source.out", "gate.in");
  await selectOnBoard(page, "gate");
  await expect(bubble(page)).toHaveCount(1);
  const grab = await boardGrabPoint(page, "gate");
  const tile = TILE * (await canvasView(page)).zoom;

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // Less than half a tile: the preview is still on its own tiles.
  await page.mouse.move(grab.x + 0.2 * tile, grab.y + 0.4 * tile, { steps: 4 });
  await expect(card(page, "gate")).toHaveClass(/moving/);
  expect(await tileOf(page, "gate")).toEqual([2, 0]);
  await expect(page.locator(".canvas")).toHaveClass(/dragging/);
  await expect(bubble(page)).toHaveCount(0);
  // More than half a tile down: one tile, and the wires follow the pins.
  await page.mouse.move(grab.x + 0.3 * tile, grab.y + 0.7 * tile, { steps: 4 });
  await expect.poll(() => tileOf(page, "gate")).toEqual([2, 1]);
  await expect(wire(page, feed).locator("path.wire-core")).toHaveAttribute("d", "M 68 30 L 172 110");
  await expect(card(page, "gate")).not.toHaveClass(/blocked|conflict/);
  expect(await sourceText(page)).toBe(BOARD);
  await page.mouse.move(grab.x + 1.1 * tile, grab.y + 0.9 * tile, { steps: 4 });
  await expect.poll(() => tileOf(page, "gate")).toEqual([3, 1]);
  await page.mouse.up();

  // The drop: two numbers in the source, nothing else.
  const moved = BOARD.replace("tile (3, 0.5)", "tile (4, 1.5)");
  await expect.poll(() => sourceText(page)).toBe(moved);
  expect(await footprint(page, "gate")).toEqual({ tile: [3, 1], size: [2, 1], facing: "east", placed: "true" });
  await expect(card(page, "gate")).toHaveClass(/selected/);
  await expect(card(page, "gate")).not.toHaveClass(/moving/);
  await expect(bubble(page)).toHaveAttribute("data-entity-name", "gate");
  expect(await committedPositions(page)).toEqual(positions);

  await undo(page).click();
  expect(await sourceText(page)).toBe(BOARD);
  await expect(undo(page)).toBeDisabled();
  await expect.poll(() => tileOf(page, "gate")).toEqual([2, 0]);
  await redo(page).click();
  expect(await sourceText(page)).toBe(moved);
  await expect(redo(page)).toBeDisabled();

  // A drag that ends on the tiles it started from writes nothing.
  await dragOnBoard(page, "gate", { x: 0.3, y: -0.3 });
  expect(await sourceText(page)).toBe(moved);
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
});

test("a group moves as one, also onto tiles one of its members leaves", async ({ page }) => {
  await openBoard(page);
  const positions = await committedPositions(page);
  await selectOnBoard(page, "gate");
  await shiftClick(page, "pick");
  // The gate goes to (3, 2) and (4, 2), where the right half of the selector was; the selector two rows down.
  await dragOnBoard(page, "gate", { x: 1, y: 2 }, async () => {
    await expect(page.locator("g.card.moving")).toHaveCount(2);
    await expect.poll(() => tileOf(page, "gate")).toEqual([3, 2]);
    expect(await tileOf(page, "pick")).toEqual([3, 4]);
    await expect(page.locator("g.card.blocked")).toHaveCount(0);
  });
  const moved = BOARD.replace("tile (3, 0.5)", "tile (4, 2.5)").replace("tile (3, 2.5)", "tile (4, 4.5)");
  await expect.poll(() => sourceText(page)).toBe(moved);
  await expect(page.locator("g.card.selected")).toHaveCount(2);
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  expect(await committedPositions(page)).toEqual(positions);

  // One step for both.
  await undo(page).click();
  expect(await sourceText(page)).toBe(BOARD);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  expect(await committedTiles(page)).toMatchObject({ gate: [4, 2.5], pick: [4, 4.5], source: [0.5, 0.5] });
});

test("a drop on a taken tile changes nothing, and the preview shows the conflict", async ({ page }) => {
  await openBoard(page);
  // Two tiles to the right the gate would stand on the upper tile of the arithmetic combinator.
  await dragOnBoard(page, "gate", { x: 2, y: 0 }, async () => {
    await expect(card(page, "gate")).toHaveClass(/blocked/);
    await expect(card(page, "gate")).toHaveAttribute("data-blocked", "true");
    expect(await tileOf(page, "gate")).toEqual([4, 0]);
    await expect(card(page, "twice")).toHaveClass(/conflict/);
    await expect(card(page, "twice")).not.toHaveClass(/blocked/);
    await expect(card(page, "source")).not.toHaveClass(/conflict/);
    // Red, not the orange of a selection.
    expect(await card(page, "gate").locator(".card-body").evaluate((body) => getComputedStyle(body).stroke)).toBe(await card(page, "twice").locator(".card-body").evaluate((body) => getComputedStyle(body).stroke));
  });
  await expect.poll(() => tileOf(page, "gate")).toEqual([2, 0]);
  await expect(page.locator("g.card.blocked, g.card.conflict, g.card.moving")).toHaveCount(0);
  expect(await sourceText(page)).toBe(BOARD);
  await expect(undo(page)).toBeDisabled();
  await expect(toast(page)).toHaveCount(0);

  // A group is blocked as a whole: the constant alone would be free on (2, 0).
  await shiftClick(page, "source");
  await dragOnBoard(page, "gate", { x: 2, y: 0 }, async () => {
    await expect(card(page, "gate")).toHaveClass(/blocked/);
    await expect(card(page, "source")).toHaveClass(/moving/);
    await expect(card(page, "source")).not.toHaveClass(/blocked/);
  });
  expect(await sourceText(page)).toBe(BOARD);
  await expect(undo(page)).toBeDisabled();
});

test("the arrow keys move the selection by one tile, with Shift by five, and stop at a taken tile", async ({ page }) => {
  await openBoard(page);
  const positions = await committedPositions(page);
  await selectOnBoard(page, "source");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => tileOf(page, "source")).toEqual([1, 0]);
  expect(await sourceText(page)).toBe(BOARD.replace("tile (0.5, 0.5)", "tile (1.5, 0.5)"));
  // The next tile is the gate's.
  await page.keyboard.press("ArrowRight");
  expect(await committedTiles(page)).toMatchObject({ source: [1.5, 0.5] });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => tileOf(page, "source")).toEqual([0, 1]);
  // Five to the right is the lower tile of the arithmetic combinator on (5, 1); five up is free.
  await page.keyboard.press("Shift+ArrowRight");
  expect(await committedTiles(page)).toMatchObject({ source: [0.5, 1.5] });
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => committedTiles(page)).toMatchObject({ source: [0.5, -3.5] });
  expect(await sourceText(page)).toBe(BOARD.replace("tile (0.5, 0.5)", "tile (0.5, -3.5)"));
  await expect(toast(page)).toHaveCount(0);
  expect(await committedPositions(page)).toEqual(positions);

  // Every press that moved is one step: right, left, down, up.
  for (let step = 0; step < 4; step++) await undo(page).click();
  expect(await sourceText(page)).toBe(BOARD);
  await expect(undo(page)).toBeDisabled();

  // A selection moves together.
  await selectOnBoard(page, "gate");
  await shiftClick(page, "pick");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => committedTiles(page)).toMatchObject({ gate: [2, 0.5], pick: [2, 2.5] });
  // The gate is against the constant now: the whole selection stays.
  await page.keyboard.press("ArrowLeft");
  expect(await committedTiles(page)).toMatchObject({ gate: [2, 0.5], pick: [2, 2.5] });
});

test("R, Shift+R, the context menu and the Facing control turn a 2x1 entity on the board through all four directions", async ({ page }) => {
  await openBoard(page);
  const positions = await committedPositions(page);
  await selectOnBoard(page, "gate");
  const lying = (facing: string) => ({ tile: [2, 0], size: [2, 1], facing, placed: "true" });
  const upright = (facing: string) => ({ tile: [2, 0], size: [1, 2], facing, placed: "true" });
  const declared = async () => /decider gate at \(300, 80\) (.*) \{/.exec(await sourceText(page))?.[1];

  // The top-left tile stays: lying on (2, 0) and (3, 0), upright on (2, 0) and (2, 1).
  await page.keyboard.press("r");
  await expect.poll(() => footprint(page, "gate")).toEqual(upright("south"));
  expect(await declared()).toBe("tile (2.5, 1) facing south");
  await page.keyboard.press("r");
  await expect.poll(() => footprint(page, "gate")).toEqual(lying("west"));
  expect(await declared()).toBe("tile (3, 0.5) facing west");
  await page.keyboard.press("r");
  await expect.poll(() => footprint(page, "gate")).toEqual(upright("north"));
  expect(await declared()).toBe("tile (2.5, 1) facing north");
  await page.keyboard.press("r");
  await expect.poll(() => footprint(page, "gate")).toEqual(lying("east"));
  expect(await declared()).toBe("tile (3, 0.5) facing east");
  await page.keyboard.press("Shift+KeyR");
  await expect.poll(() => footprint(page, "gate")).toEqual(upright("north"));

  await openMenuOn(page, "gate");
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Rotate clockwise/ }));
  await expect.poll(() => footprint(page, "gate")).toEqual(lying("east"));
  await openMenuOn(page, "gate");
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Rotate counter-clockwise/ }));
  await expect.poll(() => footprint(page, "gate")).toEqual(upright("north"));
  await inspector(page).getByRole("group", { name: "Facing" }).locator('[data-direction="west"]').click();
  await expect.poll(() => footprint(page, "gate")).toEqual(lying("west"));
  expect(await declared()).toBe("tile (3, 0.5) facing west");
  await expect(toast(page)).toHaveCount(0);
  expect(await committedPositions(page)).toEqual(positions);

  // Eight turns, eight steps.
  for (let step = 0; step < 8; step++) await undo(page).click();
  expect(await sourceText(page)).toBe(BOARD);
  await expect(undo(page)).toBeDisabled();
});

test("a turn onto a tile of another entity is refused for the whole selection, with a message", async ({ page }) => {
  // The lamp stands on (2, 1), below the left tile of the gate.
  const tight = BOARD.replace("tile (7.5, 0.5)", "tile (2.5, 1.5)");
  await openBoard(page, tight);
  await selectOnBoard(page, "gate");
  const refused = async (): Promise<void> => {
    await expect(toast(page)).toHaveText("Not rotated: gate would stand on a tile of light.");
    expect(await sourceText(page)).toBe(tight);
    await toast(page).getByRole("button", { name: "Dismiss message" }).click();
    await expect(toast(page)).toHaveCount(0);
  };
  await page.keyboard.press("r");
  await refused();
  await canvas(page).focus();
  await page.keyboard.press("Shift+KeyR");
  await refused();
  await openMenuOn(page, "gate");
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Rotate clockwise/ }));
  await refused();
  await inspector(page).getByRole("group", { name: "Facing" }).locator('[data-direction="south"]').click();
  await refused();

  // With others selected, none of them turns.
  await shiftClick(page, "source");
  await shiftClick(page, "pick");
  await page.keyboard.press("r");
  await refused();
  await expect(undo(page)).toBeDisabled();
  expect(await footprint(page, "gate")).toEqual({ tile: [2, 0], size: [2, 1], facing: "east", placed: "true" });

  // A half turn keeps the two tiles, and with the lamp off the grid the quarter turn works.
  await selectOnBoard(page, "gate");
  await inspector(page).getByRole("group", { name: "Facing" }).locator('[data-direction="west"]').click();
  await expect.poll(() => footprint(page, "gate")).toEqual({ tile: [2, 0], size: [2, 1], facing: "west", placed: "true" });
  await expect(toast(page)).toHaveCount(0);
  await openMenuOn(page, "light");
  await clickCenter(page, menu(page).getByRole("menuitem", { name: "Release from tile grid" }));
  await expect(card(page, "light")).toHaveAttribute("data-placed", "false");
  await selectOnBoard(page, "gate");
  await page.keyboard.press("r");
  await expect.poll(() => footprint(page, "gate")).toEqual({ tile: [2, 0], size: [1, 2], facing: "north", placed: "true" });
  await expect(toast(page)).toHaveCount(0);
  // The lamp, which has no tile, made room.
  expect(await tileOf(page, "light")).not.toEqual([2, 1]);
});

test("the message about a refused turn goes with the next turn or move that works, and with another selection", async ({ page }) => {
  // The lamp stands on (2, 1), below the left tile of the gate.
  const tight = BOARD.replace("tile (7.5, 0.5)", "tile (2.5, 1.5)");
  await openBoard(page, tight);
  const refuse = async (): Promise<void> => {
    await selectOnBoard(page, "gate");
    await page.keyboard.press("r");
    await expect(toast(page)).toHaveText("Not rotated: gate would stand on a tile of light.");
  };

  // What changes neither the circuit nor the selection leaves it: a menu, a tool, a drop on a taken tile.
  await refuse();
  await openMenuOn(page, "gate");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+KeyR");
  await page.keyboard.press("Escape");
  await dragOnBoard(page, "gate", { x: 2, y: 0 });
  expect(await sourceText(page)).toBe(tight);
  await expect(toast(page)).toHaveCount(1);

  // A turn that works: the half turn keeps both tiles.
  await inspector(page).getByRole("group", { name: "Facing" }).locator('[data-direction="west"]').click();
  await expect.poll(() => footprint(page, "gate")).toMatchObject({ tile: [2, 0], facing: "west" });
  await expect(toast(page)).toHaveCount(0);
  // A move that works, by key and by drag, and taking a step back.
  await refuse();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => tileOf(page, "gate")).toEqual([2, -1]);
  await expect(toast(page)).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await refuse();
  await dragOnBoard(page, "source", { x: 0, y: 1 });
  await expect.poll(() => tileOf(page, "source")).toEqual([0, 1]);
  await expect(toast(page)).toHaveCount(0);
  await refuse();
  await undo(page).click();
  await expect(toast(page)).toHaveCount(0);

  // Another selection, or none: the message was about the turn of that one.
  await refuse();
  await shiftClick(page, "pick");
  await expect(toast(page)).toHaveCount(0);
  await refuse();
  const free = await tilePoint(page, 4, 3);
  await page.mouse.click(free.x, free.y);
  await expect(page.locator("g.card.selected")).toHaveCount(0);
  await expect(toast(page)).toHaveCount(0);
});

test("entities without a tile are snapped with the button, the menu or a drag, released again, and never in the way", async ({ page }) => {
  await openBoard(page, LOOSE);
  const positions = await committedPositions(page);
  await expect(snapAll(page)).toHaveText("Snap all2");
  await expect(snapAll(page)).toHaveAttribute("title", "Give the 2 entities without a tile the tile of the place they are shown at");
  expect(await tileOf(page, "pick")).toEqual([5, 3]);
  expect(await tileOf(page, "light")).toEqual([8, 1]);
  await expect(page.locator(".canvas-hint")).toContainText("Dashed ones have no tile yet");

  // The inspector says where the selected entity stands.
  await selectOnBoard(page, "light");
  await expect(inspector(page).locator(".inspector-footer")).toHaveText("Not placed on a tile");
  await selectOnBoard(page, "gate");
  await expect(inspector(page).locator(".inspector-footer")).toHaveText("Tile X 3 Y 0.5");

  // The menu of an entity without a tile snaps it; then it can be released again.
  await openMenuOn(page, "pick");
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Cut/, /Copy/, /Paste/, /Rotate clockwise/, /Rotate counter-clockwise/, /Snap to tile grid/, /Delete/]);
  await clickCenter(page, menu(page).getByRole("menuitem", { name: "Snap to tile grid" }));
  const snapped = LOOSE.replace("selector pick at (500, 300)", "selector pick at (500, 300) tile (6, 3.5)");
  await expect.poll(() => sourceText(page)).toBe(snapped);
  expect(await footprint(page, "pick")).toEqual({ tile: [5, 3], size: [2, 1], facing: "east", placed: "true" });
  await expect(card(page, "pick")).not.toHaveClass(/unplaced/);
  await expect(snapAll(page)).toHaveText("Snap all1");
  await expect(snapAll(page)).toHaveAttribute("title", "Give the entity without a tile the tile of the place it is shown at");
  await expect(inspector(page).locator(".inspector-footer")).toHaveText("Tile X 6 Y 3.5");
  await openMenuOn(page, "pick");
  await expect(menu(page).getByRole("menuitem", { name: /tile grid/ })).toHaveText(["Release from tile grid"]);
  await clickCenter(page, menu(page).getByRole("menuitem", { name: "Release from tile grid" }));
  await expect.poll(() => sourceText(page)).toBe(LOOSE);
  await expect(card(page, "pick")).toHaveClass(/unplaced/);
  await expect(snapAll(page)).toHaveText("Snap all2");

  // A selection of both sorts: each item says how many it takes.
  await selectOnBoard(page, "gate");
  await shiftClick(page, "pick");
  await shiftClick(page, "light");
  await openMenuOn(page, "pick");
  await expect(menu(page).getByRole("menuitem", { name: /tile grid/ })).toHaveText(["Snap 2 to tile grid", "Release 1 from tile grid"]);
  await clickCenter(page, menu(page).getByRole("menuitem", { name: "Release 1 from tile grid" }));
  await expect.poll(() => committedTiles(page)).toMatchObject({ gate: null, pick: null, light: null });
  await expect(snapAll(page)).toHaveText("Snap all3");
  await openMenuOn(page, "pick");
  await expect(menu(page).getByRole("menuitem", { name: /tile grid/ })).toHaveText(["Snap to tile grid"]);
  await page.keyboard.press("Escape");
  for (let step = 0; step < 3; step++) await undo(page).click();
  expect(await sourceText(page)).toBe(LOOSE);
  await expect(undo(page)).toBeDisabled();

  // The button takes all of them, as one step, and goes away with nothing left to do.
  await snapAll(page).click();
  const all = snapped.replace("lamp light at (700, 80)", "lamp light at (700, 80) tile (8.5, 1.5)");
  await expect.poll(() => sourceText(page)).toBe(all);
  await expect(snapAll(page)).toHaveCount(0);
  await expect(page.locator("g.card.unplaced")).toHaveCount(0);
  await expect(page.locator(".canvas-hint")).not.toContainText("Dashed");
  await undo(page).click();
  expect(await sourceText(page)).toBe(LOOSE);
  await expect(undo(page)).toBeDisabled();
  await expect(snapAll(page)).toHaveText("Snap all2");

  // A drag gives an entity without a tile one.
  await selectOnBoard(page, "light");
  await expect(page.locator("g.card.selected")).toHaveCount(1);
  await dragOnBoard(page, "light", { x: 0, y: 1 }, async () => {
    await expect(card(page, "light")).toHaveClass(/moving/);
    await expect(card(page, "light")).toHaveClass(/unplaced/);
  });
  await expect.poll(() => sourceText(page)).toBe(LOOSE.replace("lamp light at (700, 80)", "lamp light at (700, 80) tile (8.5, 2.5)"));
  await expect(card(page, "light")).not.toHaveClass(/unplaced/);
  await expect(snapAll(page)).toHaveText("Snap all1");

  // An entity without a tile is no obstacle: the gate is dropped where the selector is shown, and that one gives way.
  await dragOnBoard(page, "gate", { x: 3, y: 3 }, async () => {
    await expect.poll(() => tileOf(page, "gate")).toEqual([5, 3]);
    await expect(card(page, "gate")).not.toHaveClass(/blocked|conflict/);
    expect(await tileOf(page, "pick")).not.toEqual([5, 3]);
  });
  await expect.poll(() => committedTiles(page)).toMatchObject({ gate: [6, 3.5], pick: null });
  await expect(card(page, "pick")).toHaveClass(/unplaced/);
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  expect(await committedPositions(page)).toEqual(positions);

  // On the edit canvas there is nothing to snap.
  await showDisplay(page, "edit");
  await expect(snapAll(page)).toHaveCount(0);
  await expect(inspector(page).locator(".inspector-footer")).toHaveText("X 300 Y 80");
});

test("the palette places each kind on the tile under the pointer, and refuses a taken tile", async ({ page }) => {
  await openBoard(page);
  const positions = await committedPositions(page);
  const ghost = page.locator("rect.board-ghost");
  for (const item of await page.locator(".palette-item").all()) await expect(item).toBeEnabled();

  // A 1x1 entity goes to the tile under the pointer, a 2x1 entity lies around it: the pointer is where its two tiles meet.
  const places = [
    { kind: "constant", key: "1", click: [1, 4], tile: [1, 4], size: [1, 1], declared: "constant constant1 at (100, 360) tile (1.5, 4.5) {" },
    { kind: "arithmetic", key: "2", click: [2.5, 4], tile: [2, 4], size: [2, 1], declared: "arithmetic arithmetic1 at (180, 360) tile (3, 4.5) {" },
    { kind: "decider", key: "3", click: [6.5, 2], tile: [6, 2], size: [2, 1], declared: "decider decider1 at (560, 180) tile (7, 2.5) {" },
    { kind: "selector", key: "4", click: [6.5, 3], tile: [6, 3], size: [2, 1], declared: "selector selector1 at (560, 280) tile (7, 3.5) {" },
    { kind: "lamp", key: "5", click: [4, 1], tile: [4, 1], size: [1, 1], declared: "lamp lamp1 at (360, 100) tile (4.5, 1.5) {" },
  ] as const;
  for (const [index, place] of places.entries()) {
    const name = `${place.kind}1`;
    // By the button for the first, by its key for the others.
    if (index === 0) await page.locator(`.palette-item[data-kind="${place.kind}"]`).click();
    else await page.keyboard.press(place.key);
    await expect(page.locator(`.palette-item[data-kind="${place.kind}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".canvas-hint")).toContainText("Click a free tile");
    const point = await tilePoint(page, place.click[0], place.click[1]);
    await page.mouse.move(point.x, point.y, { steps: 3 });
    await expect(ghost).toHaveAttribute("data-tile-x", String(place.tile[0]));
    await expect(ghost).toHaveAttribute("data-tile-y", String(place.tile[1]));
    await expect(ghost).not.toHaveClass(/blocked/);
    await page.mouse.click(point.x, point.y);
    await expect(card(page, name)).toHaveClass(/selected/);
    expect(await footprint(page, name), name).toEqual({ tile: place.tile, size: place.size, facing: "east", placed: "true" });
    expect(await sourceText(page)).toContain(place.declared);
    await expect(tool(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
    await expect(ghost).toHaveCount(0);
  }
  await expect(page.locator("g.card.conflict, g.card.unplaced")).toHaveCount(0);
  expect(await committedPositions(page)).toMatchObject(positions);
  // Each one is a step of its own.
  await undo(page).click();
  await expect(card(page, "lamp1")).toHaveCount(0);
  await expect(card(page, "selector1")).toHaveCount(1);

  // On a taken tile the footprint under the pointer says no, and the click does nothing.
  const before = await sourceText(page);
  await page.keyboard.press("3");
  const taken = await tilePoint(page, 4.5, 0);
  await page.mouse.move(taken.x, taken.y, { steps: 3 });
  await expect(ghost).toHaveAttribute("data-tile-x", "4");
  await expect(ghost).toHaveClass(/blocked/);
  await page.mouse.click(taken.x, taken.y);
  await page.mouse.click(taken.x, taken.y);
  expect(await sourceText(page)).toBe(before);
  await expect(page.locator('.palette-item[data-kind="decider"]')).toHaveAttribute("aria-pressed", "true");
  await expect(toast(page)).toHaveCount(0);
  // A row down and a tile to the left it is free.
  const free = await tilePoint(page, 3.5, 1);
  await page.mouse.move(free.x, free.y, { steps: 3 });
  await expect(ghost).not.toHaveClass(/blocked/);
  await page.mouse.click(free.x, free.y);
  await expect(card(page, "decider2")).toHaveClass(/selected/);
  expect(await tileOf(page, "decider2")).toEqual([3, 1]);

  // Enter on the board: the free place nearest to the middle of the view, a different one each time.
  const count = (await entityNames(page)).length;
  for (const name of ["lamp1", "lamp2"]) {
    await page.keyboard.press("5");
    await canvas(page).focus();
    await page.keyboard.press("Enter");
    await expect(card(page, name)).toHaveClass(/selected/);
    await expect(card(page, name)).toHaveAttribute("data-placed", "true");
  }
  expect(await entityNames(page)).toHaveLength(count + 2);
  expect(await tileOf(page, "lamp1")).not.toEqual(await tileOf(page, "lamp2"));
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  const view = await canvasView(page);
  const middle = { x: view.box.x + view.box.width / 2, y: view.box.y + view.box.height / 2 };
  const lamp = (await card(page, "lamp1").locator(".card-body").boundingBox())!;
  // Within two tiles of the middle of the view.
  expect(Math.hypot(lamp.x + lamp.width / 2 - middle.x, lamp.y + lamp.height / 2 - middle.y)).toBeLessThan(2.5 * TILE * view.zoom);
  expect(await committedPositions(page)).toMatchObject(positions);
});

test("R and Shift+R turn what a place tool is about to place: the outline, the free-tile test and the entity", async ({ page }) => {
  await openBoard(page);
  const ghost = page.locator("rect.board-ghost");
  const arrow = page.locator("path.board-ghost-arrow");
  const hint = page.locator(".canvas-hint");
  const block = (kind: string) => page.locator(`.palette-item[data-kind="${kind}"]`);
  /** The outline: its top-left tile, its size in tiles and the direction it says. */
  const outline = async () =>
    ghost.evaluate((rect, tile) => {
      const [x, y, width, height] = ["data-tile-x", "data-tile-y", "width", "height"].map((name) => Number(rect.getAttribute(name)));
      return { tile: [x, y], size: [(width! + 8) / tile, (height! + 8) / tile], facing: rect.getAttribute("data-facing") };
    }, TILE);
  // With a place tool the keys are not for the selection: the gate here, later what was placed last.
  await selectOnBoard(page, "gate");

  // A quarter of a tile right of and below the middle of tile (6, 2): lying, the footprint takes (6, 2) and (7, 2), upright (6, 2) and (6, 3).
  await page.keyboard.press("3");
  await expect(hint).toHaveText("Click a free tile (or press Enter on the board) to place a decider facing east (R turns it). Esc cancels.");
  const spot = await tilePoint(page, 6.25, 2.25);
  await page.mouse.move(spot.x, spot.y, { steps: 3 });
  await expect.poll(outline).toEqual({ tile: [6, 2], size: [2, 1], facing: "east" });
  await expect(arrow).toHaveCount(1);
  await page.keyboard.press("r");
  await expect.poll(outline).toEqual({ tile: [6, 2], size: [1, 2], facing: "south" });
  await expect(hint).toContainText("facing south");
  await page.keyboard.press("Shift+KeyR");
  await page.keyboard.press("Shift+KeyR");
  await expect.poll(outline).toEqual({ tile: [6, 2], size: [1, 2], facing: "north" });
  await expect(ghost).not.toHaveClass(/blocked/);
  expect(await sourceText(page)).toBe(BOARD);
  await page.mouse.click(spot.x, spot.y);
  await expect(card(page, "decider1")).toHaveClass(/selected/);
  expect(await footprint(page, "decider1")).toEqual({ tile: [6, 2], size: [1, 2], facing: "north", placed: "true" });
  expect(await sourceText(page)).toContain("decider decider1 at (560, 180) tile (6.5, 3) facing north {");
  await expect(tool(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  await undo(page).click();
  expect(await sourceText(page)).toBe(BOARD);

  // The free-tile test is the one of the turned footprint: around (0.25, 1.1) a lying decider is free on (0, 1) and (1, 1), an
  // upright one would stand on (0, 2), which is taken. The tool picked again faces east.
  await page.keyboard.press("3");
  const tight = await tilePoint(page, 0.25, 1.125);
  await page.mouse.move(tight.x, tight.y, { steps: 3 });
  await expect.poll(outline).toEqual({ tile: [0, 1], size: [2, 1], facing: "east" });
  await expect(ghost).not.toHaveClass(/blocked/);
  await page.keyboard.press("r");
  await expect.poll(outline).toEqual({ tile: [0, 1], size: [1, 2], facing: "south" });
  await expect(ghost).toHaveClass(/blocked/);
  await expect(arrow).toHaveClass(/blocked/);
  // The refused click keeps the tool and its direction.
  await page.mouse.click(tight.x, tight.y);
  expect(await sourceText(page)).toBe(BOARD);
  await expect(block("decider")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(outline).toMatchObject({ facing: "south" });
  await expect(toast(page)).toHaveCount(0);
  // Its key again: east. Another tool and back: east as well.
  await page.keyboard.press("3");
  await expect.poll(outline).toEqual({ tile: [0, 1], size: [2, 1], facing: "east" });
  await page.keyboard.press("r");
  await page.keyboard.press("2");
  await expect.poll(outline).toMatchObject({ facing: "east" });
  await page.keyboard.press("3");
  await expect.poll(outline).toMatchObject({ facing: "east" });
  await page.keyboard.press("Shift+KeyR");
  await page.keyboard.press("Shift+KeyR");
  await expect.poll(outline).toEqual({ tile: [0, 1], size: [2, 1], facing: "west" });
  await page.mouse.click(tight.x, tight.y);
  await expect(card(page, "decider1")).toHaveClass(/selected/);
  expect(await footprint(page, "decider1")).toEqual({ tile: [0, 1], size: [2, 1], facing: "west", placed: "true" });
  expect(await sourceText(page)).toContain("decider decider1 at (0, 100) tile (1, 1.5) facing west {");

  // A constant turns on its one tile; a lamp does not turn, and its outline has no arrow.
  await page.keyboard.press("1");
  const one = await tilePoint(page, 1, 4);
  await page.mouse.move(one.x, one.y, { steps: 3 });
  await page.keyboard.press("r");
  await expect.poll(outline).toEqual({ tile: [1, 4], size: [1, 1], facing: "south" });
  await page.mouse.click(one.x, one.y);
  await expect(card(page, "constant1")).toHaveAttribute("data-facing", "south");
  expect(await sourceText(page)).toContain("constant constant1 at (100, 360) tile (1.5, 4.5) facing south {");
  await page.keyboard.press("5");
  await expect(hint).toHaveText("Click a free tile (or press Enter on the board) to place a lamp. Esc cancels.");
  await page.mouse.move(one.x + 1, one.y + 1);
  await page.keyboard.press("r");
  await page.keyboard.press("Shift+KeyR");
  await expect.poll(outline).toMatchObject({ size: [1, 1], facing: "east" });
  await expect(arrow).toHaveCount(0);
  await expect(block("lamp")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "constant1")).toHaveClass(/selected/);
  await expect(card(page, "constant1")).toHaveAttribute("data-facing", "south");

  // Enter places with the direction of the tool too.
  await page.keyboard.press("2");
  await page.keyboard.press("r");
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "arithmetic1")).toHaveClass(/selected/);
  expect(await footprint(page, "arithmetic1")).toMatchObject({ size: [1, 2], facing: "south", placed: "true" });
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  // Nothing of it turned the gate.
  expect(await footprint(page, "gate")).toEqual({ tile: [2, 0], size: [2, 1], facing: "east", placed: "true" });
});

test("the wire tools connect pins on the board with a straight line, and take a wire away again", async ({ page }) => {
  await openBoard(page);
  const positions = await committedPositions(page);
  await expect(tool(page, "Red wire")).toBeEnabled();
  await expect(tool(page, "Green wire")).toBeEnabled();
  await tool(page, "Red wire").click();
  await expect(page.locator(".canvas")).toHaveClass(/tool-wire wire-red/);
  await expect(page.locator(".canvas-hint")).toContainText("Click a red pin");

  // From the output of the constant to the input of the decider that faces north: its input pins are at the bottom.
  await clickCenter(page, pin(page, "source", "out", "red"));
  await expect(pin(page, "source", "out", "red")).toHaveClass(/pending/);
  const target = (await pin(page, "check", "in", "red").boundingBox())!;
  await page.mouse.move(target.x - 40, target.y - 30, { steps: 3 });
  // The pending wire: a straight line from the pin to the pointer.
  await expect(page.locator("path.wire-preview.red")).toHaveAttribute("d", /^M 68 30 L -?[\d.]+ -?[\d.]+$/);
  // A pin of the other color does not take it.
  await clickCenter(page, pin(page, "check", "in", "green"));
  await expect(wires(page)).toHaveCount(5);
  await expect(pin(page, "source", "out", "red")).toHaveClass(/pending/);
  await clickCenter(page, pin(page, "check", "in", "red"));
  await expect(wires(page)).toHaveCount(6);
  expect(await sourceText(page)).toContain("wire red source.out <-> check.in");
  const added = await wireKeyOf(page, "red", "source.out", "check.in");
  await expect(wire(page, added).locator("path.wire-core")).toHaveAttribute("d", /^M (68 30 L 30 308|30 308 L 68 30)$/);
  await expect(page.locator("path.wire-preview")).toHaveCount(0);
  // The tool stays for the next wire; the same two pins again take the wire away.
  await expect(tool(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await clickCenter(page, pin(page, "check", "in", "red"));
  await clickCenter(page, pin(page, "source", "out", "red"));
  await expect(wires(page)).toHaveCount(5);
  await undo(page).click();
  await expect(wires(page)).toHaveCount(6);

  // Green, by its key; Escape drops the pending wire, then the tool.
  await canvas(page).focus();
  await page.keyboard.press("Alt+KeyG");
  await expect(tool(page, "Green wire")).toHaveAttribute("aria-pressed", "true");
  await clickCenter(page, pin(page, "check", "out", "green"));
  await clickCenter(page, pin(page, "light", "in", "green"));
  await expect(wires(page)).toHaveCount(7);
  expect(await sourceText(page)).toContain("wire green check.out <-> light.in");
  await clickCenter(page, pin(page, "pick", "out", "green"));
  await expect(page.locator(".pin.pending")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".pin.pending")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(tool(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  expect(await committedTiles(page)).toMatchObject({ source: [0.5, 0.5], check: [0.5, 3] });
  expect(await committedPositions(page)).toEqual(positions);
});

test("a conflict of the source is repaired by dragging, and does not block the entities that are not part of it", async ({ page }) => {
  // The lamp on the tile of the constant, and the gate half a tile off the grid: it is drawn on (3, 0) and (4, 0).
  const broken = BOARD.replace("tile (7.5, 0.5)", "tile (0.5, 0.5)").replace("tile (3, 0.5)", "tile (3.5, 0.5)");
  await openBoard(page, broken);
  const positions = await committedPositions(page);
  const conflicts = page.locator("g.card.conflict");
  await expect(conflicts).toHaveCount(3);
  await expect(page.locator(".status-warnings")).toHaveText("3 warnings");
  expect(await tileOf(page, "gate")).toEqual([3, 0]);

  // Another entity moves as if nothing was wrong.
  await dragOnBoard(page, "check", { x: 1, y: 0 });
  await expect.poll(() => committedTiles(page)).toMatchObject({ check: [1.5, 3] });
  await expect(conflicts).toHaveCount(3);

  // The gate comes onto the grid by being dragged.
  await dragOnBoard(page, "gate", { x: 0, y: 1 }, async () => {
    await expect(card(page, "gate")).not.toHaveClass(/blocked|conflict/);
  });
  await expect.poll(() => committedTiles(page)).toMatchObject({ gate: [4, 1.5] });
  await expect(card(page, "gate")).not.toHaveClass(/conflict/);
  await expect(conflicts).toHaveCount(2);

  // The lamp lies on top of the constant; dragged off, both are fine. Back onto it is a blocked move.
  await dragOnBoard(page, "light", { x: 1, y: 1 });
  await expect.poll(() => committedTiles(page)).toMatchObject({ light: [1.5, 1.5], source: [0.5, 0.5] });
  await expect(conflicts).toHaveCount(0);
  await expect(page.locator(".status-warnings")).toHaveCount(0);
  await dragOnBoard(page, "light", { x: -1, y: -1 }, async () => {
    await expect(card(page, "light")).toHaveClass(/blocked/);
  });
  expect(await committedTiles(page)).toMatchObject({ light: [1.5, 1.5] });
  expect(await sourceText(page)).toBe(broken.replace("tile (0.5, 3)", "tile (1.5, 3)").replace("tile (3.5, 0.5)", "tile (4, 1.5)").replace("lamp light at (560, 80) tile (0.5, 0.5)", "lamp light at (560, 80) tile (1.5, 1.5)"));
  expect(await committedPositions(page)).toEqual(positions);
});
