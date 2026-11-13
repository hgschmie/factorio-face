// Canvas gestures with real pointer input: placing, dragging, wiring, zooming, panning.
import type { Page } from "@playwright/test";
import { canvas, canvasView, card, cardGrabPoint, clickCenter, clientPointOf, committedPositions, entityNames, entityPosition, expect, pin, sourceText, test, wires } from "./app.ts";
import { FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

// Every kind and every wire shape on one screen, opened as a project from disk.
test.beforeEach(async ({ page }) => {
  await openFiveKinds(page);
});

const KINDS = ["constant", "arithmetic", "decider", "selector", "lamp"] as const;

async function zoomOut(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await page.getByRole("button", { name: "Zoom out" }).click();
}

function tool(page: Page, name: string) {
  return page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name });
}

async function wireKeys(page: Page): Promise<string[]> {
  return wires(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-wire") ?? ""));
}

/** Path data of every wire on the canvas. */
async function wirePaths(page: Page): Promise<string[]> {
  return page.locator("g.wire path.wire-core").evaluateAll((paths) => paths.map((path) => path.getAttribute("d") ?? ""));
}

test("places each of the four combinators and the lamp from the palette", async ({ page }) => {
  await zoomOut(page, 2);
  for (const [index, kind] of KINDS.entries()) {
    const item = page.locator(`.palette-item[data-kind="${kind}"]`);
    await item.click();
    await expect(item).toHaveAttribute("aria-pressed", "true");
    // The pointer is the center of the new card: (92 + 240 i, 564) puts its corner on (240 i, 500).
    const point = await clientPointOf(page, { x: 92 + index * 240, y: 564 });
    await page.mouse.click(point.x, point.y);

    const placed = card(page, `${kind}1`);
    await expect(placed).toHaveAttribute("data-kind", kind);
    expect(await entityPosition(page, `${kind}1`)).toEqual({ x: index * 240, y: 500 });
    await expect(placed).toHaveClass(/selected/);
    // Placing returns to the select tool and shows the new entity in the inspector.
    await expect(item).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("Entity name")).toHaveValue(`${kind}1`);
  }
  expect(await entityNames(page)).toEqual(["source", "gate", "twice", "pick", "light", "constant1", "arithmetic1", "decider1", "selector1", "lamp1"]);
  expect((await committedPositions(page)).selector1).toEqual({ x: 720, y: 500 });
  // Pins follow the kind: a constant only has an output, a lamp only an input; each side has a red and a green pin.
  await expect(card(page, "constant1").locator("[data-terminal]")).toHaveCount(2);
  await expect(card(page, "lamp1").locator("[data-terminal]")).toHaveCount(2);
  await expect(card(page, "selector1").locator("[data-terminal]")).toHaveCount(4);
  for (const color of ["red", "green"] as const) {
    await expect(pin(page, "constant1", "out", color)).toHaveCount(1);
    await expect(pin(page, "lamp1", "in", color)).toHaveCount(1);
    await expect(pin(page, "selector1", "in", color)).toHaveCount(1);
    await expect(pin(page, "selector1", "out", color)).toHaveCount(1);
  }
  await expect(pin(page, "selector1", "in", "red").locator("title")).toHaveText("Red input");
  await expect(pin(page, "selector1", "out", "green").locator("title")).toHaveText("Green output");
  // Red sits above green, and the two dots do not touch.
  const redBox = (await pin(page, "selector1", "out", "red").locator(".pin-dot").boundingBox())!;
  const greenBox = (await pin(page, "selector1", "out", "green").locator(".pin-dot").boundingBox())!;
  expect(redBox.x).toBeCloseTo(greenBox.x, 1);
  expect(greenBox.y).toBeGreaterThan(redBox.y + redBox.height);
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
  // Each placement is a declaration appended to the source; what was there is untouched.
  const source = await sourceText(page);
  expect(source).toContain("selector selector1 at (720, 500) {");
  expect(source.startsWith(FIVE_KINDS_SOURCE.slice(0, FIVE_KINDS_SOURCE.indexOf("    wire red source.out")))).toBe(true);
});

test("drags an entity and commits the snapped position of the pointer release", async ({ page }) => {
  const { zoom } = await canvasView(page);
  const start = await cardGrabPoint(page, "source");
  expect(await entityPosition(page, "source")).toEqual({ x: 40, y: 80 });

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // On the way, the preview follows the pointer in grid steps.
  await page.mouse.move(start.x + 47 * zoom, start.y + 22 * zoom, { steps: 4 });
  await expect(card(page, "source")).toHaveAttribute("data-x", "80");
  await expect(card(page, "source")).toHaveAttribute("data-y", "100");
  expect((await committedPositions(page)).source).toEqual({ x: 40, y: 80 });

  // The last move and the release happen back to back: the drop must use the release coordinates even if the
  // preview for them was never rendered.
  await page.mouse.move(start.x - 63 * zoom, start.y + 108 * zoom);
  await page.mouse.up();
  await expect(card(page, "source")).toHaveAttribute("data-x", "-20");
  expect(await entityPosition(page, "source")).toEqual({ x: -20, y: 180 });
  expect((await committedPositions(page)).source).toEqual({ x: -20, y: 180 });
  // Wires follow: each wire from source.out starts in the moved pin of its color.
  const redPath = await page.locator('g.wire[data-wire="red|e1.out|e2.in"] path.wire-core').getAttribute("d");
  const greenPath = await page.locator('g.wire[data-wire="green|e1.out|e2.in"] path.wire-core').getAttribute("d");
  // Out of the pin, one vertical leg midway to the gate (red inside the bend, green a pin spacing outside), into the pin of the same color.
  expect(redPath).toBe("M 164 240 L 208 240 Q 222 240 222 226 L 222 154 Q 222 140 236 140 L 300 140");
  expect(greenPath).toBe("M 164 260 L 228 260 Q 242 260 242 246 L 242 174 Q 242 160 256 160 L 300 160");

  // The move is a patch of the two numbers in the source.
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE.replace("constant source at (40, 80)", "constant source at (-20, 180)"));

  // One undo restores both coordinates.
  await page.getByRole("button", { name: "Undo" }).click();
  expect((await committedPositions(page)).source).toEqual({ x: 40, y: 80 });
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await page.getByRole("button", { name: "Redo" }).click();
  expect((await committedPositions(page)).source).toEqual({ x: -20, y: 180 });
});

test("a click without movement selects and does not move; shift-click extends the selection", async ({ page }) => {
  const gate = await cardGrabPoint(page, "gate");
  await page.mouse.click(gate.x, gate.y);
  await expect(card(page, "gate")).toHaveClass(/selected/);
  expect((await committedPositions(page)).gate).toEqual({ x: 300, y: 80 });
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  const light = await cardGrabPoint(page, "light");
  await page.keyboard.down("Shift");
  await page.mouse.click(light.x, light.y);
  await page.keyboard.up("Shift");
  await expect(page.locator("g.card.selected")).toHaveCount(2);
  // The inspector is the place that names a multi-selection; nothing floats over the canvas.
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.getByRole("heading", { name: "2 entities selected" })).toBeVisible();
  await expect(inspector.locator(".inspector-multi .muted-note")).toHaveText("gate, light");
  await expect(page.locator(".canvas").getByRole("button", { name: /Delete/ })).toHaveCount(0);

  // Dragging one member moves the whole selection by the same amount.
  const { zoom } = await canvasView(page);
  await page.mouse.move(light.x, light.y);
  await page.mouse.down();
  await page.mouse.move(light.x + 40 * zoom, light.y - 40 * zoom, { steps: 3 });
  await page.mouse.up();
  const positions = await committedPositions(page);
  expect(positions.light).toEqual({ x: 600, y: 40 });
  expect(positions.gate).toEqual({ x: 340, y: 40 });

  // A click on empty canvas clears the selection.
  const empty = await clientPointOf(page, { x: 100, y: 330 });
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator("g.card.selected")).toHaveCount(0);
});

test("wires input-first and output-first in both colors, including feedback", async ({ page }) => {
  const before = await wireKeys(page);
  expect(before).toHaveLength(7);

  // Red, input first: light.in then pick.out.
  await tool(page, "Red wire").click();
  await expect(tool(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".canvas-hint")).toContainText("Click a red pin");
  await clickCenter(page, pin(page, "light", "in", "red"));
  await expect(pin(page, "light", "in", "red")).toHaveClass(/pending/);
  await expect(page.locator(".pin.pending")).toHaveCount(1);
  await expect(page.locator(".canvas-hint")).toContainText("second red pin");
  await clickCenter(page, pin(page, "pick", "out", "red"));
  await expect(page.locator('g.wire[data-wire="red|e4.out|e5.in"]')).toHaveAttribute("data-color", "red");

  // Green, output first, between the same pair: a second, separate route.
  await tool(page, "Green wire").click();
  await clickCenter(page, pin(page, "pick", "out", "green"));
  await clickCenter(page, pin(page, "light", "in", "green"));
  await expect(page.locator('g.wire[data-wire="green|e4.out|e5.in"]')).toHaveAttribute("data-color", "green");
  const redPath = await page.locator('g.wire[data-wire="red|e4.out|e5.in"] path.wire-core').getAttribute("d");
  const greenPath = await page.locator('g.wire[data-wire="green|e4.out|e5.in"] path.wire-core').getAttribute("d");
  expect(redPath).not.toBe(greenPath);
  // Each wire starts and ends in the center of the pins of its color (window coordinates, within half a pixel).
  for (const color of ["red", "green"] as const) {
    const ends = await page.locator(`g.wire[data-wire="${color}|e4.out|e5.in"] path.wire-core`).evaluate((path: SVGPathElement) => {
      const onScreen = (length: number) => path.getPointAtLength(length).matrixTransform(path.getScreenCTM()!);
      const [start, end] = [onScreen(0), onScreen(path.getTotalLength())];
      return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
    });
    const center = async (name: string, side: "in" | "out") => {
      const box = (await pin(page, name, side, color).locator(".pin-dot").boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const [out, input] = [await center("pick", "out"), await center("light", "in")];
    expect(Math.hypot(ends.start.x - out.x, ends.start.y - out.y)).toBeLessThan(0.5);
    expect(Math.hypot(ends.end.x - input.x, ends.end.y - input.y)).toBeLessThan(0.5);
  }

  // Feedback on one entity: green output first, then red input first.
  await clickCenter(page, pin(page, "twice", "out", "green"));
  await clickCenter(page, pin(page, "twice", "in", "green"));
  await tool(page, "Red wire").click();
  await clickCenter(page, pin(page, "twice", "in", "red"));
  await clickCenter(page, pin(page, "twice", "out", "red"));
  await expect(page.locator('g.wire[data-wire="green|e3.in|e3.out"]')).toHaveCount(1);
  await expect(page.locator('g.wire[data-wire="red|e3.in|e3.out"]')).toHaveCount(1);

  // Both loops run around the outside of the card, with different clearance.
  const loops = await page.evaluate(() => {
    const box = (key: string) => {
      const { x, y, width, height } = document.querySelector<SVGPathElement>(`g.wire[data-wire="${key}"] path.wire-core`)!.getBBox();
      return { left: x, top: y, right: x + width, bottom: y + height };
    };
    return { red: box("red|e3.in|e3.out"), green: box("green|e3.in|e3.out") };
  });
  const twice = await entityPosition(page, "twice");
  for (const loop of [loops.red, loops.green]) {
    expect(loop.top).toBeLessThan(twice.y);
    expect(loop.left).toBeLessThan(twice.x);
    expect(loop.right).toBeGreaterThan(twice.x + 184);
  }
  expect(loops.red.top - loops.green.top).toBeGreaterThanOrEqual(10);
  expect(loops.red.left - loops.green.left).toBeGreaterThanOrEqual(10);

  // Every wire, whatever its shape, is drawn with horizontal and vertical segments and rounded corners.
  const paths = await wirePaths(page);
  expect(paths).toHaveLength(11);
  for (const path of paths) {
    expect(path).toMatch(/^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+)* L [-\d.]+ [-\d.]+$/);
    // The start, the control point of every corner and the end.
    const corners = [...path.matchAll(/(?:^M|Q|L(?=[^LQ]*$)) (-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
    corners.slice(1).forEach((corner, index) => expect(corner.x === corners[index]!.x).not.toBe(corner.y === corners[index]!.y));
  }

  // As in the game, repeating an existing connection (here in the other direction) removes it; one undo brings it back.
  const afterFour = await wireKeys(page);
  expect(afterFour).toHaveLength(11);
  const sourceWithFour = await sourceText(page);
  expect(sourceWithFour).toContain("wire red light.in <-> pick.out");
  expect(sourceWithFour).toContain("wire green twice.out <-> twice.in");
  await clickCenter(page, pin(page, "pick", "out", "red"));
  await clickCenter(page, pin(page, "light", "in", "red"));
  await expect(wires(page)).toHaveCount(10);
  expect(await sourceText(page)).not.toContain("wire red light.in <-> pick.out");
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await wireKeys(page)).toEqual(afterFour);
  expect(await sourceText(page)).toBe(sourceWithFour);

  // Escape cancels a pending wire; a second Escape returns to the select tool.
  await clickCenter(page, pin(page, "pick", "in", "red"));
  await expect(pin(page, "pick", "in", "red")).toHaveClass(/pending/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".pin.pending")).toHaveCount(0);
  await clickCenter(page, pin(page, "gate", "out", "red"));
  await page.keyboard.press("Escape");
  expect(await wireKeys(page)).toEqual(afterFour);
  await expect(tool(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(tool(page, "Select and move")).toHaveAttribute("aria-pressed", "true");

  // The inspector lists the new connections and removes one.
  const light = await cardGrabPoint(page, "light");
  await page.mouse.click(light.x, light.y);
  await expect(page.locator(".connection")).toHaveCount(3);
  await page.getByRole("button", { name: "Remove green wire from in to pick.out" }).click();
  await expect(page.locator('g.wire[data-wire="green|e4.out|e5.in"]')).toHaveCount(0);
  await expect(page.locator(".connection")).toHaveCount(2);
});

test("a wire tool only works on the pins of its color", async ({ page }) => {
  const before = await wireKeys(page);
  const canvasElement = page.locator(".canvas");
  const dimmed = (name: string, side: "in" | "out", color: "red" | "green") => pin(page, name, side, color).evaluate((element) => Number(getComputedStyle(element).opacity) < 0.5);

  // Select tool: no pin is dimmed.
  expect(await dimmed("pick", "out", "red")).toBe(false);
  expect(await dimmed("pick", "out", "green")).toBe(false);

  // Red tool: green pins are dimmed and neither start nor finish a wire.
  await tool(page, "Red wire").click();
  await expect(canvasElement).toHaveClass(/wire-red/);
  expect(await dimmed("pick", "out", "green")).toBe(true);
  expect(await dimmed("pick", "out", "red")).toBe(false);
  await clickCenter(page, pin(page, "pick", "out", "green"));
  await expect(page.locator(".pin.pending")).toHaveCount(0);
  await expect(page.locator(".wire-preview")).toHaveCount(0);
  await expect(page.locator(".canvas-hint")).toContainText("to start a red wire");

  await clickCenter(page, pin(page, "pick", "out", "red"));
  await expect(pin(page, "pick", "out", "red")).toHaveClass(/pending/);
  await expect(pin(page, "pick", "out", "green")).not.toHaveClass(/pending/);
  await clickCenter(page, pin(page, "light", "in", "green"));
  // The wire is still pending: the rubber band starts in the center of the red pin.
  await expect(pin(page, "pick", "out", "red")).toHaveClass(/pending/);
  expect(await wireKeys(page)).toEqual(before);
  const pick = await entityPosition(page, "pick");
  expect(await page.locator(".wire-preview.red").getAttribute("d")).toMatch(new RegExp(`^M ${pick.x + 184} ${pick.y + 60} L `));
  await clickCenter(page, pin(page, "light", "in", "red"));
  await expect(page.locator('g.wire[data-wire="red|e4.out|e5.in"]')).toHaveCount(1);
  expect(await wireKeys(page)).toHaveLength(before.length + 1);

  // Green tool: the same green pins now start and finish a green wire, and the red ones are out of reach.
  await tool(page, "Green wire").click();
  await expect(canvasElement).toHaveClass(/wire-green/);
  expect(await dimmed("pick", "out", "red")).toBe(true);
  expect(await dimmed("pick", "out", "green")).toBe(false);
  await clickCenter(page, pin(page, "pick", "out", "red"));
  await expect(page.locator(".pin.pending")).toHaveCount(0);
  await clickCenter(page, pin(page, "pick", "out", "green"));
  await expect(pin(page, "pick", "out", "green")).toHaveClass(/pending/);
  const aside = await clientPointOf(page, { x: pick.x + 100, y: pick.y - 60 });
  await page.mouse.move(aside.x, aside.y);
  expect(await page.locator(".wire-preview.green").getAttribute("d")).toMatch(new RegExp(`^M ${pick.x + 184} ${pick.y + 80} L `));
  await clickCenter(page, pin(page, "light", "in", "green"));
  await expect(page.locator('g.wire[data-wire="green|e4.out|e5.in"]')).toHaveCount(1);
  expect(await sourceText(page)).toContain("wire green pick.out <-> light.in");
  expect(await sourceText(page)).toContain("wire red pick.out <-> light.in");
});

test("the wheel zooms around the pointer and cancels default scrolling", async ({ page }) => {
  await page.evaluate(() => {
    const record = window as unknown as { wheelEvents: { defaultPrevented: boolean; cancelable: boolean }[] };
    record.wheelEvents = [];
    // Registered on page in the bubble phase, so it runs after the canvas handled the event.
    window.addEventListener("wheel", (event) => record.wheelEvents.push({ defaultPrevented: event.defaultPrevented, cancelable: event.cancelable }));
  });
  const before = await canvasView(page);
  const pointer = await clientPointOf(page, { x: 392, y: 144 });
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => (await canvasView(page)).zoom).toBeGreaterThan(before.zoom * 1.2);

  const events = await page.evaluate(() => (window as unknown as { wheelEvents: { defaultPrevented: boolean; cancelable: boolean }[] }).wheelEvents);
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((event) => event.cancelable && event.defaultPrevented)).toBe(true);
  expect(await page.evaluate(() => [document.scrollingElement?.scrollTop, window.scrollY])).toEqual([0, 0]);

  // The world point under the pointer did not move.
  const after = await clientPointOf(page, { x: 392, y: 144 });
  expect(Math.abs(after.x - pointer.x)).toBeLessThan(1);
  expect(Math.abs(after.y - pointer.y)).toBeLessThan(1);

  await page.mouse.wheel(0, 480);
  await expect.poll(async () => (await canvasView(page)).zoom).toBeLessThan(before.zoom);
});

test("dragging empty space pans, Fit shows everything again and the view survives a mode switch", async ({ page }) => {
  const before = await canvasView(page);
  const empty = await clientPointOf(page, { x: 100, y: 330 });
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 120, empty.y + 60, { steps: 4 });
  await page.mouse.up();
  const panned = await canvasView(page);
  expect(panned.zoom).toBeCloseTo(before.zoom, 6);
  expect(panned.origin.x).toBeCloseTo(before.origin.x - 120 / before.zoom, 3);
  expect(panned.origin.y).toBeCloseTo(before.origin.y - 60 / before.zoom, 3);
  expect((await committedPositions(page)).source).toEqual({ x: 40, y: 80 });

  // The canvas unmounts in Source mode; the camera must come back unchanged.
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(canvas(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Circuit", exact: true }).click();
  const restored = await canvasView(page);
  expect(restored.origin.x).toBeCloseTo(panned.origin.x, 3);
  expect(restored.zoom).toBeCloseTo(panned.zoom, 6);

  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const fitted = await canvasView(page);
  expect(fitted.origin.x).toBeCloseTo(before.origin.x, 3);
  expect(fitted.origin.y).toBeCloseTo(before.origin.y, 3);
});

test("simulation controls drive the real engine without touching the document", async ({ page }) => {
  const counter = page.getByTestId("tick-counter");
  await expect(counter).toHaveText("0000");
  await page.getByRole("button", { name: "Step" }).click();
  await page.getByRole("button", { name: "Step" }).click();
  await expect(counter).toHaveText("0002");
  await page.getByLabel("SPEED").selectOption("60");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect.poll(async () => Number(await counter.textContent())).toBeGreaterThan(10);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Reset simulation" }).click();
  await expect(counter).toHaveText("0000");
  // Nothing selected: the first three entities are traced.
  await expect(page.locator(".traces tr")).toHaveCount(3);
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
});
