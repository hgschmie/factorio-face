// Project persistence and the unsaved-changes handshake, starting from the example circuit as File > Open Example opens it: an unsaved copy.
import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  card,
  cardGrabPoint,
  clickMenu,
  closeApp,
  dialogCalls,
  entityNames,
  exitCodeOf,
  expect,
  isDocumentEdited,
  launchApp,
  newProjectPath,
  PROJECT_FILE_EXTENSION,
  PROJECTS_DIR,
  readProjectEntries,
  sourceText,
  stubDialogs,
  test,
} from "./app.ts";

async function deleteEntity(page: Page, name: string): Promise<void> {
  const point = await cardGrabPoint(page, name);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("Delete");
  await expect(card(page, name)).toHaveCount(0);
}

function requestClose(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
}

test("saves a project file atomically and reopens it in a new session", async () => {
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
    // The dialog asks for one project file and suggests the project's name with the extension.
    const calls = await dialogCalls(app);
    expect(calls).toMatchObject({ save: 1, saveOptions: { filters: [{ name: "face project", extensions: ["faceproj"] }], nameFieldLabel: "Project file:" } });
    expect(calls.saveOptions!.defaultPath).toMatch(/Feedback example\.faceproj$/);
    // The project is that one file, a zip archive with the manifest and the circuit; nothing else is left next to it.
    expect(await readdir(dirname(projectPath))).toEqual([basename(projectPath)]);
    let entries = await readProjectEntries(projectPath);
    expect(Object.keys(entries).sort()).toEqual(["face.json", "main.face"]);
    const manifest = JSON.parse(entries["face.json"]!);
    expect(manifest).toEqual({ formatVersion: 1, gameVersion: "2.1.24", modules: ["base", "space-age", "quality", "recycler", "elevated-rails"], customSignalGroups: [], name: "Feedback example", circuits: ["main.face"] });
    savedSource = entries["main.face"]!;
    expect(savedSource).toContain("decider gate at (300, 80) {");
    expect(savedSource).not.toContain("lamp light");
    await expect.poll(() => isDocumentEdited(app)).toBe(false);
    await expect(page.locator(".project-meta .path")).toHaveText(projectPath);

    // What is on disk is the document, byte for byte, including the comment at the top.
    expect(savedSource).toBe(await sourceText(page));
    expect(savedSource.startsWith("// A counter that lights a lamp.\n")).toBe(true);

    // Later saves go to the same place without a dialog (here through File > Save in the native menu).
    await deleteEntity(page, "twice");
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    expect(await dialogCalls(app)).toMatchObject({ save: 1 });
    entries = await readProjectEntries(projectPath);
    savedSource = entries["main.face"]!;
    expect(savedSource).not.toContain("arithmetic twice");
    expect(Object.keys(entries).sort()).toEqual(["face.json", "main.face"]);
    expect(await readdir(dirname(projectPath))).toEqual([basename(projectPath)]);
  } finally {
    await closeApp(first.app);
  }

  // A new session with the same profile starts with that project (start.spec.ts). From another project, here a new one, it is
  // found under File > Open Recent and loaded from disk.
  const second = await launchApp({ userData: first.userData, open: "start" });
  try {
    const { app, page } = second;
    await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
    await clickMenu(app, "File", "New Project");
    await expect(page.locator(".project-meta .path")).toHaveText("Not saved yet");
    await expect(page.locator("g.card")).toHaveCount(0);
    const recent = await page.evaluate(() => window.face!.getRecentProjects());
    expect(recent).toMatchObject({ ok: true, value: [{ path: projectPath, name: "Feedback example" }] });
    expect(JSON.parse(await readFile(resolve(second.userData, "recent-projects.json"), "utf8"))).toHaveLength(1);

    await clickMenu(app, "File", "Open Recent", "Feedback example");
    await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
    await expect(page.getByTestId("project-name")).toHaveText("Feedback example");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    // The opened project parses straight into the canvas.
    await expect(page.locator("g.card")).toHaveCount(2);
    expect(await entityNames(page)).toEqual(["source", "gate"]);
    await expect(page.locator("g.wire")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(await sourceText(page)).toBe(savedSource);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const editor = page.locator(".source-pane .cm-content");
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("decider gate at (300, 80) {");

    // Editing the source and saving writes exactly the editor's text back.
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("// reopened");
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    expect((await readProjectEntries(projectPath))["main.face"]).toBe(savedSource + "// reopened");
  } finally {
    await closeApp(second.app);
  }
});

test("opens a project through File > Open and refuses directories and files that are not projects", async ({ app, page }) => {
  const projectPath = await newProjectPath("Opened");
  // A name without the extension, as a save panel may return it: the extension is appended.
  await stubDialogs(app, { savePath: projectPath.slice(0, -PROJECT_FILE_EXTENSION.length) });
  await clickMenu(app, "File", "Save As...");
  await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
  expect(await readdir(dirname(projectPath))).toEqual([basename(projectPath)]);

  await deleteEntity(page, "light");
  await clickMenu(app, "File", "Save");
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved");

  // New project: an empty circuit, unsaved, editable, with an empty history.
  await clickMenu(app, "File", "New Project");
  await expect(page.locator(".project-meta .path")).toHaveText("Not saved yet");
  await expect(page.getByTestId("project-name")).toHaveText("Untitled circuit");
  await expect(page.getByTestId("save-state")).toHaveText("No changes");
  await expect(page.locator("g.card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await stubDialogs(app, { openPath: projectPath });
  await clickMenu(app, "File", "Open Project...");
  await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
  await expect(page.locator("g.card")).toHaveCount(3);
  expect(await entityNames(page)).toEqual(["source", "gate", "twice"]);
  expect(await sourceText(page)).toContain('circuit "Feedback example" {');
  expect(await dialogCalls(app)).toMatchObject({ open: 1, message: 0, openOptions: { filters: [{ name: "face project", extensions: ["faceproj"] }], properties: ["openFile"] } });

  // Directories (the dropped project format, with or without the extension in the name) and files that are not zip archives
  // are reported, and the open project stays.
  const oldProject = await newProjectPath("Old format");
  await mkdir(oldProject);
  await writeFile(resolve(oldProject, "face.json"), JSON.stringify({ formatVersion: 1, name: "Old format", gameVersion: "2.1.24", modules: ["base"], circuits: ["main.face"] }));
  await writeFile(resolve(oldProject, "main.face"), 'circuit "Old format" {\n}\n');
  const notZip = await newProjectPath("Not a zip");
  await writeFile(notZip, "this is not a zip archive\n");
  for (const openPath of [PROJECTS_DIR, oldProject, notZip]) {
    await stubDialogs(app, { openPath });
    await clickMenu(app, "File", "Open Project...");
    await expect(page.getByRole("alert")).toContainText("Not a face project file");
    await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
    await expect(page.locator("g.card")).toHaveCount(3);
    await page.getByRole("button", { name: "Dismiss message" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  }

  // Saving over a directory is refused and writes nothing into it or next to it.
  await stubDialogs(app, { savePath: oldProject });
  await clickMenu(app, "File", "Save As...");
  await expect(page.getByRole("alert")).toContainText("over a folder");
  await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
  expect((await readdir(oldProject)).sort()).toEqual(["face.json", "main.face"]);
  expect(await readdir(dirname(oldProject))).toEqual([basename(oldProject)]);
  await page.getByRole("button", { name: "Dismiss message" }).click();

  // A name without the extension is not silently turned into an existing project file that the panel never asked about.
  const before = await readFile(projectPath);
  await stubDialogs(app, { savePath: projectPath.slice(0, -PROJECT_FILE_EXTENSION.length) });
  await clickMenu(app, "File", "Save As...");
  await expect(page.getByRole("alert")).toContainText("already exists");
  expect((await readFile(projectPath)).equals(before)).toBe(true);
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
    expect(await entityNames(page)).toEqual(["source", "gate", "twice"]);

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
    const entries = await readProjectEntries(projectPath);
    expect(entries["main.face"]).not.toContain("lamp light");
    expect(JSON.parse(entries["face.json"]!).name).toBe("Feedback example");
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
  await expect(page.locator("g.card.selected")).toHaveCount(4);
  await page.keyboard.press("Escape");
  const light = await cardGrabPoint(page, "light");
  await page.mouse.click(light.x, light.y);
  await page.getByLabel("Entity name").click();
  await clickMenu(app, "Edit", "Delete");
  expect(await entityNames(page)).toHaveLength(4);
  await page.locator("svg.canvas-svg").focus();
  await clickMenu(app, "Edit", "Delete");
  expect(await entityNames(page)).toEqual(["source", "gate", "twice"]);
  await clickMenu(app, "Edit", "Undo");
  expect(await entityNames(page)).toHaveLength(4);
  await clickMenu(app, "Edit", "Redo");
  expect(await entityNames(page)).toHaveLength(3);

  // With the caret in the source editor, Undo and Redo of the menu act on the same history.
  await clickMenu(app, "View", "Split");
  await page.locator(".source-pane .cm-content").click();
  await clickMenu(app, "Edit", "Undo");
  expect(await entityNames(page)).toHaveLength(4);
  await clickMenu(app, "Edit", "Redo");
  expect(await entityNames(page)).toHaveLength(3);
});
