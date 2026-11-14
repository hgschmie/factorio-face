// The status rows of a card: which signals of a row fit, where they go, and an input row as plain text. Pure.
import type { SignalId } from "@face/model";
import { compactNumber, shortSignal, signalListText } from "../entities/signalText.ts";
import { truncate } from "../entities/summary.ts";
import type { ConditionStatus, StatusInput, StatusSignal } from "../workbench/controller.ts";
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

/** Characters of the 9px row text that fit a row that is one text: the state of a speaker. */
export const STATE_ROW_CHARS = Math.floor((STATUS_ROWS.right - STATUS_ROWS.contentX) / STATUS_ROWS.charWidth);

/** Signals named per input row in the card's data attributes; a network can carry thousands. */
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

/** What a combinator emits, in a few characters, for the blueprint board: the first signal, the number of the others, a dash for nothing. */
export function compactOutput(signals: readonly StatusSignal[], maxChars: number): string {
  const first = signals[0];
  if (!first) return "–";
  return truncate(`${shortSignal(first.signal)} ${compactNumber(first.value)}${signals.length > 1 ? ` +${signals.length - 1}` : ""}`, maxChars);
}

/** The mark in front of a condition in its row: its edge, the space to the label, and the space to the next condition. Set closer than signals, so that two sides of a splitter fit a row. */
export const CONDITION_MARK = { size: 6, gap: 3, between: 6 } as const;

export interface ConditionItem {
  readonly key: string;
  readonly holds: boolean;
  /** Left edge of the mark, in card units. */
  readonly x: number;
  readonly textX: number;
  /** `enabled` or `disabled` for the condition that enables the entity, what it decides for every other one (the mark says whether it holds). */
  readonly label: string;
}

export interface ConditionLayout {
  readonly items: readonly ConditionItem[];
  /** Conditions that did not fit; drawn as `+N` at `moreX`. */
  readonly more: number;
  readonly moreX: number;
}

/**
 * The row of the circuit conditions of a generic entity: each a mark that is filled while the condition holds and a label, in
 * the order of the settings, as many as fit between the marker column and `right`, with room for `+N` while conditions remain.
 * The first one is always placed.
 */
export function layoutConditions(conditions: readonly ConditionStatus[]): ConditionLayout {
  const { markerX, right } = STATUS_ROWS;
  const lead = CONDITION_MARK.size + CONDITION_MARK.gap;
  const gap = CONDITION_MARK.between;
  const items: ConditionItem[] = [];
  let x: number = markerX;
  for (const [index, condition] of conditions.entries()) {
    const label = condition.role ?? (condition.holds ? "enabled" : "disabled");
    const width = lead + textWidth(label);
    const remaining = conditions.length - index - 1;
    if (index > 0 && x + width + (remaining > 0 ? gap + textWidth(`+${remaining}`) : 0) > right) return { items, more: remaining + 1, moreX: x };
    items.push({ key: condition.key, holds: condition.holds, x, textX: x + lead, label });
    x += width + gap;
  }
  return { items, more: 0, moreX: x };
}
