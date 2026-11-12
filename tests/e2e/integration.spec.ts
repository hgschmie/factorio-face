// The vertical slice as one product: text, canvas, catalog, simulation and persistence working on the same session.
// Every test starts from a new project, which holds the example circuit of docs/dsl.md.
import type { Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  canvasView,
  card,
  cardGrabPoint,
  clickMenu,
  closeApp,
  committedPositions,
  entityNames,
  expect,
  launchApp,
  newProjectPath,
  openProject,
  readProjectEntries,
  ROOT,
  selectEntity,
  sourceText,
  stubDialogs,
  test,
  writeProject,
  writeProjectEntries,
} from "./app.ts";

const HAS_CATALOG_ICONS = existsSync(resolve(ROOT, "packages/catalog/generated/icons/item/carbon-fiber.png"));

function mode(page: Page, name: "Circuit" | "Source" | "Split") {
  return page.getByRole("navigation", { name: "Workbench mode" }).getByRole("button", { name, exact: true });
}

/** Shows canvas and source side by side, with the whole circuit in view of the now narrower canvas. */
async function showSplit(page: Page): Promise<void> {
  await mode(page, "Split").click();
  await expect(page.locator(".source-pane .cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
}

/** Puts the caret at the end of the editor line that contains `text`. */
async function caretAtEndOf(page: Page, text: string): Promise<void> {
  await page.locator(".source-pane .cm-line", { hasText: text }).click();
  await page.keyboard.press("End");
}

async function dragCard(page: Page, name: string, dx: number, dy: number): Promise<void> {
  const { zoom } = await canvasView(page);
  const start = await cardGrabPoint(page, name);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx * zoom, start.y + dy * zoom, { steps: 4 });
  await page.mouse.up();
}

test("typing in Source updates the canvas", async ({ page }) => {
  await mode(page, "Split").click();
  await expect(page.locator("g.card")).toHaveCount(4);
  // The editor highlights the language: keywords, signals and the two wire colors have their own classes.
  await expect(page.locator(".source-pane .face-tok-keyword").first()).toHaveText("circuit");
  await expect(page.locator(".source-pane .face-tok-signal").first()).toHaveText("virtual:signal-A");
  await expect(page.locator(".source-pane .face-tok-color-red").first()).toHaveText("red");
  await expect(page.locator(".source-pane .face-tok-comment").first()).toContainText("A counter that lights a lamp.");

  // A new entity and a wire to it, typed by hand.
  await caretAtEndOf(page, "wire green twice.out <-> light.in");
  await page.keyboard.press("Enter");
  await page.keyboard.type("lamp second at (560, 240) { when virtual:signal-A > 5 }");
  await expect(card(page, "second")).toHaveAttribute("data-kind", "lamp");
  await expect(card(page, "second").locator(".card-summary")).toHaveText("A > 5");
  expect((await committedPositions(page)).second).toEqual({ x: 560, y: 240 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("wire red gate.out <-> second.in");
  await expect(page.locator("g.wire")).toHaveCount(5);

  // Editing a number moves a card and changes a summary as it is typed.
  await caretAtEndOf(page, "virtual:signal-A = 1");
  await page.keyboard.type("5");
  await expect(card(page, "source").locator(".card-summary")).toHaveText("A = 15");
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");

  // Completion offers what the grammar expects: here the terminals of the entities.
  await caretAtEndOf(page, "wire red gate.out <-> second.in");
  await page.keyboard.press("Enter");
  await page.keyboard.type("wire green sec");
  const completions = page.locator(".cm-tooltip-autocomplete");
  await expect(completions).toContainText("second.in");
  // CodeMirror ignores Enter for the first 75 ms a completion list is shown (`interactionDelay`), so that typing ahead does not
  // accept by accident; the key would then be a line break. The page shows nothing when that time is over.
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await expect(page.locator(".source-pane .cm-line", { hasText: "wire green second.in" })).toHaveCount(1);
});

test("a canvas edit patches the source while a nearby comment survives", async ({ page }) => {
  const original = await sourceText(page);
  expect(original).toContain("wire green gate.out <-> gate.in      // feedback");

  await dragCard(page, "gate", 40, 60);
  expect((await committedPositions(page)).gate).toEqual({ x: 340, y: 140 });
  // Exactly the two numbers changed; the header comment, the trailing comment and all spacing are as they were.
  expect(await sourceText(page)).toBe(original.replace("decider gate at (300, 80) {", "decider gate at (340, 140) {"));

  // Renaming rewrites the declaration and the three references on the commented line and its neighbours.
  await selectEntity(page, "gate");
  const name = page.getByLabel("Entity name");
  await name.fill("counter");
  await name.press("Enter");
  const renamed = await sourceText(page);
  expect(renamed).toContain("wire green counter.out <-> counter.in      // feedback");
  expect(renamed).toBe(original.replace("decider gate at (300, 80) {", "decider gate at (340, 140) {").replaceAll("gate", "counter"));

  // Removing the commented wire takes its trailing comment with it and nothing else.
  await page.getByRole("button", { name: "Remove green wire from out to counter.in" }).click();
  const removed = await sourceText(page);
  expect(removed).not.toContain("feedback");
  expect(removed).toContain("// A counter that lights a lamp.");
  expect(removed).toContain("    wire red source.out <-> counter.in\n    wire red counter.out <-> twice.in\n");
  await mode(page, "Split").click();
  await expect(page.locator(".source-pane .cm-line", { hasText: "decider counter at (340, 140) {" })).toHaveCount(1);
});

test("canvas and text share one undo history", async ({ page }) => {
  const original = await sourceText(page);
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  await showSplit(page);

  // 1: canvas drag. 2: typed comment. 3: inspector edit. 4: typed number.
  await dragCard(page, "source", 0, 100);
  const afterDrag = await sourceText(page);
  await caretAtEndOf(page, "lamp light at (560, 80) {");
  await page.keyboard.type(" // typed");
  const afterComment = await sourceText(page);
  expect(afterComment).toContain("lamp light at (560, 80) { // typed");
  await selectEntity(page, "light");
  await page.getByRole("complementary", { name: "Inspector" }).getByLabel("Controlled by the circuit network").uncheck();
  await expect(card(page, "light").locator(".card-summary")).toHaveText("no condition");
  const afterInspector = await sourceText(page);
  expect(afterInspector).not.toContain("when virtual:signal-B > 8");
  expect(afterInspector).toContain("{ // typed");
  await caretAtEndOf(page, "when virtual:signal-A < 10");
  await page.keyboard.type("0");
  await expect(card(page, "gate").locator(".card-summary")).toHaveText("A < 100 → A");

  // Undo from the keyboard inside the editor and from the toolbar walk the same stack.
  await page.keyboard.press("ControlOrMeta+z");
  expect(await sourceText(page)).toBe(afterInspector);
  await undo.click();
  expect(await sourceText(page)).toBe(afterComment);
  await expect(card(page, "light").locator(".card-summary")).toHaveText("B > 8");
  await page.locator("svg.canvas-svg").focus();
  await page.keyboard.press("ControlOrMeta+z");
  expect(await sourceText(page)).toBe(afterDrag);
  await undo.click();
  expect(await sourceText(page)).toBe(original);
  expect((await committedPositions(page)).source).toEqual({ x: 40, y: 80 });
  await expect(undo).toBeDisabled();

  // And forward again, in Circuit mode, where the editor is hidden: the history does not live in the view.
  await mode(page, "Circuit").click();
  await redo.click();
  expect((await committedPositions(page)).source).toEqual({ x: 40, y: 180 });
  await redo.click();
  await redo.click();
  await redo.click();
  await expect(redo).toBeDisabled();
  await expect(card(page, "gate").locator(".card-summary")).toHaveText("A < 100 → A");
  await expect(card(page, "light").locator(".card-summary")).toHaveText("no condition");
  await mode(page, "Source").click();
  await expect(page.locator(".source-pane .cm-line", { hasText: "{ // typed" })).toHaveCount(1);
});

test("invalid source shows diagnostics and blocks canvas edits; fixing it recovers", async ({ page }) => {
  await page.getByRole("button", { name: "Step" }).click({ clickCount: 3 });
  await showSplit(page);
  await selectEntity(page, "twice");
  const before = await sourceText(page);

  await caretAtEndOf(page, "when virtual:signal-A < 10");
  await page.keyboard.type(" and");
  const broken = await sourceText(page);

  // Diagnostics: squiggle in the editor, the problems list, the status bar, the canvas banner and the dock.
  const problems = page.getByRole("region", { name: "Diagnostics" });
  await expect(problems.locator("li.severity-error")).toHaveCount(1);
  // The parser notices the missing operand at the next token, on the following line.
  await expect(problems.locator("li.severity-error")).toHaveText("Ln 9Expected a signal but found 'output'");
  await expect(page.getByTestId("diagnostics-summary")).toHaveText("1 error");
  await expect(page.locator(".source-pane .cm-lintRange-error")).not.toHaveCount(0);
  await expect(page.locator(".statusbar")).toContainText("1 error in source");
  await expect(page.locator(".invalid-banner")).toBeVisible();
  await expect(page.getByTestId("simulation-notice")).toHaveText("Paused: 1 error in the source");
  await expect(page.getByRole("button", { name: "Step" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await expect(page.getByTestId("tick-counter")).toHaveText("0003");

  // The last valid circuit stays on the canvas, and nothing graphical changes it or the text.
  await expect(page.locator("g.card")).toHaveCount(4);
  await expect(card(page, "gate").locator(".card-summary")).toHaveText("A < 10 → A");
  await dragCard(page, "twice", 60, 60);
  expect((await committedPositions(page)).twice).toEqual({ x: 300, y: 240 });
  await page.locator("svg.canvas-svg").focus();
  await page.keyboard.press("Delete");
  expect(await entityNames(page)).toEqual(["source", "gate", "twice", "light"]);
  await expect(page.locator('.palette-item[data-kind="lamp"]')).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Inspector" }).getByLabel("Entity name")).toBeDisabled();
  expect(await sourceText(page)).toBe(broken);

  // Clicking the problem puts the caret on it; completing the condition there makes everything work again.
  await problems.locator("li.severity-error button").click();
  await expect(page.locator(".source-pane .cm-content")).toBeFocused();
  await caretAtEndOf(page, "when virtual:signal-A < 10 and");
  await page.keyboard.type(" virtual:signal-A > 0");
  await expect(problems).toHaveCount(0);
  await expect(page.locator(".invalid-banner")).toHaveCount(0);
  await expect(page.locator(".source-pane .cm-lintRange-error")).toHaveCount(0);
  await expect(card(page, "gate").locator(".card-summary")).toHaveText("A < 10 +1 → A");
  // The new condition changes behaviour, so the simulation starts over; the canvas is editable again.
  await expect(page.getByTestId("tick-counter")).toHaveText("0000");
  await expect(page.getByRole("button", { name: "Step" })).toBeEnabled();
  await dragCard(page, "twice", 60, 60);
  expect((await committedPositions(page)).twice).toEqual({ x: 360, y: 300 });
  expect(await sourceText(page)).toBe(before.replace("when virtual:signal-A < 10", "when virtual:signal-A < 10 and virtual:signal-A > 0").replace("twice at (300, 240)", "twice at (360, 300)"));
});

/** Every card is 184 x 128 and its status rows stay clear of the pins on both edges, of the body above and of the lower edge. */
async function expectRowsInsideCards(page: Page, cards: number): Promise<void> {
  const extents = await page.locator("g.card").evaluateAll((elements) =>
    elements.map((element) => {
      const body = (element.querySelector(".card-body") as SVGGraphicsElement).getBBox();
      const boxes = [...element.querySelectorAll<SVGGraphicsElement>("g.card-row")].map((group) => {
        const box = group.getBBox();
        // A row is positioned by a translation; its box is in its own coordinates.
        const dy = group.transform.baseVal.consolidate()?.matrix.f ?? 0;
        return { left: box.x, right: box.x + box.width, top: box.y + dy, bottom: box.y + box.height + dy };
      });
      return { name: element.getAttribute("data-entity-name"), width: body.width, height: body.height, rows: boxes.length, left: Math.min(...boxes.map((box) => box.left)), right: Math.max(...boxes.map((box) => box.right)), top: Math.min(...boxes.map((box) => box.top)), bottom: Math.max(...boxes.map((box) => box.bottom)) };
    }),
  );
  expect(extents).toHaveLength(cards);
  for (const extent of extents) {
    expect(extent, extent.name ?? "").toMatchObject({ width: 184, height: 128 });
    expect(extent.rows, extent.name ?? "").toBeGreaterThan(0);
    expect(extent.left, extent.name ?? "").toBeGreaterThanOrEqual(13);
    expect(extent.right, extent.name ?? "").toBeLessThanOrEqual(171);
    expect(extent.top, extent.name ?? "").toBeGreaterThan(73);
    expect(extent.bottom, extent.name ?? "").toBeLessThan(124);
  }
}

test("stepping the example circuit shows the expected values tick by tick in dock and cards", async ({ page }) => {
  const step = page.getByRole("button", { name: "Step" });
  const counter = page.getByTestId("tick-counter");
  const status = (name: string) => card(page, name);
  const traceValue = (label: string) => page.locator(`.traces tr[data-trace="${label}"] .trace-value`);
  const document = await sourceText(page);
  /** A network carries what its emitter puts out; one that carries nothing reads `nothing`. */
  const carried = (output: string): string => (output === "no output" ? "nothing" : output);

  // Trace the three entities downstream of the constant.
  await selectEntity(page, "gate");
  for (const name of ["twice", "light"]) {
    const point = await cardGrabPoint(page, name);
    await page.keyboard.down("Shift");
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up("Shift");
  }
  await expect(page.locator(".traces tr")).toHaveCount(3);
  await expect(status("source")).toHaveAttribute("data-status", "A 1");
  await expect(status("gate")).toHaveAttribute("data-status", "no output");
  await expect(status("light")).toHaveAttribute("data-status", "off");
  // What a card reads per wire color: the constant has no input, the gate sees the constant on red and its own (still empty)
  // output on green, and an input without a wire of a color says so.
  await expect(status("source")).not.toHaveAttribute("data-in-red");
  await expect(status("gate")).toHaveAttribute("data-in-red", "A 1");
  await expect(status("gate")).toHaveAttribute("data-in-green", "nothing");
  await expect(status("twice")).toHaveAttribute("data-in-green", "no wire");

  // The gate adds the constant's 1 to its own output while the sum is below 10: 1, 2, ... 9. At 10 the condition fails,
  // the output clears for one tick and the count starts again. `twice` doubles it one tick later; the lamp needs B > 8.
  const expected = [
    { gate: "A 1", twice: "no output", light: "off" },
    { gate: "A 2", twice: "B 2", light: "off" },
    { gate: "A 3", twice: "B 4", light: "off" },
    { gate: "A 4", twice: "B 6", light: "off" },
    { gate: "A 5", twice: "B 8", light: "off" },
    { gate: "A 6", twice: "B 10", light: "lit" },
    { gate: "A 7", twice: "B 12", light: "lit" },
    { gate: "A 8", twice: "B 14", light: "lit" },
    { gate: "A 9", twice: "B 16", light: "lit" },
    { gate: "no output", twice: "B 18", light: "lit" },
    { gate: "A 1", twice: "no output", light: "off" },
    { gate: "A 2", twice: "B 2", light: "off" },
  ];
  for (const [index, values] of expected.entries()) {
    await step.click();
    await expect(counter).toHaveText(String(index + 1).padStart(4, "0"));
    for (const [name, value] of Object.entries(values)) await expect(status(name), `${name} at tick ${index + 1}`).toHaveAttribute("data-status", value);
    // Inputs per color: red of the gate is the constant, green its own output; `twice` reads the gate on red and the lamp
    // reads `twice` on green. The other color of both has no wire.
    const inputs = { gate: ["A 1", carried(values.gate)], twice: [carried(values.gate), "no wire"], light: ["no wire", carried(values.twice)] };
    for (const [name, [red, green]] of Object.entries(inputs)) {
      await expect(status(name), `${name} red at tick ${index + 1}`).toHaveAttribute("data-in-red", red!);
      await expect(status(name), `${name} green at tick ${index + 1}`).toHaveAttribute("data-in-green", green!);
    }
    // The dock shows the same numbers.
    if (values.gate !== "no output") await expect(traceValue("gate A")).toHaveText(values.gate.slice(2));
    if (index >= 1 && values.twice !== "no output") await expect(traceValue("twice B")).toHaveText(values.twice.slice(2));
    await expect(traceValue("light light")).toHaveText(values.light);
    await expect(card(page, "light")).toHaveClass(values.light === "lit" ? /active/ : /^(?!.*active)/);
  }
  // The feedback never lets the count reach 10, and the lamp was lit exactly while B exceeded 8.
  await expect(page.locator('.traces tr[data-trace="gate A"]')).toHaveAttribute("title", /Input red: A 1\nInput green: A 2\nInput sum: A 3/);
  if (HAS_CATALOG_ICONS) await expect(page.locator('.traces tr[data-trace="gate A"] img.trace-icon')).toHaveAttribute("src", /icons\/virtual\/signal-A\.png$/);


  // The rows of the cards at tick 12: red in, green in and out on a combinator, the output alone on the constant, the two
  // inputs and the light on the lamp. A signal is its icon and its value, or its short name and value without the artwork.
  const rows = (name: string) => card(page, name).locator("g.card-row");
  const row = (name: string, kind: string) => card(page, name).locator(`g.card-row[data-row="${kind}"]`);
  const shown = (value: number) => (HAS_CATALOG_ICONS ? String(value) : `A ${value}`);
  await expect.poll(() => rows("gate").evaluateAll((all) => all.map((element) => element.getAttribute("data-row")))).toEqual(["red", "green", "out"]);
  await expect.poll(() => rows("source").evaluateAll((all) => all.map((element) => element.getAttribute("data-row")))).toEqual(["out"]);
  await expect.poll(() => rows("light").evaluateAll((all) => all.map((element) => element.getAttribute("data-row")))).toEqual(["red", "green", "lamp"]);
  await expect(row("gate", "red").locator("text")).toHaveText([shown(1)]);
  await expect(row("gate", "green").locator("text")).toHaveText([shown(2)]);
  await expect(row("gate", "out").locator("text")).toHaveText([shown(2)]);
  await expect(row("source", "out").locator("text")).toHaveText([shown(1)]);
  await expect(row("gate", "red").locator("image")).toHaveCount(HAS_CATALOG_ICONS ? 1 : 0);
  if (HAS_CATALOG_ICONS) await expect(row("gate", "red").locator("image")).toHaveAttribute("href", /icons\/virtual\/signal-A\.png$/);
  // A color without a wire is marked and shows a dash, like a network that carries nothing.
  await expect(row("twice", "green")).toHaveClass(/unwired/);
  await expect(row("twice", "green").locator("text")).toHaveText(["–"]);
  await expect(row("twice", "red")).not.toHaveClass(/unwired/);
  await expect(row("light", "red")).toHaveClass(/unwired/);
  await expect(row("light", "lamp").locator("text")).toHaveText(["off"]);
  await expect(card(page, "gate").locator(":scope > title")).toHaveText("Decider gate: A < 10 → A\nRed in: A 1\nGreen in: A 2\nOut: A 2");
  await expect(card(page, "light").locator(":scope > title")).toHaveText("Lamp light: B > 8\nRed in: no wire\nGreen in: B 2\nLight: off");
  await expect(card(page, "source").locator(":scope > title")).toHaveText("Constant source: A = 1\nOut: A 1");
  // The card keeps its size, and no row reaches the pins on either edge or the lower edge.
  await expectRowsInsideCards(page, 4);

  // None of this touched the document.
  expect(await sourceText(page)).toBe(document);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByTestId("save-state")).toHaveText("No changes");

  // A move keeps the tick, a changed constant resets it.
  await dragCard(page, "light", 0, 60);
  await expect(counter).toHaveText("0012");
  await selectEntity(page, "source");
  await page.getByRole("complementary", { name: "Inspector" }).getByLabel("Count", { exact: true }).fill("2");
  await expect(counter).toHaveText("0000");
  await step.click();
  await expect(status("gate")).toHaveAttribute("data-status", "A 2");
});

const ROWS_SOURCE = `circuit "Rows" {
    constant many at (40, 40) {
        virtual:signal-A = -2147483648
        virtual:signal-B = 2500000
        virtual:signal-C = 12345
        virtual:signal-D = 9999
        virtual:signal-E = 1
        virtual:signal-F = 2
        virtual:signal-G = 3
        virtual:signal-H = 4
        virtual:signal-I = 5
        virtual:signal-J = 6
        virtual:signal-K = 7
        virtual:signal-L = 8
    }

    decider all at (300, 40) {
        when anything != 0
        output everything = input
    }

    lamp glow at (560, 40) {
        when virtual:signal-E > 0
        color = #ff8000
    }

    wire red many.out <-> all.in
    wire green all.out <-> glow.in
}
`;

test("a card row shows the signals that fit, abbreviates large values and counts the rest", async ({ page }) => {
  const row = (name: string, kind: string) => card(page, name).locator(`g.card-row[data-row="${kind}"]`);
  const exact = "A -2147483648, B 2500000, C 12345, D 9999, E 1, F 2, G 3, H 4, I 5, J 6, K 7, L 8";
  await openProject(page, await writeProject({ name: "Rows", source: ROWS_SOURCE }));
  await expect(page.locator("g.card")).toHaveCount(3);
  await page.getByRole("button", { name: "Step" }).click();
  await expect(page.getByTestId("tick-counter")).toHaveText("0001");

  // Twelve signals on the red input: three fit with the marker for the other nine. Values of more than four digits are
  // abbreviated on the card; the attribute and the tooltip have them exactly.
  await expect(card(page, "all")).toHaveAttribute("data-in-red", exact);
  await expect(card(page, "all")).toHaveAttribute("data-in-green", "no wire");
  await expect(card(page, "all")).toHaveAttribute("data-status", "A -2147483648, B 2500000 +10");
  const shown = HAS_CATALOG_ICONS ? ["-2.1G", "2.5M", "12k", "+9"] : ["A -2.1G", "B 2.5M", "C 12k", "+9"];
  await expect(row("all", "red").locator("text")).toHaveText(shown);
  await expect(row("all", "out").locator("text")).toHaveText(shown);
  await expect(row("all", "red").locator("text").last()).toHaveClass("row-more");
  await expect(row("all", "green").locator("text")).toHaveText(["–"]);
  await expect(card(page, "all").locator(":scope > title")).toHaveText(`Decider all: anything ≠ 0 → everything\nRed in: ${exact}\nGreen in: no wire\nOut: ${exact}`);

  // The constant has the three rows for its output: more signals than one row holds, none of them lost.
  await expect(card(page, "many").locator("g.card-row")).toHaveCount(1);
  await expect(card(page, "many")).not.toHaveAttribute("data-in-red");
  await expect
    .poll(async () => {
      const texts = await row("many", "out").locator("text").allTextContents();
      const values = texts.filter((text) => !text.startsWith("+"));
      return { first: values[0], accounted: values.length + texts.filter((text) => text.startsWith("+")).reduce((sum, text) => sum + Number(text.slice(1)), 0), more: values.length > shown.length - 1 };
    })
    .toEqual({ first: shown[0], accounted: 12, more: true });
  const lines = await row("many", "out").locator("text").evaluateAll((texts) => new Set(texts.map((text) => text.getAttribute("y"))).size);
  expect(lines).toBeGreaterThan(1);

  // The lamp is lit in its color: the state row has the swatch, the card is highlighted.
  await expect(card(page, "glow")).toHaveAttribute("data-status", "lit #ff8000");
  await expect(card(page, "glow")).toHaveAttribute("data-in-green", exact);
  await expect(card(page, "glow")).toHaveClass(/active/);
  await expect(row("glow", "lamp").locator("text")).toHaveText(["lit"]);
  await expect(row("glow", "lamp").locator("rect.row-swatch")).toHaveCSS("fill", "rgb(255, 128, 0)");
  await expect(row("glow", "red")).toHaveClass(/unwired/);
  await expect(page.locator("rect.row-swatch")).toHaveCount(1);
  await expectRowsInsideCards(page, 3);
});

test("Run and Pause advance and hold the ticks", async ({ page }) => {
  const counter = page.getByTestId("tick-counter");
  const tick = async (): Promise<number> => Number(await counter.textContent());
  await page.getByLabel("SPEED").selectOption("30");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".live-indicator")).toHaveText("RUNNING");
  await expect(page.getByRole("button", { name: "Step" })).toBeDisabled();
  await expect.poll(tick).toBeGreaterThan(15);
  // While it runs the cards follow: the gate cycles through its count.
  await expect.poll(async () => card(page, "gate").getAttribute("data-status")).toMatch(/^A [1-9]$/);

  // A layout edit does not disturb a running simulation.
  await dragCard(page, "source", 0, 40);
  await expect(page.locator(".live-indicator")).toHaveText("RUNNING");
  const afterDrag = await tick();
  expect(afterDrag).toBeGreaterThan(15);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator(".live-indicator")).toHaveText("PAUSED");
  const paused = await tick();
  await page.waitForTimeout(300);
  expect(await tick()).toBe(paused);
  expect(paused).toBeGreaterThanOrEqual(afterDrag);
  await page.getByRole("button", { name: "Step" }).click();
  await expect(counter).toHaveText(String(paused + 1).padStart(4, "0"));

  // Slower speed: about one tick per second.
  await page.getByLabel("SPEED").selectOption("1");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause" }).click();
  expect((await tick()) - paused - 1).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "Reset simulation" }).click();
  await expect(counter).toHaveText("0000");
});

test("the signal picker selects a Space Age signal with its icon, and the module setting flags and clears it", async ({ page }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await selectEntity(page, "source");
  const field = inspector.getByLabel("Signal 1", { exact: true });
  await expect(field).toHaveValue("virtual:signal-A");

  await inspector.getByRole("button", { name: "Choose signal 1" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a signal" });
  await expect(picker).toBeVisible();
  // Organised like the game: one tab per group in game order, the current signal's group is open.
  await expect(picker.getByRole("tab")).toHaveCount(10);
  expect(await picker.getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label")))).toEqual(["Logistics", "Production", "Intermediate products", "Space", "Combat", "Fluids", "Signals", "Enemies", "Environment", "Unsorted"]);
  await expect(picker.getByRole("tab", { name: "Signals" })).toHaveAttribute("aria-selected", "true");
  await expect(picker.locator('[data-signal="virtual:signal-A"]')).toHaveClass(/current/);
  // A constant combinator takes no wildcards, so the picker offers none here.
  await expect(picker.locator('[data-signal="virtual:signal-each"], [data-signal="virtual:signal-anything"], [data-signal="virtual:signal-everything"]')).toHaveCount(0);
  // Quality can be chosen because the quality module is enabled.
  await expect(picker.getByRole("radio")).toHaveCount(5);

  // Search matches the display name ("Carbon fiber") and the prototype name ("carbon-fiber").
  await picker.getByLabel("Search signals").fill("carbon fib");
  const entry = picker.locator('[data-signal="item:carbon-fiber"]');
  await expect(entry).toHaveAttribute("aria-label", "Carbon fiber");
  await picker.getByLabel("Search signals").fill("carbon-fib");
  await expect(picker.locator(".picker-signal")).toHaveCount(1);
  if (HAS_CATALOG_ICONS) {
    const icon = entry.locator("img");
    await expect(icon).toHaveAttribute("src", "face-asset://catalog/icons/item/carbon-fiber.png");
    await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(64);
  }
  await picker.getByRole("radio", { name: "Rare" }).click();
  await entry.click();
  await expect(picker).toHaveCount(0);

  // Written to the source as one statement, shown with name and icon in the inspector and on the card.
  await expect(field).toHaveValue("item:carbon-fiber@rare");
  expect(await sourceText(page)).toContain("        item:carbon-fiber@rare = 1\n");
  expect(await sourceText(page)).not.toContain("virtual:signal-A = 1");
  await expect(card(page, "source").locator(".card-summary")).toHaveText(/^carbon-fiber/);
  await expect(card(page, "source")).toHaveAttribute("data-status", "carbon-fiber@rare 1");
  await expect(field).toHaveAttribute("title", "Carbon fiber (Rare)");
  if (HAS_CATALOG_ICONS) {
    await expect(inspector.locator(".signal-input img.signal-icon").first()).toHaveAttribute("src", "face-asset://catalog/icons/item/carbon-fiber.png");
    await expect(card(page, "source").locator('image[href$="icons/item/carbon-fiber.png"]')).toHaveCount(1);
  }
  await expect(page.locator(".statusbar")).not.toContainText("warning");

  // In a decider condition the picker does offer the wildcards.
  await selectEntity(page, "gate");
  await inspector.getByRole("button", { name: "Choose condition 1 signal" }).click();
  await expect(picker.locator('[data-signal="virtual:signal-each"], [data-signal="virtual:signal-anything"], [data-signal="virtual:signal-everything"]')).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  // Switching the Space Age group off keeps the text and marks the signal with a warning.
  const withSignal = await sourceText(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Project settings" });
  await expect(settings.locator(".module-list li")).toHaveCount(5);
  await expect(settings.getByRole("checkbox", { name: /Base Mod/ })).toBeDisabled();
  await settings.getByRole("checkbox", { name: /Space Age/ }).uncheck();
  // Dependencies are spelled out: with Space Age off, Recycler is now only needed by Quality.
  await expect(settings.locator('[data-module="recycler"] small')).toHaveText("Switching off also switches off Quality");
  await settings.getByRole("button", { name: "Close project settings" }).click();
  await expect(page.locator(".statusbar")).toContainText("1 warning");
  expect(await sourceText(page)).toBe(withSignal);
  await expect(page.locator("g.card")).toHaveCount(4);
  await selectEntity(page, "source");
  await expect(inspector.locator(".field-warning")).toHaveText("Belongs to a signal group that is switched off");
  await mode(page, "Split").click();
  const problems = page.getByRole("region", { name: "Diagnostics" });
  await expect(problems.locator('li[data-code="disabled-signal"]')).toContainText("carbon-fiber");
  await expect(page.locator(".source-pane .cm-lintRange-warning")).toHaveText("item:carbon-fiber@rare");
  // A warning does not block anything.
  await expect(page.locator(".invalid-banner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Step" })).toBeEnabled();

  // Switching Quality off as well flags the quality; Space Age brings both back and clears the warnings.
  await page.getByRole("button", { name: "Settings" }).click();
  await settings.getByRole("checkbox", { name: /Quality/ }).uncheck();
  await expect(problems.locator("li")).toHaveCount(1);
  await settings.getByRole("checkbox", { name: /Space Age/ }).check();
  await expect(settings.getByRole("checkbox", { name: /Quality/ })).toBeChecked();
  await expect(problems).toHaveCount(0);
  await expect(page.locator(".source-pane .cm-lintRange-warning")).toHaveCount(0);
  await expect(page.locator(".statusbar")).not.toContainText("warning");
  expect(await sourceText(page)).toBe(withSignal);
});

test("save, quit, relaunch and reopen restores source, layout and module settings", async () => {
  const projectPath = await newProjectPath("Round trip");
  const first = await launchApp();
  let savedSource: string;
  try {
    const { app, page } = first;
    await stubDialogs(app, { savePath: projectPath });
    await dragCard(page, "light", 40, 160);
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Project settings" });
    await settings.getByLabel("Project name").fill("Round trip");
    await settings.getByLabel("Project name").press("Enter");
    await settings.getByRole("checkbox", { name: /Recycler/ }).uncheck();
    await settings.getByRole("button", { name: "Close project settings" }).click();
    await expect(page.getByTestId("project-name")).toHaveText("Round trip");
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");

    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    savedSource = await sourceText(page);
    const saved = await readProjectEntries(projectPath);
    expect(saved["main.face"]).toBe(savedSource);
    const expectedManifest = { formatVersion: 1, name: "Round trip", gameVersion: "2.1.24", modules: ["base", "elevated-rails"], customSignalGroups: [], circuits: ["main.face"] };
    expect(JSON.parse(saved["face.json"]!)).toEqual(expectedManifest);

    // A settings change alone makes the project dirty again, and saving writes it.
    await page.getByRole("button", { name: "Settings" }).click();
    await settings.getByRole("checkbox", { name: /Recycler/ }).check();
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    expect(JSON.parse((await readProjectEntries(projectPath))["face.json"]!).modules).toEqual(["base", "elevated-rails", "recycler"]);
  } finally {
    await closeApp(first.app);
  }

  // Something this version does not know about is added to the manifest by hand, as a newer version would: the project file
  // is unpacked, changed and packed again with an ordinary zip tool.
  const unpacked = await readProjectEntries(projectPath);
  const manifest = JSON.parse(unpacked["face.json"]!);
  const customSignalGroups = [{ id: "g1", name: "Mine", enabled: true, signals: [{ name: "alpha", icon: "alpha.png" }] }];
  const changed = { ...manifest, viewState: { zoom: 1.25, pinned: ["gate"] }, customSignalGroups };
  await writeProjectEntries(projectPath, { ...unpacked, "face.json": JSON.stringify(changed, null, 2) });

  const second = await launchApp({ userData: first.userData });
  try {
    const { app, page } = second;
    await expect(page.getByTestId("project-name")).toHaveText("Feedback example");
    await clickMenu(app, "File", "Open Recent", "Round trip");
    await expect(page.locator(".project-meta .path")).toHaveText(projectPath);
    await expect(page.getByTestId("project-name")).toHaveText("Round trip");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");

    // Source and layout.
    expect(await sourceText(page)).toBe(savedSource);
    expect(await committedPositions(page)).toEqual({ source: { x: 40, y: 80 }, gate: { x: 300, y: 80 }, twice: { x: 300, y: 240 }, light: { x: 600, y: 240 } });
    await expect(page.locator("g.card")).toHaveCount(4);
    await expect(card(page, "light")).toHaveAttribute("data-x", "600");
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    // Module settings.
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Project settings" });
    for (const [title, enabled] of [["Base Mod", true], ["Elevated Rails", true], ["Recycler", true], ["Quality", false], ["Space Age", false]] as const) {
      const checkbox = settings.getByRole("checkbox", { name: new RegExp(title) });
      await (enabled ? expect(checkbox).toBeChecked() : expect(checkbox).not.toBeChecked());
    }
    // Another change and save: the unknown field and the custom signal group are still in the file.
    await settings.getByRole("checkbox", { name: /Quality/ }).check();
    await settings.getByRole("button", { name: "Close project settings" }).click();
    await clickMenu(app, "File", "Save");
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
    const resaved = await readProjectEntries(projectPath);
    expect(JSON.parse(resaved["face.json"]!)).toEqual({
      formatVersion: 1,
      name: "Round trip",
      gameVersion: "2.1.24",
      modules: ["base", "elevated-rails", "recycler", "quality"],
      customSignalGroups: [{ id: "g1", name: "Mine", enabled: true, signals: [{ name: "alpha", icon: "alpha.png" }] }],
      circuits: ["main.face"],
      viewState: { zoom: 1.25, pinned: ["gate"] },
    });
    expect(resaved["main.face"]).toBe(savedSource);
  } finally {
    await closeApp(second.app);
  }
});
