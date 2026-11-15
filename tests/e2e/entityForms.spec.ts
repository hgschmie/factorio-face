// The settings of the other entities of the game (kind `entity`) in the inspector: a form made from the settings table, with a
// control per field type that writes to the source and reads it back; the choice of the prototype among those of its type; the
// facing as the game builds the entity; and what the simulation shows of them: whether their circuit conditions hold, on the
// card, on the board and in the dock.
import type { Page } from "@playwright/test";
import { resolve } from "node:path";
import { card, expect, openProject, SCREENSHOT_DIR, selectEntity, showDisplay, sourceText, test, writeProject } from "./app.ts";
import { bubble, declarationCount, footprint, hoverOnBoard, inspector, selectOnBoard, setSource } from "./board.ts";

const SHOTS = resolve(SCREENSHOT_DIR, "entities-ui");
const toast = (page: Page) => page.getByRole("alert");
const setting = (page: Page, key: string) => inspector(page).locator(`.setting[data-setting="${key}"]`);
const shownSettings = (page: Page) => inspector(page).locator(".setting").evaluateAll((all) => all.map((element) => element.getAttribute("data-setting")));
const checkbox = (page: Page, name: string) => inspector(page).getByRole("checkbox", { name, exact: true });
const field = (page: Page, name: string) => inspector(page).getByLabel(name, { exact: true });
const trace = (page: Page, label: string) => page.locator(`.signal-history tr.trace[data-trace="${label}"]`);
/** The statements of an entity as the source has them, one per line. */
async function body(page: Page, name: string): Promise<string[]> {
  const text = await sourceText(page);
  const start = text.indexOf(` ${name} `);
  return text.slice(text.indexOf("{", start) + 1, text.indexOf("\n    }", start)).split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

/** One entity per field type the test edits, apart on the edit canvas; the constant feeds the inserter. */
const FACTORY = `circuit "Factory" {
    constant-combinator source at (0, 0) {
        item:iron-plate = 40
    }

    inserter feeder at (240, 0) facing north {
    }

    iron-chest box at (480, 0) {
    }

    train-stop station at (720, 0) {
        blueprint-data = "{\\"station\\":\\"Iron\\",\\"manual_trains_limit\\":2}"
    }

    splitter split at (0, 200) {
    }

    stone-wall guard at (240, 200) {
    }

    roboport robots at (480, 200) {
    }

    storage-tank tank at (720, 200) {
    }

    wire red source.out <-> feeder
}
`;

async function openFactory(page: Page, source = FACTORY): Promise<void> {
  await openProject(page, await writeProject({ name: "Factory", source }));
  // The canvas draws what is in view: fit first, then every entity is.
  await page.locator("g.card").first().waitFor();
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await expect(page.locator("g.card")).toHaveCount(declarationCount(source));
}

test("the form of an inserter has a control per setting of its type and writes every field type to the source", async ({ page }) => {
  await openFactory(page);
  await selectEntity(page, "feeder");
  await expect(inspector(page).locator("h2")).toHaveText("Inserter");
  await expect(inspector(page).locator(".inspector-identity p")).toHaveText("Switch it on a condition, set filters and stack size, read its hand");
  // The settings of the type in the order of the table. The signal of the stack size belongs to its switch, which is off.
  expect(await shownSettings(page)).toEqual(["when", "logistic-when", "networks", "output-networks", "set-filters", "read-hand", "set-stack-size"]);
  expect(await inspector(page).locator(".setting").evaluateAll((all) => all.map((element) => element.getAttribute("data-type")))).toEqual(["condition", "condition", "networks", "networks", "boolean", "enum", "boolean"]);
  await expect(checkbox(page, "Enable/disable")).not.toBeChecked();
  await expect(field(page, "Read hand contents")).toHaveValue("none");

  // A condition: the checkbox switches it on with a first signal, as for a lamp, and its fields edit it.
  await checkbox(page, "Enable/disable").check();
  expect(await body(page, "feeder")).toEqual(["when virtual:signal-A > 0"]);
  const when = setting(page, "when");
  await when.getByLabel("Condition signal", { exact: true }).fill("item:iron-plate");
  await when.getByLabel("Comparator").selectOption("<");
  await when.getByLabel("Number", { exact: true }).fill("100");
  expect(await body(page, "feeder")).toEqual(["when item:iron-plate < 100"]);
  // The other side can be a signal; a wildcard is taken on the left only.
  await when.getByLabel("Compare to").selectOption("signal");
  await when.getByLabel("Other signal", { exact: true }).fill("virtual:signal-B");
  expect(await body(page, "feeder")).toContain("when item:iron-plate < virtual:signal-B");
  await when.getByLabel("Other signal", { exact: true }).fill("anything");
  await expect(when.getByRole("alert")).toHaveText("Wildcard signals are not allowed here");
  expect(await body(page, "feeder")).toContain("when item:iron-plate < virtual:signal-B");
  await when.getByLabel("Compare to").selectOption("constant");
  await when.getByLabel("Number", { exact: true }).fill("100");
  // Text that is no number is kept in the field and not written.
  await when.getByLabel("Number", { exact: true }).fill("10x");
  await expect(when.getByRole("alert")).toHaveText("Enter a whole number");
  expect(await body(page, "feeder")).toEqual(["when item:iron-plate < 100"]);
  await when.getByLabel("Number", { exact: true }).fill("100");

  // A mode, a switch with the signal that belongs to it, and the two network selections.
  await field(page, "Read hand contents").selectOption("pulse");
  await checkbox(page, "Set filters").check();
  await checkbox(page, "Set stack size").check();
  expect(await shownSettings(page)).toEqual(["when", "logistic-when", "networks", "output-networks", "set-filters", "read-hand", "set-stack-size", "stack-size-signal"]);
  // The signal the game uses by itself shows in the field and is not written.
  await expect(field(page, "Stack size signal")).toHaveValue("virtual:signal-S");
  expect(await body(page, "feeder")).toEqual(["when item:iron-plate < 100", "set-filters = true", "read-hand = pulse", "set-stack-size = true"]);
  await field(page, "Stack size signal").fill("virtual:signal-X");
  await inspector(page).getByRole("button", { name: "Read from: green network" }).click();
  await inspector(page).getByRole("button", { name: "Send to: red network" }).click();
  expect(await body(page, "feeder")).toEqual([
    "when item:iron-plate < 100", "networks = red", "output-networks = green", "set-filters = true", "read-hand = pulse", "set-stack-size = true", "stack-size-signal = virtual:signal-X",
  ]);
  await expect(inspector(page).getByRole("button", { name: "Read from: green network" })).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: resolve(SHOTS, "inspector-inserter.png") });

  // The logistic condition is kept and not evaluated, which the form says.
  await checkbox(page, "Logistic network condition").check();
  await expect(setting(page, "logistic-when").locator(".muted-note")).toContainText("kept and not evaluated");
  expect(await body(page, "feeder")).toContain("logistic when virtual:signal-A > 0");
  await checkbox(page, "Logistic network condition").uncheck();
  expect((await body(page, "feeder")).join("\n")).not.toContain("logistic");

  // A condition whose signal is taken out is a draft: the source keeps the last complete one until the signal is back.
  await when.getByLabel("Condition signal", { exact: true }).fill("");
  await expect(inspector(page).locator(".draft-hint")).toContainText('The condition "Enable/disable" needs a signal.');
  expect(await body(page, "feeder")).toContain("when item:iron-plate < 100");
  await when.getByLabel("Condition signal", { exact: true }).fill("item:copper-plate");
  await expect(inspector(page).locator(".draft-hint")).toHaveCount(0);
  expect(await body(page, "feeder")).toContain("when item:copper-plate < 100");

  // The form reads the source back: what is typed there shows in the controls (a field shows its own text while it has the focus).
  await when.getByLabel("Condition signal", { exact: true }).blur();
  await setSource(page, (await sourceText(page)).replace("read-hand = pulse", "read-hand = hold").replace("networks = red\n", "networks = none\n").replace("when item:copper-plate < 100", "when everything >= 7"));
  await expect(field(page, "Read hand contents")).toHaveValue("hold");
  await expect(inspector(page).getByRole("button", { name: "Read from: red network" })).toHaveAttribute("aria-pressed", "false");
  await expect(when.getByLabel("Condition signal", { exact: true })).toHaveValue("everything");
  await expect(when.getByLabel("Comparator")).toHaveValue(">=");
  await expect(when.getByLabel("Number", { exact: true })).toHaveValue("7");
  // Undo takes the last edit back, one step per control.
  await checkbox(page, "Set filters").uncheck();
  expect(await body(page, "feeder")).toContain("set-filters = false");
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await body(page, "feeder")).toContain("set-filters = true");
  await expect(checkbox(page, "Set filters")).toBeChecked();
  // Switching the condition off takes its statement out.
  await checkbox(page, "Enable/disable").uncheck();
  expect((await body(page, "feeder")).join("\n")).not.toContain("when");
  expect(await page.evaluate(() => window.faceSession!.getState().diagnostics.filter((diagnostic) => diagnostic.severity === "error"))).toEqual([]);
});

test("a chest, a train stop, a splitter, a wall and a roboport each have the form of their type", async ({ page }) => {
  await openFactory(page);

  // A chest reads its contents unless told otherwise; the signal of the empty slots comes with its switch.
  await selectEntity(page, "box");
  await expect(inspector(page).locator("h2")).toHaveText("Iron chest");
  expect(await shownSettings(page)).toEqual(["output-networks", "read-contents", "read-empty-slots"]);
  await expect(checkbox(page, "Read contents")).toBeChecked();
  await checkbox(page, "Read contents").uncheck();
  await checkbox(page, "Read empty slots").check();
  await expect(field(page, "Empty slots signal")).toHaveValue("virtual:signal-E");
  expect(await body(page, "box")).toEqual(["read-contents = false", "read-empty-slots = true"]);
  await field(page, "Empty slots signal").fill("virtual:signal-F");
  expect(await body(page, "box")).toContain("empty-slots-signal = virtual:signal-F");
  // An emptied signal field is the signal of the prototype again.
  await field(page, "Empty slots signal").fill("");
  await field(page, "Empty slots signal").blur();
  await expect(field(page, "Empty slots signal")).toHaveValue("virtual:signal-E");
  // A chest does not turn: no facing. It can be another chest; the chests of the game's editor are not offered.
  await expect(inspector(page).getByRole("group", { name: "Facing" })).toHaveCount(0);
  expect(await inspector(page).locator(".prototype-field.compact button").evaluateAll((all) => all.map((element) => element.getAttribute("data-prototype")))).toEqual(["wooden-chest", "iron-chest", "steel-chest"]);
  await expect(inspector(page).locator(".kept-fields")).toHaveCount(0);

  // A train stop: its switches with their signals, and what a blueprint had for it that the editor only keeps.
  await selectEntity(page, "station");
  await expect(inspector(page).locator("h2")).toHaveText("Train stop");
  expect(await shownSettings(page)).toEqual(["when", "logistic-when", "networks", "output-networks", "send-to-train", "read-from-train", "read-stopped-train", "set-trains-limit", "read-trains-count", "set-priority"]);
  await expect(checkbox(page, "Send to train")).toBeChecked();
  await checkbox(page, "Send to train").uncheck();
  await checkbox(page, "Read train contents").check();
  await checkbox(page, "Read stopped train").check();
  await checkbox(page, "Set train limit").check();
  await expect(field(page, "Stopped train signal")).toHaveValue("virtual:signal-T");
  await expect(field(page, "Train limit signal")).toHaveValue("virtual:signal-L");
  await field(page, "Train limit signal").fill("item:iron-plate");
  await checkbox(page, "Enable/disable").check();
  expect(await body(page, "station")).toEqual([
    "when virtual:signal-A > 0", "send-to-train = false", "read-from-train = true", "read-stopped-train = true", "set-trains-limit = true", "trains-limit-signal = item:iron-plate",
    'blueprint-data = "{\\"station\\":\\"Iron\\",\\"manual_trains_limit\\":2}"',
  ]);
  await expect(inspector(page).locator(".kept-fields")).toHaveText("Kept from the blueprint: station, manual_trains_limit. The editor does not change these fields and writes them back on export.");
  // The one train stop of the game: nothing to choose.
  await expect(inspector(page).locator(".prototype-field")).toHaveCount(0);
  await expect(inspector(page).getByRole("group", { name: "Facing" }).getByRole("button")).toHaveCount(4);
  await page.screenshot({ path: resolve(SHOTS, "inspector-train-stop.png") });

  // A splitter has a condition per side; one that is switched on starts as the game has it.
  await selectEntity(page, "split");
  expect(await shownSettings(page)).toEqual(["input-left-when", "input-right-when", "output-left-when", "output-right-when", "networks", "set-filter"]);
  await checkbox(page, "Input priority left").check();
  await checkbox(page, "Output priority right").check();
  expect(await body(page, "split")).toEqual(["input-left when virtual:signal-I < 0", "output-right when virtual:signal-O > 0"]);
  await setting(page, "output-right-when").getByLabel("Number", { exact: true }).fill("5");
  await checkbox(page, "Set filter").check();
  expect(await body(page, "split")).toEqual(["input-left when virtual:signal-I < 0", "output-right when virtual:signal-O > 5", "set-filter = true"]);
  await expect(setting(page, "input-left-when").getByLabel("Condition signal", { exact: true })).toHaveValue("virtual:signal-I");
  await expect(card(page, "split").locator(".card-summary")).toHaveText(["input-left I <… +1", "set-filter"]);
  await page.screenshot({ path: resolve(SHOTS, "inspector-splitter.png") });

  // A wall: the condition that opens the gate and the gate sensor, and a note on what the game does with a wall.
  await selectEntity(page, "guard");
  await expect(inspector(page).locator("h2")).toHaveText("Wall");
  await expect(inspector(page).locator(".prototype-note")).toContainText("only while a gate stands next to it");
  await checkbox(page, "Open gate").check();
  await checkbox(page, "Read gate sensor").check();
  await expect(field(page, "Gate sensor signal")).toHaveValue("virtual:signal-G");
  expect(await body(page, "guard")).toEqual(["open-gate when virtual:signal-A > 0", "read-sensor = true"]);
  // A wall has no description in the game: the field says that the text stays in the project.
  await expect(inspector(page).getByLabel("Description")).toHaveAttribute("title", "A wall has no description in the game. This text stays in the project.");

  // A roboport: a mode with three words, and the five signals of the robot statistics behind their switch.
  await selectEntity(page, "robots");
  expect(await shownSettings(page)).toEqual(["output-networks", "read-items", "read-robot-stats"]);
  await expect(field(page, "Read items")).toHaveValue("logistics");
  expect(await field(page, "Read items").locator("option").allTextContents()).toEqual(["None", "Logistics", "Missing requests"]);
  await field(page, "Read items").selectOption("missing-requests");
  await checkbox(page, "Read robot statistics").check();
  expect(await shownSettings(page)).toEqual(["output-networks", "read-items", "read-robot-stats", "available-logistic-signal", "total-logistic-signal", "available-construction-signal", "total-construction-signal", "roboport-count-signal"]);
  await expect(field(page, "Available logistic robots")).toHaveValue("virtual:signal-X");
  await field(page, "Roboport count").fill("virtual:signal-N");
  expect(await body(page, "robots")).toEqual(["read-items = missing-requests", "read-robot-stats = true", "roboport-count-signal = virtual:signal-N"]);

  // A storage tank is built facing north or east only.
  await selectEntity(page, "tank");
  const facing = inspector(page).getByRole("group", { name: "Facing" });
  expect(await facing.getByRole("button").evaluateAll((all) => all.map((element) => element.getAttribute("data-direction")))).toEqual(["north", "east"]);
  await expect(facing.getByRole("button", { name: "East" })).toHaveAttribute("aria-pressed", "true");
  await facing.getByRole("button", { name: "North" }).click();
  expect(await sourceText(page)).toContain("storage-tank tank at (720, 200) facing north {");
  await expect(facing.getByRole("button", { name: "North" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.faceSession!.getState().diagnostics.filter((diagnostic) => diagnostic.severity === "error"))).toEqual([]);
});

/** The prototypes of the type `assembling-machine` in the game's order of their items: production, then space. */
const MACHINES = ["foundry", "biochamber", "assembling-machine-1", "assembling-machine-2", "assembling-machine-3", "oil-refinery", "chemical-plant", "centrifuge", "electromagnetic-plant", "cryogenic-plant", "crusher"];

/** An assembling machine with a chest two tiles beside it, and an inserter. */
const TIGHT = `circuit "Tight" {
    assembling-machine-1 maker at (0, 0) tile (1.5, 1.5) {
        read-contents = true
    }

    iron-chest box at (240, 0) tile (4.5, 3.5) {
    }

    inserter feeder at (480, 0) tile (7.5, 0.5) {
        read-hand = hold
    }
}
`;

test("an entity becomes another prototype of its type; on the board one whose footprint would cover another entity is refused", async ({ page }) => {
  await openFactory(page, TIGHT);
  await selectEntity(page, "feeder");
  const chooser = inspector(page).locator(".prototype-field.compact");
  // The inserters of the project, in the game's order, as icons; the chosen one is named under them with its tiles.
  expect(await chooser.getByRole("button").evaluateAll((all) => all.map((element) => element.getAttribute("aria-label")))).toEqual(["Burner inserter", "Inserter", "Long-handed inserter", "Fast inserter", "Bulk inserter", "Stack inserter"]);
  await expect(chooser.getByRole("button", { name: "Inserter", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(inspector(page).locator(".prototype-chosen")).toHaveText("Inserter 1 tile");
  await chooser.getByRole("button", { name: "Fast inserter" }).click();
  // The settings stay; the card, the inspector and the entities in use follow.
  expect(await body(page, "feeder")).toEqual(["read-hand = hold"]);
  expect(await sourceText(page)).toContain("    fast-inserter feeder at (");
  await expect(inspector(page).locator("h2")).toHaveText("Fast inserter");
  await expect(inspector(page).locator(".prototype-chosen")).toHaveText("Fast inserter 1 tile");
  await expect(card(page, "feeder").locator(".card-kind")).toHaveText("FAST INSERTER");
  await expect(page.locator('.palette-tile.in-use[data-prototype="fast-inserter"]')).toHaveCount(1);
  await expect(page.locator('.palette-tile.in-use[data-prototype="inserter"]')).toHaveCount(0);
  // The word of the declaration is all that changed, in one step.
  const changed = await sourceText(page);
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await sourceText(page)).toBe(changed.replace("    fast-inserter feeder at (", "    inserter feeder at ("));
  expect(await body(page, "feeder")).toEqual(["read-hand = hold"]);

  // On the board: an oil refinery covers 5 x 5 tiles from the top-left tile of the machine, and the chest stands on one of them.
  await showDisplay(page, "blueprint");
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await selectOnBoard(page, "maker");
  const before = await sourceText(page);
  // Every crafting machine of the game is of one type: eleven with Space Age, in the game's order of their items.
  expect(await chooser.getByRole("button").evaluateAll((all) => all.map((element) => element.getAttribute("data-prototype")))).toEqual(MACHINES);
  await chooser.getByRole("button", { name: "Oil refinery" }).click();
  await expect(toast(page)).toHaveText("Not changed: maker would stand on a tile of box.");
  expect(await sourceText(page)).toBe(before);
  expect(await footprint(page, "maker")).toMatchObject({ tile: [0, 0], size: [3, 3] });
  await expect(chooser.getByRole("button", { name: "Assembling machine 1" })).toHaveAttribute("aria-pressed", "true");
  // One of the same size is taken, and one that is smaller in the turned direction as well.
  await chooser.getByRole("button", { name: "Assembling machine 2" }).click();
  await expect(toast(page)).toHaveCount(0);
  expect(await body(page, "maker")).toEqual(["read-contents = true"]);
  expect(await sourceText(page)).toBe(before.replace("    assembling-machine-1 maker at (", "    assembling-machine-2 maker at ("));
  expect(await footprint(page, "maker")).toMatchObject({ tile: [0, 0], size: [3, 3] });
  // An assembling machine 2 turns, which a machine 1 does not: the facing appears with it.
  await expect(inspector(page).getByRole("group", { name: "Facing" }).getByRole("button")).toHaveCount(4);
  // With the chest out of the way the refinery fits: the top-left tile stays, the center moves.
  await page.evaluate(() => {
    const session = window.faceSession!;
    session.commands.setTiles([{ id: session.getState().circuit.entities.find((entity) => entity.name === "box")!.id, tile: { x: 6.5, y: 5.5 } }]);
  });
  await chooser.getByRole("button", { name: "Oil refinery" }).click();
  await expect(toast(page)).toHaveCount(0);
  expect(await footprint(page, "maker")).toMatchObject({ tile: [0, 0], size: [5, 5] });
  expect(await sourceText(page)).toContain("oil-refinery maker at (0, 0) tile (2.5, 2.5) {\n        read-contents = true");
});

/** A constant feeds an inserter that works below 100 plates, a rail signal that closes above 20 and a chest. */
const LINE = `circuit "Line" {
    constant-combinator source at (0, 0) tile (0.5, 0.5) {
        item:iron-plate = 40
    }

    fast-inserter feeder at (240, 0) tile (3.5, 0.5) {
        when item:iron-plate < 100
    }

    rail-signal gate at (480, 0) tile (6.5, 0.5) {
        close when item:iron-plate > 20
    }

    steel-chest box at (720, 0) tile (9.5, 0.5) {
    }

    assembling-machine-2 maker at (240, 200) tile (4.5, 4.5) {
        when item:iron-plate > 200
        read-working = true
    }

    wire red source.out <-> feeder
    wire red feeder <-> gate
    wire red gate <-> box
    wire red feeder <-> maker
}
`;

test("an inserter wired to a constant is enabled or disabled as the constant says: on its card, on the board and in the dock", async ({ page }) => {
  await openFactory(page, LINE);
  const conditions = (name: string) => card(page, name).locator('.card-row[data-row="conditions"]');
  const setPlates = async (count: number): Promise<void> => setSource(page, (await sourceText(page)).replace(/item:iron-plate = \d+/, `item:iron-plate = ${count}`));

  // 40 plates: the inserter works, the rail signal closes, the machine waits. Each card says it in its last row, with what it reads above.
  await expect(card(page, "feeder")).toHaveAttribute("data-status", "enabled");
  await expect(card(page, "feeder")).toHaveAttribute("data-in-red", "iron-plate 40");
  await expect(conditions("feeder")).toHaveText("enabled");
  await expect(conditions("feeder").locator(".condition")).toHaveClass(/holds/);
  await expect(card(page, "feeder")).not.toHaveClass(/disabled/);
  // A condition that does not enable the entity goes by what it decides.
  await expect(card(page, "gate")).toHaveAttribute("data-status", "close enabled");
  await expect(conditions("gate")).toHaveText("close");
  await expect(card(page, "gate")).not.toHaveClass(/disabled/);
  await expect(card(page, "maker")).toHaveAttribute("data-status", "disabled");
  await expect(conditions("maker")).toHaveText("disabled");
  await expect(card(page, "maker")).toHaveClass(/disabled/);
  // The card: the game's name, the entity's name, its condition and what it reads, and the two networks.
  await expect(card(page, "maker").locator(".card-kind")).toHaveText("ASSEMBLING MACHINE 2");
  await expect(card(page, "maker").locator(".card-name")).toHaveText("maker");
  await expect(card(page, "maker").locator(".card-summary")).toHaveText(["iron-plate > 200", "read-working"]);
  expect(await card(page, "maker").locator("g.card-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row")))).toEqual(["red", "green", "conditions"]);
  // A chest has no condition: two rows, no state, and no row in the dock.
  expect(await card(page, "box").locator("g.card-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row")))).toEqual(["red", "green"]);
  await expect(card(page, "box")).not.toHaveAttribute("data-status");
  await expect(card(page, "box").locator(".card-summary")).toHaveText("read-contents");

  // The dock follows the conditions of the first entities that have something to follow: the constant, the inserter, the signal.
  await expect(page.locator(".signal-history tr.trace")).toHaveCount(3);
  await expect(trace(page, "feeder condition").locator(".trace-value")).toHaveText("enabled");
  await expect(trace(page, "feeder condition")).toHaveClass(/lit/);
  await expect(trace(page, "gate close").locator(".trace-value")).toHaveText("enabled");
  await expect(trace(page, "gate close").locator(".trace-signal")).toHaveText("close");
  await expect(trace(page, "feeder condition").locator(".trace-signal")).toHaveText("condition");
  await expect(page.locator(".signal-history")).not.toContainText("no output");
  await page.screenshot({ path: resolve(SHOTS, "edit-canvas-entities.png") });

  // More plates than the inserter takes: it stops. Its card, its row in the dock and the totals of the simulation say so.
  await setPlates(150);
  await expect(card(page, "feeder")).toHaveAttribute("data-status", "disabled");
  await expect(conditions("feeder")).toHaveText("disabled");
  await expect(conditions("feeder").locator(".condition")).not.toHaveClass(/holds/);
  await expect(card(page, "feeder")).toHaveClass(/disabled/);
  await expect(trace(page, "feeder condition").locator(".trace-value")).toHaveText("disabled");
  await expect(trace(page, "feeder condition")).not.toHaveClass(/lit/);
  // Over time: the row traces 0 while the condition does not hold and 1 while it does.
  await selectEntity(page, "feeder");
  await expect(page.locator(".signal-history tr.trace")).toHaveCount(1);
  const lastTicks = () => page.evaluate(() => window.faceSession!.getState().simulation.traces[0]!.values.slice(-2));
  await page.getByRole("button", { name: "Step" }).click({ clickCount: 2 });
  expect(await lastTicks()).toEqual([0, 0]);
  // Another circuit starts the simulation over.
  await setPlates(40);
  await page.getByRole("button", { name: "Step" }).click({ clickCount: 2 });
  await expect(trace(page, "feeder condition").locator(".trace-value")).toHaveText("enabled");
  expect(await lastTicks()).toEqual([1, 1]);
  // An entity without a condition has no row and no "no output": the dock says what can be followed.
  await selectEntity(page, "box");
  await expect(page.locator(".signal-history tr.trace")).toHaveCount(0);
  await expect(page.locator(".signal-history")).toContainText("Select a combinator, a lamp, a speaker or an entity with a circuit condition to watch it.");
  // Without its wire the condition does not apply: the card says nothing, the row says why.
  await selectEntity(page, "maker");
  await expect(trace(page, "maker condition").locator(".trace-value")).toHaveText("disabled");
  await setSource(page, (await sourceText(page)).replace("    wire red feeder <-> maker\n", ""));
  await expect(card(page, "maker")).not.toHaveAttribute("data-status");
  await expect(conditions("maker")).toHaveCount(0);
  await expect(card(page, "maker")).not.toHaveClass(/disabled/);
  await expect(trace(page, "maker condition").locator(".trace-value")).toHaveText("no wire");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card(page, "maker")).toHaveClass(/disabled/);

  // The board: the footprint of a disabled entity is dimmed and its light is off; an enabled one has its light on.
  await showDisplay(page, "blueprint");
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await expect(card(page, "maker")).toHaveClass(/board-entity.* disabled/);
  await expect(card(page, "maker").locator(".board-led")).not.toHaveClass(/on/);
  await expect(card(page, "feeder")).not.toHaveClass(/disabled/);
  await expect(card(page, "feeder").locator(".board-led")).toHaveClass(/on/);
  await expect(card(page, "gate").locator(".board-led")).toHaveClass(/on/);
  await expect(card(page, "box").locator(".board-led")).not.toHaveClass(/on/);
  expect(Number(await card(page, "maker").locator("image, svg").first().evaluate((icon) => getComputedStyle(icon).opacity))).toBeLessThan(0.6);
  expect(Number(await card(page, "feeder").locator("image, svg").first().evaluate((icon) => getComputedStyle(icon).opacity))).toBe(1);
  await page.mouse.move(10, 10);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(SHOTS, "board-enabled-disabled.png") });
  await setPlates(150);
  await expect(card(page, "feeder")).toHaveClass(/disabled/);
  await expect(card(page, "feeder").locator(".board-led")).not.toHaveClass(/on/);
  await expect(card(page, "feeder")).toHaveAttribute("data-status", "disabled");
  // The bubble of the board has the card of the entity, with the row of its condition.
  await hoverOnBoard(page, "feeder");
  await expect(bubble(page).locator('.card-row[data-row="conditions"]')).toHaveText("disabled");
  await setPlates(250);
  await expect(card(page, "maker")).not.toHaveClass(/disabled/);
  await expect(card(page, "maker").locator(".board-led")).toHaveClass(/on/);
  expect(await page.evaluate(() => window.faceSession!.getState().diagnostics.filter((diagnostic) => diagnostic.severity === "error"))).toEqual([]);
});
