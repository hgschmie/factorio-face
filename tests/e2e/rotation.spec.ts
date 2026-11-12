// Rotating entities: R and Shift+R, the context menu, the Facing control of the inspector and the source. The card stays as it
// is; the pins move to the edges the direction gives them and the wires follow.
import type { Page } from "@playwright/test";
import { canvas, card, cardGrabPoint, clickCenter, clientPointOf, entityPosition, expect, openProject, pin, readProjectEntries, selectEntity, sourceText, test, wire, wires, writeProject, type Point } from "./app.ts";
import { FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

test.beforeEach(async ({ page }) => {
  await openFiveKinds(page);
});

type Direction = "north" | "east" | "south" | "west";

/** Offsets of the pins from the top-left corner of a card, per direction: output red, output green, input red, input green. */
const PINS: Readonly<Record<Direction, readonly (readonly [number, number])[]>> = {
  east: [[184, 60], [184, 80], [0, 60], [0, 80]],
  south: [[100, 128], [80, 128], [100, 0], [80, 0]],
  west: [[0, 80], [0, 60], [184, 80], [184, 60]],
  north: [[80, 0], [100, 0], [80, 128], [100, 128]],
};
const TERMINALS = [["out", "red"], ["out", "green"], ["in", "red"], ["in", "green"]] as const;

const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
const facing = (page: Page) => inspector(page).getByRole("group", { name: "Facing" });
const menu = (page: Page) => page.getByRole("menu", { name: "Canvas actions" });
const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const redo = (page: Page) => page.getByRole("button", { name: "Redo" });
const tool = (page: Page, name: string) => page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name });

/** The source of the fixture with a `facing` clause behind the position of the named entities. */
function facingSource(facings: Readonly<Record<string, Direction>>): string {
  return Object.entries(facings).reduce((source, [name, direction]) => source.replace(new RegExp(`( ${name} at \\([-\\d]+, [-\\d]+\\))`), `$1 facing ${direction}`), FIVE_KINDS_SOURCE);
}

/** Where the pins of a card are drawn, in canvas units relative to its top-left corner; absent terminals are left out. */
async function pinOffsets(page: Page, name: string): Promise<Record<string, [number, number]>> {
  return card(page, name)
    .locator("g.pin")
    .evaluateAll((pins) => Object.fromEntries(pins.map((element) => [`${element.getAttribute("data-terminal")} ${element.getAttribute("data-wire-color")}`, [Number(element.querySelector(".pin-dot")!.getAttribute("cx")), Number(element.querySelector(".pin-dot")!.getAttribute("cy"))]])));
}

function expectedPins(direction: Direction, sides: readonly string[] = ["out", "in"]): Record<string, readonly [number, number]> {
  return Object.fromEntries(TERMINALS.map(([side, color], index) => [`${side} ${color}`, PINS[direction][index]!] as const).filter(([key]) => sides.includes(key.split(" ")[0]!)));
}

/** First and last point of a wire, in canvas units. */
async function wireEnds(page: Page, key: string): Promise<Point[]> {
  const numbers = ((await wire(page, key).locator("path.wire-core").getAttribute("d")) ?? "").match(/-?\d+(\.\d+)?/g)!.map(Number);
  return [{ x: numbers[0]!, y: numbers[1]! }, { x: numbers.at(-2)!, y: numbers.at(-1)! }];
}

async function pinWorld(page: Page, name: string, side: "in" | "out", color: "red" | "green"): Promise<Point> {
  const [position, offsets] = [await entityPosition(page, name), await pinOffsets(page, name)];
  const [x, y] = offsets[`${side} ${color}`]!;
  return { x: position.x + x, y: position.y + y };
}

test("R turns the selected entity clockwise and Shift+R back, the card stays and the pins move around it", async ({ page }) => {
  await selectEntity(page, "gate");
  const nameBox = await card(page, "gate").locator(".card-name").boundingBox();
  await expect.poll(() => pinOffsets(page, "gate")).toEqual(expectedPins("east"));
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "east");

  for (const direction of ["south", "west", "north"] as const) {
    await page.keyboard.press("r");
    await expect(card(page, "gate")).toHaveAttribute("data-facing", direction);
    await expect.poll(() => pinOffsets(page, "gate")).toEqual(expectedPins(direction));
    await expect.poll(() => sourceText(page)).toBe(facingSource({ gate: direction }));
  }
  // The text of the card is where it was: only the pins turned.
  expect(await card(page, "gate").locator(".card-name").boundingBox()).toEqual(nameBox);
  await expect(card(page, "gate").locator(".card-name")).toHaveText("gate");
  await expect(inspector(page).locator(".inspector-footer")).toContainText("X 300 Y 80");

  // The fourth turn arrives at east again and says so in the source.
  await page.keyboard.press("r");
  await expect.poll(() => sourceText(page)).toBe(facingSource({ gate: "east" }));
  await expect.poll(() => pinOffsets(page, "gate")).toEqual(expectedPins("east"));

  // Shift+R goes the other way round.
  await page.keyboard.press("Shift+KeyR");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "north");
  await page.keyboard.press("Shift+KeyR");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "west");
  await expect.poll(() => sourceText(page)).toBe(facingSource({ gate: "west" }));
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
});

test("a constant and a lamp turn the one terminal they have", async ({ page }) => {
  await selectEntity(page, "source");
  await page.keyboard.press("r");
  await expect.poll(() => pinOffsets(page, "source")).toEqual(expectedPins("south", ["out"]));
  await selectEntity(page, "light");
  await page.keyboard.press("Shift+KeyR");
  await expect.poll(() => pinOffsets(page, "light")).toEqual(expectedPins("north", ["in"]));
  await expect(pin(page, "light", "in", "red")).toHaveAttribute("data-edge", "bottom");
  await expect(pin(page, "light", "in", "red").locator("title")).toHaveText("Red input");
  await expect.poll(() => sourceText(page)).toBe(facingSource({ source: "south", light: "north" }));
});

test("wires stay attached and are routed again, as horizontal and vertical lines between the pins of their color", async ({ page }) => {
  const feedback = await wire(page, "green|e2.in|e2.out").locator("path.wire-core").getAttribute("d");
  await selectEntity(page, "gate");
  await page.keyboard.press("r");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "south");
  await expect(wires(page)).toHaveCount(7);

  // source.out (right edge) into gate.in, now on the top edge: both ends in the pin centers.
  for (const color of ["red", "green"] as const) {
    const expected = [await pinWorld(page, "source", "out", color), await pinWorld(page, "gate", "in", color)];
    await expect.poll(() => wireEnds(page, `${color}|e1.out|e2.in`)).toEqual(expected);
    expect(expected[1]!.y).toBe(80);
  }
  // gate.out, now on the bottom edge, into the input of twice, which still faces east and has it on the left edge.
  await expect.poll(() => wireEnds(page, "red|e2.out|e3.in")).toEqual([await pinWorld(page, "gate", "out", "red"), await pinWorld(page, "twice", "in", "red")]);
  // The feedback loop turned with the entity.
  await expect.poll(() => wire(page, "green|e2.in|e2.out").locator("path.wire-core").getAttribute("d")).not.toBe(feedback);
  await expect.poll(() => wireEnds(page, "green|e2.in|e2.out")).toEqual([await pinWorld(page, "gate", "out", "green"), await pinWorld(page, "gate", "in", "green")]);

  // Every wire is still made of straight runs and rounded corners, and none of them touches the inside of the turned card.
  const paths = await page.locator("g.wire path.wire-core").evaluateAll((elements) => elements.map((path) => path.getAttribute("d") ?? ""));
  for (const path of paths) expect(path).toMatch(/^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+)* L [-\d.]+ [-\d.]+$/);
  const inside = await page.evaluate(() => {
    const gate = { x: 300, y: 80, width: 184, height: 128 };
    return [...document.querySelectorAll<SVGPathElement>('g.wire[data-wire*="e2."] path.wire-core')].filter((path) => {
      const length = path.getTotalLength();
      return Array.from({ length: 200 }, (_, index) => path.getPointAtLength((length * index) / 199)).some((point) => point.x > gate.x + 1 && point.x < gate.x + gate.width - 1 && point.y > gate.y + 1 && point.y < gate.y + gate.height - 1);
    }).length;
  });
  expect(inside).toBe(0);

  // Back to east: the routes are exactly what they were.
  await undo(page).click();
  await expect.poll(() => wire(page, "green|e2.in|e2.out").locator("path.wire-core").getAttribute("d")).toBe(feedback);
});

test("a selection of several entities turns in place as one undo step, and redo turns it again", async ({ page }) => {
  await selectEntity(page, "gate");
  await page.keyboard.press("r");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "south");
  const before = facingSource({ gate: "south" });

  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("g.card.selected")).toHaveCount(5);
  const positions = await page.locator("g.card").evaluateAll((cards) => cards.map((element) => [element.getAttribute("data-x"), element.getAttribute("data-y")]));
  await page.keyboard.press("r");
  const after = FIVE_KINDS_SOURCE.replace("gate at (300, 80)", "gate at (300, 80) facing west").replace(/( (?:source|twice|pick|light) at \([-\d]+, [-\d]+\))/g, "$1 facing south");
  await expect.poll(() => sourceText(page)).toBe(after);
  await expect(page.locator('g.card[data-facing="south"]')).toHaveCount(4);
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "west");
  // Each one turned where it stands: no card moved, and all of them are still selected.
  expect(await page.locator("g.card").evaluateAll((cards) => cards.map((element) => [element.getAttribute("data-x"), element.getAttribute("data-y")]))).toEqual(positions);
  await expect(page.locator("g.card.selected")).toHaveCount(5);
  await expect(wires(page)).toHaveCount(7);

  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(before);
  await expect(page.locator('g.card[data-facing="east"]')).toHaveCount(4);
  await redo(page).click();
  await expect.poll(() => sourceText(page)).toBe(after);
  await undo(page).click();
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo(page)).toBeDisabled();
});

test("the context menu of a card rotates both ways and shows the keys", async ({ page }) => {
  const twice = await cardGrabPoint(page, "twice");
  await page.mouse.click(twice.x, twice.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Cut/, /Copy/, /Paste/, /Rotate clockwise/, /Rotate counter-clockwise/, /Delete/]);
  await expect(menu(page).getByRole("menuitem", { name: /Rotate clockwise/ }).locator("kbd")).toHaveText("R");
  await expect(menu(page).getByRole("menuitem", { name: /Rotate counter-clockwise/ }).locator("kbd")).toHaveText(/^(⇧|Shift\+)R$/);
  // The menu is inside the canvas, whole.
  const [menuBox, canvasBox] = [await menu(page).boundingBox(), await page.locator(".canvas").boundingBox()];
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(canvasBox!.y + canvasBox!.height);

  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Rotate clockwise/ }));
  await expect(menu(page)).toHaveCount(0);
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "south");
  // The focus is back on the canvas, so the key carries on from there.
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.press("r");
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "west");

  await page.mouse.click(twice.x, twice.y, { button: "right" });
  await clickCenter(page, menu(page).getByRole("menuitem", { name: /Rotate counter-clockwise/ }));
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "south");
  await expect.poll(() => sourceText(page)).toBe(facingSource({ twice: "south" }));

  // While the menu is open the key belongs to the menu, not to the circuit.
  await page.mouse.click(twice.x, twice.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("r");
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "south");

  // Empty canvas has nothing to rotate.
  const empty = await clientPointOf(page, { x: 140, y: 300 });
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await expect(menu(page).getByRole("menuitem")).toHaveText([/Paste/, /Select all/, /Fit to content/]);
});

test("the Facing control of the inspector shows the direction and sets it in one step", async ({ page }) => {
  await selectEntity(page, "pick");
  await expect(facing(page).getByRole("button")).toHaveCount(4);
  await expect(facing(page).getByRole("button", { pressed: true })).toHaveAccessibleName("East");

  await facing(page).getByRole("button", { name: "North" }).click();
  await expect(card(page, "pick")).toHaveAttribute("data-facing", "north");
  await expect(facing(page).getByRole("button", { pressed: true })).toHaveAccessibleName("North");
  await expect.poll(() => pinOffsets(page, "pick")).toEqual(expectedPins("north"));
  await expect.poll(() => sourceText(page)).toBe(facingSource({ pick: "north" }));

  // The direction it has already is no step.
  await facing(page).getByRole("button", { name: "North" }).click();
  await facing(page).getByRole("button", { name: "West" }).click();
  await expect(card(page, "pick")).toHaveAttribute("data-facing", "west");
  await undo(page).click();
  await expect(card(page, "pick")).toHaveAttribute("data-facing", "north");
  await expect(facing(page).getByRole("button", { pressed: true })).toHaveAccessibleName("North");
  await undo(page).click();
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(facing(page).getByRole("button", { pressed: true })).toHaveAccessibleName("East");
  await expect(undo(page)).toBeDisabled();

  // With the focus on one of its buttons, R still turns the entity; the control follows.
  await facing(page).getByRole("button", { name: "South" }).click();
  await expect(facing(page).getByRole("button", { name: "South" })).toBeFocused();
  await page.keyboard.press("r");
  await expect(facing(page).getByRole("button", { pressed: true })).toHaveAccessibleName("West");
  // Settings edited afterwards leave the direction alone.
  await inspector(page).getByLabel("Entity name").fill("chosen");
  await inspector(page).getByLabel("Entity name").press("Enter");
  await expect(card(page, "chosen")).toHaveAttribute("data-facing", "west");
});

test("R is text in a field and in the source editor, and nothing happens without a selection", async ({ page }) => {
  await selectEntity(page, "gate");
  const name = inspector(page).getByLabel("Entity name");
  await name.fill("");
  await name.pressSequentially("rotor");
  await expect(name).toHaveValue("rotor");
  await name.press("Enter");
  await expect(card(page, "rotor")).toHaveAttribute("data-facing", "east");
  await expect.poll(() => sourceText(page)).toBe(FIVE_KINDS_SOURCE.replaceAll("gate", "rotor"));

  await page.getByRole("navigation", { name: "Workbench mode" }).getByRole("button", { name: "Split", exact: true }).click();
  await page.locator(".source-pane .cm-line", { hasText: "wire red twice.out <-> pick.in" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // rr");
  await expect.poll(() => sourceText(page)).toContain("wire red twice.out <-> pick.in // rr");
  expect(await sourceText(page)).not.toContain("facing");

  // On the canvas with nothing selected the key does nothing either.
  await canvas(page).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("g.card.selected")).toHaveCount(0);
  const before = await sourceText(page);
  await page.keyboard.press("r");
  await page.keyboard.press("Shift+KeyR");
  // A key that does act, to know the two before it were handled: select all, then turn everything.
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("g.card.selected")).toHaveCount(5);
  expect(await sourceText(page)).toBe(before);
  await page.keyboard.press("r");
  await expect(page.locator('g.card[data-facing="south"]')).toHaveCount(5);
});

test("typing a direction in the source moves the pins", async ({ page }) => {
  await page.getByRole("navigation", { name: "Workbench mode" }).getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".source-pane .cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const line = page.locator(".source-pane .cm-line", { hasText: "arithmetic twice at (300, 260) {" });
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type(" facing north");
  await expect.poll(() => sourceText(page)).toBe(facingSource({ twice: "north" }));
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "north");
  await expect.poll(() => pinOffsets(page, "twice")).toEqual(expectedPins("north"));
  await expect.poll(() => wireEnds(page, "red|e2.out|e3.in")).toEqual([{ x: 484, y: 140 }, { x: 380, y: 388 }]);

  // Changing the word turns it again; a direction that does not exist leaves the last valid circuit on show.
  for (let i = 0; i < "north".length; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("west");
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "west");
  await page.keyboard.type("x");
  await expect(page.locator(".invalid-banner")).toBeVisible();
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "west");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".invalid-banner")).toHaveCount(0);

  // The inspector shows what was typed, and a rotation from the canvas rewrites just the word.
  await selectEntity(page, "twice");
  await expect(facing(page).getByRole("button", { pressed: true })).toHaveAccessibleName("West");
  await page.keyboard.press("r");
  await expect.poll(() => sourceText(page)).toBe(facingSource({ twice: "north" }));
});

test("a wire is drawn to the pins of a rotated entity with the tool of its color", async ({ page }) => {
  await selectEntity(page, "pick");
  await page.keyboard.press("r");
  await expect(card(page, "pick")).toHaveAttribute("data-facing", "south");
  await expect(pin(page, "pick", "out", "red")).toHaveAttribute("data-edge", "bottom");
  const pick = await entityPosition(page, "pick");

  await tool(page, "Red wire").click();
  await expect(page.locator(".canvas")).toHaveClass(/wire-red/);
  // The pins of the other color step back on the turned card as on any other.
  expect(await pin(page, "pick", "out", "green").evaluate((element) => Number(getComputedStyle(element).opacity) < 0.5)).toBe(true);
  expect(await pin(page, "pick", "out", "red").evaluate((element) => Number(getComputedStyle(element).opacity) < 0.5)).toBe(false);

  // A green pin starts nothing; the red one on the bottom edge does, and the rubber band starts in its center.
  await clickCenter(page, pin(page, "pick", "out", "green"));
  await expect(page.locator(".pin.pending")).toHaveCount(0);
  await clickCenter(page, pin(page, "pick", "out", "red"));
  await expect(pin(page, "pick", "out", "red")).toHaveClass(/pending/);
  const aside = await clientPointOf(page, { x: pick.x + 60, y: pick.y + 180 });
  await page.mouse.move(aside.x, aside.y);
  await expect.poll(() => page.locator(".wire-preview.red").getAttribute("d")).toMatch(new RegExp(`^M ${pick.x + 100} ${pick.y + 128} L `));
  await clickCenter(page, pin(page, "light", "in", "red"));
  await expect(wire(page, "red|e4.out|e5.in")).toHaveCount(1);
  await expect.poll(() => sourceText(page)).toContain("wire red pick.out <-> light.in");
  await expect.poll(() => wireEnds(page, "red|e4.out|e5.in")).toEqual([{ x: pick.x + 100, y: pick.y + 128 }, { x: 560, y: 140 }]);

  // Green, started from the input of the turned card on its top edge.
  await tool(page, "Green wire").click();
  await expect(page.locator(".canvas")).toHaveClass(/wire-green/);
  await clickCenter(page, pin(page, "pick", "in", "green"));
  await expect(pin(page, "pick", "in", "green")).toHaveClass(/pending/);
  await clickCenter(page, pin(page, "source", "out", "green"));
  await expect(wire(page, "green|e1.out|e4.in")).toHaveCount(1);
  await expect.poll(() => wireEnds(page, "green|e1.out|e4.in")).toEqual([{ x: 224, y: 160 }, { x: pick.x + 80, y: pick.y }]);
  await expect(wires(page)).toHaveCount(9);
});

test("while the source has errors nothing rotates: the key, the menu and the inspector are off", async ({ page }) => {
  await selectEntity(page, "gate");
  await page.evaluate((text) => window.faceSession!.commands.setSource(text), FIVE_KINDS_SOURCE.replace("when virtual:signal-A < 10", "when virtual:signal-A <"));
  await expect(page.locator(".invalid-banner")).toBeVisible();
  const broken = await sourceText(page);
  for (const button of await facing(page).getByRole("button").all()) await expect(button).toBeDisabled();

  await canvas(page).focus();
  await page.keyboard.press("r");
  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y, { button: "right" });
  for (const item of [/Rotate clockwise/, /Rotate counter-clockwise/]) await expect(menu(page).getByRole("menuitem", { name: item })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  expect(await sourceText(page)).toBe(broken);
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "east");

  // Once the source is valid again the key works.
  await page.evaluate((text) => window.faceSession!.commands.setSource(text), FIVE_KINDS_SOURCE);
  await expect(page.locator(".invalid-banner")).toHaveCount(0);
  await canvas(page).focus();
  await page.keyboard.press("r");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "south");
});

test("a copy keeps the direction, and so does a saved project", async ({ page }) => {
  await selectEntity(page, "twice");
  await page.keyboard.press("Shift+KeyR");
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "north");
  const text = await page.evaluate(() => {
    const session = window.faceSession!;
    return session.commands.copyEntities(session.getState().selection);
  });
  expect(text).toContain("arithmetic twice at (300, 260) facing north {");
  await page.evaluate((clipboard) => window.faceSession!.commands.pasteEntities(clipboard), text);
  await expect(card(page, "twice2")).toHaveAttribute("data-facing", "north");
  await expect.poll(() => pinOffsets(page, "twice2")).toEqual(expectedPins("north"));

  // The saved file has the clauses, and a project with that source opens with the pins where they were.
  expect(await page.evaluate(() => window.faceSession!.commands.save())).toBe(true);
  const saved = (await readProjectEntries(await page.evaluate(() => window.faceSession!.getState().project.path!)))["main.face"]!;
  expect(saved).toBe(await sourceText(page));
  expect(saved.match(/facing north/g)).toHaveLength(2);
  await openProject(page, await writeProject({ name: "Turned", source: saved }));
  await expect(page.locator("g.card")).toHaveCount(6);
  await expect(card(page, "twice2")).toHaveAttribute("data-facing", "north");
  await expect(card(page, "twice")).toHaveAttribute("data-facing", "north");
  await expect(card(page, "gate")).toHaveAttribute("data-facing", "east");
  await expect.poll(() => pinOffsets(page, "twice")).toEqual(expectedPins("north"));
});
