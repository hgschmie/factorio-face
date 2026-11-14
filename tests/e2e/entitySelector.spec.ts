// The entity selector of the sidebar: every entity a square tile, four in a row, with a popup that says what it is; the four
// combinators always on show, "Entities in use" following the circuit, every other entity in a group that opens and closes,
// the sections remembered on this machine, and every entry placing its entity on the edit canvas and on the board.
import type { ElectronApplication, Page } from "@playwright/test";
import { canvas, card, clientPointOf, closeApp, EMPTY_SOURCE, entityNames, entityPosition, expect, launchApp, showDisplay, shrinkToMinimum, sourceText, test } from "./app.ts";
import { footprint, openBoard, setSource, tilePoint, TILE } from "./board.ts";
import { FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

const palette = (page: Page) => page.getByRole("complementary", { name: "Components" });
const header = (page: Page, name: string) => palette(page).locator(".palette-group-header", { hasText: name });
const group = (page: Page, name: string) => palette(page).getByRole("group", { name, exact: true });
/** The entry of the palette for a prototype: its tile among the combinators or in its group. */
const entry = (page: Page, prototype: string) => palette(page).locator(`.palette-item[data-prototype="${prototype}"]`);
/** The tile of a prototype in "Entities in use". */
const inUse = (page: Page, prototype: string) => palette(page).locator(`.palette-tile.in-use[data-prototype="${prototype}"]`);
const popup = (page: Page) => page.locator(".tile-popup");
const hint = (page: Page) => page.locator(".canvas-hint");
const toast = (page: Page) => page.getByRole("alert");
const activeTool = (page: Page) => page.evaluate(() => window.faceSession!.getState().tool);
const selectTool = (page: Page) => page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Select and move" });

/** Which sections are open, by name, as their headers say it. */
async function openGroups(page: Page): Promise<Record<string, boolean>> {
  return Object.fromEntries(await palette(page).locator(".palette-group-header").evaluateAll((headers) => headers.map((element) => [element.querySelector(".palette-group-name")!.textContent, element.getAttribute("aria-expanded") === "true"])));
}

/** What the palette offers right now, top to bottom, by prototype: its entries, without the tiles of "Entities in use". */
async function shownEntries(page: Page): Promise<string[]> {
  return palette(page).locator(".palette-item").evaluateAll((items) => items.map((item) => item.getAttribute("data-prototype") ?? ""));
}

/** The prototypes of the tiles in "Entities in use", in their order. */
async function entitiesInUse(page: Page): Promise<string[]> {
  return palette(page).locator(".palette-tile.in-use").evaluateAll((items) => items.map((item) => item.getAttribute("data-prototype") ?? ""));
}

/** The open state of the sections: the two groups as given, "Entities in use" open unless said otherwise. */
const sections = (lights: boolean, poles: boolean, used = true) => ({ "Entities in use": used, "Lights and sound": lights, "Power poles": poles });

const COMBINATORS = ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"];
const LIGHTS = ["small-lamp", "programmable-speaker"];
const POLES = ["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"];

test("every entity is a square tile, four in a row: the combinators first, the other entities in sections with a name and a count", async ({ page }) => {
  await expect(palette(page).locator(".count-badge")).toHaveText("10");
  expect(await openGroups(page)).toEqual(sections(true, false));
  expect(await shownEntries(page)).toEqual([...COMBINATORS, ...LIGHTS]);
  await expect(header(page, "Lights and sound").locator(".palette-group-count")).toHaveText("2");
  await expect(header(page, "Power poles").locator(".palette-group-count")).toHaveText("4");

  // The combinators are the first row; they belong to no section that could be closed. The sections follow: the entities in use, then the groups.
  const pinned = palette(page).locator(".palette-items .palette-item");
  await expect(pinned).toHaveCount(4);
  await expect(palette(page).locator(".palette-items .palette-group-header")).toHaveCount(0);
  await expect(palette(page).locator(".palette-group-header .palette-group-name")).toHaveText(["Entities in use", "Lights and sound", "Power poles"]);
  await expect(palette(page).getByRole("group", { name: "Canvas tools" })).toHaveCount(0);
  await header(page, "Power poles").click();
  expect(await shownEntries(page)).toEqual([...COMBINATORS, ...LIGHTS, ...POLES]);

  // A tile is its icon and nothing else: the game's name is its accessible name, and it has no tooltip of its own (the popup says the rest).
  const tiles = palette(page).locator(".palette-tile");
  await expect(tiles).toHaveCount(11);
  for (const tile of await tiles.all()) {
    await expect(tile.locator(".entity-icon")).toBeVisible();
    await expect(tile).toHaveText("");
    await expect(tile).not.toHaveAttribute("title");
    await expect(tile).toHaveAttribute("aria-pressed", "false");
  }
  expect(await palette(page).locator(".palette-item").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")))).toEqual([
    "Constant combinator", "Arithmetic combinator", "Decider combinator", "Selector combinator", "Lamp", "Programmable speaker", "Small electric pole", "Medium electric pole", "Big electric pole", "Substation",
  ]);
  await expect(palette(page).getByRole("button", { name: "Decider combinator" })).toHaveCount(1);
  for (const prototype of POLES) await expect(entry(page, prototype)).toHaveAttribute("data-kind", "pole");

  // Four in a row, square, the same size everywhere, in the same four columns from the first row down.
  const boxes = async (scope: string): Promise<{ x: number; y: number; width: number; height: number }[]> =>
    palette(page).locator(`${scope} .palette-tile`).evaluateAll((items) => items.map((item) => {
      const { x, y, width, height } = item.getBoundingClientRect();
      return { x, y, width, height };
    }));
  const first = await boxes(".palette-items");
  expect(first).toHaveLength(4);
  const columns = first.map((box) => box.x);
  expect(new Set(first.map((box) => box.y)).size).toBe(1);
  expect([...columns].sort((a, b) => a - b)).toEqual(columns);
  for (const [scope, count] of [['[data-group="in-use"]', 1], ['[data-group="lights-and-sound"]', 2], ['[data-group="power-poles"]', 4]] as const) {
    const row = await boxes(scope);
    expect(row, scope).toHaveLength(count);
    expect(new Set(row.map((box) => box.y)).size, scope).toBe(1);
    row.forEach((box, index) => {
      expect(Math.abs(box.x - columns[index]!), scope).toBeLessThan(0.5);
      expect(Math.abs(box.width - first[0]!.width), scope).toBeLessThan(0.5);
      expect(Math.abs(box.width - box.height), scope).toBeLessThan(0.5);
    });
  }
  expect(first[0]!.width).toBeGreaterThan(40);
  expect(first[0]!.width).toBeLessThan(52);
  // The row fills the sidebar: as far from its right edge as from its left.
  const side = (await palette(page).boundingBox())!;
  expect(Math.abs(first[0]!.x - side.x - (side.x + side.width - first[3]!.x - first[3]!.width))).toBeLessThan(2);
});

test("a tile says what it is in a popup on hover and on keyboard focus, beside the sidebar and off every tile", async ({ page }) => {
  await expect(popup(page)).toHaveCount(0);
  // Hover, after a moment: the name, what it is for and its key, said so that it is no count.
  await entry(page, "decider-combinator").hover();
  await expect(popup(page)).toHaveCount(0);
  await expect(popup(page)).toHaveAttribute("data-prototype", "decider-combinator");
  await expect(popup(page)).toHaveRole("tooltip");
  await expect(popup(page).locator(".tile-popup-name")).toHaveText("Decider combinator");
  await expect(popup(page).locator(".tile-popup-text p")).toHaveText(["Compare and decide", "Key 3"]);
  await expect(popup(page).locator(".tile-popup-key kbd")).toHaveText("3");
  await expect(popup(page).locator(".bubble-pointer")).toBeVisible();
  // It describes the tile to assistive technology, which already has the name.
  await expect(entry(page, "decider-combinator")).toHaveAccessibleName("Decider combinator");
  await expect(entry(page, "decider-combinator")).toHaveAccessibleDescription("Compare and decide Key 3");
  await expect(entry(page, "constant-combinator")).toHaveAccessibleDescription("");

  // Beside the sidebar at the height of its tile: it covers neither its own tile nor any other, and takes no pointer.
  const beside = async (prototype: string, tile = entry(page, prototype)): Promise<void> => {
    await expect(popup(page)).toHaveAttribute("data-prototype", prototype);
    const [box, side, own] = [(await popup(page).boundingBox())!, (await palette(page).boundingBox())!, (await tile.boundingBox())!];
    expect(box.x).toBeGreaterThanOrEqual(side.x + side.width);
    expect(box.y).toBeLessThan(own.y + own.height);
    expect(box.y + box.height).toBeGreaterThan(own.y);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
  };
  await beside("decider-combinator");
  expect(await popup(page).evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
  // In the look of the board's bubble: the card colors, not a native tooltip.
  expect(await popup(page).locator(".tile-popup-body").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.background = "var(--card-bottom)";
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }));

  // The next tile takes the popup over at once. A lamp has the key 5; a speaker has none.
  await entry(page, "small-lamp").hover();
  await beside("small-lamp");
  await expect(popup(page).locator(".tile-popup-text p")).toHaveText(["See a condition light up", "Key 5"]);
  await entry(page, "programmable-speaker").hover();
  await beside("programmable-speaker");
  await expect(popup(page).locator(".tile-popup-name")).toHaveText("Programmable speaker");
  await expect(popup(page).locator(".tile-popup-text p")).toHaveText(["Sound an alert on a condition"]);
  await expect(popup(page).locator("kbd")).toHaveCount(0);
  // The tile of the lamp in "Entities in use" has the same popup, at its own place.
  await inUse(page, "small-lamp").hover();
  await beside("small-lamp", inUse(page, "small-lamp"));
  await expect(inUse(page, "small-lamp")).toHaveAccessibleDescription("See a condition light up Key 5");
  await expect(entry(page, "small-lamp")).toHaveAccessibleDescription("");

  // A pole says what the choice decides: the tiles it covers and its wire reach.
  await header(page, "Power poles").hover();
  await expect(popup(page)).toHaveCount(0);
  await header(page, "Power poles").click();
  await entry(page, "big-electric-pole").hover();
  await beside("big-electric-pole");
  await expect(popup(page).locator(".tile-popup-text p")).toHaveText(["Relay signals over a distance", "2 x 2 tiles, wire reach 32"]);
  await entry(page, "small-electric-pole").hover();
  await expect(popup(page).locator(".tile-popup-text p")).toHaveText(["Relay signals over a distance", "1 tile, wire reach 7.5"]);
  // Away from the tiles it goes.
  await canvas(page).hover();
  await expect(popup(page)).toHaveCount(0);

  // Keyboard focus shows it without a wait, and takes it along from tile to tile.
  await header(page, "Power poles").focus();
  await page.keyboard.press("Tab");
  await expect(entry(page, "small-electric-pole")).toBeFocused();
  await beside("small-electric-pole");
  await page.keyboard.press("Tab");
  await expect(entry(page, "medium-electric-pole")).toBeFocused();
  await beside("medium-electric-pole");
  await expect(popup(page).locator(".tile-popup-text p")).toHaveText(["Relay signals over a distance", "1 tile, wire reach 9"]);
  // Space arms the tile, as before; the popup stays while the focus does.
  await page.keyboard.press("Space");
  await expect(entry(page, "medium-electric-pole")).toHaveAttribute("aria-pressed", "true");
  await beside("medium-electric-pole");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(header(page, "Power poles")).toBeFocused();
  await expect(popup(page)).toHaveCount(0);
  await page.keyboard.press("q");

  // A tile that was clicked keeps the focus, but its popup leaves with the pointer.
  await entry(page, "selector-combinator").click();
  await beside("selector-combinator");
  await canvas(page).hover();
  await expect(entry(page, "selector-combinator")).toBeFocused();
  await expect(popup(page)).toHaveCount(0);
  await page.keyboard.press("q");

  // While the source has errors the tiles are off, and still say what they are.
  await setSource(page, (await sourceText(page)).replace("< 10", "<"));
  await expect(entry(page, "arithmetic-combinator")).toBeDisabled();
  await entry(page, "arithmetic-combinator").hover({ force: true });
  await beside("arithmetic-combinator");
  await expect(popup(page).locator(".tile-popup-text p")).toHaveText(["Transform your signals", "Key 2"]);
});

test('"Entities in use" has a tile for each kind of entity the circuit contains, apart from the combinators, and follows the circuit', async ({ page }) => {
  const used = header(page, "Entities in use");
  const sectionBox = async () => (await palette(page).locator('.palette-group[data-group="in-use"]').boundingBox())!;
  // The example has a lamp. The section sits between the combinators and the groups.
  expect(await entitiesInUse(page)).toEqual(["small-lamp"]);
  await expect(used.locator(".palette-group-count")).toHaveText("1");
  const filled = await sectionBox();
  expect(filled.y).toBeGreaterThan((await entry(page, "constant-combinator").boundingBox())!.y);
  expect(filled.y + filled.height).toBeLessThanOrEqual((await header(page, "Lights and sound").boundingBox())!.y);

  // An empty circuit, and one of combinators only: a line in place of the row, as high as the row, so nothing below moves.
  await setSource(page, EMPTY_SOURCE);
  await expect(palette(page).locator(".palette-tile.in-use")).toHaveCount(0);
  await expect(used.locator(".palette-group-count")).toHaveText("0");
  await expect(palette(page).getByRole("group", { name: "Entities in use" })).toHaveText("None besides the combinators.");
  expect(await sectionBox()).toEqual(filled);
  await page.keyboard.press("3");
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "decider1")).toHaveCount(1);
  expect(await entitiesInUse(page)).toEqual([]);
  await expect(palette(page).getByRole("group", { name: "Entities in use" })).toHaveText("None besides the combinators.");

  // The first lamp: its tile appears, and the layout does not jump.
  const lights = (await header(page, "Lights and sound").boundingBox())!;
  await page.keyboard.press("5");
  await page.keyboard.press("Enter");
  await expect(card(page, "lamp1")).toHaveCount(1);
  expect(await entitiesInUse(page)).toEqual(["small-lamp"]);
  await expect(used.locator(".palette-group-count")).toHaveText("1");
  expect(await sectionBox()).toEqual(filled);
  expect(await header(page, "Lights and sound").boundingBox()).toEqual(lights);

  // More kinds, placed in another order than the palette has them: the tiles are in the order of the palette, one per kind.
  await header(page, "Power poles").click();
  const place = async (prototype: string, name: string): Promise<void> => {
    await entry(page, prototype).click();
    await canvas(page).focus();
    await page.keyboard.press("Enter");
    await expect(card(page, name)).toHaveCount(1);
  };
  await place("substation", "pole1");
  await place("programmable-speaker", "speaker1");
  await place("substation", "pole2");
  await place("small-electric-pole", "pole3");
  expect(await entitiesInUse(page)).toEqual(["small-lamp", "programmable-speaker", "small-electric-pole", "substation"]);
  await expect(used.locator(".palette-group-count")).toHaveText("4");
  expect(await shownEntries(page)).toEqual([...COMBINATORS, ...LIGHTS, ...POLES]);

  // A tile in use arms the tool like the entry in its group, and both show it; it places the same entity.
  await inUse(page, "substation").click();
  expect(await activeTool(page)).toEqual({ type: "place", kind: "pole", prototype: "substation" });
  await expect(inUse(page, "substation")).toHaveAttribute("aria-pressed", "true");
  await expect(entry(page, "substation")).toHaveAttribute("aria-pressed", "true");
  await expect(palette(page).locator('.palette-tile[aria-pressed="true"]')).toHaveCount(2);
  await expect(hint(page)).toHaveText("Click the canvas (or press Enter on it) to place a substation. Esc cancels.");
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "pole4")).toHaveAttribute("data-kind", "pole");
  expect(await sourceText(page)).toMatch(/pole pole4 at \(-?\d+, -?\d+\) \{\n {8}prototype = substation/);
  await expect(palette(page).locator('.palette-tile[aria-pressed="true"]')).toHaveCount(0);
  // Clicking it again while it is armed returns to the select tool; the key of the lamp lights both of its tiles.
  await inUse(page, "substation").click();
  await inUse(page, "substation").click();
  expect(await activeTool(page)).toEqual({ type: "select" });
  await page.keyboard.press("5");
  await expect(inUse(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("q");

  // The last entity of a kind goes: so does its tile. Undo brings both back.
  await page.evaluate(() => {
    const { getState, commands } = window.faceSession!;
    commands.deleteEntities(getState().circuit.entities.filter((entity) => entity.name === "speaker1" || entity.name === "pole3").map((entity) => entity.id));
  });
  expect(await entitiesInUse(page)).toEqual(["small-lamp", "substation"]);
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await entitiesInUse(page)).toEqual(["small-lamp", "programmable-speaker", "small-electric-pole", "substation"]);
  // Typing in the source counts like any edit, and so does a prototype changed there.
  await setSource(page, (await sourceText(page)).replace("prototype = substation", "prototype = big-electric-pole"));
  expect(await entitiesInUse(page)).toEqual(["small-lamp", "programmable-speaker", "small-electric-pole", "big-electric-pole", "substation"]);

  // The section closes like a group; its heading and its count stay.
  await used.click();
  await expect(used).toHaveAttribute("aria-expanded", "false");
  await expect(palette(page).locator(".palette-tile.in-use")).toHaveCount(0);
  await expect(used.locator(".palette-group-count")).toHaveText("5");
  await used.focus();
  await page.keyboard.press("Enter");
  expect(await entitiesInUse(page)).toHaveLength(5);
});

test("a group opens and closes with the pointer and with the keyboard, and says so to assistive technology", async ({ page }) => {
  const poles = header(page, "Power poles");
  await expect(poles).toHaveAttribute("aria-expanded", "false");
  await expect(poles).toHaveRole("button");
  // The header names the panel it controls; the panel is hidden while the group is closed.
  const panelId = await poles.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  await expect(page.locator(`[id="${panelId}"]`)).toBeHidden();
  await expect(group(page, "Power poles")).toHaveCount(0);

  await poles.click();
  await expect(poles).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
  await expect(group(page, "Power poles").getByRole("button")).toHaveCount(4);
  await poles.click();
  await expect(poles).toHaveAttribute("aria-expanded", "false");
  await expect(entry(page, "substation")).toHaveCount(0);

  // Keyboard: the header is in the tab order; Enter and Space both toggle it, and the entries follow it in the tab order.
  await poles.focus();
  await page.keyboard.press("Enter");
  await expect(poles).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(entry(page, "small-electric-pole")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(poles).toBeFocused();
  await page.keyboard.press("Space");
  await expect(poles).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Tab");
  await expect(entry(page, "small-electric-pole")).toHaveCount(0);

  // The other group is independent of it.
  const lights = header(page, "Lights and sound");
  await lights.focus();
  await page.keyboard.press("Space");
  expect(await openGroups(page)).toEqual(sections(false, false));
  expect(await shownEntries(page)).toEqual(COMBINATORS);
  // No key of the circuit was triggered on the way, and nothing was placed.
  expect(await activeTool(page)).toEqual({ type: "select" });
});

test("which sections are open is remembered across a restart, for every project", async () => {
  const first = await launchApp();
  let second: { app: ElectronApplication; page: Page } | undefined;
  try {
    expect(await openGroups(first.page)).toEqual(sections(true, false));
    await header(first.page, "Lights and sound").click();
    await header(first.page, "Power poles").click();
    expect(await openGroups(first.page)).toEqual(sections(false, true));
    // The state is not part of a project: another project shows the same groups, and it is not an unsaved change.
    await openFiveKinds(first.page);
    expect(await openGroups(first.page)).toEqual(sections(false, true));
    await expect(first.page.locator(".project-meta")).toContainText("All changes saved");
    // Source mode takes the palette away; it comes back as it was.
    await first.page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(palette(first.page)).toHaveCount(0);
    await first.page.getByRole("button", { name: "Circuit", exact: true }).click();
    expect(await openGroups(first.page)).toEqual(sections(false, true));
    await closeApp(first.app);

    // The restarted app shows what it starts with (the project that was open last); the groups do not depend on it.
    second = await launchApp({ userData: first.userData, open: "start" });
    expect(await openGroups(second.page)).toEqual(sections(false, true));
    expect(await shownEntries(second.page)).toEqual([...COMBINATORS, ...POLES]);
    // And back: what is stored follows every change. "Entities in use" is remembered like the groups.
    await header(second.page, "Power poles").click();
    await header(second.page, "Entities in use").click();
    await closeApp(second.app);
    second = await launchApp({ userData: first.userData, open: "start" });
    expect(await openGroups(second.page)).toEqual(sections(false, false, false));
    await expect(palette(second.page).locator(".palette-tile.in-use")).toHaveCount(0);
    await header(second.page, "Entities in use").click();
    expect(await entitiesInUse(second.page)).toEqual(["small-lamp"]);
  } finally {
    await closeApp(first.app);
    if (second) await closeApp(second.app);
  }
});

test("the palette works when the stored state is unreadable or storage refuses", async ({ page }) => {
  // Garbage in the store: the groups start as they are defined.
  await page.evaluate(() => localStorage.setItem("face.palette.openGroups", "{not json"));
  await page.reload();
  await page.waitForSelector(".app-shell");
  expect(await openGroups(page)).toEqual(sections(true, false));
  // A store that throws on every access: the groups still open and close, for as long as the window lives.
  await page.evaluate(() => {
    const refuse = (): never => {
      throw new DOMException("refused", "SecurityError");
    };
    Storage.prototype.getItem = refuse;
    Storage.prototype.setItem = refuse;
  });
  await header(page, "Power poles").click();
  await header(page, "Lights and sound").click();
  await header(page, "Entities in use").click();
  expect(await openGroups(page)).toEqual(sections(false, true, false));
  await entry(page, "substation").click();
  await expect(entry(page, "substation")).toHaveAttribute("aria-pressed", "true");
  await expect(toast(page)).toHaveCount(0);
});

test("the key 5 opens the group of the lamp so that the armed entry is on show", async ({ page }) => {
  await header(page, "Lights and sound").click();
  await expect(entry(page, "small-lamp")).toHaveCount(0);
  await canvas(page).focus();
  await page.keyboard.press("5");
  await expect(header(page, "Lights and sound")).toHaveAttribute("aria-expanded", "true");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
  await expect(entry(page, "small-lamp")).toBeInViewport({ ratio: 1 });
  await expect(palette(page).locator('.palette-item[aria-pressed="true"]')).toHaveCount(1);
  // The example has a lamp, so its tile in "Entities in use" is lit as well.
  await expect(palette(page).locator('.palette-tile[aria-pressed="true"]')).toHaveCount(2);
  await expect(hint(page)).toHaveText("Click the canvas (or press Enter on it) to place a lamp. Esc cancels.");
  // The poles were not asked for.
  await expect(header(page, "Power poles")).toHaveAttribute("aria-expanded", "false");

  // Closed by hand while the tool is armed, the group stays closed; the tool stays armed and still places.
  await header(page, "Lights and sound").click();
  await expect(header(page, "Lights and sound")).toHaveAttribute("aria-expanded", "false");
  expect(await activeTool(page)).toEqual({ type: "place", kind: "lamp" });
  await page.keyboard.press("q");
  await expect(header(page, "Lights and sound")).toHaveAttribute("aria-expanded", "false");
  // The key again opens it again; the keys 1 to 4 need no group.
  await page.keyboard.press("5");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("3");
  await expect(entry(page, "decider-combinator")).toHaveAttribute("aria-pressed", "true");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "false");
  // The digits beyond 5 pick nothing: the new entries have no key.
  for (const digit of ["6", "7", "8", "9", "0"]) await page.keyboard.press(digit);
  expect(await activeTool(page)).toEqual({ type: "place", kind: "decider" });
});

const NEW_ENTRIES = [
  { prototype: "programmable-speaker", kind: "speaker", name: "speaker1", noun: "a speaker", title: "SPEAKER", size: [1, 1], source: "speaker speaker1 at (0, 500) {\n    }" },
  { prototype: "small-electric-pole", kind: "pole", name: "pole1", noun: "a small electric pole", title: "SMALL ELECTRIC POLE", size: [1, 1], source: "pole pole1 at (240, 500) {\n    }" },
  { prototype: "medium-electric-pole", kind: "pole", name: "pole2", noun: "a medium electric pole", title: "MEDIUM ELECTRIC POLE", size: [1, 1], source: "pole pole2 at (480, 500) {\n        prototype = medium-electric-pole\n    }" },
  { prototype: "big-electric-pole", kind: "pole", name: "pole3", noun: "a big electric pole", title: "BIG ELECTRIC POLE", size: [2, 2], source: "pole pole3 at (720, 500) {\n        prototype = big-electric-pole\n    }" },
  { prototype: "substation", kind: "pole", name: "pole4", noun: "a substation", title: "SUBSTATION", size: [2, 2], source: "pole pole4 at (960, 500) {\n        prototype = substation\n    }" },
] as const;

test("each new entry places its entity on the edit canvas, with its prototype in the source", async ({ page }) => {
  await openFiveKinds(page);
  await header(page, "Power poles").click();
  for (let step = 0; step < 2; step++) await page.getByRole("button", { name: "Zoom out" }).click();
  for (const [index, item] of NEW_ENTRIES.entries()) {
    await entry(page, item.prototype).click();
    await expect(entry(page, item.prototype)).toHaveAttribute("aria-pressed", "true");
    expect(await activeTool(page)).toEqual({ type: "place", kind: item.kind, prototype: item.prototype });
    // The hint names the entity; none of them turns, so it says nothing about R, and the keys do nothing.
    await expect(hint(page)).toHaveText(`Click the canvas (or press Enter on it) to place ${item.noun}. Esc cancels.`);
    await page.keyboard.press("r");
    await page.keyboard.press("Shift+KeyR");
    expect(await activeTool(page)).toEqual({ type: "place", kind: item.kind, prototype: item.prototype });
    const point = await clientPointOf(page, { x: 92 + index * 240, y: 564 });
    await page.mouse.click(point.x, point.y);

    const placed = card(page, item.name);
    await expect(placed).toHaveAttribute("data-kind", item.kind);
    await expect(placed).toHaveClass(/selected/);
    await expect(placed.locator(".card-kind")).toHaveText(item.title);
    expect(await entityPosition(page, item.name)).toEqual({ x: index * 240, y: 500 });
    expect(await sourceText(page)).toContain(item.source);
    // Placing returns to the select tool and shows the new entity in the inspector, by the name of the game.
    await expect(entry(page, item.prototype)).toHaveAttribute("aria-pressed", "false");
    await expect(selectTool(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Entity name")).toHaveValue(item.name);
    await expect(page.getByRole("complementary", { name: "Inspector" }).locator("h2")).toHaveText(item.kind === "speaker" ? "Speaker" : item.title, { ignoreCase: true });
  }
  expect((await entityNames(page)).slice(-5)).toEqual(["speaker1", "pole1", "pole2", "pole3", "pole4"]);
  // A pole has its one connection point on both edges of its card, a speaker an input on the left.
  expect(await card(page, "pole3").locator("g.pin").evaluateAll((pins) => pins.map((pin) => `${pin.getAttribute("data-terminal")} ${pin.getAttribute("data-wire-color")} ${pin.getAttribute("data-edge")}`))).toEqual(["io red left", "io green left", "io red right", "io green right"]);
  expect(await card(page, "speaker1").locator("g.pin").evaluateAll((pins) => pins.map((pin) => `${pin.getAttribute("data-terminal")} ${pin.getAttribute("data-edge")}`))).toEqual(["in left", "in left"]);
  // The entity list names all of them; one undo step per entity.
  await expect(palette(page).locator(".entity-list button")).toHaveCount(10);
  for (let step = 0; step < NEW_ENTRIES.length; step++) await page.getByRole("button", { name: "Undo" }).click();
  expect(await sourceText(page)).not.toMatch(/pole|speaker/);
});

/** Two lamps that span the board the next test places on: tiles 0 to 15 by 0 to 5, so that Fit shows all of it. */
const CORNERS = `circuit "Corners" {
    lamp first at (0, 0) tile (0.5, 0.5) {
    }

    lamp last at (1380, 460) tile (15.5, 5.5) {
    }
}
`;

test("on the board the outline of a new entity has the footprint of its prototype, and it is placed on free tiles only", async ({ page }) => {
  await openBoard(page, CORNERS);
  await header(page, "Power poles").click();
  /** The point at which the pointer has a footprint of `width` tiles with its top-left tile at (x, y) around it. */
  const pointerFor = (x: number, y: number, width: number) => tilePoint(page, x + (width - 1) / 2, y + (width - 1) / 2);
  const ghost = page.locator("rect.board-ghost");
  const outline = async () =>
    ghost.evaluate((rect, tile) => {
      const [x, y, width, height] = ["data-tile-x", "data-tile-y", "width", "height"].map((name) => Number(rect.getAttribute(name)));
      return { tile: [x, y], size: [(width! + 8) / tile, (height! + 8) / tile], prototype: rect.getAttribute("data-prototype"), blocked: rect.classList.contains("blocked") };
    }, TILE);
  const before = await sourceText(page);

  // Free tiles in a row, three apart. The pointer is in the middle of the footprint: for 2x2 on the corner of four tiles.
  for (const [index, item] of NEW_ENTRIES.entries()) {
    await entry(page, item.prototype).click();
    await expect(hint(page)).toHaveText(`Click a free tile (or press Enter on the board) to place ${item.noun}. Esc cancels.`);
    const origin = { x: 1 + index * 3, y: 2 };
    const spot = await pointerFor(origin.x, origin.y, item.size[0]);
    await page.mouse.move(spot.x, spot.y, { steps: 3 });
    await expect.poll(outline).toEqual({ tile: [origin.x, origin.y], size: item.size, prototype: item.prototype, blocked: false });
    // No direction to show, and nothing to turn.
    await expect(page.locator("path.board-ghost-arrow")).toHaveCount(0);
    await page.keyboard.press("r");
    await expect.poll(outline).toMatchObject({ size: item.size });
    await page.mouse.click(spot.x, spot.y);
    await expect(card(page, item.name)).toHaveClass(/selected/);
    expect(await footprint(page, item.name)).toEqual({ tile: [origin.x, origin.y], size: item.size, facing: "east", placed: "true" });
    await expect(selectTool(page)).toHaveAttribute("aria-pressed", "true");
  }
  // The centers as the source holds them: half tiles for one tile, whole numbers for the middle of four.
  const source = await sourceText(page);
  expect(source).toMatch(/speaker speaker1 at \(\d+, \d+\) tile \(1\.5, 2\.5\) \{/);
  expect(source).toMatch(/pole pole1 at \(\d+, \d+\) tile \(4\.5, 2\.5\) \{/);
  expect(source).toMatch(/pole pole3 at \(\d+, \d+\) tile \(11, 3\) \{\n {8}prototype = big-electric-pole/);
  expect(source).toMatch(/pole pole4 at \(\d+, \d+\) tile \(14, 3\) \{\n {8}prototype = substation/);
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  expect(await page.evaluate(() => window.faceSession!.getState().diagnostics.filter((diagnostic) => diagnostic.code.startsWith("tile")))).toEqual([]);

  // A big pole cannot be placed where one of its four tiles is taken: on the lamp at (15, 5), with one corner on it, or with
  // one corner on pole3, which covers the tiles (10..11, 2..3).
  await entry(page, "big-electric-pole").click();
  for (const tile of [[15, 5], [14, 4], [11, 3], [9, 1]] as const) {
    const taken = await pointerFor(tile[0], tile[1], 2);
    await page.mouse.move(taken.x, taken.y, { steps: 3 });
    await expect.poll(outline).toEqual({ tile, size: [2, 2], prototype: "big-electric-pole", blocked: true });
    await page.mouse.click(taken.x, taken.y);
    expect(await sourceText(page)).toBe(source);
    await expect(entry(page, "big-electric-pole")).toHaveAttribute("aria-pressed", "true");
  }
  await expect(toast(page)).toHaveCount(0);
  // One tile further on it is free again.
  const free = await pointerFor(8, 4, 2);
  await page.mouse.move(free.x, free.y, { steps: 3 });
  await expect.poll(outline).toEqual({ tile: [8, 4], size: [2, 2], prototype: "big-electric-pole", blocked: false });
  // A small pole fits where the big one did not: on the tile beside pole3.
  await entry(page, "small-electric-pole").click();
  const beside = await pointerFor(9, 1, 1);
  await page.mouse.move(beside.x, beside.y, { steps: 3 });
  await expect.poll(outline).toEqual({ tile: [9, 1], size: [1, 1], prototype: "small-electric-pole", blocked: false });

  // Enter places on the free tiles nearest to the middle of the view, with the footprint of the tool.
  await entry(page, "substation").click();
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "pole5")).toHaveClass(/selected/);
  expect((await footprint(page, "pole5")).size).toEqual([2, 2]);
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  for (let step = 0; step < NEW_ENTRIES.length + 1; step++) await page.getByRole("button", { name: "Undo" }).click();
  expect(await sourceText(page)).toBe(before);
});

test("with every section open the selector fits the window it starts with; in the smallest one the sections scroll in their own area and the entity list stays in reach", async ({ page, app }) => {
  await openFiveKinds(page);
  const measure = () =>
    page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const [panel, groups, list] = [document.querySelector(".palette")!, document.querySelector(".palette-groups")!, document.querySelector(".entity-list")!];
      return {
        window: [window.innerWidth, window.innerHeight],
        // Nothing of the panel is cut off or pushed out of it.
        overflow: panel.scrollHeight - panel.clientHeight,
        sideways: Math.max(panel.scrollWidth - panel.clientWidth, groups.scrollWidth - groups.clientWidth),
        listInside: box(".entity-list").bottom <= box(".palette").bottom + 0.5 && box(".entity-list").top >= box(".palette-groups").bottom,
        combinatorsInside: [...document.querySelectorAll(".palette-items .palette-item")].every((item) => item.getBoundingClientRect().bottom <= box(".palette-groups").top),
        groups: { height: groups.clientHeight, content: groups.scrollHeight },
        list: { height: list.clientHeight, content: list.scrollHeight },
        // Four tiles in the first row, whatever the width of the sidebar.
        firstRow: new Set([...document.querySelectorAll(".palette-items .palette-item")].map((item) => item.getBoundingClientRect().top)).size,
      };
    });

  await header(page, "Power poles").click();
  expect(await shownEntries(page)).toHaveLength(10);
  expect(await entitiesInUse(page)).toEqual(["small-lamp"]);

  for (const size of ["default", "minimum"] as const) {
    if (size === "minimum") await shrinkToMinimum(app, page);
    const layout = await measure();
    expect(layout.overflow, size).toBe(0);
    expect(layout.sideways, size).toBe(0);
    expect(layout.listInside, size).toBe(true);
    expect(layout.combinatorsInside, size).toBe(true);
    expect(layout.firstRow, size).toBe(1);
    // At the size the window starts with the sections show all of themselves (to a fraction of a pixel, which the two whole
    // numbers round apart). In the smallest window they show at least a heading and a row and scroll for the rest.
    if (size === "default") expect(layout.groups.content - layout.groups.height, size).toBeLessThanOrEqual(1);
    else expect(layout.groups.content, size).toBeGreaterThan(layout.groups.height + 20);
    expect(layout.groups.height, size).toBeGreaterThanOrEqual(56);
    expect(layout.list.height, size).toBeGreaterThanOrEqual(40);

    // The four combinators are on show whatever the sections do.
    for (const prototype of COMBINATORS) await expect(entry(page, prototype)).toBeInViewport({ ratio: 1 });
    // The last entry of the last group is reached by scrolling the sections, and it works.
    await entry(page, "substation").scrollIntoViewIfNeeded();
    await expect(entry(page, "substation")).toBeInViewport({ ratio: 1 });
    await entry(page, "substation").click();
    await expect(entry(page, "substation")).toHaveAttribute("aria-pressed", "true");
    await entry(page, "substation").click();
    // The last entity of the list is reached by scrolling the list, and selects.
    const last = palette(page).locator(".entity-list button").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    await last.click();
    await expect(card(page, "light")).toHaveClass(/selected/);
    // The sections are still where they were scrolled to: the two areas scroll on their own.
    await expect(entry(page, "substation")).toBeInViewport({ ratio: 1 });
  }
  // The keyboard reaches a tile that is scrolled out of sight: it comes into view, and its popup is beside it.
  await palette(page).locator(".palette-groups").evaluate((groups) => groups.scrollTo(0, 0));
  await expect(entry(page, "substation")).not.toBeInViewport({ ratio: 1 });
  await header(page, "Power poles").focus();
  for (let step = 0; step < 4; step++) await page.keyboard.press("Tab");
  await expect(entry(page, "substation")).toBeFocused();
  await expect(entry(page, "substation")).toBeInViewport({ ratio: 1 });
  await expect(popup(page)).toHaveAttribute("data-prototype", "substation");
  const [popupBox, tileBox] = [(await popup(page).boundingBox())!, (await entry(page, "substation").boundingBox())!];
  expect(popupBox.y).toBeLessThan(tileBox.y + tileBox.height);
  expect(popupBox.y + popupBox.height).toBeGreaterThan(tileBox.y);
  await canvas(page).focus();
  await expect(popup(page)).toHaveCount(0);

  // A tile armed by its key is in view wherever the sections were scrolled to.
  await palette(page).locator(".palette-groups").evaluate((groups) => groups.scrollTo(0, groups.scrollHeight));
  await page.keyboard.press("5");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
  await expect(entry(page, "small-lamp")).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("q");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await showDisplay(page, "blueprint");
  expect((await measure()).overflow).toBe(0);
});

test("the list of the circuit's entities closes like a group, leaves its room to the groups and is remembered across a restart", async () => {
  const listHeader = (page: Page) => palette(page).locator(".palette-list-header");
  const list = (page: Page) => palette(page).locator(".entity-list");
  const groupsHeight = (page: Page) => page.evaluate(() => document.querySelector(".palette-groups")!.clientHeight);
  const first = await launchApp();
  let second: { app: ElectronApplication; page: Page } | undefined;
  try {
    const page = first.page;
    await openFiveKinds(page);
    // In the smallest window, where the sections do not fit beside the list.
    await shrinkToMinimum(first.app, page);
    await header(page, "Power poles").click();
    await expect(listHeader(page)).toHaveAttribute("aria-expanded", "true");
    await expect(listHeader(page)).toHaveText("In this circuit5");
    await expect(list(page).getByRole("button")).toHaveCount(5);
    const shared = await groupsHeight(page);

    await listHeader(page).click();
    await expect(listHeader(page)).toHaveAttribute("aria-expanded", "false");
    await expect(list(page)).toBeHidden();
    await expect(list(page).getByRole("button")).toHaveCount(0);
    // The heading and its count stay, and the groups have the room of the list.
    await expect(listHeader(page)).toHaveText("In this circuit5");
    expect(await groupsHeight(page)).toBeGreaterThan(shared);
    expect(await page.evaluate(() => document.querySelector(".palette")!.scrollHeight - document.querySelector(".palette")!.clientHeight)).toBe(0);
    // It is a preference of this machine like the groups, not a change of the project, and the groups keep their own state.
    await expect(page.locator(".project-meta")).toContainText("All changes saved");
    expect(await openGroups(page)).toEqual(sections(true, true));

    // By keyboard, as a button.
    await listHeader(page).focus();
    await page.keyboard.press("Enter");
    await expect(listHeader(page)).toHaveAttribute("aria-expanded", "true");
    await expect(list(page).getByRole("button")).toHaveCount(5);
    await page.keyboard.press("Space");
    await expect(listHeader(page)).toHaveAttribute("aria-expanded", "false");
    await closeApp(first.app);

    // The restarted app reopens the five-kinds project, which was open last.
    second = await launchApp({ userData: first.userData, open: "start" });
    await expect(listHeader(second.page)).toHaveAttribute("aria-expanded", "false");
    await expect(list(second.page)).toBeHidden();
    await listHeader(second.page).click();
    await expect(list(second.page).getByRole("button")).toHaveCount(5);
  } finally {
    await closeApp(first.app);
    if (second) await closeApp(second.app);
  }
});
