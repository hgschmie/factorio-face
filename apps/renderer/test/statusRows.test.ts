import { signal, type SignalId } from "@face/model";
import { describe, expect, it } from "vitest";
import { CARD, PIN_RADIUS } from "../src/canvas/geometry.ts";
import { inputText, layoutRow, RAISED_ROWS, rowPlacement, STATUS_ROWS, TEXT_SIGNALS } from "../src/canvas/statusRows.ts";
import { compactNumber, signalListText } from "../src/entities/signalText.ts";
import type { StatusSignal } from "../src/workbench/controller.ts";

const A = signal("virtual", "signal-A");
const B = signal("virtual", "signal-B");
const PLATE = signal("item", "iron-plate");
const RARE = signal("item", "carbon-fiber", "rare");

const icon = (id: SignalId): string => `icon:${id.name}`;
const entries = (count: number, value = 1): StatusSignal[] => Array.from({ length: count }, (_, index) => ({ signal: signal("virtual", `signal-${index}`), value }));

describe("compact numbers", () => {
  it("keeps values of up to four digits exact", () => {
    expect([0, 1, -1, 42, 999, 1000, 1234, 9999, -9999].map(compactNumber)).toEqual(["0", "1", "-1", "42", "999", "1000", "1234", "9999", "-9999"]);
  });

  it("abbreviates larger values to at most four characters and a sign", () => {
    const cases: readonly (readonly [number, string])[] = [
      [10_000, "10k"], [10_999, "10k"], [12_345, "12k"], [99_999, "99k"], [100_000, "100k"], [999_999, "999k"],
      [1_000_000, "1.0M"], [1_250_000, "1.2M"], [9_999_999, "9.9M"], [10_000_000, "10M"], [999_999_999, "999M"],
      [1_000_000_000, "1.0G"], [1_999_999_999, "1.9G"], [2_147_483_647, "2.1G"],
      [-10_000, "-10k"], [-15_000, "-15k"], [-999_999, "-999k"], [-1_000_000, "-1.0M"], [-2_147_483_648, "-2.1G"],
    ];
    for (const [value, text] of cases) expect(compactNumber(value), String(value)).toBe(text);
    for (let exponent = 0; exponent < 31; exponent++) {
      for (const value of [2 ** exponent, 2 ** exponent - 1, -(2 ** exponent), 1 - 2 ** exponent]) expect(compactNumber(value).replace("-", "").length, String(value)).toBeLessThanOrEqual(4);
    }
  });

  it("cuts digits off instead of rounding up", () => {
    expect(compactNumber(19_999)).toBe("19k");
    expect(compactNumber(-19_999)).toBe("-19k");
    expect(compactNumber(1_990_000)).toBe("1.9M");
  });
});

describe("signal lists as text", () => {
  const list = [{ signal: A, value: 5 }, { signal: PLATE, value: -120 }, { signal: RARE, value: 2_500_000 }];

  it("prints exact values with short names", () => {
    expect(signalListText(list)).toBe("A 5, iron-plate -120, carbon-fiber@rare 2500000");
    expect(signalListText([])).toBe("");
  });

  it("counts what is beyond the limit", () => {
    expect(signalListText(list, 2)).toBe("A 5, iron-plate -120 +1");
    expect(signalListText(list, 3)).toBe("A 5, iron-plate -120, carbon-fiber@rare 2500000");
    expect(signalListText(entries(100), 1)).toBe("0 1 +99");
  });
});

describe("row layout", () => {
  const { contentX, right, icon: iconSize, iconGap, gap, charWidth } = STATUS_ROWS;

  it("keeps the rows between the pins", () => {
    expect(STATUS_ROWS.markerX).toBeGreaterThan(PIN_RADIUS + 2);
    expect(right).toBeLessThan(CARD.width - PIN_RADIUS - 2);
    // Three rows below the body, the last one inside the card.
    expect(STATUS_ROWS.top + 2 * STATUS_ROWS.pitch + iconSize / 2).toBeLessThan(CARD.height - 4);
    expect(STATUS_ROWS.pitch).toBeGreaterThan(iconSize);
  });

  it("places icon and value side by side, one signal after the other", () => {
    const { items, more } = layoutRow([{ signal: A, value: 5 }, { signal: B, value: -12_345 }], icon);
    expect(more).toBe(0);
    expect(items).toEqual([
      { signal: A, line: 0, x: contentX, iconUrl: "icon:signal-A", textX: contentX + iconSize + iconGap, text: "5" },
      { signal: B, line: 0, x: contentX + iconSize + iconGap + charWidth + gap, iconUrl: "icon:signal-B", textX: contentX + 2 * (iconSize + iconGap) + charWidth + gap, text: "-12k" },
    ]);
  });

  it("writes the short name where a signal has no icon", () => {
    const { items, more } = layoutRow([{ signal: A, value: 5 }, { signal: PLATE, value: 7 }, { signal: RARE, value: 1 }], (id) => (id.name === "signal-A" ? "a.png" : undefined));
    expect(items.map((item) => [item.iconUrl, item.text])).toEqual([["a.png", "5"], [undefined, "iron-plate 7"]]);
    expect(more).toBe(1);
    expect(items[1]!.textX).toBe(items[1]!.x);
    // A long name is cut, the value never.
    expect(layoutRow([{ signal: RARE, value: -2_147_483_648 }]).items[0]!.text).toBe("carbon-fibe… -2.1G");
    // Without a describer every signal is text.
    expect(layoutRow([{ signal: A, value: 5 }]).items).toEqual([{ signal: A, line: 0, x: contentX, iconUrl: undefined, textX: contentX, text: "A 5" }]);
  });

  it("shows as many signals as fit and counts the rest", () => {
    const widest = (layout: ReturnType<typeof layoutRow>): number => Math.max(...layout.items.map((item) => item.textX + item.text.length * charWidth));
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 12, 100, 5000]) {
      for (const value of [1, 9999, -2_147_483_648]) {
        const layout = layoutRow(entries(count, value), icon);
        expect(layout.items.length + layout.more, `${count} x ${value}`).toBe(count);
        expect(widest(layout), `${count} x ${value}`).toBeLessThanOrEqual(right);
        if (layout.more > 0) expect(layout.moreX + `+${layout.more}`.length * charWidth, `${count} x ${value}`).toBeLessThanOrEqual(right);
        expect(layout.items.every((item) => item.line === 0)).toBe(true);
      }
    }
    // Single digits: five icons with their value fit; with more signals the marker takes the place of the fifth.
    expect(layoutRow(entries(5), icon)).toMatchObject({ more: 0, items: { length: 5 } });
    expect(layoutRow(entries(6), icon)).toMatchObject({ more: 2, items: { length: 4 } });
    // The widest values: three per row.
    expect(layoutRow(entries(3, -2_147_483_648), icon)).toMatchObject({ more: 0, items: { length: 3 } });
    expect(layoutRow(entries(4, -2_147_483_648), icon)).toMatchObject({ more: 2, items: { length: 2 } });
    expect(layoutRow([], icon)).toEqual({ items: [], more: 0, moreX: contentX });
  });

  it("always places the first signal and only looks at the signals it places", () => {
    const long = { signal: signal("virtual", "a-name-far-too-long-for-a-card"), value: -2_147_483_648 };
    expect(layoutRow([long, long]).items).toHaveLength(1);
    let asked = 0;
    const layout = layoutRow(entries(100_000), (id) => (asked++, icon(id)));
    expect(layout.items.length + layout.more).toBe(100_000);
    expect(asked).toBeLessThan(10);
  });

  it("runs on over several lines when it may, with the marker on the last one", () => {
    const three = layoutRow(entries(40, 12_345), icon, 3);
    expect(new Set(three.items.map((item) => item.line))).toEqual(new Set([0, 1, 2]));
    expect(three.items.length + three.more).toBe(40);
    expect(three.more).toBeGreaterThan(0);
    for (const line of [0, 1, 2]) expect(three.items.find((item) => item.line === line)!.x).toBe(contentX);
    // Lines before the last one are filled without room for the marker.
    expect(three.items.filter((item) => item.line === 0).length).toBeGreaterThan(three.items.filter((item) => item.line === 2).length);
    // What fits on one line stays on it.
    expect(layoutRow(entries(3), icon, 3).items.every((item) => item.line === 0)).toBe(true);
  });
});

describe("rows of a card with pins on its bottom edge", () => {
  /** Top of the first row's icons and bottom of the last row's, the tallest things in a row. */
  const extent = ({ top, pitch }: { readonly top: number; readonly pitch: number }) => [top - STATUS_ROWS.icon / 2, top + 2 * pitch + STATUS_ROWS.icon / 2] as const;

  it("leaves the rows of every other card where they were", () => {
    expect(rowPlacement(false)).toBe(STATUS_ROWS);
    expect([STATUS_ROWS.top, STATUS_ROWS.pitch]).toEqual([84, 16]);
  });

  it("moves the rows up and together, clear of the pins below and of the divider above", () => {
    expect(rowPlacement(true)).toBe(RAISED_ROWS);
    const [top, bottom] = extent(RAISED_ROWS);
    // The pins reach their radius and half their outline into the card; the divider above the rows is at 72.5.
    expect(bottom).toBeLessThanOrEqual(CARD.height - PIN_RADIUS - 1 - 1.5);
    expect(top).toBeGreaterThanOrEqual(72.5 + 2);
    expect(extent(STATUS_ROWS)[1]).toBeGreaterThan(CARD.height - PIN_RADIUS - 1);
    // Three rows of icons still do not touch each other.
    expect(RAISED_ROWS.pitch).toBeGreaterThanOrEqual(STATUS_ROWS.icon + 2);
  });
});

describe("an input row as text", () => {
  const signals = [{ signal: A, value: 5 }, { signal: PLATE, value: -2_147_483_648 }];

  it("names an input without a wire, an empty network and the signals", () => {
    expect(inputText({ wired: false, signals: [] })).toBe("no wire");
    expect(inputText({ wired: true, signals: [] })).toBe("nothing");
    expect(inputText({ wired: true, signals })).toBe("A 5, iron-plate -2147483648");
  });

  it("bounds the text of a network with very many signals", () => {
    expect(inputText({ wired: true, signals: entries(TEXT_SIGNALS) })).not.toContain("+");
    expect(inputText({ wired: true, signals: entries(TEXT_SIGNALS + 5) }).endsWith(` +5`)).toBe(true);
  });
});
