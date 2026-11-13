// The entity selector of the sidebar: the four combinators always on show, every other entity in a group that opens and
// closes, the groups remembered on this machine, and every entry placing its entity on the edit canvas and on the board.
import type { ElectronApplication, Page } from "@playwright/test";
import { canvas, card, clientPointOf, closeApp, entityNames, entityPosition, expect, launchApp, showDisplay, sourceText, test } from "./app.ts";
import { footprint, openBoard, tilePoint, TILE } from "./board.ts";
import { FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

const palette = (page: Page) => page.getByRole("complementary", { name: "Components" });
const header = (page: Page, name: string) => palette(page).locator(".palette-group-header", { hasText: name });
const group = (page: Page, name: string) => palette(page).getByRole("group", { name, exact: true });
const entry = (page: Page, prototype: string) => palette(page).locator(`.palette-item[data-prototype="${prototype}"]`);
const hint = (page: Page) => page.locator(".canvas-hint");
const toast = (page: Page) => page.getByRole("alert");
const activeTool = (page: Page) => page.evaluate(() => window.faceSession!.getState().tool);
const selectTool = (page: Page) => page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Select and move" });

/** Which groups are open, by name, as their headers say it. */
async function openGroups(page: Page): Promise<Record<string, boolean>> {
  return Object.fromEntries(await palette(page).locator(".palette-group-header").evaluateAll((headers) => headers.map((element) => [element.querySelector(".palette-group-name")!.textContent, element.getAttribute("aria-expanded") === "true"])));
}

/** What the palette offers right now, top to bottom, by prototype. */
async function shownEntries(page: Page): Promise<string[]> {
  return palette(page).locator(".palette-item").evaluateAll((items) => items.map((item) => item.getAttribute("data-prototype") ?? ""));
}

const COMBINATORS = ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"];
const LIGHTS = ["small-lamp", "programmable-speaker"];
const POLES = ["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"];

test("the combinators are always on show and the other entities are in groups with a name, a count and their entries", async ({ page }) => {
  await expect(palette(page).locator(".count-badge")).toHaveText("10");
  expect(await openGroups(page)).toEqual({ "Lights and sound": true, "Power poles": false });
  expect(await shownEntries(page)).toEqual([...COMBINATORS, ...LIGHTS]);
  await expect(header(page, "Lights and sound").locator(".palette-group-count")).toHaveText("2");
  await expect(header(page, "Power poles").locator(".palette-group-count")).toHaveText("4");

  // The combinators are rows of their own with name, description and key; they belong to no group that could be closed.
  const pinned = palette(page).locator(".palette-items .palette-item");
  await expect(pinned).toHaveCount(4);
  await expect(pinned.locator("strong")).toHaveText(["Constant", "Arithmetic", "Decider", "Selector"]);
  await expect(pinned.locator("kbd.key-hint")).toHaveText(["1", "2", "3", "4"]);
  await expect(palette(page).locator(".palette-items .palette-group-header")).toHaveCount(0);
  await expect(palette(page).locator(".palette-group-header")).toHaveCount(2);

  // An entry of a group is one line: icon and the name of the game. The lamp keeps its key; nothing else has one.
  await expect(group(page, "Lights and sound").locator(".palette-item strong")).toHaveText(["Lamp", "Programmable speaker"]);
  await expect(group(page, "Lights and sound").locator("kbd.key-hint")).toHaveText(["5"]);
  await expect(entry(page, "small-lamp")).toHaveAttribute("title", "Place: Lamp (5)");
  await expect(entry(page, "programmable-speaker")).toHaveAttribute("title", "Place: Programmable speaker");
  await expect(entry(page, "programmable-speaker").locator(".entity-icon")).toBeVisible();

  // A pole says what the choice decides: the tiles it covers and its wire reach, on the entry and in its tooltip.
  await header(page, "Power poles").click();
  expect(await shownEntries(page)).toEqual([...COMBINATORS, ...LIGHTS, ...POLES]);
  await expect(group(page, "Power poles").locator(".palette-item strong")).toHaveText(["Small electric pole", "Medium electric pole", "Big electric pole", "Substation"]);
  await expect(group(page, "Power poles").locator(".palette-item small")).toHaveText(["1 tile, wire reach 7.5", "1 tile, wire reach 9", "2 x 2 tiles, wire reach 32", "2 x 2 tiles, wire reach 18"]);
  await expect(entry(page, "big-electric-pole")).toHaveAttribute("title", "Place: Big electric pole (2 x 2 tiles, wire reach 32)");
  await expect(group(page, "Power poles").locator("kbd")).toHaveCount(0);
  for (const prototype of POLES) await expect(entry(page, prototype)).toHaveAttribute("data-kind", "pole");
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
  expect(await openGroups(page)).toEqual({ "Lights and sound": false, "Power poles": false });
  expect(await shownEntries(page)).toEqual(COMBINATORS);
  // No key of the circuit was triggered on the way, and nothing was placed.
  expect(await activeTool(page)).toEqual({ type: "select" });
});

test("which groups are open is remembered across a restart, for every project", async () => {
  const first = await launchApp();
  let second: { app: ElectronApplication; page: Page } | undefined;
  try {
    expect(await openGroups(first.page)).toEqual({ "Lights and sound": true, "Power poles": false });
    await header(first.page, "Lights and sound").click();
    await header(first.page, "Power poles").click();
    expect(await openGroups(first.page)).toEqual({ "Lights and sound": false, "Power poles": true });
    // The state is not part of a project: another project shows the same groups, and it is not an unsaved change.
    await openFiveKinds(first.page);
    expect(await openGroups(first.page)).toEqual({ "Lights and sound": false, "Power poles": true });
    await expect(first.page.locator(".project-meta")).toContainText("All changes saved");
    // Source mode takes the palette away; it comes back as it was.
    await first.page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(palette(first.page)).toHaveCount(0);
    await first.page.getByRole("button", { name: "Circuit", exact: true }).click();
    expect(await openGroups(first.page)).toEqual({ "Lights and sound": false, "Power poles": true });
    await closeApp(first.app);

    second = await launchApp({ userData: first.userData });
    expect(await openGroups(second.page)).toEqual({ "Lights and sound": false, "Power poles": true });
    expect(await shownEntries(second.page)).toEqual([...COMBINATORS, ...POLES]);
    // And back: what is stored follows every change.
    await header(second.page, "Power poles").click();
    await closeApp(second.app);
    second = await launchApp({ userData: first.userData });
    expect(await openGroups(second.page)).toEqual({ "Lights and sound": false, "Power poles": false });
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
  expect(await openGroups(page)).toEqual({ "Lights and sound": true, "Power poles": false });
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
  expect(await openGroups(page)).toEqual({ "Lights and sound": false, "Power poles": true });
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

test("with every group open the groups scroll in their own area and the entity list stays in reach, down to the smallest window", async ({ page, app }) => {
  await openFiveKinds(page);
  const measure = () =>
    page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const [panel, groups, list] = [document.querySelector(".palette")!, document.querySelector(".palette-groups")!, document.querySelector(".entity-list")!];
      return {
        window: [window.innerWidth, window.innerHeight],
        // Nothing of the panel is cut off or pushed out of it.
        overflow: panel.scrollHeight - panel.clientHeight,
        listInside: box(".entity-list").bottom <= box(".palette").bottom + 0.5 && box(".entity-list").top >= box(".palette-groups").bottom,
        combinatorsInside: [...document.querySelectorAll(".palette-items .palette-item")].every((item) => item.getBoundingClientRect().bottom <= box(".palette-groups").top),
        groups: { height: groups.clientHeight, content: groups.scrollHeight },
        list: { height: list.clientHeight, content: list.scrollHeight },
      };
    });

  // As the groups start, at the size the window starts with, the selector shows all of itself: nothing to scroll.
  const start = await measure();
  // (The area is as high as its content to a fraction of a pixel, which the two whole numbers round apart.)
  expect(start.groups.content - start.groups.height).toBeLessThanOrEqual(1);
  expect(start.overflow).toBe(0);
  await header(page, "Power poles").click();
  expect(await shownEntries(page)).toHaveLength(10);

  for (const size of ["default", "minimum"] as const) {
    if (size === "minimum") {
      await app.evaluate(({ BrowserWindow }) => {
        const [window] = BrowserWindow.getAllWindows();
        const [width = 0, height = 0] = window!.getMinimumSize();
        window!.setSize(width, height);
      });
      await expect.poll(async () => (await measure()).window[0]).toBeLessThan(1200);
    }
    const layout = await measure();
    expect(layout.overflow, size).toBe(0);
    expect(layout.listInside, size).toBe(true);
    expect(layout.combinatorsInside, size).toBe(true);
    // The groups show at least a heading and an entry, the list at least one of its rows, and what does not fit scrolls.
    expect(layout.groups.height, size).toBeGreaterThanOrEqual(56);
    expect(layout.list.height, size).toBeGreaterThanOrEqual(40);
    expect(layout.groups.content, size).toBeGreaterThan(layout.groups.height + 20);

    // The four combinators are on show whatever the groups do, each with its name and its key.
    for (const prototype of COMBINATORS) await expect(entry(page, prototype)).toBeInViewport({ ratio: 1 });
    await expect(palette(page).locator(".palette-items kbd.key-hint")).toHaveText(["1", "2", "3", "4"]);
    for (const cap of await palette(page).locator(".palette-items kbd.key-hint").all()) await expect(cap).toBeVisible();
    // The last entry of the last group is reached by scrolling the groups, and it works.
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
    // The groups are still where they were scrolled to: the two areas scroll on their own.
    await expect(entry(page, "substation")).toBeInViewport({ ratio: 1 });
  }
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
    expect(await openGroups(page)).toEqual({ "Lights and sound": true, "Power poles": true });

    // By keyboard, as a button.
    await listHeader(page).focus();
    await page.keyboard.press("Enter");
    await expect(listHeader(page)).toHaveAttribute("aria-expanded", "true");
    await expect(list(page).getByRole("button")).toHaveCount(5);
    await page.keyboard.press("Space");
    await expect(listHeader(page)).toHaveAttribute("aria-expanded", "false");
    await closeApp(first.app);

    second = await launchApp({ userData: first.userData });
    await expect(listHeader(second.page)).toHaveAttribute("aria-expanded", "false");
    await expect(list(second.page)).toBeHidden();
    await listHeader(second.page).click();
    await expect(list(second.page).getByRole("button")).not.toHaveCount(0);
  } finally {
    await closeApp(first.app);
    if (second) await closeApp(second.app);
  }
});
