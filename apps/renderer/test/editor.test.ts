import { describe, expect, it } from "vitest";
import { highlightRanges, minimalChange, tokenClass } from "../src/editor/tokens.ts";
import { sparkline } from "../src/simulation/sparkline.ts";

describe("token classes", () => {
  it("maps known kinds, ignores unknown ones and honors overrides", () => {
    expect(tokenClass("keyword")).toBe("face-tok-keyword");
    expect(tokenClass("Integer")).toBe("face-tok-number");
    expect(tokenClass("whitespace")).toBeUndefined();
    expect(tokenClass("whitespace", { whitespace: "comment" })).toBe("face-tok-comment");
  });

  it("produces sorted, clamped, non-overlapping ranges", () => {
    const tokens = [
      { kind: "string", from: 8, to: 20 },
      { kind: "keyword", from: 0, to: 7 },
      { kind: "whitespace", from: 7, to: 8 },
      { kind: "number", from: 10, to: 12 },
      { kind: "comment", from: 30, to: 400 },
      { kind: "keyword", from: 25, to: 25 },
      { kind: "keyword", from: -5, to: 0 },
    ];
    expect(highlightRanges(tokens, 40)).toEqual([
      { from: 0, to: 7, className: "face-tok-keyword" },
      { from: 8, to: 20, className: "face-tok-string" },
      { from: 30, to: 40, className: "face-tok-comment" },
    ]);
  });
});

describe("minimal change between two documents", () => {
  const apply = (before: string, change: { from: number; to: number; insert: string }): string => before.slice(0, change.from) + change.insert + before.slice(change.to);

  it("is undefined for equal texts", () => {
    expect(minimalChange("same", "same")).toBeUndefined();
  });

  it("replaces only the differing middle", () => {
    expect(minimalChange("at (40, 80) {", "at (60, 80) {")).toEqual({ from: 4, to: 5, insert: "6" });
    expect(minimalChange("abc", "abXYc")).toEqual({ from: 2, to: 2, insert: "XY" });
    expect(minimalChange("abXYc", "abc")).toEqual({ from: 2, to: 4, insert: "" });
  });

  it("reproduces the target for awkward inputs", () => {
    for (const [before, after] of [["", "abc"], ["abc", ""], ["aaa", "aaaa"], ["aaaa", "aa"], ["abab", "ab"], ["x\ny\n", "x\nz\ny\n"]] as const) {
      expect(apply(before, minimalChange(before, after)!)).toBe(after);
    }
  });
});

describe("sparkline", () => {
  it("spreads values over the capacity and includes zero in the range", () => {
    const geometry = sparkline([0, 5, 10], 5, 400, 26, 3);
    expect(geometry.path).toBe("M 0 23 L 100 13 L 200 3");
    expect(geometry.baseline).toBe(23);
    expect(geometry.last).toEqual({ x: 200, y: 3 });
  });

  it("handles negative values, flat series and no data", () => {
    expect(sparkline([-10, 10], 2, 100, 26, 3).baseline).toBe(13);
    expect(sparkline([0, 0], 2, 100, 26, 3).path).toBe("M 0 23 L 100 23");
    expect(sparkline([], 80, 100, 26)).toEqual({ path: "", baseline: 23, last: null });
  });

  it("shows only the most recent values when there are more than the capacity", () => {
    expect(sparkline([9, 9, 9, 0, 4], 2, 100, 26, 3).path).toBe("M 0 23 L 100 3");
  });
});
