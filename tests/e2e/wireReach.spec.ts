// The wire reach: a project setting (9 tiles unless the project says otherwise, 0 for unlimited). A wire between two entities with
// a tile that are further apart is flagged in the problems list, on the blueprint board (live while entities are dragged) and in
// the inspector; nothing is refused. The distance is the one between the footprints, as the game measures it.
import type { Page } from "@playwright/test";
import { card, clickMenu, closeApp, expect, launchApp, openProject, readProjectEntries, showDisplay, test, wire, wireKeyOf, wirePoint, writeProject } from "./app.ts";
import { committedTiles, dragOnBoard, inspector, openBoardProject } from "./board.ts";

/** Ten empty tiles between `source` and `light`: 10 tiles apart. `loose` has no tile; its shown place is derived and not measured. */
const FAR = `circuit "Far" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    lamp light at (560, 80) tile (11.5, 0.5) {
        when virtual:signal-A > 0
    }

    lamp loose at (1100, 280) {
        when virtual:signal-A > 0
    }

    wire red source.out <-> light.in
    wire green source.out <-> loose.in
}
`;

const mode = (page: Page, name: "Circuit" | "Split") => page.getByRole("navigation", { name: "Workbench mode" }).getByRole("button", { name, exact: true });
const problems = (page: Page) => page.getByRole("region", { name: "Diagnostics" }).locator('li[data-code="wire-too-long"]');
const flagged = (page: Page) => page.locator("g.wire[data-too-long]");
const settings = (page: Page) => page.getByRole("dialog", { name: "Project settings" });
const reachField = (page: Page) => settings(page).getByLabel("Wire reach");
const saveState = (page: Page) => page.getByTestId("save-state");
const title = (page: Page, key: string) => wire(page, key).locator("title");

/** The board next to the source and its problems list, with the whole circuit in view. */
async function showSplit(page: Page): Promise<void> {
  await mode(page, "Split").click();
  await expect(page.locator(".source-pane .cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
}

async function selectWire(page: Page, key: string): Promise<void> {
  const point = await wirePoint(page, key);
  await page.mouse.click(point.x, point.y);
  await expect(wire(page, key)).toHaveClass(/selected/);
}

test("a wire between entities further apart than the reach is flagged in the problems list and on the board, live while an end is dragged", async ({ page }) => {
  await openBoardProject(page, FAR);
  await showSplit(page);
  const red = await wireKeyOf(page, "red", "source.out", "light.in");
  const green = await wireKeyOf(page, "green", "source.out", "loose.in");

  await expect(problems(page)).toHaveText("Ln 14Wire from 'source.out' to 'light.in': the entities are 10 tiles apart; the wire reach of the project is 9");
  await expect(page.locator(".statusbar")).toContainText("1 warning");
  await expect(flagged(page)).toHaveCount(1);
  await expect(wire(page, red)).toHaveAttribute("data-too-long", "true");
  await expect(wire(page, red).locator("path.wire-flag")).toHaveCount(1);
  expect(await title(page, red).textContent()).toBe("red: source.out <-> light.in (10 tiles apart, over the wire reach of 9)");
  // The entity without a tile is shown further away still, but its place is only derived: not flagged, not measured.
  await expect(card(page, "loose")).toHaveAttribute("data-placed", "false");
  await expect(wire(page, green)).not.toHaveAttribute("data-too-long");
  expect(await title(page, green).textContent()).toBe("green: source.out <-> loose.in");
  // A warning: nothing is blocked.
  await expect(page.locator(".invalid-banner")).toHaveCount(0);

  // One tile closer is exactly the reach. The board says so while the button is down; the problems list follows the drop.
  await dragOnBoard(page, "light", { x: -1, y: 0 }, async () => {
    await expect(card(page, "light")).toHaveAttribute("data-tile-x", "10");
    await expect(flagged(page)).toHaveCount(0);
    expect(await title(page, red).textContent()).toBe("red: source.out <-> light.in (9 tiles apart)");
    await expect(problems(page)).toHaveCount(1);
  });
  await expect(problems(page)).toHaveCount(0);
  await expect(flagged(page)).toHaveCount(0);
  await expect(page.locator(".statusbar")).not.toContainText("warning");

  // Dragged away again: flagged at the previewed place before anything is written, and the drop is not refused.
  await dragOnBoard(page, "light", { x: 3, y: 0 }, async () => {
    await expect(card(page, "light")).toHaveAttribute("data-tile-x", "13");
    await expect(flagged(page)).toHaveCount(1);
    await expect(wire(page, red)).toHaveAttribute("data-too-long", "true");
    await expect(problems(page)).toHaveCount(0);
  });
  expect((await committedTiles(page)).light).toEqual([13.5, 0.5]);
  await expect(problems(page)).toHaveText("Ln 14Wire from 'source.out' to 'light.in': the entities are 12 tiles apart; the wire reach of the project is 9");
  await expect(flagged(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(flagged(page)).toHaveCount(0);
  await expect(problems(page)).toHaveCount(0);

  // An entity without a tile gets one by being dragged: its wire is measured from then on, also during the drag.
  await dragOnBoard(page, "loose", { x: 0, y: 1 }, async () => {
    await expect(flagged(page)).toHaveCount(1);
    await expect(wire(page, green)).toHaveAttribute("data-too-long", "true");
  });
  expect((await committedTiles(page)).loose).toEqual([12.5, 4.5]);
  await expect(problems(page)).toHaveText("Ln 15Wire from 'source.out' to 'loose.in': the entities are 11.4 tiles apart; the wire reach of the project is 9");
  await expect(wire(page, green)).toHaveAttribute("data-too-long", "true");

  // The edit canvas shows the wires as it always did; the warning stays in the list.
  await showDisplay(page, "edit");
  await expect(page.locator("g.wire")).toHaveCount(2);
  await expect(flagged(page)).toHaveCount(0);
  expect(await title(page, green).textContent()).toBe("green: source.out <-> loose.in");
  await expect(problems(page)).toHaveCount(1);
});

test("the inspector of a selected wire shows how far apart its entities are against the reach", async ({ page }) => {
  await openBoardProject(page, FAR);
  await page.getByRole("button", { name: "Fit circuit" }).click();
  const distance = inspector(page).locator(".wire-distance");

  await selectWire(page, await wireKeyOf(page, "red", "source.out", "light.in"));
  await expect(distance).toHaveAttribute("data-too-long", "true");
  await expect(distance.locator(".section-label")).toHaveText("DistanceReach 9");
  await expect(distance.locator("p").first()).toHaveText("The two entities are 10 tiles apart");
  await expect(distance.getByRole("status")).toContainText("Further apart than the wire reach.");
  // A selected wire that is flagged keeps both marks: the outline of the selection and the dashes.
  await expect(page.locator("g.wire.selected.too-long path.wire-flag")).toHaveCount(1);

  // No distance while one end has no tile.
  await selectWire(page, await wireKeyOf(page, "green", "source.out", "loose.in"));
  await expect(inspector(page).locator(".inspector-wire")).toBeVisible();
  await expect(distance).toHaveCount(0);
});

test("the reach 0 means unlimited: nothing is flagged, and the inspector says so", async ({ page }) => {
  await openBoardProject(page, FAR);
  await showSplit(page);
  await expect(flagged(page)).toHaveCount(1);
  await expect(problems(page)).toHaveCount(1);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(settings(page)).toContainText("0 means unlimited");
  await reachField(page).fill("0");
  await expect(reachField(page)).toHaveAttribute("aria-invalid", "false");
  await reachField(page).press("Enter");
  await expect(reachField(page)).toHaveValue("0");
  await settings(page).getByRole("button", { name: "Close project settings" }).click();
  await expect(flagged(page)).toHaveCount(0);
  await expect(problems(page)).toHaveCount(0);
  await expect(page.locator(".statusbar")).not.toContainText("warning");

  // Dragged further away the wire stays fine, during the drag and after it; it is still measured.
  await dragOnBoard(page, "light", { x: 2, y: 0 }, async () => {
    await expect(card(page, "light")).toHaveAttribute("data-tile-x", "13");
    await expect(flagged(page)).toHaveCount(0);
  });
  await expect(problems(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const red = await wireKeyOf(page, "red", "source.out", "light.in");
  expect(await title(page, red).textContent()).toBe("red: source.out <-> light.in (12 tiles apart)");
  await selectWire(page, red);
  const distance = inspector(page).locator(".wire-distance");
  await expect(distance).not.toHaveAttribute("data-too-long");
  await expect(distance.locator(".section-label")).toHaveText("DistanceReach unlimited");
  await expect(distance.locator("p").first()).toHaveText("The two entities are 12 tiles apart");
  await expect(distance.getByRole("status")).toHaveCount(0);
});

test("the reach is set in the project settings, decides what is flagged, and is kept in the project file", async () => {
  const projectPath = await writeProject({ name: "Reach", source: FAR });
  const manifest = async (): Promise<Record<string, unknown>> => JSON.parse((await readProjectEntries(projectPath))["face.json"]!);

  const first = await launchApp();
  try {
    const { app, page } = first;
    await openProject(page, projectPath);
    await showDisplay(page, "blueprint");
    await expect(flagged(page)).toHaveCount(1);
    const red = await wireKeyOf(page, "red", "source.out", "light.in");

    await page.getByRole("button", { name: "Settings" }).click();
    const reset = settings(page).getByRole("button", { name: "Reset to 9" });
    await expect(reachField(page)).toHaveValue("9");
    await expect(reset).toBeDisabled();

    // A reach that is long enough takes the flag and the warning away; the project has unsaved changes, the document none.
    await reachField(page).fill("10");
    await reachField(page).press("Enter");
    await expect(flagged(page)).toHaveCount(0);
    await expect(page.locator(".statusbar")).not.toContainText("warning");
    await expect(saveState(page)).toHaveText("Unsaved changes");
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

    // What is not a number says so and is not taken over.
    await reachField(page).fill("far");
    await expect(reachField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(settings(page).getByRole("alert")).toHaveText("A number from 0 to 64; 0 means unlimited");
    await reachField(page).press("Enter");
    await expect(reachField(page)).toHaveValue("10");
    await expect(settings(page).getByRole("alert")).toHaveCount(0);
    // A number out of range becomes the nearest end of it: 64 above, 0 (unlimited) below.
    for (const [text, taken] of [["64.5", "64"], ["150", "64"], ["-1", "0"]] as const) {
      await reachField(page).fill(text);
      await expect(settings(page).getByRole("alert")).toHaveCount(0);
      await reachField(page).press("Enter");
      await expect(reachField(page)).toHaveValue(taken);
      await expect(flagged(page)).toHaveCount(0);
    }
    // 64 is the most.
    await reachField(page).fill("64");
    await reachField(page).press("Enter");
    await expect(reachField(page)).toHaveValue("64");
    await expect(settings(page).getByRole("alert")).toHaveCount(0);

    // Fractions are allowed, with a comma as well; leaving the field writes it.
    await reachField(page).fill("9,5");
    await reachField(page).press("Tab");
    await expect(reachField(page)).toHaveValue("9.5");
    await expect(flagged(page)).toHaveCount(1);
    expect(await title(page, red).textContent()).toBe("red: source.out <-> light.in (10 tiles apart, over the wire reach of 9.5)");

    // Back to the default: as saved.
    await reset.click();
    await expect(reachField(page)).toHaveValue("9");
    await expect(saveState(page)).toHaveText("All changes saved");
    await expect(flagged(page)).toHaveCount(1);

    await reachField(page).fill("12");
    await reachField(page).press("Enter");
    await expect(flagged(page)).toHaveCount(0);
    await settings(page).getByRole("button", { name: "Close project settings" }).click();
    expect(await manifest()).not.toHaveProperty("wireReach");
    await clickMenu(app, "File", "Save");
    await expect(saveState(page)).toHaveText("All changes saved");
    expect((await manifest()).wireReach).toBe(12);
  } finally {
    await closeApp(first.app);
  }

  const second = await launchApp();
  try {
    const { app, page } = second;
    await openProject(page, projectPath);
    await showDisplay(page, "blueprint");
    await expect(page.locator("g.wire")).toHaveCount(2);
    await expect(flagged(page)).toHaveCount(0);
    await expect(page.locator(".statusbar")).not.toContainText("warning");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(reachField(page)).toHaveValue("12");

    // The default is written as no field.
    await settings(page).getByRole("button", { name: "Reset to 9" }).click();
    await expect(flagged(page)).toHaveCount(1);
    await expect(page.locator(".statusbar")).toContainText("1 warning");
    await settings(page).getByRole("button", { name: "Close project settings" }).click();
    await clickMenu(app, "File", "Save");
    await expect(saveState(page)).toHaveText("All changes saved");
    expect(await manifest()).not.toHaveProperty("wireReach");
  } finally {
    await closeApp(second.app);
  }
});

for (const [wireReach, taken] of [[64.5, "64"], [-1, "0"]] as const) {
  test(`a project file with the wire reach ${wireReach} opens with the reach ${taken}`, async ({ page }) => {
    const projectPath = await writeProject({ name: "Far reach", source: FAR, manifest: { wireReach } });
    await page.evaluate((path) => window.faceSession!.commands.loadProject(path), projectPath);
    await expect(page.getByTestId("project-name")).toHaveText("Far reach");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(reachField(page)).toHaveValue(taken);
  });
}

test("a project file whose wire reach is not a number is not opened", async ({ page }) => {
  const projectPath = await writeProject({ name: "Bad reach", source: FAR, manifest: { wireReach: "9" } });
  await page.evaluate((path) => window.faceSession!.commands.loadProject(path), projectPath);
  await expect(page.locator(".toast")).toContainText("Wire reach must be a number");
  await expect(page.getByTestId("project-name")).not.toHaveText("Bad reach");
});

test("a project file with the wire reach 0 opens with nothing flagged", async ({ page }) => {
  const projectPath = await writeProject({ name: "Unlimited", source: FAR, manifest: { wireReach: 0 } });
  await page.evaluate((path) => window.faceSession!.commands.loadProject(path), projectPath);
  await expect(page.getByTestId("project-name")).toHaveText("Unlimited");
  await showDisplay(page, "blueprint");
  await expect(page.locator("g.wire")).toHaveCount(2);
  await expect(flagged(page)).toHaveCount(0);
  await expect(page.locator(".statusbar")).not.toContainText("warning");
});
