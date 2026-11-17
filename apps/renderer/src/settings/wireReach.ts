// The wire reach as the settings dialog reads it from its text field, and what the dialog says about it in short.
import { clampWireReach, DEFAULT_WIRE_REACH, UNLIMITED_WIRE_REACH, WIRE_REACH_RANGE } from "@face/model";

export const WIRE_REACH_ERROR = `A number from ${WIRE_REACH_RANGE.min} to ${WIRE_REACH_RANGE.max}; ${UNLIMITED_WIRE_REACH} means unlimited`;
/** The line under the field. How the distance is measured is a longer text, behind the disclosure below it. */
export const WIRE_REACH_NOTE = `From ${WIRE_REACH_RANGE.min} to ${WIRE_REACH_RANGE.max} tiles; ${UNLIMITED_WIRE_REACH} means unlimited. In the game the reach is ${DEFAULT_WIRE_REACH}. An electric pole has its own reach.`;
export const WIRE_REACH_DETAILS_LABEL = "More about wire reach";

/** The reach a text stands for, with a point or a comma before the fraction; a number out of range becomes the nearest end of it. Undefined for a text that is no number. */
export function parseWireReach(text: string): number | undefined {
  const trimmed = text.trim();
  return /^-?\d+([.,]\d+)?$/.test(trimmed) ? clampWireReach(Number(trimmed.replace(",", "."))) : undefined;
}
