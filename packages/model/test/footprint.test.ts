import { describe, expect, it } from "vitest";
import {
  canRotate, DEFAULT_FACING, DIRECTIONS, ENTITY_KINDS, facingOf, findTileOverlaps, isTileCenter, occupiedTiles, PROTOTYPE_NAMES, PROTOTYPES, prototypeData, prototypeOf, prototypesOf, rotateTile, tileCenter,
  tileHalves, tileOrigin, tileSize, withArticle,
  type Direction, type EntityKind, type EntityShape, type PlacedEntity, type Point, type PrototypeName, type TileBox,
} from "../src/index.ts";

const LONG: readonly EntityKind[] = ["arithmetic", "decider", "selector"];
const CLOCKWISE: readonly Direction[] = ["east", "south", "west", "north"];
const at = (x: number, y: number): Point => ({ x, y });
const box = (x: number, y: number, width = 1, height = 1): TileBox => ({ x, y, width, height });
const placed = (id: string, kind: EntityKind, tile?: Point, direction?: Direction): PlacedEntity => ({ id, kind, placement: tile || direction ? { tile, direction } : undefined });
const pole = (prototype: PrototypeName): EntityShape => ({ kind: "pole", prototype });
/** One shape per prototype of the table. */
const SHAPES: readonly EntityShape[] = PROTOTYPE_NAMES.map((prototype) => ({ kind: PROTOTYPES[prototype].kind, prototype }));

describe("prototypes", () => {
  it("names the game prototype of every kind, the first of a kind being its default", () => {
    expect(ENTITY_KINDS.map((kind) => prototypeOf({ kind }))).toEqual(["constant-combinator", "arithmetic-combinator", "decider-combinator", "selector-combinator", "small-lamp", "small-electric-pole", "programmable-speaker"]);
    expect(prototypesOf("pole")).toEqual(["small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation"]);
    expect(prototypesOf("lamp")).toEqual(["small-lamp"]);
    for (const kind of ENTITY_KINDS) expect(prototypesOf(kind).length).toBeGreaterThan(0);
    expect(prototypeOf(pole("substation"))).toBe("substation");
    // A prototype of another kind does not count.
    expect(prototypeOf({ kind: "lamp", prototype: "big-electric-pole" })).toBe("small-lamp");
  });

  it("has the sizes, the rotation and the wire reaches of the game data", () => {
    const row = (name: PrototypeName) => {
      const { width, height, rotatable, wireReach } = PROTOTYPES[name] as { width: number; height: number; rotatable: boolean; wireReach?: number };
      return `${width}x${height}${rotatable ? " turns" : ""}${wireReach === undefined ? "" : ` reach ${wireReach}`}`;
    };
    expect(Object.fromEntries(PROTOTYPE_NAMES.map((name) => [name, row(name)]))).toEqual({
      "constant-combinator": "1x1 turns",
      "arithmetic-combinator": "1x2 turns",
      "decider-combinator": "1x2 turns",
      "selector-combinator": "1x2 turns",
      "small-lamp": "1x1",
      "small-electric-pole": "1x1 reach 7.5",
      "medium-electric-pole": "1x1 reach 9",
      "big-electric-pole": "2x2 reach 32",
      substation: "2x2 reach 18",
      "programmable-speaker": "1x1",
    });
    expect(prototypeData(pole("big-electric-pole")).label).toBe("big electric pole");
    expect([withArticle("lamp"), withArticle("arithmetic combinator")]).toEqual(["a lamp", "an arithmetic combinator"]);
  });
});

describe("footprints", () => {
  it("gives the combinators with two terminals two tiles along their direction and every other default prototype one tile", () => {
    for (const kind of ENTITY_KINDS) {
      const long = LONG.includes(kind);
      expect(tileSize({ kind })).toEqual(long ? { width: 2, height: 1 } : { width: 1, height: 1 });
      expect(tileSize({ kind }, "west")).toEqual(tileSize({ kind }, "east"));
      expect(tileSize({ kind }, "north")).toEqual(long ? { width: 1, height: 2 } : { width: 1, height: 1 });
      expect(tileSize({ kind }, "south")).toEqual(tileSize({ kind }, "north"));
    }
  });

  it("gives a big pole and a substation two by two tiles in every direction", () => {
    for (const prototype of ["big-electric-pole", "substation"] as const) for (const direction of DIRECTIONS) expect(tileSize(pole(prototype), direction)).toEqual({ width: 2, height: 2 });
    for (const prototype of ["small-electric-pole", "medium-electric-pole"] as const) expect(tileSize(pole(prototype))).toEqual({ width: 1, height: 1 });
  });

  it("lets every combinator rotate and nothing else", () => {
    expect(ENTITY_KINDS.filter((kind) => canRotate({ kind }))).toEqual(["constant", "arithmetic", "decider", "selector"]);
    expect(SHAPES.filter((shape) => shape.kind === "pole").some(canRotate)).toBe(false);
  });

  it("faces east without a clause, and a lamp whatever its clause says", () => {
    expect(DEFAULT_FACING).toBe("east");
    expect(facingOf(placed("a", "decider"))).toBe("east");
    expect(facingOf(placed("a", "decider", at(0, 0.5)))).toBe("east");
    expect(facingOf(placed("a", "constant", undefined, "north"))).toBe("north");
    expect(facingOf(placed("a", "lamp", undefined, "south"))).toBe("east");
    expect(facingOf({ ...pole("big-electric-pole"), placement: { direction: "north" } })).toBe("east");
    expect(facingOf(placed("a", "speaker", undefined, "west"))).toBe("east");
  });
});

describe("centers and tiles", () => {
  it("puts the center of a 1x1 entity in the middle of its tile", () => {
    for (const direction of DIRECTIONS) {
      expect(tileCenter({ kind: "lamp" }, direction, at(3, -2))).toEqual(at(3.5, -1.5));
      expect(tileOrigin({ kind: "constant" }, direction, at(3.5, -1.5))).toEqual(at(3, -2));
      expect(occupiedTiles({ kind: "constant" }, direction, at(3.5, -1.5))).toEqual([at(3, -2)]);
      expect(tileHalves({ kind: "constant" }, direction, at(3.5, -1.5))).toEqual({ input: box(3, -2), output: box(3, -2) });
    }
  });

  it("puts the center of a 2x1 entity on the edge between its two tiles", () => {
    // The selector of the audit (5.4): center (6.5, -21) facing south covers the tiles above and below y = -21.
    expect(occupiedTiles({ kind: "selector" }, "south", at(6.5, -21))).toEqual([at(6, -22), at(6, -21)]);
    expect(tileCenter({ kind: "selector" }, "south", at(6, -22))).toEqual(at(6.5, -21));
    expect(tileCenter({ kind: "decider" }, "north", at(0, 0))).toEqual(at(0.5, 1));
    expect(tileCenter({ kind: "decider" }, "east", at(0, 0))).toEqual(at(1, 0.5));
    expect(tileCenter({ kind: "decider" }, "west", at(-2, -1))).toEqual(at(-1, -0.5));
    expect(occupiedTiles({ kind: "arithmetic" }, "east", at(1, 0.5))).toEqual([at(0, 0), at(1, 0)]);
    expect(occupiedTiles({ kind: "arithmetic" }, "west", at(-1, -0.5))).toEqual([at(-2, -1), at(-1, -1)]);
  });

  it("puts the center of a 2x2 entity on the corner its four tiles share", () => {
    const big = pole("big-electric-pole");
    for (const direction of DIRECTIONS) {
      expect(tileCenter(big, direction, at(3, -2))).toEqual(at(4, -1));
      expect(tileOrigin(big, direction, at(4, -1))).toEqual(at(3, -2));
      expect(occupiedTiles(big, direction, at(4, -1))).toEqual([at(3, -2), at(4, -2), at(3, -1), at(4, -1)]);
      expect(isTileCenter(big, direction, at(4, -1))).toBe(true);
      for (const center of [at(4.5, -1), at(4, -1.5), at(4.5, -1.5), at(4.25, -1)]) expect(isTileCenter(big, direction, center)).toBe(false);
      // No input and output half: both are the four tiles.
      expect(tileHalves(big, direction, at(4, -1))).toEqual({ input: box(3, -2, 2, 2), output: box(3, -2, 2, 2) });
    }
    expect(tileOrigin(pole("substation"), "east", at(0.4, 0.6))).toEqual(at(-1, 0));
  });

  it("round-trips between the top-left tile and the center for every prototype and direction", () => {
    for (const shape of SHAPES) {
      for (const direction of DIRECTIONS) {
        for (const tile of [at(0, 0), at(-1, -1), at(7, -3), at(-4, 9)]) {
          const center = tileCenter(shape, direction, tile);
          expect(isTileCenter(shape, direction, center)).toBe(true);
          expect(tileOrigin(shape, direction, center)).toEqual(tile);
          const tiles = occupiedTiles(shape, direction, center);
          const { width, height } = prototypeData(shape);
          expect(tiles).toHaveLength(width * height);
          expect(tiles[0]).toEqual(tile);
        }
      }
    }
  });

  it("points from the input half to the output half", () => {
    // Audit 3.1: facing north, the output is the northern tile and the input the southern one.
    expect(tileHalves({ kind: "decider" }, "north", at(0.5, 1))).toEqual({ input: box(0, 1), output: box(0, 0) });
    expect(tileHalves({ kind: "decider" }, "south", at(0.5, 1))).toEqual({ input: box(0, 0), output: box(0, 1) });
    expect(tileHalves({ kind: "decider" }, "east", at(1, 0.5))).toEqual({ input: box(0, 0), output: box(1, 0) });
    expect(tileHalves({ kind: "decider" }, "west", at(1, 0.5))).toEqual({ input: box(1, 0), output: box(0, 0) });
    // An entity with one connector has no halves.
    for (const kind of ["lamp", "speaker", "constant"] as const) expect(tileHalves({ kind }, "east", at(0.5, 0.5))).toEqual({ input: box(0, 0), output: box(0, 0) });
  });

  it("accepts exactly the centers the game uses", () => {
    for (const kind of ["constant", "lamp", "pole", "speaker"] as const) {
      for (const direction of DIRECTIONS) {
        expect(isTileCenter({ kind }, direction, at(0.5, -0.5))).toBe(true);
        for (const center of [at(0, 0.5), at(0.5, 0), at(1, 2), at(0.25, 0.5)]) expect(isTileCenter({ kind }, direction, center)).toBe(false);
      }
    }
    for (const kind of LONG) {
      for (const direction of ["north", "south"] as const) {
        expect(isTileCenter({ kind }, direction, at(6.5, -21))).toBe(true);
        for (const center of [at(6, -21.5), at(6.5, -21.5), at(6, -21), at(6.5, -21.25)]) expect(isTileCenter({ kind }, direction, center)).toBe(false);
      }
      for (const direction of ["east", "west"] as const) {
        expect(isTileCenter({ kind }, direction, at(6, -21.5))).toBe(true);
        for (const center of [at(6.5, -21), at(6.5, -21.5), at(6, -21), at(6.25, -21.5)]) expect(isTileCenter({ kind }, direction, center)).toBe(false);
      }
    }
    expect(isTileCenter({ kind: "lamp" }, "east", at(Number.NaN, 0.5))).toBe(false);
  });

  it("gives a center off the grid the nearest footprint and never a negative zero", () => {
    expect(tileOrigin({ kind: "lamp" }, "east", at(0.2, 0.9))).toEqual(at(0, 0));
    expect(tileOrigin({ kind: "lamp" }, "east", at(1, 1))).toEqual(at(1, 1));
    expect(tileOrigin({ kind: "decider" }, "east", at(0.5, 0.5))).toEqual(at(0, 0));
    expect(tileOrigin({ kind: "decider" }, "north", at(0.5, 0.5))).toEqual(at(0, 0));
    const origin = tileOrigin({ kind: "lamp" }, "east", at(0, 0));
    expect(Object.is(origin.x, 0) && Object.is(origin.y, 0)).toBe(true);
    expect(occupiedTiles({ kind: "decider" }, "east", at(0.5, 0.5))).toEqual([at(0, 0), at(1, 0)]);
  });
});

describe("rotateTile", () => {
  it("keeps the top-left tile of the footprint on every turn", () => {
    // On the tiles (0, 0) and (1, 0), input on the left.
    const east = at(1, 0.5);
    expect(rotateTile({ kind: "decider" }, east, "east", "south")).toEqual(at(0.5, 1));
    expect(rotateTile({ kind: "decider" }, east, "east", "north")).toEqual(at(0.5, 1));
    expect(rotateTile({ kind: "decider" }, east, "east", "west")).toEqual(east);
    for (const kind of LONG) {
      for (const from of DIRECTIONS) {
        const center = tileCenter({ kind }, from, at(3, -5));
        for (const to of DIRECTIONS) {
          const turned = rotateTile({ kind }, center, from, to);
          expect(isTileCenter({ kind }, to, turned)).toBe(true);
          expect(tileOrigin({ kind }, to, turned)).toEqual(at(3, -5));
        }
      }
    }
  });

  it("keeps both tiles on a half turn and swaps the input and the output half", () => {
    const center = at(1, 0.5);
    expect(tileHalves({ kind: "arithmetic" }, "east", center)).toEqual({ input: box(0, 0), output: box(1, 0) });
    const flipped = rotateTile({ kind: "arithmetic" }, center, "east", "west");
    expect(occupiedTiles({ kind: "arithmetic" }, "west", flipped)).toEqual(occupiedTiles({ kind: "arithmetic" }, "east", center));
    expect(tileHalves({ kind: "arithmetic" }, "west", flipped)).toEqual({ input: box(1, 0), output: box(0, 0) });
    const upright = rotateTile({ kind: "arithmetic" }, at(0.5, 1), "south", "north");
    expect(tileHalves({ kind: "arithmetic" }, "north", upright)).toEqual({ input: box(0, 1), output: box(0, 0) });
  });

  it("comes back after four quarter turns", () => {
    let center = at(1, 0.5);
    const seen = [center];
    for (let i = 0; i < 4; i++) {
      center = rotateTile({ kind: "arithmetic" }, center, CLOCKWISE[i]!, CLOCKWISE[(i + 1) % 4]!);
      seen.push(center);
    }
    expect(seen).toEqual([at(1, 0.5), at(0.5, 1), at(1, 0.5), at(0.5, 1), at(1, 0.5)]);
  });

  it("leaves a 1x1 entity and an unchanged direction alone, and snaps a center off the grid first", () => {
    expect(rotateTile({ kind: "constant" }, at(0.5, 0.5), "east", "south")).toEqual(at(0.5, 0.5));
    expect(rotateTile({ kind: "lamp" }, at(1, 2), "east", "south")).toEqual(at(1, 2));
    expect(rotateTile(pole("big-electric-pole"), at(1, 2), "east", "south")).toEqual(at(1, 2));
    expect(rotateTile(pole("substation"), at(0.5, 0.5), "east", "north")).toEqual(at(0.5, 0.5));
    expect(rotateTile({ kind: "decider" }, at(0.5, 0.5), "east", "east")).toEqual(at(0.5, 0.5));
    // (0.5, 0.5) facing east is taken as the footprint on tiles (0, 0) and (1, 0).
    expect(rotateTile({ kind: "decider" }, at(0.5, 0.5), "east", "south")).toEqual(at(0.5, 1));
    expect(rotateTile({ kind: "decider" }, at(0.5, 0.5), "east", "west")).toEqual(at(1, 0.5));
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

  it("counts all four tiles of a 2x2 entity", () => {
    const big: PlacedEntity = { id: "big", ...pole("big-electric-pole"), placement: { tile: at(1, 1) } };
    expect(findTileOverlaps([big, placed("lamp", "lamp", at(1.5, 1.5)), placed("free", "lamp", at(2.5, 1.5)), placed("corner", "speaker", at(0.5, 0.5))])).toEqual([
      { tile: at(0, 0), entities: ["big", "corner"] },
      { tile: at(1, 1), entities: ["big", "lamp"] },
    ]);
    // The same center taken for a small pole covers one tile only.
    expect(findTileOverlaps([{ ...big, prototype: "small-electric-pole" }, placed("corner", "speaker", at(0.5, 0.5))])).toEqual([]);
  });

  it("stays linear for many entities on one tile", () => {
    const stack = Array.from({ length: 20000 }, (_, i) => placed(`e${i}`, "constant", at(0.5, 0.5)));
    const overlaps = findTileOverlaps(stack);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.entities).toHaveLength(20000);
  });
});
