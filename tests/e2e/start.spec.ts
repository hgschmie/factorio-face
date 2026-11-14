// What a freshly started app shows (the project that was open last, or an empty one), the empty project of File > New Project,
// and the examples of File > Open Example.
import type { ElectronApplication, Page } from "@playwright/test";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canvas,
  card,
  clickMenu,
  closeApp,
  dialogCalls,
  displaySwitch,
  EMPTY_SOURCE,
  entityNames,
  EXAMPLE_NAME,
  expect,
  isDocumentEdited,
  launchApp,
  menuLabels,
  newProjectPath,
  openProject,
  readProjectEntries,
  ROOT,
  SCREENSHOT_DIR,
  selectEntity,
  showDisplay,
  sourceText,
  stubDialogs,
  test,
  writeProject,
  type RunningApp,
} from "./app.ts";
import { RELAY, RELAY_SOURCE } from "./fixtures.ts";

const SHIPPED_EXAMPLE = resolve(ROOT, "examples", `${EXAMPLE_NAME}.faceproj`);
const path = (page: Page) => page.locator(".project-meta .path");
const projectName = (page: Page) => page.getByTestId("project-name");
const saveState = (page: Page) => page.getByTestId("save-state");
const zoom = async (page: Page): Promise<number> => Number(await page.locator(".canvas").getAttribute("data-zoom"));

async function recentPaths(page: Page): Promise<string[]> {
  const recent = await page.evaluate(() => window.face!.getRecentProjects());
  if (!recent.ok) throw new Error(recent.error);
  return recent.value.map((project) => project.path);
}

/** The window shows the empty project, and it is no unsaved change. */
async function expectEmptyProject(app: ElectronApplication, page: Page): Promise<void> {
  await expect(projectName(page)).toHaveText("Untitled circuit");
  await expect(path(page)).toHaveText("Not saved yet");
  await expect(saveState(page)).toHaveText("No changes");
  await expect(page.locator("g.card")).toHaveCount(0);
  await expect(page.locator(".canvas-empty")).toBeVisible();
  await expect(page.locator(".canvas .counts")).toHaveText("0 entities0 connections");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(await sourceText(page)).toBe(EMPTY_SOURCE);
  expect(await isDocumentEdited(app)).toBe(false);
}

/** Runs a first session that saves the example as a project and returns its profile, for a restart. */
async function sessionThatSaved(projectPath: string): Promise<RunningApp> {
  const first = await launchApp();
  try {
    await stubDialogs(first.app, { savePath: projectPath });
    await clickMenu(first.app, "File", "Save");
    await expect(path(first.page)).toHaveText(projectPath);
  } finally {
    await closeApp(first.app);
  }
  return first;
}

test("a fresh profile starts with an empty, unsaved project", async () => {
  const { app, page, userData } = await launchApp({ open: "start" });
  try {
    await expectEmptyProject(app, page);
    // There is no last project, and asking for it again says so.
    expect(await page.evaluate(() => window.face!.openLastProject())).toEqual({ ok: true, value: null });
    await expectEmptyProject(app, page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await menuLabels(app, "File", "Open Recent")).toEqual(["No Recent Projects"]);
    expect(await menuLabels(app, "File", "Open Example")).toEqual([EXAMPLE_NAME]);
    expect(await readdir(userData)).not.toContain("recent-projects.json");
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, "workbench-empty.png") });

    // Closing it asks nothing.
    await stubDialogs(app, {});
    const closed = app.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await closed;
  } finally {
    await closeApp(app);
  }
});

test("File > New Project gives an empty circuit that is not an unsaved change, and the workbench works on it", async ({ app, page }) => {
  const projectPath = await newProjectPath("First of its kind");
  await stubDialogs(app, { savePath: projectPath });
  await selectEntity(page, "gate");
  await clickMenu(app, "File", "New Project");
  await expectEmptyProject(app, page);
  // The example had no unsaved changes, so nothing was asked.
  expect(await dialogCalls(app)).toMatchObject({ message: 0, save: 0 });
  await expect(page.locator(".inspector-empty")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".statusbar")).not.toContainText("error");

  // The source is a circuit without entities.
  await clickMenu(app, "View", "Source");
  await expect(page.locator(".source-pane .cm-content")).toHaveText('circuit "Untitled circuit" {}');
  await clickMenu(app, "View", "Circuit");

  // Both display modes show the empty canvas, and fitting nothing is the view at actual size.
  for (const mode of ["blueprint", "edit"] as const) {
    await showDisplay(page, mode);
    await expect(page.locator("g.card")).toHaveCount(0);
    await expect(page.locator(".canvas-empty")).toBeVisible();
    await clickMenu(app, "View", "Zoom In");
    await expect.poll(() => zoom(page)).toBeCloseTo(1.25, 5);
    await page.getByRole("button", { name: "Fit circuit" }).click();
    await expect.poll(() => zoom(page)).toBeCloseTo(1, 5);
  }
  await clickMenu(app, "Edit", "Select All");
  await expect(page.locator("g.card.selected")).toHaveCount(0);

  // The simulation of nothing runs.
  await clickMenu(app, "Simulation", "Step");
  await expect(page.getByTestId("tick-counter")).toHaveText("0001");
  await clickMenu(app, "Simulation", "Reset");
  await expect(page.getByTestId("tick-counter")).toHaveText("0000");
  await expect(saveState(page)).toHaveText("No changes");

  // The first entity: placed with the palette, selected, shown by the inspector, and an unsaved change.
  await page.locator('.palette-item[data-kind="constant"]').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("g.card")).toHaveCount(1);
  await expect(page.locator(".canvas-empty")).toHaveCount(0);
  await expect(page.locator("g.card.selected")).toHaveCount(1);
  await expect(page.getByLabel("Entity name")).toBeVisible();
  await expect(saveState(page)).toHaveText("Unsaved changes");
  await expect.poll(() => isDocumentEdited(app)).toBe(true);
  const [first] = await entityNames(page);
  // The board gives it a tile of its own, and a second entity goes next to it.
  await showDisplay(page, "blueprint");
  await expect(card(page, first!)).toBeVisible();
  await showDisplay(page, "edit");
  await page.locator('.palette-item[data-kind="lamp"]').click();
  await page.mouse.click(box.x + box.width / 2 + 260, box.y + box.height / 2);
  await expect(page.locator("g.card")).toHaveCount(2);

  // Saving asks for a location and suggests the project's name.
  await clickMenu(app, "File", "Save");
  await expect(saveState(page)).toHaveText("All changes saved");
  await expect(path(page)).toHaveText(projectPath);
  const calls = await dialogCalls(app);
  expect(calls).toMatchObject({ save: 1, message: 0 });
  expect(calls.saveOptions!.defaultPath).toMatch(/Untitled circuit\.faceproj$/);
  const entries = await readProjectEntries(projectPath);
  expect(JSON.parse(entries["face.json"]!)).toMatchObject({ name: "Untitled circuit", circuits: ["main.face"] });
  expect(entries["main.face"]).toBe(await sourceText(page));
  expect(entries["main.face"]).toMatch(/^circuit "Untitled circuit" \{\n    constant \w+ at \(/);

  // Undo leads back to the empty circuit.
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await sourceText(page)).toBe(EMPTY_SOURCE);
  await expect(page.locator(".canvas-empty")).toBeVisible();
});

test("File > New Project asks before it replaces unsaved changes", async ({ app, page }) => {
  await selectEntity(page, "light");
  await page.keyboard.press("Delete");
  await expect(saveState(page)).toHaveText("Unsaved changes");

  await stubDialogs(app, { unsavedChoice: 2 });
  await clickMenu(app, "File", "New Project");
  await expect.poll(async () => (await dialogCalls(app)).message).toBe(1);
  await expect(page.locator("g.card")).toHaveCount(3);
  await expect(projectName(page)).toHaveText(EXAMPLE_NAME);

  await stubDialogs(app, { unsavedChoice: 1 });
  await clickMenu(app, "File", "New Project");
  await expectEmptyProject(app, page);
});

test("File > Open Example opens the shipped example as an unsaved copy, and Save asks for a location", async () => {
  const projectPath = await newProjectPath("My copy");
  const shipped = await readFile(SHIPPED_EXAMPLE);
  const { app, page, userData } = await launchApp({ open: "start" });
  try {
    await expectEmptyProject(app, page);
    expect(await menuLabels(app, "File")).toEqual(expect.arrayContaining(["New Project", "Open Project...", "Open Recent", "Open Example"]));
    expect(await menuLabels(app, "File", "Open Example")).toEqual([EXAMPLE_NAME]);

    await stubDialogs(app, {});
    await clickMenu(app, "File", "Open Example", EXAMPLE_NAME);
    await expect(projectName(page)).toHaveText(EXAMPLE_NAME);
    await expect(page.locator("g.card")).toHaveCount(4);
    await expect(page.locator("g.wire")).toHaveCount(4);
    // It is the example of the language description, as a project that has no file and no unsaved change.
    const documented = /^## Example\n+```text\n([\s\S]*?)^```$/m.exec(await readFile(resolve(ROOT, "docs/dsl.md"), "utf8"))![1];
    expect(await sourceText(page)).toBe(documented);
    await expect(path(page)).toHaveText("Not saved yet");
    await expect(saveState(page)).toHaveText("No changes");
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(await isDocumentEdited(app)).toBe(false);
    expect(await dialogCalls(app)).toMatchObject({ message: 0, save: 0, open: 0 });
    // It is not a recent project.
    expect(await recentPaths(page)).toEqual([]);
    expect(await menuLabels(app, "File", "Open Recent")).toEqual(["No Recent Projects"]);
    expect(await readdir(userData)).not.toContain("recent-projects.json");
    if (process.platform === "darwin") expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getRepresentedFilename())).toBe("");

    // Save has no file to write to: it asks, and a cancelled dialog writes nothing.
    await clickMenu(app, "File", "Save");
    await expect.poll(async () => (await dialogCalls(app)).save).toBe(1);
    expect((await dialogCalls(app)).saveOptions!.defaultPath).toMatch(/Feedback example\.faceproj$/);
    await expect(path(page)).toHaveText("Not saved yet");

    // With unsaved changes, opening the example again asks first.
    await selectEntity(page, "light");
    await page.keyboard.press("Delete");
    await expect(saveState(page)).toHaveText("Unsaved changes");
    await stubDialogs(app, { unsavedChoice: 2 });
    await clickMenu(app, "File", "Open Example", EXAMPLE_NAME);
    await expect.poll(async () => (await dialogCalls(app)).message).toBe(1);
    await expect(page.locator("g.card")).toHaveCount(3);
    await stubDialogs(app, { unsavedChoice: 1 });
    await clickMenu(app, "File", "Open Example", EXAMPLE_NAME);
    await expect(page.locator("g.card")).toHaveCount(4);
    await expect(saveState(page)).toHaveText("No changes");

    // Saved to a place the user chose, the copy is a project like any other; the shipped file is as it was.
    await selectEntity(page, "twice");
    await page.keyboard.press("Delete");
    await stubDialogs(app, { savePath: projectPath });
    await clickMenu(app, "File", "Save");
    await expect(path(page)).toHaveText(projectPath);
    await expect(saveState(page)).toHaveText("All changes saved");
    expect((await readProjectEntries(projectPath))["main.face"]).not.toContain("arithmetic twice");
    expect((await readFile(SHIPPED_EXAMPLE)).equals(shipped)).toBe(true);
    expect(await recentPaths(page)).toEqual([projectPath]);
    await clickMenu(app, "File", "Save");
    expect((await dialogCalls(app)).save).toBe(1);
  } finally {
    await closeApp(app);
  }
  expect((await readFile(SHIPPED_EXAMPLE)).equals(shipped)).toBe(true);
});

test("a restart reopens the project that was open last, as if it had been opened by hand", async () => {
  const savedPath = await newProjectPath("Saved first");
  const relayPath = await writeProject({ name: "Relay", source: RELAY_SOURCE });
  const first = await launchApp();
  try {
    await stubDialogs(first.app, { savePath: savedPath });
    await clickMenu(first.app, "File", "Save");
    await expect(path(first.page)).toHaveText(savedPath);
    await openProject(first.page, relayPath);
  } finally {
    await closeApp(first.app);
  }

  // The project opened last is on show, not the one saved before it.
  const second = await launchApp({ userData: first.userData, open: "start" });
  try {
    const { app, page } = second;
    await expect(path(page)).toHaveText(relayPath);
    await expect(projectName(page)).toHaveText("Relay");
    await expect(saveState(page)).toHaveText("All changes saved");
    await expect(page.locator("g.card")).toHaveCount(RELAY.length);
    expect(await sourceText(page)).toBe(RELAY_SOURCE);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await isDocumentEdited(app)).toBe(false);
    expect(await recentPaths(page)).toEqual([relayPath, savedPath]);
    expect(await menuLabels(app, "File", "Open Recent")).toEqual([`Relay (${relayPath})`, `${EXAMPLE_NAME} (${savedPath})`, "-", "Clear Recent Projects"]);
    if (process.platform === "darwin") expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getRepresentedFilename())).toBe(relayPath);

    // It is the project of that file: a change is saved to it without a dialog.
    await stubDialogs(app, {});
    await showDisplay(page, "edit");
    await selectEntity(page, "alarm");
    await page.keyboard.press("Delete");
    await clickMenu(app, "File", "Save");
    await expect(saveState(page)).toHaveText("All changes saved");
    expect(await dialogCalls(app)).toMatchObject({ save: 0, message: 0 });
    expect((await readProjectEntries(relayPath))["main.face"]).not.toContain("speaker alarm");
  } finally {
    await closeApp(second.app);
  }

  // Whatever was opened last counts, also from Open Recent.
  const third = await launchApp({ userData: first.userData, open: "start" });
  try {
    await expect(path(third.page)).toHaveText(relayPath);
    await clickMenu(third.app, "File", "Open Recent", EXAMPLE_NAME);
    await expect(path(third.page)).toHaveText(savedPath);
  } finally {
    await closeApp(third.app);
  }
  const fourth = await launchApp({ userData: first.userData, open: "start" });
  try {
    await expect(path(fourth.page)).toHaveText(savedPath);
    await expect(fourth.page.locator("g.card")).toHaveCount(4);
  } finally {
    await closeApp(fourth.app);
  }
});

for (const [what, spoil, message] of [
  ["deleted", (file: string) => rm(file), "Project file not found: "],
  ["damaged", (file: string) => writeFile(file, "this is not a zip archive\n"), "Not a face project file (it is not a readable zip archive): "],
] as const) {
  test(`a restart with the last project ${what} shows the empty project and says so`, async () => {
    const projectPath = await newProjectPath(`Last and ${what}`);
    const first = await sessionThatSaved(projectPath);
    await spoil(projectPath);

    const { app, page } = await launchApp({ userData: first.userData, open: "start" });
    try {
      // The message is where the other file errors are shown, and it stays until it is dismissed.
      await expect(page.getByRole("alert")).toHaveText(`The last project could not be reopened. ${message}${projectPath}`);
      await expectEmptyProject(app, page);
      await page.screenshot({ path: resolve(SCREENSHOT_DIR, `start-last-project-${what}.png`) });
      // The project keeps its place in Open Recent, where choosing it reports the same problem.
      expect(await recentPaths(page)).toEqual([projectPath]);
      expect(await menuLabels(app, "File", "Open Recent")).toEqual([`${EXAMPLE_NAME} (${projectPath})`, "-", "Clear Recent Projects"]);
      await page.getByRole("button", { name: "Dismiss message" }).click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await clickMenu(app, "File", "Open Recent", EXAMPLE_NAME);
      await expect(page.getByRole("alert")).toHaveText(`${message}${projectPath}`);
      await expectEmptyProject(app, page);

      // The empty project is usable, and another project takes the message away.
      await clickMenu(app, "File", "Open Example", EXAMPLE_NAME);
      await expect(page.locator("g.card")).toHaveCount(4);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(displaySwitch(page)).toBeVisible();
    } finally {
      await closeApp(app);
    }
  });
}
