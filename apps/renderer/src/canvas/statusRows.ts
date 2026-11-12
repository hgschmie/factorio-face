// The status rows of a card: which signals of a row fit, where they go, and the rows as plain text. Pure.
import type { SignalId } from "@face/model";
import { compactNumber, shortSignal, signalListText } from "../entities/signalText.ts";
import { truncate } from "../entities/summary.ts";
import type { EntityStatus, StatusInput, StatusSignal } from "../workbench/controller.ts";
import { CARD } from "./geometry.ts";

/**
 * Geometry of the rows in card units. A row starts with a marker and holds its signals from `contentX` to `right`, which
 * keeps it clear of the pins: they reach 7 units into the card and the first row lies at the height of the green pin.
 */
export const STATUS_ROWS = {
  /** Vertical center of the first row and the distance to the next: red input, green input, output (or the lamp's state). */
  top: 84,
  pitch: 16,
  markerX: 13,
  contentX: 24,
  right: CARD.width - 13,
  icon: 13,
  /** Between an icon and its value. */
  iconGap: 2,
  /** Between two signals. */
  gap: 7,
  /** Advance of one character of the 9px monospace row text, rounded up (SF Mono and Menlo: 5.42). */
  charWidth: 5.5,
  /** Characters of a signal name that is written out because it has no icon. */
  nameChars: 12,
} as const;

/**
 * Where the rows of a card with pins on its bottom edge go: higher and closer together, so that the last row stays clear of
 * those pins as the other rows do of the pins on the sides.
 */
export const RAISED_ROWS = { top: 82, pitch: 15 } as const;

/** Vertical center of the first row and the distance to the next, for a card with or without pins on its bottom edge. */
export function rowPlacement(pinsBelow: boolean): { readonly top: number; readonly pitch: number } {
  return pinsBelow ? RAISED_ROWS : STATUS_ROWS;
}

/** Signals named per row in the tooltip and in the card's data attributes; a network can carry thousands. */
export const TEXT_SIGNALS = 32;

export interface RowItem {
  readonly signal: SignalId;
  /** Line of the row, from 0. */
  readonly line: number;
  /** Left edge, in card units. */
  readonly x: number;
  /** The signal's icon, drawn at `x`; without one `text` starts with the short name instead. */
  readonly iconUrl?: string;
  readonly textX: number;
  /** The value in compact form, behind the short name when there is no icon. */
  readonly text: string;
}

export interface RowLayout {
  readonly items: readonly RowItem[];
  /** Signals that did not fit; drawn as `+N` at `moreX` on the last line. */
  readonly more: number;
  readonly moreX: number;
}

function textWidth(text: string): number {
  return text.length * STATUS_ROWS.charWidth;
}

/**
 * Places as many signals as fit between `contentX` and `right`, in order, on up to `lines` lines, and keeps room on the last
 * line for the `+N` marker while signals remain. The first signal of a line is always placed. Looks at no more signals than
 * it places, however long the list is.
 */
export function layoutRow(signals: readonly StatusSignal[], iconOf?: (signal: SignalId) => string | undefined, lines = 1): RowLayout {
  const { contentX, right, icon: iconSize, iconGap, gap, nameChars } = STATUS_ROWS;
  const items: RowItem[] = [];
  let line = 0;
  let x: number = contentX;
  for (const [index, entry] of signals.entries()) {
    const iconUrl = iconOf?.(entry.signal);
    const text = iconUrl ? compactNumber(entry.value) : `${truncate(shortSignal(entry.signal), nameChars)} ${compactNumber(entry.value)}`;
    const lead = iconUrl ? iconSize + iconGap : 0;
    const width = lead + textWidth(text);
    const remaining = signals.length - index - 1;
    const last = line === lines - 1;
    if (x > contentX && x + width + (last && remaining > 0 ? gap + textWidth(`+${remaining}`) : 0) > right) {
      if (last) return { items, more: remaining + 1, moreX: x };
      line++;
      x = contentX;
    }
    items.push({ signal: entry.signal, line, x, iconUrl, textX: x + lead, text });
    x += width + gap;
  }
  return { items, more: 0, moreX: x };
}

/** What an entity reads on one color, as exact text: the signals, `nothing` on an empty network, `no wire` without a wire. */
export function inputText(input: StatusInput): string {
  if (!input.wired) return "no wire";
  return signalListText(input.signals, TEXT_SIGNALS) || "nothing";
}

/** What an entity emits, as exact text. */
export function outputText(output: readonly StatusSignal[]): string {
  return signalListText(output, TEXT_SIGNALS) || "nothing";
}

/** The rows in full for the card's tooltip, one line each. */
export function statusLines(status: EntityStatus): string[] {
  const lines: string[] = [];
  if (status.input) lines.push(`Red in: ${inputText(status.input.red)}`, `Green in: ${inputText(status.input.green)}`);
  if (status.output) lines.push(`Out: ${outputText(status.output)}`);
  if (status.lamp) lines.push(`Light: ${status.label}`);
  return lines;
}
