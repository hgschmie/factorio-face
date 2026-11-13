// Fixture F-24: what the game itself says about wire reach (tests/fixtures/game/F-24-wire-reach.json, recorded by
// tools/game-probe/wire-reach.mjs). Every placement of every case must get the game's verdict from the model.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exceedsWireReach, footprintDistance, tileCenter, wireDistance, type Direction, type Entity, type EntityKind, type Point } from "../src/index.ts";

interface ProbedEntity {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly facing?: Direction;
  readonly reach: number;
}

interface ReachCase {
  readonly label: string;
  readonly a: ProbedEntity;
  readonly b: ProbedEntity;
  readonly reach: number;
  readonly rows: readonly string[];
}

interface ReachFixture {
  readonly gameVersion: string;
  readonly range: number;
  readonly cases: readonly ReachCase[];
}

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/game/F-24-wire-reach.json", import.meta.url), "utf8")) as ReachFixture;

const KINDS: Readonly<Record<string, EntityKind>> = {
  "constant-combinator": "constant",
  "arithmetic-combinator": "arithmetic",
  "decider-combinator": "decider",
  "selector-combinator": "selector",
  "small-lamp": "lamp",
};

/** The editor's entity for a probed one with its top-left tile on `origin`; undefined for a prototype the editor does not have. */
function entityOf(probed: ProbedEntity, origin: Point): Pick<Entity, "kind" | "placement"> | undefined {
  const kind = KINDS[probed.name];
  if (!kind) return undefined;
  const direction = probed.facing ?? "north";
  return { kind, placement: { tile: tileCenter(kind, direction, origin), direction } };
}

/** The placements on which the model and the game disagree, as "(x, y) game 1 model 0". */
function mismatches({ a, b, reach, rows }: ReachCase, range: number, distanceAt: (origin: Point) => number | undefined): string[] {
  const wrong: string[] = [];
  rows.forEach((row, r) => {
    [...row].forEach((cell, c) => {
      const origin = { x: c - range, y: r - range };
      const connects = !exceedsWireReach(distanceAt(origin), reach);
      if (connects !== (cell === "1")) wrong.push(`(${origin.x}, ${origin.y}) game ${cell} model ${connects ? 1 : 0}`);
    });
  });
  return wrong;
}

describe(`wire reach against Factorio ${fixture.gameVersion} (F-24)`, () => {
  const side = 2 * fixture.range + 1;

  it("has the cases the rule rests on", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(13);
    const names = new Set(fixture.cases.flatMap(({ a, b }) => [a.name, b.name]));
    expect([...names]).toEqual(expect.arrayContaining(["constant-combinator", "decider-combinator", "small-lamp", "small-electric-pole", "medium-electric-pole", "big-electric-pole", "steel-chest"]));
    for (const { a, b, reach, rows } of fixture.cases) {
      expect(rows.length).toBe(side);
      expect(rows.every((row) => new RegExp(`^[01]{${side}}$`).test(row))).toBe(true);
      // The game takes the smaller reach of the two entities.
      expect(reach).toBe(Math.min(a.reach, b.reach));
    }
    expect(fixture.cases.some(({ a, b }) => a.reach !== b.reach)).toBe(true);
  });

  it.each(fixture.cases.map((probed) => [probed.label, probed] as const))("%s: the distance between the footprints decides", (_label, probed) => {
    const { a, b } = probed;
    expect(mismatches(probed, fixture.range, (origin) => footprintDistance({ x: 0, y: 0, width: a.width, height: a.height }, { ...origin, width: b.width, height: b.height }))).toEqual([]);
  });

  const own = fixture.cases.filter(({ a, b }) => a.name in KINDS && b.name in KINDS);

  it("covers every kind of the editor that the recording has", () => {
    expect(own.length).toBeGreaterThanOrEqual(9);
  });

  it.each(own.map((probed) => [probed.label, probed] as const))("%s: the editor's entities get the same verdict", (_label, probed) => {
    const first = entityOf(probed.a, { x: 0, y: 0 })!;
    expect(mismatches(probed, fixture.range, (origin) => wireDistance(first, entityOf(probed.b, origin)!))).toEqual([]);
  });

  it("would not pass with the distance between the centers", () => {
    const centers = fixture.cases.map((probed) => {
      const { a, b } = probed;
      return mismatches(probed, fixture.range, (origin) => Math.hypot(origin.x + b.width / 2 - a.width / 2, origin.y + b.height / 2 - a.height / 2)).length;
    });
    expect(centers.every((count) => count > 0)).toBe(true);
  });
});
