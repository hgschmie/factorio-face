// Window, modes, renderer containment and the asset protocol.
import { existsSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { APP_TITLE, canvas, closeApp, expect, launchApp, PROJECTS_DIR, ROOT, SCREENSHOT_DIR, test } from "./app.ts";

const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("opens one page titled after the application", async ({ app, page }) => {
  expect(await page.title()).toBe(APP_TITLE);
  expect(app.windows()).toHaveLength(1);
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getName())).toBe(APP_TITLE);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe(APP_TITLE);
});

test("keeps the whole profile inside the workspace", async ({ app, running }) => {
  const paths = await app.evaluate(({ app: electronApp }) => Object.fromEntries((["userData", "sessionData", "logs", "crashDumps"] as const).map((name) => [name, electronApp.getPath(name)])));
  expect(paths.userData).toBe(running.userData);
  for (const path of Object.values(paths)) expect(path.startsWith(resolve(ROOT, ".runtime") + "/")).toBe(true);
  expect(existsSync(resolve(running.userData, "session"))).toBe(true);
});

test("switches between Circuit, Source and Split", async ({ page }) => {
  const mode = (name: string) => page.getByRole("navigation", { name: "Workbench mode" }).getByRole("button", { name, exact: true });
  const editor = page.locator(".source-pane .cm-editor");
  const palette = page.getByRole("complementary", { name: "Components" });

  await expect(mode("Circuit")).toHaveAttribute("aria-pressed", "true");
  await expect(canvas(page)).toBeVisible();
  await expect(palette).toBeVisible();
  await expect(editor).toBeHidden();

  await mode("Source").click();
  await expect(mode("Source")).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toBeVisible();
  await expect(canvas(page)).toHaveCount(0);
  await expect(palette).toHaveCount(0);
  await expect(editor.locator(".cm-content")).toContainText('circuit "Feedback example" {');
  await expect(editor.locator(".cm-lineNumbers")).toBeVisible();
  // The mode switch fades between its states.
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "workbench-source.png") });

  await mode("Split").click();
  await expect(canvas(page)).toBeVisible();
  await expect(editor).toBeVisible();
  const canvasBox = (await canvas(page).boundingBox())!;
  const editorBox = (await editor.boundingBox())!;
  expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(editorBox.x + 1);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "workbench-split.png") });

  await mode("Circuit").click();
  await expect(editor).toBeHidden();
  await expect(page.locator("g.card")).toHaveCount(4);
});

test("the mode switch and the palette are reachable by keyboard", async ({ page }) => {
  const source = page.getByRole("button", { name: "Source", exact: true });
  await source.focus();
  await page.keyboard.press("Enter");
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Circuit", exact: true }).focus();
  await page.keyboard.press("Space");

  const lamp = page.locator('.palette-item[data-kind="lamp"]');
  await lamp.focus();
  await page.keyboard.press("Enter");
  await expect(lamp).toHaveAttribute("aria-pressed", "true");
  // Enter on the focused canvas places the armed component in the middle of the view.
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('g.card[data-kind="lamp"]')).toHaveCount(2);
});

test("runs the renderer sandboxed, isolated and without remote or dynamic code", async ({ app, page }) => {
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences exists at runtime but is missing from Electron's type definitions.
    const contents = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> };
    const { contextIsolation, sandbox, nodeIntegration, webviewTag } = contents.getLastWebPreferences();
    return { contextIsolation, sandbox, nodeIntegration, webviewTag };
  });
  expect(preferences).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false });

  const inPage = await page.evaluate(async () => {
    // Run from a timer: code evaluated directly through the debugging protocol is exempt from the page's policy.
    const outcome = (run: () => unknown): Promise<string> =>
      new Promise((done) =>
        setTimeout(async () => {
          try {
            await run();
            done("allowed");
          } catch (error) {
            done((error as Error).name);
          }
        }, 0),
      );
    return {
      nodeGlobals: [typeof (globalThis as Record<string, unknown>).require, typeof (globalThis as Record<string, unknown>).process, typeof (globalThis as Record<string, unknown>).Buffer],
      api: Object.keys(window.face ?? {}).sort(),
      eval: await outcome(() => (0, eval)("1 + 1")),
      functionConstructor: await outcome(() => new Function("return 1")()),
      remoteFetch: await outcome(() => fetch("https://example.com/")),
      popup: window.open("https://example.com/") === null,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "",
    };
  });
  expect(page.url()).toBe("face-app://bundle/index.html");
  expect(inPage.nodeGlobals).toEqual(["undefined", "undefined", "undefined"]);
  expect(inPage.api).toEqual(["catalogAssetUrl", "clearRecentProjects", "confirmUnsavedChanges", "getRecentProjects", "loadProject", "newProject", "onMenuCommand", "onSaveBeforeClose", "openProject", "paste", "platform", "saveProject", "saveProjectAs", "setDirty"]);
  expect(inPage.eval).toBe("EvalError");
  expect(inPage.functionConstructor).toBe("EvalError");
  expect(inPage.remoteFetch).not.toBe("allowed");
  expect(inPage.popup).toBe(true);
  expect(inPage.csp).toContain("default-src 'none'");
  expect(inPage.csp).toContain("img-src 'self' data: face-asset:");
  expect(inPage.csp).not.toContain("unsafe-eval");

  // Navigation is blocked: the document stays where it is. Checked from the main process, because Playwright keeps
  // waiting for the navigation it saw starting.
  await page.evaluate(() => {
    location.href = "https://example.com/";
  });
  await page.waitForTimeout(300);
  const after = await app.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    return { url: contents.getURL(), alive: (await contents.executeJavaScript("document.querySelectorAll('g.card').length")) as number, windows: BrowserWindow.getAllWindows().length };
  });
  expect(after).toEqual({ url: "face-app://bundle/index.html", alive: 4, windows: 1 });
});

test("rejects malformed IPC arguments in the main process", async ({ page }) => {
  const results = await page.evaluate(async () => {
    const face = window.face!;
    const data = { manifest: { formatVersion: 1, name: "X", gameVersion: "2.1.24", modules: [], customSignalGroups: [], circuits: ["main.face"] }, files: [{ name: "main.face", source: "" }] };
    const evil = { manifest: { ...data.manifest, circuits: ["../escape.face"] }, files: [{ name: "../escape.face", source: "x" }] };
    return {
      relativeLoad: await face.loadProject("relative/path.faceproj"),
      traversalLoad: await face.loadProject("/tmp/../etc.faceproj"),
      nonString: await face.loadProject(42 as unknown as string),
      otherFileLoad: await face.loadProject("/etc/hosts"),
      relativeSave: await face.saveProject({ path: "relative.faceproj", data } as never),
      otherFileSave: await face.saveProject({ path: "/nonexistent-face-test/notes.txt", data } as never),
      missingFolderSave: await face.saveProject({ path: "/nonexistent-face-test/project.faceproj", data } as never),
      escapingFile: await face.saveProject({ path: "/nonexistent-face-test/project.faceproj", data: evil } as never),
      garbage: await face.saveProject("garbage" as never),
    };
  });
  for (const [name, result] of Object.entries(results)) expect(result.ok, name).toBe(false);
  expect(results.relativeLoad).toEqual({ ok: false, error: "Project path must be absolute" });
  expect(results.traversalLoad).toEqual({ ok: false, error: "Project path must be normalized" });
  // Main reads and writes project files only: any other name is refused before the filesystem is touched.
  expect(results.otherFileLoad).toEqual({ ok: false, error: "Not a face project file (the name must end in .faceproj): /etc/hosts" });
  expect(results.otherFileSave).toEqual({ ok: false, error: "Not a face project file (the name must end in .faceproj): /nonexistent-face-test/notes.txt" });
  expect(results.missingFolderSave).toEqual({ ok: false, error: "The folder for the project file does not exist: /nonexistent-face-test" });
  expect(existsSync("/nonexistent-face-test")).toBe(false);
});

test("serves icons through face-asset:// from the allow-listed root only", async () => {
  const base = resolve(PROJECTS_DIR, `assets-${process.pid}`);
  const assetRoot = resolve(base, "root");
  await mkdir(resolve(assetRoot, "icons/item"), { recursive: true });
  await writeFile(resolve(assetRoot, "icons/item/constant-combinator.png"), PIXEL_PNG);
  await writeFile(resolve(assetRoot, "notes.txt"), "not an image");
  await writeFile(resolve(base, "secret.png"), PIXEL_PNG);
  await symlink(resolve(base, "secret.png"), resolve(assetRoot, "icons/link.png"));

  const { app, page } = await launchApp({ env: { FACE_ASSET_ROOT: assetRoot } });
  try {
    const loads = await page.evaluate(async (urls) => {
      const load = (url: string) =>
        new Promise<boolean>((done) => {
          const image = new Image();
          image.onload = () => done(image.naturalWidth === 1);
          image.onerror = () => done(false);
          image.src = url;
        });
      return Promise.all(urls.map(load));
    }, ["face-asset://catalog/icons/item/constant-combinator.png", "face-asset://catalog/../secret.png", "face-asset://catalog/icons/%2e%2e/%2e%2e/%2e%2e/secret.png", "face-asset://catalog/icons/link.png", "face-asset://catalog/notes.txt", "face-asset://other/icons/item/constant-combinator.png", "file://" + resolve(base, "secret.png")]);
    expect(loads).toEqual([true, false, false, false, false, false, false]);

    // The one icon that exists replaces its placeholder; the other kinds keep the inline pictogram.
    await expect(page.locator('.palette-item[data-kind="constant"] img.entity-icon')).toBeVisible();
    await expect(page.locator('.palette-item[data-kind="decider"] svg.entity-icon')).toBeVisible();
    await expect(page.locator('g.card[data-kind="constant"] image')).toHaveCount(1);
    await expect(page.locator('g.card[data-kind="lamp"] image')).toHaveCount(0);
  } finally {
    await closeApp(app);
  }
});
