// Signal identity. Mirrors Factorio's SignalID (type, name, quality) and adds a "custom" kind for user-defined signals,
// which have no blueprint representation.

export const STANDARD_SIGNAL_KINDS = ["item", "fluid", "virtual", "entity", "recipe", "space-location", "asteroid-chunk", "quality"] as const;
export const SIGNAL_KINDS = [...STANDARD_SIGNAL_KINDS, "custom"] as const;

export type StandardSignalKind = (typeof STANDARD_SIGNAL_KINDS)[number];
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const NORMAL_QUALITY = "normal";

export interface SignalId {
  readonly kind: SignalKind;
  readonly name: string;
  /** Quality prototype name; absent means "normal". Never store "normal" explicitly, so identity stays canonical. */
  readonly quality?: string;
}

const NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export function isSignalKind(value: string): value is SignalKind {
  return (SIGNAL_KINDS as readonly string[]).includes(value);
}

export function isValidSignalName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

export function signal(kind: SignalKind, name: string, quality?: string): SignalId {
  return quality && quality !== NORMAL_QUALITY ? { kind, name, quality } : { kind, name };
}

/** Canonical text form, also used by the circuit language: `kind:name` or `kind:name@quality`. */
export function signalKey(id: SignalId): string {
  return id.quality && id.quality !== NORMAL_QUALITY ? `${id.kind}:${id.name}@${id.quality}` : `${id.kind}:${id.name}`;
}

export function parseSignalKey(key: string): SignalId | undefined {
  const match = /^([a-z-]+):([^@]+)(?:@(.+))?$/.exec(key);
  if (!match) return undefined;
  const [, kind, name, quality] = match;
  if (!kind || !name || !isSignalKind(kind) || !isValidSignalName(name) || (quality !== undefined && !isValidSignalName(quality))) return undefined;
  return signal(kind, name, quality);
}

export function sameSignal(a: SignalId, b: SignalId): boolean {
  return a.kind === b.kind && a.name === b.name && (a.quality ?? NORMAL_QUALITY) === (b.quality ?? NORMAL_QUALITY);
}

// The three wildcard signals are ordinary virtual signals in blueprints but typed constructs in the language and model.
export const WILDCARDS = ["everything", "anything", "each"] as const;
export type Wildcard = (typeof WILDCARDS)[number];

export function wildcardSignal(wildcard: Wildcard): SignalId {
  return { kind: "virtual", name: `signal-${wildcard}` };
}

export function wildcardOf(id: SignalId): Wildcard | undefined {
  if (id.kind !== "virtual") return undefined;
  return WILDCARDS.find((w) => id.name === `signal-${w}`);
}
