// The wire reach as the settings dialog reads it from its text field.
import { clampWireReach, UNLIMITED_WIRE_REACH, WIRE_REACH_RANGE } from "@face/model";

export const WIRE_REACH_ERROR = `A number from ${WIRE_REACH_RANGE.min} to ${WIRE_REACH_RANGE.max}; ${UNLIMITED_WIRE_REACH} means unlimited`;

/** The reach a text stands for, with a point or a comma before the fraction; a number out of range becomes the nearest end of it. Undefined for a text that is no number. */
export function parseWireReach(text: string): number | undefined {
  const trimmed = text.trim();
  return /^-?\d+([.,]\d+)?$/.test(trimmed) ? clampWireReach(Number(trimmed.replace(",", "."))) : undefined;
}
