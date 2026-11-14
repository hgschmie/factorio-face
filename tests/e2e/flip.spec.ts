// Flipping: H and V and the two items of the context menu mirror the selection as a group, as the game flips a blueprint. One
// entity turns in place, a group swaps sides on the edit canvas and on the tiles of the board, and a place tool is mirrored like
// it is turned. Off where nothing selected can turn and there is nothing to swap.
import type { Page } from "@playwright/test";
import { boardGrabPoint, canvas, card, cardGrabPoint, clickCenter, committedPositions, expect, selectEntity, showDisplay, sourceText, test, wires } from "./app.ts";
import { BOARD, committedTiles, footprint, inspector, menu, openBoardProject, selectOnBoard, setSource, tilePoint } from "./board.ts";
import { FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const toast = (page: Page) => page.locator(".toast");
const hint = (page: Page) => page.locator(".canvas-hint");
const flipItem = (page: Page, axis: "horizontal" | "vertical") => menu(page).getByRole("menuitem", { name: `Flip ${axis}` });
const facings = (page: Page) => page.locator("g.card").evaluateAll((cards) => Object.fromEntries(cards.map((element) => [element.getAttribute("data-entity-name"), element.getAttribute("data-facing")])));

/** The five-kinds source with a `facing` clause behind the position of the named entities. */
function facing(directions: Readonly<Record<string, string>>, source = FIVE_KINDS_SOURCE): string {
  return Object.entries(directions).reduce((text, [name, direction]) => text.replace(new RegExp(`( ${name} at \\([-\\d]+, [-\\d]+\\))( facing \\w+)?`), `$1 facing ${direction}`), source);
}

async function shiftClick(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Shift");
}

test("H turns the selected entity from east to west and back, V from north to south; the other key leaves it alone", async ({ page }) => {
  await openFiveKinds(page);
  await selectEntity(page, "gate");
  const at = await committedPositions(page);
  await page.keyboard.press("h");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "west");
  await expect.poll(() => sourceText(page)).toBe(facing({ gate: "west" }));
  // In place: the card stays, its pins change sides, the wires follow.
  expect(await committedPositions(page)).toEqual(at);
  await expect(card(page, "gate").locator('[data-terminal="out"][data-wire-color="red"]')).toHaveAttribute("data-edge", "left");
  await expect(wires(page)).toHaveCount(7);
  // V does nothing to an entity that faces west: no change, no undo step.
  await page.keyboard.press("v");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "west");
  await page.keyboard.press("h");
  await expect.poll(() => sourceText(page)).toBe(facing({ gate: "east" }));
  await undo(page).click();
  await undo(page).click();
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();

  // Facing north, V is the key that turns it.
  await page.keyboard.press("Shift+KeyR");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "north");
  await page.keyboard.press("h");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "north");
  await page.keyboard.press("v");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "south");
  await expect.poll(() => sourceText(page)).toBe(facing({ gate: "south" }));

  // With Shift or in a text field the keys are letters, and while the source has errors they do nothing.
  await page.keyboard.press("Shift+KeyH");
  await page.keyboard.press("Shift+KeyV");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "south");
  const name = inspector(page).getByLabel("Entity name");
  await name.focus();
  await page.keyboard.press("End");
  await name.pressSequentially("hv");
  await expect(name).toHaveValue("gatehv");
  await name.press("Escape");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "south");
  await setSource(page, facing({ gate: "south" }).replace("< 10", "<"));
  await canvas(page).focus();
  await page.keyboard.press("v");
  expect(await sourceText(page)).toBe(facing({ gate: "south" }).replace("< 10", "<"));
});

test("the context menu has Flip horizontal and Flip vertical with their keys, greyed out for what cannot be flipped", async ({ page }) => {
  await openFiveKinds(page);
  const twice = await cardGrabPoint(page, "twice");
  await page.mouse.click(twice.x, twice.y, { button: "right" });
  // Next to the rotations.
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Cut/, /Copy/, /Paste/, /Rotate clockwise/, /Rotate counter-clockwise/, /Flip horizontal/, /Flip vertical/, /Delete/]);
  await expect(flipItem(page, "horizontal").locator("kbd")).toHaveText("H");
  await expect(flipItem(page, "vertical").locator("kbd")).toHaveText("V");
  await expect(flipItem(page, "horizontal")).toBeEnabled();
  await expect(flipItem(page, "vertical")).toBeEnabled();
  await clickCenter(page, flipItem(page, "horizontal"));
  await expect(menu(page)).toHaveCount(0);
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "west");
  // The focus is back on the canvas, so the key carries on from there.
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.press("h");
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "east");
  await undo(page).click();
  await undo(page).click();

  // A single lamp does not turn and has nothing to swap sides with: both items are off, and the keys do nothing.
  const light = await cardGrabPoint(page, "light");
  await page.mouse.click(light.x, light.y, { button: "right" });
  await expect(flipItem(page, "horizontal")).toBeDisabled();
  await expect(flipItem(page, "vertical")).toBeDisabled();
  await expect(menu(page).getByRole("menuitem", { name: /Copy/ })).toBeEnabled();
  await page.keyboard.press("Escape");
  await canvas(page).focus();
  await page.keyboard.press("h");
  await page.keyboard.press("v");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();

  // With a second entity selected there is something to mirror, also when that is all the flip does to the lamp.
  await shiftClick(page, await cardGrabPoint(page, "pick"));
  await page.mouse.click(light.x, light.y, { button: "right" });
  await expect(flipItem(page, "horizontal")).toBeEnabled();
  await expect(flipItem(page, "vertical")).toBeEnabled();
  await clickCenter(page, flipItem(page, "vertical"));
  // light (560, 80) and pick (560, 260) swap rows; pick faces east and stays so.
  expect(await committedPositions(page)).toMatchObject({ light: { x: 560, y: 260 }, pick: { x: 560, y: 80 } });
  expect(await facings(page)).toMatchObject({ light: "east", pick: "east" });
  // While the source has errors the items are off.
  await setSource(page, (await sourceText(page)).replace("< 10", "<"));
  const pick = await cardGrabPoint(page, "pick");
  await page.mouse.click(pick.x, pick.y, { button: "right" });
  await expect(flipItem(page, "horizontal")).toBeDisabled();
  await expect(flipItem(page, "vertical")).toBeDisabled();
});

test("several selected cards are mirrored as a group on the edit canvas, as one undo step", async ({ page }) => {
  await openFiveKinds(page);
  // The top row: source (40), gate (300) and light (560).
  await selectEntity(page, "source");
  await shiftClick(page, await cardGrabPoint(page, "gate"));
  await shiftClick(page, await cardGrabPoint(page, "light"));
  await expect(page.locator("g.card.selected")).toHaveCount(3);
  await page.keyboard.press("h");
  await expect.poll(() => committedPositions(page)).toEqual({ source: { x: 560, y: 80 }, gate: { x: 300, y: 80 }, twice: { x: 300, y: 260 }, pick: { x: 560, y: 260 }, light: { x: 40, y: 80 } });
  // Each one that can turn is flipped; the lamp cannot.
  expect(await facings(page)).toEqual({ source: "west", gate: "west", twice: "east", pick: "east", light: "east" });
  expect(await sourceText(page)).toBe(
    FIVE_KINDS_SOURCE.replace("source at (40, 80)", "source at (560, 80) facing west").replace("gate at (300, 80)", "gate at (300, 80) facing west").replace("light at (560, 80)", "light at (40, 80)"),
  );
  // The cards are drawn where the source says, the selection and the wires stay.
  await expect(card(page, "source")).toHaveAttribute("data-x", "560");
  await expect(card(page, "light")).toHaveAttribute("data-x", "40");
  await expect(page.locator("g.card.selected")).toHaveCount(3);
  await expect(wires(page)).toHaveCount(7);
  await undo(page).click();
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();

  // All five, top to bottom: the rows 80 and 260 swap, and nothing turns, because all face east.
  await canvas(page).focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("g.card.selected")).toHaveCount(5);
  await page.keyboard.press("v");
  await expect.poll(() => committedPositions(page)).toEqual({ source: { x: 40, y: 260 }, gate: { x: 300, y: 260 }, twice: { x: 300, y: 80 }, pick: { x: 560, y: 80 }, light: { x: 560, y: 260 } });
  expect(await sourceText(page)).not.toContain("facing");
  // Twice the same flip is where it began.
  await page.keyboard.press("v");
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(toast(page)).toHaveCount(0);
});

test("on the board a group is mirrored on its tiles, every footprint on the grid, as one undo step", async ({ page }) => {
  await openBoardProject(page);
  const positions = await committedPositions(page);
  const original = { source: [0.5, 0.5], gate: [3, 0.5], twice: [5.5, 1], pick: [3, 2.5], check: [0.5, 3], light: [7.5, 0.5] };
  expect(await committedTiles(page)).toEqual(original);

  // One entity keeps its tiles and swaps its ends.
  await selectOnBoard(page, "gate");
  await page.keyboard.press("h");
  await expect.poll(() => footprint(page, "gate")).toEqual({ tile: [2, 0], size: [2, 1], facing: "west", placed: "true" });
  await expect.poll(() => sourceText(page)).toBe(BOARD.replace("tile (3, 0.5)", "tile (3, 0.5) facing west"));
  await undo(page).click();

  // All six: the columns 0 to 7 are mirrored. A lying combinator swaps its ends, an upright one keeps its direction.
  await canvas(page).focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("g.card.selected")).toHaveCount(6);
  await page.keyboard.press("h");
  await expect.poll(() => committedTiles(page)).toEqual({ source: [7.5, 0.5], gate: [5, 0.5], twice: [2.5, 1], pick: [5, 2.5], check: [7.5, 3], light: [0.5, 0.5] });
  expect(await facings(page)).toEqual({ source: "west", gate: "west", twice: "south", pick: "east", check: "north", light: "east" });
  expect(await footprint(page, "gate")).toEqual({ tile: [4, 0], size: [2, 1], facing: "west", placed: "true" });
  expect(await footprint(page, "twice")).toEqual({ tile: [2, 0], size: [1, 2], facing: "south", placed: "true" });
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  expect(await page.evaluate(() => window.faceSession!.getState().diagnostics.filter((diagnostic) => diagnostic.code.startsWith("tile")))).toEqual([]);
  // The edit positions are not the board's business, and the selection and the wires stay.
  expect(await committedPositions(page)).toEqual(positions);
  await expect(page.locator("g.card.selected")).toHaveCount(6);
  await expect(wires(page)).toHaveCount(5);
  await undo(page).click();
  expect(await sourceText(page)).toBe(BOARD);
  await expect(undo(page)).toBeDisabled();

  // Top to bottom: the rows 0 to 3.
  await page.keyboard.press("v");
  await expect.poll(() => committedTiles(page)).toEqual({ source: [0.5, 3.5], gate: [3, 3.5], twice: [5.5, 3], pick: [3, 1.5], check: [0.5, 1], light: [7.5, 3.5] });
  expect(await facings(page)).toEqual({ source: "east", gate: "east", twice: "north", pick: "west", check: "south", light: "east" });
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  await undo(page).click();
  expect(await sourceText(page)).toBe(BOARD);
});

test("a flip onto a tile of an entity outside the selection is refused on the board, and an entity without a tile is only turned", async ({ page }) => {
  await openBoardProject(page);
  // source on (0, 0) and pick on (2..3, 2): mirrored in the columns 0 to 3, source would stand on (3, 0), a tile of gate.
  await selectOnBoard(page, "source");
  await shiftClick(page, await boardGrabPoint(page, "pick"));
  await expect(page.locator("g.card.selected")).toHaveCount(2);
  await page.keyboard.press("h");
  await expect(toast(page)).toHaveText("Not flipped: source would stand on a tile of gate.");
  expect(await sourceText(page)).toBe(BOARD);
  await expect(undo(page)).toBeDisabled();
  // The menu item reports the same; the message goes when other entities are selected.
  const pick = await boardGrabPoint(page, "pick");
  await page.mouse.click(pick.x, pick.y, { button: "right" });
  await expect(flipItem(page, "horizontal")).toBeEnabled();
  await clickCenter(page, flipItem(page, "horizontal"));
  await expect(toast(page)).toHaveText("Not flipped: source would stand on a tile of gate.");
  expect(await sourceText(page)).toBe(BOARD);
  await selectOnBoard(page, "light");
  await expect(toast(page)).toHaveCount(0);
  // A lamp alone: nothing to flip on the board either.
  const light = await boardGrabPoint(page, "light");
  await page.mouse.click(light.x, light.y, { button: "right" });
  await expect(flipItem(page, "horizontal")).toBeDisabled();
  await expect(flipItem(page, "vertical")).toBeDisabled();
  await page.keyboard.press("Escape");
  // The other way the same two entities are in the way of check: mirrored in the rows 0 to 2, source would stand on (0, 2).
  await selectOnBoard(page, "source");
  await shiftClick(page, pick);
  await page.keyboard.press("v");
  await expect(toast(page)).toHaveText("Not flipped: source would stand on a tile of check.");
  expect(await sourceText(page)).toBe(BOARD);
  // source and light swap the ends of the top row over gate, which stands between them and is not in their way.
  await selectOnBoard(page, "source");
  await expect(toast(page)).toHaveCount(0);
  await shiftClick(page, light);
  await page.keyboard.press("h");
  await expect.poll(() => committedTiles(page)).toMatchObject({ source: [7.5, 0.5], gate: [3, 0.5], light: [0.5, 0.5] });
  await expect(toast(page)).toHaveCount(0);
  await undo(page).click();
  expect(await sourceText(page)).toBe(BOARD);

  // check has no tile now: flipped with source and light it is turned, gets no tile, and does not count for the bounds.
  await page.evaluate(() => {
    const { getState, commands } = window.faceSession!;
    commands.unplace(getState().circuit.entities.filter((entity) => entity.name === "check").map((entity) => entity.id));
  });
  await expect(card(page, "check")).toHaveAttribute("data-placed", "false");
  const unplaced = await sourceText(page);
  await selectOnBoard(page, "source");
  await shiftClick(page, await boardGrabPoint(page, "light"));
  await shiftClick(page, await boardGrabPoint(page, "check"));
  await expect(page.locator("g.card.selected")).toHaveCount(3);
  await page.keyboard.press("v");
  await expect(card(page, "check")).toHaveAttribute("data-facing", "south");
  // One row of tiles: source and light stay where they are.
  await expect.poll(() => committedTiles(page)).toEqual({ source: [0.5, 0.5], gate: [3, 0.5], twice: [5.5, 1], pick: [3, 2.5], check: null, light: [7.5, 0.5] });
  expect(await sourceText(page)).toBe(unplaced.replace("facing north", "facing south"));
  await expect(card(page, "check")).toHaveAttribute("data-placed", "false");
  await page.keyboard.press("h");
  await expect.poll(() => committedTiles(page)).toMatchObject({ source: [7.5, 0.5], light: [0.5, 0.5], check: null });
  await expect(card(page, "check")).toHaveAttribute("data-facing", "south");
  await expect(toast(page)).toHaveCount(0);
});

test("with a place tool H and V flip what is about to be placed, as R turns it", async ({ page }) => {
  await openFiveKinds(page);
  await selectEntity(page, "gate");
  await page.keyboard.press("3");
  await expect(hint(page)).toContainText("to place a decider facing east");
  await page.keyboard.press("h");
  await expect(hint(page)).toContainText("to place a decider facing west");
  expect(await page.evaluate(() => window.faceSession!.getState().tool)).toEqual({ type: "place", kind: "decider", facing: "west" });
  await page.keyboard.press("v");
  await expect(hint(page)).toContainText("facing west");
  await page.keyboard.press("r");
  await expect(hint(page)).toContainText("facing north");
  await page.keyboard.press("h");
  await expect(hint(page)).toContainText("facing north");
  await page.keyboard.press("v");
  await expect(hint(page)).toContainText("facing south");
  // The selection is not what the keys act on now.
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "east");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "decider1")).toHaveAttribute("data-facing", "south");
  expect(await sourceText(page)).toMatch(/decider decider1 at \(-?\d+, -?\d+\) facing south \{/);

  // A lamp in hand has no direction: the keys do nothing, and they do not reach the selection either.
  await page.keyboard.press("5");
  await page.keyboard.press("h");
  await page.keyboard.press("v");
  expect(await page.evaluate(() => window.faceSession!.getState().tool)).toEqual({ type: "place", kind: "lamp" });
  await expect(card(page, "decider1")).toHaveAttribute("data-facing", "south");
  await page.keyboard.press("Escape");

  // On the board the outline is flipped, and the entity is placed that way.
  await showDisplay(page, "blueprint");
  await page.keyboard.press("2");
  const free = await tilePoint(page, 1, 2);
  await page.mouse.move(free.x, free.y, { steps: 3 });
  const ghost = page.locator("rect.board-ghost");
  await expect(ghost).toHaveAttribute("data-facing", "east");
  await page.keyboard.press("h");
  await expect(ghost).toHaveAttribute("data-facing", "west");
  await expect(page.locator("path.board-ghost-arrow")).toHaveCount(1);
  await page.keyboard.press("v");
  await expect(ghost).toHaveAttribute("data-facing", "west");
  await page.mouse.click(free.x, free.y);
  await expect(card(page, "arithmetic1")).toHaveAttribute("data-facing", "west");
  await expect(card(page, "arithmetic1")).toHaveAttribute("data-placed", "true");
  expect(await sourceText(page)).toMatch(/arithmetic arithmetic1 at \(-?\d+, -?\d+\) tile \(-?[\d.]+, -?[\d.]+\) facing west \{/);
});

test("the shortcut overview lists the two flips with their keys", async ({ page }) => {
  await page.keyboard.press("?");
  const overview = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(overview.locator('[data-shortcut="edit.flipHorizontal"] dt')).toHaveText("Flip horizontal");
  await expect(overview.locator('[data-shortcut="edit.flipHorizontal"] kbd')).toHaveText(["H"]);
  await expect(overview.locator('[data-shortcut="edit.flipVertical"] dt')).toHaveText("Flip vertical");
  await expect(overview.locator('[data-shortcut="edit.flipVertical"] kbd')).toHaveText(["V"]);
  // They follow the rotations.
  const ids = await overview.locator("[data-shortcut]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-shortcut")));
  expect(ids.slice(ids.indexOf("edit.rotate"), ids.indexOf("edit.rotate") + 4)).toEqual(["edit.rotate", "edit.rotateBack", "edit.flipHorizontal", "edit.flipVertical"]);
});
