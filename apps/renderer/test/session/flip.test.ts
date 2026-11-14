// Flipping a selection through the session: one entity, a group on the edit canvas and on the board, a refused flip, undo.
import { facingOf, type Point } from "@face/model";
import { describe, expect, it } from "vitest";
import { createSession, entityNamed, errorsOf, idOf, IRREGULAR } from "./helpers.ts";

/** Row 0: `source` on (0, 0), `gate` on (2..3, 0), `light` on (7, 0). `twice` stands upright on (5, 1..2); `loose` has no tile. */
const BOARD = `circuit "Board" {
    constant source at (40, 80) tile (0.5, 0.5) {
        virtual:signal-A = 1
    }

    decider gate at (300, 80) tile (3, 0.5) {   // the counter
        when virtual:signal-A < 10
        output virtual:signal-A = input
    }

    arithmetic twice at (300, 260) tile (5.5, 2) facing south {
        virtual:signal-B = virtual:signal-A[red] * 2
    }

    lamp light at (560, 80) tile (7.5, 0.5) {
        when virtual:signal-B > 8
    }

    decider loose at (40, 400) facing north {
        when virtual:signal-A > 3
        output virtual:signal-C = 1
    }

    wire red source.out <-> gate.in
    wire green gate.out <-> twice.in
}
`;

const at = (x: number, y: number): Point => ({ x, y });

function start(source: string, display: "edit" | "blueprint") {
  const created = createSession(source);
  const { session } = created;
  session.commands.setDisplayMode(display);
  const ids = (...names: string[]): string[] => names.map((name) => idOf(session, name));
  const facings = (): Record<string, string> => Object.fromEntries(session.state.circuit.entities.map((entity) => [entity.name, facingOf(entity)]));
  const tiles = (): Record<string, Point | undefined> => Object.fromEntries(session.state.circuit.entities.map((entity) => [entity.name, entity.placement?.tile]));
  const positions = (): Record<string, Point> => Object.fromEntries(session.state.circuit.entities.map((entity) => [entity.name, entity.position]));
  return { ...created, ids, facings, tiles, positions };
}

describe("flipping one entity", () => {
  it("turns east into west and back with a horizontal flip, and leaves it alone with a vertical one", () => {
    const { session, ids } = start(IRREGULAR, "edit");
    session.commands.flipEntities(ids("gate"), "horizontal");
    expect(session.state.source).toBe(IRREGULAR.replace("gate at (300, 80)", "gate at (300, 80) facing west"));
    expect(errorsOf(session)).toEqual([]);
    session.commands.flipEntities(ids("gate"), "vertical");
    expect(facingOf(entityNamed(session, "gate"))).toBe("west");
    session.commands.flipEntities(ids("gate"), "horizontal");
    expect(session.state.source).toBe(IRREGULAR.replace("gate at (300, 80)", "gate at (300, 80) facing east"));
    // Two steps: the vertical flip changed nothing and is none.
    session.commands.undo();
    session.commands.undo();
    expect(session.state).toMatchObject({ source: IRREGULAR, canUndo: false });
  });

  it("turns north into south with a vertical flip", () => {
    const { session, ids, facings } = start(BOARD, "edit");
    session.commands.flipEntities(ids("loose"), "vertical");
    expect(facings().loose).toBe("south");
    session.commands.flipEntities(ids("loose"), "horizontal");
    expect(facings().loose).toBe("south");
    session.commands.flipEntities(ids("twice"), "vertical");
    expect(facings().twice).toBe("north");
  });

  it("does nothing to a single lamp: no change, no undo step, no message", () => {
    for (const display of ["edit", "blueprint"] as const) {
      const { session, ids, notifications } = start(BOARD, display);
      const before = notifications();
      session.commands.flipEntities(ids("light"), "horizontal");
      session.commands.flipEntities(ids("light"), "vertical");
      session.commands.flipEntities(["nope"], "vertical");
      session.commands.flipEntities([], "vertical");
      expect(session.state).toMatchObject({ source: BOARD, canUndo: false, error: null });
      expect(notifications()).toBe(before);
    }
  });

  it("keeps the tiles of a combinator on the board and swaps its ends", () => {
    const { session, ids, tiles, facings } = start(BOARD, "blueprint");
    session.commands.flipEntities(ids("gate"), "horizontal");
    expect(session.state.source).toBe(BOARD.replace("gate at (300, 80) tile (3, 0.5)", "gate at (300, 80) tile (3, 0.5) facing west"));
    expect(tiles().gate).toEqual(at(3, 0.5));
    session.commands.flipEntities(ids("twice"), "vertical");
    expect(facings().twice).toBe("north");
    expect(tiles().twice).toEqual(at(5.5, 2));
  });
});

describe("flipping a group on the edit canvas", () => {
  it("mirrors the card positions within the bounds of the selection and flips each direction, as one undo step", () => {
    const { session, ids, positions, facings, tiles } = start(BOARD, "edit");
    const selection = ids("source", "gate", "light", "loose");
    session.commands.select(selection);
    session.commands.flipEntities(selection, "horizontal");
    expect(positions()).toEqual({ source: at(560, 80), gate: at(300, 80), twice: at(300, 260), light: at(40, 80), loose: at(560, 400) });
    expect(facings()).toEqual({ source: "west", gate: "west", twice: "south", light: "east", loose: "north" });
    // The tiles are the board's business: a flipped direction covers the same ones, so they stay.
    expect(tiles()).toEqual({ source: at(0.5, 0.5), gate: at(3, 0.5), twice: at(5.5, 2), light: at(7.5, 0.5), loose: undefined });
    expect(session.state.selection).toEqual(selection);
    expect(session.state.circuit.wires).toHaveLength(2);
    expect(session.state.source).toContain("// the counter");
    expect(errorsOf(session)).toEqual([]);

    session.commands.undo();
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false });
    session.commands.redo();
    session.commands.flipEntities(selection, "vertical");
    expect(positions()).toEqual({ source: at(560, 400), gate: at(300, 400), twice: at(300, 260), light: at(40, 400), loose: at(560, 80) });
    expect(facings()).toMatchObject({ source: "west", gate: "west", loose: "south" });
    // Both flips again put everything back, facing clauses aside.
    session.commands.flipEntities(selection, "horizontal");
    session.commands.flipEntities(selection, "vertical");
    expect(positions()).toEqual({ source: at(40, 80), gate: at(300, 80), twice: at(300, 260), light: at(560, 80), loose: at(40, 400) });
    expect(facings()).toEqual({ source: "east", gate: "east", twice: "south", light: "east", loose: "north" });
  });

  it("is never refused there, whatever stands in between", () => {
    const { session, ids, positions } = start(BOARD, "edit");
    session.commands.flipEntities(ids("source", "twice"), "horizontal");
    expect(session.state.error).toBeNull();
    expect(positions()).toMatchObject({ source: at(300, 80), twice: at(40, 260) });
  });
});

describe("flipping a group on the board", () => {
  it("mirrors the tiles of the placed entities, keeps every footprint on the grid and leaves the edit positions alone", () => {
    const { session, ids, positions, facings, tiles } = start(BOARD, "blueprint");
    const before = positions();
    const selection = ids("source", "gate", "twice", "light");
    session.commands.flipEntities(selection, "horizontal");
    // Columns 0 to 7.
    expect(tiles()).toEqual({ source: at(7.5, 0.5), gate: at(5, 0.5), twice: at(2.5, 2), light: at(0.5, 0.5), loose: undefined });
    expect(facings()).toEqual({ source: "west", gate: "west", twice: "south", light: "east", loose: "north" });
    expect(positions()).toEqual(before);
    expect(session.state.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("tile"))).toEqual([]);
    expect(session.state.error).toBeNull();
    session.commands.undo();
    expect(session.state).toMatchObject({ source: BOARD, canUndo: false });

    // Rows 0 to 2.
    session.commands.flipEntities(selection, "vertical");
    expect(tiles()).toEqual({ source: at(0.5, 2.5), gate: at(3, 2.5), twice: at(5.5, 1), light: at(7.5, 2.5), loose: undefined });
    expect(facings()).toMatchObject({ source: "east", gate: "east", twice: "north" });
    expect(session.state.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("tile"))).toEqual([]);
    session.commands.undo();
    expect(session.state.source).toBe(BOARD);
  });

  it("only turns a selected entity without a tile: it gets none and stays where it is shown", () => {
    const { session, ids, tiles, facings } = start(BOARD, "blueprint");
    session.commands.flipEntities(ids("source", "light", "loose"), "vertical");
    // One row: the two placed entities keep their tiles; `loose` faces south now and still has no tile.
    expect(tiles()).toEqual({ source: at(0.5, 0.5), gate: at(3, 0.5), twice: at(5.5, 2), light: at(7.5, 0.5), loose: undefined });
    expect(facings().loose).toBe("south");
    expect(session.state.source).toBe(BOARD.replace("loose at (40, 400) facing north", "loose at (40, 400) facing south"));
    session.commands.flipEntities(ids("source", "light", "loose"), "horizontal");
    expect(tiles()).toMatchObject({ source: at(7.5, 0.5), light: at(0.5, 0.5), loose: undefined });
  });

  it("refuses a flip onto a tile of an entity outside the selection: nothing changes, and the message goes with the selection", () => {
    const { session, ids } = start(BOARD, "blueprint");
    // Free tiles are no obstacle: source and twice span the rows 0 to 2, source goes to (0, 2) and twice stays on (5, 1..2).
    const selection = ids("source", "twice");
    session.commands.select(selection);
    session.commands.flipEntities(selection, "vertical");
    expect(session.state.error).toBeNull();
    session.commands.undo();

    const blocked = ids("source", "light");
    session.commands.select(blocked);
    session.commands.setTiles([{ id: idOf(session, "light"), tile: at(3.5, 1.5) }]);
    const placed = session.state.source;
    // Columns 0 to 3, rows 0 to 1: source would go to (3, 0), a tile of gate.
    session.commands.flipEntities(blocked, "horizontal");
    expect(session.state.source).toBe(placed);
    expect(session.state.error).toBe("Not flipped: source would stand on a tile of gate.");
    // Not an undo step, and the message is about this selection.
    session.commands.undo();
    expect(session.state.source).toBe(BOARD);
    session.commands.redo();
    session.commands.flipEntities(blocked, "horizontal");
    expect(session.state.error).toBe("Not flipped: source would stand on a tile of gate.");
    session.commands.select(ids("gate"));
    expect(session.state.error).toBeNull();
    // With gate in the selection the same flip works.
    const all = ids("source", "light", "gate");
    session.commands.flipEntities(all, "horizontal");
    expect(session.state.error).toBeNull();
    expect(session.state.source).not.toBe(placed);
  });

  it("does nothing while the source has errors", () => {
    const { session, ids } = start(BOARD, "blueprint");
    const gate = ids("gate");
    session.commands.setSource(BOARD.replace("< 10", "<"));
    const broken = session.state.source;
    session.commands.flipEntities(gate, "horizontal");
    expect(session.state.source).toBe(broken);
  });
});
