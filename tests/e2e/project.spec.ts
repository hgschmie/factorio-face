// Project persistence and the unsaved-changes handshake. Native dialogs cannot be driven, so the main process's dialog
// functions are replaced through Playwright; everything behind them (validation, atomic writes, menu, IPC) is real.
import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { card, cardGrabPoint, closeApp, entityNames, exitCodeOf, expect, launchApp, PROJECTS_DIR, test } from "./app.ts";

let projectCount = 0;

async function newProjectPath(name: string): Promise<string> {
  const parent = resolve(PROJECTS_DIR, `project-${process.pid}-${++projectCount}`);
  await mkdir(parent, { recursive: true });
  return resolve(parent, name);
}

/** Makes the save dialog answer with `path` and counts how often each dialog was shown. */
async function stubDialogs(app: ElectronApplication, answers: { savePath?: string; openPath?: string; unsavedChoice?: number }): Promise<void> {
  await app.evaluate(({ dialog }, { savePath, openPath, unsavedChoice }) => {
    const calls = { save: 0, open: 0, message: 0 };
    (globalThis as Record<string, unknown>).dialogCalls = calls;
    dialog.showSaveDialog = (async () => (calls.save++, { canceled: savePath === undefined, filePath: savePath ?? "" })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => (calls.open++, { canceled: openPath === undefined, filePaths: openPath === undefined ? [] : [openPath] })) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async () => (calls.message++, { response: unsavedChoice ?? 2, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, answers);
}

function dialogCalls(app: ElectronApplication): Promise<{ save: number; open: number; message: number }> {
  return app.evaluate(() => (globalThis as Record<string, unknown>).dialogCalls as { save: number; open: number; message: number });
}

/** Clicks an item of the native application menu, like the user would. */
async function clickMenu(app: ElectronApplication, ...path: string[]): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, labels) => {
    let items = Menu.getApplicationMenu()!.items;
    let found: Electron.MenuItem | undefined;
    for (const label of labels) {
      found = items.find((item) => item.label === label || item.label.startsWith(label));
      if (!found) throw new Error(`No menu item "${label}" among: ${items.map((item) => item.label).join(", ")}`);
      items = found.submenu?.items ?? [];
    }
    found!.click(undefined, BrowserWindow.getAllWindows()[0], undefined);
  }, path);
}

async function deleteEntity(page: Page, name: string): Promise<void> {
  const point = await cardGrabPoint(page, name);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("Delete");
  await expect(card(page, name)).toHaveCount(0);
}

function requestClose(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
}

function isDocumentEdited(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDocumentEdited());
}

test("saves a project directory atomically and reopens it in a new session", async () => {
  const projectPath = await newProjectPath("Feedback example");
  const first = await launchApp();
  let savedSource: string;
  try {
    const { app, page } = first;
    await stubDialogs(app, { savePath: projectPath });
    await deleteEntity(page, "light");
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
    await expect.poll(() => isDocumentEdited(app)).toBe(true);

    // First save of an unsaved project asks for a location.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    expect(await dialogCalls(app)).toMatchObject({ save: 1 });
    expect((await readdir(projectPath)).sort()).toEqual(["face.json", "main.face"]);
    const manifest = JSON.parse(await readFile(resolve(projectPath, "face.json"), "utf8"));
    expect(manifest).toEqual({ formatVersion: 1, gameVersion: "2.1.24", modules: ["base", "space-age", "quality", "recycler", "elevated-rails"], customSignalGroups: [], name: "Feedback example", circuits: ["main.face"] });
    savedSource = await readFile(resolve(projectPath, "main.face"), "utf8");
    expect(savedSource).toContain("decider gate at (300, 80) {");
    expect(savedSource).not.toContain("lamp light");
    await expect.poll(() => isDocumentEdited(app)).toBe(false);
    await expect(page.locator(".project-meta .path")).toHaveText(projectPath);

    // Later saves go to the same place without a dialog (here through File > Save in the native menu).
    await deleteEntity(page, "pick");
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    expect(await dialogCalls(app)).toMatchObject({ save: 1 });
    savedSource = await readFile(resolve(projectPath, "main.face"), "utf8");
    expect(savedSource).not.toContain("selector pick");
    expect((await readdir(projectPath)).sort()).toEqual(["face.json", "main.face"]);
  } finally {
    await closeApp(first.app);
  }

  // A new session with the same profile finds the project under File > Open Recent and loads it from disk.
  const second = await launchApp({ userData: first.userData });
  try {
    const { app, page } = second;
    const recent = await page.evaluate(() => window.face!.getRecentProjects());
    expect(recent).toMatchObject({ ok: true, value: [{ path: projectPath, name: "Feedback example" }] });
    expect(JSON.parse(await readFile(resolve(second.userData, "recent-projects.json"), "utf8"))).toHaveLength(1);

    await clickMenu(app, "File", "Open Recent", "Feedback example");
    await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
    await expect(page.getByTestId("project-name")).toHaveText("Feedback example");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    // Demo limitation: without the language package an opened project is shown as source only.
    const editor = page.locator(".source-pane .cm-content");
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("decider gate at (300, 80) {");
    await expect(editor).not.toContainText("selector pick");

    // Editing the source and saving writes exactly the editor's text back.
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("// reopened");
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    expect(await readFile(resolve(projectPath, "main.face"), "utf8")).toBe(savedSource + "// reopened");
  } finally {
    await closeApp(second.app);
  }
});

test("opens a project through File > Open and refuses directories that are not projects", async ({ app, page }) => {
  const projectPath = await newProjectPath("Opened");
  await stubDialogs(app, { savePath: projectPath });
  await clickMenu(app, "File", "Save As...");
  await expect(page.locator(".project-meta .path")).toHaveText(projectPath);

  // New project: an empty, unsaved, editable circuit.
  await clickMenu(app, "File", "New Project");
  await expect(page.getByTestId("project-name")).toHaveText("Untitled circuit");
  await expect(page.locator(".canvas-empty")).toBeVisible();
  await expect(page.locator(".project-meta .path")).toHaveText("Not saved yet");

  await stubDialogs(app, { openPath: projectPath });
  await clickMenu(app, "File", "Open Project...");
  await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
  await expect(page.locator(".source-pane .cm-content")).toContainText('circuit "Feedback example" {');
  expect(await dialogCalls(app)).toMatchObject({ open: 1, message: 0 });

  // A directory without face.json is reported, and the open project stays.
  await stubDialogs(app, { openPath: PROJECTS_DIR });
  await clickMenu(app, "File", "Open Project...");
  await expect(page.getByRole("alert")).toContainText("Not a face project");
  await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Saving into a foreign, non-empty directory is refused and writes nothing there.
  await stubDialogs(app, { savePath: PROJECTS_DIR });
  await clickMenu(app, "File", "Save As...");
  await expect(page.getByRole("alert")).toContainText("not empty");
  expect(existsSync(resolve(PROJECTS_DIR, "face.json"))).toBe(false);
});

test("closes without asking when there are no unsaved changes", async () => {
  const { app, userData } = await launchApp();
  await stubDialogs(app, {});
  const closed = app.waitForEvent("close");
  await requestClose(app);
  await closed;
  await expect.poll(() => exitCodeOf(app)).toBe(0);
  expect((await readdir(userData)).includes("recent-projects.json")).toBe(false);
});

test("asks before closing with unsaved changes: Cancel keeps the window, Discard closes without writing", async () => {
  const projectPath = await newProjectPath("Never written");
  const { app, page } = await launchApp();
  try {
    await deleteEntity(page, "light");
    await expect.poll(() => isDocumentEdited(app)).toBe(true);

    await stubDialogs(app, { savePath: projectPath, unsavedChoice: 2 });
    await requestClose(app);
    await expect.poll(async () => (await dialogCalls(app)).message).toBe(1);
    await page.waitForTimeout(200);
    expect(app.windows()).toHaveLength(1);
    expect(await entityNames(page)).toEqual(["source", "gate", "twice", "pick"]);

    await stubDialogs(app, { savePath: projectPath, unsavedChoice: 1 });
    const closed = app.waitForEvent("close");
    await requestClose(app);
    await closed;
    expect(existsSync(projectPath)).toBe(false);
  } finally {
    await closeApp(app);
  }
});

test("Save in the close prompt writes the project, then closes; a cancelled location keeps the window", async () => {
  const projectPath = await newProjectPath("Saved on close");
  const { app, page } = await launchApp();
  try {
    await deleteEntity(page, "light");
    await expect.poll(() => isDocumentEdited(app)).toBe(true);

    // Save is chosen, but the location dialog for the never-saved project is cancelled: nothing closes.
    await stubDialogs(app, { unsavedChoice: 0 });
    await requestClose(app);
    await expect.poll(async () => (await dialogCalls(app)).save).toBe(1);
    await page.waitForTimeout(200);
    expect(app.windows()).toHaveLength(1);
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");

    await stubDialogs(app, { savePath: projectPath, unsavedChoice: 0 });
    const closed = app.waitForEvent("close");
    await requestClose(app);
    await closed;
    expect(await readFile(resolve(projectPath, "main.face"), "utf8")).not.toContain("lamp light");
    expect(JSON.parse(await readFile(resolve(projectPath, "face.json"), "utf8")).name).toBe("Feedback example");
  } finally {
    await closeApp(app);
  }
});

test("the native menu forwards view, edit and simulation commands to the workbench", async ({ app, page }) => {
  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((item) => item.label));
  expect(labels).toEqual(expect.arrayContaining(["File", "Edit", "View", "Simulation"]));

  await clickMenu(app, "View", "Split");
  await expect(page.locator(".source-pane .cm-editor")).toBeVisible();
  await expect(page.locator("svg.canvas-svg")).toBeVisible();
  await clickMenu(app, "View", "Source");
  await expect(page.locator("svg.canvas-svg")).toHaveCount(0);
  await clickMenu(app, "View", "Circuit");

  const zoom = async () => Number(await page.locator(".canvas").getAttribute("data-zoom"));
  const fitted = await zoom();
  await clickMenu(app, "View", "Zoom In");
  await expect.poll(zoom).toBeCloseTo(fitted * 1.25, 5);
  await clickMenu(app, "View", "Actual Size");
  await expect.poll(zoom).toBeCloseTo(1, 5);
  await clickMenu(app, "View", "Fit to Content");
  await expect.poll(zoom).toBeCloseTo(fitted, 5);

  await clickMenu(app, "Simulation", "Step");
  await expect(page.getByTestId("tick-counter")).toHaveText("0001");
  await clickMenu(app, "Simulation", "Reset");
  await expect(page.getByTestId("tick-counter")).toHaveText("0000");

  // Edit commands act on the circuit unless a text field has focus.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await clickMenu(app, "Edit", "Select All");
  await expect(page.locator("g.card.selected")).toHaveCount(5);
  await page.keyboard.press("Escape");
  const light = await cardGrabPoint(page, "light");
  await page.mouse.click(light.x, light.y);
  await page.getByLabel("Entity name").click();
  await clickMenu(app, "Edit", "Delete");
  expect(await entityNames(page)).toHaveLength(5);
  await page.locator("svg.canvas-svg").focus();
  await clickMenu(app, "Edit", "Delete");
  expect(await entityNames(page)).toEqual(["source", "gate", "twice", "pick"]);
  await clickMenu(app, "Edit", "Undo");
  expect(await entityNames(page)).toHaveLength(5);
  await clickMenu(app, "Edit", "Redo");
  expect(await entityNames(page)).toHaveLength(4);
});
