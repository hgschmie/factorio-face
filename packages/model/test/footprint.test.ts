import { describe, expect, it } from "vitest";
import {
  canRotate, DEFAULT_FACING, DIRECTIONS, ENTITY_KINDS, facingOf, findTileOverlaps, FOOTPRINTS, isTileCenter, occupiedTiles, rotateTile, tileCenter, tileHalves, tileOrigin, tileSize,
  type Direction, type EntityKind, type PlacedEntity, type Point,
} from "../src/index.ts";

const LONG: readonly EntityKind[] = ["arithmetic", "decider", "selector"];
const CLOCKWISE: readonly Direction[] = ["east", "south", "west", "north"];
const at = (x: number, y: number): Point => ({ x, y });
const placed = (id: string, kind: EntityKind, tile?: Point, direction?: Direction): PlacedEntity => ({ id, kind, placement: tile || direction ? { tile, direction } : undefined });

describe("footprints", () => {
  it("gives the combinators with two terminals two tiles along their direction and everything else one tile", () => {
    expect(Object.keys(FOOTPRINTS).sort()).toEqual([...ENTITY_KINDS].sort());
    for (const kind of ENTITY_KINDS) {
      const long = LONG.includes(kind);
      expect(tileSize(kind)).toEqual(long ? { width: 2, height: 1 } : { width: 1, height: 1 });
      expect(tileSize(kind, "west")).toEqual(tileSize(kind, "east"));
      expect(tileSize(kind, "north")).toEqual(long ? { width: 1, height: 2 } : { width: 1, height: 1 });
      expect(tileSize(kind, "south")).toEqual(tileSize(kind, "north"));
    }
  });

  it("lets every combinator rotate and the lamp not", () => {
    expect(ENTITY_KINDS.filter(canRotate)).toEqual(["constant", "arithmetic", "decider", "selector"]);
  });

  it("faces east without a clause, and a lamp whatever its clause says", () => {
    expect(DEFAULT_FACING).toBe("east");
    expect(facingOf(placed("a", "decider"))).toBe("east");
    expect(facingOf(placed("a", "decider", at(0, 0.5)))).toBe("east");
    expect(facingOf(placed("a", "constant", undefined, "north"))).toBe("north");
    expect(facingOf(placed("a", "lamp", undefined, "south"))).toBe("east");
  });
});

describe("centers and tiles", () => {
  it("puts the center of a 1x1 entity in the middle of its tile", () => {
    for (const direction of DIRECTIONS) {
      expect(tileCenter("lamp", direction, at(3, -2))).toEqual(at(3.5, -1.5));
      expect(tileOrigin("constant", direction, at(3.5, -1.5))).toEqual(at(3, -2));
      expect(occupiedTiles("constant", direction, at(3.5, -1.5))).toEqual([at(3, -2)]);
      expect(tileHalves("constant", direction, at(3.5, -1.5))).toEqual({ input: at(3, -2), output: at(3, -2) });
    }
  });

  it("puts the center of a 2x1 entity on the edge between its two tiles", () => {
    // The selector of the audit (5.4): center (6.5, -21) facing south covers the tiles above and below y = -21.
    expect(occupiedTiles("selector", "south", at(6.5, -21))).toEqual([at(6, -22), at(6, -21)]);
    expect(tileCenter("selector", "south", at(6, -22))).toEqual(at(6.5, -21));
    expect(tileCenter("decider", "north", at(0, 0))).toEqual(at(0.5, 1));
    expect(tileCenter("decider", "east", at(0, 0))).toEqual(at(1, 0.5));
    expect(tileCenter("decider", "west", at(-2, -1))).toEqual(at(-1, -0.5));
    expect(occupiedTiles("arithmetic", "east", at(1, 0.5))).toEqual([at(0, 0), at(1, 0)]);
    expect(occupiedTiles("arithmetic", "west", at(-1, -0.5))).toEqual([at(-2, -1), at(-1, -1)]);
  });

  it("round-trips between the top-left tile and the center for every kind and direction", () => {
    for (const kind of ENTITY_KINDS) {
      for (const direction of DIRECTIONS) {
        for (const tile of [at(0, 0), at(-1, -1), at(7, -3), at(-4, 9)]) {
          const center = tileCenter(kind, direction, tile);
          expect(isTileCenter(kind, direction, center)).toBe(true);
          expect(tileOrigin(kind, direction, center)).toEqual(tile);
          const tiles = occupiedTiles(kind, direction, center);
          expect(tiles).toHaveLength(FOOTPRINTS[kind].length);
          expect(tiles[0]).toEqual(tile);
        }
      }
    }
  });

  it("points from the input half to the output half", () => {
    // Audit 3.1: facing north, the output is the northern tile and the input the southern one.
    expect(tileHalves("decider", "north", at(0.5, 1))).toEqual({ input: at(0, 1), output: at(0, 0) });
    expect(tileHalves("decider", "south", at(0.5, 1))).toEqual({ input: at(0, 0), output: at(0, 1) });
    expect(tileHalves("decider", "east", at(1, 0.5))).toEqual({ input: at(0, 0), output: at(1, 0) });
    expect(tileHalves("decider", "west", at(1, 0.5))).toEqual({ input: at(1, 0), output: at(0, 0) });
  });

  it("accepts exactly the centers the game uses", () => {
    for (const kind of ["constant", "lamp"] as const) {
      for (const direction of DIRECTIONS) {
        expect(isTileCenter(kind, direction, at(0.5, -0.5))).toBe(true);
        for (const center of [at(0, 0.5), at(0.5, 0), at(1, 2), at(0.25, 0.5)]) expect(isTileCenter(kind, direction, center)).toBe(false);
      }
    }
    for (const kind of LONG) {
      for (const direction of ["north", "south"] as const) {
        expect(isTileCenter(kind, direction, at(6.5, -21))).toBe(true);
        for (const center of [at(6, -21.5), at(6.5, -21.5), at(6, -21), at(6.5, -21.25)]) expect(isTileCenter(kind, direction, center)).toBe(false);
      }
      for (const direction of ["east", "west"] as const) {
        expect(isTileCenter(kind, direction, at(6, -21.5))).toBe(true);
        for (const center of [at(6.5, -21), at(6.5, -21.5), at(6, -21), at(6.25, -21.5)]) expect(isTileCenter(kind, direction, center)).toBe(false);
      }
    }
    expect(isTileCenter("lamp", "east", at(Number.NaN, 0.5))).toBe(false);
  });

  it("gives a center off the grid the nearest footprint and never a negative zero", () => {
    expect(tileOrigin("lamp", "east", at(0.2, 0.9))).toEqual(at(0, 0));
    expect(tileOrigin("lamp", "east", at(1, 1))).toEqual(at(1, 1));
    expect(tileOrigin("decider", "east", at(0.5, 0.5))).toEqual(at(0, 0));
    expect(tileOrigin("decider", "north", at(0.5, 0.5))).toEqual(at(0, 0));
    const origin = tileOrigin("lamp", "east", at(0, 0));
    expect(Object.is(origin.x, 0) && Object.is(origin.y, 0)).toBe(true);
    expect(occupiedTiles("decider", "east", at(0.5, 0.5))).toEqual([at(0, 0), at(1, 0)]);
  });
});

describe("rotateTile", () => {
  it("keeps the input tile and swings the output around it", () => {
    // Input on tile (0, 0), output to the east of it.
    const east = at(1, 0.5);
    expect(rotateTile("decider", east, "east", "south")).toEqual(at(0.5, 1));
    expect(rotateTile("decider", east, "east", "north")).toEqual(at(0.5, 0));
    expect(rotateTile("decider", east, "east", "west")).toEqual(at(0, 0.5));
    for (const kind of LONG) {
      for (const from of DIRECTIONS) {
        const center = tileCenter(kind, from, at(3, -5));
        const { input } = tileHalves(kind, from, center);
        for (const to of DIRECTIONS) {
          const turned = rotateTile(kind, center, from, to);
          expect(isTileCenter(kind, to, turned)).toBe(true);
          expect(tileHalves(kind, to, turned).input).toEqual(input);
        }
      }
    }
  });

  it("comes back after four quarter turns and treats a half turn as two of them", () => {
    let center = at(1, 0.5);
    const seen = [center];
    for (let i = 0; i < 4; i++) {
      center = rotateTile("arithmetic", center, CLOCKWISE[i]!, CLOCKWISE[(i + 1) % 4]!);
      seen.push(center);
    }
    expect(seen).toEqual([at(1, 0.5), at(0.5, 1), at(0, 0.5), at(0.5, 0), at(1, 0.5)]);
    expect(rotateTile("arithmetic", at(1, 0.5), "east", "west")).toEqual(seen[2]);
  });

  it("leaves a 1x1 entity and an unchanged direction alone, and snaps a center off the grid first", () => {
    expect(rotateTile("constant", at(0.5, 0.5), "east", "south")).toEqual(at(0.5, 0.5));
    expect(rotateTile("lamp", at(1, 2), "east", "south")).toEqual(at(1, 2));
    expect(rotateTile("decider", at(0.5, 0.5), "east", "east")).toEqual(at(0.5, 0.5));
    // (0.5, 0.5) facing east is taken as the footprint on tiles (0, 0) and (1, 0).
    expect(rotateTile("decider", at(0.5, 0.5), "east", "south")).toEqual(at(0.5, 1));
  });
});

describe("findTileOverlaps", () => {
  it("reports each shared tile with the entities on it and ignores entities without a tile", () => {
    const entities = [
      placed("lamp", "lamp", at(0.5, 0.5)),
      placed("gate", "decider", at(1, 0.5)),
      placed("free", "constant", at(5.5, 5.5)),
      placed("none", "constant"),
      placed("turned", "arithmetic", at(1.5, 0), "north"),
      placed("other", "selector", at(1.5, 1), "south"),
    ];
    expect(findTileOverlaps(entities)).toEqual([
      { tile: at(0, 0), entities: ["lamp", "gate"] },
      { tile: at(1, 0), entities: ["gate", "turned", "other"] },
    ]);
    expect(findTileOverlaps(entities.slice(2, 4))).toEqual([]);
    expect(findTileOverlaps([])).toEqual([]);
  });

  it("uses the direction of the entity, which is east for a lamp and without a clause", () => {
    // Two deciders with the same center: one lies east-west, the other north-south, off the grid for its direction.
    expect(findTileOverlaps([placed("a", "decider", at(1, 0.5)), placed("b", "decider", at(1, 1.5), "east")])).toEqual([]);
    expect(findTileOverlaps([placed("a", "decider", at(1, 0.5)), placed("b", "decider", at(1.5, 1), "north")])).toEqual([{ tile: at(1, 0), entities: ["a", "b"] }]);
    expect(findTileOverlaps([placed("a", "lamp", at(0.5, 0.5), "north"), placed("b", "lamp", at(0.5, 1.5), "north")])).toEqual([]);
  });

  it("stays linear for many entities on one tile", () => {
    const stack = Array.from({ length: 20000 }, (_, i) => placed(`e${i}`, "constant", at(0.5, 0.5)));
    const overlaps = findTileOverlaps(stack);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.entities).toHaveLength(20000);
  });
});
