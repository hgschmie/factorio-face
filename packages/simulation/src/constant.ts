import { wildcardOf, type ConstantCombinator } from "@face/model";
import { toInt32 } from "./int32.ts";
import { Accumulator, type SignalMap, type SignalTable } from "./signals.ts";

const SNAP = 1e-12;

/**
 * C-ROUND (F-20): `count * multiplier` in double precision, truncated toward zero, then wrapped to int32. A product within a
 * relative 1e-12 (at most 0.25 absolute) of an integer snaps to it first, so that binary representation error
 * (0.29 * 100 = 28.999999999999996) cannot make a value one smaller.
 */
export function applyMultiplier(count: number, multiplier: number): number {
  const product = count * multiplier;
  const nearest = Math.round(product);
  return toInt32(Math.abs(product - nearest) <= Math.min(0.25, SNAP * Math.max(1, Math.abs(product))) ? nearest : Math.trunc(product));
}

/** Sum over all active sections, wrapping per signal; nothing when switched off. Wildcard filters are skipped (static note). */
export function constantOutput(entity: ConstantCombinator, signals: SignalTable): SignalMap {
  const output = new Accumulator();
  if (!entity.enabled) return output.result();
  for (const section of entity.sections) {
    if (!section.active) continue;
    for (const filter of section.filters) {
      if (!wildcardOf(filter.signal)) output.add(signals.intern(filter.signal), applyMultiplier(filter.count, section.multiplier));
    }
  }
  return output.result();
}
