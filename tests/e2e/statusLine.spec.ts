// The status line: what the light and the text at its start say about the source, the warnings chip, and the project file
// with its save state, which moved here from under the project name.
import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { canvas, card, clickMenu, closeApp, expect, launchApp, PROJECT_FILE_EXTENSION, PROJECTS_DIR, sourceText, stubDialogs, test } from "./app.ts";
import { setSource } from "./board.ts";

const status = (page: Page) => page.locator(".statusbar");
const lead = (page: Page) => status(page).locator(".status-source");
const path = (page: Page) => status(page).locator(".project-meta .path");
const saveState = (page: Page) => page.getByTestId("save-state");

test("the status line follows a project from new through an edit and a save, and shortens a long path in the middle", async () => {
  const { app, page } = await launchApp({ open: "start" });
  try {
    // A new project: nothing wrong with the source, no file, nothing to save.
    await expect(lead(page)).toHaveText("No errors");
    await expect(lead(page)).toHaveAttribute("data-level", "ok");
    await expect(lead(page).locator(".status-dot")).toHaveClass(/\bok\b/);
    await expect(lead(page)).toHaveAttribute("title", /^Green: the source has no errors/);
    await expect(path(page)).toHaveText("Not saved yet");
    await expect(path(page)).not.toHaveAttribute("title");
    await expect(saveState(page)).toHaveText("No changes");
    await expect(saveState(page)).toHaveRole("status");
    await expect(saveState(page)).not.toHaveClass(/unsaved/);
    // The file and its state are in the status line only; the bar at the top keeps the project name.
    await expect(page.locator(".projectbar")).toContainText("Untitled circuit");
    await expect(page.locator(".projectbar").getByTestId("save-state")).toHaveCount(0);
    await expect(page.locator(".projectbar")).not.toContainText("Not saved yet");
    await expect(status(page).getByTestId("save-state")).toHaveCount(1);

    // An edit.
    await page.keyboard.press("1");
    await canvas(page).focus();
    await page.keyboard.press("Enter");
    await expect(card(page, "constant1")).toHaveCount(1);
    await expect(saveState(page)).toHaveText("Unsaved changes");
    await expect(saveState(page)).toHaveClass(/unsaved/);
    await expect(path(page)).toHaveText("Not saved yet");
    await expect(lead(page)).toHaveText("No errors");

    // Saved to a file far down in the folders: the whole path is there (and in the tooltip), shown with its file name and as
    // many of its folders as fit.
    const folder = resolve(PROJECTS_DIR, `status-${process.pid}`, ...Array.from({ length: 6 }, (_, index) => `a-folder-with-quite-a-long-name-to-fill-the-status-line-${index}`));
    await mkdir(folder, { recursive: true });
    const projectPath = resolve(folder, `Counter${PROJECT_FILE_EXTENSION}`);
    await stubDialogs(app, { savePath: projectPath });
    await clickMenu(app, "File", "Save");
    await expect(saveState(page)).toHaveText("All changes saved");
    await expect(saveState(page)).not.toHaveClass(/unsaved/);
    await expect(path(page)).toHaveText(projectPath);
    await expect(path(page)).toHaveAttribute("title", projectPath);
    await expect(path(page).locator(".path-tail")).toHaveText(`/Counter${PROJECT_FILE_EXTENSION}`);
    const shown = await path(page).evaluate((element) => {
      const [head, tail] = [element.querySelector<HTMLElement>(".path-head")!, element.querySelector<HTMLElement>(".path-tail")!];
      const [line, state] = [element.closest(".statusbar")!.getBoundingClientRect(), document.querySelector('[data-testid="save-state"]')!.getBoundingClientRect()];
      return {
        headCut: head.scrollWidth > head.clientWidth,
        headEllipsis: getComputedStyle(head).textOverflow,
        tailWhole: tail.scrollWidth <= tail.clientWidth,
        headShown: head.clientWidth,
        // Nothing of it leaves the line or runs into its neighbors.
        inside: element.getBoundingClientRect().right <= state.left && state.right <= line.right && document.querySelector(".status-middle")!.getBoundingClientRect().right <= element.getBoundingClientRect().left,
        overflow: document.querySelector(".statusbar")!.scrollWidth - document.querySelector(".statusbar")!.clientWidth,
      };
    });
    expect(shown).toMatchObject({ headCut: true, headEllipsis: "ellipsis", tailWhole: true, inside: true, overflow: 0 });
    expect(shown.headShown).toBeGreaterThan(40);
    await expect(page.getByTestId("project-name")).toHaveText("Untitled circuit");

    // Another edit, and saved again.
    await page.keyboard.press("5");
    await canvas(page).focus();
    await page.keyboard.press("Enter");
    await expect(saveState(page)).toHaveText("Unsaved changes");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(saveState(page)).toHaveText("All changes saved");
    // A new project again: back to no file.
    await clickMenu(app, "File", "New Project");
    await expect(path(page)).toHaveText("Not saved yet");
    await expect(saveState(page)).toHaveText("No changes");
  } finally {
    await closeApp(app);
  }
});

test("the lead of the status line says whether the source has errors, in words that explain themselves", async ({ page }) => {
  const valid = await sourceText(page);
  await expect(lead(page)).toHaveText("No errors");
  await expect(lead(page).locator(".status-dot")).toHaveClass(/\bok\b/);

  // One error: red, counted, and it says what follows for the canvas.
  await setSource(page, valid.replace("< 10", "<"));
  await expect(lead(page)).toHaveText("1 error in source, canvas is read-only");
  await expect(lead(page)).toHaveAttribute("data-level", "error");
  await expect(lead(page).locator(".status-dot")).toHaveClass(/\berror\b/);
  await expect(lead(page)).toHaveAttribute("title", /^Red: the source has errors\. The canvas shows the last valid circuit/);
  await expect(status(page)).not.toContainText("Circuit ready");
  await expect(status(page)).not.toContainText("No errors");
  // The canvas says the same where it is.
  await expect(page.locator(".invalid-banner")).toBeVisible();
  const [banner, strip, area] = [(await page.locator(".invalid-banner").boundingBox())!, (await page.locator(".canvas-strip").boundingBox())!, (await page.locator(".canvas").boundingBox())!];
  expect(banner.y).toBeGreaterThanOrEqual(strip.y + strip.height);
  expect(banner.y + banner.height).toBeLessThan(area.y + area.height / 2);

  await setSource(page, valid.replace("< 10", "<").replace("> 8", ">"));
  await expect(lead(page)).toHaveText("2 errors in source, canvas is read-only");
  // An edit that is no change of the saved state still shows as unsaved: the two parts of the line are independent.
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");

  await setSource(page, valid);
  await expect(lead(page)).toHaveText("No errors");
  await expect(lead(page)).toHaveAttribute("data-level", "ok");
  await expect(page.locator(".invalid-banner")).toHaveCount(0);

  // Warnings are no errors: the light stays green and the chip counts them; it opens the source.
  await setSource(page, valid.replace("virtual:signal-A = 1", "virtual:signal-nope = 1"));
  await expect(lead(page)).toHaveText("No errors");
  const chip = status(page).getByRole("button", { name: /warning/ });
  await expect(chip).toHaveText("1 warning");
  await chip.click();
  await expect(page.locator(".source-pane")).toBeVisible();
  await expect(page.getByRole("button", { name: "Split", exact: true })).toHaveAttribute("aria-pressed", "true");
});
