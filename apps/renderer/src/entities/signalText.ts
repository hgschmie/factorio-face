// Text forms of signals used by cards and input fields. The canonical form is the circuit language's `kind:name[@quality]`.
import { parseSignalKey, signalKey, wildcardOf, wildcardSignal, WILDCARDS, type SignalId, type Wildcard } from "@face/model";

/** Canonical text; wildcards print as their keyword (`each`, `anything`, `everything`). */
export function formatSignal(id: SignalId): string {
  return wildcardOf(id) ?? signalKey(id);
}

export function parseSignalText(text: string): SignalId | undefined {
  const trimmed = text.trim();
  if ((WILDCARDS as readonly string[]).includes(trimmed)) return wildcardSignal(trimmed as Wildcard);
  return parseSignalKey(trimmed);
}

/** Compact label for cards: `virtual:signal-A` becomes `A`, other signals keep their name; quality is appended. */
export function shortSignal(id: SignalId): string {
  const wildcard = wildcardOf(id);
  if (wildcard) return wildcard;
  const name = id.kind === "virtual" && id.name.startsWith("signal-") ? id.name.slice("signal-".length) : id.name;
  return id.quality ? `${name}@${id.quality}` : name;
}

/** Signals as exact plain text, `A 5, B 10`; beyond `limit` entries the rest is counted (`+3`). Empty for an empty list. */
export function signalListText(signals: readonly { readonly signal: SignalId; readonly value: number }[], limit = Infinity): string {
  const shown = signals.length > limit ? signals.slice(0, limit) : signals;
  const text = shown.map((entry) => `${shortSignal(entry.signal)} ${entry.value}`).join(", ");
  return signals.length > shown.length ? `${text} +${signals.length - shown.length}` : text;
}

const COMPACT_UNITS: readonly (readonly [number, string])[] = [[1e9, "G"], [1e6, "M"], [1e3, "k"]];
/** Values with more digits than this are abbreviated. */
const COMPACT_FROM = 10_000;

/**
 * A value in at most four characters plus sign, the way the game abbreviates counts: exact below 10000, then `12k`, `999k`,
 * `1.0M`, `2.1G`. Digits are cut off, not rounded, so a value never reads as more than it is.
 */
export function compactNumber(value: number): string {
  const size = Math.abs(value);
  if (size < COMPACT_FROM) return String(value);
  const [unit, suffix] = COMPACT_UNITS.find(([factor]) => size >= factor)!;
  const text = size < 10 * unit ? (Math.trunc(size / (unit / 10)) / 10).toFixed(1) : String(Math.trunc(size / unit));
  return `${value < 0 ? "-" : ""}${text}${suffix}`;
}
