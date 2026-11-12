// Inspector: primary actions at the top, controlled settings forms for every kind.
import type { Locator } from "@playwright/test";
import { card, cardGrabPoint, CARET, entityNames, expect, selectEntity, sourceText, test } from "./app.ts";
import { FIVE_KINDS_SOURCE, openFiveKinds } from "./fixtures.ts";

test.beforeEach(async ({ page }) => {
  await openFiveKinds(page);
});

test("the inspector offers rename and Delete at the top", async ({ page }) => {
  const twice = await cardGrabPoint(page, "twice");
  await page.mouse.click(twice.x, twice.y);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const remove = inspector.getByRole("button", { name: "Delete twice" });
  const name = inspector.getByLabel("Entity name");
  await expect(remove).toBeVisible();

  // Both primary actions sit above the settings form and are visible without scrolling.
  const settingsTop = (await inspector.locator(".inspector-settings").boundingBox())!.y;
  expect((await remove.boundingBox())!.y).toBeLessThan(settingsTop);
  expect((await name.boundingBox())!.y).toBeLessThan(settingsTop);
  expect(await inspector.evaluate((element) => element.scrollTop)).toBe(0);

  // Rename commits on Enter and rewrites the wire references in the source.
  await name.fill("doubler");
  await name.press("Enter");
  await expect(card(page, "doubler")).toHaveCount(1);
  await expect(card(page, "doubler")).toHaveClass(/selected/);
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE.replaceAll("twice", "doubler"));
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".source-pane .cm-content")).toContainText("wire red gate.out <-> doubler.in");
  await page.getByRole("button", { name: "Circuit", exact: true }).click();

  // A duplicate name and a reserved word are refused in place.
  await name.fill("gate");
  await expect(inspector.getByRole("alert")).toContainText("already used");
  await name.press("Enter");
  expect(await entityNames(page)).toContain("doubler");
  await name.fill("lamp");
  await expect(inspector.getByRole("alert")).toContainText("reserved");
  await name.press("Enter");
  expect(await entityNames(page)).toContain("doubler");
  await name.press("Escape");

  await inspector.getByRole("button", { name: "Delete doubler" }).click();
  expect(await entityNames(page)).toEqual(["source", "gate", "pick", "light"]);
  await expect(inspector).toContainText("Every signal starts somewhere.");
});

test("the inspector edits settings of each kind as controlled forms", async ({ page }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const select = async (name: string) => {
    const point = await cardGrabPoint(page, name);
    await page.mouse.click(point.x, point.y);
    await expect(inspector.getByLabel("Entity name")).toHaveValue(name);
  };
  const summary = (name: string) => card(page, name).locator(".card-summary");

  await select("source");
  await inspector.getByLabel("Count", { exact: true }).fill("42");
  await expect(summary("source")).toHaveText("A = 42");
  const signal = inspector.getByLabel("Signal 1", { exact: true });
  await signal.fill("not a signal");
  await expect(signal).toHaveAttribute("aria-invalid", "true");
  await expect(summary("source")).toHaveText("A = 42");
  await signal.fill("item:iron-plate@rare");
  await expect(signal).toHaveAttribute("aria-invalid", "false");
  await expect(summary("source")).toHaveText(/^iron-plate@rar/);

  await select("twice");
  await inspector.getByLabel("Operation", { exact: true }).selectOption("+");
  await inspector.getByLabel("Second operand", { exact: true }).fill("7");
  await expect(summary("twice")).toHaveText("A + 7 → B");

  await select("gate");
  await inspector.getByLabel("Comparator", { exact: true }).selectOption(">=");
  await inspector.getByRole("button", { name: "Add output", exact: true }).click();
  await expect(summary("gate")).toHaveText("A ≥ 10 → A +1");

  await select("pick");
  await inspector.getByLabel("Operation", { exact: true }).selectOption("count");
  await inspector.getByLabel("Output signal", { exact: true }).fill("virtual:signal-C");
  await expect(summary("pick")).toHaveText("count → C");

  await select("light");
  await inspector.getByLabel("Always on").check();
  await expect(summary("light")).toHaveText("always on");

  // Every change is a patch of the statements it concerns; nothing moved and nothing else was rewritten.
  const source = await sourceText(page);
  for (const statement of ["item:iron-plate@rare = 42", "virtual:signal-B = virtual:signal-A[red] + 7", "when virtual:signal-A >= 10", "operation = count", "output = virtual:signal-C", "always-on = true"]) expect(source).toContain(statement);
  expect(source).not.toContain("order = min");
  expect(source).toContain("lamp light at (560, 80) {");
  expect(source.slice(source.indexOf("    wire red source.out"))).toBe(FIVE_KINDS_SOURCE.slice(FIVE_KINDS_SOURCE.indexOf("    wire red source.out")));
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".source-pane .cm-content")).toContainText("virtual:signal-B = virtual:signal-A[red] + 7");

  // Undo walks back through the same history, one inspector change at a time.
  await page.getByRole("button", { name: "Circuit", exact: true }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(summary("light")).toHaveText("B > 8");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(summary("pick")).toHaveText("count → ?");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(summary("pick")).toHaveText("min #I");
});

test("typing a value in an inspector field is one undo step", async ({ page }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const point = await cardGrabPoint(page, "light");
  await page.mouse.click(point.x, point.y);
  const number = inspector.getByLabel("Number", { exact: true });
  await number.click();
  await number.press("ControlOrMeta+a");
  // Key by key: 1, 12, 123, 1234 are all written as they are typed.
  await page.keyboard.type("1234");
  await expect(card(page, "light").locator(".card-summary")).toHaveText("B > 1234");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE.replace("when virtual:signal-B > 8", "when virtual:signal-B > 1234"));
  await page.locator("svg.canvas-svg").focus();
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("editing in the middle of an inspector field keeps the caret where the user put it", async ({ page }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const summary = (name: string) => card(page, name).locator(".card-summary");
  const caretInside = async (field: Locator, fromEnd: number) => {
    await field.click();
    await page.keyboard.press(CARET.end);
    for (let i = 0; i < fromEnd; i++) await page.keyboard.press("ArrowLeft");
  };
  const expectText = async (field: Locator, text: string, caret: number) => {
    await expect(field).toHaveValue(text);
    await expect(field).toHaveJSProperty("selectionStart", caret);
    await expect(field).toHaveJSProperty("selectionEnd", caret);
  };

  // The name is a local draft until Enter.
  await selectEntity(page, "light");
  const name = inspector.getByLabel("Entity name");
  await caretInside(name, 3);
  await page.keyboard.type("xy");
  await expectText(name, "lixyght", 4);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await expectText(name, "lixht", 3);
  await page.keyboard.press("Escape");

  // A number is written to the source on every key; the form rendered from the new circuit leaves the caret alone.
  const number = inspector.getByLabel("Number", { exact: true });
  await caretInside(number, 1);
  await page.keyboard.type("12");
  await expect(summary("light")).toHaveText("B > 128");
  await expectText(number, "128", 2);
  await page.keyboard.press("Delete");
  await page.keyboard.type("3");
  await expect(summary("light")).toHaveText("B > 123");
  await expectText(number, "123", 3);
  await page.keyboard.press(CARET.start);
  await page.keyboard.type("4");
  await expect(summary("light")).toHaveText("B > 4123");
  await expectText(number, "4123", 1);

  // A signal passes through a text that is not a signal on the way.
  const signal = inspector.getByRole("textbox", { name: "Condition signal" });
  await caretInside(signal, 8);
  await page.keyboard.press("Backspace");
  await expect(signal).toHaveAttribute("aria-invalid", "true");
  await expectText(signal, "virtualsignal-B", 7);
  await page.keyboard.type(":");
  await expect(signal).toHaveAttribute("aria-invalid", "false");
  await expectText(signal, "virtual:signal-B", 8);

  // A plain text field has no draft of its own: every key goes through the source and comes back as the field's value.
  await selectEntity(page, "source");
  const group = inspector.getByLabel("Logistic group");
  await group.click();
  await page.keyboard.type("abcd");
  await caretInside(group, 2);
  await page.keyboard.type("xy");
  await expect.poll(() => sourceText(page)).toContain('"abxycd"');
  await expectText(group, "abxycd", 4);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await expect.poll(() => sourceText(page)).toContain('"abxd"');
  await expectText(group, "abxd", 3);
});

test("an incomplete inspector edit stays a draft with a hint and is written once it is complete", async ({ page }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const point = await cardGrabPoint(page, "gate");
  await page.mouse.click(point.x, point.y);
  const signal = inspector.getByLabel("Condition 1 signal", { exact: true });
  const hint = inspector.locator(".draft-hint");
  await expect(hint).toHaveCount(0);

  // Clearing the signal leaves a condition the language cannot write: nothing reaches the source.
  await signal.fill("");
  await expect(hint).toContainText("Not written to the source yet.");
  await expect(hint).toContainText("The condition needs a signal.");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(card(page, "gate").locator(".card-summary")).toHaveText("A < 10 → A");
  // The form keeps working on the draft.
  await inspector.getByLabel("Comparator", { exact: true }).selectOption(">");
  await expect(hint).toBeVisible();
  await expect(signal).toHaveValue("");

  await signal.fill("virtual:signal-B");
  await expect(hint).toHaveCount(0);
  await expect(card(page, "gate").locator(".card-summary")).toHaveText("B > 10 → A");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE.replace("when virtual:signal-A < 10", "when virtual:signal-B > 10"));

  // Discard drops a draft and shows the entity as the source has it.
  await signal.fill("");
  await expect(hint).toBeVisible();
  await hint.getByRole("button", { name: "Discard" }).click();
  await expect(hint).toHaveCount(0);
  await expect(signal).toHaveValue("virtual:signal-B");
});
