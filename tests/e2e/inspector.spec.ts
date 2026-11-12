// Inspector: primary actions at the top, controlled settings forms for every kind.
import type { Locator } from "@playwright/test";
import { card, cardGrabPoint, CARET, clickMenu, entityNames, expect, selectEntity, sourceText, test } from "./app.ts";
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

test("network toggles are grayed without a wire of their color on the input, and both can be off", async ({ page }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const toggle = (group: string, color: "red" | "green") => inspector.getByRole("button", { name: `${group}: ${color} network`, exact: true });
  const expectToggle = async (button: Locator, state: { pressed: boolean; wired: boolean }, color: "red" | "green") => {
    await expect(button).toHaveAttribute("aria-pressed", String(state.pressed));
    await expect(button).toHaveAttribute("title", state.wired ? `Read the ${color} network` : `No ${color} wire connected to the input`);
    if (state.wired) await expect(button).not.toHaveClass(/unwired/);
    else await expect(button).toHaveClass(/unwired/);
    // Grayed is a look, not a state: the button stays enabled.
    await expect(button).toBeEnabled();
  };

  // The arithmetic combinator has one red wire on its input and reads its first operand from red.
  await selectEntity(page, "twice");
  const red = toggle("First operand networks", "red");
  const green = toggle("First operand networks", "green");
  await expectToggle(red, { pressed: true, wired: true }, "red");
  await expectToggle(green, { pressed: false, wired: false }, "green");
  const look = (button: Locator) => button.evaluate((element) => [getComputedStyle(element).borderTopStyle, getComputedStyle(element).color, getComputedStyle(element).backgroundColor].join(" "));
  const wiredLook = await look(red);
  const grayedLook = await look(green);
  expect(wiredLook).toMatch(/^solid /);
  expect(grayedLook).toMatch(/^dashed /);

  // A grayed toggle works, and its pressed state is still told apart.
  await green.click();
  await expectToggle(green, { pressed: true, wired: false }, "green");
  await page.mouse.move(10, 10);
  // Buttons animate their colors, so the pressed look is reached a moment after the click.
  await expect.poll(() => look(green)).toMatch(/^dashed /);
  await expect.poll(() => look(green)).not.toBe(grayedLook);
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE.replace("virtual:signal-A[red] * 2", "virtual:signal-A * 2"));

  // Both off, as the game allows: the operand is read from no network.
  await red.click();
  await green.click();
  await expectToggle(red, { pressed: false, wired: true }, "red");
  await expectToggle(green, { pressed: false, wired: false }, "green");
  const none = FIVE_KINDS_SOURCE.replace("virtual:signal-A[red] * 2", "virtual:signal-A[none] * 2");
  expect(await sourceText(page)).toBe(none);
  await expect(inspector.locator(".draft-hint")).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveCount(0);

  // Without its last input wire the red toggle is grayed as well.
  await inspector.getByRole("button", { name: "Remove red wire from in to gate.out" }).click();
  await expectToggle(red, { pressed: false, wired: false }, "red");
  await page.getByRole("button", { name: "Undo" }).click();
  await expectToggle(red, { pressed: false, wired: true }, "red");

  // The decider has both colors on its input (the feedback wires count), in the condition and in the output.
  await selectEntity(page, "gate");
  for (const group of ["Signal networks", "Input networks"]) for (const color of ["red", "green"] as const) await expectToggle(toggle(group, color), { pressed: true, wired: true }, color);
  await toggle("Input networks", "red").click();
  await toggle("Input networks", "green").click();
  expect(await sourceText(page)).toBe(none.replace("output virtual:signal-A = input", "output virtual:signal-A = input[none]"));

  // The lamp has only a green wire.
  await selectEntity(page, "light");
  await expectToggle(toggle("Input networks", "red"), { pressed: true, wired: false }, "red");
  await expectToggle(toggle("Input networks", "green"), { pressed: true, wired: true }, "green");
  await toggle("Input networks", "red").click();
  await toggle("Input networks", "green").click();
  await expectToggle(toggle("Input networks", "red"), { pressed: false, wired: false }, "red");
  await expectToggle(toggle("Input networks", "green"), { pressed: false, wired: true }, "green");
  const source = await sourceText(page);
  expect(source).toContain("        when virtual:signal-B > 8\n        networks = none\n    }");

  // The text form is the same state: typing a color back in presses its toggle.
  await page.evaluate((text) => window.faceSession!.commands.setSource(text), source.replace("networks = none", "networks = green"));
  await expectToggle(toggle("Input networks", "green"), { pressed: true, wired: true }, "green");
  await expectToggle(toggle("Input networks", "red"), { pressed: false, wired: false }, "red");
});

/**
 * Undo and redo as the user gets them. On macOS Cmd+Z in a text field reaches only the menu, which sends the command to the
 * window: that is what clicking the menu item does here. On the other platforms the browser applies its own undo on Ctrl+Z,
 * which the test driver does on every platform; that request is taken over by the workbench (`UNDO_KEY`).
 */
const UNDO_KEY = "ControlOrMeta+z";

test("undo and redo from an inspector field go through the document history", async ({ page, app }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  const edited = FIVE_KINDS_SOURCE.replace("when virtual:signal-A < 10", "when virtual:signal-A < 25");
  const expectState = async (field: Locator, value: string, source: string, history: { undo: boolean; redo: boolean }) => {
    await expect(field).toHaveValue(value);
    expect(await sourceText(page)).toBe(source);
    await expect(undo).toBeEnabled({ enabled: history.undo });
    await expect(redo).toBeEnabled({ enabled: history.redo });
    await expect(field).toBeFocused();
  };

  // The case from the native check: the number of a decider condition, committed with Return.
  await selectEntity(page, "gate");
  const number = inspector.getByLabel("Compare to", { exact: true });
  await number.click();
  await number.press("ControlOrMeta+a");
  await page.keyboard.type("25");
  await page.keyboard.press("Enter");
  await expectState(number, "25", edited, { undo: true, redo: false });

  // Undo takes the edit back in the document; the field shows the result, and nothing is left behind as an edit of its own.
  await clickMenu(app, "Edit", "Undo");
  await expectState(number, "10", FIVE_KINDS_SOURCE, { undo: false, redo: true });
  await clickMenu(app, "Edit", "Redo");
  await expectState(number, "25", edited, { undo: true, redo: false });
  await clickMenu(app, "Edit", "Undo");
  await clickMenu(app, "Edit", "Undo");
  await expectState(number, "10", FIVE_KINDS_SOURCE, { undo: false, redo: true });
  await clickMenu(app, "Edit", "Redo");

  // A signal field, edited key by key in one stay, is one step as well. The browser's own undo ends in the same history.
  const signal = inspector.getByLabel("Condition 1 signal", { exact: true });
  await signal.click();
  await page.keyboard.press(CARET.end);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("C");
  const both = edited.replace("when virtual:signal-A < 25", "when virtual:signal-C < 25");
  await expectState(signal, "virtual:signal-C", both, { undo: true, redo: false });
  await page.keyboard.press(UNDO_KEY);
  await expectState(signal, "virtual:signal-A", edited, { undo: true, redo: true });
  await clickMenu(app, "Edit", "Undo");
  await expectState(signal, "virtual:signal-A", FIVE_KINDS_SOURCE, { undo: false, redo: true });
  await expect(number).toHaveValue("10");
  await clickMenu(app, "Edit", "Redo");
  await clickMenu(app, "Edit", "Redo");
  await expectState(signal, "virtual:signal-C", both, { undo: true, redo: false });

  // Typing after an undo is a new step on top of what the undo left.
  await clickMenu(app, "Edit", "Undo");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("D");
  await expectState(signal, "virtual:signal-D", edited.replace("when virtual:signal-A < 25", "when virtual:signal-D < 25"), { undo: true, redo: false });
  await page.keyboard.press(UNDO_KEY);
  await expectState(signal, "virtual:signal-A", edited, { undo: true, redo: true });

  // Controls of the inspector that hold no text use the same history.
  const comparator = inspector.getByLabel("Comparator", { exact: true });
  await comparator.selectOption(">=");
  await comparator.focus();
  expect(await sourceText(page)).toBe(edited.replace("< 25", ">= 25"));
  await clickMenu(app, "Edit", "Undo");
  await expect(comparator).toHaveValue("<");
  expect(await sourceText(page)).toBe(edited);
  await clickMenu(app, "Edit", "Redo");
  await expect(comparator).toHaveValue(">=");
  await expect(comparator).toBeFocused();
});

test("undo from an inspector field first takes back text that is not written, and never costs the redo", async ({ page, app }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  const edited = FIVE_KINDS_SOURCE.replace("when virtual:signal-A < 10", "when virtual:signal-A < 25");
  await selectEntity(page, "gate");
  const number = inspector.getByLabel("Compare to", { exact: true });
  await number.click();
  await number.press("ControlOrMeta+a");
  await page.keyboard.type("25");

  // "25x" is not a number: it stays in the field and is not written.
  await page.keyboard.type("x");
  await expect(number).toHaveAttribute("aria-invalid", "true");
  expect(await sourceText(page)).toBe(edited);
  // The first undo takes back only that text, the second one the edit.
  await clickMenu(app, "Edit", "Undo");
  await expect(number).toHaveValue("25");
  await expect(number).toHaveAttribute("aria-invalid", "false");
  expect(await sourceText(page)).toBe(edited);
  await expect(redo).toBeDisabled();
  await clickMenu(app, "Edit", "Undo");
  await expect(number).toHaveValue("10");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);

  // Text that is not written is no edit: the redo stays, with the browser's own undo as well.
  await page.keyboard.press(CARET.end);
  await page.keyboard.type("x");
  await expect(number).toHaveValue("10x");
  await expect(redo).toBeEnabled();
  await page.keyboard.press(UNDO_KEY);
  await expect(number).toHaveValue("10");
  await expect(number).toBeFocused();
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  // Redo drops such text and shows what the history gives.
  await page.keyboard.type("y");
  await expect(number).toHaveValue("10y");
  await clickMenu(app, "Edit", "Redo");
  await expect(number).toHaveValue("25");
  await expect(number).toHaveAttribute("aria-invalid", "false");
  expect(await sourceText(page)).toBe(edited);

  // A name is written on Return; until then undo only restores the name.
  const name = inspector.getByLabel("Entity name");
  await name.fill("counter");
  await clickMenu(app, "Edit", "Undo");
  await expect(name).toHaveValue("gate");
  await expect(name).toBeFocused();
  expect(await sourceText(page)).toBe(edited);
  expect(await entityNames(page)).toContain("gate");

  // An edit the language cannot write yet is pending in the inspector; undo discards it and leaves the document alone.
  const signal = inspector.getByLabel("Condition 1 signal", { exact: true });
  const hint = inspector.locator(".draft-hint");
  await signal.fill("");
  await expect(hint).toBeVisible();
  await clickMenu(app, "Edit", "Undo");
  await expect(hint).toHaveCount(0);
  await expect(signal).toHaveValue("virtual:signal-A");
  expect(await sourceText(page)).toBe(edited);
  await clickMenu(app, "Edit", "Undo");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
  await expect(undo).toBeDisabled();
});

test("a character typed directly after an undo from the menu lands in what the undo left", async ({ page, app }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const edited = FIVE_KINDS_SOURCE.replace("when virtual:signal-A < 10", "when virtual:signal-A < 25");
  await selectEntity(page, "gate");
  const number = inspector.getByLabel("Compare to", { exact: true });
  // The next menu command is followed by a character at once, before the window gets to anything else (a later frame, a timer).
  const typeAfterNextCommand = (text: string) =>
    page.evaluate((character) => {
      const off = window.face!.onMenuCommand(() => {
        off();
        queueMicrotask(() => document.execCommand("insertText", false, character));
      });
    }, text);
  await number.click();
  await number.press("ControlOrMeta+a");
  await page.keyboard.type("25x");
  await expect(number).toHaveAttribute("aria-invalid", "true");

  // The undo takes back the unwritten "x"; the character belongs to the 25 that is left, and is not dropped with the x.
  await typeAfterNextCommand("7");
  await clickMenu(app, "Edit", "Undo");
  await expect(number).toHaveValue("257");
  await expect(number).toHaveAttribute("aria-invalid", "false");
  await expect.poll(() => sourceText(page)).toBe(edited.replace("< 25", "< 257"));
  await page.keyboard.press("Backspace");
  expect(await sourceText(page)).toBe(edited);

  // The same after an undo that is a step in the history.
  await typeAfterNextCommand("x");
  await clickMenu(app, "Edit", "Undo");
  await expect(number).toHaveValue("10x");
  await expect(number).toHaveAttribute("aria-invalid", "true");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
});

test("text fields outside the inspector have no undo of their own and leave the document alone", async ({ page, app }) => {
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const undo = page.getByRole("button", { name: "Undo" });
  await selectEntity(page, "source");
  const count = inspector.getByLabel("Count", { exact: true });
  await count.click();
  await count.press("ControlOrMeta+a");
  await page.keyboard.type("42");
  const edited = FIVE_KINDS_SOURCE.replace("virtual:signal-A = 1", "virtual:signal-A = 42");
  const expectUntouched = async () => {
    expect(await sourceText(page)).toBe(edited);
    await expect(count).toHaveValue("42");
    await expect(undo).toBeEnabled();
  };
  await expectUntouched();

  // The search box of the signal picker, which opens inside the inspector, filters a list and writes nothing. The browser's undo
  // stack spans every text field of the window; it is not applied, so it cannot reach back into the count typed before.
  await inspector.getByRole("button", { name: "Choose signal 1" }).click();
  const search = page.getByRole("dialog", { name: "Choose a signal" }).getByLabel("Search signals");
  await expect(search).toBeFocused();
  await page.keyboard.type("iron");
  for (let i = 0; i < 3; i++) await page.keyboard.press(UNDO_KEY);
  await expect(search).toHaveValue("iron");
  await expect(search).toBeFocused();
  await expectUntouched();
  await clickMenu(app, "Edit", "Undo");
  await expect(search).toHaveValue("iron");
  await expectUntouched();
  await page.keyboard.press("Escape");

  // The project name in the settings dialog is not part of the circuit source either; Escape restores it.
  await page.getByRole("button", { name: "Settings" }).click();
  const projectName = page.getByRole("dialog", { name: "Project settings" }).getByLabel("Project name");
  await projectName.click();
  await page.keyboard.press(CARET.end);
  await page.keyboard.type(" two");
  for (let i = 0; i < 3; i++) await page.keyboard.press(UNDO_KEY);
  await clickMenu(app, "Edit", "Undo");
  await expect(projectName).toHaveValue("Feedback example two");
  await expectUntouched();
  await page.keyboard.press("Escape");
  await expect(projectName).toHaveValue("Feedback example");

  // With the focus on a control that holds no text, undo is the document's again.
  await page.getByRole("dialog", { name: "Project settings" }).getByRole("button", { name: "Close project settings" }).click();
  await page.getByLabel("SPEED").focus();
  await clickMenu(app, "Edit", "Undo");
  expect(await sourceText(page)).toBe(FIVE_KINDS_SOURCE);
});
