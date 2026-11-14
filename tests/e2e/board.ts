// What the specs of the blueprint board share: a circuit with every kind on its tile, and how to read and reach the board.
import type { Page } from "@playwright/test";
import { boardGrabPoint, canvasView, card, displaySwitch, expect, openProject, showDisplay, sourceText, writeProject, type Point } from "./app.ts";

export const TILE = 80;

/** Every kind with a `tile`, the 2x1 entities in all four directions; ids follow declaration order. */
export const BOARD = `circuit "Board" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    decider gate at (300, 80) tile (3, 0.5) {
        description = "Counts up to ten.\\nThe green wire feeds the output back."
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    arithmetic twice at (300, 260) tile (5.5, 1) facing south {
        virtual:signal-B = virtual:signal-A[red] * 2
    }

    selector pick at (560, 260) tile (3, 2.5) facing west {
        operation = select
        order = min
        index = virtual:signal-I
    }

    decider check at (40, 260) tile (0.5, 3) facing north {
        when virtual:signal-A > 3
        output virtual:signal-C = 1
    }

    lamp light at (560, 80) tile (7.5, 0.5) {
        when virtual:signal-B > 8
    }

    wire red source.out <-> gate.in
    wire green gate.out <-> gate.in
    wire red gate.out <-> twice.in
    wire green twice.out <-> light.in
    wire red twice.out <-> pick.in
}
`;

export const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });
export const menu = (page: Page) => page.getByRole("menu", { name: "Canvas actions" });
export const tool = (page: Page, name: string) => page.getByRole("group", { name: "Canvas tools" }).getByRole("button", { name });
export const display = (page: Page, name: "Edit" | "Blueprint") => displaySwitch(page).getByRole("button", { name });
export const bubble = (page: Page) => page.locator(".entity-bubble");
export const placeAll = (page: Page) => page.getByRole("button", { name: /^Place all/ });
export const zoom = async (page: Page) => Number(await page.locator(".canvas").getAttribute("data-zoom"));

export async function setSource(page: Page, source: string): Promise<void> {
  await page.evaluate((text) => window.faceSession!.commands.setSource(text), source);
  await expect.poll(() => sourceText(page)).toBe(source);
}

/** The board with `source` on it, fitted. */
export async function openBoard(page: Page, source = BOARD): Promise<void> {
  await setSource(page, source);
  await showDisplay(page, "blueprint");
  await page.getByRole("button", { name: "Fit circuit" }).click();
}

/** The board with `source` on it as a saved project: nothing to undo and no unsaved changes. */
export async function openBoardProject(page: Page, source = BOARD): Promise<void> {
  await openProject(page, await writeProject({ name: "Board", source }));
  await showDisplay(page, "blueprint");
  await expect(page.locator("g.card.board-entity")).toHaveCount((source.match(/^ {4}(constant|arithmetic|decider|selector|lamp|pole|speaker) /gm) ?? []).length);
}

export interface Footprint {
  /** Top-left tile. */
  readonly tile: readonly [number, number];
  /** Tiles covered, as width and height. */
  readonly size: readonly [number, number];
  readonly facing: string | null;
  readonly placed: string | null;
}

/** What the board says about an entity: its tile attributes and the size of its body in tiles. */
export async function footprint(page: Page, name: string): Promise<Footprint> {
  return card(page, name).evaluate((group, tileSize) => {
    const body = group.querySelector(".card-body")!;
    const inset = Number(body.getAttribute("x"));
    const tiles = (attribute: string): number => (Number(body.getAttribute(attribute)) + 2 * inset) / tileSize;
    return { tile: [Number(group.getAttribute("data-tile-x")), Number(group.getAttribute("data-tile-y"))], size: [tiles("width"), tiles("height")], facing: group.getAttribute("data-facing"), placed: group.getAttribute("data-placed") };
  }, TILE);
}

/** Where the pins of an entity are drawn, in canvas units relative to the top-left corner of its footprint. */
export async function pinOffsets(page: Page, name: string): Promise<Record<string, [number, number]>> {
  return card(page, name)
    .locator("g.pin")
    .evaluateAll((pins) => Object.fromEntries(pins.map((element) => [`${element.getAttribute("data-terminal")} ${element.getAttribute("data-wire-color")}`, [Number(element.querySelector(".pin-dot")!.getAttribute("cx")), Number(element.querySelector(".pin-dot")!.getAttribute("cy"))]])));
}

export async function selectOnBoard(page: Page, name: string): Promise<void> {
  const point = await boardGrabPoint(page, name);
  await page.mouse.click(point.x, point.y);
  await expect(card(page, name)).toHaveClass(/selected/);
}

/** Rests the pointer on an entity of the board, at a corner of its footprint, and waits for its bubble. */
export async function hoverOnBoard(page: Page, name: string): Promise<void> {
  const point = await boardGrabPoint(page, name);
  await page.mouse.move(point.x, point.y, { steps: 2 });
  await expect(bubble(page)).toHaveAttribute("data-entity-name", name);
}

/** A point of the board on which nothing stands: the middle of a tile, in window coordinates. */
export async function tilePoint(page: Page, x: number, y: number): Promise<Point> {
  const view = await canvasView(page);
  return { x: view.box.x + ((x + 0.5) * TILE - view.origin.x) * view.zoom, y: view.box.y + ((y + 0.5) * TILE - view.origin.y) * view.zoom };
}


/**
 * Drags an entity of the board by `tiles` whole tiles with real pointer input. `during` runs with the button still down, at the
 * place of the drop.
 */
export async function dragOnBoard(page: Page, name: string, tiles: Point, during?: () => Promise<void>): Promise<void> {
  const grab = await boardGrabPoint(page, name);
  const { zoom: scale } = await canvasView(page);
  const to = { x: grab.x + tiles.x * TILE * scale, y: grab.y + tiles.y * TILE * scale };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move((grab.x + to.x) / 2, (grab.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await during?.();
  await page.mouse.up();
}

/** The `tile` of every entity as the session holds it, by name; null for an entity without one. */
export async function committedTiles(page: Page): Promise<Record<string, [number, number] | null>> {
  return page.evaluate(() =>
    Object.fromEntries(
      window.faceSession!.getState().circuit.entities.map((entity) => {
        const tile = entity.placement?.tile;
        return [entity.name, tile ? [tile.x, tile.y] : null];
      }),
    ),
  );
}
