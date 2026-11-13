// Electric poles and the programmable speaker on the canvases: from the source and built with the pointer. They appear on the
// edit canvas and on the blueprint board with their wires, signals pass through the poles, a pole's one connection point is on
// both edges of its card, and the wire reach is that of the game per entity (a small pole 7.5 tiles, a big one 32, every other
// entity the reach of the project). The palette is in entitySelector.spec.ts, the speaker's form in speaker.spec.ts.
import type { Page } from "@playwright/test";
import { canvas, card, clickCenter, clientPointOf, expect, pin, selectEntity, showDisplay, sourceText, test, wire, wireKeyOf, wirePoint, wires } from "./app.ts";
import { bubble, committedTiles, dragOnBoard, footprint, inspector, openBoard, openBoardProject, pinOffsets, selectOnBoard, setSource } from "./board.ts";

/**
 * source -> p1 -> p2 -> light and the speaker, all within reach. `far` is a small pole 8.5 tiles from p1: too far for a small
 * pole. The two big poles are 18 tiles apart, twice the reach of the project and well within their own.
 */
const POLES = `circuit "Poles" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    pole p1 at (280, 80) tile (4.5, 0.5) {
    }

    pole p2 at (520, 80) tile (10.5, 0.5) {
    }

    lamp light at (760, 80) tile (14.5, 0.5) {
        when virtual:signal-A > 0
    }

    speaker alarm at (760, 300) tile (14.5, 2.5) {
        when virtual:signal-A > 0
        instrument = alarms
        note = siren
    }

    pole far at (520, 300) tile (13.5, 4.5) {
    }

    pole big1 at (40, 520) tile (1, 9) {
        prototype = big-electric-pole
    }

    pole big2 at (760, 520) tile (21, 9) {
        prototype = big-electric-pole
    }

    wire red source.out <-> p1
    wire red p1 <-> p2
    wire red p2 <-> light.in
    wire red p2 <-> alarm.in
    wire green p1 <-> far
    wire green big1 <-> big2
}
`;

const NAMES = ["source", "p1", "p2", "light", "alarm", "far", "big1", "big2"];
const TOO_LONG = "Wire from 'p1' to 'far': the entities are 8.5 tiles apart; the wire reach of a small electric pole is 7.5";
const diagnostics = (page: Page) => page.evaluate(() => window.faceSession!.getState().diagnostics.map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`));
const title = (page: Page, key: string) => wire(page, key).locator("title");

test("poles and a speaker from the source stand on both canvases, relay the signal and follow the wire reach of the game", async ({ page }) => {
  await openBoardProject(page, POLES);
  await page.getByRole("button", { name: "Fit circuit" }).click();

  // The source is valid; the one finding is the wire to the small pole that is too far away, with the pole's own reach.
  expect(await diagnostics(page)).toEqual([`warning wire-too-long: ${TOO_LONG}`]);
  await expect(page.locator("g.wire")).toHaveCount(6);

  // On the board every entity covers the tiles of its prototype: a big pole two by two. A pole has no direction: its pins
  // are in the middle of the top end of its footprint, red left of green and green a little lower.
  for (const name of NAMES) await expect(card(page, name)).toBeVisible();
  expect((await footprint(page, "p1")).size).toEqual([1, 1]);
  expect(await footprint(page, "big1")).toMatchObject({ tile: [0, 8], size: [2, 2] });
  expect(await footprint(page, "big2")).toMatchObject({ tile: [20, 8], size: [2, 2] });
  expect(await footprint(page, "alarm")).toMatchObject({ tile: [14, 2], size: [1, 1] });
  expect(await pinOffsets(page, "big1")).toEqual({ "io red": [70, 12], "io green": [90, 22] });
  expect(await pinOffsets(page, "p1")).toEqual({ "io red": [30, 12], "io green": [50, 22] });
  expect(await pinOffsets(page, "alarm")).toEqual({ "in red": [12, 30], "in green": [12, 50] });
  for (const name of ["p1", "big1"]) {
    await expect(card(page, name).locator(".board-arrow, .board-divider")).toHaveCount(0);
    await expect(pin(page, name, "io", "red")).toHaveAttribute("data-edge", "top");
    await expect(pin(page, name, "io", "red").locator("title")).toHaveText("Red connection");
  }
  await expect(card(page, "p1")).toHaveAttribute("data-kind", "pole");
  await expect(card(page, "alarm")).toHaveAttribute("data-kind", "speaker");

  // The lamp is lit through the two poles without a tick passing, and the speaker plays; a pole shows the network it joins.
  await expect(card(page, "light")).toHaveAttribute("data-status", "lit");
  await expect(card(page, "alarm")).toHaveAttribute("data-status", "playing alarms siren");
  await expect(card(page, "alarm")).toHaveClass(/active/);
  await expect(card(page, "alarm").locator(".board-led")).toHaveClass(/on/);
  await expect(card(page, "alarm").locator(".board-glow")).toHaveCount(1);
  // A pole only joins networks: it has no state to report.
  await expect(card(page, "p2")).not.toHaveAttribute("data-status");
  await expect(card(page, "p2")).toHaveAttribute("data-in-red", "A 1");
  await expect(card(page, "far")).toHaveAttribute("data-in-green", "nothing");
  await expect(card(page, "far")).toHaveAttribute("data-in-red", "no wire");

  // The wire reach. Within 7.5 tiles of a small pole: no flag. 8.5 tiles to a small pole: flagged, with the pole named.
  const [near, relay, tooFar, between] = await Promise.all([
    wireKeyOf(page, "red", "source.out", "p1"),
    wireKeyOf(page, "red", "p1", "p2"),
    wireKeyOf(page, "green", "p1", "far"),
    wireKeyOf(page, "green", "big1", "big2"),
  ]);
  await expect(page.locator("g.wire[data-too-long]")).toHaveCount(1);
  await expect(wire(page, tooFar)).toHaveAttribute("data-too-long", "true");
  expect(await title(page, tooFar).textContent()).toBe("green: p1 <-> far (8.5 tiles apart, over the wire reach of a small electric pole, 7.5)");
  await expect(wire(page, near)).not.toHaveAttribute("data-too-long");
  expect(await title(page, near).textContent()).toBe("red: source.out <-> p1 (3 tiles apart)");
  expect(await title(page, relay).textContent()).toBe("red: p1 <-> p2 (5 tiles apart)");
  // Two big poles span more than the 9 tiles of the project: their own reach is 32.
  await expect(wire(page, between)).not.toHaveAttribute("data-too-long");
  expect(await title(page, between).textContent()).toBe("green: big1 <-> big2 (18 tiles apart)");

  // The inspector of a wire says which reach applied.
  const distance = inspector(page).locator(".wire-distance");
  const select = async (key: string): Promise<void> => {
    const point = await wirePoint(page, key);
    await page.mouse.click(point.x, point.y);
    await expect(wire(page, key)).toHaveClass(/selected/);
  };
  await select(tooFar);
  await expect(distance).toHaveAttribute("data-too-long", "true");
  await expect(distance.locator(".section-label")).toHaveText("DistanceReach 7.5");
  await expect(distance.locator("p").first()).toHaveText("The two entities are 8.5 tiles apart");
  await expect(distance.locator(".wire-reach-source")).toContainText("The wire reach of a small electric pole is 7.5");
  await expect(distance.getByRole("status")).toContainText("Further apart than the wire reach.");
  await expect(inspector(page).locator(".wire-end small")).toHaveText(["connection", "connection"]);
  await select(between);
  await expect(distance).not.toHaveAttribute("data-too-long");
  await expect(distance.locator(".section-label")).toHaveText("DistanceReach 32");
  await expect(distance.locator(".wire-reach-source")).toContainText("The wire reach of a big electric pole is 32");
  await select(near);
  await expect(distance.locator(".section-label")).toHaveText("DistanceReach 7.5");

  // The edit canvas shows the same entities as cards with their wires; nothing is flagged there.
  await showDisplay(page, "edit");
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await expect(page.locator("g.card")).toHaveCount(NAMES.length);
  await expect(page.locator("g.wire")).toHaveCount(6);
  await expect(page.locator("g.wire[data-too-long]")).toHaveCount(0);
  // The one connection point of a pole is on both edges of its card, red and green on each.
  await expect(card(page, "big1").locator("g.pin")).toHaveCount(4);
  await expect(card(page, "light")).toHaveAttribute("data-status", "lit");
  await expect(card(page, "alarm")).toHaveAttribute("data-status", "playing alarms siren");
  // The cards: which pole it is in the heading, its reach and tiles below the name; the speaker with what it plays and when.
  await expect(card(page, "big1").locator(".card-kind")).toHaveText("BIG ELECTRIC POLE");
  await expect(card(page, "big1").locator(".card-summary")).toHaveText("reach 32 · 2x2");
  await expect(card(page, "p1").locator(".card-kind")).toHaveText("SMALL ELECTRIC POLE");
  await expect(card(page, "p1").locator(".card-summary")).toHaveText("reach 7.5 · 1x1");
  await expect(card(page, "p1").locator('.card-row[data-row="red"] .row-value')).toHaveText("1");
  await expect(card(page, "p1").locator(".card-row")).toHaveCount(2);
  await expect(card(page, "alarm").locator(".card-kind")).toHaveText("SPEAKER");
  await expect(card(page, "alarm").locator(".card-summary")).toHaveText(["alarms siren", "when A > 0"]);
  await expect(card(page, "alarm").locator('.card-row[data-row="speaker"]')).toHaveText("playing alarms siren");
  await expect(card(page, "alarm").locator('.card-row[data-row="speaker"]')).toHaveClass(/playing/);
  expect(await title(page, tooFar).textContent()).toBe("green: p1 <-> far");

  // A pole and a speaker can be selected; the inspector names them. A pole has no trace in the dock, a speaker has one.
  await selectEntity(page, "big1");
  await expect(inspector(page).locator("h2")).toHaveText("Big electric pole");
  await expect(inspector(page).getByRole("group", { name: "Pole" }).getByRole("button", { pressed: true })).toHaveText(/Big electric pole/);
  await expect(page.locator("tr.trace")).toHaveCount(0);
  await expect(page.locator(".signal-history")).toContainText("a pole only passes signals on");
  await expect(page.locator(".signal-history")).not.toContainText("no output");
  await selectEntity(page, "alarm");
  await expect(inspector(page).locator("h2")).toHaveText("Speaker");
  await expect(page.locator("tr.trace")).toHaveCount(1);
  await expect(page.locator("tr.trace")).toHaveAttribute("data-trace", "alarm sound");
  await expect(page.locator("tr.trace .trace-value")).toHaveText("playing alarms siren");
  await expect(page.locator("tr.trace")).toHaveClass(/lit/);
  // The connections of a pole are connections, not inputs or outputs.
  await selectEntity(page, "p1");
  await expect(inspector(page).locator(".connection small")).toHaveText(["red, connection", "red, connection", "green, connection"]);
  expect(await diagnostics(page)).toEqual([`warning wire-too-long: ${TOO_LONG}`]);
});

const EMPTY = 'circuit "Chain" {\n}\n';

test("a chain constant -> pole -> pole -> lamp built with the palette and the wire tool lights the lamp", async ({ page }) => {
  await setSource(page, EMPTY);
  const palette = page.getByRole("complementary", { name: "Components" });
  const entry = (prototype: string) => palette.locator(`.palette-item[data-prototype="${prototype}"]`);
  const hint = page.locator(".canvas-hint");
  const place = async (prototype: string, x: number): Promise<void> => {
    await entry(prototype).click();
    const point = await clientPointOf(page, { x: x + 92, y: 264 });
    await page.mouse.click(point.x, point.y);
  };
  await page.getByRole("button", { name: "Zoom out" }).click();
  await palette.locator(".palette-group-header", { hasText: "Power poles" }).click();

  // Four entities in a row, each configured with the pointer where it needs it.
  await place("constant-combinator", 0);
  await inspector(page).getByRole("button", { name: "Add signal" }).click();
  await place("small-electric-pole", 260);
  await place("medium-electric-pole", 520);
  await place("small-lamp", 780);
  await inspector(page).getByLabel("Controlled by the circuit network").check();
  await expect(page.locator("g.card")).toHaveCount(4);
  await expect(card(page, "lamp1")).toHaveAttribute("data-status", "off");

  // The wire tool: a pole offers its one connection point on both edges.
  await page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Red wire" }).click();
  await expect(hint).toHaveText("Click a red pin of an entity to start a red wire.");
  for (const edge of ["left", "right"] as const) await expect(pin(page, "pole1", "io", "red", edge).locator("title")).toHaveText("Red connection");
  // Into the pole on its left edge.
  await clickCenter(page, pin(page, "constant1", "out", "red"));
  await expect(pin(page, "constant1", "out", "red")).toHaveClass(/pending/);
  await clickCenter(page, pin(page, "pole1", "io", "red", "left"));
  await expect(wires(page)).toHaveCount(1);
  // On from its right edge. While the wire is pending both pins of the point light up: they are one and the same point.
  await clickCenter(page, pin(page, "pole1", "io", "red", "right"));
  await expect(card(page, "pole1").locator("g.pin.pending")).toHaveCount(2);
  await clickCenter(page, pin(page, "pole2", "io", "red", "left"));
  await clickCenter(page, pin(page, "pole2", "io", "red", "right"));
  await clickCenter(page, pin(page, "lamp1", "in", "red"));
  await expect(wires(page)).toHaveCount(3);
  expect(await sourceText(page)).toContain("    wire red constant1.out <-> pole1\n    wire red pole1 <-> pole2\n    wire red pole2 <-> lamp1.in\n");

  // The signal passes both poles without a tick: the lamp is lit, and each pole shows it on its red network.
  await expect(card(page, "lamp1")).toHaveAttribute("data-status", "lit");
  for (const name of ["pole1", "pole2"]) {
    await expect(card(page, name)).toHaveAttribute("data-in-red", "A 1");
    await expect(card(page, name)).toHaveAttribute("data-in-green", "no wire");
  }

  // The chain runs from left to right in straight lines: out of a right edge, into the left edge of the next card.
  const paths = await page.locator("g.wire path.wire-core").evaluateAll((cores) => cores.map((core) => core.getAttribute("d")));
  expect(paths).toEqual(["M 184 260 L 260 260", "M 444 260 L 520 260", "M 704 260 L 780 260"]);

  // A wire may be started from either edge: which one is clicked does not decide where it attaches. Green, from the far
  // edges of both poles, still takes the short way between them.
  await page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Green wire" }).click();
  await clickCenter(page, pin(page, "pole2", "io", "green", "right"));
  await clickCenter(page, pin(page, "pole1", "io", "green", "left"));
  await expect(wires(page)).toHaveCount(4);
  expect(await sourceText(page)).toContain("    wire green pole2 <-> pole1\n");
  expect(await wire(page, await wireKeyOf(page, "green", "pole1", "pole2")).locator("path.wire-core").getAttribute("d")).toBe("M 444 280 L 520 280");
  // The same two pins again take the wire away, as between any two terminals; a click on the two edges of one pole connects nothing.
  await clickCenter(page, pin(page, "pole1", "io", "green", "right"));
  await clickCenter(page, pin(page, "pole2", "io", "green", "left"));
  await expect(wires(page)).toHaveCount(3);
  await clickCenter(page, pin(page, "pole1", "io", "green", "left"));
  await clickCenter(page, pin(page, "pole1", "io", "green", "right"));
  await expect(wires(page)).toHaveCount(3);
  await expect(card(page, "pole1").locator("g.pin.pending")).toHaveCount(0);

  // Moved below the first pole, the second one is wired on the side the two share, without a line around a card.
  await page.keyboard.press("q");
  await page.evaluate(() => {
    const session = window.faceSession!;
    const pole = session.getState().circuit.entities.find((entity) => entity.name === "pole2")!;
    session.commands.moveEntities([{ id: pole.id, position: { x: 260, y: 400 } }]);
  });
  const down = await wire(page, await wireKeyOf(page, "red", "pole1", "pole2")).locator("path.wire-core").getAttribute("d");
  expect(down).toMatch(/^M 260 260 L /);
  expect(down).toMatch(/ L 260 460$/);
  await expect(card(page, "lamp1")).toHaveAttribute("data-status", "lit");

  // The same on the board, with real pointer input on the pins at the top of the poles.
  await setSource(page, EMPTY);
  await showDisplay(page, "blueprint");
  await canvas(page).focus();
  for (const [prototype, x] of [["constant-combinator", 0], ["small-electric-pole", 3], ["big-electric-pole", 6], ["small-lamp", 10]] as const) {
    await entry(prototype).click();
    const size = prototype === "big-electric-pole" ? 2 : 1;
    const point = await clientPointOf(page, { x: (x + size / 2) * 80, y: (2 + size / 2) * 80 });
    await page.mouse.click(point.x, point.y);
    if (prototype === "constant-combinator") await inspector(page).getByRole("button", { name: "Add signal" }).click();
    if (prototype === "small-lamp") await inspector(page).getByLabel("Controlled by the circuit network").check();
  }
  expect(await committedTiles(page)).toEqual({ constant1: [0.5, 2.5], pole1: [3.5, 2.5], pole2: [7, 3], lamp1: [10.5, 2.5] });
  await page.getByRole("button", { name: "Fit circuit" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name: "Red wire" }).click();
  for (const [from, to] of [[pin(page, "constant1", "out", "red"), pin(page, "pole1", "io", "red")], [pin(page, "pole1", "io", "red"), pin(page, "pole2", "io", "red")], [pin(page, "pole2", "io", "red"), pin(page, "lamp1", "in", "red")]] as const) {
    await clickCenter(page, from);
    await clickCenter(page, to);
  }
  await expect(wires(page)).toHaveCount(3);
  await expect(card(page, "lamp1")).toHaveAttribute("data-status", "lit");
  await expect(page.locator("g.wire[data-too-long]")).toHaveCount(0);
});

/** A big pole and a substation with a lamp in reach of a drag, and a wire of each color. */
const SQUARES = `circuit "Squares" {
    constant source at (40, 300) tile (0.5, 3.5) {
        virtual:signal-A = 1
    }

    pole big at (40, 80) tile (1, 1) {
        prototype = big-electric-pole
    }

    lamp light at (300, 80) tile (3.5, 0.5) {
        when virtual:signal-A > 0
    }

    pole station at (560, 300) tile (6, 4) {
        prototype = substation
    }

    wire red source.out <-> big
    wire red big <-> light.in
    wire green big <-> station
}
`;

test("a 2x2 pole on the board: selection, bubble, drag onto free and onto taken tiles, conflicts from the source", async ({ page }) => {
  await openBoard(page, SQUARES);
  expect(await footprint(page, "big")).toEqual({ tile: [0, 0], size: [2, 2], facing: "east", placed: "true" });
  expect(await footprint(page, "station")).toEqual({ tile: [5, 3], size: [2, 2], facing: "east", placed: "true" });
  await expect(card(page, "light")).toHaveAttribute("data-status", "lit");
  await expect(page.locator("g.card.conflict")).toHaveCount(0);

  // Selected, it has the outline of a selected entity around all four tiles and its card in the bubble beside it.
  await selectOnBoard(page, "big");
  const body = await card(page, "big").locator(".card-body").evaluate((rect) => ({ width: Number(rect.getAttribute("width")), height: Number(rect.getAttribute("height")), stroke: getComputedStyle(rect).stroke }));
  expect([body.width, body.height]).toEqual([152, 152]);
  expect(body.stroke).toBe(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().replace(/^#(..)(..)(..)$/, (_, r: string, g: string, b: string) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`)));
  await expect(bubble(page)).toHaveAttribute("data-entity-name", "big");
  await expect(bubble(page).locator(".card-kind")).toHaveText("BIG ELECTRIC POLE");
  await expect(bubble(page).locator(".card-summary")).toHaveText("reach 32 · 2x2");
  await expect(bubble(page).locator('.card-row[data-row="red"] .row-value')).toHaveText("1");
  // The bubble stands beside the footprint, not on it.
  const [bubbleBox, entityBox] = [(await bubble(page).boundingBox())!, (await card(page, "big").locator(".card-body").boundingBox())!];
  expect(bubbleBox.x >= entityBox.x + entityBox.width || bubbleBox.x + bubbleBox.width <= entityBox.x || bubbleBox.y >= entityBox.y + entityBox.height || bubbleBox.y + bubbleBox.height <= entityBox.y).toBe(true);
  // The inspector says where it stands by the center of its four tiles.
  await expect(inspector(page).locator(".inspector-footer")).toHaveText("Tile X 1 Y 1");

  // Dragged two tiles to the right it would cover the tile of the lamp: blocked while it hangs there, and the drop changes nothing.
  await dragOnBoard(page, "big", { x: 2, y: 0 }, async () => {
    await expect(card(page, "big")).toHaveAttribute("data-blocked", "true");
    await expect(card(page, "big")).toHaveAttribute("data-tile-x", "2");
    await expect(card(page, "light")).toHaveAttribute("data-conflict", "true");
    await expect(bubble(page)).toHaveCount(0);
  });
  expect((await committedTiles(page)).big).toEqual([1, 1]);
  expect(await sourceText(page)).toBe(SQUARES);
  await expect(page.locator("g.card.conflict, g.card.blocked")).toHaveCount(0);
  // One tile down and one to the right is free: all four tiles move, and the wires follow the pins.
  await dragOnBoard(page, "big", { x: 1, y: 1 }, async () => {
    await expect(card(page, "big")).not.toHaveAttribute("data-blocked");
    await expect(card(page, "big")).toHaveClass(/moving/);
  });
  expect((await committedTiles(page)).big).toEqual([2, 2]);
  expect(await footprint(page, "big")).toMatchObject({ tile: [1, 1], size: [2, 2] });
  expect(await sourceText(page)).toContain("pole big at (40, 80) tile (2, 2) {");
  await expect(card(page, "light")).toHaveAttribute("data-status", "lit");
  // The arrow keys move it by whole tiles; a step onto the substation is refused.
  await page.keyboard.press("ArrowDown");
  expect((await committedTiles(page)).big).toEqual([2, 3]);
  await page.keyboard.press("Shift+ArrowRight");
  expect((await committedTiles(page)).big).toEqual([2, 3]);
  // It does not turn: the keys and the menu leave it alone, and the inspector offers no Facing.
  await page.keyboard.press("r");
  await expect(card(page, "big")).toHaveAttribute("data-facing", "east");
  await expect(inspector(page).getByRole("group", { name: "Facing" })).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveCount(0);

  // From the source: two 2x2 poles that share one tile are both in conflict, and a center off the grid for 2x2 is one too.
  await setSource(page, SQUARES.replace("tile (6, 4)", "tile (2, 2)"));
  await expect(card(page, "big")).toHaveAttribute("data-conflict", "true");
  await expect(card(page, "station")).toHaveAttribute("data-conflict", "true");
  await expect(card(page, "light")).not.toHaveAttribute("data-conflict");
  expect((await diagnostics(page)).map((line) => line.replace(/;.*/, ""))).toEqual(["warning tile-overlap: Stands on a tile that 'station' stands on as well", "warning tile-overlap: Stands on a tile that 'big' stands on as well"]);
  await setSource(page, SQUARES.replace("tile (6, 4)", "tile (6.5, 4)"));
  await expect(card(page, "station")).toHaveAttribute("data-conflict", "true");
  expect((await diagnostics(page))[0]).toMatch(/^warning tile-off-grid: /);
  // Dragging repairs it: the drop puts the pole on whole tiles.
  await dragOnBoard(page, "station", { x: 1, y: 0 });
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  expect(await diagnostics(page)).toEqual([]);
});

/** A small pole 8.49 tiles from the constant (six tiles in each direction; shown as 8.5) with a lamp on the tile beside it. */
const REACH = `circuit "Reach" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    pole p at (300, 80) tile (7.5, 7.5) {
    }

    lamp light at (560, 80) tile (8.5, 7.5) {
        when virtual:signal-A > 0
    }

    wire red source.out <-> p
    wire red p <-> light.in
}
`;

test("the inspector chooses which pole it is: the footprint and the wire reach follow, and a change onto a taken tile is refused on the board", async ({ page }) => {
  await openBoard(page, REACH);
  const choice = inspector(page).getByRole("group", { name: "Pole" });
  const option = (name: string) => choice.getByRole("button", { name: new RegExp(`^${name}`) });
  const pressed = () => choice.getByRole("button", { pressed: true });
  const toast = page.locator(".toast");
  const far = await wireKeyOf(page, "red", "source.out", "p");

  // Four options with icon, tiles and reach; the one the pole is is pressed.
  await selectOnBoard(page, "p");
  await expect(inspector(page).locator(".eyebrow")).toHaveText("Signal relay");
  await expect(inspector(page).locator("h2")).toHaveText("Small electric pole");
  await expect(choice.getByRole("button")).toHaveText(["Small electric pole1 tile, wire reach 7.5", "Medium electric pole1 tile, wire reach 9", "Big electric pole2 x 2 tiles, wire reach 32", "Substation2 x 2 tiles, wire reach 18"]);
  await expect(choice.locator(".entity-icon")).toHaveCount(4);
  await expect(pressed()).toHaveText(/^Small electric pole/);
  await expect(inspector(page)).toContainText("A pole relays signals");
  // A pole has no description in the game; the box says so.
  await expect(inspector(page).getByLabel("Description")).toHaveAttribute("title", "A small electric pole has no description in the game. This text stays in the project.");

  // The reach of the small pole is 7.5: the wire to the constant, 8.5 tiles away, is flagged.
  await expect(wire(page, far)).toHaveAttribute("data-too-long", "true");
  expect(await title(page, far).textContent()).toBe("red: source.out <-> p (8.5 tiles apart, over the wire reach of a small electric pole, 7.5)");
  expect(await diagnostics(page)).toEqual(["warning wire-too-long: Wire from 'source.out' to 'p': the entities are 8.5 tiles apart; the wire reach of a small electric pole is 7.5"]);

  // A medium pole reaches 9: the flag goes with the choice. Same tile, same size.
  await option("Medium electric pole").click();
  await expect(pressed()).toHaveText(/^Medium electric pole/);
  await expect(inspector(page).locator("h2")).toHaveText("Medium electric pole");
  expect(await sourceText(page)).toContain("    pole p at (300, 80) tile (7.5, 7.5) {\n        prototype = medium-electric-pole\n    }\n");
  await expect(wire(page, far)).not.toHaveAttribute("data-too-long");
  expect(await title(page, far).textContent()).toBe("red: source.out <-> p (8.5 tiles apart)");
  expect(await diagnostics(page)).toEqual([]);
  expect(await footprint(page, "p")).toMatchObject({ tile: [7, 7], size: [1, 1] });
  await expect(bubble(page).locator(".card-kind")).toHaveText("MEDIUM ELECTRIC POLE");

  // A big pole would cover the tile of the lamp beside it: refused and reported, like a refused turn. Nothing changed.
  const medium = await sourceText(page);
  await option("Big electric pole").click();
  await expect(toast).toHaveText("Not changed: p would stand on a tile of light.");
  await expect(pressed()).toHaveText(/^Medium electric pole/);
  expect(await sourceText(page)).toBe(medium);
  await option("Substation").click();
  await expect(toast).toHaveText("Not changed: p would stand on a tile of light.");
  expect(await sourceText(page)).toBe(medium);
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  expect(await footprint(page, "p")).toMatchObject({ size: [1, 1] });
  // The message is about the selected pole: it goes with another selection.
  await selectOnBoard(page, "light");
  await expect(toast).toHaveCount(0);

  // With the lamp two tiles further away the change goes through: the pole keeps its top-left tile and covers four.
  await dragOnBoard(page, "light", { x: 2, y: 0 });
  expect((await committedTiles(page)).light).toEqual([10.5, 7.5]);
  await selectOnBoard(page, "p");
  await option("Big electric pole").click();
  await expect(toast).toHaveCount(0);
  await expect(pressed()).toHaveText(/^Big electric pole/);
  expect(await footprint(page, "p")).toMatchObject({ tile: [7, 7], size: [2, 2] });
  expect(await sourceText(page)).toContain("    pole p at (300, 80) tile (8, 8) {\n        prototype = big-electric-pole\n    }\n");
  expect(await pinOffsets(page, "p")).toEqual({ "io red": [70, 12], "io green": [90, 22] });
  await expect(inspector(page).locator(".inspector-footer")).toHaveText("Tile X 8 Y 8");
  await expect(page.locator("g.card.conflict")).toHaveCount(0);
  await expect(card(page, "light")).toHaveAttribute("data-status", "lit");

  // The wire to the constant now has the reach of the project, the smaller one of its two ends; the inspector says so.
  const point = await wirePoint(page, far);
  await page.mouse.click(point.x, point.y);
  const distance = inspector(page).locator(".wire-distance");
  await expect(distance.locator(".section-label")).toHaveText("DistanceReach 9");
  await expect(distance.locator(".wire-reach-source")).toHaveText("The wire reach of the project is 9. It is the smaller reach of the two ends: a big electric pole reaches 32.");
  await expect(distance).not.toHaveAttribute("data-too-long");
  await expect(inspector(page).locator(".wire-end small")).toHaveText(["output", "connection"]);

  // One undo step takes back the prototype and the tile together.
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await sourceText(page)).toContain("    pole p at (300, 80) tile (7.5, 7.5) {\n        prototype = medium-electric-pole\n    }\n");
  expect(await footprint(page, "p")).toMatchObject({ tile: [7, 7], size: [1, 1] });

  // On the edit canvas nothing is refused, as for a turn there: the overlap is a warning of the source.
  await page.getByRole("button", { name: "Undo" }).click();
  expect((await committedTiles(page)).light).toEqual([8.5, 7.5]);
  await showDisplay(page, "edit");
  await selectEntity(page, "p");
  await option("Substation").click();
  await expect(toast).toHaveCount(0);
  await expect(card(page, "p").locator(".card-kind")).toHaveText("SUBSTATION");
  await expect(card(page, "p").locator(".card-summary")).toHaveText("reach 18 · 2x2");
  expect(await sourceText(page)).toContain("    pole p at (300, 80) tile (8, 8) {\n        prototype = substation\n    }\n");
  expect((await diagnostics(page)).map((line) => line.split(":")[0])).toEqual(["warning tile-overlap", "warning tile-overlap"]);
});
