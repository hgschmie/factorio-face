// Where the signal picker opens beside the inspector, and how high its list of signals gets.
import { describe, expect, it } from "vitest";
import { pickerPlacement } from "../src/picker/SignalPicker.tsx";

/** Search, tabs, the room around the list and the border, as the panel has them without a row of qualities. */
const CHROME = 106;
/** The top of the status line in a window of the default height and of the smallest. */
const [DEFAULT_BOTTOM, SMALLEST_BOTTOM] = [960 - 27, 760 - 27];
const ROW = 39;

describe("the place of the signal picker", () => {
  it("is level with its field where the panel then ends above the status line", () => {
    expect(pickerPlacement(200, CHROME, DEFAULT_BOTTOM)).toEqual({ top: 200, listHeight: 10 * ROW - 3 });
    expect(pickerPlacement(0, CHROME, DEFAULT_BOTTOM).top).toBe(8);
  });

  it("moves up from a field low in the inspector, as far as keeps it a margin above the status line", () => {
    for (const bottom of [DEFAULT_BOTTOM, SMALLEST_BOTTOM]) {
      for (const fieldTop of [400, 690, bottom - 20, bottom + 100]) {
        const { top, listHeight } = pickerPlacement(fieldTop, CHROME, bottom);
        expect(top + CHROME + listHeight, `${fieldTop} of ${bottom}`).toBeLessThanOrEqual(bottom - 8);
        expect(top, `${fieldTop} of ${bottom}`).toBeGreaterThanOrEqual(8);
        expect(top, `${fieldTop} of ${bottom}`).toBeLessThanOrEqual(fieldTop);
      }
    }
    // The field of the screenshot: the panel ends 8 above the status line and no longer on it.
    expect(pickerPlacement(690, CHROME, DEFAULT_BOTTOM)).toEqual({ top: 933 - 8 - 106 - 387, listHeight: 387 });
  });

  it("gives the list a whole number of rows, as many as a panel of 520 has room for", () => {
    for (const chrome of [80, CHROME, 106 + 47, 106 + 39, 200]) {
      const { listHeight } = pickerPlacement(300, chrome, DEFAULT_BOTTOM);
      // Rows of 36 with 3 between them: the list ends with a row.
      expect((listHeight + 3) % ROW, String(chrome)).toBe(0);
      expect(chrome + listHeight, String(chrome)).toBeLessThanOrEqual(520);
      expect(chrome + listHeight + ROW, String(chrome)).toBeGreaterThan(520);
    }
  });

  it("places the panel for the highest list, in an area lower than the panel may get too", () => {
    // 400 of room: 400 - 16 - 106 = 278 for the list, which is seven rows.
    expect(pickerPlacement(300, CHROME, 400)).toEqual({ top: 400 - 8 - 106 - 270, listHeight: 270 });
    // Never fewer than three rows, and never above the top margin.
    expect(pickerPlacement(300, CHROME, 150)).toEqual({ top: 8, listHeight: 114 });
  });
});
