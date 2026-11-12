// Launching and driving the built app. Each launch gets its own profile directory under .runtime/test-user-data.
import { _electron, test as base, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
export const MAIN_SCRIPT = resolve(ROOT, "dist/main.cjs");
export const USER_DATA_DIR = resolve(ROOT, ".runtime/test-user-data");
export const PROJECTS_DIR = resolve(ROOT, ".runtime/e2e-projects");
export const SCREENSHOT_DIR = resolve(ROOT, ".runtime/screenshots");
export const MEASUREMENT_DIR = resolve(ROOT, ".runtime/measurements");
export const APP_TITLE = "FActorio Circuit Editor";

let launchCount = 0;
/** The OS process behind each launched app. Playwright's own handle is gone once the app has closed. */
const processes = new WeakMap<ElectronApplication, ChildProcess>();

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Exit code of an app that has closed (null while it is still running or when it was killed by a signal). */
export function exitCodeOf(app: ElectronApplication): number | null {
  return processes.get(app)?.exitCode ?? null;
}

export interface LaunchOptions {
  /** Profile directory; defaults to a fresh one. Pass the same directory twice to test persistence across launches. */
  readonly userData?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface RunningApp {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly userData: string;
}

export async function launchApp(options: LaunchOptions = {}): Promise<RunningApp> {
  const userData = options.userData ?? resolve(USER_DATA_DIR, `profile-${process.pid}-${++launchCount}`);
  mkdirSync(userData, { recursive: true });
  const app = await _electron.launch({
    args: [MAIN_SCRIPT],
    cwd: ROOT,
    env: { ...(process.env as Record<string, string>), FACE_USER_DATA: userData, ...options.env },
  });
  processes.set(app, app.process());
  const page = await app.firstWindow();
  await page.waitForSelector(".app-shell");
  return { app, page, userData };
}

/** Closes the app without getting stuck in the unsaved-changes prompt. Kills only the process this test started. */
export async function closeApp(app: ElectronApplication): Promise<void> {
  const child = processes.get(app);
  if (!child || hasExited(child)) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await Promise.race([app.close(), new Promise((_, reject) => setTimeout(() => reject(new Error("close timed out")), 8_000))]);
  } catch {
    if (!hasExited(child)) child.kill("SIGKILL");
  }
  if (!hasExited(child)) await exited;
}

/** `page` is the app's window (it replaces Playwright's browser page; no browser is ever launched). */
export const test = base.extend<{ running: RunningApp; app: ElectronApplication }>({
  running: async ({}, use) => {
    const running = await launchApp();
    await use(running);
    await closeApp(running.app);
  },
  app: async ({ running }, use) => use(running.app),
  page: async ({ running }, use) => use(running.page),
});

export { expect } from "@playwright/test";

// Canvas helpers

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface CanvasView {
  /** World coordinate at the top-left corner of the canvas. */
  readonly origin: Point;
  readonly zoom: number;
  /** Canvas position and size in window coordinates. */
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export function canvas(page: Page): Locator {
  return page.locator("svg.canvas-svg");
}

export function card(page: Page, name: string): Locator {
  return page.locator(`g.card[data-entity-name="${name}"]`);
}

export function terminal(page: Page, name: string, side: "in" | "out"): Locator {
  return card(page, name).locator(`[data-terminal="${side}"]`);
}

export function wires(page: Page): Locator {
  return page.locator("g.wire");
}

export async function canvasView(page: Page): Promise<CanvasView> {
  const svg = canvas(page);
  const box = await svg.boundingBox();
  const viewBox = await svg.getAttribute("viewBox");
  if (!box || !viewBox) throw new Error("The canvas is not visible");
  const [x = 0, y = 0, width = 1] = viewBox.split(" ").map(Number);
  return { origin: { x, y }, zoom: box.width / width, box };
}

/** Window coordinates of a world point; throws when the point is outside the visible canvas. */
export async function clientPointOf(page: Page, world: Point): Promise<Point> {
  const view = await canvasView(page);
  const point = { x: view.box.x + (world.x - view.origin.x) * view.zoom, y: view.box.y + (world.y - view.origin.y) * view.zoom };
  const inside = point.x > view.box.x + 2 && point.y > view.box.y + 2 && point.x < view.box.x + view.box.width - 2 && point.y < view.box.y + view.box.height - 2;
  if (!inside) throw new Error(`World point (${world.x}, ${world.y}) is outside the visible canvas`);
  return point;
}

export async function entityPosition(page: Page, name: string): Promise<Point> {
  const element = card(page, name);
  return { x: Number(await element.getAttribute("data-x")), y: Number(await element.getAttribute("data-y")) };
}

/** Positions as the session holds them, independent of what is rendered. */
export async function committedPositions(page: Page): Promise<Record<string, Point>> {
  return page.evaluate(() => Object.fromEntries(window.faceSession!.getState().circuit.entities.map((entity) => [entity.name, { x: entity.position.x, y: entity.position.y }])));
}

export async function entityNames(page: Page): Promise<string[]> {
  return page.evaluate(() => window.faceSession!.getState().circuit.entities.map((entity) => entity.name));
}

/** The source document as the session holds it (the editor only renders the lines in view). */
export async function sourceText(page: Page): Promise<string> {
  return page.evaluate(() => window.faceSession!.getState().source);
}

// Projects on disk

let projectCount = 0;

/** A fresh path under .runtime/e2e-projects; the directory itself does not exist yet. */
export async function newProjectPath(name: string): Promise<string> {
  const parent = resolve(PROJECTS_DIR, `project-${process.pid}-${++projectCount}`);
  await mkdir(parent, { recursive: true });
  return resolve(parent, name);
}

export interface ProjectFiles {
  readonly name: string;
  readonly source: string;
  /** Overrides and additions for face.json. */
  readonly manifest?: Readonly<Record<string, unknown>>;
}

/** Writes a project directory the way the app would, and returns its path. */
export async function writeProject({ name, source, manifest }: ProjectFiles): Promise<string> {
  const directory = await newProjectPath(name);
  await mkdir(directory);
  await writeFile(resolve(directory, "main.face"), source);
  const content = { formatVersion: 1, name, gameVersion: "2.1.24", modules: ["base", "space-age", "quality", "recycler", "elevated-rails"], customSignalGroups: [], circuits: ["main.face"], ...manifest };
  await writeFile(resolve(directory, "face.json"), JSON.stringify(content, null, 2) + "\n");
  return directory;
}

/** Opens a project directory through the session's own load command (the path File > Open Recent takes) and waits for it. */
export async function openProject(page: Page, directory: string): Promise<void> {
  await page.evaluate((path) => window.faceSession!.commands.loadProject(path), directory);
  await page.locator(".project-meta .path", { hasText: directory }).waitFor();
}

/** Clicks the middle of an element with real mouse input. */
export async function clickCenter(page: Page, target: Locator, options: { button?: "left" | "right" } = {}): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("Target is not visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, options);
}

/**
 * Keys that put the caret at the start or end of a single-line field. On macOS these are not Home and End: the system binds those
 * to scrolling, so inside a scrollable panel they scroll the panel and move the caret only once nothing is left to scroll.
 */
export const CARET = process.platform === "darwin" ? { start: "Meta+ArrowLeft", end: "Meta+ArrowRight" } : { start: "Home", end: "End" };

/** A point on the card body that is clear of terminals, text hit areas do not matter. */
export async function cardGrabPoint(page: Page, name: string): Promise<Point> {
  const position = await entityPosition(page, name);
  return clientPointOf(page, { x: position.x + 92, y: position.y + 30 });
}

// Native dialogs and menus. Dialogs cannot be driven, so the main process's dialog functions are replaced through
// Playwright; everything behind them (validation, atomic writes, menu, IPC) is real.

export interface DialogAnswers {
  readonly savePath?: string;
  readonly openPath?: string;
  /** Button index of the unsaved-changes prompt: 0 Save, 1 Discard, 2 Cancel (the default). */
  readonly unsavedChoice?: number;
}

/** Makes the dialogs answer as given and counts how often each one was shown. */
export async function stubDialogs(app: ElectronApplication, answers: DialogAnswers): Promise<void> {
  await app.evaluate(({ dialog }, { savePath, openPath, unsavedChoice }) => {
    const calls = { save: 0, open: 0, message: 0 };
    (globalThis as Record<string, unknown>).dialogCalls = calls;
    dialog.showSaveDialog = (async () => (calls.save++, { canceled: savePath === undefined, filePath: savePath ?? "" })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => (calls.open++, { canceled: openPath === undefined, filePaths: openPath === undefined ? [] : [openPath] })) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async () => (calls.message++, { response: unsavedChoice ?? 2, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, answers);
}

export function dialogCalls(app: ElectronApplication): Promise<{ save: number; open: number; message: number }> {
  return app.evaluate(() => (globalThis as Record<string, unknown>).dialogCalls as { save: number; open: number; message: number });
}

/** Clicks an item of the native application menu by its labels, for example `clickMenu(app, "File", "Save")`. */
export async function clickMenu(app: ElectronApplication, ...path: string[]): Promise<void> {
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

/** Selects an entity by clicking its card. */
export async function selectEntity(page: Page, name: string): Promise<void> {
  const point = await cardGrabPoint(page, name);
  await page.mouse.click(point.x, point.y);
  await card(page, name).and(page.locator(".selected")).waitFor();
}
