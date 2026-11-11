// Launching and driving the built app. Each launch gets its own profile directory under .runtime/test-user-data.
import { _electron, test as base, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
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

/** Positions as the controller holds them, independent of what is rendered. */
export async function committedPositions(page: Page): Promise<Record<string, Point>> {
  return page.evaluate(() => Object.fromEntries(window.faceDemo!.getCircuit().entities.map((entity) => [entity.name, { x: entity.position.x, y: entity.position.y }])));
}

export async function entityNames(page: Page): Promise<string[]> {
  return page.evaluate(() => window.faceDemo!.getCircuit().entities.map((entity) => entity.name));
}

/** Clicks the middle of an element with real mouse input. */
export async function clickCenter(page: Page, target: Locator, options: { button?: "left" | "right" } = {}): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("Target is not visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, options);
}

/** A point on the card body that is clear of terminals, text hit areas do not matter. */
export async function cardGrabPoint(page: Page, name: string): Promise<Point> {
  const position = await entityPosition(page, name);
  return clientPointOf(page, { x: position.x + 92, y: position.y + 30 });
}
