// Inspector: primary actions at the top, controlled settings forms for every kind.
import { card, cardGrabPoint, entityNames, expect, test } from "./app.ts";

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
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".source-pane .cm-content")).toContainText("wire red gate.out <-> doubler.in");
  await page.getByRole("button", { name: "Circuit", exact: true }).click();

  // A duplicate name is refused in place.
  await name.fill("gate");
  await expect(inspector.getByRole("alert")).toContainText("already used");
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

  // Every change above is its own undo step, and none of them moved anything.
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".source-pane .cm-content")).toContainText("virtual:signal-B = virtual:signal-A[red] + 7");
  await expect(page.locator(".source-pane .cm-content")).toContainText("always-on = true");
});
