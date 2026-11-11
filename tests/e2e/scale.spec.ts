// Scale check: 1,000 entities and 999 wires must stay interactive. The measurements are written to
// .runtime/measurements/scale-1000.json; the assertions only guard against gross regressions.
import type { Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canvasView, clientPointOf, committedPositions, expect, MEASUREMENT_DIR, SCREENSHOT_DIR, test } from "./app.ts";

interface FrameStats {
  readonly frames: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  /** Frames the browser itself reported as long (over 50 ms). */
  readonly longFrames: number;
  readonly cards: number;
  readonly wires: number;
}

interface FrameProbe {
  times: number[];
  long: number;
  running: boolean;
  observer?: PerformanceObserver;
}

/** Collects frame intervals in the page while `interaction` drives real pointer input. */
async function measureFrames(page: Page, interaction: () => Promise<void>): Promise<FrameStats> {
  await page.evaluate(() => {
    const probe: FrameProbe = { times: [], long: 0, running: true };
    (window as unknown as { frameProbe: FrameProbe }).frameProbe = probe;
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
      probe.observer = new PerformanceObserver((list) => (probe.long += list.getEntries().length));
      probe.observer.observe({ type: "long-animation-frame" });
    }
    const tick = (time: number): void => {
      probe.times.push(time);
      if (probe.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await interaction();
  return page.evaluate(async () => {
    const probe = (window as unknown as { frameProbe: FrameProbe }).frameProbe;
    await new Promise((done) => requestAnimationFrame(done));
    probe.running = false;
    probe.observer?.disconnect();
    const intervals = probe.times.slice(1).map((time, index) => time - probe.times[index]!).sort((a, b) => a - b);
    const at = (fraction: number): number => Math.round((intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * fraction))] ?? 0) * 10) / 10;
    return { frames: intervals.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1), longFrames: probe.long, cards: document.querySelectorAll("g.card").length, wires: document.querySelectorAll("g.wire").length };
  });
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number, steps: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
}

async function setZoom(page: Page, target: number): Promise<void> {
  const view = await canvasView(page);
  await page.mouse.move(view.box.x + view.box.width / 2, view.box.y + view.box.height / 2);
  // wheelZoomFactor: factor = exp(-deltaY * 0.0015). Sent in notches, like a real wheel.
  let remaining = -Math.log(target / view.zoom) / 0.0015;
  while (Math.abs(remaining) > 0.01) {
    const notch = Math.max(-100, Math.min(100, remaining));
    await page.mouse.wheel(0, notch);
    remaining -= notch;
  }
  await expect.poll(async () => (await canvasView(page)).zoom).toBeCloseTo(target, 2);
}

test("stays interactive with 1,000 entities", async ({ page }) => {
  test.setTimeout(180_000);
  const results: Record<string, unknown> = {};

  // Loading: the demo hook replaces the circuit; no CSP exemption is needed because nothing is evaluated from a string.
  results.loadToFrameMs = await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(done));
    const start = performance.now();
    window.faceDemo!.loadGrid(1000);
    await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    return Math.round((performance.now() - start) * 10) / 10;
  });
  await expect(page.locator(".canvas-heading .counts")).toContainText("1000 entities");
  await expect(page.locator(".canvas-heading .counts")).toContainText("999 connections");

  // Overview: everything is in view, drawn as outlines.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const overview = await canvasView(page);
  results.overviewZoom = Math.round(overview.zoom * 1000) / 1000;
  await expect(page.locator("g.card")).toHaveCount(1000);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, "scale-1000-overview.png") });

  const center = { x: overview.box.x + overview.box.width / 2, y: overview.box.y + overview.box.height / 2 };
  const gap = await clientPointOf(page, { x: 4800 + 212, y: 2160 + 150 });
  results.overviewPan = await measureFrames(page, () => dragBy(page, gap, 90, 40, 90));
  await page.getByRole("button", { name: "Fit", exact: true }).click();

  results.overviewZoomWheel = await measureFrames(page, async () => {
    await page.mouse.move(center.x, center.y);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, i < 15 ? -40 : 40);
  });
  await page.getByRole("button", { name: "Fit", exact: true }).click();

  const node500 = await clientPointOf(page, { x: 4800 + 92, y: 2160 + 64 });
  const view = await canvasView(page);
  results.overviewDragEntity = await measureFrames(page, () => dragBy(page, node500, 480 * view.zoom, 360 * view.zoom, 90));
  expect((await committedPositions(page)).node500).toEqual({ x: 5280, y: 2520 });

  // Mid zoom: a few hundred cards with full detail (text, icons).
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await setZoom(page, 0.32);
  const mid = await canvasView(page);
  const midGap = await clientPointOf(page, { x: mid.origin.x + mid.box.width / mid.zoom / 2, y: mid.origin.y + mid.box.height / mid.zoom / 2 });
  results.detailedPan = await measureFrames(page, () => dragBy(page, midGap, -300, -160, 90));

  // Normal zoom: culling leaves a few dozen cards in the document.
  await setZoom(page, 1);
  const close = await canvasView(page);
  const closeCenter = { x: close.box.x + close.box.width / 2, y: close.box.y + close.box.height / 2 };
  results.normalPan = await measureFrames(page, () => dragBy(page, { x: closeCenter.x, y: close.box.y + 60 }, -700, -300, 90));
  // Pick a card that is fully in view, with room to move it right and down.
  const afterPan = await canvasView(page);
  const positions = await committedPositions(page);
  const cardName = Object.keys(positions).find((name) => {
    const left = (positions[name]!.x - afterPan.origin.x) * afterPan.zoom;
    const top = (positions[name]!.y - afterPan.origin.y) * afterPan.zoom;
    return left > 40 && top > 40 && left < afterPan.box.width - 500 && top < afterPan.box.height - 300;
  })!;
  const before = positions[cardName]!;
  const grab = await clientPointOf(page, { x: before.x + 92, y: before.y + 30 });
  results.normalDragEntity = await measureFrames(page, () => dragBy(page, grab, 200, 120, 90));
  expect((await committedPositions(page))[cardName]).toEqual({ x: before.x + 200, y: before.y + 120 });

  // Whole-circuit updates.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.locator("svg.canvas-svg").focus();
  results.selectAllToFrameMs = await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(done));
    const start = performance.now();
    document.querySelector("svg.canvas-svg")!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", metaKey: true, ctrlKey: true, bubbles: true }));
    await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    return Math.round((performance.now() - start) * 10) / 10;
  });
  await expect(page.locator("g.card.selected")).toHaveCount(1000);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".source-pane .cm-content")).toContainText('circuit "Grid of 1000" {');
  await page.getByRole("button", { name: "Circuit", exact: true }).click();

  await mkdir(MEASUREMENT_DIR, { recursive: true });
  await writeFile(resolve(MEASUREMENT_DIR, "scale-1000.json"), JSON.stringify(results, null, 2) + "\n");
  console.log("scale-1000", JSON.stringify(results));

  // Coarse guards. A display refreshes every 8 to 17 ms; these limits are far from that on purpose.
  for (const key of ["overviewPan", "overviewZoomWheel", "overviewDragEntity", "detailedPan", "normalPan", "normalDragEntity"]) {
    const stats = results[key] as FrameStats;
    expect(stats.frames, key).toBeGreaterThan(10);
    expect(stats.medianMs, key).toBeLessThan(50);
    expect(stats.p95Ms, key).toBeLessThan(200);
  }
  expect((results.normalPan as FrameStats).cards).toBeLessThan(120);
  expect(results.loadToFrameMs as number).toBeLessThan(3000);
});
