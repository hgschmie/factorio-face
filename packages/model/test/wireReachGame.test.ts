// Fixture F-24: what the game itself says about wire reach (tests/fixtures/game/F-24-wire-reach.json, recorded by
// tools/game-probe/wire-reach.mjs). Every placement of every case must get the game's verdict: by the rule alone from what the
// recording says of the two entities (their selection boxes as they stand, or their centers when both are poles), and from the
// editor's own entities with the box, the direction and the reach each of them has.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  boxDistance, canRotate, DEFAULT_WIRE_REACH, isPrototypeName, PROTOTYPES, selectionBox, tileCenter, tileSize, wireSpan, type BoxEdges, type Direction, type PlacedShape, type Point, type TileBox,
} from "../src/index.ts";

interface ProbedEntity {
  readonly name: string;
  /** The game's prototype type. */
  readonly type: string;
  readonly width: number;
  readonly height: number;
  /** The direction the entity has in the game; none: north. */
  readonly facing?: Direction;
  /** What the probe asked for, where the game did not give it: the entity has no direction. */
  readonly asked?: Direction;
  readonly reach: number;
  /** Of the prototype, facing north, around its center. */
  readonly selectionBox: BoxEdges;
}

interface ReachCase {
  readonly label: string;
  readonly a: ProbedEntity;
  readonly b: ProbedEntity;
  readonly reach: number;
  /** Its own range, where it is not the fixture's. */
  readonly range?: number;
  readonly rows: readonly string[];
}

interface ReachFixture {
  readonly gameVersion: string;
  readonly range: number;
  readonly cases: readonly ReachCase[];
}

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/game/F-24-wire-reach.json", import.meta.url), "utf8")) as ReachFixture;

/**
 * The editor's entity for a probed one with its top-left tile on `origin`, facing as it does in the game, or with `asked` as the
 * probe asked for; undefined for a prototype the editor does not have.
 */
function entityOf(probed: ProbedEntity, origin: Point, asked = false): PlacedShape | undefined {
  if (!isPrototypeName(probed.name)) return undefined;
  const shape = { prototype: probed.name };
  const direction = (asked ? probed.asked : undefined) ?? probed.facing ?? "north";
  return { ...shape, placement: { tile: tileCenter(shape, direction, origin), direction } };
}

/** The placements on which the model and the game disagree, as "(x, y) game 1 model 0". */
function mismatches({ rows, range = fixture.range }: ReachCase, connectsAt: (origin: Point) => boolean): string[] {
  const wrong: string[] = [];
  rows.forEach((row, r) => {
    [...row].forEach((cell, c) => {
      const origin = { x: c - range, y: r - range };
      const connects = connectsAt(origin);
      if (connects !== (cell === "1")) wrong.push(`(${origin.x}, ${origin.y}) game ${cell} model ${connects ? 1 : 0}`);
    });
  });
  return wrong;
}

/** The top-left tile of A in every case. */
const ORIGIN: Point = { x: 0, y: 0 };
const center = ({ width, height }: ProbedEntity, origin: Point): Point => ({ x: origin.x + width / 2, y: origin.y + height / 2 });
const isPole = (probed: ProbedEntity): boolean => probed.type === "electric-pole";
const polePair = ({ a, b }: ReachCase): boolean => isPole(a) && isPole(b);

/** The recorded selection box of an entity whose top-left tile is `origin`, turned by quarter turns to the direction the entity has; `turns: false` leaves it as it faces north. */
function recordedBox(probed: ProbedEntity, origin: Point, turns = true): TileBox {
  const [l, t, r, b] = probed.selectionBox;
  const turned = { north: [l, t, r, b], east: [-b, l, -t, r], south: [-r, -b, -l, -t], west: [t, -r, b, -l] } as const;
  const [left, top, right, bottom] = turned[turns ? (probed.facing ?? "north") : "north"];
  const at = center(probed, origin);
  return { x: at.x + left, y: at.y + top, width: right - left, height: bottom - top };
}

const tiles = ({ width, height }: ProbedEntity, origin: Point): TileBox => ({ ...origin, width, height });
const betweenCenters = ({ a, b }: ReachCase, origin: Point): number => Math.hypot(center(b, origin).x - center(a, ORIGIN).x, center(b, origin).y - center(a, ORIGIN).y);
const betweenBoxes = ({ a, b }: ReachCase, origin: Point): number => boxDistance(recordedBox(a, ORIGIN), recordedBox(b, origin));

/** The rule: from center to center between two poles, between the selection boxes otherwise. */
const distance = (probed: ReachCase, origin: Point): number => (polePair(probed) ? betweenCenters(probed, origin) : betweenBoxes(probed, origin));
/** On how many placements of each case another measure gets another verdict than the game. */
const failures = (measure: (probed: ReachCase, origin: Point) => number, cases = fixture.cases): number[] => cases.map((probed) => mismatches(probed, (origin) => measure(probed, origin) <= probed.reach).length);

describe(`wire reach against Factorio ${fixture.gameVersion} (F-24)`, () => {
  it("has the cases the rule rests on", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(68);
    const names = new Set(fixture.cases.flatMap(({ a, b }) => [a.name, b.name]));
    expect([...names]).toEqual(expect.arrayContaining(["constant-combinator", "decider-combinator", "small-lamp", "small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation", "steel-chest", "inserter", "train-stop", "offshore-pump"]));
    for (const { a, b, reach, range = fixture.range, rows } of fixture.cases) {
      const side = 2 * range + 1;
      expect(rows.length).toBe(side);
      expect(rows.every((row) => new RegExp(`^[01]{${side}}$`).test(row))).toBe(true);
      // The game takes the smaller reach of the two entities.
      expect(reach).toBe(Math.min(a.reach, b.reach));
      // The game has a box in 1/256 of a tile.
      for (const { selectionBox: box } of [a, b]) expect(box.length === 4 && box.every((edge) => Number.isInteger(edge * 256))).toBe(true);
    }
    expect(fixture.cases.some(({ a, b }) => a.reach !== b.reach)).toBe(true);
    // Pole to pole, a pole against something else, a box that is not the tiles in each of the four directions, and an entity that does not take the direction asked for.
    expect(fixture.cases.filter(polePair).length).toBeGreaterThanOrEqual(7);
    expect(fixture.cases.some(({ a, b }) => isPole(a) !== isPole(b))).toBe(true);
    const facings = new Set(fixture.cases.flatMap(({ a, b }) => [a, b]).filter((probed) => JSON.stringify(recordedBox(probed, ORIGIN, false)) !== JSON.stringify(tiles(probed, ORIGIN))).map((probed) => probed.facing));
    expect([...facings]).toEqual(expect.arrayContaining(["north", "east", "south", "west"]));
    expect(fixture.cases.flatMap(({ a, b }) => [a, b]).filter((probed) => probed.asked).map(({ name, asked, facing }) => `${name} ${asked} ${facing}`)).toContain("stone-furnace east north");
  });

  it.each(fixture.cases.map((probed) => [probed.label, probed] as const))("%s: the distance between the selection boxes decides, between two poles the one between the centers", (_label, probed) => {
    expect(mismatches(probed, (origin) => distance(probed, origin) <= probed.reach)).toEqual([]);
  });

  const own = fixture.cases.filter(({ a, b }) => isPrototypeName(a.name) && isPrototypeName(b.name));

  it("covers the prototypes of the editor that the recording has, the poles with their own reach among them", () => {
    expect(own.length).toBeGreaterThanOrEqual(15);
    const names = new Set(own.flatMap(({ a, b }) => [a.name, b.name]));
    expect([...names]).toEqual(expect.arrayContaining(["small-electric-pole", "medium-electric-pole", "big-electric-pole"]));
  });

  it.each(own.map((probed) => [probed.label, probed] as const))("%s: the editor's entities have the game's footprint, selection box, direction and reach", (_label, probed) => {
    for (const end of [probed.a, probed.b]) {
      const entity = entityOf(end, ORIGIN)!;
      const facing = end.facing ?? "north";
      expect(tileSize(entity, facing)).toEqual({ width: end.width, height: end.height });
      expect(selectionBox(entity, facing, center(end, ORIGIN))).toEqual(recordedBox(end, ORIGIN));
      // What the game gave another direction than the one asked for cannot be turned; what faces another way than north can.
      if (end.asked) expect(canRotate(entity)).toBe(false);
      if (facing !== "north") expect(canRotate(entity)).toBe(true);
      // An entity without a reach of its own has the project's, which defaults to what the game gives every such entity.
      expect((PROTOTYPES[end.name as keyof typeof PROTOTYPES] as { wireReach?: number }).wireReach ?? DEFAULT_WIRE_REACH).toBe(end.reach);
    }
    const span = wireSpan(entityOf(probed.a, ORIGIN)!, entityOf(probed.b, ORIGIN)!, DEFAULT_WIRE_REACH);
    expect(span.reach).toBe(probed.reach);
    expect(span.measure).toBe(polePair(probed) ? "centers" : "boxes");
  });

  it.each(own.map((probed) => [probed.label, probed] as const))("%s: the editor's entities get the same verdict", (_label, probed) => {
    const first = entityOf(probed.a, ORIGIN)!;
    // Also where the editor is told the direction the probe asked for and the game did not give: the entity does not turn.
    for (const asked of [false, true]) expect(mismatches(probed, (origin) => !wireSpan(asked ? entityOf(probed.a, ORIGIN, true)! : first, entityOf(probed.b, origin, asked)!, DEFAULT_WIRE_REACH).tooLong)).toEqual([]);
  });

  it("would not pass with another measure", () => {
    const others = fixture.cases.filter((probed) => !polePair(probed));
    const poles = fixture.cases.filter(polePair);
    const total = (counts: readonly number[]): number => counts.reduce((sum, count) => sum + count, 0);
    // From center to center: right for two poles and wrong for every other case.
    expect(failures(betweenCenters, others).every((count) => count > 0)).toBe(true);
    // Between the boxes, or between the tiles, also for two poles: wrong for every pair of poles.
    expect(failures(betweenBoxes, poles).every((count) => count > 0)).toBe(true);
    const betweenTiles = ({ a, b }: ReachCase, origin: Point): number => boxDistance(tiles(a, ORIGIN), tiles(b, origin));
    expect(failures(betweenTiles, poles).every((count) => count > 0)).toBe(true);
    // Between the tiles: right where both boxes are the tiles, wrong in 27 of the cases with another box (the small pole's 0.4 around
    // its center instead of 0.5 changes no verdict against a box of whole tiles).
    const odd = others.filter(({ a, b }) => [a, b].some((probed) => JSON.stringify(recordedBox(probed, ORIGIN, false)) !== JSON.stringify(tiles(probed, ORIGIN))));
    expect(failures(betweenTiles, odd).filter((count) => count > 0).length).toBeGreaterThanOrEqual(27);
    expect(total(failures(betweenTiles, others.filter((probed) => !odd.includes(probed))))).toBe(0);
    // A pole as its center against the box of something else.
    const poleAsPoint = (probed: ReachCase, origin: Point): number => {
      const point = (end: ProbedEntity, at: Point): TileBox => (isPole(end) ? { ...center(end, at), width: 0, height: 0 } : recordedBox(end, at));
      return boxDistance(point(probed.a, ORIGIN), point(probed.b, origin));
    };
    expect(failures(poleAsPoint, others.filter(({ a, b }) => isPole(a) || isPole(b))).every((count) => count > 0)).toBe(true);
    // The boxes as they face north, whatever way the entity faces.
    const unturned = ({ a, b }: ReachCase, origin: Point): number => boxDistance(recordedBox(a, ORIGIN, false), recordedBox(b, origin, false));
    expect(total(failures(unturned, others))).toBeGreaterThan(0);
  });
});
