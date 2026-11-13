// Electric poles and the programmable speaker, written in the source: they appear on the edit canvas and on the blueprint
// board with their wires, signals pass through the poles, and the wire reach is that of the game per entity (a small pole 7.5
// tiles, a big one 32, every other entity the reach of the project).
import type { Page } from "@playwright/test";
import { card, expect, selectEntity, showDisplay, test, wire, wireKeyOf, wirePoint } from "./app.ts";
import { footprint, inspector, openBoardProject, pinOffsets } from "./board.ts";

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

  // On the board every entity covers the tiles of its prototype: a big pole two by two, with its pins on the west edge.
  for (const name of NAMES) await expect(card(page, name)).toBeVisible();
  expect((await footprint(page, "p1")).size).toEqual([1, 1]);
  expect(await footprint(page, "big1")).toMatchObject({ tile: [0, 8], size: [2, 2] });
  expect(await footprint(page, "big2")).toMatchObject({ tile: [20, 8], size: [2, 2] });
  expect(await footprint(page, "alarm")).toMatchObject({ tile: [14, 2], size: [1, 1] });
  expect(await pinOffsets(page, "big1")).toEqual({ "io red": [12, 70], "io green": [12, 90] });
  await expect(card(page, "p1")).toHaveAttribute("data-kind", "pole");
  await expect(card(page, "alarm")).toHaveAttribute("data-kind", "speaker");

  // The lamp is lit through the two poles without a tick passing, and the speaker plays; a pole shows the network it joins.
  await expect(card(page, "light")).toHaveAttribute("data-status", "lit");
  await expect(card(page, "alarm")).toHaveAttribute("data-status", "playing siren");
  await expect(card(page, "p2")).toHaveAttribute("data-status", "relay");
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
  await expect(card(page, "big1").locator("g.pin")).toHaveCount(2);
  await expect(card(page, "light")).toHaveAttribute("data-status", "lit");
  await expect(card(page, "alarm")).toHaveAttribute("data-status", "playing siren");
  expect(await title(page, tooFar).textContent()).toBe("green: p1 <-> far");

  // A pole and a speaker can be selected; the inspector names them and offers no broken form.
  await selectEntity(page, "big1");
  await expect(inspector(page)).toContainText("This is a big electric pole.");
  await selectEntity(page, "alarm");
  await expect(inspector(page)).toContainText("programmable speaker");
  expect(await diagnostics(page)).toEqual([`warning wire-too-long: ${TOO_LONG}`]);
});
