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
