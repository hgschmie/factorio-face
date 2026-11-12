// Completion candidates for a caret position: what the language expects there, filled in from the circuit and the catalog. Pure.
import { ENTITY_PROPERTIES, printSignal, SECTION_PROPERTIES, type CompletionContext } from "@face/language";
import type { SignalId } from "@face/model";

export type CandidateType = "keyword" | "property" | "enum" | "signal" | "variable";

export interface Candidate {
  /** The text that is inserted. */
  readonly label: string;
  readonly type: CandidateType;
  readonly detail?: string;
}

export interface CompletionCatalog {
  /** Signals of the enabled modules that a signal slot accepts, without wildcards. */
  selectableSignals(): readonly { readonly id: SignalId; readonly displayName: string }[];
  readonly qualities: readonly { readonly name: string; readonly displayName: string }[];
}

const PROPERTY_DETAILS = new Map<string, string>([...Object.values(ENTITY_PROPERTIES).flat(), ...SECTION_PROPERTIES].map((property) => [property.name, property.detail]));
const WILDCARD_DETAILS: Readonly<Record<string, string>> = { each: "every input signal, one by one", anything: "any one input signal", everything: "all input signals" };

/** Candidates in the order they should be offered: keywords, properties, values, entity terminals, then signals. Duplicates are dropped. */
export function completionCandidates(context: CompletionContext, catalog: CompletionCatalog): Candidate[] {
  const candidates: Candidate[] = [];
  const signals: Candidate[] = [];
  let wantsSignals = false;
  for (const expected of context.expected) {
    switch (expected.type) {
      case "keyword":
        for (const value of expected.values) candidates.push({ label: value, type: "keyword" });
        break;
      case "property":
        for (const name of expected.names) candidates.push({ label: name, type: "property", detail: PROPERTY_DETAILS.get(name) });
        break;
      case "enum":
        for (const value of expected.values) candidates.push({ label: value, type: "enum", detail: expected.property });
        break;
      case "terminal":
        for (const entity of expected.entities) for (const side of entity.sides) candidates.push({ label: `${entity.name}.${side}`, type: "variable", detail: entity.kind });
        break;
      case "side":
        for (const side of expected.sides) candidates.push({ label: side, type: "enum", detail: side === "in" ? "input terminal" : "output terminal" });
        break;
      case "signal":
        for (const wildcard of expected.wildcards) candidates.push({ label: wildcard, type: "keyword", detail: WILDCARD_DETAILS[wildcard] });
        wantsSignals = true;
        break;
      case "literal":
        if (expected.kind === "quality") for (const quality of catalog.qualities) candidates.push({ label: quality.name, type: "enum", detail: quality.displayName });
        break;
    }
  }
  if (wantsSignals) for (const entry of catalog.selectableSignals()) signals.push({ label: printSignal(entry.id), type: "signal", detail: entry.displayName });
  const seen = new Set<string>();
  return [...candidates, ...signals].filter((candidate) => !seen.has(candidate.label) && seen.add(candidate.label));
}
