// Input validation for inspector fields. Pure.
import { isKeyword } from "@face/language";
import { isInt32, wildcardOf, type Circuit, type EntityId, type SignalId, type Wildcard } from "@face/model";
import { parseSignalText } from "../entities/signalText.ts";

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export const SIGNAL_FORMAT_HINT = "kind:name or kind:name@quality, for example virtual:signal-A";

export function parseInt32(text: string): ParseResult<number> {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return { ok: false, message: "Enter a whole number" };
  const value = Number(trimmed);
  return isInt32(value) ? { ok: true, value } : { ok: false, message: "Must fit a signed 32-bit integer" };
}

/** A number with or without decimals, from `min` to `max`, both included. */
export function parseNumberInRange(text: string, min: number, max: number): ParseResult<number> {
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: false, message: "Enter a number" };
  const value = Number(trimmed);
  return value >= min && value <= max ? { ok: true, value } : { ok: false, message: `Must be from ${min} to ${max}` };
}

/** Empty text means "no signal", which is only acceptable when the field is not required. `wildcards` lists the wildcards this slot accepts. */
export function parseSignalField(text: string, required: boolean, wildcards: readonly Wildcard[]): ParseResult<SignalId | undefined> {
  if (text.trim() === "") return required ? { ok: false, message: "A signal is required" } : { ok: true, value: undefined };
  const signal = parseSignalText(text);
  if (!signal) return { ok: false, message: `Expected ${SIGNAL_FORMAT_HINT}` };
  const wildcard = wildcardOf(signal);
  if (wildcard && !wildcards.includes(wildcard)) return { ok: false, message: wildcards.length === 0 ? "Wildcard signals are not allowed here" : `'${wildcard}' is not allowed here; use ${wildcards.map((name) => `'${name}'`).join(" or ")}` };
  return { ok: true, value: signal };
}

const ENTITY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Returns a message when `name` cannot be used for the entity with `entityId`, or null when it is fine. */
export function entityNameError(name: string, entityId: EntityId, circuit: Circuit): string | null {
  if (name === "") return "A name is required";
  if (!ENTITY_NAME.test(name)) return "Use letters, digits and _; do not start with a digit";
  if (isKeyword(name)) return `"${name}" is a reserved word of the circuit language`;
  if (circuit.entities.some((other) => other.id !== entityId && other.name === name)) return `"${name}" is already used`;
  return null;
}
