// Signals and entities the user hides, with the built-in data: every row of the project settings opens the dialog of its
// module, with a list of what is shown and one of what is hidden; the lists are worked with the mouse and with the keys; what
// is hidden is stored at once in the settings of the application, is offered by neither the signal picker nor the entity
// selector, leaves a project that uses it as it is, and holds after a restart and for a new project. The same with the mods
// of a game that was read is in gameData.spec.ts.
import type { Locator, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { card, clickMenu, closeApp, expect, launchApp, openProject, selectEntity, sourceText, test, writeProject } from "./app.ts";

type Side = "signals" | "entities";

const projectSettings = (page: Page): Locator => page.getByRole("dialog", { name: "Project settings" });
const moduleRow = (page: Page, module: string): Locator => projectSettings(page).locator(`.module-list li[data-module="${module}"]`);
const itemsButton = (page: Page, title: string): Locator => projectSettings(page).getByRole("button", { name: `Signals and entities of ${title}`, exact: true });
const itemsDialog = (page: Page, title: string): Locator => page.getByRole("dialog", { name: title, exact: true });
const list = (dialog: Locator, name: "Shown" | "Hidden", side: Side): Locator => dialog.getByRole("listbox", { name: `${name} ${side}`, exact: true });
const rows = (listbox: Locator): Locator => listbox.getByRole("option");
const row = (listbox: Locator, name: string): Locator => listbox.getByRole("option", { name, exact: true });
const selectedRows = (listbox: Locator): Locator => listbox.locator('[role="option"][aria-selected="true"]');
const sideButton = (dialog: Locator, side: Side): Locator => dialog.locator(`.side-switch button[data-side="${side}"]`);
const move = (dialog: Locator, name: "Hide" | "Show" | "Hide all" | "Show all" | "Close"): Locator => dialog.getByRole("button", { name, exact: true });
const filter = (dialog: Locator): Locator => dialog.getByLabel("Filter by name");
const badge = (dialog: Locator, name: "shown" | "hidden"): Locator => dialog.locator(`[data-list="${name}"] .count-badge`);
const emptyNote = (dialog: Locator, name: "shown" | "hidden"): Locator => dialog.locator(`[data-list="${name}"] [data-note="empty"]`);
const palette = (page: Page): Locator => page.getByRole("complementary", { name: "Components" });
const paletteEntry = (page: Page, prototype: string): Locator => palette(page).locator(`.palette-item[data-prototype="${prototype}"]`);
const inspector = (page: Page): Locator => page.getByRole("complementary", { name: "Inspector" });
const picker = (page: Page): Locator => page.getByRole("dialog", { name: "Choose a signal" });
const storedSettings = async (userData: string): Promise<unknown> => JSON.parse(await readFile(resolve(userData, "app-settings.json"), "utf8"));
const diagnostics = (page: Page): Promise<unknown[]> => page.evaluate(() => [...window.faceSession!.getState().diagnostics]);

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Project Settings", exact: true }).click();
  await expect(projectSettings(page)).toBeVisible();
}

const USES_HIDDEN = `circuit "Hidden" {
    wooden-chest box at (40, 80) {
    }

    constant-combinator source at (300, 80) {
        item:wooden-chest = 5
        virtual:signal-A = 1
    }
}
`;
const HIDDEN = { module: "base", signals: ["item:wooden-chest", "virtual:signal-A"], entities: ["wooden-chest"] };

test("every row of the project settings opens the dialog of its module, which lists its signals and entities and closes back to the settings", async ({ page }) => {
  await openSettings(page);
  await expect(projectSettings(page).locator('.module-list li [data-action="choose-items"]')).toHaveCount(5);
  for (const title of ["Base Mod", "Elevated Rails", "Recycler", "Quality", "Space Age"]) await expect(itemsButton(page, title)).toHaveCount(1);
  // Nothing is hidden: the rows count what the modules bring, as before.
  await expect(moduleRow(page, "space-age").locator(".module-count")).toHaveText("289 signals, 17 entities");

  // A module without entities: the dialog has its title, says what hiding does, and the side with nothing to list is disabled.
  await itemsButton(page, "Elevated Rails").click();
  const rails = itemsDialog(page, "Elevated Rails");
  await expect(rails).toBeVisible();
  await expect(projectSettings(page)).toHaveCount(1);
  await expect(rails.locator("p.muted-note:not([data-note])")).toHaveText("What you hide is not offered any more, in every project on this machine. A project that uses it keeps it, and anything new is shown.");
  await expect(filter(rails)).toBeFocused();
  await expect(sideButton(rails, "signals")).toHaveAttribute("aria-pressed", "true");
  await expect(sideButton(rails, "signals")).toHaveText("Signals5");
  await expect(sideButton(rails, "entities")).toBeDisabled();
  await expect(sideButton(rails, "entities")).toHaveText("Entities0");
  // The game's names in the game's order, with the internal name as the hover text.
  await expect(rows(list(rails, "Shown", "signals"))).toHaveText(["Rail ramp", "Rail support", "Elevated rail remnants", "Rail ramp remnants", "Rail support remnants"]);
  await expect(rows(list(rails, "Shown", "signals")).first()).toHaveAttribute("title", "item:rail-ramp");
  await expect(rows(list(rails, "Hidden", "signals"))).toHaveCount(0);
  await expect(emptyNote(rails, "hidden")).toHaveText("No signal is hidden.");
  await expect(emptyNote(rails, "shown")).toHaveCount(0);
  await expect(badge(rails, "shown")).toHaveText("5");
  await expect(badge(rails, "hidden")).toHaveText("0");
  // Without a selection the arrows do nothing; "Show all" has nothing to show.
  for (const name of ["Hide", "Show", "Show all"] as const) await expect(move(rails, name)).toBeDisabled();
  await expect(move(rails, "Hide all")).toBeEnabled();
  // The two lists have one size.
  const sizes = await rails.getByRole("listbox").evaluateAll((lists) => lists.map((element) => [Math.round(element.getBoundingClientRect().width), Math.round(element.getBoundingClientRect().height)]));
  expect(sizes[0]).toEqual(sizes[1]);

  // Escape closes the dialog and not the project settings under it; the focus is back on the button of the row.
  await page.keyboard.press("Escape");
  await expect(rails).toHaveCount(0);
  await expect(projectSettings(page)).toHaveCount(1);
  await expect(itemsButton(page, "Elevated Rails")).toBeFocused();

  // A module with both: the switch shows the other side.
  await itemsButton(page, "Recycler").click();
  const recycler = itemsDialog(page, "Recycler");
  await expect(rows(list(recycler, "Shown", "signals"))).toHaveText(["Recycler", "Recycler (remnant)"]);
  await expect(sideButton(recycler, "entities")).toHaveText("Entities1");
  await sideButton(recycler, "entities").click();
  await expect(sideButton(recycler, "entities")).toHaveAttribute("aria-pressed", "true");
  await expect(sideButton(recycler, "signals")).toHaveAttribute("aria-pressed", "false");
  await expect(rows(list(recycler, "Shown", "entities"))).toHaveText(["Recycler"]);
  await expect(rows(list(recycler, "Shown", "entities")).first()).toHaveAttribute("title", "recycler");
  await expect(emptyNote(recycler, "hidden")).toHaveText("No entity is hidden.");
  await expect(recycler.getByRole("listbox", { name: "Shown signals", exact: true })).toHaveCount(0);
  await move(recycler, "Close").click();
  await expect(recycler).toHaveCount(0);
  await expect(projectSettings(page)).toHaveCount(1);

  // The base game: the four combinators of the selector's first row are always offered and are not in its list.
  await itemsButton(page, "Base Mod").click();
  const base = itemsDialog(page, "Base Mod");
  await expect(sideButton(base, "signals")).toHaveText("Signals576");
  await expect(sideButton(base, "entities")).toHaveText("Entities63");
  await expect(rows(list(base, "Shown", "signals"))).toHaveCount(576);
  await sideButton(base, "entities").click();
  await expect(rows(list(base, "Shown", "entities"))).toHaveCount(63);
  await filter(base).fill("combinator");
  await expect(rows(list(base, "Shown", "entities"))).toHaveCount(0);
  await expect(emptyNote(base, "shown")).toHaveText("Nothing matches the filter.");
  await base.getByRole("button", { name: "Close signals and entities" }).click();
  await expect(base).toHaveCount(0);
  // The project settings close with their own Escape afterwards.
  await page.keyboard.press("Escape");
  await expect(projectSettings(page)).toHaveCount(0);
});

test("the lists are worked with the mouse and the keys: a click, Cmd or Ctrl, Shift, the arrow keys, select all, Enter, a double click, the filter", async ({ page, running }) => {
  await openSettings(page);
  await itemsButton(page, "Base Mod").click();
  const dialog = itemsDialog(page, "Base Mod");
  const [shown, hidden] = [list(dialog, "Shown", "signals"), list(dialog, "Hidden", "signals")];
  const CHESTS = ["Wooden chest", "Iron chest", "Steel chest", "Active provider chest", "Passive provider chest", "Storage chest", "Buffer chest", "Requester chest"];
  const REMNANTS = CHESTS.map((name) => `${name} (remnant)`);

  // The filter narrows both lists by the name, whatever its case.
  await filter(dialog).fill("CHEST");
  await expect(rows(shown)).toHaveText([...CHESTS, ...REMNANTS]);
  await expect(badge(dialog, "shown")).toHaveText("16 of 576");
  await expect(emptyNote(dialog, "hidden")).toHaveText("No signal is hidden.");

  // A click selects one row, Shift extends from it, Cmd or Ctrl takes a row out or adds one.
  await row(shown, "Wooden chest").click();
  await expect(selectedRows(shown)).toHaveText(["Wooden chest"]);
  await expect(move(dialog, "Hide")).toBeEnabled();
  await expect(move(dialog, "Show")).toBeDisabled();
  await row(shown, "Steel chest").click({ modifiers: ["Shift"] });
  await expect(selectedRows(shown)).toHaveText(["Wooden chest", "Iron chest", "Steel chest"]);
  await row(shown, "Iron chest").click({ modifiers: ["ControlOrMeta"] });
  await row(shown, "Buffer chest").click({ modifiers: ["ControlOrMeta"] });
  await expect(selectedRows(shown)).toHaveText(["Wooden chest", "Steel chest", "Buffer chest"]);

  // The arrow to the right hides them: they are in the other list, in the game's order and selected, so the other arrow takes them back.
  await move(dialog, "Hide").click();
  await expect(rows(hidden)).toHaveText(["Wooden chest", "Steel chest", "Buffer chest"]);
  await expect(selectedRows(hidden)).toHaveCount(3);
  await expect(rows(shown)).toHaveCount(13);
  await expect(selectedRows(shown)).toHaveCount(0);
  await expect(badge(dialog, "shown")).toHaveText("13 of 573");
  await expect(badge(dialog, "hidden")).toHaveText("3");
  await expect(sideButton(dialog, "signals")).toHaveText("Signals576, 3 hidden");
  await expect(move(dialog, "Hide")).toBeDisabled();
  await expect(move(dialog, "Show")).toBeEnabled();
  // Stored at once, in the order it was hidden in.
  await expect.poll(() => storedSettings(running.userData)).toEqual({ version: 1, gameDirectory: null, hidden: [{ module: "base", signals: ["item:wooden-chest", "item:steel-chest", "item:buffer-chest"], entities: [] }] });

  // The focus is in the list the rows left, on the row after the first of them: Enter moves that one across.
  await expect(shown).toBeFocused();
  await expect(shown.locator('[role="option"][data-active="true"]')).toHaveText("Iron chest");
  await page.keyboard.press("Enter");
  await expect(rows(hidden)).toHaveText(["Wooden chest", "Iron chest", "Steel chest", "Buffer chest"]);
  await expect(selectedRows(hidden)).toHaveText(["Iron chest"]);
  // The arrow keys move the selection, Shift extends it, Enter moves what is selected.
  await page.keyboard.press("ArrowDown");
  await expect(selectedRows(shown)).toHaveText(["Passive provider chest"]);
  await page.keyboard.press("Shift+ArrowDown");
  await expect(selectedRows(shown)).toHaveText(["Passive provider chest", "Storage chest"]);
  await page.keyboard.press("Enter");
  await expect(rows(hidden)).toHaveText(["Wooden chest", "Iron chest", "Steel chest", "Passive provider chest", "Storage chest", "Buffer chest"]);
  await expect(rows(shown)).toHaveText(["Active provider chest", "Requester chest", ...REMNANTS]);
  // Home and End go to the ends; Cmd or Ctrl+A selects all the list has under the filter.
  await page.keyboard.press("End");
  await expect(selectedRows(shown)).toHaveText(["Requester chest (remnant)"]);
  await page.keyboard.press("Home");
  await expect(selectedRows(shown)).toHaveText(["Active provider chest"]);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(selectedRows(shown)).toHaveCount(10);
  await expect(rows(shown)).toHaveCount(10);

  // A double click moves the one row across, here back.
  await row(hidden, "Buffer chest").dblclick();
  await expect(rows(hidden)).toHaveText(["Wooden chest", "Iron chest", "Steel chest", "Passive provider chest", "Storage chest"]);
  await expect(row(shown, "Buffer chest")).toHaveAttribute("aria-selected", "true");

  // "Show all" acts on what the filter leaves of the hidden list.
  await filter(dialog).fill("wooden");
  await expect(rows(hidden)).toHaveText(["Wooden chest"]);
  await expect(badge(dialog, "hidden")).toHaveText("1 of 5");
  await move(dialog, "Show all").click();
  await expect(rows(hidden)).toHaveCount(0);
  await expect(emptyNote(dialog, "hidden")).toHaveText("Nothing matches the filter.");
  await expect(move(dialog, "Show all")).toBeDisabled();
  // Escape empties the filter first and leaves the dialog open.
  await filter(dialog).focus();
  await page.keyboard.press("Escape");
  await expect(filter(dialog)).toHaveValue("");
  await expect(dialog).toHaveCount(1);
  await expect(rows(hidden)).toHaveText(["Iron chest", "Steel chest", "Passive provider chest", "Storage chest"]);
  await expect(badge(dialog, "hidden")).toHaveText("4");

  // "Hide all" under a filter hides what it leaves; "Show all" without one shows everything, and nothing is stored any more.
  await filter(dialog).fill("requester chest");
  await move(dialog, "Hide all").click();
  await filter(dialog).fill("");
  await expect(rows(hidden)).toHaveText(["Iron chest", "Steel chest", "Passive provider chest", "Storage chest", "Requester chest", "Requester chest (remnant)"]);
  await expect.poll(() => storedSettings(running.userData)).toEqual({
    version: 1,
    gameDirectory: null,
    hidden: [{ module: "base", signals: ["item:steel-chest", "item:iron-chest", "item:passive-provider-chest", "item:storage-chest", "item:requester-chest", "entity:requester-chest-remnants"], entities: [] }],
  });
  await move(dialog, "Close").click();
  await expect(moduleRow(page, "base").locator(".module-count")).toHaveText("576 signals, 67 entities, 6 hidden");
  await itemsButton(page, "Base Mod").click();
  await move(dialog, "Show all").click();
  await expect(rows(hidden)).toHaveCount(0);
  await expect(emptyNote(dialog, "hidden")).toHaveText("No signal is hidden.");
  await expect(sideButton(dialog, "signals")).toHaveText("Signals576");
  await expect.poll(() => storedSettings(running.userData)).toEqual({ version: 1, gameDirectory: null });
  await move(dialog, "Close").click();
  await expect(moduleRow(page, "base").locator(".module-count")).toHaveText("576 signals, 67 entities");
});

test("what is hidden is offered by neither the picker nor the selector, a project that uses it has no warning, and the choice holds after a restart and for a new project", async () => {
  const projectPath = await writeProject({ name: "Hidden", source: USES_HIDDEN });
  const first = await launchApp({ open: "start" });
  try {
    const { page, userData } = first;
    await openProject(page, projectPath);
    await expect(page.locator("g.card")).toHaveCount(2);
    await expect(paletteEntry(page, "wooden-chest")).toHaveCount(1);
    const offered = Number(await palette(page).locator(".palette-heading .count-badge").textContent());

    // Two signals and an entity of the base game are hidden with the arrows.
    await openSettings(page);
    await itemsButton(page, "Base Mod").click();
    const dialog = itemsDialog(page, "Base Mod");
    await filter(dialog).fill("wooden chest");
    await row(list(dialog, "Shown", "signals"), "Wooden chest").click();
    await move(dialog, "Hide").click();
    await filter(dialog).fill("signal a");
    await expect(rows(list(dialog, "Shown", "signals"))).toHaveText(["Signal A"]);
    await row(list(dialog, "Shown", "signals"), "Signal A").click();
    await move(dialog, "Hide").click();
    await filter(dialog).fill("");
    await expect(rows(list(dialog, "Hidden", "signals"))).toHaveText(["Wooden chest", "Signal A"]);
    await sideButton(dialog, "entities").click();
    await expect(rows(list(dialog, "Shown", "entities")).first()).toHaveText("Wooden chest");
    await rows(list(dialog, "Shown", "entities")).first().click();
    await move(dialog, "Hide").click();
    await expect(rows(list(dialog, "Hidden", "entities"))).toHaveText(["Wooden chest"]);
    await expect(sideButton(dialog, "entities")).toHaveText("Entities63, 1 hidden");
    await expect.poll(() => storedSettings(userData)).toEqual({ version: 1, gameDirectory: null, hidden: [HIDDEN] });

    // It is a setting of the application: the project has no unsaved change, and its row says how many are hidden.
    await move(dialog, "Close").click();
    await expect(moduleRow(page, "base").locator(".module-count")).toHaveText("576 signals, 67 entities, 3 hidden");
    await page.keyboard.press("Escape");
    await expect(projectSettings(page)).toHaveCount(0);
    await expect(page.getByTestId("save-state")).toHaveText("All changes saved");

    // The selector: no tile in its tab, one fewer in its count, nothing in its search; the chest of the circuit is in use all the same.
    await expect(paletteEntry(page, "wooden-chest")).toHaveCount(0);
    await expect(paletteEntry(page, "iron-chest")).toHaveCount(1);
    await expect(palette(page).locator(".palette-heading .count-badge")).toHaveText(String(offered - 1));
    await expect(palette(page).locator('.palette-tile.in-use[data-prototype="wooden-chest"]')).toHaveCount(1);
    await palette(page).getByLabel("Search entities").fill("wooden");
    await expect(palette(page).locator(".palette-catalog .palette-empty")).toHaveText('No entity matches "wooden".');
    await palette(page).getByLabel("Search entities").fill("");

    // The picker: neither of the two signals, and the ones beside them as ever.
    await selectEntity(page, "source");
    await inspector(page).getByRole("button", { name: "Choose signal 1" }).click();
    await picker(page).getByLabel("Search signals").fill("wooden chest");
    await expect(picker(page).locator('[data-signal="entity:wooden-chest-remnants"]')).toHaveCount(1);
    await expect(picker(page).locator('[data-signal="item:wooden-chest"]')).toHaveCount(0);
    await picker(page).getByLabel("Search signals").fill("signal");
    await expect(picker(page).locator('[data-signal="virtual:signal-B"]')).toHaveCount(1);
    await expect(picker(page).locator('[data-signal="virtual:signal-A"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(picker(page)).toHaveCount(0);

    // The project uses all three: nothing is flagged, the entities are drawn, the source is as it was.
    expect(await diagnostics(page)).toEqual([]);
    await expect(page.locator(".statusbar")).not.toContainText("warning");
    await expect(card(page, "box")).toHaveCount(1);
    await expect(inspector(page).locator(".field-warning")).toHaveCount(0);
    expect(await sourceText(page)).toBe(USES_HIDDEN);

    // A request the main process cannot take is refused and stores nothing.
    const refused = await page.evaluate(async () => {
      const face = window.face as unknown as { setHiddenItems(items: unknown): Promise<unknown> };
      return [await face.setHiddenItems({ module: "", signals: [], entities: [] }), await face.setHiddenItems({ module: "base", signals: ["wooden-chest"], entities: [] }), await face.setHiddenItems("base")];
    });
    expect(refused).toEqual([{ ok: false, error: "Module name must not be empty" }, { ok: false, error: "Hidden signal must be a signal kind and a name" }, { ok: false, error: "Hidden items must be an object" }]);
    expect(await storedSettings(userData)).toEqual({ version: 1, gameDirectory: null, hidden: [HIDDEN] });
  } finally {
    await closeApp(first.app);
  }

  // After a restart the project comes back without a warning, and nothing of the three is offered.
  const second = await launchApp({ userData: first.userData, open: "start" });
  try {
    const { app, page, userData } = second;
    await page.locator(".project-meta .path", { hasText: projectPath }).waitFor();
    await expect(page.locator("g.card")).toHaveCount(2);
    expect(await diagnostics(page)).toEqual([]);
    await expect(paletteEntry(page, "wooden-chest")).toHaveCount(0);
    await expect(paletteEntry(page, "iron-chest")).toHaveCount(1);
    expect(await page.evaluate(() => window.face!.getHiddenItems())).toEqual({ ok: true, value: [HIDDEN] });

    // A new project has the same choice.
    await clickMenu(app, "File", "New Project");
    await page.waitForFunction(() => window.faceSession!.getState().project.path === null && window.faceSession!.getState().circuit.entities.length === 0);
    await expect(paletteEntry(page, "wooden-chest")).toHaveCount(0);
    await expect(paletteEntry(page, "iron-chest")).toHaveCount(1);
    await expect(palette(page).locator(".palette-tile.in-use")).toHaveCount(0);
    await openSettings(page);
    await expect(moduleRow(page, "base").locator(".module-count")).toHaveText("576 signals, 67 entities, 3 hidden");

    // Shown again, they are offered again, and the settings file holds nothing about them.
    await itemsButton(page, "Base Mod").click();
    const dialog = itemsDialog(page, "Base Mod");
    await expect(rows(list(dialog, "Hidden", "signals"))).toHaveText(["Wooden chest", "Signal A"]);
    await row(list(dialog, "Hidden", "signals"), "Wooden chest").click();
    await row(list(dialog, "Hidden", "signals"), "Signal A").click({ modifiers: ["Shift"] });
    await move(dialog, "Show").click();
    await expect(rows(list(dialog, "Hidden", "signals"))).toHaveCount(0);
    await sideButton(dialog, "entities").click();
    await rows(list(dialog, "Hidden", "entities")).first().dblclick();
    await expect(rows(list(dialog, "Hidden", "entities"))).toHaveCount(0);
    await expect(emptyNote(dialog, "hidden")).toHaveText("No entity is hidden.");
    await expect.poll(() => storedSettings(userData)).toEqual({ version: 1, gameDirectory: null });
    await move(dialog, "Close").click();
    await expect(moduleRow(page, "base").locator(".module-count")).toHaveText("576 signals, 67 entities");
    await page.keyboard.press("Escape");
    await expect(paletteEntry(page, "wooden-chest")).toHaveCount(1);
  } finally {
    await closeApp(second.app);
  }
});
