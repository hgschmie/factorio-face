// The entity selector of the sidebar: every entity a square tile with a popup that says what it is; the four combinators always
// on show, "Entities in use" following the circuit, and under them every entity of the project's modules where the game has the
// item that builds it: a tab per item group, its subgroups as rows, a search through all of them. What is on show is remembered
// on this machine, and every tile places its entity on the edit canvas and on the board.
import type { ElectronApplication, Page } from "@playwright/test";
import { resolve } from "node:path";
import { encodeBlueprintString } from "../../packages/blueprints/src/string.ts";
import { canvas, card, clientPointOf, closeApp, EMPTY_SOURCE, entityNames, entityPosition, expect, launchApp, openProject, SCREENSHOT_DIR, showDisplay, shrinkToMinimum, sourceText, test, writeProject } from "./app.ts";
import { footprint, openBoard, setSource, tilePoint, TILE } from "./board.ts";
import { FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

const SHOTS = resolve(SCREENSHOT_DIR, "entities-ui");
const palette = (page: Page) => page.getByRole("complementary", { name: "Components" });
const header = (page: Page, name: string) => palette(page).locator(".palette-group-header", { hasText: name });
const tabs = (page: Page) => palette(page).getByRole("tablist", { name: "Entity groups" });
const tab = (page: Page, name: string) => tabs(page).getByRole("tab", { name, exact: true });
const tabPanel = (page: Page) => palette(page).getByRole("tabpanel");
const search = (page: Page) => palette(page).getByRole("searchbox", { name: "Search entities" });
/** The entry of the palette for a prototype: its tile among the combinators, or in its group for every other one. */
const entry = (page: Page, prototype: string) => palette(page).locator(`.palette-item[data-prototype="${prototype}"]`);
/** The tile of a prototype in "Entities in use". */
const inUse = (page: Page, prototype: string) => palette(page).locator(`.palette-tile.in-use[data-prototype="${prototype}"]`);
const popup = (page: Page) => page.locator(".tile-popup");
const hint = (page: Page) => page.locator(".canvas-hint");
const toast = (page: Page) => page.getByRole("alert");
const activeTool = (page: Page) => page.evaluate(() => window.faceSession!.getState().tool);
const selectTool = (page: Page) => page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Select and move" });

/** Waits until the tab of a group is the one on show; with null, until none is (a search is on show). */
async function expectTab(page: Page, name: string | null): Promise<void> {
  const selected = tabs(page).locator('[role="tab"][aria-selected="true"]');
  if (name === null) await expect(selected).toHaveCount(0);
  else await expect(selected).toHaveAccessibleName(name);
}

/** The rows of tiles under the tabs, top to bottom: per subgroup of the game its prototypes. */
async function shownRows(page: Page): Promise<[string, string[]][]> {
  return tabPanel(page)
    .locator(".palette-subgroup")
    .evaluateAll((rows) => rows.map((row) => [row.getAttribute("data-subgroup") ?? "", [...row.querySelectorAll(".palette-tile")].map((tile) => tile.getAttribute("data-prototype") ?? "")]));
}

/** The prototypes of the tiles in "Entities in use", in their order. */
async function entitiesInUse(page: Page): Promise<string[]> {
  return palette(page).locator(".palette-tile.in-use").evaluateAll((items) => items.map((item) => item.getAttribute("data-prototype") ?? ""));
}

const COMBINATORS = ["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator"];
const LOGISTICS: [string, string[]][] = [
  ["storage", ["wooden-chest", "iron-chest", "steel-chest", "storage-tank"]],
  ["belt", ["transport-belt", "fast-transport-belt", "express-transport-belt", "turbo-transport-belt", "splitter", "fast-splitter", "express-splitter", "turbo-splitter"]],
  ["inserter", ["burner-inserter", "inserter", "long-handed-inserter", "fast-inserter", "bulk-inserter", "stack-inserter"]],
  ["energy-pipe-distribution", ["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation", "pipe", "pipe-to-ground", "pump"]],
  ["train-transport", ["train-stop", "rail-signal", "rail-chain-signal"]],
  ["logistic-network", ["active-provider-chest", "passive-provider-chest", "storage-chest", "buffer-chest", "requester-chest", "roboport"]],
  ["circuit-network", ["small-lamp", "arithmetic-combinator", "decider-combinator", "selector-combinator", "constant-combinator", "power-switch", "programmable-speaker", "display-panel"]],
];
const PRODUCTION: [string, string[]][] = [
  ["energy", ["boiler", "accumulator", "nuclear-reactor", "heat-pipe", "heat-exchanger"]],
  ["extraction-machine", ["burner-mining-drill", "electric-mining-drill", "big-mining-drill", "offshore-pump", "pumpjack"]],
  ["smelting-machine", ["stone-furnace", "steel-furnace", "electric-furnace", "foundry", "recycler"]],
  ["agriculture", ["agricultural-tower", "biochamber"]],
  ["production-machine", ["assembling-machine-1", "assembling-machine-2", "assembling-machine-3", "oil-refinery", "chemical-plant", "centrifuge", "electromagnetic-plant", "cryogenic-plant", "lab", "biolab"]],
  ["environmental-protection", ["heating-tower"]],
];
const SPACE: [string, string[]][] = [
  ["space-interactors", ["rocket-silo", "cargo-landing-pad"]],
  ["space-platform", ["space-platform-hub", "asteroid-collector", "crusher"]],
];
const COMBAT: [string, string[]][] = [
  ["defensive-structure", ["stone-wall", "radar", "land-mine"]],
  ["turret", ["gun-turret", "laser-turret", "flamethrower-turret", "artillery-turret", "rocket-turret", "tesla-turret", "railgun-turret"]],
];

test("the combinators are the first row; under them the entities of the game in a tab per item group, each subgroup a row of tiles in the game's order", async ({ page }) => {
  // The example is a Space Age project: 85 of the game's 98 wired entities can be built, the others are hidden by the game.
  await expect(palette(page).locator(".count-badge")).toHaveText("85");
  expect(await tabs(page).getByRole("tab").evaluateAll((all) => all.map((element) => element.getAttribute("aria-label")))).toEqual(["Logistics", "Production", "Space", "Combat"]);
  await expectTab(page, "Logistics");
  await expect(tabPanel(page)).toHaveAccessibleName("Logistics");
  expect(await shownRows(page)).toEqual(LOGISTICS);

  // The combinators are the first row; they belong to no section. "Entities in use" follows, then the search and the tabs.
  const pinned = palette(page).locator(".palette-items .palette-item");
  await expect(pinned).toHaveCount(4);
  expect(await pinned.evaluateAll((items) => items.map((item) => item.getAttribute("data-prototype")))).toEqual(COMBINATORS);
  await expect(palette(page).locator(".palette-group-header .palette-group-name")).toHaveText(["Entities in use"]);
  const tops = await Promise.all([pinned.first(), header(page, "Entities in use"), search(page), tabs(page), tabPanel(page)].map(async (part) => (await part.boundingBox())!.y));
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);

  // A tile is its icon and nothing else: the game's name is its accessible name, and it has no tooltip of its own (the popup says the rest).
  const tiles = palette(page).locator(".palette-tile");
  await expect(tiles).toHaveCount(4 + 1 + 42);
  for (const tile of await tiles.all()) {
    await expect(tile.locator(".entity-icon")).toHaveCount(1);
    await expect(tile).toHaveText("");
    await expect(tile).not.toHaveAttribute("title");
    await expect(tile).toHaveAttribute("aria-pressed", "false");
  }
  // One entry of the palette per prototype: a combinator has its entry in the first row and a second tile in its subgroup.
  for (const prototype of COMBINATORS) {
    await expect(entry(page, prototype)).toHaveCount(1);
    await expect(tabPanel(page).locator(`.palette-tile.pinned-copy[data-prototype="${prototype}"]`)).toHaveCount(1);
  }
  await expect(entry(page, "small-lamp")).toHaveAccessibleName("Lamp");
  await expect(entry(page, "stone-wall")).toHaveCount(0);
  await expect(entry(page, "fast-inserter")).toHaveAttribute("data-kind", "entity");
  await expect(entry(page, "big-electric-pole")).toHaveAttribute("data-kind", "pole");

  // The combinators four in a row; every other tile six in a row, square, in the same columns from the entities in use down.
  const boxes = async (scope: string): Promise<{ x: number; y: number; width: number; height: number }[]> =>
    palette(page).locator(`${scope} .palette-tile`).evaluateAll((items) => items.map((item) => {
      const { x, y, width, height } = item.getBoundingClientRect();
      return { x, y, width, height };
    }));
  const first = await boxes(".palette-items");
  expect(new Set(first.map((box) => box.y)).size).toBe(1);
  expect(first[0]!.width).toBeGreaterThan(40);
  expect(first[0]!.width).toBeLessThan(52);
  const side = (await palette(page).boundingBox())!;
  expect(Math.abs(first[0]!.x - side.x - (side.x + side.width - first[3]!.x - first[3]!.width))).toBeLessThan(2);
  const belts = await boxes('[data-subgroup="belt"]');
  expect(belts).toHaveLength(8);
  // Eight belts and splitters: six in the first row, two in the second, under the first two.
  expect(new Set(belts.slice(0, 6).map((box) => box.y)).size).toBe(1);
  expect(belts[6]!.y).toBeGreaterThan(belts[0]!.y);
  expect(Math.abs(belts[6]!.x - belts[0]!.x)).toBeLessThan(0.5);
  const columns = belts.slice(0, 6).map((box) => box.x);
  expect(Math.abs(columns[0]! - first[0]!.x)).toBeLessThan(0.5);
  expect(Math.abs(columns[5]! + belts[5]!.width - first[3]!.x - first[3]!.width)).toBeLessThan(1.5);
  for (const scope of ['[data-group="in-use"]', '[data-subgroup="storage"]', '[data-subgroup="inserter"]', '[data-subgroup="circuit-network"]']) {
    for (const [index, box] of (await boxes(scope)).entries()) {
      expect(Math.abs(box.x - columns[index % 6]!), scope).toBeLessThan(0.5);
      expect(Math.abs(box.width - belts[0]!.width), scope).toBeLessThan(0.5);
      expect(Math.abs(box.width - box.height), scope).toBeLessThan(0.5);
    }
  }
  expect(belts[0]!.width).toBeGreaterThan(29);
  expect(belts[0]!.width).toBeLessThan(34);
});

test("a tab shows its group, by pointer and by keyboard; a project without Space Age has fewer tabs and entities", async ({ page }) => {
  for (const [name, rows] of [["Production", PRODUCTION], ["Space", SPACE], ["Combat", COMBAT], ["Logistics", LOGISTICS]] as const) {
    await tab(page, name).click();
    await expectTab(page, name);
    await expect(tabPanel(page)).toHaveAccessibleName(name);
    expect(await shownRows(page)).toEqual(rows);
    await page.screenshot({ path: resolve(SHOTS, `selector-tab-${name.toLowerCase()}.png`) });
  }
  // A tab is a button in the tab order; Enter and Space both show it, and its tiles follow it.
  await tab(page, "Combat").focus();
  await page.keyboard.press("Enter");
  await expectTab(page, "Combat");
  await page.keyboard.press("Tab");
  await expect(entry(page, "stone-wall")).toBeFocused();
  await tab(page, "Space").focus();
  await page.keyboard.press("Space");
  await expectTab(page, "Space");
  // No key of the circuit was triggered on the way, and nothing was placed.
  expect(await activeTool(page)).toEqual({ type: "select" });

  // The base game alone: no Space group (the rocket silo is in Production), no entity of Space Age or of the recycler.
  await openProject(page, await writeProject({ name: "Base", source: EMPTY_SOURCE, manifest: { modules: ["base"] } }));
  await expect(palette(page).locator(".count-badge")).toHaveText("67");
  expect(await tabs(page).getByRole("tab").evaluateAll((all) => all.map((element) => element.getAttribute("aria-label")))).toEqual(["Logistics", "Production", "Combat"]);
  // The tab that was on show is gone: the first one is.
  await expectTab(page, "Logistics");
  expect(await shownRows(page)).toEqual(LOGISTICS.map(([name, prototypes]) => [name, prototypes.filter((prototype) => !/turbo|stack/.test(prototype))]));
  await tab(page, "Production").click();
  expect(await shownRows(page)).toEqual([
    ["energy", ["boiler", "accumulator", "nuclear-reactor", "heat-pipe", "heat-exchanger"]],
    ["extraction-machine", ["burner-mining-drill", "electric-mining-drill", "offshore-pump", "pumpjack"]],
    ["smelting-machine", ["stone-furnace", "steel-furnace", "electric-furnace"]],
    ["production-machine", ["assembling-machine-1", "assembling-machine-2", "assembling-machine-3", "oil-refinery", "chemical-plant", "centrifuge", "lab"]],
    ["space-related", ["rocket-silo", "cargo-landing-pad"]],
  ]);
  await tab(page, "Combat").click();
  expect(await shownRows(page)).toEqual([["defensive-structure", ["stone-wall", "radar", "land-mine"]], ["turret", ["gun-turret", "laser-turret", "flamethrower-turret", "artillery-turret"]]]);
  await page.screenshot({ path: resolve(SHOTS, "selector-base-only.png") });
  // Switching the module on in the project settings brings its entities and its tab.
  await page.evaluate(() => window.faceSession!.commands.setModuleEnabled("space-age", true));
  await expect(palette(page).locator(".count-badge")).toHaveText("85");
  await expect(tab(page, "Space")).toHaveCount(1);
});

test("the search looks through every group by name, shows what it finds under the names of the groups, and goes with Escape or a tab", async ({ page }) => {
  const groupsFound = () => tabPanel(page).locator("h3").allTextContents();
  const found = async (): Promise<string[]> => (await shownRows(page)).flatMap(([, prototypes]) => prototypes);
  await tab(page, "Combat").click();
  await search(page).fill("chest");
  // Every group is searched, whatever tab was on show; no tab is selected while the results are.
  await expectTab(page, null);
  await expect(tabPanel(page)).toHaveAccessibleName("Search results");
  expect(await groupsFound()).toEqual(["Logistics"]);
  expect(await found()).toEqual(["wooden-chest", "iron-chest", "steel-chest", "active-provider-chest", "passive-provider-chest", "storage-chest", "buffer-chest", "requester-chest"]);
  // The rows stay those of the game.
  expect((await shownRows(page)).map(([name]) => name)).toEqual(["storage", "logistic-network"]);
  await page.screenshot({ path: resolve(SHOTS, "selector-search.png") });

  await search(page).fill("PUMP");
  expect(await groupsFound()).toEqual(["Logistics", "Production"]);
  expect(await found()).toEqual(["pump", "offshore-pump", "pumpjack"]);
  // By the name in the game or by the prototype name: the wall is "Wall" and `stone-wall`.
  await search(page).fill("stone-w");
  expect(await found()).toEqual(["stone-wall"]);
  await search(page).fill("wall");
  expect(await found()).toEqual(["stone-wall"]);
  // A hidden entity is not found, and nothing says so but the line.
  await search(page).fill("loader");
  expect(await found()).toEqual([]);
  await expect(tabPanel(page)).toHaveText('No entity matches "loader".');

  // Typing is text: the keys of the circuit do nothing while the field has the focus.
  await search(page).fill("");
  await search(page).pressSequentially("r5q");
  expect(await activeTool(page)).toEqual({ type: "select" });
  expect(await found()).toEqual([]);
  // Enter arms the first entity found; the results stay, with its tile pressed.
  await search(page).fill("turret");
  await page.keyboard.press("Enter");
  expect(await activeTool(page)).toEqual({ type: "place", kind: "entity", prototype: "gun-turret" });
  await expect(entry(page, "gun-turret")).toHaveAttribute("aria-pressed", "true");
  expect(await found()).toHaveLength(7);
  await expect(search(page)).toHaveValue("turret");
  // A click on a tile found arms it like any tile.
  await entry(page, "laser-turret").click();
  expect(await activeTool(page)).toEqual({ type: "place", kind: "entity", prototype: "laser-turret" });
  await expect(search(page)).toHaveValue("turret");
  await page.keyboard.press("q");

  // Escape in the field empties it: the tab that was on show is back.
  await search(page).focus();
  await page.keyboard.press("Escape");
  await expect(search(page)).toHaveValue("");
  await expectTab(page, "Combat");
  expect(await shownRows(page)).toEqual(COMBAT);
  // A tab ends a search as well.
  await search(page).fill("belt");
  await tab(page, "Space").click();
  await expect(search(page)).toHaveValue("");
  expect(await shownRows(page)).toEqual(SPACE);
  // A tool whose tile the search does not show ends it: the key of the lamp brings its tab.
  await search(page).fill("turret");
  await canvas(page).focus();
  await page.keyboard.press("5");
  await expect(search(page)).toHaveValue("");
  await expectTab(page, "Logistics");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
});

test("a tile says what it is in a popup on hover and on keyboard focus, beside the sidebar and off every tile", async ({ page }) => {
  const lines = () => popup(page).locator(".tile-popup-text p");
  await expect(popup(page)).toHaveCount(0);
  // Hover, after a moment: the name in the game, what it is for, its tiles and its key, said so that it is no count.
  await entry(page, "decider-combinator").hover();
  await expect(popup(page)).toHaveCount(0);
  await expect(popup(page)).toHaveAttribute("data-prototype", "decider-combinator");
  await expect(popup(page)).toHaveRole("tooltip");
  await expect(popup(page).locator(".tile-popup-name")).toHaveText("Decider combinator");
  await expect(lines()).toHaveText(["Compare and decide", "1 x 2 tiles", "Key 3"]);
  await expect(popup(page).locator(".tile-popup-key kbd")).toHaveText("3");
  await expect(popup(page).locator(".bubble-pointer")).toBeVisible();
  // It describes the tile to assistive technology, which already has the name.
  await expect(entry(page, "decider-combinator")).toHaveAccessibleName("Decider combinator");
  await expect(entry(page, "decider-combinator")).toHaveAccessibleDescription("Compare and decide 1 x 2 tiles Key 3");
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
  await expect(lines()).toHaveText(["See a condition light up", "1 tile", "Key 5"]);
  await entry(page, "programmable-speaker").hover();
  await beside("programmable-speaker");
  await expect(popup(page).locator(".tile-popup-name")).toHaveText("Programmable speaker");
  await expect(lines()).toHaveText(["Sound an alert on a condition", "1 tile"]);
  await expect(popup(page).locator("kbd")).toHaveCount(0);
  // The tile of the lamp in "Entities in use" has the same popup, at its own place.
  await inUse(page, "small-lamp").hover();
  await beside("small-lamp", inUse(page, "small-lamp"));
  await expect(inUse(page, "small-lamp")).toHaveAccessibleDescription("See a condition light up 1 tile Key 5");
  await expect(entry(page, "small-lamp")).toHaveAccessibleDescription("");
  // So has the second tile of a combinator, in its subgroup.
  const copy = tabPanel(page).locator('.pinned-copy[data-prototype="decider-combinator"]');
  await copy.hover();
  await beside("decider-combinator", copy);

  // An entity of the game is named as the game names it and says what its type does on a circuit, its tiles, and its wire
  // reach where that is not the project's.
  await entry(page, "fast-inserter").hover();
  await beside("fast-inserter");
  await expect(popup(page).locator(".tile-popup-name")).toHaveText("Fast inserter");
  await expect(lines()).toHaveText(["Switch it on a condition, set filters and stack size, read its hand", "1 tile"]);
  await entry(page, "splitter").hover();
  await expect(lines()).toHaveText(["Set its priorities and its filter by signal", "2 x 1 tiles"]);
  await entry(page, "big-electric-pole").hover();
  await beside("big-electric-pole");
  await expect(lines()).toHaveText(["Relay signals over a distance", "2 x 2 tiles, wire reach 32"]);
  await entry(page, "power-switch").hover();
  await expect(lines()).toHaveText(["Join two power networks on a condition", "2 x 2 tiles, wire reach 10"]);
  await page.screenshot({ path: resolve(SHOTS, "selector-popup.png") });
  await tab(page, "Production").hover();
  await expect(popup(page)).toHaveCount(0);
  await tab(page, "Production").click();
  await entry(page, "agricultural-tower").hover();
  await expect(popup(page).locator(".tile-popup-name")).toHaveText("Agricultural tower");
  await expect(lines()).toHaveText(["Harvest and plant on conditions", "3 x 3 tiles, wire reach 30"]);
  await tab(page, "Space").click();
  await entry(page, "rocket-silo").hover();
  await expect(lines()).toHaveText(["Read its items and a launch", "9 x 9 tiles"]);
  await tab(page, "Combat").click();
  await entry(page, "stone-wall").hover();
  await expect(popup(page).locator(".tile-popup-name")).toHaveText("Wall");
  // Away from the tiles it goes.
  await canvas(page).hover();
  await expect(popup(page)).toHaveCount(0);

  // Keyboard focus shows it without a wait, and takes it along from tile to tile.
  await tab(page, "Combat").focus();
  await page.keyboard.press("Tab");
  await expect(entry(page, "stone-wall")).toBeFocused();
  await beside("stone-wall");
  await page.keyboard.press("Tab");
  await expect(entry(page, "radar")).toBeFocused();
  await beside("radar");
  await expect(lines()).toHaveText(["Share signals with every radar of the surface", "3 x 3 tiles"]);
  // Space arms the tile; the popup stays while the focus does.
  await page.keyboard.press("Space");
  await expect(entry(page, "radar")).toHaveAttribute("aria-pressed", "true");
  await beside("radar");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(tab(page, "Combat")).toBeFocused();
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
  await expect(lines()).toHaveText(["Transform your signals", "1 x 2 tiles", "Key 2"]);
});

test('"Entities in use" has a tile for each kind of entity the circuit contains, apart from the combinators, and follows the circuit', async ({ page }) => {
  const used = header(page, "Entities in use");
  const sectionBox = async () => (await palette(page).locator('.palette-group[data-group="in-use"]').boundingBox())!;
  // The example has a lamp. The section sits between the combinators and the search.
  expect(await entitiesInUse(page)).toEqual(["small-lamp"]);
  await expect(used.locator(".palette-group-count")).toHaveText("1");
  const filled = await sectionBox();
  expect(filled.y).toBeGreaterThan((await entry(page, "constant-combinator").boundingBox())!.y);
  expect(filled.y + filled.height).toBeLessThanOrEqual((await search(page).boundingBox())!.y);

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
  const tabsBox = (await tabs(page).boundingBox())!;
  await page.keyboard.press("5");
  await page.keyboard.press("Enter");
  await expect(card(page, "lamp1")).toHaveCount(1);
  expect(await entitiesInUse(page)).toEqual(["small-lamp"]);
  await expect(used.locator(".palette-group-count")).toHaveText("1");
  // (The armed tile was scrolled into view; the sections are compared where they started.)
  await palette(page).locator(".palette-groups").evaluate((groups) => groups.scrollTo(0, 0));
  expect(await sectionBox()).toEqual(filled);
  expect(await tabs(page).boundingBox()).toEqual(tabsBox);

  // More kinds, from several tabs and in another order than the game has them: the tiles are in the game's order, one per prototype.
  const place = async (group: string, prototype: string, name: string): Promise<void> => {
    await tab(page, group).click();
    await entry(page, prototype).click();
    await canvas(page).focus();
    await page.keyboard.press("Enter");
    await expect(card(page, name)).toHaveCount(1);
  };
  await place("Combat", "gun-turret", "gun_turret1");
  await place("Logistics", "substation", "pole1");
  await place("Logistics", "programmable-speaker", "speaker1");
  await place("Space", "rocket-silo", "rocket_silo1");
  await place("Logistics", "substation", "pole2");
  await place("Logistics", "fast-inserter", "fast_inserter1");
  await place("Logistics", "small-electric-pole", "pole3");
  await place("Production", "assembling-machine-2", "assembling_machine1");
  expect(await entitiesInUse(page)).toEqual(["fast-inserter", "small-electric-pole", "substation", "small-lamp", "programmable-speaker", "assembling-machine-2", "rocket-silo", "gun-turret"]);
  await expect(used.locator(".palette-group-count")).toHaveText("8");
  // Eight tiles are two rows of six.
  expect(new Set(await palette(page).locator(".palette-tile.in-use").evaluateAll((tiles) => tiles.map((tile) => tile.getBoundingClientRect().top))).size).toBe(2);

  // A tile in use arms the tool like the entry in its group, and both show it; it places the same entity.
  await tab(page, "Logistics").click();
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
  // A tile in use of another tab arms its tool and brings its tab.
  await inUse(page, "gun-turret").click();
  expect(await activeTool(page)).toEqual({ type: "place", kind: "entity", prototype: "gun-turret" });
  await expectTab(page, "Combat");
  await expect(entry(page, "gun-turret")).toHaveAttribute("aria-pressed", "true");
  // Clicking it again while it is armed returns to the select tool; the key of the lamp lights both of its tiles.
  await inUse(page, "gun-turret").click();
  expect(await activeTool(page)).toEqual({ type: "select" });
  await page.keyboard.press("5");
  await expect(inUse(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("q");

  // The last entity of a kind goes: so does its tile. Undo brings both back.
  await page.evaluate(() => {
    const { getState, commands } = window.faceSession!;
    commands.deleteEntities(getState().circuit.entities.filter((entity) => entity.name === "speaker1" || entity.name === "pole3" || entity.name === "rocket_silo1").map((entity) => entity.id));
  });
  expect(await entitiesInUse(page)).toEqual(["fast-inserter", "substation", "small-lamp", "assembling-machine-2", "gun-turret"]);
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await entitiesInUse(page)).toHaveLength(8);
  // Typing in the source counts like any edit, and so does a prototype changed there.
  await setSource(page, (await sourceText(page)).replace("prototype = fast-inserter", "prototype = bulk-inserter"));
  expect((await entitiesInUse(page))[0]).toBe("bulk-inserter");

  // The section closes; its heading and its count stay.
  await used.click();
  await expect(used).toHaveAttribute("aria-expanded", "false");
  await expect(palette(page).locator(".palette-tile.in-use")).toHaveCount(0);
  await expect(used.locator(".palette-group-count")).toHaveText("8");
  await used.focus();
  await page.keyboard.press("Enter");
  expect(await entitiesInUse(page)).toHaveLength(8);
});

/** A blueprint with entities the game hides: a loader and a chest of its editor, next to a chest and a lamp. */
const HIDDEN = {
  blueprint: {
    entities: [
      { entity_number: 1, name: "iron-chest", position: { x: 0.5, y: 0.5 } },
      { entity_number: 2, name: "loader", position: { x: 2.5, y: 1 }, direction: 4, type: "input" },
      { entity_number: 3, name: "infinity-chest", position: { x: 4.5, y: 0.5 } },
      { entity_number: 4, name: "small-lamp", position: { x: 6.5, y: 0.5 } },
    ],
    wires: [[1, 1, 2, 1], [2, 1, 3, 1], [3, 1, 4, 1]],
    item: "blueprint",
    label: "Hidden",
    version: 562954249961472,
  },
};

test("an entity the game hides is in no tab, but one a blueprint brought shows in \"Entities in use\" and can be placed from there", async ({ page }) => {
  await search(page).fill("infinity");
  await expect(tabPanel(page)).toHaveText('No entity matches "infinity".');
  await search(page).fill("");
  // The import, as File > Import does it: read the string, open what it holds.
  await page.evaluate(async (text) => {
    const { commands } = window.faceSession!;
    const reading = commands.readBlueprint(text);
    if (reading.kind !== "blueprint") throw new Error(`Not a blueprint: ${reading.kind}`);
    await commands.openBlueprint(reading.blueprint);
  }, encodeBlueprintString(HIDDEN));
  await expect(card(page, "loader1")).toHaveCount(1);
  expect(await entityNames(page)).toEqual(["iron_chest1", "loader1", "infinity_chest1", "lamp1"]);
  // In the game's order: the loader is a belt, the chest of the editor comes last.
  expect(await entitiesInUse(page)).toEqual(["iron-chest", "loader", "small-lamp", "infinity-chest"]);
  await expect(palette(page).locator(".count-badge")).toHaveText("85");
  for (const hidden of ["loader", "infinity-chest"]) await expect(entry(page, hidden)).toHaveCount(0);
  await inUse(page, "loader").hover();
  await expect(popup(page).locator(".tile-popup-name")).toHaveText("Loader");
  await expect(popup(page).locator(".tile-popup-text p")).toHaveText(["Switch it on a condition, set its filters by signal", "1 x 2 tiles"]);
  await page.screenshot({ path: resolve(SHOTS, "selector-in-use-hidden.png") });
  // The tile places another one; no tab changes for it, since none holds it.
  await inUse(page, "loader").click();
  expect(await activeTool(page)).toEqual({ type: "place", kind: "entity", prototype: "loader" });
  await expect(inUse(page, "loader")).toHaveAttribute("aria-pressed", "true");
  await expectTab(page, "Logistics");
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "loader2")).toHaveClass(/selected/);
  expect((await footprint(page, "loader2")).size).toEqual([2, 1]);
  expect(await entitiesInUse(page)).toHaveLength(4);
});

test("the tab on show and the open sections are remembered across a restart, for every project; a search lasts as long as the window", async () => {
  const first = await launchApp();
  let second: { app: ElectronApplication; page: Page } | undefined;
  try {
    await expectTab(first.page, "Logistics");
    await tab(first.page, "Combat").click();
    await search(first.page).fill("gun");
    // Neither is part of a project: another project shows the same tab and search, and it is not an unsaved change.
    await openFiveKinds(first.page);
    await expect(search(first.page)).toHaveValue("gun");
    await expect(entry(first.page, "gun-turret")).toHaveCount(1);
    await expect(first.page.locator(".project-meta")).toContainText("All changes saved");
    // Source mode takes the palette away; it comes back as it was.
    await first.page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(palette(first.page)).toHaveCount(0);
    await first.page.getByRole("button", { name: "Circuit", exact: true }).click();
    await expect(search(first.page)).toHaveValue("gun");
    await search(first.page).fill("");
    await expectTab(first.page, "Combat");
    await search(first.page).fill("gun");
    await closeApp(first.app);

    // The restarted app shows what it starts with (the project that was open last) on the tab that was on show, without the search.
    second = await launchApp({ userData: first.userData, open: "start" });
    await expect(search(second.page)).toHaveValue("");
    await expectTab(second.page, "Combat");
    expect(await shownRows(second.page)).toEqual(COMBAT);
    // And back: what is stored follows every change. "Entities in use" is remembered as well.
    await tab(second.page, "Production").click();
    await header(second.page, "Entities in use").click();
    await closeApp(second.app);
    second = await launchApp({ userData: first.userData, open: "start" });
    await expectTab(second.page, "Production");
    await expect(header(second.page, "Entities in use")).toHaveAttribute("aria-expanded", "false");
    await expect(palette(second.page).locator(".palette-tile.in-use")).toHaveCount(0);
    await header(second.page, "Entities in use").click();
    expect(await entitiesInUse(second.page)).toEqual(["small-lamp"]);
  } finally {
    await closeApp(first.app);
    if (second) await closeApp(second.app);
  }
});

test("the palette works when the stored state is unreadable or storage refuses", async ({ page }) => {
  // Garbage in the store: the selector starts on its first tab with every section open.
  await page.evaluate(() => {
    localStorage.setItem("face.palette.tab", "{not a group");
    localStorage.setItem("face.palette.inUseOpen", "{not json");
    sessionStorage.setItem("face.palette.search", "");
  });
  await page.reload();
  await page.waitForSelector(".app-shell");
  await expectTab(page, "Logistics");
  await expect(header(page, "Entities in use")).toHaveAttribute("aria-expanded", "true");
  // A store that throws on every access: the tabs, the search and the sections still work, for as long as the window lives.
  await page.evaluate(() => {
    const refuse = (): never => {
      throw new DOMException("refused", "SecurityError");
    };
    Storage.prototype.getItem = refuse;
    Storage.prototype.setItem = refuse;
  });
  await tab(page, "Space").click();
  expect(await shownRows(page)).toEqual(SPACE);
  await search(page).fill("silo");
  await expect(entry(page, "rocket-silo")).toHaveCount(1);
  await search(page).fill("");
  await header(page, "Entities in use").click();
  await expect(header(page, "Entities in use")).toHaveAttribute("aria-expanded", "false");
  await entry(page, "rocket-silo").click();
  await expect(entry(page, "rocket-silo")).toHaveAttribute("aria-pressed", "true");
  await expect(toast(page)).toHaveCount(0);
});

test("the key 5 brings the tab of the lamp so that the armed entry is on show; the keys of the combinators need no tab", async ({ page }) => {
  await tab(page, "Combat").click();
  await expect(entry(page, "small-lamp")).toHaveCount(0);
  await canvas(page).focus();
  await page.keyboard.press("5");
  await expectTab(page, "Logistics");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
  await expect(entry(page, "small-lamp")).toBeInViewport({ ratio: 1 });
  await expect(palette(page).locator('.palette-item[aria-pressed="true"]')).toHaveCount(1);
  // The example has a lamp, so its tile in "Entities in use" is lit as well.
  await expect(palette(page).locator('.palette-tile[aria-pressed="true"]')).toHaveCount(2);
  await expect(hint(page)).toHaveText("Click the canvas (or press Enter on it) to place a lamp. Esc cancels.");

  // Another tab shown by hand while the tool is armed stays; the tool stays armed and still places.
  await tab(page, "Production").click();
  await expectTab(page, "Production");
  expect(await activeTool(page)).toEqual({ type: "place", kind: "lamp" });
  await page.keyboard.press("q");
  await expectTab(page, "Production");
  // The key again brings the tab again; the keys 1 to 4 arm a tile of the first row and leave the tab alone.
  await page.keyboard.press("5");
  await expectTab(page, "Logistics");
  await tab(page, "Space").click();
  await page.keyboard.press("3");
  await expect(entry(page, "decider-combinator")).toHaveAttribute("aria-pressed", "true");
  await expectTab(page, "Space");
  // Its second tile, in its subgroup, is pressed with it.
  await tab(page, "Logistics").click();
  await expect(tabPanel(page).locator('.pinned-copy[data-prototype="decider-combinator"]')).toHaveAttribute("aria-pressed", "true");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "false");
  // The digits beyond 5 pick nothing: the other entries have no key.
  for (const digit of ["6", "7", "8", "9", "0"]) await page.keyboard.press(digit);
  expect(await activeTool(page)).toEqual({ type: "place", kind: "decider" });
});

/** One entry per kind of thing the selector places: what it is called, how it turns, and what the source says of it. */
const PLACED = [
  { group: "Logistics", prototype: "programmable-speaker", kind: "speaker", name: "speaker1", noun: "a speaker", title: "SPEAKER", turns: false, source: "speaker speaker1 at (0, 500) {\n    }" },
  { group: "Logistics", prototype: "big-electric-pole", kind: "pole", name: "pole1", noun: "a big electric pole", title: "BIG ELECTRIC POLE", turns: false, source: "pole pole1 at (240, 500) {\n        prototype = big-electric-pole\n    }" },
  { group: "Logistics", prototype: "steel-chest", kind: "entity", name: "steel_chest1", noun: "a steel chest", title: "STEEL CHEST", turns: false, source: "entity steel_chest1 at (480, 500) {\n        prototype = steel-chest\n    }" },
  { group: "Logistics", prototype: "fast-inserter", kind: "entity", name: "fast_inserter1", noun: "a fast inserter", title: "FAST INSERTER", turns: true, source: "entity fast_inserter1 at (720, 500) facing south {\n        prototype = fast-inserter\n    }" },
  { group: "Production", prototype: "assembling-machine-2", kind: "entity", name: "assembling_machine1", noun: "an assembling machine 2", title: "ASSEMBLING MACHINE 2", turns: true, source: "entity assembling_machine1 at (960, 500) facing south {\n        prototype = assembling-machine-2\n    }" },
  { group: "Space", prototype: "rocket-silo", kind: "entity", name: "rocket_silo1", noun: "a rocket silo", title: "ROCKET SILO", turns: false, source: "entity rocket_silo1 at (1200, 500) {\n        prototype = rocket-silo\n    }" },
  { group: "Combat", prototype: "stone-wall", kind: "entity", name: "stone_wall1", noun: "a wall", title: "WALL", turns: false, source: "entity stone_wall1 at (1440, 500) {\n        prototype = stone-wall\n    }" },
] as const;

test("a tile of every tab places its entity on the edit canvas, named after its prototype, with its prototype in the source", async ({ page }) => {
  await openFiveKinds(page);
  for (let step = 0; step < 5; step++) await page.getByRole("button", { name: "Zoom out" }).click();
  for (const [index, item] of PLACED.entries()) {
    await tab(page, item.group).click();
    await entry(page, item.prototype).click();
    await expect(entry(page, item.prototype)).toHaveAttribute("aria-pressed", "true");
    expect(await activeTool(page)).toEqual({ type: "place", kind: item.kind, prototype: item.prototype });
    // The hint names the entity. One that turns says so, and R turns what is about to be placed; the others say nothing and the keys do nothing.
    await expect(hint(page)).toHaveText(`Click the canvas (or press Enter on it) to place ${item.noun}${item.turns ? " facing east (R turns it)" : ""}. Esc cancels.`);
    await page.keyboard.press("r");
    if (item.turns) await expect(hint(page)).toContainText("facing south");
    else expect(await activeTool(page)).toEqual({ type: "place", kind: item.kind, prototype: item.prototype });
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
  expect((await entityNames(page)).slice(-PLACED.length)).toEqual(PLACED.map((item) => item.name));
  // A second one of a prototype gets the next number; a tier number at the end of the prototype is not part of the name.
  await tab(page, "Production").click();
  await entry(page, "assembling-machine-3").click();
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "assembling_machine2")).toHaveClass(/selected/);
  // An entity of the game has its one connection point on the top edge of its card, like a pole; a speaker an input on the left.
  for (const name of ["pole1", "steel_chest1", "fast_inserter1", "rocket_silo1"]) {
    expect(await card(page, name).locator("g.pin").evaluateAll((pins) => pins.map((pin) => `${pin.getAttribute("data-terminal")} ${pin.getAttribute("data-wire-color")} ${pin.getAttribute("data-edge")}`)), name).toEqual(["io red top", "io green top"]);
  }
  expect(await card(page, "speaker1").locator("g.pin").evaluateAll((pins) => pins.map((pin) => `${pin.getAttribute("data-terminal")} ${pin.getAttribute("data-edge")}`))).toEqual(["in left", "in left"]);
  // The entity list names all of them; one undo step per entity.
  await expect(palette(page).locator(".entity-list button")).toHaveCount(5 + PLACED.length + 1);
  for (let step = 0; step < PLACED.length + 1; step++) await page.getByRole("button", { name: "Undo" }).click();
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
});

/** Two lamps that span the board the next tests place on, so that Fit shows all of it. */
const corners = (width: number, height: number): string => `circuit "Corners" {
    lamp first at (0, 0) tile (0.5, 0.5) {
    }

    lamp last at (1380, 460) tile (${width - 0.5}, ${height - 0.5}) {
    }
}
`;

const ghost = (page: Page) => page.locator("rect.board-ghost");
const ghostOutline = (page: Page) =>
  ghost(page).evaluate((rect, tile) => {
    const [x, y, width, height] = ["data-tile-x", "data-tile-y", "width", "height"].map((name) => Number(rect.getAttribute(name)));
    return { tile: [x, y], size: [(width! + 8) / tile, (height! + 8) / tile], prototype: rect.getAttribute("data-prototype"), blocked: rect.classList.contains("blocked") };
  }, TILE);
/** The point at which the pointer has a footprint of `width` x `height` tiles with its top-left tile at (x, y) around it. */
const pointerFor = (page: Page, x: number, y: number, width: number, height = width) => tilePoint(page, x + (width - 1) / 2, y + (height - 1) / 2);

/**
 * One prototype per footprint and per way of turning: its tiles facing north (width x height), the directions the game builds it
 * in, and the top-left tile it is placed at. A new entity faces east, so one that turns and is not square stands turned.
 */
const FOOTPRINTS = [
  { group: "Logistics", prototype: "iron-chest", name: "iron_chest1", size: [1, 1], directions: 1, at: [2, 1] },
  { group: "Logistics", prototype: "fast-inserter", name: "fast_inserter1", size: [1, 1], directions: 4, at: [4, 1] },
  { group: "Logistics", prototype: "pump", name: "pump1", size: [1, 2], directions: 4, at: [6, 1] },
  { group: "Logistics", prototype: "splitter", name: "splitter1", size: [2, 1], directions: 4, at: [10, 1] },
  { group: "Logistics", prototype: "train-stop", name: "train_stop1", size: [2, 2], directions: 4, at: [13, 1] },
  { group: "Production", prototype: "stone-furnace", name: "stone_furnace1", size: [2, 2], directions: 1, at: [16, 1] },
  { group: "Production", prototype: "boiler", name: "boiler1", size: [3, 2], directions: 4, at: [19, 1] },
  { group: "Logistics", prototype: "storage-tank", name: "storage_tank1", size: [3, 3], directions: 2, at: [23, 1] },
  { group: "Production", prototype: "assembling-machine-1", name: "assembling_machine1", size: [3, 3], directions: 1, at: [27, 1] },
  { group: "Combat", prototype: "railgun-turret", name: "railgun_turret1", size: [3, 5], directions: 4, at: [31, 1] },
  { group: "Logistics", prototype: "roboport", name: "roboport1", size: [4, 4], directions: 1, at: [2, 7] },
  { group: "Production", prototype: "oil-refinery", name: "oil_refinery1", size: [5, 5], directions: 4, at: [7, 7] },
  { group: "Space", prototype: "cargo-landing-pad", name: "cargo_landing_pad1", size: [8, 8], directions: 1, at: [13, 7] },
  { group: "Space", prototype: "rocket-silo", name: "rocket_silo1", size: [9, 9], directions: 1, at: [22, 7] },
] as const;

test("on the board a tile of each footprint places an entity of the right size, turned as its directions allow, on free tiles only", async ({ page }) => {
  await openBoard(page, corners(38, 17));
  const before = await sourceText(page);
  const turned = ([width, height]: readonly [number, number]): [number, number] => [height, width];
  for (const item of FOOTPRINTS) {
    await tab(page, item.group).click();
    await entry(page, item.prototype).click();
    const [x, y] = item.at;
    // Facing east, as a new entity does: one that turns stands with its tiles turned.
    const east = item.directions > 1 ? turned(item.size) : [...item.size];
    const spot = await pointerFor(page, x, y, east[0]!, east[1]);
    await page.mouse.move(spot.x, spot.y, { steps: 3 });
    await expect.poll(() => ghostOutline(page), item.prototype).toEqual({ tile: [x, y], size: east, prototype: item.prototype, blocked: false });
    const arrow = page.locator("path.board-ghost-arrow");
    if (item.directions === 1) {
      // Nothing to turn and no direction to show: the keys leave the tool and the outline as they are.
      await expect(hint(page)).not.toContainText("turns it");
      await expect(arrow).toHaveCount(0);
      for (const key of ["r", "Shift+KeyR", "h", "v"]) await page.keyboard.press(key);
      expect(await activeTool(page), item.prototype).toEqual({ type: "place", kind: "entity", prototype: item.prototype });
      await expect.poll(() => ghostOutline(page), item.prototype).toMatchObject({ size: east });
    } else {
      await expect(hint(page)).toContainText("facing east (R turns it)");
      await expect(arrow).toHaveCount(1);
      const facings: string[] = [];
      const sizes: number[][] = [];
      for (const key of ["r", "r", "r", "r", "Shift+KeyR", "h", "h", "v"]) {
        await page.keyboard.press(key);
        facings.push(((await activeTool(page)) as { facing?: string }).facing ?? "east");
        sizes.push((await ghostOutline(page)).size);
      }
      // R clockwise four times, Shift+R back once, H mirrors east and west, V north and south. A storage tank has north and east only.
      expect(facings, item.prototype).toEqual(item.directions === 2 ? ["north", "east", "north", "east", "north", "north", "north", "north"] : ["south", "west", "north", "east", "north", "north", "north", "south"]);
      // Facing north or south it stands as the game data says, facing east or west turned.
      expect(sizes, item.prototype).toEqual(facings.map((facing) => (facing === "north" || facing === "south" ? [...item.size] : turned(item.size))));
      await page.keyboard.press(item.directions === 2 ? "r" : "Shift+KeyR");
      expect(((await activeTool(page)) as { facing?: string }).facing, item.prototype).toBe("east");
    }
    await page.mouse.move(spot.x + 1, spot.y, { steps: 2 });
    await expect.poll(() => ghostOutline(page), item.prototype).toEqual({ tile: [x, y], size: east, prototype: item.prototype, blocked: false });
    await page.mouse.click(spot.x, spot.y);
    await expect(card(page, item.name)).toHaveClass(/selected/);
    expect(await footprint(page, item.name), item.prototype).toEqual({ tile: [x, y], size: east, facing: "east", placed: "true" });
    await expect(selectTool(page)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  expect(await page.evaluate(() => window.faceSession!.getState().diagnostics.filter((diagnostic) => diagnostic.code.startsWith("tile")))).toEqual([]);
  // The centers as the source holds them: half tiles along an odd number of tiles, whole numbers along an even one.
  const source = await sourceText(page);
  expect(source).toMatch(/entity iron_chest1 at \(\d+, \d+\) tile \(2\.5, 1\.5\) \{\n {8}prototype = iron-chest/);
  expect(source).toMatch(/entity pump1 at \(\d+, \d+\) tile \(7, 1\.5\) \{/);
  expect(source).toMatch(/entity splitter1 at \(\d+, \d+\) tile \(10\.5, 2\) \{/);
  expect(source).toMatch(/entity train_stop1 at \(\d+, \d+\) tile \(14, 2\) \{/);
  expect(source).toMatch(/entity boiler1 at \(\d+, \d+\) tile \(20, 2\.5\) \{/);
  expect(source).toMatch(/entity cargo_landing_pad1 at \(\d+, \d+\) tile \(17, 11\) \{/);
  expect(source).toMatch(/entity rocket_silo1 at \(\d+, \d+\) tile \(26\.5, 11\.5\) \{/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SHOTS, "board-footprints.png") });

  // An entity placed while its tool is turned says so: a pump facing north stands one tile wide and two high.
  await tab(page, "Logistics").click();
  await entry(page, "pump").click();
  await page.keyboard.press("Shift+KeyR");
  const pump = await pointerFor(page, 34, 8, 1, 2);
  await page.mouse.move(pump.x, pump.y, { steps: 3 });
  await expect.poll(() => ghostOutline(page)).toEqual({ tile: [34, 8], size: [1, 2], prototype: "pump", blocked: false });
  await page.mouse.click(pump.x, pump.y);
  expect(await footprint(page, "pump2")).toEqual({ tile: [34, 8], size: [1, 2], facing: "north", placed: "true" });
  expect(await sourceText(page)).toMatch(/entity pump2 at \(\d+, \d+\) tile \(34\.5, 9\) facing north \{/);
  // A storage tank placed after a turn faces north.
  await entry(page, "storage-tank").click();
  await page.keyboard.press("r");
  const tank = await pointerFor(page, 32, 12, 3);
  await page.mouse.move(tank.x, tank.y, { steps: 3 });
  await page.mouse.click(tank.x, tank.y);
  expect(await footprint(page, "storage_tank2")).toMatchObject({ tile: [32, 12], size: [3, 3], facing: "north" });

  // A rocket silo cannot be placed where one of its 81 tiles is taken: with a corner on the landing pad or on the lamp.
  const placed = await sourceText(page);
  await tab(page, "Space").click();
  await entry(page, "rocket-silo").click();
  for (const tile of [[12, 0], [29, 8]] as const) {
    const taken = await pointerFor(page, tile[0], tile[1], 9);
    await page.mouse.move(taken.x, taken.y, { steps: 3 });
    await expect.poll(() => ghostOutline(page)).toEqual({ tile, size: [9, 9], prototype: "rocket-silo", blocked: true });
    await page.mouse.click(taken.x, taken.y);
    expect(await sourceText(page)).toBe(placed);
    await expect(entry(page, "rocket-silo")).toHaveAttribute("aria-pressed", "true");
  }
  await expect(toast(page)).toHaveCount(0);
  // Enter places on the free tiles nearest to the middle of the view, with the footprint of the tool.
  await tab(page, "Production").click();
  await entry(page, "electric-furnace").click();
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "electric_furnace1")).toHaveClass(/selected/);
  expect((await footprint(page, "electric_furnace1")).size).toEqual([3, 3]);
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  for (let step = 0; step < FOOTPRINTS.length + 3; step++) await page.getByRole("button", { name: "Undo" }).click();
  expect(await sourceText(page)).toBe(before);
});

test("the largest tab at the window the app starts with and at the smallest: the sections scroll in their own area, and the combinators and the entity list stay in reach", async ({ page, app }, testInfo) => {
  await openFiveKinds(page);
  const measure = () =>
    page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const [panel, groups, list] = [document.querySelector(".palette")!, document.querySelector(".palette-groups")!, document.querySelector(".entity-list")!];
      const rows = new Set([...document.querySelectorAll(".palette-catalog .palette-tile")].map((tile) => Math.round(tile.getBoundingClientRect().top)));
      const visibleRows = [...rows].filter((top) => top >= groups.getBoundingClientRect().top && top + box(".palette-catalog .palette-tile").height <= groups.getBoundingClientRect().bottom + 0.5);
      return {
        window: [window.innerWidth, window.innerHeight],
        sidebar: Math.round(box(".palette").width),
        tile: { pinned: Math.round(box(".palette-items .palette-tile").width * 10) / 10, compact: Math.round(box(".palette-catalog .palette-tile").width * 10) / 10 },
        // Nothing of the panel is cut off or pushed out of it.
        overflow: panel.scrollHeight - panel.clientHeight,
        sideways: Math.max(panel.scrollWidth - panel.clientWidth, groups.scrollWidth - groups.clientWidth),
        listInside: box(".entity-list").bottom <= box(".palette").bottom + 0.5 && box(".entity-list").top >= box(".palette-groups").bottom,
        combinatorsInside: [...document.querySelectorAll(".palette-items .palette-item")].every((item) => item.getBoundingClientRect().bottom <= box(".palette-groups").top),
        groups: { height: groups.clientHeight, content: groups.scrollHeight },
        tab: { height: Math.round(box(".palette-catalog").height), rows: rows.size, visibleRows: visibleRows.length },
        list: { height: list.clientHeight, content: list.scrollHeight },
        // Four tiles in the first row and six in a row of a group, whatever the width of the sidebar.
        firstRow: new Set([...document.querySelectorAll(".palette-items .palette-item")].map((item) => item.getBoundingClientRect().top)).size,
        perRow: [...document.querySelectorAll('[data-subgroup="inserter"] .palette-tile')].filter((tile, _, all) => tile.getBoundingClientRect().top === all[0]!.getBoundingClientRect().top).length,
      };
    });

  await expectTab(page, "Logistics");
  expect(await entitiesInUse(page)).toEqual(["small-lamp"]);
  for (const size of ["default", "minimum"] as const) {
    if (size === "minimum") await shrinkToMinimum(app, page);
    await palette(page).locator(".palette-groups").evaluate((groups) => groups.scrollTo(0, 0));
    const layout = await measure();
    await testInfo.attach(`selector-layout-${size}`, { body: JSON.stringify(layout), contentType: "application/json" });
    console.log(`selector layout, ${size} window: ${JSON.stringify(layout)}`);
    expect(layout.overflow, size).toBe(0);
    expect(layout.sideways, size).toBe(0);
    expect(layout.listInside, size).toBe(true);
    expect(layout.combinatorsInside, size).toBe(true);
    expect(layout.firstRow, size).toBe(1);
    expect(layout.perRow, size).toBe(6);
    // Logistics is the largest tab: 42 tiles in seven subgroups, ten rows of six.
    expect(layout.tab.rows, size).toBe(10);
    // At the size the window starts with most of it shows and the rest is a short scroll away; in the smallest window at least
    // three rows show under the search and the tabs.
    expect(layout.tab.visibleRows, size).toBeGreaterThanOrEqual(size === "default" ? 7 : 3);
    expect(layout.groups.content - layout.groups.height, size).toBeLessThan(size === "default" ? 150 : 320);
    expect(layout.list.height, size).toBeGreaterThanOrEqual(40);
    expect(layout.tile.compact, size).toBeGreaterThanOrEqual(26);
    await page.screenshot({ path: resolve(SHOTS, `selector-logistics-${size}-window.png`) });

    // The four combinators are on show whatever the sections do.
    for (const prototype of COMBINATORS) await expect(entry(page, prototype)).toBeInViewport({ ratio: 1 });
    // The last entry of the tab is reached by scrolling the sections, and it works. The search and the tabs stay in view above it.
    await entry(page, "display-panel").scrollIntoViewIfNeeded();
    await expect(entry(page, "display-panel")).toBeInViewport({ ratio: 1 });
    await expect(search(page)).toBeInViewport({ ratio: 1 });
    await expect(tab(page, "Combat")).toBeInViewport({ ratio: 1 });
    await entry(page, "display-panel").click();
    await expect(entry(page, "display-panel")).toHaveAttribute("aria-pressed", "true");
    await entry(page, "display-panel").click();
    // The last entity of the list is reached by scrolling the list, and selects.
    const last = palette(page).locator(".entity-list button").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    await last.click();
    await expect(card(page, "light")).toHaveClass(/selected/);
    // The sections are still where they were scrolled to: the two areas scroll on their own.
    await expect(entry(page, "display-panel")).toBeInViewport({ ratio: 1 });
  }
  // The keyboard reaches a tile that is scrolled out of sight: it comes into view, and its popup is beside it.
  await palette(page).locator(".palette-groups").evaluate((groups) => groups.scrollTo(0, 0));
  await expect(entry(page, "display-panel")).not.toBeInViewport({ ratio: 1 });
  await entry(page, "programmable-speaker").focus();
  await page.keyboard.press("Tab");
  await expect(entry(page, "display-panel")).toBeFocused();
  await expect(entry(page, "display-panel")).toBeInViewport({ ratio: 1 });
  await expect(popup(page)).toHaveAttribute("data-prototype", "display-panel");
  const [popupBox, tileBox] = [(await popup(page).boundingBox())!, (await entry(page, "display-panel").boundingBox())!];
  expect(popupBox.y).toBeLessThan(tileBox.y + tileBox.height);
  expect(popupBox.y + popupBox.height).toBeGreaterThan(tileBox.y);
  await canvas(page).focus();
  await expect(popup(page)).toHaveCount(0);

  // A tile armed by its key is in view wherever the sections were scrolled to.
  await palette(page).locator(".palette-groups").evaluate((groups) => groups.scrollTo(0, 0));
  await page.keyboard.press("5");
  await expect(entry(page, "small-lamp")).toHaveAttribute("aria-pressed", "true");
  await expect(entry(page, "small-lamp")).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("q");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await showDisplay(page, "blueprint");
  expect((await measure()).overflow).toBe(0);
});

test("the list of the circuit's entities closes like a section, leaves its room to the selector and is remembered across a restart", async () => {
  const listHeader = (page: Page) => palette(page).locator(".palette-list-header");
  const list = (page: Page) => palette(page).locator(".entity-list");
  const groupsHeight = (page: Page) => page.evaluate(() => document.querySelector(".palette-groups")!.clientHeight);
  const first = await launchApp();
  let second: { app: ElectronApplication; page: Page } | undefined;
  try {
    const page = first.page;
    await openFiveKinds(page);
    // In the smallest window, where the largest tab does not fit beside the list.
    await shrinkToMinimum(first.app, page);
    await expect(listHeader(page)).toHaveAttribute("aria-expanded", "true");
    await expect(listHeader(page)).toHaveText("In this circuit5");
    await expect(list(page).getByRole("button")).toHaveCount(5);
    const shared = await groupsHeight(page);

    await listHeader(page).click();
    await expect(listHeader(page)).toHaveAttribute("aria-expanded", "false");
    await expect(list(page)).toBeHidden();
    await expect(list(page).getByRole("button")).toHaveCount(0);
    // The heading and its count stay, and the selector has the room of the list.
    await expect(listHeader(page)).toHaveText("In this circuit5");
    expect(await groupsHeight(page)).toBeGreaterThan(shared);
    expect(await page.evaluate(() => document.querySelector(".palette")!.scrollHeight - document.querySelector(".palette")!.clientHeight)).toBe(0);
    // It is a preference of this machine like the tab, not a change of the project, and the other sections keep their own state.
    await expect(page.locator(".project-meta")).toContainText("All changes saved");
    await expect(header(page, "Entities in use")).toHaveAttribute("aria-expanded", "true");
    await expectTab(page, "Logistics");

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
