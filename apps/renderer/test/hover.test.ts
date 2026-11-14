// The popup that follows the pointer: when it appears, moves on and goes, and what the board asks before it shows its bubble.
import type { Entity } from "@face/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bubbleAllowed, entityAt, HOVER_DELAY_MS, HOVER_LINGER_MS, HoverIntent } from "../src/canvas/hover.ts";

describe("HoverIntent", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  function intent() {
    const shown: (string | null)[] = [];
    return { hover: new HoverIntent<string>((target) => void shown.push(target)), shown };
  }

  it("shows a target once the pointer has rested on it for the delay", () => {
    const { hover, shown } = intent();
    hover.over("a");
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1);
    expect(shown).toEqual([]);
    // More events over the same target do not start the wait again.
    hover.over("a");
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["a"]);
    hover.over("a");
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual(["a"]);
  });

  it("shows nothing for targets the pointer only crosses", () => {
    const { hover, shown } = intent();
    for (const target of ["a", "b", null, "c", "d"]) {
      hover.over(target);
      vi.advanceTimersByTime(HOVER_DELAY_MS - 50);
    }
    hover.over(null);
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual([]);
  });

  it("moves on to another target at once while one is on show", () => {
    const { hover, shown } = intent();
    hover.over("a");
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    hover.over("b");
    expect(shown).toEqual(["a", "b"]);
    hover.over("c");
    expect(shown).toEqual(["a", "b", "c"]);
  });

  it("goes shortly after the pointer has left, and a target entered meanwhile takes over without a gap", () => {
    const { hover, shown } = intent();
    hover.over("a");
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    hover.over(null);
    vi.advanceTimersByTime(HOVER_LINGER_MS - 1);
    expect(shown).toEqual(["a"]);
    // Across the gap between two targets: no null in between.
    hover.over("b");
    expect(shown).toEqual(["a", "b"]);
    // Back onto the target on show while it lingers: it just stays.
    hover.over(null);
    hover.over("b");
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual(["a", "b"]);
    hover.over(null);
    vi.advanceTimersByTime(HOVER_LINGER_MS);
    expect(shown).toEqual(["a", "b", null]);
    // Gone, so the next target waits again.
    hover.over("c");
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1);
    expect(shown).toEqual(["a", "b", null]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["a", "b", null, "c"]);
  });

  it("drops everything at once on a reset: what is shown, and what was about to be", () => {
    const { hover, shown } = intent();
    hover.over("a");
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    hover.reset();
    expect(shown).toEqual(["a", null]);
    hover.reset();
    expect(shown).toEqual(["a", null]);
    hover.over("b");
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1);
    hover.reset();
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual(["a", null]);
    // The same target again waits again.
    hover.over("b");
    expect(shown).toEqual(["a", null]);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(shown).toEqual(["a", null, "b"]);
  });

  it("runs on the timers it is given", () => {
    const pending: (() => void)[] = [];
    const shown: (number | null)[] = [];
    const hover = new HoverIntent<number>((target) => void shown.push(target), { set: (callback) => pending.push(callback), clear: (handle) => void (pending[(handle as number) - 1] = () => undefined) });
    hover.over(1);
    hover.over(2);
    for (const callback of pending) callback();
    expect(shown).toEqual([2]);
  });
});

describe("the bubble of the board", () => {
  it("is allowed on the board with the select tool, while nothing is pressed and no menu is open", () => {
    const allowed = { board: true, selecting: true, pressed: false, menuOpen: false };
    expect(bubbleAllowed(allowed)).toBe(true);
    expect(bubbleAllowed({ ...allowed, board: false })).toBe(false);
    expect(bubbleAllowed({ ...allowed, selecting: false })).toBe(false);
    expect(bubbleAllowed({ ...allowed, pressed: true })).toBe(false);
    expect(bubbleAllowed({ ...allowed, menuOpen: true })).toBe(false);
  });

  it("finds the entity whose rectangle holds the pointer, the one drawn last where two share a place", () => {
    const entities = ["a", "b", "c"].map((id) => ({ id }) as Entity);
    const rects: Readonly<Record<string, { x: number; y: number; width: number; height: number }>> = { a: { x: 0, y: 0, width: 80, height: 80 }, b: { x: 160, y: 0, width: 160, height: 80 }, c: { x: 240, y: 0, width: 80, height: 80 } };
    const at = (x: number, y: number): string | undefined => entityAt(entities, (entity) => rects[entity.id]!, { x, y })?.id;
    expect(at(40, 40)).toBe("a");
    expect(at(0, 0)).toBe("a");
    // The right and the bottom edge belong to the next tile.
    expect(at(80, 40)).toBeUndefined();
    expect(at(40, 80)).toBeUndefined();
    expect(at(100, 40)).toBeUndefined();
    expect(at(200, 40)).toBe("b");
    expect(at(260, 40)).toBe("c");
    expect(at(-1, 40)).toBeUndefined();
  });
});
