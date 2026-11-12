// Editing on the blueprint board: the session commands that write `tile`, and the rules they keep (canvas/board.ts).
import { facingOf, type Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { DISPLAY_CAPABILITIES } from "../../src/workbench/controller.ts";
import { createSession, entityNamed, idOf, replaceText } from "./helpers.ts";

/** `source` on tile (0, 0), `gate` on (2, 0) and (3, 0); `twice` and `light` have no tile and are shown on (3, 3), (4, 3) and on (6, 1). */
const BOARD = `circuit "Board" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    decider gate at (300, 80) tile (3, 0.5) {   // the counter
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    arithmetic twice at (300, 240) {
        virtual:signal-B = virtual:signal-A[red] * 2
    }

    lamp light at (560, 80) {
        when virtual:signal-B > 8
    }

    wire red source.out <-> gate.in
}
`;

const at = (x: number, y: number): Point => ({ x, y });

function board(source = BOARD) {
  const created = createSession(source);
  const { session } = created;
  const tiles = (): Record<string, Point | undefined> => Object.fromEntries(session.state.circuit.entities.map((entity) => [entity.name, entity.placement?.tile]));
  const positions = (): Point[] => session.state.circuit.entities.map((entity) => entity.position);
  const set = (moves: Readonly<Record<string, Point>>): void => session.commands.setTiles(Object.entries(moves).map(([name, tile]) => ({ id: idOf(session, name), tile })));
  return { ...created, tiles, positions, set };
}

describe("what the blueprint board allows", () => {
  it("is said in one table: everything but paste and duplicate, with positions in tiles", () => {
    expect(DISPLAY_CAPABILITIES.blueprint).toEqual({ move: true, place: true, wire: true, paste: false, rotate: true, tiles: true });
    expect(DISPLAY_CAPABILITIES.edit).toEqual({ move: true, place: true, wire: true, paste: true, rotate: true, tiles: false });
  });
});

describe("setTiles", () => {
  it("moves an entity to a tile as one undo step and changes nothing but the two numbers", () => {
    const { session, set, positions } = board();
    const before = positions();
    session.commands.select([idOf(session, "gate")]);
    set({ gate: at(3, 1.5) });
    expect(session.state.source).toBe(BOARD.replace("tile (3, 0.5)", "tile (3, 1.5)"));
    expect(positions()).toEqual(before);
    expect(session.state).toMatchObject({ error: null, canUndo: true, selection: [idOf(session, "gate")] });
    session.commands.undo();
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false });
    session.commands.redo();
    expect(entityNamed(session, "gate").placement).toEqual({ tile: at(3, 1.5) });
  });

  it("moves a group as one step and gives an entity without a tile one", () => {
    const { session, set, tiles, positions } = board();
    const before = positions();
    set({ source: at(0.5, 4.5), gate: at(3, 4.5), twice: at(6, 4.5) });
    expect(tiles()).toEqual({ source: at(0.5, 4.5), gate: at(3, 4.5), twice: at(6, 4.5), light: undefined });
    expect(session.state.source).toContain("arithmetic twice at (300, 240) tile (6, 4.5) {");
    expect(positions()).toEqual(before);
    session.commands.undo();
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false });
  });

  it("does nothing when one of the entities would stand on a tile of an entity that is not moved", () => {
    const { session, set, notifications } = board();
    const count = notifications();
    // The left tile of the gate on the constant; and a group of which one member is in the way of nothing, the other is.
    set({ gate: at(1, 0.5) });
    set({ source: at(2.5, 0.5), twice: at(9, 9.5) });
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false, error: null });
    expect(notifications()).toBe(count);
    // Together they change places: nobody who stays is in the way.
    set({ source: at(3.5, 0.5), gate: at(1, 0.5) });
    expect(session.state.source).toBe(BOARD.replace("tile (0.5, 0.5)", "tile (3.5, 0.5)").replace("tile (3, 0.5)", "tile (1, 0.5)"));
  });

  it("does not take an entity without a tile for an obstacle: that one gives way", () => {
    const { set, tiles } = board();
    // Where `twice` is shown.
    set({ gate: at(4, 3.5) });
    expect(tiles()).toMatchObject({ gate: at(4, 3.5), twice: undefined });
  });

  it("repairs a conflict of the source, and a conflict elsewhere is in nobody's way", () => {
    const broken = BOARD.replace("tile (3, 0.5)", "tile (0.5, 0.5)").replace("lamp light at (560, 80)", "lamp light at (560, 80) tile (0.5, 0.5)");
    const { session, set, tiles } = board(broken);
    const codes = (): string[] => session.state.diagnostics.map((diagnostic) => diagnostic.code).sort();
    expect(codes()).toEqual(["tile-off-grid", "tile-overlap", "tile-overlap", "tile-overlap"]);
    // Another entity moves although three stand on each other.
    set({ twice: at(6, 5.5) });
    expect(tiles().twice).toEqual(at(6, 5.5));
    // The gate, off the grid on (0, 0) and (1, 0), goes to a free place and is on the grid there; then the lamp leaves the constant.
    set({ gate: at(3, 2.5) });
    expect(codes()).toEqual(["tile-overlap", "tile-overlap"]);
    set({ light: at(0.5, 1.5) });
    expect(codes()).toEqual([]);
    // Back onto the constant is a blocked move like any other.
    set({ light: at(0.5, 0.5) });
    expect(tiles().light).toEqual(at(0.5, 1.5));
  });

  it("reports a center that is off the grid, leaves out entities that do not exist and does nothing while the source has errors", () => {
    const { session, set } = board();
    set({ gate: at(3.5, 4.5) });
    expect(session.state.error).toContain("not on the tile grid for 'gate'");
    expect(session.state.source).toBe(BOARD);
    session.commands.dismissError();
    session.commands.setTiles([{ id: "nope", tile: at(0.5, 0.5) }]);
    session.commands.setTiles([]);
    expect(session.state).toMatchObject({ source: BOARD, error: null, canUndo: false });
    session.commands.setTiles([{ id: "nope", tile: at(0.5, 0.5) }, { id: idOf(session, "gate"), tile: at(3, 2.5) }]);
    expect(entityNamed(session, "gate").placement?.tile).toEqual(at(3, 2.5));

    replaceText(session, "< 10", "<");
    const typed = session.state.source;
    session.commands.setTiles([{ id: idOf(session, "gate"), tile: at(3, 5.5) }]);
    session.commands.nudgeTiles(at(1, 0));
    session.commands.snapToTiles();
    session.commands.clearTiles([idOf(session, "gate")]);
    session.commands.placeEntityOnTile("lamp", at(9.5, 9.5));
    expect(session.state).toMatchObject({ source: typed, error: null });
  });
});

describe("nudgeTiles", () => {
  it("moves the selection by whole tiles and stops at a taken tile", () => {
    const { session, tiles } = board();
    session.commands.select([idOf(session, "source")]);
    session.commands.nudgeTiles(at(1, 0));
    expect(tiles().source).toEqual(at(1.5, 0.5));
    // The next tile is the gate's.
    session.commands.nudgeTiles(at(1, 0));
    expect(tiles().source).toEqual(at(1.5, 0.5));
    expect(session.state.error).toBeNull();
    session.commands.nudgeTiles(at(0, 5));
    session.commands.nudgeTiles(at(-5, 0));
    expect(tiles().source).toEqual(at(-3.5, 5.5));
    expect(session.state.selection).toEqual([idOf(session, "source")]);
    for (let i = 0; i < 3; i++) session.commands.undo();
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false });
  });

  it("places the entities without a tile that are part of the selection, from where they are shown", () => {
    const { session, tiles, positions } = board();
    const before = positions();
    session.commands.select([idOf(session, "gate"), idOf(session, "twice"), idOf(session, "light")]);
    session.commands.nudgeTiles(at(0, 1));
    expect(tiles()).toEqual({ source: at(0.5, 0.5), gate: at(3, 1.5), twice: at(4, 4.5), light: at(6.5, 2.5) });
    expect(positions()).toEqual(before);
    session.commands.undo();
    expect(session.state.source).toBe(BOARD);
    // Nothing selected, nothing moved.
    session.commands.select([]);
    session.commands.nudgeTiles(at(1, 0));
    expect(session.state).toMatchObject({ source: BOARD, canRedo: true });
  });
});

describe("snapToTiles and clearTiles", () => {
  it("gives every entity without a tile the one of the place it is shown at, as one step", () => {
    const { session, tiles, positions, notifications } = board();
    const before = positions();
    session.commands.snapToTiles();
    expect(tiles()).toEqual({ source: at(0.5, 0.5), gate: at(3, 0.5), twice: at(4, 3.5), light: at(6.5, 1.5) });
    expect(session.state.source).toBe(BOARD.replace("twice at (300, 240)", "twice at (300, 240) tile (4, 3.5)").replace("light at (560, 80)", "light at (560, 80) tile (6.5, 1.5)"));
    expect(positions()).toEqual(before);
    expect(session.state.diagnostics).toEqual([]);
    // Nothing left to snap: no step.
    const count = notifications();
    session.commands.snapToTiles();
    expect(notifications()).toBe(count);
    session.commands.undo();
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false });
  });

  it("snaps a subset and leaves the others, those with a tile included", () => {
    const { session, tiles } = board();
    session.commands.snapToTiles([idOf(session, "light"), idOf(session, "gate"), "nope"]);
    expect(tiles()).toEqual({ source: at(0.5, 0.5), gate: at(3, 0.5), twice: undefined, light: at(6.5, 1.5) });
    session.commands.snapToTiles([idOf(session, "gate")]);
    session.commands.snapToTiles([]);
    expect(tiles().twice).toBeUndefined();
    session.commands.undo();
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false });
  });

  it("snaps entities that are shown away from their own place to where they are shown", () => {
    // Both lamps want tile (0, 1); the second one is shown above it, on (0, 0).
    const { session, tiles } = board('circuit "c" {\n    lamp a at (0, 92) { }\n    lamp b at (0, 92) { }\n}\n');
    session.commands.snapToTiles([idOf(session, "b")]);
    expect(tiles()).toEqual({ a: undefined, b: at(0.5, 0.5) });
    session.commands.snapToTiles();
    expect(tiles()).toEqual({ a: at(0.5, 1.5), b: at(0.5, 0.5) });
    expect(session.state.diagnostics).toEqual([]);
  });

  it("takes entities off the grid: the clause goes, the rest of the line stays", () => {
    const { session, tiles, notifications } = board();
    session.commands.clearTiles([idOf(session, "gate"), idOf(session, "twice"), "nope"]);
    expect(session.state.source).toBe(BOARD.replace(" tile (3, 0.5)", ""));
    expect(tiles()).toEqual({ source: at(0.5, 0.5), gate: undefined, twice: undefined, light: undefined });
    const count = notifications();
    session.commands.clearTiles([idOf(session, "twice")]);
    session.commands.clearTiles([]);
    expect(notifications()).toBe(count);
    session.commands.undo();
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false });
    // A facing stays where it is.
    session.commands.rotateEntities([idOf(session, "gate")], "clockwise");
    session.commands.clearTiles([idOf(session, "gate")]);
    expect(session.state.source).toContain("decider gate at (300, 80) facing south {");
  });
});

describe("placeEntityOnTile", () => {
  it("adds an entity with its tile and the edit position the tile is derived from, selects it and puts the tool back", () => {
    const { session, tiles } = board();
    session.commands.setDisplayMode("blueprint");
    session.commands.setTool({ type: "place", kind: "decider" });
    session.commands.placeEntityOnTile("decider", at(6, 3.5));
    // The top-left tile (5, 3) is the card corner (460, 276), on the grid (460, 280).
    expect(session.state.source).toContain("decider decider1 at (460, 280) tile (6, 3.5) {");
    expect(session.state).toMatchObject({ tool: { type: "select" }, selection: [idOf(session, "decider1")], error: null });
    expect(tiles().gate).toEqual(at(3, 0.5));
    session.commands.undo();
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false });
  });

  it("refuses a taken tile without a word and keeps the tool; a tile under an entity without one is free", () => {
    const { session, tiles } = board();
    session.commands.setDisplayMode("blueprint");
    session.commands.setTool({ type: "place", kind: "lamp" });
    session.commands.placeEntityOnTile("lamp", at(0.5, 0.5));
    session.commands.placeEntityOnTile("decider", at(2, 0.5));
    expect(session.state).toMatchObject({ source: BOARD, tool: { type: "place", kind: "lamp" }, error: null, canUndo: false });
    // Where `light` is shown.
    session.commands.placeEntityOnTile("lamp", at(6.5, 1.5));
    expect(tiles()).toMatchObject({ lamp1: at(6.5, 1.5), light: undefined });
  });

  it("moves the edit position on while it is exactly the one of another entity, as a paste does", () => {
    const { session } = board(BOARD.replace("lamp light at (560, 80)", "lamp light at (280, 100)"));
    session.commands.placeEntityOnTile("constant", at(3.5, 1.5));
    expect(entityNamed(session, "constant1")).toMatchObject({ position: at(320, 140), placement: { tile: at(3.5, 1.5) } });
    session.commands.placeEntityOnTile("constant", at(3.5, 2.5));
    expect(entityNamed(session, "constant2").position).toEqual(at(280, 180));
  });

  it("reports a center that is off the grid for the new entity", () => {
    const { session } = board();
    session.commands.placeEntityOnTile("decider", at(8.5, 8.5));
    expect(session.state.error).toContain("not on the tile grid");
    expect(session.state.source).toBe(BOARD);
  });
});

describe("rotating on the board", () => {
  /** The gate lies on (2, 0) and (3, 0); turned a quarter it needs (2, 1), where the lamp stands. */
  const TIGHT = BOARD.replace("lamp light at (560, 80)", "lamp light at (560, 80) tile (2.5, 1.5)");

  it("refuses a turn onto a tile of another entity for the whole selection and says so", () => {
    const { session } = board(TIGHT);
    session.commands.setDisplayMode("blueprint");
    const ids = [idOf(session, "source"), idOf(session, "gate")];
    session.commands.select(ids);
    session.commands.rotateEntities(ids, "clockwise");
    expect(session.state).toMatchObject({ source: TIGHT, canUndo: false, error: "Not rotated: gate would stand on a tile of light." });
    session.commands.dismissError();
    session.commands.rotateEntities(ids, "counterclockwise");
    session.commands.faceEntities([idOf(session, "gate")], "south");
    expect(session.state).toMatchObject({ source: TIGHT, error: "Not rotated: gate would stand on a tile of light." });
    session.commands.dismissError();

    // A half turn keeps both tiles; the constant turns on its one tile; and with the lamp out of the way the quarter turn works.
    session.commands.faceEntities(ids, "west");
    expect(session.state.error).toBeNull();
    expect(session.state.circuit.entities.map(facingOf)).toEqual(["west", "west", "east", "east"]);
    session.commands.clearTiles([idOf(session, "light")]);
    session.commands.rotateEntities(ids, "clockwise");
    expect(entityNamed(session, "gate").placement).toEqual({ tile: at(2.5, 1), direction: "north" });
    expect(session.state.error).toBeNull();
  });

  it("turns an entity without a tile wherever it is shown", () => {
    const { session } = board(TIGHT);
    session.commands.setDisplayMode("blueprint");
    session.commands.rotateEntities([idOf(session, "twice")], "clockwise");
    expect(session.state.source).toContain("arithmetic twice at (300, 240) facing south {");
    expect(session.state.error).toBeNull();
  });

  it("is not refused on the edit canvas, where tiles are not on show: the source then has the overlap warning", () => {
    const { session } = board(TIGHT);
    session.commands.rotateEntities([idOf(session, "gate")], "clockwise");
    expect(entityNamed(session, "gate").placement).toEqual({ tile: at(2.5, 1), direction: "south" });
    expect(session.state.error).toBeNull();
    expect(session.state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["tile-overlap", "tile-overlap"]);
  });
});
