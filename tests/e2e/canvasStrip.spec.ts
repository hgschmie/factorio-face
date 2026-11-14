// The strip above the canvas: the title with the counts, the three canvas tools, the Edit | Blueprint switch and "Place all",
// in a row of its own in Circuit and Split mode and in the smallest window. Only the hint and the zoom controls stay over the canvas.
import type { Page } from "@playwright/test";
import { canvas, card, displaySwitch, expect, showDisplay, shrinkToMinimum, sourceText, test } from "./app.ts";
import { placeAll, setSource } from "./board.ts";

const strip = (page: Page) => page.locator(".canvas-strip");
const tools = (page: Page) => page.getByRole("group", { name: "Canvas tools" });
const tool = (page: Page, name: string) => tools(page).getByRole("button", { name });
const MAC = process.platform === "darwin";

interface StripLayout {
  /** Rows the controls of the strip are on. */
  readonly rows: number;
  readonly stripAboveCanvas: boolean;
  readonly sameWidth: boolean;
  /** Controls that are cut off or outside the strip. */
  readonly outside: string[];
  readonly overflow: number;
  readonly height: number;
}

/** Where the strip and its controls are, measured in the page. */
function layoutOf(page: Page): Promise<StripLayout> {
  return page.evaluate(() => {
    const box = (element: Element) => element.getBoundingClientRect();
    const [stripElement, canvasElement] = [document.querySelector(".canvas-strip")!, document.querySelector(".canvas")!];
    const [outer, below] = [box(stripElement), box(canvasElement)];
    const controls = [...stripElement.querySelectorAll(".canvas-heading, .tool-row, .display-switch, .place-all")];
    return {
      rows: new Set(controls.map((control) => Math.round(box(control).top + box(control).height / 2))).size,
      stripAboveCanvas: Math.abs(outer.bottom - below.top) < 1,
      sameWidth: Math.abs(outer.left - below.left) < 1 && Math.abs(outer.right - below.right) < 1,
      outside: controls.filter((control) => box(control).left < outer.left || box(control).right > outer.right + 0.5 || box(control).top < outer.top || box(control).bottom > outer.bottom + 0.5).map((control) => control.className),
      overflow: stripElement.scrollWidth - stripElement.clientWidth,
      height: outer.height,
    };
  });
}

test("the strip is a row of its own above the canvas with the title, the counts, the tools and the display switch", async ({ page }) => {
  await expect(strip(page)).toHaveCount(1);
  await expect(strip(page).locator(".eyebrow")).toHaveText("Circuit workspace");
  await expect(strip(page).locator(".counts")).toHaveText("4 entities4 connections");
  await expect(tools(page).getByRole("button")).toHaveCount(3);
  await expect(displaySwitch(page).getByRole("button")).toHaveText(["Edit", "Blueprint"]);
  // Everything in it is in the strip, not over the canvas and not in the sidebar.
  for (const selector of [".canvas-heading", ".tool-row", ".display-switch"]) {
    await expect(strip(page).locator(selector)).toHaveCount(1);
    await expect(page.locator(`.canvas ${selector}, .palette ${selector}`)).toHaveCount(0);
  }
  await expect(page.locator(".palette")).not.toContainText(/tools/i);
  // The hint and the zoom controls are what stays over the canvas.
  await expect(page.locator(".canvas .canvas-hint")).toBeVisible();
  await expect(page.locator(".canvas").getByRole("group", { name: "Zoom" })).toBeVisible();

  const layout = await layoutOf(page);
  expect(layout).toMatchObject({ rows: 1, stripAboveCanvas: true, sameWidth: true, outside: [], overflow: 0 });
  // The strip takes no pointer from the canvas and the canvas none from it: a click in the top-left corner of the canvas is the canvas's.
  const top = (await page.locator(".canvas").boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest(".canvas-svg") !== null, [top.x + 30, top.y + 12])).toBe(true);

  // The counts follow the circuit.
  await page.keyboard.press("5");
  await canvas(page).focus();
  await page.keyboard.press("Enter");
  await expect(strip(page).locator(".counts")).toHaveText("5 entities4 connections");
  await setSource(page, 'circuit "One" {\n    lamp only at (0, 0) {\n    }\n}\n');
  await expect(strip(page).locator(".counts")).toHaveText("1 entity0 connections");
});

test("the tools of the strip keep their keys, tooltips, pressed and disabled states", async ({ page }) => {
  await expect(tool(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  await expect(tool(page, "Select and move")).toHaveAttribute("title", "Select and move (Q)");
  await expect(tool(page, "Red wire")).toHaveAttribute("title", MAC ? "Red wire (⌥R)" : "Red wire (Alt+R)");
  await expect(tool(page, "Green wire")).toHaveAttribute("title", MAC ? "Green wire (⌥G)" : "Green wire (Alt+G)");

  // A click arms a wire tool and a second one returns to the select tool; the canvas follows.
  await tool(page, "Red wire").click();
  await expect(tool(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await expect(tool(page, "Select and move")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".canvas")).toHaveClass(/tool-wire wire-red/);
  await expect(page.locator(".canvas-hint")).toContainText("Click a red pin");
  await tool(page, "Red wire").click();
  await expect(tool(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".canvas")).toHaveClass(/tool-select/);
  // The keys show in the buttons, wherever the focus is.
  await page.keyboard.press("Alt+KeyG");
  await expect(tool(page, "Green wire")).toHaveAttribute("aria-pressed", "true");
  await tool(page, "Select and move").click();
  await expect(tool(page, "Green wire")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Alt+KeyR");
  await expect(tool(page, "Red wire")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("q");
  await expect(tool(page, "Select and move")).toHaveAttribute("aria-pressed", "true");
  // A place tool is none of the three.
  await page.keyboard.press("3");
  await expect(tools(page).locator('[aria-pressed="true"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The display switch: the button and the key B, with the key in the tooltip.
  await expect(displaySwitch(page).getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "true");
  await expect(displaySwitch(page).getByRole("button", { name: "Blueprint" })).toHaveAttribute("title", "Blueprint view (B)");
  await showDisplay(page, "blueprint");
  await expect(displaySwitch(page).getByRole("button", { name: "Blueprint" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("b");
  await expect(displaySwitch(page).getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "true");

  // While the source has errors the wire tools are off; selecting and the display switch stay.
  await setSource(page, (await sourceText(page)).replace("< 10", "<"));
  await expect(tool(page, "Red wire")).toBeDisabled();
  await expect(tool(page, "Green wire")).toBeDisabled();
  await expect(tool(page, "Select and move")).toBeEnabled();
  await showDisplay(page, "blueprint");
  await expect(placeAll(page)).toBeDisabled();
});

test("on the board the strip has Place all with the number of entities without a tile", async ({ page }) => {
  await expect(placeAll(page)).toHaveCount(0);
  await showDisplay(page, "blueprint");
  // The example has no tiles: all four entities are dashed.
  await expect(placeAll(page)).toHaveText("Place all4");
  await expect(placeAll(page)).toHaveAttribute("title", "Place the 4 entities without a tile on the tiles they are shown at");
  await expect(strip(page).locator(".place-all")).toHaveCount(1);
  await expect(page.locator(".canvas .place-all")).toHaveCount(0);
  await expect(page.locator(".canvas-hint")).toHaveText("Drag entities to free tiles, R turns them. Dashed ones have no tile yet: drag them or use Place all.");
  expect(await layoutOf(page)).toMatchObject({ rows: 1, stripAboveCanvas: true, outside: [], overflow: 0 });

  await placeAll(page).click();
  await expect(page.locator("g.card.unplaced")).toHaveCount(0);
  await expect(placeAll(page)).toHaveCount(0);
  await expect(page.locator(".canvas-hint")).not.toContainText("Dashed");
  // One undo step for all of them.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(placeAll(page)).toHaveText("Place all4");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("the strip wraps where the canvas is narrow: Split mode and the smallest window", async ({ page, app }) => {
  await showDisplay(page, "blueprint");
  await expect(placeAll(page)).toBeVisible();
  const wide = await layoutOf(page);
  expect(wide.rows).toBe(1);

  const check = async (where: string): Promise<StripLayout> => {
    const layout = await layoutOf(page);
    expect(layout, where).toMatchObject({ stripAboveCanvas: true, sameWidth: true, outside: [], overflow: 0 });
    // Every control is on show and works where it is.
    for (const control of [tool(page, "Select and move"), tool(page, "Red wire"), tool(page, "Green wire"), displaySwitch(page).getByRole("button", { name: "Edit" }), displaySwitch(page).getByRole("button", { name: "Blueprint" }), placeAll(page)]) {
      await expect(control, where).toBeInViewport({ ratio: 1 });
    }
    await expect(strip(page).locator(".eyebrow"), where).toBeInViewport({ ratio: 1 });
    await expect(strip(page).locator(".counts"), where).toBeInViewport({ ratio: 1 });
    await tool(page, "Green wire").click();
    await expect(page.locator(".canvas"), where).toHaveClass(/wire-green/);
    await tool(page, "Select and move").click();
    // The canvas below keeps its controls and has room to work in.
    await expect(page.locator(".canvas").getByRole("group", { name: "Zoom" }), where).toBeInViewport({ ratio: 1 });
    expect((await page.locator(".canvas").boundingBox())!.height, where).toBeGreaterThan(200);
    return layout;
  };

  // Split: the canvas has half of its width, the strip two lines.
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".source-pane")).toBeVisible();
  const split = await check("split");
  expect(split.rows).toBe(2);
  expect(split.height).toBeGreaterThan(wide.height);

  // The smallest window, Circuit mode: one line still.
  await page.getByRole("button", { name: "Circuit", exact: true }).click();
  await shrinkToMinimum(app, page);
  expect((await check("minimum")).rows).toBe(1);
  // And Split in it, the narrowest the canvas gets.
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".source-pane")).toBeVisible();
  expect((await check("minimum split")).rows).toBeGreaterThanOrEqual(2);
  // The display switch works from there, and the entities are where the canvas shows them.
  await showDisplay(page, "edit");
  await expect(placeAll(page)).toHaveCount(0);
  await expect(card(page, "gate")).toBeVisible();
});
