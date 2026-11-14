// The other entities of the game (chests, inserters, belts, machines, train stops: the kind `entity`) in the app: a blueprint of
// them is imported with nothing dropped, they stand on both canvases with the tiles the game gives them and one connection point,
// an enable condition shows on the card, and the blueprint the app gives back has the same entities, settings and kept fields.
// Their selector is in entitySelector.spec.ts, their settings form in entityForms.spec.ts.
import type { ElectronApplication, Page } from "@playwright/test";
import { decodeBlueprintString, encodeBlueprintString } from "../../packages/blueprints/src/string.ts";
import { resolve } from "node:path";
import { card, clickCenter, clickMenu, entityNames, expect, pin, SCREENSHOT_DIR, showDisplay, sourceText, test, wires } from "./app.ts";
import { footprint, inspector, openBoardProject, pinOffsets, setSource } from "./board.ts";

const SHOTS = resolve(SCREENSHOT_DIR, "generic-entities");
const position = (x: number, y: number) => ({ x, y });
const IRON = { name: "iron-plate" };

/**
 * A blueprint in the form the app writes: a constant combinator feeds a chest, two inserters, a decider combinator, an assembling
 * machine and a train stop. Recipe, bar, station name and train limit are nothing the editor models; it keeps them.
 */
const FACTORY = {
  blueprint: {
    entities: [
      { entity_number: 1, name: "constant-combinator", position: position(0.5, 0.5), control_behavior: { sections: { sections: [{ index: 1, filters: [{ index: 1, name: "iron-plate", quality: "normal", comparator: "=", count: 40 }] }] } } },
      { entity_number: 2, name: "steel-chest", position: position(2.5, 0.5), control_behavior: { read_empty_slots: true }, bar: 10 },
      {
        entity_number: 3, name: "fast-inserter", position: position(3.5, 0.5), direction: 4,
        control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: IRON, constant: 100, comparator: "<" }, circuit_read_hand_contents: true, circuit_hand_read_mode: 1 },
      },
      { entity_number: 4, name: "transport-belt", position: position(4.5, 0.5), direction: 4, control_behavior: { circuit_read_hand_contents: true, circuit_contents_read_mode: 2 } },
      { entity_number: 5, name: "assembling-machine-2", position: position(7.5, 1.5), control_behavior: { read_contents: true }, recipe: "iron-gear-wheel", recipe_quality: "normal" },
      { entity_number: 6, name: "train-stop", position: position(11, 1), control_behavior: { send_to_train: false, read_from_train: true }, station: "Iron pickup", manual_trains_limit: 2 },
      {
        entity_number: 7, name: "decider-combinator", position: position(1, 2.5), direction: 4,
        // As the game writes a decider combinator: no constant of 0, all three lists.
        control_behavior: { decider_conditions: { conditions: [{ first_signal: IRON, comparator: ">" }], outputs: [{ signal: { type: "virtual", name: "signal-A" }, copy_count_from_input: false }], else_outputs: [] } },
      },
      { entity_number: 8, name: "inserter", position: position(3.5, 2.5), control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: IRON, constant: 100, comparator: ">" } } },
    ],
    wires: [
      [1, 1, 2, 1],
      [1, 1, 7, 1],
      [1, 1, 8, 1],
      [2, 1, 3, 1],
      [3, 2, 4, 2],
      [5, 1, 7, 3],
      [5, 2, 6, 2],
    ],
    item: "blueprint",
    label: "Factory",
    version: 562954249961472,
  },
};

const NAMES = ["constant1", "steel_chest1", "fast_inserter1", "transport_belt1", "assembling_machine1", "train_stop1", "decider1", "inserter1"];

const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });

async function pasteBlueprint(app: ElectronApplication, page: Page, text: string): Promise<void> {
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
  await clickMenu(app, "Edit", "Paste Blueprint String...");
  await expect(dialog(page, "Paste blueprint string").getByRole("textbox", { name: "Blueprint string" })).toBeFocused();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.paste());
}

/** Errors of the page from here on: an exception that nobody caught, or anything written to the console as an error. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("a pasted blueprint of chest, inserters, belt, assembling machine and train stop comes in whole and goes out the same", async ({ app, page }) => {
  const errors = pageErrors(page);
  await pasteBlueprint(app, page, encodeBlueprintString(FACTORY));
  // Every entity is one the editor has: nothing is announced as dropped, and no report follows the import.
  await expect(dialog(page, "Paste blueprint string").locator('[data-message="blueprint"]')).toHaveText('"Factory": 8 entities.');
  await dialog(page, "Paste blueprint string").getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => entityNames(page)).toEqual(NAMES);
  const state = await page.evaluate(() => {
    const { project, displayMode, circuit, diagnostics } = window.faceSession!.getState();
    return { name: project.name, displayMode, kinds: circuit.entities.map((entity) => entity.kind), wires: circuit.wires.length, diagnostics: diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`) };
  });
  expect(state).toEqual({ name: "Factory", displayMode: "blueprint", kinds: ["constant", "entity", "entity", "entity", "entity", "entity", "decider", "entity"], wires: 7, diagnostics: [] });

  // What the editor does not model is in the source as the blueprint had it; the settings it models are properties.
  const source = await sourceText(page);
  expect(source).toContain('    entity assembling_machine1 at (560, 0) tile (7.5, 1.5) facing north {\n        prototype = assembling-machine-2\n        read-contents = true\n        blueprint-data = "{\\"recipe\\":\\"iron-gear-wheel\\",\\"recipe_quality\\":\\"normal\\"}"\n    }');
  expect(source).toContain('    entity fast_inserter1 at (280, 0) tile (3.5, 0.5) {\n        prototype = fast-inserter\n        when item:iron-plate < 100\n        read-hand = hold\n    }');
  expect(source).toContain('        prototype = train-stop\n        send-to-train = false\n        read-from-train = true\n        blueprint-data = "{\\"station\\":\\"Iron pickup\\",\\"manual_trains_limit\\":2}"');
  expect(source).toContain("        prototype = transport-belt\n        read-contents = entire-belt-hold\n");
  expect(source).toContain('        prototype = steel-chest\n        read-empty-slots = true\n        blueprint-data = "{\\"bar\\":10}"');
  expect(source).toContain("    wire red constant1.out <-> steel_chest1\n");
  expect(source).toContain("    wire green assembling_machine1 <-> train_stop1\n");

  // On the board every entity stands on the tiles of its prototype, with its one connection point in the middle of the top end.
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await expect(page.locator("g.card.board-entity")).toHaveCount(8);
  await expect(wires(page)).toHaveCount(7);
  expect(await footprint(page, "steel_chest1")).toMatchObject({ tile: [2, 0], size: [1, 1], placed: "true" });
  expect(await footprint(page, "fast_inserter1")).toMatchObject({ tile: [3, 0], size: [1, 1], facing: "east" });
  expect(await footprint(page, "transport_belt1")).toMatchObject({ tile: [4, 0], size: [1, 1], facing: "east" });
  expect(await footprint(page, "assembling_machine1")).toMatchObject({ tile: [6, 0], size: [3, 3], facing: "north" });
  expect(await footprint(page, "train_stop1")).toMatchObject({ tile: [10, 0], size: [2, 2] });
  expect(await footprint(page, "inserter1")).toMatchObject({ tile: [3, 2], size: [1, 1] });
  expect(await footprint(page, "decider1")).toMatchObject({ tile: [0, 2], size: [2, 1] });
  await expect(page.locator("g.card[data-conflict]")).toHaveCount(0);
  expect(await pinOffsets(page, "assembling_machine1")).toEqual({ "io red": [110, 12], "io green": [130, 12] });
  expect(await pinOffsets(page, "train_stop1")).toEqual({ "io red": [70, 12], "io green": [90, 12] });
  expect(await pinOffsets(page, "steel_chest1")).toEqual({ "io red": [30, 12], "io green": [50, 12] });
  for (const name of ["steel_chest1", "fast_inserter1", "transport_belt1", "assembling_machine1", "train_stop1", "inserter1"]) {
    await expect(card(page, name)).toHaveAttribute("data-kind", "entity");
    await expect(pin(page, name, "io", "red")).toHaveAttribute("data-edge", "top");
    await expect(card(page, name).locator(".board-arrow, .board-divider")).toHaveCount(0);
  }

  // The constant sends 40 plates: the fast inserter (below 100) is enabled, the other one (above 100) is not. Entities without
  // an enable condition say nothing; all of them show what is on their networks.
  await expect(card(page, "fast_inserter1")).toHaveAttribute("data-status", "enabled");
  await expect(card(page, "inserter1")).toHaveAttribute("data-status", "disabled");
  await expect(card(page, "steel_chest1")).not.toHaveAttribute("data-status");
  await expect(card(page, "steel_chest1")).toHaveAttribute("data-in-red", "iron-plate 40");
  await expect(card(page, "train_stop1")).toHaveAttribute("data-in-green", "nothing");
  // The decider answers one tick later; the machine reads its output from then on.
  await page.getByRole("button", { name: "Step" }).click();
  await expect(card(page, "assembling_machine1")).toHaveAttribute("data-in-red", "A 1");

  await page.screenshot({ path: resolve(SHOTS, "board.png") });

  // Show Blueprint String gives the blueprint back: the same entities with their settings and with the fields the editor only kept.
  await clickMenu(app, "File", "Show Blueprint String");
  const shown = dialog(page, "Blueprint string");
  const decoded = decodeBlueprintString(await shown.getByRole("textbox", { name: "Blueprint string" }).inputValue());
  if (!decoded.ok) throw new Error(decoded.message);
  const exported = decoded.data.blueprint as typeof FACTORY.blueprint;
  expect(exported.entities).toEqual(FACTORY.blueprint.entities);
  expect(exported.wires).toEqual(FACTORY.blueprint.wires);
  expect(exported).toMatchObject({ item: "blueprint", label: "Factory", version: FACTORY.blueprint.version });
  await page.keyboard.press("Escape");
  await expect(shown).toHaveCount(0);

  // The edit canvas: the same entities as cards, named by the game, with their condition and whether it holds.
  await showDisplay(page, "edit");
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await expect(page.locator("g.card")).toHaveCount(8);
  await expect(wires(page)).toHaveCount(7);
  await expect(card(page, "fast_inserter1").locator(".card-kind")).toHaveText("FAST INSERTER");
  await expect(card(page, "fast_inserter1").locator(".card-summary")).toHaveText(["iron-plate < 100", "read-hand: hold"]);
  await expect(card(page, "fast_inserter1").locator('.card-row[data-row="conditions"]')).toHaveText("enabled");
  await expect(card(page, "inserter1").locator('.card-row[data-row="conditions"]')).toHaveText("disabled");
  await expect(card(page, "inserter1")).toHaveClass(/disabled/);
  await expect(card(page, "fast_inserter1")).not.toHaveClass(/disabled/);
  await expect(card(page, "assembling_machine1").locator(".card-kind")).toHaveText("ASSEMBLING MACHINE 2");
  await expect(card(page, "steel_chest1").locator(".card-row")).toHaveCount(2);
  expect(await pinOffsets(page, "train_stop1")).toEqual({ "io red": [80, 0], "io green": [100, 0] });
  await page.screenshot({ path: resolve(SHOTS, "edit.png") });
  // The inspector names the entity, has its settings as a form, and says what it keeps from the blueprint.
  // (Selected through the session: the cards of entities that touch in the game overlap on the edit canvas after an import.)
  await page.evaluate(() => {
    const session = window.faceSession!;
    session.commands.select([session.getState().circuit.entities.find((entity) => entity.name === "fast_inserter1")!.id]);
  });
  await expect(inspector(page).locator("h2")).toHaveText("Fast inserter");
  await expect(inspector(page).getByRole("checkbox", { name: "Enable/disable", exact: true })).toBeChecked();
  await expect(inspector(page).getByLabel("Read hand contents")).toHaveValue("hold");
  await expect(page.locator('.signal-history tr.trace[data-trace="fast_inserter1 condition"] .trace-value')).toHaveText("enabled");
  await page.evaluate(() => {
    const session = window.faceSession!;
    session.commands.select([session.getState().circuit.entities.find((entity) => entity.name === "train_stop1")!.id]);
  });
  await expect(inspector(page).locator(".kept-fields")).toHaveText("Kept from the blueprint: station, manual_trains_limit. The editor does not change these fields and writes them back on export.");
  // A train stop without a condition sends nothing and has nothing to follow.
  await expect(page.locator(".signal-history")).toContainText("an entity of the game sends nothing in the simulation");

  // More plates turn the two inserters around.
  await setSource(page, (await sourceText(page)).replace("item:iron-plate = 40", "item:iron-plate = 150"));
  await expect(card(page, "fast_inserter1")).toHaveAttribute("data-status", "disabled");
  await expect(card(page, "inserter1")).toHaveAttribute("data-status", "enabled");
  expect(errors).toEqual([]);
});

/** A rocket silo of 9 x 9 tiles, a boiler of 3 x 2 that turns, a splitter with a condition per side and a lamp. */
const YARD = `circuit "Yard" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    entity silo at (280, 80) tile (6.5, 4.5) {
        prototype = rocket-silo
    }

    entity heat at (520, 80) tile (13.5, 1) facing north {
        prototype = boiler
    }

    entity split at (760, 80) tile (13, 4.5) facing north {
        prototype = splitter
        input-left when virtual:signal-A > 0
    }

    lamp light at (1000, 80) tile (16.5, 0.5) {
        when virtual:signal-A > 0
    }

    wire red source.out <-> silo
    wire red silo <-> heat
}
`;

test("generic entities from the source stand on both canvases with their footprints and are wired at their one connection point", async ({ page }) => {
  const errors = pageErrors(page);
  await openBoardProject(page, YARD);
  await page.getByRole("button", { name: "Fit circuit" }).click();
  expect(await page.evaluate(() => window.faceSession!.getState().diagnostics.length)).toBe(0);
  expect(await footprint(page, "silo")).toMatchObject({ tile: [2, 0], size: [9, 9] });
  expect(await footprint(page, "heat")).toMatchObject({ tile: [12, 0], size: [3, 2], facing: "north" });
  expect(await footprint(page, "split")).toMatchObject({ tile: [12, 4], size: [2, 1], facing: "north" });
  expect(await pinOffsets(page, "silo")).toEqual({ "io red": [350, 12], "io green": [370, 12] });
  expect(await pinOffsets(page, "split")).toEqual({ "io red": [70, 12], "io green": [90, 12] });
  await expect(card(page, "silo")).toHaveAttribute("data-in-red", "A 1");
  await expect(card(page, "heat")).toHaveAttribute("data-in-red", "A 1");
  await expect(card(page, "light")).toHaveAttribute("data-status", "off");

  await page.screenshot({ path: resolve(SHOTS, "yard-board.png") });

  // A turn on the board: the boiler then stands 2 wide and 3 high on the same top-left tile.
  await page.evaluate(() => {
    const session = window.faceSession!;
    session.commands.rotateEntities([session.getState().circuit.entities.find((entity) => entity.name === "heat")!.id], "clockwise");
  });
  expect(await sourceText(page)).toContain("entity heat at (520, 80) tile (13, 1.5) facing east {");
  expect(await footprint(page, "heat")).toMatchObject({ tile: [12, 0], size: [2, 3], facing: "east" });

  // The wire tool on the board: from the boiler's connection point to the splitter's and on to the lamp.
  await page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Red wire" }).click();
  await clickCenter(page, pin(page, "heat", "io", "red"));
  await expect(pin(page, "heat", "io", "red")).toHaveClass(/pending/);
  await clickCenter(page, pin(page, "split", "io", "red"));
  await clickCenter(page, pin(page, "split", "io", "red"));
  await clickCenter(page, pin(page, "light", "in", "red"));
  await expect(wires(page)).toHaveCount(4);
  expect(await sourceText(page)).toContain("    wire red silo <-> heat\n    wire red heat <-> split\n    wire red split <-> light.in\n");
  // The signal passes nothing but wires: the lamp is lit, and the splitter's condition for its left input holds.
  await expect(card(page, "light")).toHaveAttribute("data-status", "lit");
  await expect(card(page, "split")).toHaveAttribute("data-in-red", "A 1");

  // The same on the edit canvas, with a green wire drawn there.
  await page.keyboard.press("Escape");
  await showDisplay(page, "edit");
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await expect(page.locator("g.card")).toHaveCount(5);
  await expect(card(page, "silo").locator(".card-kind")).toHaveText("ROCKET SILO");
  await expect(card(page, "split").locator(".card-summary")).toHaveText("input-left A > 0");
  await expect(card(page, "split").locator('.card-row[data-row="conditions"]')).toHaveText("input-left");
  await expect(card(page, "split").locator('.card-row[data-row="conditions"] .condition')).toHaveAttribute("data-holds", "true");
  await page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Green wire" }).click();
  await clickCenter(page, pin(page, "source", "out", "green"));
  await clickCenter(page, pin(page, "silo", "io", "green"));
  await expect(wires(page)).toHaveCount(5);
  expect(await sourceText(page)).toContain("    wire green source.out <-> silo\n");
  await expect(card(page, "silo")).toHaveAttribute("data-in-green", "A 1");
  expect(errors).toEqual([]);
});
