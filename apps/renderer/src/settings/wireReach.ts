// The wire reach as the settings dialog reads it from its text field.
import { isWireReach, WIRE_REACH_RANGE } from "@face/model";

export const WIRE_REACH_ERROR = `A number from ${WIRE_REACH_RANGE.min} to ${WIRE_REACH_RANGE.max}`;

/** The reach a text stands for, with a point or a comma before the fraction; undefined for anything that is not a reach in range. */
export function parseWireReach(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return undefined;
  const value = Number(trimmed.replace(",", "."));
  return isWireReach(value) ? value : undefined;
}
