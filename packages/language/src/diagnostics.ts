import type { Range } from "./tokens.ts";

export type Severity = "error" | "warning";

/** Stable diagnostic codes and their severity. Errors block simulation and graphical edits; warnings do not. */
export const DIAGNOSTIC_SEVERITY = {
  "syntax-error": "error",
  "unsupported-feature": "error",
  "duplicate-entity": "error",
  "unknown-entity": "error",
  "unknown-terminal": "error",
  "invalid-terminal": "error",
  "self-wire": "error",
  "integer-range": "error",
  "illegal-wildcard": "error",
  "duplicate-statement": "error",
  "duplicate-signal": "error",
  "contradictory-statement": "error",
  "invalid-statement": "error",
  "unknown-property": "error",
  "invalid-value": "error",
  "invalid-signal": "error",
  "duplicate-wire": "warning",
  "unknown-signal": "warning",
  "disabled-signal": "warning",
  "unconfigured": "warning",
  "unused-else-output": "warning",
  "tile-off-grid": "warning",
  "tile-overlap": "warning",
  "unused-facing": "warning",
} as const satisfies Record<string, Severity>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_SEVERITY;

export interface Diagnostic extends Range {
  readonly severity: Severity;
  readonly code: DiagnosticCode;
  readonly message: string;
}

export function diagnostic(range: Range, code: DiagnosticCode, message: string): Diagnostic {
  return { from: range.from, to: range.to, severity: DIAGNOSTIC_SEVERITY[code], code, message };
}
